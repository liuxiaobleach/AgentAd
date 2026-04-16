package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) GetManifest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	manifest, err := h.Queries.GetManifest(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Not found")
		return
	}
	// Return the raw manifest JSON directly
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write(manifest.ManifestJSON)
}
