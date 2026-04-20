package host

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// leafPrefix and nodePrefix match the guest. Never change without a guest rebuild.
const (
	leafPrefix byte = 0x00
	nodePrefix byte = 0x01
)

// CanonicalLeafBytes serializes an ImpressionEvent into its canonical,
// fixed-width byte form. This is the only function allowed to define the
// hashed representation of a leaf — the guest relies on byte equality.
//
// Layout (matches guest/src/main.rs::leaf_hash):
//   32  campaign_id
//   20  publisher
//    8  epoch_id          (big-endian u64)
//   32  attestation_id
//    8  viewed_ms         (big-endian u64)
//   16  nonce
// = 116 bytes
func CanonicalLeafBytes(e types.ImpressionEvent) []byte {
	var buf bytes.Buffer
	buf.Grow(116)
	buf.Write(e.CampaignID[:])
	buf.Write(e.Publisher[:])
	_ = binary.Write(&buf, binary.BigEndian, e.EpochID)
	buf.Write(e.AttestationID[:])
	_ = binary.Write(&buf, binary.BigEndian, e.ViewedMs)
	buf.Write(e.Nonce[:])
	return buf.Bytes()
}

// LeafHash = SHA256(0x00 || canonical_bytes). Must produce the same 32 bytes
// the guest computes in leaf_hash().
func LeafHash(e types.ImpressionEvent) types.Bytes32 {
	h := sha256.New()
	h.Write([]byte{leafPrefix})
	h.Write(CanonicalLeafBytes(e))
	var out types.Bytes32
	copy(out[:], h.Sum(nil))
	return out
}

// SortLeaves returns a deterministic ordering of events by their leaf hash.
// Using hash-order (not insertion order) means any honest reconstruction of
// the epoch — from any replica — yields the same Merkle root as long as the
// set of events matches. Dedupe-by-hash slots in for free.
func SortLeaves(events []types.ImpressionEvent) []types.ImpressionEvent {
	type kv struct {
		hash types.Bytes32
		ev   types.ImpressionEvent
	}
	kvs := make([]kv, 0, len(events))
	for _, e := range events {
		kvs = append(kvs, kv{hash: LeafHash(e), ev: e})
	}
	// Simple insertion sort — epoch sizes in practice are small enough that
	// pulling in sort.Slice isn't worth the closure allocation.
	n := len(kvs)
	for i := 1; i < n; i++ {
		for j := i; j > 0 && bytes.Compare(kvs[j-1].hash[:], kvs[j].hash[:]) > 0; j-- {
			kvs[j-1], kvs[j] = kvs[j], kvs[j-1]
		}
	}

	out := make([]types.ImpressionEvent, 0, len(kvs))
	var prev types.Bytes32
	for i, k := range kvs {
		if i > 0 && k.hash == prev {
			continue // dedupe
		}
		prev = k.hash
		out = append(out, k.ev)
	}
	return out
}
