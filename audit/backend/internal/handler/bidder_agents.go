package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

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
	id := chi.URLParam(r, "id")
	agent, err := h.Queries.GetBidderAgent(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Agent not found")
		return
	}
	writeJSON(w, 200, agent)
}

func (h *Handler) UpdateBidderAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
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
