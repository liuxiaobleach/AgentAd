// prove-claim produces a settlement proof for a single (publisher, epoch)
// pair. Output is a JSON blob containing the proof bytes and the packed
// public inputs — ready to be fed to ZkClaimEscrow.claim(publicInputs, proof).
//
// Unless --dry-run is passed, this shells out to the `pico` CLI and requires
// a built guest ELF.
package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	host "github.com/celer-network/zkdsp-audit/zk-settlement/host"
	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

func main() {
	var (
		witnessPath = flag.String("witness", "", "path to epoch archive (produced by build-epoch)")
		publisher   = flag.String("publisher", "", "publisher address (0x-prefixed hex)")
		guestELF    = flag.String("guest-elf", "", "path to the compiled guest program (e.g. guest/target/pico/release/guest.elf)")
		outPath     = flag.String("out", "", "write proof JSON to this path; stdout if empty")
		dryRun      = flag.Bool("dry-run", false, "skip real proving; emits a placeholder proof (for CI / local iteration)")
	)
	flag.Parse()

	if *witnessPath == "" {
		die("--witness is required")
	}
	if *publisher == "" {
		die("--publisher is required")
	}
	if !*dryRun && *guestELF == "" {
		die("--guest-elf is required when not in --dry-run")
	}

	archiveBytes, err := os.ReadFile(*witnessPath)
	if err != nil {
		die("read archive: %v", err)
	}
	var archive types.EpochArchive
	if err := json.Unmarshal(archiveBytes, &archive); err != nil {
		die("parse archive: %v", err)
	}

	pub, err := parse20(*publisher)
	if err != nil {
		die("invalid publisher: %v", err)
	}

	witness, err := host.BuildPublisherWitness(&archive, pub)
	if err != nil {
		die("build witness: %v", err)
	}

	// Belt-and-suspenders: also verify the archive-root-matches-witness-root
	// invariant before we go burn cycles on a zkVM run.
	if witness.Public.LogRoot != archive.LogRoot {
		die("internal error: witness root differs from archive root")
	}

	var prover host.Prover
	if *dryRun {
		prover = host.DryRunProver{}
	} else {
		prover = &host.SettlementProver{}
	}

	ctx := context.Background()
	result, err := prover.Prove(ctx, *guestELF, witness)
	if err != nil {
		die("prove: %v", err)
	}

	out := struct {
		EpochID      uint64 `json:"epoch_id"`
		Publisher    string `json:"publisher"`
		AmountClaim  string `json:"amount_claim"`
		LogRoot      string `json:"log_root"`
		Currency     string `json:"currency"`
		PublicInputs string `json:"public_inputs"`
		Proof        string `json:"proof"`
	}{
		EpochID:      result.PublicInputsDecoded.EpochID,
		Publisher:    "0x" + hex.EncodeToString(result.PublicInputsDecoded.Publisher[:]),
		AmountClaim:  result.PublicInputsDecoded.AmountClaim,
		LogRoot:      "0x" + hex.EncodeToString(result.PublicInputsDecoded.LogRoot[:]),
		Currency:     "0x" + hex.EncodeToString(result.PublicInputsDecoded.Currency[:]),
		PublicInputs: "0x" + hex.EncodeToString(result.PublicInputs),
		Proof:        "0x" + hex.EncodeToString(result.Proof),
	}
	body, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		die("marshal output: %v", err)
	}

	if *outPath == "" {
		os.Stdout.Write(body)
		os.Stdout.Write([]byte("\n"))
	} else {
		if err := os.WriteFile(*outPath, body, 0o644); err != nil {
			die("write proof: %v", err)
		}
		fmt.Printf("proof for publisher %s (epoch %d, amount %s) written: %s\n",
			out.Publisher, out.EpochID, out.AmountClaim, *outPath)
	}
}

func parse20(s string) (types.Address, error) {
	var out types.Address
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		s = s[2:]
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return out, err
	}
	if len(b) != 20 {
		return out, fmt.Errorf("expected 20 bytes, got %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "prove-claim: "+format+"\n", args...)
	os.Exit(1)
}
