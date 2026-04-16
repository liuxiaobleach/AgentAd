package handler

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
)

type GenerationState struct {
	CreativeID string                  `json:"creativeId"`
	Phase      string                  `json:"phase"`      // "queued", "brief", "prompt", "image", "completed", "failed"
	Steps      []audit.GenerationStep  `json:"steps"`
	Error      string                  `json:"error,omitempty"`
	Directive  *audit.CreativeDirective `json:"directive,omitempty"`
	Prompt     string                  `json:"prompt,omitempty"`
}

type Handler struct {
	Queries     *db.Queries
	Config      *config.Config
	generations sync.Map // creativeID -> *GenerationState
}

func New(q *db.Queries, cfg *config.Config) *Handler {
	return &Handler{Queries: q, Config: cfg}
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
