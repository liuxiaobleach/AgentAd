package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/zkdsp/audit-backend/internal/db"
)

// CRUD for the per-advertiser strategy-template and agent-skill library.
// All routes are scoped to the caller's advertiser via JWT claims.

type templateBody struct {
	Name          string   `json:"name"`
	Icon          string   `json:"icon"`
	Description   string   `json:"description"`
	Prompt        string   `json:"prompt"`
	ValuePerClick *float64 `json:"valuePerClick"`
	MaxBidCpm     *float64 `json:"maxBidCpm"`
}

func (b *templateBody) normalize() {
	b.Name = strings.TrimSpace(b.Name)
	b.Icon = strings.TrimSpace(b.Icon)
	b.Description = strings.TrimSpace(b.Description)
	b.Prompt = strings.TrimSpace(b.Prompt)
}

func (b *templateBody) validate() string {
	if b.Name == "" {
		return "Name is required"
	}
	if len([]rune(b.Name)) > 60 {
		return "Name must be <= 60 characters"
	}
	if len([]rune(b.Icon)) > 8 {
		return "Icon must be <= 8 characters"
	}
	if len([]rune(b.Description)) > 280 {
		return "Description must be <= 280 characters"
	}
	if b.Prompt == "" {
		return "Prompt is required"
	}
	if len([]rune(b.Prompt)) > 2000 {
		return "Prompt must be <= 2000 characters"
	}
	if b.ValuePerClick != nil && *b.ValuePerClick < 0 {
		return "valuePerClick must be >= 0"
	}
	if b.MaxBidCpm != nil && *b.MaxBidCpm < 0 {
		return "maxBidCpm must be >= 0"
	}
	return ""
}

func (h *Handler) ListStrategyTemplates(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	items, err := h.Queries.ListStrategyTemplates(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if items == nil {
		items = []db.BidderStrategyTemplate{}
	}
	writeJSON(w, 200, items)
}

func (h *Handler) CreateStrategyTemplate(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	var body templateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.CreateStrategyTemplate(r.Context(), db.BidderStrategyTemplate{
		AdvertiserID:  claims.AdvertiserID,
		Name:          body.Name,
		Icon:          body.Icon,
		Description:   body.Description,
		Prompt:        body.Prompt,
		ValuePerClick: body.ValuePerClick,
		MaxBidCpm:     body.MaxBidCpm,
	})
	if err != nil {
		writeError(w, 500, "Failed to create template: "+err.Error())
		return
	}
	writeJSON(w, 201, out)
}

func (h *Handler) UpdateStrategyTemplate(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	var body templateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.UpdateStrategyTemplate(r.Context(), id, claims.AdvertiserID, db.BidderStrategyTemplate{
		Name:          body.Name,
		Icon:          body.Icon,
		Description:   body.Description,
		Prompt:        body.Prompt,
		ValuePerClick: body.ValuePerClick,
		MaxBidCpm:     body.MaxBidCpm,
	})
	if err != nil {
		writeError(w, 404, "Template not found")
		return
	}
	writeJSON(w, 200, out)
}

func (h *Handler) DeleteStrategyTemplate(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Queries.DeleteStrategyTemplate(r.Context(), id, claims.AdvertiserID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted", "id": id})
}

type skillBody struct {
	Name          string `json:"name"`
	Icon          string `json:"icon"`
	Description   string `json:"description"`
	PromptSnippet string `json:"promptSnippet"`
}

func (b *skillBody) normalize() {
	b.Name = strings.TrimSpace(b.Name)
	b.Icon = strings.TrimSpace(b.Icon)
	b.Description = strings.TrimSpace(b.Description)
	b.PromptSnippet = strings.TrimSpace(b.PromptSnippet)
}

func (b *skillBody) validate() string {
	if b.Name == "" {
		return "Name is required"
	}
	if len([]rune(b.Name)) > 60 {
		return "Name must be <= 60 characters"
	}
	if len([]rune(b.Icon)) > 8 {
		return "Icon must be <= 8 characters"
	}
	if len([]rune(b.Description)) > 280 {
		return "Description must be <= 280 characters"
	}
	if b.PromptSnippet == "" {
		return "Prompt snippet is required"
	}
	if len([]rune(b.PromptSnippet)) > 1000 {
		return "Prompt snippet must be <= 1000 characters"
	}
	return ""
}

func (h *Handler) ListAgentSkills(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	items, err := h.Queries.ListAgentSkills(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if items == nil {
		items = []db.BidderAgentSkill{}
	}
	writeJSON(w, 200, items)
}

func (h *Handler) CreateAgentSkill(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	var body skillBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.CreateAgentSkill(r.Context(), db.BidderAgentSkill{
		AdvertiserID:  claims.AdvertiserID,
		Name:          body.Name,
		Icon:          body.Icon,
		Description:   body.Description,
		PromptSnippet: body.PromptSnippet,
	})
	if err != nil {
		writeError(w, 500, "Failed to create skill: "+err.Error())
		return
	}
	writeJSON(w, 201, out)
}

func (h *Handler) UpdateAgentSkill(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	var body skillBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.UpdateAgentSkill(r.Context(), id, claims.AdvertiserID, db.BidderAgentSkill{
		Name:          body.Name,
		Icon:          body.Icon,
		Description:   body.Description,
		PromptSnippet: body.PromptSnippet,
	})
	if err != nil {
		writeError(w, 404, "Skill not found")
		return
	}
	writeJSON(w, 200, out)
}

func (h *Handler) DeleteAgentSkill(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Queries.DeleteAgentSkill(r.Context(), id, claims.AdvertiserID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted", "id": id})
}
