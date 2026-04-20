package types

import (
	"encoding/hex"
	"fmt"
)

// Hex-friendly JSON shims for fixed-width byte arrays.
//
// Go's stdlib marshals [N]byte as JSON arrays of numbers, which is unreadable
// and wasteful. Human fixtures and API payloads use 0x-prefixed hex instead.
// These named types add MarshalJSON/UnmarshalJSON so round-tripping works.
//
// Method definitions are attached to the named types declared in settlement.go
// to keep the protocol schema in one file.

func hexUnmarshal(data []byte, out []byte, name string) error {
	if len(data) < 2 || data[0] != '"' || data[len(data)-1] != '"' {
		return fmt.Errorf("%s: expected JSON string, got %s", name, string(data))
	}
	s := string(data[1 : len(data)-1])
	if len(s) >= 2 && (s[:2] == "0x" || s[:2] == "0X") {
		s = s[2:]
	}
	if len(s) != 2*len(out) {
		return fmt.Errorf("%s: expected %d hex chars, got %d", name, 2*len(out), len(s))
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	copy(out, b)
	return nil
}

func hexMarshal(in []byte) ([]byte, error) {
	s := "\"" + hex.EncodeToString(in) + "\""
	return []byte(s), nil
}
