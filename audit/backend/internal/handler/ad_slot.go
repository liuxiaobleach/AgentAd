package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

type AdSlotRequest struct {
	SlotID       string   `json:"slotId"`
	SlotType     string   `json:"slotType"`
	Size         string   `json:"size"`
	FloorCpm     float64  `json:"floorCpm"`
	SiteCategory string   `json:"siteCategory"`
	UserSegments []string `json:"userSegments"`
	SiteDomain   string   `json:"siteDomain"`
}

// RequestAdSlot is a public endpoint (no auth) for publisher ad slots.
// It creates an auction, runs all bidder agents, and returns the auction ID.
func (h *Handler) RequestAdSlot(w http.ResponseWriter, r *http.Request) {
	var req AdSlotRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	if req.SlotType == "" {
		req.SlotType = "desktop-rectangle"
	}
	if req.Size == "" {
		req.Size = "300x250"
	}
	if req.SlotID == "" {
		req.SlotID = "test_slot_001"
	}

	siteCat := &req.SiteCategory
	if req.SiteCategory == "" {
		s := "general"
		siteCat = &s
	}

	arDB, err := h.Queries.CreateAuctionRequest(r.Context(), db.AuctionRequest{
		SlotID:       req.SlotID,
		SlotType:     req.SlotType,
		Size:         req.Size,
		FloorCpm:     req.FloorCpm,
		SiteCategory: siteCat,
		UserSegments: req.UserSegments,
	})
	if err != nil {
		writeError(w, 500, "Failed to create auction: "+err.Error())
		return
	}

	go h.runAuctionInBackground(arDB)

	writeJSON(w, 202, map[string]interface{}{
		"auctionId": arDB.ID,
		"status":    "RUNNING",
	})
}

// TrackAdClick is a public endpoint that marks an auction as clicked by a real user.
// Called from ad-test.html (or any publisher) when the ad is clicked.
func (h *Handler) TrackAdClick(w http.ResponseWriter, r *http.Request) {
	auctionID := chi.URLParam(r, "id")
	if auctionID == "" {
		writeError(w, 400, "Missing auction ID")
		return
	}
	if err := h.Queries.MarkAuctionClicked(r.Context(), auctionID); err != nil {
		writeError(w, 500, "Failed to record click: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true})
}

// GetAdSlotResult is a public endpoint to poll for auction result.
// Returns the winning creative info for rendering.
func (h *Handler) GetAdSlotResult(w http.ResponseWriter, r *http.Request) {
	auctionID := chi.URLParam(r, "id")
	ar, err := h.Queries.GetAuctionRequestWithDetails(r.Context(), auctionID)
	if err != nil {
		writeError(w, 404, "Auction not found")
		return
	}

	// Not finished yet
	if ar.Result == nil {
		writeJSON(w, 200, map[string]interface{}{
			"status":    "PENDING",
			"auctionId": ar.ID,
			"bidsCount": len(ar.Bids),
		})
		return
	}

	// Build response with winning creative details
	resp := map[string]interface{}{
		"status":          "COMPLETED",
		"auctionId":       ar.ID,
		"settlementPrice": ar.Result.SettlementPrice,
		"clicked":         ar.Result.Clicked,
		"bidsCount":       len(ar.Bids),
	}

	// Get winning creative info
	if ar.Result.ShownCreativeID != nil {
		creative, err := h.Queries.GetCreativeRaw(r.Context(), *ar.Result.ShownCreativeID)
		if err == nil {
			resp["creative"] = map[string]interface{}{
				"id":           creative.ID,
				"creativeName": creative.CreativeName,
				"projectName":  creative.ProjectName,
				"imageUrl":     creative.ImageURL,
				"landingUrl":   creative.LandingURL,
				"clickUrl":     creative.ClickURL,
			}
		}
	}

	// Include all bids for transparency
	var bids []map[string]interface{}
	for _, b := range ar.Bids {
		bid := map[string]interface{}{
			"agentName":    b.AgentName,
			"creativeName": b.CreativeName,
			"bidCpm":       b.BidCpm,
			"predictedCtr": b.PredictedCtr,
			"confidence":   b.Confidence,
			"reason":       b.Reason,
			"isWinner":     b.ID == *ar.Result.WinnerBidID,
		}
		bids = append(bids, bid)
	}
	resp["bids"] = bids

	writeJSON(w, 200, resp)
}
