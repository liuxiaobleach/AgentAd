package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/zkdsp/audit-backend/internal/db"
)

type BillingTopUpRequest struct {
	AmountAtomic int64  `json:"amountAtomic"`
	Description  string `json:"description"`
}

func (h *Handler) GetBillingBalance(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	balance, err := h.Queries.GetAdvertiserBalance(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to load balance: "+err.Error())
		return
	}

	writeJSON(w, 200, balance)
}

func (h *Handler) ListBillingLedger(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	limit := 25
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	entries, err := h.Queries.ListLedgerEntriesByAdvertiser(r.Context(), claims.AdvertiserID, limit)
	if err != nil {
		writeError(w, 500, "Failed to load ledger: "+err.Error())
		return
	}
	if len(entries) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("[]"))
		return
	}

	writeJSON(w, 200, entries)
}

func (h *Handler) CreateBillingTopUp(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	var req BillingTopUpRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}
	if req.AmountAtomic <= 0 {
		writeError(w, 400, "amountAtomic must be greater than 0")
		return
	}

	description := req.Description
	if description == "" {
		description = "Demo balance top-up"
	}

	metadata, _ := json.Marshal(map[string]interface{}{
		"source":       "demo_topup",
		"amountAtomic": req.AmountAtomic,
	})

	balance, err := h.Queries.CreateBalanceTopUp(
		r.Context(),
		claims.AdvertiserID,
		req.AmountAtomic,
		description,
		metadata,
	)
	if err != nil {
		writeError(w, 500, "Failed to top up balance: "+err.Error())
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"balance": balance,
	})
}

func mustJSONRaw(v interface{}) json.RawMessage {
	if v == nil {
		return nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return data
}

func (h *Handler) reserveSpend(
	ctx context.Context,
	advertiserID string,
	operationType string,
	operationRef *string,
	baseFeeAtomic int64,
	maxExternalSpendAtomic int64,
	metadata interface{},
) (db.SpendReservation, error) {
	return h.Queries.CreateSpendReservation(
		ctx,
		advertiserID,
		operationType,
		operationRef,
		baseFeeAtomic,
		maxExternalSpendAtomic,
		mustJSONRaw(metadata),
	)
}

func (h *Handler) writeInsufficientBalance(w http.ResponseWriter, ctx context.Context, advertiserID string, requiredAtomic int64) {
	resp := map[string]interface{}{
		"error":          "Insufficient balance. Please top up before starting this job.",
		"requiredAtomic": requiredAtomic,
		"billingUrl":     "/billing",
	}

	if balance, err := h.Queries.GetAdvertiserBalance(ctx, advertiserID); err == nil {
		resp["balance"] = balance
	}

	writeJSON(w, 402, resp)
}

func (h *Handler) settleReservation(ctx context.Context, reservationID string, captureBaseFee bool, status db.SpendReservationStatus) {
	if reservationID == "" {
		return
	}
	if _, err := h.Queries.FinalizeSpendReservation(ctx, reservationID, captureBaseFee, status); err != nil {
		log.Printf("[billing] finalize reservation=%s failed: %v", reservationID, err)
	}
}
