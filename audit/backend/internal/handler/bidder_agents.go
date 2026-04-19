package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

var validBidderStrategies = map[string]bool{
	"growth":       true,
	"balanced":     true,
	"conservative": true,
}

func (h *Handler) ListBidderAgents(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	agents, err := h.Queries.GetBidderAgentsByAdvertiser(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, agents)
}

func (h *Handler) GetBidderAgentDetail(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	id := chi.URLParam(r, "id")
	agent, err := h.Queries.GetBidderAgent(r.Context(), id)
	if err != nil || agent.AdvertiserID != claims.AdvertiserID {
		writeError(w, 404, "Agent not found")
		return
	}
	writeJSON(w, 200, agent)
}

type createBidderAgentRequest struct {
	Name               string  `json:"name"`
	Strategy           string  `json:"strategy"`
	StrategyPrompt     string  `json:"strategyPrompt"`
	ValuePerClick      float64 `json:"valuePerClick"`
	MaxBidCpm          float64 `json:"maxBidCpm"`
	DailyBudgetAtomic  int64   `json:"dailyBudgetAtomic"`
	HourlyBudgetAtomic int64   `json:"hourlyBudgetAtomic"`
}

func (h *Handler) CreateBidderAgent(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}

	var body createBidderAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Strategy = strings.TrimSpace(body.Strategy)
	body.StrategyPrompt = strings.TrimSpace(body.StrategyPrompt)

	if body.Name == "" {
		writeError(w, 400, "Name is required")
		return
	}
	if len([]rune(body.Name)) > 60 {
		writeError(w, 400, "Name must be <= 60 characters")
		return
	}
	if body.Strategy == "" {
		body.Strategy = "balanced"
	}
	if !validBidderStrategies[body.Strategy] {
		writeError(w, 400, "Strategy must be one of: growth, balanced, conservative")
		return
	}
	if body.ValuePerClick < 0 || body.MaxBidCpm < 0 {
		writeError(w, 400, "valuePerClick and maxBidCpm must be >= 0")
		return
	}
	if body.ValuePerClick == 0 {
		body.ValuePerClick = 1.0
	}
	if body.MaxBidCpm == 0 {
		body.MaxBidCpm = 50.0
	}
	if body.DailyBudgetAtomic < 0 || body.HourlyBudgetAtomic < 0 {
		writeError(w, 400, "Budget must be >= 0")
		return
	}
	if len([]rune(body.StrategyPrompt)) > 2000 {
		writeError(w, 400, "Strategy prompt must be <= 2000 characters")
		return
	}

	var prompt *string
	if body.StrategyPrompt != "" {
		prompt = &body.StrategyPrompt
	}

	agent, err := h.Queries.CreateBidderAgent(
		r.Context(),
		claims.AdvertiserID,
		body.Name,
		body.Strategy,
		prompt,
		body.ValuePerClick,
		body.MaxBidCpm,
		body.DailyBudgetAtomic,
		body.HourlyBudgetAtomic,
	)
	if err != nil {
		writeError(w, 500, "Failed to create agent: "+err.Error())
		return
	}
	writeJSON(w, 201, agent)
}

func (h *Handler) DeleteBidderAgent(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, 400, "id required")
		return
	}
	if err := h.Queries.DeleteBidderAgent(r.Context(), id, claims.AdvertiserID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted", "id": id})
}

func (h *Handler) UpdateBidderAgent(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	id := chi.URLParam(r, "id")
	existing, err := h.Queries.GetBidderAgent(r.Context(), id)
	if err != nil || existing.AdvertiserID != claims.AdvertiserID {
		writeError(w, 404, "Agent not found")
		return
	}
	var body struct {
		Strategy           string  `json:"strategy"`
		StrategyPrompt     string  `json:"strategyPrompt"`
		ValuePerClick      float64 `json:"valuePerClick"`
		MaxBidCpm          float64 `json:"maxBidCpm"`
		DailyBudgetAtomic  *int64  `json:"dailyBudgetAtomic,omitempty"`
		HourlyBudgetAtomic *int64  `json:"hourlyBudgetAtomic,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request")
		return
	}
	var prompt *string
	if body.StrategyPrompt != "" {
		prompt = &body.StrategyPrompt
	}
	if err := h.Queries.UpdateBidderAgent(r.Context(), id, body.Strategy, prompt, body.ValuePerClick, body.MaxBidCpm); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if body.DailyBudgetAtomic != nil || body.HourlyBudgetAtomic != nil {
		current, err := h.Queries.GetBidderAgent(r.Context(), id)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		daily := current.DailyBudgetAtomic
		hourly := current.HourlyBudgetAtomic
		if body.DailyBudgetAtomic != nil {
			daily = *body.DailyBudgetAtomic
		}
		if body.HourlyBudgetAtomic != nil {
			hourly = *body.HourlyBudgetAtomic
		}
		if err := h.Queries.UpdateBidderAgentBudget(r.Context(), id, daily, hourly); err != nil {
			writeError(w, 500, err.Error())
			return
		}
	}
	agent, _ := h.Queries.GetBidderAgent(r.Context(), id)
	writeJSON(w, 200, agent)
}
