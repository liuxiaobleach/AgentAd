package handler

import (
	"context"
	"log"
	"net/http"

	"github.com/zkdsp/audit-backend/internal/audit"
)

// GetPerformanceStats returns raw performance data for the current advertiser.
func (h *Handler) GetPerformanceStats(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())

	agentStats, err := h.Queries.GetAgentPerformanceStats(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	creativeStats, err := h.Queries.GetCreativePerformanceStats(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	// Get recent records for each agent
	recentByAgent := map[string]interface{}{}
	for _, a := range agentStats {
		records, _ := h.Queries.GetRecentAuctionRecords(r.Context(), a.AgentID, 20)
		recentByAgent[a.AgentID] = records
	}

	writeJSON(w, 200, map[string]interface{}{
		"agentStats":    agentStats,
		"creativeStats": creativeStats,
		"recentRecords": recentByAgent,
	})
}

// RunAnalysis triggers the analyst agent to generate insights.
// Returns 202 immediately, the analysis runs async, client polls via GET.
func (h *Handler) RunAnalysis(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())

	// Gather data
	agentStats, _ := h.Queries.GetAgentPerformanceStats(r.Context(), claims.AdvertiserID)
	creativeStats, _ := h.Queries.GetCreativePerformanceStats(r.Context(), claims.AdvertiserID)

	recentByAgent := map[string]interface{}{}
	var currentConfig []interface{}
	for _, a := range agentStats {
		records, _ := h.Queries.GetRecentAuctionRecords(r.Context(), a.AgentID, 20)
		recentByAgent[a.AgentName] = records

		agent, _ := h.Queries.GetBidderAgent(r.Context(), a.AgentID)
		currentConfig = append(currentConfig, map[string]interface{}{
			"name":          agent.Name,
			"strategy":      agent.Strategy,
			"valuePerClick": agent.ValuePerClick,
			"maxBidCpm":     agent.MaxBidCpm,
		})
	}

	// Run async
	resultCh := make(chan *audit.AnalystOutput, 1)
	errCh := make(chan error, 1)

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 120_000_000_000) // 2 min
		defer cancel()

		log.Printf("[analyst] advertiser=%s start", claims.AdvertiserID)

		out, err := audit.RunAnalystAgent(ctx, h.Config.AnthropicAPIKey, h.Config.AuditModel, audit.AnalystInput{
			AdvertiserName: claims.Name,
			AgentStats:     agentStats,
			CreativeStats:  creativeStats,
			RecentRecords:  recentByAgent,
			CurrentConfig:  currentConfig,
		})
		if err != nil {
			log.Printf("[analyst] advertiser=%s error: %v", claims.AdvertiserID, err)
			errCh <- err
			return
		}
		log.Printf("[analyst] advertiser=%s done (score=%d)", claims.AdvertiserID, out.PerformanceScore)
		resultCh <- out
	}()

	// Wait for result (analyst is text-only, usually fast ~10s)
	select {
	case out := <-resultCh:
		writeJSON(w, 200, out)
	case err := <-errCh:
		writeError(w, 500, "Analysis failed: "+err.Error())
	case <-r.Context().Done():
		writeError(w, 504, "Request timeout")
	}
}
