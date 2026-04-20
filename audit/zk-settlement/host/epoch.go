package host

import (
	"fmt"
	"math/big"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// BuildEpoch is the offline pipeline the backend runs when an epoch closes.
// Input: raw impressions + rate card. Output: the archive that prove-claim
// will consume, plus the root to commit on-chain.
//
// This function is pure — no IO. The CLI wrapper in cmd/build-epoch handles
// reading from the DB and writing the archive.
func BuildEpoch(
	epochID uint64,
	currency types.Address,
	rawImpressions []types.ImpressionEvent,
	rateCard []types.RateCardEntry,
) (*types.EpochArchive, error) {
	if len(rawImpressions) == 0 {
		return nil, fmt.Errorf("epoch %d has no impressions — refusing to commit empty root", epochID)
	}
	for _, e := range rawImpressions {
		if e.EpochID != epochID {
			return nil, fmt.Errorf("impression tagged with epoch %d, expected %d", e.EpochID, epochID)
		}
	}
	if err := validateRateCard(rateCard, rawImpressions); err != nil {
		return nil, fmt.Errorf("rate card validation: %w", err)
	}

	sorted := SortLeaves(rawImpressions)
	tree, err := BuildTree(sorted)
	if err != nil {
		return nil, fmt.Errorf("merkle build: %w", err)
	}

	return &types.EpochArchive{
		EpochID:  epochID,
		Currency: currency,
		LogRoot:  tree.Root(),
		Leaves:   sorted,
		RateCard: rateCard,
	}, nil
}

// BuildPublisherWitness packages everything the guest needs to prove a single
// (publisher, epoch) claim: the subset of leaves for that publisher, their
// inclusion proofs, and the expected public inputs.
//
// It also re-computes the amount so callers can populate PublicInputs.AmountClaim
// — the guest will assert equality, so mismatches are caught at proving time.
func BuildPublisherWitness(
	archive *types.EpochArchive,
	publisher types.Address,
) (*types.Witness, error) {
	tree, err := BuildTree(archive.Leaves)
	if err != nil {
		return nil, err
	}
	// Verify the archive root is still consistent — catches archive tampering.
	if tree.Root() != archive.LogRoot {
		return nil, fmt.Errorf("archive integrity check failed: recomputed root != stored root")
	}

	// Index the rate card for O(1) lookup.
	rates := make(map[types.Bytes32]*big.Int, len(archive.RateCard))
	for _, r := range archive.RateCard {
		v, ok := new(big.Int).SetString(r.CpmMicroUSDC, 10)
		if !ok {
			return nil, fmt.Errorf("rate card: bad decimal %q for campaign %x", r.CpmMicroUSDC, r.CampaignID)
		}
		rates[r.CampaignID] = v
	}

	var (
		events = make([]types.ProvenEvent, 0)
		total  = new(big.Int)
		thou   = big.NewInt(1000)
	)
	for i, leaf := range archive.Leaves {
		if leaf.Publisher != publisher {
			continue
		}
		cpm, ok := rates[leaf.CampaignID]
		if !ok {
			return nil, fmt.Errorf("impression references campaign %x not in rate card", leaf.CampaignID)
		}

		siblings, dirs, err := tree.Proof(i)
		if err != nil {
			return nil, fmt.Errorf("proof for leaf %d: %w", i, err)
		}
		events = append(events, types.ProvenEvent{
			Event:    leaf,
			Path:     siblings,
			PathDirs: dirs,
		})

		// Same math as the guest: per-impression atomic USDC = cpm_micro_usdc / 1000.
		contrib := new(big.Int).Quo(cpm, thou)
		total.Add(total, contrib)
	}

	if len(events) == 0 {
		return nil, fmt.Errorf("publisher %x has no impressions in epoch %d", publisher, archive.EpochID)
	}

	return &types.Witness{
		Public: types.PublicInputs{
			EpochID:     archive.EpochID,
			Publisher:   publisher,
			AmountClaim: total.String(),
			LogRoot:     archive.LogRoot,
			Currency:    archive.Currency,
		},
		Events:   events,
		RateCard: archive.RateCard,
	}, nil
}

// validateRateCard ensures every campaign referenced by an impression has an
// entry. Missing rates would cause the guest to panic, which we'd rather catch
// before spending ~minutes on a failed proving run.
func validateRateCard(rateCard []types.RateCardEntry, imps []types.ImpressionEvent) error {
	have := make(map[types.Bytes32]bool, len(rateCard))
	for _, r := range rateCard {
		if _, ok := new(big.Int).SetString(r.CpmMicroUSDC, 10); !ok {
			return fmt.Errorf("campaign %x has invalid cpm %q", r.CampaignID, r.CpmMicroUSDC)
		}
		have[r.CampaignID] = true
	}
	for _, e := range imps {
		if !have[e.CampaignID] {
			return fmt.Errorf("campaign %x referenced by impression has no rate card entry", e.CampaignID)
		}
	}
	return nil
}
