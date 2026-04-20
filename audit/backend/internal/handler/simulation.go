package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sort"
	"sync"

	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/db"
)

// Billing constants for auction settlement.
const (
	// USDC has 6 decimals.
	usdcDecimals = 6
	usdcUnit     = int64(1_000_000)
)

// settlementImpressionAtomic returns how many USDC atomic units a single
// impression costs, given a second-price settlement in CPM.
// settlement is price per 1000 impressions, so single impression fee = cpm / 1000.
func settlementImpressionAtomic(settlementCpm float64) int64 {
	if settlementCpm <= 0 {
		return 0
	}
	// cpm / 1000 * 1e6 = cpm * 1000
	return int64(settlementCpm * 1000)
}

// valuePerClickAtomic converts the agent's advertiser-configured click value
// (USDC float) into atomic units. This is captured on every real click.
func valuePerClickAtomic(valuePerClick float64) int64 {
	if valuePerClick <= 0 {
		return 0
	}
	return int64(valuePerClick * float64(usdcUnit))
}

// RunSimulation generates a mock bid request, runs all bidder agents, and settles the auction.
func (h *Handler) RunSimulation(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	bidReq := generateMockBidRequest()
	arDB, err := h.Queries.CreateAuctionRequest(ctx, bidReq)
	if err != nil {
		writeError(w, 500, "Failed to create auction request: "+err.Error())
		return
	}

	go h.runAuctionInBackground(arDB)

	writeJSON(w, 202, map[string]interface{}{
		"auctionRequestId": arDB.ID,
		"status":           "RUNNING",
		"message":          "Auction started. Poll /api/auctions/{id} for results.",
	})
}

// agentBidContext carries the runtime info we need to settle one agent's bid.
type agentBidContext struct {
	agent db.BidderAgent
	bid   db.AuctionBid
}

func (h *Handler) runAuctionInBackground(arDB db.AuctionRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 180000000000) // 3 min
	defer cancel()

	log.Printf("[auction] request=%s slot=%s type=%s floor=%.2f",
		arDB.ID, arDB.SlotID, arDB.SlotType, arDB.FloorCpm)

	agents, err := h.Queries.GetAllActiveBidderAgents(ctx)
	if err != nil {
		log.Printf("[auction] failed to get agents: %v", err)
		return
	}

	// Fan out: each agent's bid loop (including the LLM call) runs concurrently.
	// Latency is now max(per-agent) instead of sum(per-agent). The critical
	// section is just the append to bidContexts at the end of each goroutine.
	var (
		bidContexts []agentBidContext
		mu          sync.Mutex
		wg          sync.WaitGroup
	)

	for _, agent := range agents {
		wg.Add(1)
		go func(agent db.BidderAgent) {
			defer wg.Done()
			bc, ok := h.runSingleAgentBid(ctx, arDB, agent)
			if !ok {
				return
			}
			mu.Lock()
			bidContexts = append(bidContexts, bc)
			mu.Unlock()
		}(agent)
	}
	wg.Wait()

	// Dedup self-competition: if an advertiser runs multiple agents, only the
	// highest-confidence bid from that advertiser participates in the auction.
	// Without this, the advertiser's own sibling agent's bid can become the
	// second-price anchor and artificially lift their own settlement price.
	// Losing sibling bids are still saved to the DB for transparency.
	bidContexts = dedupeSameAdvertiserBids(bidContexts)

	// Settle: sort all participating bids DESC by bid_cpm, then try each in
	// order until one successfully reserves its impression fee. Losers just
	// stay as losing bids. No participant -> no-fill result.
	result := db.AuctionResult{AuctionRequestID: arDB.ID}
	if len(bidContexts) == 0 {
		result.Clicked = false
		_, _ = h.Queries.CreateAuctionResult(ctx, result)
		log.Printf("[auction] request=%s no bids", arDB.ID)
		return
	}

	sort.SliceStable(bidContexts, func(i, j int) bool {
		bi := bidContexts[i].bid.BidCpm
		bj := bidContexts[j].bid.BidCpm
		if bi == nil {
			return false
		}
		if bj == nil {
			return true
		}
		return *bi > *bj
	})

	h.settleAuctionWithFallback(ctx, arDB, bidContexts, &result)
	_, _ = h.Queries.CreateAuctionResult(ctx, result)
	log.Printf("[auction] request=%s winner=%v settlement=%v clicked=%v",
		arDB.ID, result.WinnerBidID, result.SettlementPrice, result.Clicked)
}

