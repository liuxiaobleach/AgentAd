// emit-witness produces the Rust-consumable Witness JSON for a single
// (epoch, publisher) claim. Used by the Rust settlement-prover binary.
// Equivalent to `prove-claim --dry-run --emit-witness`, but minimal.
package main

import (
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
		archivePath = flag.String("archive", "", "epoch archive JSON (from build-epoch)")
		publisher   = flag.String("publisher", "", "publisher address (0x hex)")
		outPath     = flag.String("out", "-", "witness output path; '-' for stdout")
	)
	flag.Parse()
	if *archivePath == "" {
		die("--archive required")
	}
	if *publisher == "" {
		die("--publisher required")
	}

	body, err := os.ReadFile(*archivePath)
	if err != nil {
		die("read archive: %v", err)
	}
	var archive types.EpochArchive
	if err := json.Unmarshal(body, &archive); err != nil {
		die("parse archive: %v", err)
	}

	pub := parse20(*publisher)
	w, err := host.BuildPublisherWitness(&archive, pub)
	if err != nil {
		die("build witness: %v", err)
	}

	out, err := json.MarshalIndent(w, "", "  ")
	if err != nil {
		die("marshal witness: %v", err)
	}

	if *outPath == "-" {
		os.Stdout.Write(out)
		os.Stdout.Write([]byte("\n"))
	} else {
		if err := os.WriteFile(*outPath, out, 0o644); err != nil {
			die("write witness: %v", err)
		}
		fmt.Fprintf(os.Stderr, "witness written: %s (events=%d, amount=%s)\n",
			*outPath, len(w.Events), w.Public.AmountClaim)
	}
}

func parse20(s string) types.Address {
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		s = s[2:]
	}
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 20 {
		die("bad publisher hex: %v", err)
	}
	var a types.Address
	copy(a[:], b)
	return a
}

func die(f string, a ...any) {
	fmt.Fprintf(os.Stderr, "emit-witness: "+f+"\n", a...)
	os.Exit(1)
}
