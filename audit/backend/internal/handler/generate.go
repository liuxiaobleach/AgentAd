package handler

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/db"
)

type GenerateCreativeRequest struct {
	Brief           string   `json:"brief"`
	CreativeName    string   `json:"creativeName"`
	ProjectName     string   `json:"projectName"`
	LandingURL      string   `json:"landingUrl"`
	TargetAudiences []string `json:"targetAudiences"`
	StyleHint       string   `json:"styleHint"`
	AspectRatio     string   `json:"aspectRatio"`
	AutoSubmitAudit bool     `json:"autoSubmitAudit"`
}

// GenerateCreative accepts a free-form advertiser brief and kicks off an async
// agent pipeline that:
//  1. Uses Claude to turn the brief into a structured creative directive.
//  2. Uses Claude to write a high-quality image generation prompt.
//  3. Calls the image provider (OpenAI) to produce the actual image.
//  4. Writes the image into uploads/ and updates the creative record.
//
// Returns 202 immediately with the creativeId; the client polls for state.
func (h *Handler) GenerateCreative(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	var req GenerateCreativeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}

	if req.Brief == "" || req.CreativeName == "" || req.ProjectName == "" || req.LandingURL == "" {
		writeError(w, 400, "brief, creativeName, projectName and landingUrl are required")
		return
	}

	if h.Config.OpenAIAPIKey == "" && h.Config.GeminiAPIKey == "" {
		writeError(w, 500, "No image generation API key configured (set GEMINI_API_KEY or OPENAI_API_KEY)")
		return
	}

	reservation, err := h.reserveSpend(
		r.Context(),
		claims.AdvertiserID,
		"creative_generation",
		nil,
		h.Config.GenerateBaseFeeAtomic,
		h.Config.GenerateExternalCapAtomic,
		map[string]interface{}{
			"creativeName": req.CreativeName,
			"projectName":  req.ProjectName,
			"landingUrl":   req.LandingURL,
		},
	)
	if err != nil {
		if errors.Is(err, db.ErrInsufficientBalance) {
			h.writeInsufficientBalance(w, r.Context(), claims.AdvertiserID, h.Config.GenerateBaseFeeAtomic+h.Config.GenerateExternalCapAtomic)
			return
		}
		writeError(w, 500, "Failed to reserve generation budget: "+err.Error())
		return
	}

	// Create the creative in DRAFT with no image yet.
	notes := fmt.Sprintf("[AI-generated]\nBrief: %s", req.Brief)
	creative := db.Creative{
		AdvertiserID: claims.AdvertiserID,
		CreativeName: req.CreativeName,
		ProjectName:  req.ProjectName,
		LandingURL:   req.LandingURL,
		Notes:        &notes,
		Status:       db.CreativeStatusDraft,
	}

	created, err := h.Queries.CreateCreative(r.Context(), creative)
	if err != nil {
		h.settleReservation(context.Background(), reservation.ID, false, db.SpendReservationStatusReleased)
		writeError(w, 500, "Failed to create creative placeholder: "+err.Error())
		return
	}
	if err := h.Queries.UpdateSpendReservationOperationRef(r.Context(), reservation.ID, created.ID); err != nil {
		log.Printf("[gen] creative=%s failed to attach reservation=%s: %v", created.ID, reservation.ID, err)
	}

	// Track generation progress.
	state := &GenerationState{
		CreativeID: created.ID,
		Phase:      "queued",
		Steps:      []audit.GenerationStep{},
	}
	h.SetGenerationState(created.ID, state)

	// Kick off async pipeline.
	go h.runCreativeGenerationInBackground(created.ID, claims.AdvertiserID, reservation.ID, req)

	writeJSON(w, 202, map[string]interface{}{
		"creativeId": created.ID,
		"status":     "GENERATING",
		"message":    "AI generation started. Poll /api/creatives/{id}/generation-status for progress.",
	})
}

