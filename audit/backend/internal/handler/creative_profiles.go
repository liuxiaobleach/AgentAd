package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) GetCreativeProfile(w http.ResponseWriter, r *http.Request) {
	creativeID := chi.URLParam(r, "creativeId")
	profile, err := h.Queries.GetCreativeProfile(r.Context(), creativeID)
	if err != nil {
		writeError(w, 404, "Creative profile not found")
		return
	}
	writeJSON(w, 200, profile)
}
