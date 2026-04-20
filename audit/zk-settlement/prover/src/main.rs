//! Rust host binary that drives the Pico prover.
//!
//! Invoked by the Go `prove-claim` wrapper (or directly during development):
//!     settlement-prover --witness /path/witness.json \
//!                       --elf     /path/to/riscv32im-pico-zkvm-elf \
//!                       --out     /path/claim.proof.json
//!
//! Flow:
//!   1. Read the Go-produced witness JSON.
//!   2. Serialize it into Pico's stdin via `stdin_builder.write` (bincode).
//!   3. Call `client.prove_fast(stdin_builder)`.
//!   4. Decode the committed `PublicInputs` out of `proof.pv_stream`.
//!   5. Emit a JSON bundle { public_inputs, proof_bytes } to --out.

use pico_sdk::{client::DefaultProverClient, init_logger};
use settlement_lib::{PublicInputs, Witness};
use serde::Serialize;
use std::fs;
use std::process::ExitCode;

#[derive(Serialize)]
struct ClaimProofOutput {
    // Human-readable copy of what the guest committed.
    epoch_id: u64,
    publisher: String,
    amount_claim: String,
    log_root: String,
    currency: String,
    // bincode-encoded public values (what proof.pv_stream contained).
    public_values_hex: String,
    // The raw proof blob. Format is Pico's internal `MetaProof` — safe to
    // round-trip via bincode for local verify; swap to `prove_evm` output
    // when integrating with the Solidity verifier.
    proof_hex: String,
}

fn main() -> ExitCode {
    init_logger();

    let args = parse_args();

    let witness_json = match fs::read_to_string(&args.witness) {
        Ok(s) => s,
        Err(e) => return die(&format!("read witness {}: {}", args.witness, e)),
    };
    let witness: Witness = match serde_json::from_str(&witness_json) {
        Ok(w) => w,
        Err(e) => return die(&format!("parse witness json: {}", e)),
    };

    let elf = match fs::read(&args.elf) {
        Ok(b) => b,
        Err(e) => return die(&format!("read elf {}: {} (run `cargo pico build` in guest/ first)", args.elf, e)),
    };

    println!("settlement-prover: elf={} bytes, events={}, expected_amount={}",
        elf.len(), witness.events.len(), witness.public.amount_claim);

    let client = DefaultProverClient::new(&elf);
    let mut stdin_builder = client.new_stdin_builder();
    stdin_builder.write(&witness);

    println!("settlement-prover: generating proof (this can take seconds-to-minutes)…");
    let proof = match client.prove_fast(stdin_builder) {
        Ok(p) => p,
        Err(e) => return die(&format!("prove_fast: {:?}", e)),
    };

    let pv_bytes = match proof.pv_stream.clone() {
        Some(b) => b,
        None => return die("proof has no public-value stream"),
    };

    let committed: PublicInputs = match bincode::deserialize(&pv_bytes) {
        Ok(v) => v,
        Err(e) => return die(&format!("decode committed PublicInputs: {}", e)),
    };

    // Cross-check: the guest asserts amount internally, but double-checking here
    // catches any mismatch in our host/guest serialization assumptions.
    if committed.amount_claim != witness.public.amount_claim {
        return die(&format!(
            "committed amount {} != witness amount {}",
            committed.amount_claim, witness.public.amount_claim
        ));
    }

    let proof_bytes = match bincode::serialize(&proof) {
        Ok(b) => b,
        Err(e) => return die(&format!("serialize proof: {}", e)),
    };

    let out = ClaimProofOutput {
        epoch_id: committed.epoch_id,
        publisher: format!("0x{}", hex::encode(committed.publisher)),
        amount_claim: committed.amount_claim.clone(),
        log_root: format!("0x{}", hex::encode(committed.log_root)),
        currency: format!("0x{}", hex::encode(committed.currency)),
        public_values_hex: hex::encode(&pv_bytes),
        proof_hex: hex::encode(&proof_bytes),
    };

    let body = match serde_json::to_string_pretty(&out) {
        Ok(s) => s,
        Err(e) => return die(&format!("marshal output: {}", e)),
    };

    if let Some(path) = args.out.as_deref() {
        if let Err(e) = fs::write(path, &body) {
            return die(&format!("write {}: {}", path, e));
        }
        println!(
            "settlement-prover: wrote proof to {} (publisher={}, amount={}, pv={} bytes, proof={} bytes)",
            path, out.publisher, out.amount_claim, pv_bytes.len(), proof_bytes.len()
        );
    } else {
        println!("{}", body);
    }

    ExitCode::SUCCESS
}

struct Args {
    witness: String,
    elf: String,
    out: Option<String>,
}

fn parse_args() -> Args {
    let mut witness = None;
    let mut elf = None;
    let mut out = None;

    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--witness" => witness = it.next(),
            "--elf" => elf = it.next(),
            "--out" => out = it.next(),
            "-h" | "--help" => {
                eprintln!(
                    "usage: settlement-prover --witness FILE --elf FILE [--out FILE]\n\
                     \n\
                     --witness   JSON witness produced by the Go `prove-claim` CLI\n\
                     --elf       Pico guest ELF (default target: guest/elf/riscv32im-pico-zkvm-elf)\n\
                     --out       Where to write the proof JSON (stdout if omitted)"
                );
                std::process::exit(0);
            }
            other => {
                eprintln!("settlement-prover: unknown arg {}", other);
                std::process::exit(2);
            }
        }
    }

    Args {
        witness: witness.unwrap_or_else(|| die_str("--witness is required")),
        elf: elf.unwrap_or_else(|| die_str("--elf is required")),
        out,
    }
}

fn die(msg: &str) -> ExitCode {
    eprintln!("settlement-prover: {}", msg);
    ExitCode::from(1)
}

fn die_str(msg: &str) -> String {
    eprintln!("settlement-prover: {}", msg);
    std::process::exit(2);
}
