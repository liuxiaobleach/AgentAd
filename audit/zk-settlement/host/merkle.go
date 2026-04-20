package host

import (
	"bytes"
	"crypto/sha256"
	"fmt"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// MerkleTree holds every level so we can emit per-leaf inclusion proofs without
// recomputing. For AgentAd-scale epochs (≤ millions of impressions/day) this
// fits comfortably in memory. If we ever outgrow it, switch to a streaming
// builder that persists levels to disk.
type MerkleTree struct {
	levels [][]types.Bytes32 // levels[0] = leaves, levels[len-1] = [root]
}

// BuildTree constructs a Merkle tree over the given leaves using the sorted-pair
// SHA-256 scheme that matches the guest. Expects leaves pre-sorted/deduped by
// SortLeaves; it does NOT re-sort.
func BuildTree(leaves []types.ImpressionEvent) (*MerkleTree, error) {
	if len(leaves) == 0 {
		return nil, fmt.Errorf("cannot build tree with zero leaves")
	}

	level := make([]types.Bytes32, len(leaves))
	for i, e := range leaves {
		level[i] = LeafHash(e)
	}

	t := &MerkleTree{levels: [][]types.Bytes32{level}}

	for len(level) > 1 {
		next := make([]types.Bytes32, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			var right types.Bytes32
			if i+1 < len(level) {
				right = level[i+1]
			} else {
				// Odd node — duplicate. Standard convention for unbalanced trees.
				right = left
			}
			next = append(next, hashPair(left, right))
		}
		t.levels = append(t.levels, next)
		level = next
	}
	return t, nil
}

// Root returns the Merkle root. Safe to call repeatedly.
func (t *MerkleTree) Root() types.Bytes32 {
	top := t.levels[len(t.levels)-1]
	return top[0]
}

// Proof returns (siblings, dirs) for the leaf at index i. `dirs` is a bitmask:
// bit k is 1 iff the sibling at depth k sits to the RIGHT of the current node.
// The guest reconstructs the path using the same convention.
func (t *MerkleTree) Proof(index int) ([]types.Bytes32, uint64, error) {
	if index < 0 || index >= len(t.levels[0]) {
		return nil, 0, fmt.Errorf("leaf index %d out of range (0..%d)", index, len(t.levels[0]))
	}

	siblings := make([]types.Bytes32, 0, len(t.levels)-1)
	var dirs uint64

	idx := index
	for d := 0; d < len(t.levels)-1; d++ {
		level := t.levels[d]
		var sib types.Bytes32
		if idx%2 == 0 {
			// We are the left child → sibling is to the right.
			if idx+1 < len(level) {
				sib = level[idx+1]
			} else {
				sib = level[idx] // odd-node self-duplication
			}
			dirs |= 1 << uint(d)
		} else {
			sib = level[idx-1]
			// bit stays 0 — sibling is on the LEFT
		}
		siblings = append(siblings, sib)
		idx /= 2
	}
	return siblings, dirs, nil
}

// VerifyProof re-climbs a proof and returns the implied root. Used in tests
// and in prove-claim as a sanity check before shelling to the zkVM.
func VerifyProof(leaf types.Bytes32, siblings []types.Bytes32, dirs uint64) types.Bytes32 {
	node := leaf
	for i, s := range siblings {
		var left, right types.Bytes32
		if (dirs>>uint(i))&1 == 1 {
			// sibling is RIGHT
			left, right = node, s
		} else {
			left, right = s, node
		}
		node = hashPair(left, right)
	}
	return node
}

func hashPair(a, b types.Bytes32) types.Bytes32 {
	h := sha256.New()
	h.Write([]byte{nodePrefix})
	// NOTE: we do NOT sort here. The guest derives (lo, hi) from `dirs`, not
	// from a lex comparison, so host and guest must agree on direction. This
	// keeps the proof format compatible with generic Merkle libraries.
	h.Write(a[:])
	h.Write(b[:])
	var out types.Bytes32
	copy(out[:], h.Sum(nil))
	return out
}

// IndexOf returns the position of an event in the committed leaf order.
// Returns -1 if not found. Linear scan is fine for epoch construction; callers
// building per-publisher witnesses can iterate once and build their own index.
func IndexOf(sortedLeaves []types.ImpressionEvent, target types.ImpressionEvent) int {
	want := LeafHash(target)
	for i, e := range sortedLeaves {
		if got := LeafHash(e); bytes.Equal(got[:], want[:]) {
			return i
		}
	}
	return -1
}