func (h *Handler) runCreativeGenerationInBackground(creativeID, advertiserID, reservationID string, req GenerateCreativeRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	log.Printf("[gen] creative=%s start", creativeID)

	state := h.GetGenerationState(creativeID)
	if state == nil {
		state = &GenerationState{CreativeID: creativeID}
		h.SetGenerationState(creativeID, state)
	}

	session, err := h.Payments.NewSession(advertiserID, reservationID, h.Config.GenerateExternalCapAtomic)
	if err != nil {
		state.Phase = "failed"
		state.Error = "init x402 session: " + err.Error()
		h.settleReservation(context.Background(), reservationID, false, db.SpendReservationStatusFailed)
		log.Printf("[gen] creative=%s x402 init failed: %v", creativeID, err)
		return
	}

	brief := audit.CreativeBrief{
		UserBrief:       req.Brief,
		ProjectName:     req.ProjectName,
		LandingURL:      req.LandingURL,
		TargetAudiences: req.TargetAudiences,
		StyleHint:       req.StyleHint,
		AspectRatio:     req.AspectRatio,
	}

	onStep := func(s audit.GenerationStep) {
		state.Phase = s.Phase
		state.Steps = append(state.Steps, s)
		log.Printf("[gen] creative=%s phase=%s msg=%s", creativeID, s.Phase, s.Message)
	}

	out, err := audit.RunCreativeGeneration(
		ctx,
		h.Config.AnthropicAPIKey,
		h.Config.AuditModel,
		session.NewHTTPClient("anthropic-generate", 2*time.Minute),
		audit.ImageProviderConfig{
			OpenAIKey:        h.Config.OpenAIAPIKey,
			OpenAIModel:      h.Config.ImageModel,
			OpenAIHTTPClient: session.NewHTTPClient("openai-images", 3*time.Minute),
			GeminiKey:        h.Config.GeminiAPIKey,
			GeminiModel:      h.Config.GeminiImageModel,
			GeminiHTTPClient: session.NewHTTPClient("gemini-images", 3*time.Minute),
		},
		brief,
		onStep,
	)
	if err != nil {
		state.Phase = "failed"
		state.Error = err.Error()
		log.Printf("[gen] creative=%s FAILED: %v", creativeID, err)
		errNote := fmt.Sprintf("[AI-generated]\nBrief: %s\n\n[Generation failed: %s]", req.Brief, err.Error())
		_ = h.Queries.PatchCreativeNotes(ctx, creativeID, errNote)
		h.settleReservation(context.Background(), reservationID, false, db.SpendReservationStatusFailed)
		return
	}

	state.Directive = &out.Directive
	state.Prompt = out.ImagePrompt

	// Save the image.
	uploadDir := h.Config.UploadDir
	_ = os.MkdirAll(uploadDir, 0755)
	fileName := fmt.Sprintf("%d-ai-%s.png", time.Now().UnixMilli(), creativeID[:8])
	filePath := filepath.Join(uploadDir, fileName)
	if err := os.WriteFile(filePath, out.ImageBytes, 0644); err != nil {
		state.Phase = "failed"
		state.Error = "save image: " + err.Error()
		log.Printf("[gen] creative=%s save image failed: %v", creativeID, err)
		h.settleReservation(context.Background(), reservationID, false, db.SpendReservationStatusFailed)
		return
	}

	hash := sha256.Sum256(out.ImageBytes)
	hashStr := fmt.Sprintf("0x%x", hash)
	imageURL := "/uploads/" + fileName

	if err := h.Queries.UpdateCreativeImage(ctx, creativeID, imageURL, hashStr); err != nil {
		state.Phase = "failed"
		state.Error = "update creative image: " + err.Error()
		log.Printf("[gen] creative=%s db update failed: %v", creativeID, err)
		h.settleReservation(context.Background(), reservationID, false, db.SpendReservationStatusFailed)
		return
	}

	// Persist brief + directive + prompt in notes for transparency.
	directiveJSON, _ := json.MarshalIndent(out.Directive, "", "  ")
	finalNotes := fmt.Sprintf(
		"[AI-generated]\n\nBrief:\n%s\n\nDirective:\n%s\n\nImage prompt:\n%s",
		req.Brief, string(directiveJSON), out.ImagePrompt,
	)
	_ = h.Queries.PatchCreativeNotes(ctx, creativeID, finalNotes)

	state.Phase = "completed"
	log.Printf("[gen] creative=%s COMPLETED", creativeID)
	if _, err := h.Queries.FinalizeSpendReservation(ctx, reservationID, true, db.SpendReservationStatusSettled); err != nil {
		state.Error = "billing finalize: " + err.Error()
		log.Printf("[gen] creative=%s finalize reservation failed: %v", creativeID, err)
		return
	}

	if req.AutoSubmitAudit {
		log.Printf("[gen] creative=%s auto-submitting audit", creativeID)
		h.autoSubmitAuditForCreative(creativeID, out.ImageBytes)
	}
}

