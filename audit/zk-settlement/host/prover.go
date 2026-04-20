package host

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// ProveResult is what we hand to the on-chain verifier: the raw proof bytes
// plus the packed public inputs.
type ProveResult struct {
	Proof               []byte
	PublicInputs        []byte
	PublicInputsDecoded types.PublicInputs
}

// Prover is the minimal surface we need. Swap the implementation for tests
// that don't have the Pico toolchain.
type Prover interface {
	Prove(ctx context.Context, guestELF string, witness *types.Witness) (*ProveResult, error)
}

// SettlementProver shells out to the Rust `settlement-prover` binary that
// lives in zk-settlement/prover. The Rust side owns the Pico SDK calls
// (`DefaultProverClient`, `prove_fast`, …); this Go wrapper is just IO glue
// so the backend / CLI stays in Go.
type SettlementProver struct {
	// Binary name; defaults to "settlement-prover" on PATH, falls back to
	// `cargo run -p settlement-prover --release --` when Binary == "cargo".
	Binary string
	// Extra args prepended to the prover invocation (used when Binary is
	// "cargo" to pass "run", "-p", …).
	ExtraArgs []string
}

func (p *SettlementProver) bin() (string, []string) {
	if p.Binary == "" {
		return "settlement-prover", nil
	}
	return p.Binary, p.ExtraArgs
}

func (p *SettlementProver) Prove(ctx context.Context, guestELF string, witness *types.Witness) (*ProveResult, error) {
	if _, err := os.Stat(guestELF); err != nil {
		return nil, fmt.Errorf("guest ELF %s not found — run `cargo pico build` in zk-settlement/guest first: %w", guestELF, err)
	}

	// Stage the witness to a temp file. The Rust prover reads JSON from disk;
	// stdin would work too but temp files make failures easier to debug.
	witnessJSON, err := json.Marshal(witness)
	if err != nil {
		return nil, fmt.Errorf("marshal witness: %w", err)
	}
	tmpWitness, err := os.CreateTemp("", "zk-witness-*.json")
	if err != nil {
		return nil, fmt.Errorf("witness tmpfile: %w", err)
	}
	defer os.Remove(tmpWitness.Name())
	if _, err := tmpWitness.Write(witnessJSON); err != nil {
		return nil, fmt.Errorf("write witness: %w", err)
	}
	tmpWitness.Close()

	tmpProof, err := os.CreateTemp("", "zk-proof-*.json")
	if err != nil {
		return nil, fmt.Errorf("proof tmpfile: %w", err)
	}
	defer os.Remove(tmpProof.Name())
	tmpProof.Close()

	bin, extra := p.bin()
	args := append([]string{}, extra...)
	args = append(args,
		"--witness", tmpWitness.Name(),
		"--elf", guestELF,
		"--out", tmpProof.Name(),
	)

	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdout = os.Stderr // prover prints progress; surface it but don't mix with JSON
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("settlement-prover: %w\nstderr:\n%s", err, stderr.String())
	}

	proofBody, err := os.ReadFile(tmpProof.Name())
	if err != nil {
		return nil, fmt.Errorf("read proof output: %w", err)
	}

	var raw struct {
		EpochID         uint64 `json:"epoch_id"`
		Publisher       string `json:"publisher"`
		AmountClaim     string `json:"amount_claim"`
		LogRoot         string `json:"log_root"`
		Currency        string `json:"currency"`
		PublicValuesHex string `json:"public_values_hex"`
		ProofHex        string `json:"proof_hex"`
	}
	if err := json.Unmarshal(proofBody, &raw); err != nil {
		return nil, fmt.Errorf("parse prover output: %w\nbody: %s", err, string(proofBody))
	}

	proofBytes, err := hex.DecodeString(raw.ProofHex)
	if err != nil {
		return nil, fmt.Errorf("decode proof_hex: %w", err)
	}
	// raw.PublicValuesHex is the bincode-encoded PublicInputs the guest
	// committed — useful for local verify, not what the Solidity verifier
	// expects. The on-chain verifier needs our canonical 96-byte layout.
	canonical, err := EncodePublicInputs(witness.Public)
	if err != nil {
		return nil, err
	}

	return &ProveResult{
		Proof:               proofBytes,
		PublicInputs:        canonical,
		PublicInputsDecoded: witness.Public,
	}, nil
}

// DryRunProver satisfies the Prover interface without talking to Pico.
type DryRunProver struct{}

func (DryRunProver) Prove(_ context.Context, _ string, w *types.Witness) (*ProveResult, error) {
	pi, err := EncodePublicInputs(w.Public)
	if err != nil {
		return nil, err
	}
	return &ProveResult{
		Proof:               []byte("DRY_RUN_NOT_A_REAL_PROOF"),
		PublicInputs:        pi,
		PublicInputsDecoded: w.Public,
	}, nil
}
