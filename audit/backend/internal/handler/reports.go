package handler

import (
	"net/http"
	"strconv"

	"github.com/zkdsp/audit-backend/internal/db"
)

// GetHourlyReport returns hourly aggregates for the current advertiser over
// the last N hours (default 24, max 168 = 7 days).
func (h *Handler) GetHourlyReport(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())

	hours := 24
	if q := r.URL.Query().Get("hours"); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			if n < 1 {
				n = 1
			}
			if n > 168 {
				n = 168
			}
			hours = n
		}
	}

	buckets, err := h.Queries.GetHourlyReport(r.Context(), claims.AdvertiserID, hours)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if buckets == nil {
		buckets = []db.HourlyReportBucket{}
	}
	writeJSON(w, 200, buckets)
}
