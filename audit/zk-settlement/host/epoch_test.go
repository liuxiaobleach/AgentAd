package host

import (
	"encoding/hex"
	"testing"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// TestEndToEnd exercises: aggregate → Merkle build → per-publisher witness →
// re-verify Merkle paths → encode public inputs. No zkVM involved, but this
// is the path prove-claim takes before shelling out to Pico, so all the host
// invariants are covered.
func TestEndToEnd(t *testing.T) {
	var (
		camp1 = mustHex32("c100000000000000000000000000000000000000000000000000000000000001")
		camp2 = mustHex32("c200000000000000000000000000000000000000000000000000000000000002")
		pubA  = mustHex20("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
		pubB  = mustHex20("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
		att1  = mustHex32("a100000000000000000000000000000000000000000000000000000000000001")
		usdc  = mustHex20("1c7d4b196cb0c7b01d743fbc6116a902379c7238")
	)

	imps := []types.ImpressionEvent{
		mkImp(camp1, pubA, 7, att1, 3200, 1),
		mkImp(camp1, pubA, 7, att1, 4100, 2),
		mkImp(camp2, pubA, 7, att1, 2500, 3),
		mkImp(camp1, pubB, 7, att1, 3700, 4),
		mkImp(camp2, pubB, 7, att1, 5900, 5),
	}
	rateCard := []types.RateCardEntry{
		{CampaignID: camp1, CpmMicroUSDC: "2000000"}, // $2 CPM → 2000 atomic/imp
		{CampaignID: camp2, CpmMicroUSDC: "5000000"}, // $5 CPM → 5000 atomic/imp
	}

	archive, err := BuildEpoch(7, usdc, imps, rateCard)
	if err != nil {
		t.Fatalf("BuildEpoch: %v", err)
	}
	if len(archive.Leaves) != len(imps) {
		t.Fatalf("expected %d leaves, got %d", len(imps), len(archive.Leaves))
	}

	// Publisher A: 2 × camp1 + 1 × camp2 = 2000+2000+5000 = 9000 atomic USDC.
	witnessA, err := BuildPublisherWitness(archive, pubA)
	if err != nil {
		t.Fatalf("witness A: %v", err)
	}
	if witnessA.Public.AmountClaim != "9000" {
		t.Errorf("publisher A claim = %s, want 9000", witnessA.Public.AmountClaim)
	}
	for i, pe := range witnessA.Events {
		root := VerifyProof(LeafHash(pe.Event), pe.Path, pe.PathDirs)
		if root != archive.LogRoot {
			t.Errorf("publisher A event %d: merkle proof does not reconstruct root", i)
		}
	}

	// Publisher B: 1 × camp1 + 1 × camp2 = 2000+5000 = 7000 atomic USDC.
	witnessB, err := BuildPublisherWitness(archive, pubB)
	if err != nil {
		t.Fatalf("witness B: %v", err)
	}
	if witnessB.Public.AmountClaim != "7000" {
		t.Errorf("publisher B claim = %s, want 7000", witnessB.Public.AmountClaim)
	}

	// Public-input encoding is exactly 96 bytes.
	piA, err := EncodePublicInputs(witnessA.Public)
	if err != nil {
		t.Fatalf("encode pi A: %v", err)
	}
	if len(piA) != 96 {
		t.Errorf("public inputs len = %d, want 96", len(piA))
	}

	// Dry-run prover should round-trip.
	got, err := (DryRunProver{}).Prove(nil, "", witnessA)
	if err != nil {
		t.Fatalf("dry-run prove: %v", err)
	}
	if got.PublicInputsDecoded.AmountClaim != "9000" {
		t.Errorf("dry-run result amount = %s, want 9000", got.PublicInputsDecoded.AmountClaim)
	}
}

func mustHex32(s string) types.Bytes32 {
	var out types.Bytes32
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		panic("bad 32-byte hex: " + s)
	}
	copy(out[:], b)
	return out
}

func mustHex20(s string) types.Address {
	var out types.Address
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 20 {
		panic("bad 20-byte hex: " + s)
	}
	copy(out[:], b)
	return out
}

func mkImp(camp types.Bytes32, pub types.Address, epoch uint64, att types.Bytes32, viewed uint64, nonceLo byte) types.ImpressionEvent {
	var n types.Bytes16
	n[15] = nonceLo
	return types.ImpressionEvent{
		CampaignID:    camp,
		Publisher:     pub,
		EpochID:       epoch,
		AttestationID: att,
		ViewedMs:      viewed,
		Nonce:         n,
	}
}
