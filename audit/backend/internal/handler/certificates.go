package handler

import "net/http"

func (h *Handler) ListCertificates(w http.ResponseWriter, r *http.Request) {
	certs, err := h.Queries.ListAttestations(r.Context())
	if err != nil {
		writeError(w, 500, "Failed to list certificates: "+err.Error())
		return
	}
	writeJSON(w, 200, certs)
}
