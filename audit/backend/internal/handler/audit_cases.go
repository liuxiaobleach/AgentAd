package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListAuditCases(w http.ResponseWriter, r *http.Request) {
	cases, err := h.Queries.ListAuditCases(r.Context())
	if err != nil {
		writeError(w, 500, "Failed to list audit cases: "+err.Error())
		return
	}
	writeJSON(w, 200, cases)
}

func (h *Handler) GetAuditCase(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ac, err := h.Queries.GetAuditCase(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Not found")
		return
	}
	writeJSON(w, 200, ac)
}

func (h *Handler) PatchAuditCase(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusGone, "Manual review has been removed. Audits are auto-approved.")
}
