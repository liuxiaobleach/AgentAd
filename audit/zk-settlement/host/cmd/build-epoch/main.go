// build-epoch ingests a batch of impressions for one settlement epoch and
// emits an archive file that prove-claim will later consume. It also prints
// the Merkle root so the operator can submit it to EpochRegistry.commit().
//
// The CLI intentionally takes JSON on stdin (or a file path) rather than
// talking to the live DB. Keeping it IO-agnostic lets us feed it from:
//   - a SQL export (`psql -c "\copy …" | build-epoch`)
//   - a replay log
//   - CI fixtures
//
// Once the zk flow is promoted out of shadow mode, a thin wrapper in the
// backend can build the JSON from internal/db/queries and pipe it in.
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	host "github.com/celer-network/zkdsp-audit/zk-settlement/host"
	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

type Input struct {
	EpochID     uint64                  `json:"epoch_id"`
	Currency    string                  `json:"currency"` // 0x-prefixed hex
	Impressions []types.ImpressionEvent `json:"impressions"`
	RateCard    []types.RateCardEntry   `json:"rate_card"`
}

func main() {
	var (
		inPath  = flag.String("input", "-", "path to epoch input JSON, or '-' for stdin")
		outPath = flag.String("out", "", "path to write the epoch archive JSON (required)")
	)
	flag.Parse()

	if *outPath == "" {
		die("missing --out")
	}

	raw, err := readAll(*inPath)
	if err != nil {
		die("read input: %v", err)
	}

	var input Input
	if err := json.Unmarshal(raw, &input); err != nil {
		die("parse input: %v", err)
	}

	currency, err := parse20(input.Currency)
	if err != nil {
		die("invalid currency: %v", err)
	}

	archive, err := host.BuildEpoch(input.EpochID, currency, input.Impressions, input.RateCard)
	if err != nil {
		die("build epoch: %v", err)
	}

	out, err := json.MarshalIndent(archive, "", "  ")
	if err != nil {
		die("marshal archive: %v", err)
	}
	if err := os.WriteFile(*outPath, out, 0o644); err != nil {
		die("write archive: %v", err)
	}

	fmt.Printf("epoch %d: %d leaves, root = 0x%s\n",
		archive.EpochID, len(archive.Leaves), hex.EncodeToString(archive.LogRoot[:]))
	fmt.Printf("next step: EpochRegistry.commit(%d, 0x%s)\n",
		archive.EpochID, hex.EncodeToString(archive.LogRoot[:]))
	fmt.Printf("archive written: %s\n", *outPath)
}

func readAll(path string) ([]byte, error) {
	if path == "-" {
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(path)
}

func parse20(s string) (types.Address, error) {
	var out types.Address
	b, err := hex.DecodeString(trim0x(s))
	if err != nil {
		return out, err
	}
	if len(b) != 20 {
		return out, fmt.Errorf("expected 20 bytes, got %d", len(b))
	}
	copy(out[:], b)
	return out, nil
}

func trim0x(s string) string {
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		return s[2:]
	}
	return s
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "build-epoch: "+format+"\n", args...)
	os.Exit(1)
}