// runSingleAgentBid executes one agent's bid flow: pre-bid guardrails, creative
// selection, LLM bid, clamp-to-max, floor check, persist. Returns (ctx, true)
// if the agent is a live participant for the auction; (_, false) otherwise.
// Safe to call concurrently from multiple goroutines — each invocation only
// writes its own bid row, and CreateAuctionBid uses its own DB transaction.
func (h *Handler) runSingleAgentBid(
	ctx context.Context,
	arDB db.AuctionRequest,
	agent db.BidderAgent,
) (agentBidContext, bool) {
	// L3: Pre-bid balance + budget guardrails. Skip agents that cannot
	// afford even the floor-price impression.
	if !h.agentMayBid(ctx, agent, arDB.FloorCpm) {
		h.recordSkippedBid(ctx, arDB.ID, agent.ID, "insufficient balance or budget")
		return agentBidContext{}, false
	}

	creatives, err := h.Queries.GetApprovedCreativesByAdvertiser(ctx, agent.AdvertiserID)
	if err != nil || len(creatives) == 0 {
		log.Printf("[auction] agent=%s no approved creatives", agent.ID)
		return agentBidContext{}, false
	}

	candidates := buildCandidateCreatives(ctx, h, creatives)
	if len(candidates) == 0 {
		return agentBidContext{}, false
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

	bidResult, err := audit.RunBidderAgent(ctx, h.Config.AnthropicAPIKey, h.Config.BidderModel, bidInput, h.Queries)
	if err != nil {
		log.Printf("[auction] agent=%s bid failed: %v", agent.ID, err)
		return agentBidContext{}, false
	}

	// L1: Hard clamp bid to agent.MaxBidCpm.
	if bidResult.Participate && bidResult.BidCpm > agent.MaxBidCpm {
		log.Printf("[auction] agent=%s bid clamped %.2f -> %.2f (max_bid_cpm)",
			agent.ID, bidResult.BidCpm, agent.MaxBidCpm)
		bidResult.BidCpm = agent.MaxBidCpm
	}
	if bidResult.Participate && bidResult.BidCpm < arDB.FloorCpm {
		log.Printf("[auction] agent=%s bid %.2f below floor %.2f, skipped",
			agent.ID, bidResult.BidCpm, arDB.FloorCpm)
		bidResult.Participate = false
		bidResult.Reason = fmt.Sprintf("bid %.2f below floor %.2f", bidResult.BidCpm, arDB.FloorCpm)
	}

	log.Printf("[auction] agent=%s participate=%v creative=%s bid=%.2f",
		agent.ID, bidResult.Participate, bidResult.SelectedCreativeID, bidResult.BidCpm)

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
		return agentBidContext{}, false
	}
	if !bidResult.Participate {
		return agentBidContext{}, false
	}
	return agentBidContext{agent: agent, bid: saved}, true
}

