package handler

import (
	"encoding/json"
	"math"
	"net/http"
	"time"
)

type VerifyRequest struct {
	AttestationID   string `json:"attestationId"`
	CreativeHash    string `json:"creativeHash"`
	DestinationHash string `json:"destinationHash"`
	Hostname        string `json:"hostname"`
}

type VerifyResponse struct {
	Status             string  `json:"status"`
	AttestationStatus  string  `json:"attestationStatus"`
	CreativeMatched    bool    `json:"creativeMatched"`
	DestinationMatched bool    `json:"destinationMatched"`
	DomainMatched      bool    `json:"domainMatched"`
	IssuedAt           *int64  `json:"issuedAt"`
	ExpiresAt          *int64  `json:"expiresAt"`
	ExplorerURL        *string `json:"explorerUrl"`
}

func (h *Handler) SDKVerify(w http.ResponseWriter, r *http.Request) {
	var req VerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}
	if req.AttestationID == "" {
		writeError(w, 400, "attestationId is required")
		return
	}

	att, creative, err := h.Queries.GetAttestationForVerify(r.Context(), req.AttestationID)
	if err != nil {
		writeJSON(w, 200, VerifyResponse{
			Status:            "unknown",
			AttestationStatus: "not_found",
		})
		return
	}

	// Check expiry
	attStatus := string(att.Status)
	if att.Status == "ACTIVE" && att.ExpiresAt != nil && att.ExpiresAt.Before(time.Now()) {
		attStatus = "EXPIRED"
	}

	// Check hash matches
	creativeMatched := true
	if req.CreativeHash != "" && creative.CreativeHash != nil {
		creativeMatched = *creative.CreativeHash == req.CreativeHash
	}
	destinationMatched := true

	// Check domain
	domainMatched := true
	if req.Hostname != "" && len(creative.PlacementDomains) > 0 {
		domainMatched = false
		for _, d := range creative.PlacementDomains {
			if d == req.Hostname {
				domainMatched = true
				break
			}
		}
	}

	// Overall status
	status := "verified"
	if attStatus != "ACTIVE" {
		status = attStatus
	} else if !creativeMatched {
		status = "mismatch_creative"
	} else if !destinationMatched {
		status = "mismatch_destination"
	} else if !domainMatched {
		status = "mismatch_destination"
	}

	resp := VerifyResponse{
		Status:             status,
		AttestationStatus:  attStatus,
		CreativeMatched:    creativeMatched,
		DestinationMatched: destinationMatched,
		DomainMatched:      domainMatched,
	}
	if att.IssuedAt != nil {
		ts := int64(math.Floor(float64(att.IssuedAt.Unix())))
		resp.IssuedAt = &ts
	}
	if att.ExpiresAt != nil {
		ts := int64(math.Floor(float64(att.ExpiresAt.Unix())))
		resp.ExpiresAt = &ts
	}
	if att.TxHash != nil {
		url := "https://sepolia.etherscan.io/tx/" + *att.TxHash
		resp.ExplorerURL = &url
	}

	writeJSON(w, 200, resp)
}