// autoSubmitAuditForCreative mirrors SubmitAudit's behavior but skips the HTTP
// layer. Used after successful AI generation when the advertiser opted in.
func (h *Handler) autoSubmitAuditForCreative(creativeID string, imageData []byte) {
	ctx := context.Background()
	creative, err := h.Queries.GetCreativeRaw(ctx, creativeID)
	if err != nil {
		log.Printf("[gen] auto-audit fetch creative failed: %v", err)
		return
	}
	if creative.ImageURL == nil || creative.CreativeHash == nil {
		log.Printf("[gen] auto-audit skipped: creative missing image")
		return
	}

	reservation, err := h.reserveSpend(
		ctx,
		creative.AdvertiserID,
		"creative_audit",
		nil,
		h.Config.AuditBaseFeeAtomic,
		h.Config.AuditExternalCapAtomic,
		map[string]interface{}{
			"creativeId":   creative.ID,
			"creativeName": creative.CreativeName,
			"projectName":  creative.ProjectName,
			"trigger":      "auto_submit_after_generation",
		},
	)
	if err != nil {
		if errors.Is(err, db.ErrInsufficientBalance) {
			log.Printf("[gen] auto-audit skipped: insufficient balance for creative=%s", creative.ID)
			return
		}
		log.Printf("[gen] auto-audit reserve failed: %v", err)
		return
	}

	auditCase, err := h.Queries.CreateAuditCase(ctx, creative.ID)
	if err != nil {
		h.settleReservation(context.Background(), reservation.ID, false, db.SpendReservationStatusReleased)
		log.Printf("[gen] auto-audit create case failed: %v", err)
		return
	}
	if err := h.Queries.UpdateSpendReservationOperationRef(ctx, reservation.ID, auditCase.ID); err != nil {
		log.Printf("[gen] auto-audit attach reservation failed case=%s reservation=%s: %v", auditCase.ID, reservation.ID, err)
	}
	_ = h.Queries.UpdateCreativeStatus(ctx, creative.ID, db.CreativeStatusAuditing)

	go h.runAuditInBackground(auditCase.ID, creative.AdvertiserID, reservation.ID, creative, imageData)
}

// GetGenerationStatus returns the in-memory state of an ongoing or recently
// completed creative generation.
func (h *Handler) GetGenerationStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	state := h.GetGenerationState(id)
	if state == nil {
		// Not in memory: look at the creative itself.
		creative, err := h.Queries.GetCreativeRaw(r.Context(), id)
		if err != nil {
			writeError(w, 404, "Creative not found")
			return
		}
		phase := "unknown"
		if creative.ImageURL != nil {
			phase = "completed"
		}
		writeJSON(w, 200, map[string]interface{}{
			"creativeId": id,
			"phase":      phase,
			"steps":      []audit.GenerationStep{},
		})
		return
	}
	writeJSON(w, 200, state)
}
