package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

// ListAuctions returns a bid-centric feed scoped to the current advertiser:
// one row per bid made by any of the advertiser's agents (won or lost), with
// the auction context + outcome joined in. Bids that didn't participate are
// still stored in auction_bids (with null bid_cpm) and thus included.
func (h *Handler) ListAuctions(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	bids, err := h.Queries.ListBidsByAdvertiser(r.Context(), claims.AdvertiserID, 100)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if bids == nil {
		bids = []db.BidListRow{}
	}
	writeJSON(w, 200, bids)
}

func (h *Handler) GetAuction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	auction, err := h.Queries.GetAuctionRequestWithDetails(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Auction not found")
		return
	}
	writeJSON(w, 200, auction)
}