// settleAuctionWithFallback walks sorted bids and tries to reserve the
// impression fee for each in turn. First successful reservation wins and
// settles at the second-highest remaining price (or floor).
//
// Failure modes handled:
//   - winner's advertiser balance too low  -> fall through to next bidder
//   - hourly/daily budget exceeded         -> fall through to next bidder
//
// If all candidates fail, the auction becomes a no-fill (nil winner).
func (h *Handler) settleAuctionWithFallback(
	ctx context.Context,
	arDB db.AuctionRequest,
	sortedBids []agentBidContext,
	result *db.AuctionResult,
) {
	for i, bc := range sortedBids {
		// Second-price rule with fallback in mind: settlement price is the
		// next *eligible* candidate's bid, or the floor if there isn't one.
		// When we skip a higher bidder due to insufficient balance, the new
		// winner settles against the bidder immediately below them in the
		// remaining list — NOT against the skipped bidder's price.
		settlementCpm := arDB.FloorCpm
		if i+1 < len(sortedBids) && sortedBids[i+1].bid.BidCpm != nil {
			if *sortedBids[i+1].bid.BidCpm > settlementCpm {
				settlementCpm = *sortedBids[i+1].bid.BidCpm
			}
		}

		impressionAtomic := settlementImpressionAtomic(settlementCpm)
		if impressionAtomic <= 0 {
			continue
		}

		// Also re-check the budget windows right before reservation — the
		// L3 pre-check was a snapshot taken before the LLM call, and other
		// concurrent auctions may have consumed budget since.
		if !h.agentMayBid(ctx, bc.agent, settlementCpm) {
			log.Printf("[auction] agent=%s budget exhausted during settlement, falling through", bc.agent.ID)
			continue
		}

		meta := map[string]interface{}{
			"auctionRequestId":    arDB.ID,
			"bidId":               bc.bid.ID,
			"agentId":             bc.agent.ID,
			"settlementCpm":       settlementCpm,
			"impressionAtomic":    impressionAtomic,
			"event":               "auction_impression",
		}
		reservation, err := h.reserveSpend(
			ctx,
			bc.agent.AdvertiserID,
			"auction_impression",
			&bc.bid.ID,
			impressionAtomic,
			0,
			meta,
		)
		if err != nil {
			if errors.Is(err, db.ErrInsufficientBalance) {
				log.Printf("[auction] agent=%s advertiser=%s insufficient balance for %d atomic, falling through",
					bc.agent.ID, bc.agent.AdvertiserID, impressionAtomic)
				continue
			}
			log.Printf("[auction] reserve failed agent=%s err=%v, falling through", bc.agent.ID, err)
			continue
		}

		// Capture immediately — impression is happening now.
		h.settleReservation(ctx, reservation.ID, true, db.SpendReservationStatusSettled)

		if err := h.Queries.IncrementBidderAgentSpend(ctx, bc.agent.ID, impressionAtomic); err != nil {
			log.Printf("[auction] update spend window failed agent=%s err=%v", bc.agent.ID, err)
		}

		// Credit the publisher for this impression.
		h.creditPublisher(ctx, arDB.SlotID, "impression", &arDB.ID, &bc.bid.ID, impressionAtomic)

		result.WinnerBidID = &bc.bid.ID
		result.ShownCreativeID = bc.bid.SelectedCreativeID
		result.SettlementPrice = &settlementCpm

		// Probabilistic click simulation for the RunSimulation endpoint path.
		// Real publisher-driven clicks come through TrackAdClick and are
		// settled there separately.
		if bc.bid.PredictedCtr != nil {
			if rand.Float64() < *bc.bid.PredictedCtr {
				result.Clicked = true
				h.chargeClick(ctx, bc.agent, arDB.ID, bc.bid.ID, arDB.SlotID)
			}
		}
		return
	}
	log.Printf("[auction] request=%s all bidders failed settlement, no-fill", arDB.ID)
}

// chargeClick captures value_per_click from the advertiser. Safe to call
// more than once per click if the caller deduplicates upstream (currently we
// trust MarkAuctionClicked to be called once per auction).
func (h *Handler) chargeClick(ctx context.Context, agent db.BidderAgent, auctionID, bidID, slotID string) {
	clickAtomic := valuePerClickAtomic(agent.ValuePerClick)
	if clickAtomic <= 0 {
		return
	}
	meta := map[string]interface{}{
		"auctionRequestId": auctionID,
		"bidId":            bidID,
		"agentId":          agent.ID,
		"clickAtomic":      clickAtomic,
		"event":            "auction_click",
	}
	reservation, err := h.reserveSpend(
		ctx,
		agent.AdvertiserID,
		"auction_click",
		&bidID,
		clickAtomic,
		0,
		meta,
	)
	if err != nil {
		// Click already happened; even if balance is gone we just log and
		// move on. Deducting more than the on-chain budget is impossible by
		// reservation design, so this is graceful degradation.
		log.Printf("[auction] click reserve failed agent=%s err=%v (click uncharged)", agent.ID, err)
		return
	}
	h.settleReservation(ctx, reservation.ID, true, db.SpendReservationStatusSettled)
	if err := h.Queries.IncrementBidderAgentSpend(ctx, agent.ID, clickAtomic); err != nil {
		log.Printf("[auction] click spend-window update failed agent=%s err=%v", agent.ID, err)
	}
	h.creditPublisher(ctx, slotID, "click", &auctionID, &bidID, clickAtomic)
}

// creditPublisher resolves which publisher owns this slot and credits them
// for the impression/click. Errors are logged but not propagated — the
// advertiser-side charge has already settled and the ad served, we don't want
// publisher bookkeeping to back-pressure ad delivery.
func (h *Handler) creditPublisher(
	ctx context.Context,
	slotID, eventType string,
	auctionID, bidID *string,
	amountAtomic int64,
) {
	if amountAtomic <= 0 || slotID == "" {
		return
	}
	publisherID, err := h.Queries.ResolvePublisherForSlot(ctx, slotID)
	if err != nil || publisherID == "" {
		log.Printf("[earnings] resolve publisher for slot=%s failed: %v", slotID, err)
		return
	}
	slot := slotID
	metadata := mustJSONRaw(map[string]interface{}{
		"auctionRequestId": auctionID,
		"bidId":            bidID,
		"slotId":           slot,
		"event":            eventType,
	})
	if _, err := h.Queries.CreatePublisherEarningEvent(
		ctx, publisherID, eventType, auctionID, bidID, &slot, amountAtomic, metadata,
	); err != nil {
		log.Printf("[earnings] credit publisher=%s slot=%s amount=%d failed: %v",
			publisherID, slot, amountAtomic, err)
	}
}

