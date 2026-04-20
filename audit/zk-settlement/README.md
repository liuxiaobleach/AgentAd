# zk-settlement — Pico zkVM Batch Settlement for AgentAd

> **Status:** isolated scaffold / design draft. Nothing in this directory is wired
> into the live backend or contracts yet. Merging this into `BudgetEscrow` is a
> future task — see [Integration Path](#integration-path).

This module replaces the current EIP-712 signed-receipt claim flow with a
**zk-rollup-style epoch settlement**, using [Pico zkVM](https://github.com/brevis-network/pico)
to prove that a publisher's claim amount is the correct function of the raw
impression log committed on-chain.

Today, `BudgetEscrow.claim()` trusts a signed receipt from the platform issuer.
Publishers must trust the platform not to mis-count their earnings. With the
design in this directory, the platform commits a Merkle root of all impressions
for an epoch, and each claim is a ZK proof that the claimed amount is exactly
what the committed log implies. Advertisers get auditable billing; publishers
get trust-minimized payouts.

---

## Contents

```
zk-settlement/
├── README.md                  # this file
├── guest/                     # Rust Pico zkVM guest program
│   ├── Cargo.toml
│   └── src/main.rs            # Settlement computation + Merkle verification
├── host/                      # Go host-side orchestration
│   ├── go.mod
│   ├── impression.go          # ImpressionEvent canonical encoding
│   ├── merkle.go              # Sorted-pair Merkle tree (matches guest)
│   ├── epoch.go               # Epoch aggregation + publisher rollup
│   ├── prover.go              # Shells out to pico CLI to produce proof
│   ├── publicinputs.go        # Public-input encoding (host ↔ guest ↔ chain)
│   └── cmd/
│       ├── build-epoch/       # CLI: ingest impressions → Merkle root + witness
│       └── prove-claim/       # CLI: (publisher, epoch) → proof + public inputs
├── contracts/
│   ├── IProofVerifier.sol     # Interface implemented by Pico's auto-generated verifier
│   ├── EpochRegistry.sol      # On-chain registry of committed Merkle roots per epoch
│   └── ZkClaimEscrow.sol      # Example BudgetEscrow variant that consumes proofs
├── types/
│   └── settlement.go          # Shared Go types (ImpressionEvent, EpochRoot, …)
└── examples/
    └── sample_epoch.json      # Fixture used by tests
```

---

## Why batch settlement

The current claim path is:

```
publisher requests claim
  → backend reads DB, sums impressions, picks CPM
  → backend signs EIP-712 receipt with ISSUER_PRIVATE_KEY
  → publisher submits receipt to BudgetEscrow
  → on-chain: verify signature, mark receipt used, transfer USDC
```

The weak link is trust in the issuer's arithmetic. A rogue (or compromised)
issuer key can sign any payout. The advertiser only sees an aggregate number,
not the raw impressions that produced it.

Batch settlement swaps the signed receipt for a ZK proof:

```
(1) offline per epoch  ─── aggregate impressions into Merkle tree
                            publish Merkle root on-chain (EpochRegistry)
(2) publisher claim   ─── prover runs Pico zkVM on raw impressions
                            outputs proof + (publisher, epoch, amount, root)
                            submits to ZkClaimEscrow
(3) on-chain verify   ─── verifier contract validates proof
                            root == registered root for that epoch
                            transfer USDC
```

Nobody needs to trust the issuer's math — only that the committed root captures
the correct set of impressions for the epoch. That's a much narrower trust
surface, and is itself auditable because the committed log can be inspected
post-hoc against per-publisher SDK telemetry.

---

## Data flow

```
┌──────────────────────┐         ┌──────────────────────┐
│  Backend impression  │         │  Publisher SDK log   │
│  pipeline (DB)       │         │  (verify callbacks)  │
└─────────┬────────────┘         └──────────┬───────────┘
          │                                 │
          │      (epoch boundary reached)   │
          ▼                                 ▼
     ┌──────────────────────────────────────────┐
     │  build-epoch (Go host)                   │
     │   • canonicalize ImpressionEvents        │
     │   • sort, dedupe, hash leaves            │
     │   • build Merkle tree                    │
     │   • publish: EpochRegistry.commit(root)  │
     │   • archive: epoch_<N>.json (witness)    │
     └──────────────────────┬───────────────────┘
                            │
                            │  (publisher requests payout)
                            ▼
     ┌──────────────────────────────────────────┐
     │  prove-claim (Go host → Pico CLI)        │
     │   • load epoch witness                   │
     │   • extract leaves for requested pub     │
     │   • build per-leaf Merkle proofs         │
     │   • stdin: witness JSON                  │
     │   • pico prove --program guest.elf       │
     │   • stdout: proof + public inputs        │
     └──────────────────────┬───────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────┐
     │  ZkClaimEscrow.claim(publicInputs, proof)│
     │   • IProofVerifier.verify(pi, proof)     │
     │   • EpochRegistry.rootOf(epoch) == pi.root│
     │   • USDC.transfer(publisher, pi.amount)  │
     │   • mark (publisher, epoch) claimed      │
     └──────────────────────────────────────────┘
```

---

## Public / private inputs

Inside the zkVM guest we keep inputs minimal, and keep secret data private:

| Input            | Kind    | Meaning                                                    |
|------------------|---------|------------------------------------------------------------|
| `epoch_id`       | public  | Settlement epoch identifier (`u64`)                        |
| `publisher`      | public  | 20-byte publisher wallet that will claim                   |
| `amount`         | public  | Atomic USDC the guest computed                             |
| `log_root`       | public  | Merkle root of the full impression log for this epoch      |
| `currency`       | public  | USDC token address (for domain separation)                 |
| `impressions[]`  | private | Full list of events credited to `publisher`                |
| `merkle_paths[]` | private | Inclusion proof for each impression against `log_root`     |
| `rate_card`      | private | CPM table used for aggregation (snapshotted at epoch open) |

Because `log_root` is public, any observer can independently check that the
root on-chain matches what the host committed — no need to trust the prover
with set membership.

---

## Guest program (Rust, Pico zkVM)

`guest/src/main.rs` implements the deterministic settlement computation:

1. Read public inputs: `(epoch_id, publisher, amount_claim, log_root, currency)`.
2. Read private witness: per-leaf events + Merkle paths + rate card.
3. For each event:
   - Check `event.publisher == publisher`.
   - Check `event.epoch == epoch_id`.
   - Verify Merkle inclusion against `log_root`.
   - Look up CPM from rate card, convert impressions → atomic USDC.
4. Sum all verified contributions → `amount_derived`.
5. Assert `amount_derived == amount_claim`.
6. Commit all public inputs.

The guest is intentionally simple: verification + summation. No floating-point,
no string parsing, no network. All inputs are already canonicalized by the
host, so the guest is essentially an arithmetic circuit.

---

## On-chain contracts

- **`EpochRegistry.sol`** — an owner-gated mapping `epochId → (root, committedAt)`.
  The backend commits the Merkle root when an epoch closes; anyone can read it.

- **`IProofVerifier.sol`** — thin interface the Pico toolchain can target. Pico
  exports an auto-generated Solidity verifier (typically Groth16); we wrap it so
  upgrading the proof system later is a config change, not a contract rewrite.

- **`ZkClaimEscrow.sol`** — parallel escrow that consumes ZK-proven claims
  instead of signed receipts. Keeps the deposit-side API identical to
  `BudgetEscrow`, so advertisers don't need to re-onboard. Key differences:
  - No `issuer` role — the prover is permissionless.
  - `claim()` takes `(publicInputs, proof)` not `(receipt, signature)`.
  - Uniqueness is `(publisher, epoch)` — one claim per publisher per epoch.

---

## Integration path

The existing `BudgetEscrow` at `0x69F90Aa002e609F3BCFE0F1dA43C41643E25bf21` is
NOT modified by this module. Migration is staged:

1. **Shadow mode (current PR, this directory):**
   - Build epoch Merkle trees alongside the current claim flow.
   - Commit roots to `EpochRegistry` on testnet.
   - Generate proofs in CI to validate the guest + host pipeline.
   - **No user impact. Existing publishers keep using the signed-receipt path.**

2. **Opt-in dual claim:**
   - Deploy `ZkClaimEscrow` separately. Funded by a transfer from `BudgetEscrow`.
   - Publishers can choose which to redeem from. A/B the UX.

3. **Cutover:**
   - Route all new deposits to `ZkClaimEscrow`.
   - Leave `BudgetEscrow` in claim-only mode until residual receipts drain.

4. **Retire issuer key:**
   - Once no outstanding signed receipts remain, `setIssuer(0)` on `BudgetEscrow`.
   - The ISSUER_PRIVATE_KEY is no longer a liability.

---

## Local development

This module has its own `go.mod`, `Cargo.toml` workspace, and `rust-toolchain`.
It does NOT depend on the main backend module.

### One-time toolchain setup

```bash
# Pinned nightly — matches rust-toolchain in this directory
rustup install nightly-2025-08-04
rustup component add rust-src --toolchain nightly-2025-08-04

# Pico CLI MUST match the SDK git tag we pin to (v1.3.0).
# The stock crates.io `cargo-pico 1.2.2` emits 64-bit ELFs which the SDK rejects.
cargo +nightly-2025-08-04 install --git https://github.com/brevis-network/pico \
    --tag v1.3.0 pico-cli --locked --force
```

If `cargo pico build` later fails with "constant_time_eq … requires rustc 1.95.0",
pin the transitive dep: `cargo update constant_time_eq --precise 0.4.2`.

### Smoke-test recipe (confirmed 2026-04-19)

```bash
# 1. Compile host-side Rust prover + guest ELF
cargo build -p settlement-prover --release
(cd guest && cargo pico build)         # → guest/elf/riscv32im-pico-zkvm-elf

# 2. Build an epoch archive + a per-publisher witness (Go side)
cd host
go run ./cmd/build-epoch    --input ../examples/sample_epoch.json --out /tmp/epoch.json
go run ./cmd/emit-witness   --archive /tmp/epoch.json \
    --publisher 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --out /tmp/witness.json

# 3. Generate a real proof (Rust)
cd ..
RUST_LOG=info ./target/release/settlement-prover \
    --witness /tmp/witness.json \
    --elf guest/elf/riscv32im-pico-zkvm-elf \
    --out /tmp/proof.json
```

Expected output for the shipped fixture:

| Publisher        | Amount (atomic USDC) | Events | Cycles  | Proof size |
|------------------|----------------------|--------|---------|------------|
| 0xaaaa…aaaa      | 11000                | 4      | ~272k   | ~4.1 MB    |
| 0xbbbb…bbbb      | 17000                | 4      | ~272k   | ~4.1 MB    |

A tampered witness (edit `amount_claim` to a bogus value, leave events as-is)
panics inside the guest — the prover halts with `HaltWithNonZeroExitCode(1)`
and no proof is produced. Verified.

### What `prove_fast` gives you

`proof.pv_stream` is a bincode-encoded copy of the `PublicInputs` the guest
committed — good for local verification. For on-chain Solidity verification
we'll need to switch to `prove_evm` (Groth16-style output) — see TODO below.

---

## Status (as of 2026-04-19)

### Confirmed working
- Go host: `build-epoch`, `emit-witness`, `prove-claim --dry-run`, unit tests pass
- Rust guest: builds to 32-bit RISC-V ELF via `cargo pico build`
- Rust prover: generates a real `prove_fast` proof, Pico internally verifies it
- Host ↔ guest hashing / Merkle / public-input encoding agree byte-for-byte
- Tamper resistance: changing `amount_claim` in the witness halts the guest

### Still TODO (not blocking current scope)
- [ ] Switch prover from `prove_fast` to `prove_evm` (Groth16) so output can be
      consumed by a Solidity verifier. Requires commissioning keys + the
      Pico-generated verifier contract — see Pico docs for EVM proof flow.
- [ ] Wire `IProofVerifier` in `contracts/` to the actual generated Groth16
      verifier. Today it's just the interface shell.
- [ ] Integration with the live `backend/internal/handler/simulation.go`
      impression stream — currently `build-epoch` eats a hand-built JSON.
- [ ] Epoch close trigger (cron / backend worker) and on-chain commit tx.
- [ ] Frontend UX: show "epoch closes in 1d 4h" on `/billing`, switch the claim
      button to the ZK flow once the registry + verifier are deployed.
- [ ] Replay tool: reconstruct impressions from SDK verify logs to
      independently sanity-check the committed root.
