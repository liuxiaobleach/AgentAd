package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"

	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/db"
)

// RunSimulation generates a mock bid request, runs all bidder agents, and settles the auction.
func (h *Handler) RunSimulation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// 1. Generate mock bid request
	bidReq := generateMockBidRequest()
	arDB, err := h.Queries.CreateAuctionRequest(ctx, bidReq)
	if err != nil {
		writeError(w, 500, "Failed to create auction request: "+err.Error())
		return
	}

	// Return 202 immediately, run auction in background
	go h.runAuctionInBackground(arDB)

	writeJSON(w, 202, map[string]interface{}{
		"auctionRequestId": arDB.ID,
		"status":           "RUNNING",
		"message":          "Auction started. Poll /api/auctions/{id} for results.",
	})
}

func (h *Handler) runAuctionInBackground(arDB db.AuctionRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 180000000000) // 3 min
	defer cancel()

	log.Printf("[auction] request=%s slot=%s type=%s", arDB.ID, arDB.SlotID, arDB.SlotType)

	// 2. Get all active bidder agents
	agents, err := h.Queries.GetAllActiveBidderAgents(ctx)
	if err != nil {
		log.Printf("[auction] failed to get agents: %v", err)
		return
	}

	var allBids []db.AuctionBid

	// 3. For each agent, get approved creatives + profiles, then call bidder
	for _, agent := range agents {
		creatives, err := h.Queries.GetApprovedCreativesByAdvertiser(ctx, agent.AdvertiserID)
		if err != nil || len(creatives) == 0 {
			log.Printf("[auction] agent=%s no approved creatives", agent.ID)
			continue
		}

		// Build candidate list with profiles and stats
		var candidates []audit.CandidateCreative
		for _, c := range creatives {
			cc := audit.CandidateCreative{
				CreativeID:   c.ID,
				CreativeName: c.CreativeName,
			}

			// Try to get profile
			profile, err := h.Queries.GetCreativeProfile(ctx, c.ID)
			if err == nil {
				profileMap := map[string]interface{}{
					"marketingSummary": profile.MarketingSummary,
					"visualTags":      profile.VisualTags,
					"ctaType":         profile.CtaType,
					"targetAudiences": profile.TargetAudiences,
				}
				if profile.PlacementFit != nil {
					var pf interface{}
					json.Unmarshal(profile.PlacementFit, &pf)
					profileMap["placementFit"] = pf
				}
				if profile.PredictedCtrPriors != nil {
					var pc interface{}
					json.Unmarshal(profile.PredictedCtrPriors, &pc)
					profileMap["predictedCtrPriors"] = pc
				}
				cc.Profile = profileMap
			}

			// Get stats
			impr, clicks, _ := h.Queries.GetCreativeStats(ctx, c.ID)
			if impr > 0 {
				cc.RecentStats = map[string]interface{}{
					"impressions": impr,
					"clicks":      clicks,
					"ctr":         float64(clicks) / float64(impr),
				}
			}

			candidates = append(candidates, cc)
		}

		if len(candidates) == 0 {
			continue
		}

		strategyPrompt := ""
		if agent.StrategyPrompt != nil {
			strategyPrompt = *agent.StrategyPrompt
		}
		siteCat := ""
		if arDB.SiteCategory != nil {
			siteCat = *arDB.SiteCategory
		}

		bidInput := audit.BidderInput{
			AgentID:        agent.ID,
			AdvertiserID:   agent.AdvertiserID,
			Strategy:       agent.Strategy,
			StrategyPrompt: strategyPrompt,
			ValuePerClick:  agent.ValuePerClick,
			MaxBidCpm:      agent.MaxBidCpm,
			BidRequest: audit.BidRequestInfo{
				SlotID:       arDB.SlotID,
				SlotType:     arDB.SlotType,
				Size:         arDB.Size,
				FloorCpm:     arDB.FloorCpm,
				SiteCategory: siteCat,
				UserSegments: arDB.UserSegments,
			},
			Candidates: candidates,
		}

		bidResult, err := audit.RunBidderAgent(ctx, h.Config.AnthropicAPIKey, h.Config.AuditModel, bidInput)
		if err != nil {
			log.Printf("[auction] agent=%s bid failed: %v", agent.ID, err)
			continue
		}

		log.Printf("[auction] agent=%s participate=%v creative=%s bid=%.2f",
			agent.ID, bidResult.Participate, bidResult.SelectedCreativeID, bidResult.BidCpm)

		// Save bid
		bidDB := db.AuctionBid{
			AuctionRequestID: arDB.ID,
			BidderAgentID:    agent.ID,
		}
		if bidResult.Participate {
			bidDB.SelectedCreativeID = &bidResult.SelectedCreativeID
			bidDB.PredictedCtr = &bidResult.PredictedCtr
			bidDB.BidCpm = &bidResult.BidCpm
			bidDB.Confidence = &bidResult.Confidence
			bidDB.Reason = &bidResult.Reason
		} else {
			reason := bidResult.Reason
			bidDB.Reason = &reason
		}
		saved, err := h.Queries.CreateAuctionBid(ctx, bidDB)
		if err != nil {
			log.Printf("[auction] save bid failed: %v", err)
			continue
		}
		if bidResult.Participate {
			allBids = append(allBids, saved)
		}
	}

	// 4. Run second-price auction
	result := db.AuctionResult{AuctionRequestID: arDB.ID}

	if len(allBids) == 0 {
		// No participants
		result.Clicked = false
		_, _ = h.Queries.CreateAuctionResult(ctx, result)
		log.Printf("[auction] request=%s no bids", arDB.ID)
		return
	}

	// Sort by bid CPM descending (find top 2)
	var bestIdx, secondBestIdx int
	var bestBid, secondBestBid float64
	for i, b := range allBids {
		if b.BidCpm != nil && *b.BidCpm > bestBid {
			secondBestBid = bestBid
			secondBestIdx = bestIdx
			bestBid = *b.BidCpm
			bestIdx = i
		} else if b.BidCpm != nil && *b.BidCpm > secondBestBid {
			secondBestBid = *b.BidCpm
			secondBestIdx = i
		}
	}
	_ = secondBestIdx

	winner := allBids[bestIdx]
	result.WinnerBidID = &winner.ID
	result.ShownCreativeID = winner.SelectedCreativeID

	// Second-price settlement
	settlement := secondBestBid
	if settlement < arDB.FloorCpm {
		settlement = arDB.FloorCpm
	}
	if len(allBids) == 1 {
		settlement = arDB.FloorCpm
	}
	result.SettlementPrice = &settlement

	// Simulate click (simple probability based on predicted CTR)
	if winner.PredictedCtr != nil {
		result.Clicked = rand.Float64() < *winner.PredictedCtr
	}

	_, _ = h.Queries.CreateAuctionResult(ctx, result)
	log.Printf("[auction] request=%s winner=%s settlement=%.2f clicked=%v",
		arDB.ID, winner.BidderAgentID, settlement, result.Clicked)
}

func generateMockBidRequest() db.AuctionRequest {
	slotTypes := []struct {
		slotType string
		size     string
	}{
		{"mobile-banner", "320x50"},
		{"desktop-rectangle", "300x250"},
		{"desktop-leaderboard", "728x90"},
		{"native-feed", "600x400"},
	}
	categories := []string{"news", "defi", "nft", "gaming", "exchange", "social"}
	segments := [][]string{
		{"wallet-user", "defi-trader"},
		{"nft-collector", "gaming-enthusiast"},
		{"airdrop-interested", "wallet-user"},
		{"crypto-newbie"},
		{"defi-trader", "yield-farmer"},
	}

	slot := slotTypes[rand.Intn(len(slotTypes))]
	cat := categories[rand.Intn(len(categories))]
	seg := segments[rand.Intn(len(segments))]
	floor := 2.0 + rand.Float64()*8.0 // 2-10 CPM

	return db.AuctionRequest{
		SlotID:       fmt.Sprintf("slot_%03d", rand.Intn(100)),
		SlotType:     slot.slotType,
		Size:         slot.size,
		FloorCpm:     float64(int(floor*100)) / 100,
		SiteCategory: &cat,
		UserSegments: seg,
	}
}
