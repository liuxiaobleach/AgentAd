package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/onchain"
	"github.com/zkdsp/audit-backend/internal/payments"
)

type GenerationState struct {
	CreativeID string                   `json:"creativeId"`
	Phase      string                   `json:"phase"` // "queued", "brief", "prompt", "image", "completed", "failed"
	Steps      []audit.GenerationStep   `json:"steps"`
	Error      string                   `json:"error,omitempty"`
	Directive  *audit.CreativeDirective `json:"directive,omitempty"`
	Prompt     string                   `json:"prompt,omitempty"`
}

type Handler struct {
	Queries     *db.Queries
	Config      *config.Config
	Payments    *payments.BuyerFactory
	ClaimSigner *onchain.ClaimSigner // nil if issuer key / escrow not configured
	generations sync.Map             // creativeID -> *GenerationState
}

func New(q *db.Queries, cfg *config.Config) *Handler {
	SetJWTSecret(cfg.JWTSecret)
	h := &Handler{
		Queries:  q,
		Config:   cfg,
		Payments: payments.NewBuyerFactory(cfg, q),
	}
	if cfg.IssuerPrivateKey != "" && cfg.BudgetEscrowAddress != "" {
		signer, err := onchain.NewClaimSigner(cfg.IssuerPrivateKey, cfg.BudgetEscrowAddress, cfg.SepoliaChainID)
		if err != nil {
			log.Printf("[claim] signer disabled: %v", err)
		} else {
			h.ClaimSigner = signer
			log.Printf("[claim] signer ready issuer=%s escrow=%s chain=%d",
				signer.IssuerAddress().Hex(), signer.EscrowAddress().Hex(), signer.ChainID())
		}
	}
	return h
}

func (h *Handler) SetGenerationState(id string, state *GenerationState) {
	h.generations.Store(id, state)
}

func (h *Handler) GetGenerationState(id string) *GenerationState {
	if v, ok := h.generations.Load(id); ok {
		return v.(*GenerationState)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