// agentMayBid answers: given the agent's caps and current-window spend, AND
// the advertiser's available USDC balance, can this agent pay at least one
// impression at the floor price? This is a fast pre-filter; settlement layer
// re-checks at the actual settlement price.
func (h *Handler) agentMayBid(ctx context.Context, agent db.BidderAgent, floorCpm float64) bool {
	// 1. Advertiser has spendable balance for at least one impression at floor.
	minImpressionAtomic := settlementImpressionAtomic(floorCpm)
	if minImpressionAtomic <= 0 {
		minImpressionAtomic = 1 // always require SOMETHING spendable
	}
	balance, err := h.Queries.GetAdvertiserBalance(ctx, agent.AdvertiserID)
	if err != nil {
		log.Printf("[auction] agent=%s balance lookup failed: %v", agent.ID, err)
		return false
	}
	if balance.SpendableAtomic < minImpressionAtomic {
		return false
	}

	// 2. Agent's own rolling window caps (0 = unlimited).
	if agent.HourlyBudgetAtomic > 0 || agent.DailyBudgetAtomic > 0 {
		hourly, daily, err := h.Queries.GetBidderAgentSpendWindows(ctx, agent.ID)
		if err != nil {
			log.Printf("[auction] agent=%s spend-window lookup failed: %v", agent.ID, err)
			return false
		}
		if agent.HourlyBudgetAtomic > 0 && hourly.SpentAtomic+minImpressionAtomic > agent.HourlyBudgetAtomic {
			return false
		}
		if agent.DailyBudgetAtomic > 0 && daily.SpentAtomic+minImpressionAtomic > agent.DailyBudgetAtomic {
			return false
		}
	}
	return true
}

// recordSkippedBid persists a non-participating bid so the advertiser can see
// why their agent didn't bid on this auction (in /auctions list).
func (h *Handler) recordSkippedBid(ctx context.Context, auctionID, agentID, reason string) {
	_, _ = h.Queries.CreateAuctionBid(ctx, db.AuctionBid{
		AuctionRequestID: auctionID,
		BidderAgentID:    agentID,
		Reason:           &reason,
	})
}

func buildCandidateCreatives(ctx context.Context, h *Handler, creatives []db.Creative) []audit.CandidateCreative {
	candidates := make([]audit.CandidateCreative, 0, len(creatives))
	for _, c := range creatives {
		cc := audit.CandidateCreative{
			CreativeID:   c.ID,
			CreativeName: c.CreativeName,
		}
		if profile, err := h.Queries.GetCreativeProfile(ctx, c.ID); err == nil {
			profileMap := map[string]interface{}{
				"marketingSummary": profile.MarketingSummary,
				"visualTags":       profile.VisualTags,
				"ctaType":          profile.CtaType,
				"targetAudiences":  profile.TargetAudiences,
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
	return candidates
}

// dedupeSameAdvertiserBids keeps only the highest-confidence bid per advertiser
// so an advertiser's multiple agents don't bid each other up. Tiebreaker when
// confidence is equal (or nil): higher bid_cpm wins; then earliest-saved id.
func dedupeSameAdvertiserBids(bids []agentBidContext) []agentBidContext {
	best := make(map[string]agentBidContext, len(bids))
	for _, bc := range bids {
		adv := bc.agent.AdvertiserID
		cur, ok := best[adv]
		if !ok {
			best[adv] = bc
			continue
		}
		if betterSiblingBid(bc, cur) {
			log.Printf("[auction] dedupe advertiser=%s keep agent=%s over agent=%s",
				adv, bc.agent.ID, cur.agent.ID)
			best[adv] = bc
		} else {
			log.Printf("[auction] dedupe advertiser=%s drop agent=%s (lost to agent=%s)",
				adv, bc.agent.ID, cur.agent.ID)
		}
	}
	out := make([]agentBidContext, 0, len(best))
	for _, v := range best {
		out = append(out, v)
	}
	return out
}

func betterSiblingBid(a, b agentBidContext) bool {
	ca := derefFloat(a.bid.Confidence)
	cb := derefFloat(b.bid.Confidence)
	if ca != cb {
		return ca > cb
	}
	ba := derefFloat(a.bid.BidCpm)
	bb := derefFloat(b.bid.BidCpm)
	if ba != bb {
		return ba > bb
	}
	return a.bid.ID < b.bid.ID
}

func derefFloat(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
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
