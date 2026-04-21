package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

type brandKitBody struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	VoiceTone      string   `json:"voiceTone"`
	PrimaryMessage string   `json:"primaryMessage"`
	ColorPalette   []string `json:"colorPalette"`
	MandatoryTerms []string `json:"mandatoryTerms"`
	BannedTerms    []string `json:"bannedTerms"`
	VisualRules    string   `json:"visualRules"`
	CtaPreferences string   `json:"ctaPreferences"`
	IsDefault      bool     `json:"isDefault"`
}

func trimList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		v := strings.TrimSpace(raw)
		if v == "" {
			continue
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}
	return out
}

func (b *brandKitBody) normalize() {
	b.Name = strings.TrimSpace(b.Name)
	b.Description = strings.TrimSpace(b.Description)
	b.VoiceTone = strings.TrimSpace(b.VoiceTone)
	b.PrimaryMessage = strings.TrimSpace(b.PrimaryMessage)
	b.ColorPalette = trimList(b.ColorPalette)
	b.MandatoryTerms = trimList(b.MandatoryTerms)
	b.BannedTerms = trimList(b.BannedTerms)
	b.VisualRules = strings.TrimSpace(b.VisualRules)
	b.CtaPreferences = strings.TrimSpace(b.CtaPreferences)
}

func (b *brandKitBody) validate() string {
	if b.Name == "" {
		return "Name is required"
	}
	if len([]rune(b.Name)) > 80 {
		return "Name must be <= 80 characters"
	}
	if len([]rune(b.Description)) > 280 {
		return "Description must be <= 280 characters"
	}
	if len([]rune(b.VoiceTone)) > 160 {
		return "Voice tone must be <= 160 characters"
	}
	if len([]rune(b.PrimaryMessage)) > 240 {
		return "Primary message must be <= 240 characters"
	}
	if len(b.ColorPalette) > 8 {
		return "Color palette can contain at most 8 entries"
	}
	if len(b.MandatoryTerms) > 12 {
		return "Mandatory terms can contain at most 12 entries"
	}
	if len(b.BannedTerms) > 12 {
		return "Banned terms can contain at most 12 entries"
	}
	if len([]rune(b.VisualRules)) > 1000 {
		return "Visual rules must be <= 1000 characters"
	}
	if len([]rune(b.CtaPreferences)) > 400 {
		return "CTA preferences must be <= 400 characters"
	}
	return ""
}

func toBrandKit(body brandKitBody, advertiserID string) db.BrandKit {
	return db.BrandKit{
		AdvertiserID:   advertiserID,
		Name:           body.Name,
		Description:    body.Description,
		VoiceTone:      body.VoiceTone,
		PrimaryMessage: body.PrimaryMessage,
		ColorPalette:   body.ColorPalette,
		MandatoryTerms: body.MandatoryTerms,
		BannedTerms:    body.BannedTerms,
		VisualRules:    body.VisualRules,
		CtaPreferences: body.CtaPreferences,
		IsDefault:      body.IsDefault,
	}
}

func (h *Handler) ListBrandKits(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	items, err := h.Queries.ListBrandKits(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if items == nil {
		items = []db.BrandKit{}
	}
	writeJSON(w, 200, items)
}

func (h *Handler) CreateBrandKit(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	var body brandKitBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.CreateBrandKit(r.Context(), toBrandKit(body, claims.AdvertiserID))
	if err != nil {
		writeError(w, 500, "Failed to create brand kit: "+err.Error())
		return
	}
	writeJSON(w, 201, out)
}

func (h *Handler) UpdateBrandKit(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	var body brandKitBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}
	out, err := h.Queries.UpdateBrandKit(r.Context(), id, claims.AdvertiserID, toBrandKit(body, claims.AdvertiserID))
	if err != nil {
		writeError(w, 404, "Brand kit not found")
		return
	}
	writeJSON(w, 200, out)
}

func (h *Handler) DeleteBrandKit(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.Queries.DeleteBrandKit(r.Context(), id, claims.AdvertiserID); err != nil {
		writeError(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted", "id": id})
}
