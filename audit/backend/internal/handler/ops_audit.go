package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

// ListOpsAuditQueue returns manual-review audit cases for the ops console.
// Query params:
//   - status=pending|resolved|all (default: all)
//   - limit=int (default: 100, max: 500)
func (h *Handler) ListOpsAuditQueue(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsOps() {
		writeError(w, 403, "Ops reviewer role required")
		return
	}

	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "all" {
		status = ""
	}
	limit := 100
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}

	cases, err := h.Queries.ListOpsAuditQueue(r.Context(), db.OpsQueueFilter{
		Status: status,
		Limit:  limit,
	})
	if err != nil {
		writeError(w, 500, "Failed to list ops queue: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"items": cases,
		"count": len(cases),
	})
}

// GetOpsAuditCase returns the full audit-case detail (creative, evidences,
// agent thinking, prior reviewer, advertiser). Any ops user may read any case.
func (h *Handler) GetOpsAuditCase(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsOps() {
		writeError(w, 403, "Ops reviewer role required")
		return
	}

	id := chi.URLParam(r, "id")
	ac, err := h.Queries.GetOpsAuditCaseDetail(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Audit case not found")
		return
	}
	writeJSON(w, 200, ac)
}

// PatchOpsAuditCase applies a reviewer override. Accepts:
//
//	{ "decision": "PASS" | "REJECT", "notes": "..." }
//
// Flips the creative status, writes a review log, and (on PASS) triggers the
// same issueAttestationAndManifest helper the auto-approval flow uses, so a
// manually-approved case ends up with an on-chain attestation just like an
// auto-approved one.
func (h *Handler) PatchOpsAuditCase(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsOps() {
		writeError(w, 403, "Ops reviewer role required")
		return
	}

	id := chi.URLParam(r, "id")

	var body struct {
		Decision string `json:"decision"`
		Notes    string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}
	decision := db.AuditDecision(strings.ToUpper(strings.TrimSpace(body.Decision)))
	if decision != db.AuditDecisionPass && decision != db.AuditDecisionReject {
		writeError(w, 400, "decision must be PASS or REJECT")
		return
	}
	notes := strings.TrimSpace(body.Notes)
	if decision == db.AuditDecisionReject && notes == "" {
		writeError(w, 400, "notes are required when rejecting")
		return
	}

	result, err := h.Queries.ApplyOpsReview(r.Context(), db.ApplyOpsReviewInput{
		AuditCaseID: id,
		ReviewerID:  claims.OpsID,
		NewDecision: decision,
		Notes:       notes,
	})
	if err != nil {
		writeError(w, 500, "Failed to apply review: "+err.Error())
		return
	}
	if result.WasResolved {
		log.Printf("[ops] reviewer=%s re-reviewed case=%s (prev reviewer already set)",
			claims.OpsID, id)
	}

	// If we just approved the case and no attestation has been issued yet,
	// run the same issuance path as the auto-approval flow so manual
	// approvals end up on-chain.
	if decision == db.AuditDecisionPass {
		existing, _ := h.Queries.GetAuditCase(context.Background(), id)
		if existing.Attestation == nil {
			if err := h.issueAttestationAndManifest(context.Background(), id, result.Creative); err != nil {
				log.Printf("[ops] case=%s attestation issuance failed: %v", id, err)
			}
		}
	}

	writeJSON(w, 200, map[string]interface{}{
		"auditCase": result.Case,
		"logId":     result.LogID,
	})
}

// ListOpsReviewHistory returns the current reviewer's past actions.
func (h *Handler) ListOpsReviewHistory(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsOps() {
		writeError(w, 403, "Ops reviewer role required")
		return
	}
	limit := 100
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	logs, err := h.Queries.ListOpsReviewHistory(r.Context(), claims.OpsID, limit)
	if err != nil {
		writeError(w, 500, "Failed to list review history: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"items": logs,
		"count": len(logs),
	})
}
