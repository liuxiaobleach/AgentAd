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
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/db"
)

type creativeStudioRunBody struct {
	RunTitle        string   `json:"runTitle"`
	Brief           string   `json:"brief"`
	CreativeName    string   `json:"creativeName"`
	ProjectName     string   `json:"projectName"`
	LandingURL      string   `json:"landingUrl"`
	TargetAudiences []string `json:"targetAudiences"`
	StyleHint       string   `json:"styleHint"`
	AspectRatio     string   `json:"aspectRatio"`
	VariantCount    int      `json:"variantCount"`
	AutoSubmitAudit bool     `json:"autoSubmitAudit"`
	BrandKitID      *string  `json:"brandKitId"`
}

func (b *creativeStudioRunBody) normalize() {
	b.RunTitle = strings.TrimSpace(b.RunTitle)
	b.Brief = strings.TrimSpace(b.Brief)
	b.CreativeName = strings.TrimSpace(b.CreativeName)
	b.ProjectName = strings.TrimSpace(b.ProjectName)
	b.LandingURL = strings.TrimSpace(b.LandingURL)
	b.TargetAudiences = trimList(b.TargetAudiences)
	b.StyleHint = strings.TrimSpace(b.StyleHint)
	b.AspectRatio = strings.TrimSpace(b.AspectRatio)
	if b.BrandKitID != nil {
		v := strings.TrimSpace(*b.BrandKitID)
		if v == "" {
			b.BrandKitID = nil
		} else {
			b.BrandKitID = &v
		}
	}
}

func (b *creativeStudioRunBody) validate() string {
	if b.Brief == "" || b.CreativeName == "" || b.ProjectName == "" || b.LandingURL == "" {
		return "brief, creativeName, projectName and landingUrl are required"
	}
	if len([]rune(b.RunTitle)) > 120 {
		return "runTitle must be <= 120 characters"
	}
	if len([]rune(b.CreativeName)) > 120 {
		return "creativeName must be <= 120 characters"
	}
	if len([]rune(b.ProjectName)) > 120 {
		return "projectName must be <= 120 characters"
	}
	if len([]rune(b.Brief)) > 4000 {
		return "brief must be <= 4000 characters"
	}
	if b.VariantCount < 1 || b.VariantCount > 4 {
		return "variantCount must be between 1 and 4"
	}
	return ""
}

type studioVariantPlan struct {
	Label string
	Angle string
}

var studioVariantPlans = []studioVariantPlan{
	{
		Label: "Variant A",
		Angle: "Lead with the hero promise and the clearest flagship value proposition.",
	},
	{
		Label: "Variant B",
		Angle: "Emphasize trust signals, proof, safety, and product credibility.",
	},
	{
		Label: "Variant C",
		Angle: "Push a stronger conversion angle with a sharper CTA and more urgency.",
	},
	{
		Label: "Variant D",
		Angle: "Use a cleaner, more premium and minimal composition with fewer moving parts.",
	},
}

type creativeStudioPendingJob struct {
	RunID         string
	ItemID        string
	CreativeID    string
	AdvertiserID  string
	ReservationID string
	Request       GenerateCreativeRequest
	BrandKit      *db.BrandKit
	Variant       studioVariantPlan
}

type creativeStudioRunItemResponse struct {
	ID            string                    `json:"id"`
	CreativeID    string                    `json:"creativeId"`
	CreativeName  string                    `json:"creativeName"`
	ImageURL      *string                   `json:"imageUrl,omitempty"`
	CreativeStatus db.CreativeStatus        `json:"creativeStatus"`
	VariantIndex  int                       `json:"variantIndex"`
	VariantLabel  string                    `json:"variantLabel"`
	VariantAngle  string                    `json:"variantAngle"`
	Phase         string                    `json:"phase"`
	Status        db.CreativeStudioItemStatus `json:"status"`
	Error         *string                   `json:"error,omitempty"`
	LatestMessage string                    `json:"latestMessage,omitempty"`
}

type creativeStudioRunDetailResponse struct {
	Run            db.CreativeStudioRun           `json:"run"`
	BrandKit       *db.BrandKit                   `json:"brandKit,omitempty"`
	Items          []creativeStudioRunItemResponse `json:"items"`
	TotalCount     int                            `json:"totalCount"`
	CompletedCount int                            `json:"completedCount"`
	FailedCount    int                            `json:"failedCount"`
	ReadyCreativeIDs []string                     `json:"readyCreativeIds"`
}

type creativeStudioRunSummary struct {
	Run            db.CreativeStudioRun `json:"run"`
	BrandKitName   *string             `json:"brandKitName,omitempty"`
	TotalCount     int                 `json:"totalCount"`
	CompletedCount int                 `json:"completedCount"`
	FailedCount    int                 `json:"failedCount"`
	ReadyCreativeIDs []string          `json:"readyCreativeIds"`
}

func (h *Handler) ListCreativeStudioRuns(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	limit := 6
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 20 {
			limit = parsed
		}
	}

	runs, err := h.Queries.ListCreativeStudioRuns(r.Context(), claims.AdvertiserID, limit)
	if err != nil {
		writeError(w, 500, "Failed to load studio runs: "+err.Error())
		return
	}

	out := make([]creativeStudioRunSummary, 0, len(runs))
	for _, run := range runs {
		var brandKitName *string
		if run.BrandKitID != nil {
			if kit, err := h.Queries.GetBrandKit(r.Context(), *run.BrandKitID, claims.AdvertiserID); err == nil {
				brandKitName = &kit.Name
			}
		}
		items, err := h.Queries.ListCreativeStudioRunItems(r.Context(), run.ID)
		if err != nil {
			writeError(w, 500, "Failed to load studio run items: "+err.Error())
			return
		}
		summary := summarizeStudioItems(items)
		out = append(out, creativeStudioRunSummary{
			Run:             run,
			BrandKitName:    brandKitName,
			TotalCount:      len(items),
			CompletedCount:  summary.CompletedCount,
			FailedCount:     summary.FailedCount,
			ReadyCreativeIDs: summary.ReadyCreativeIDs,
		})
	}

	writeJSON(w, 200, out)
}

func (h *Handler) GetCreativeStudioRun(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	runID := chi.URLParam(r, "id")
	run, err := h.Queries.GetCreativeStudioRun(r.Context(), runID, claims.AdvertiserID)
	if err != nil {
		writeError(w, 404, "Studio run not found")
		return
	}

	items, err := h.Queries.ListCreativeStudioRunItems(r.Context(), run.ID)
	if err != nil {
		writeError(w, 500, "Failed to load studio run items: "+err.Error())
		return
	}

	var brandKit *db.BrandKit
	if run.BrandKitID != nil {
		if kit, err := h.Queries.GetBrandKit(r.Context(), *run.BrandKitID, claims.AdvertiserID); err == nil {
			brandKit = &kit
		}
	}

	itemViews := make([]creativeStudioRunItemResponse, 0, len(items))
	var completedCount, failedCount int
	readyCreativeIDs := make([]string, 0, len(items))
	for _, item := range items {
		phase := item.Phase
		status := item.Status
		errText := item.Error
		latestMessage := ""

		if state := h.GetGenerationState(item.CreativeID); state != nil {
			phase = state.Phase
			switch state.Phase {
			case "completed":
				status = db.CreativeStudioItemStatusCompleted
			case "failed":
				status = db.CreativeStudioItemStatusFailed
			default:
				status = db.CreativeStudioItemStatusRunning
			}
			if state.Error != "" {
				tmp := state.Error
				errText = &tmp
			}
			if len(state.Steps) > 0 {
				latestMessage = state.Steps[len(state.Steps)-1].Message
			}
		} else if item.ImageURL != nil {
			phase = "completed"
			status = db.CreativeStudioItemStatusCompleted
		}

		if status == db.CreativeStudioItemStatusCompleted {
			completedCount++
			readyCreativeIDs = append(readyCreativeIDs, item.CreativeID)
		}
		if status == db.CreativeStudioItemStatusFailed {
			failedCount++
		}

		itemViews = append(itemViews, creativeStudioRunItemResponse{
			ID:             item.ID,
			CreativeID:     item.CreativeID,
			CreativeName:   item.CreativeName,
			ImageURL:       item.ImageURL,
			CreativeStatus: item.CreativeStatus,
			VariantIndex:   item.VariantIndex,
			VariantLabel:   item.VariantLabel,
			VariantAngle:   item.VariantAngle,
			Phase:          phase,
			Status:         status,
			Error:          errText,
			LatestMessage:  latestMessage,
		})
	}

	writeJSON(w, 200, creativeStudioRunDetailResponse{
		Run:             run,
		BrandKit:        brandKit,
		Items:           itemViews,
		TotalCount:      len(itemViews),
		CompletedCount:  completedCount,
		FailedCount:     failedCount,
		ReadyCreativeIDs: readyCreativeIDs,
	})
}

func (h *Handler) CreateCreativeStudioRun(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || claims.AdvertiserID == "" {
		writeError(w, 401, "Not authenticated")
		return
	}

	var body creativeStudioRunBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}
	body.normalize()
	if msg := body.validate(); msg != "" {
		writeError(w, 400, msg)
		return
	}

	if h.Config.OpenAIAPIKey == "" && h.Config.GeminiAPIKey == "" {
		writeError(w, 500, "No image generation API key configured (set GEMINI_API_KEY or OPENAI_API_KEY)")
		return
	}

	var brandKit *db.BrandKit
	if body.BrandKitID != nil {
		kit, err := h.Queries.GetBrandKit(r.Context(), *body.BrandKitID, claims.AdvertiserID)
		if err != nil {
			writeError(w, 404, "Brand kit not found")
			return
		}
		brandKit = &kit
	}

	requiredAtomic := int64(body.VariantCount) * (h.Config.GenerateBaseFeeAtomic + h.Config.GenerateExternalCapAtomic)
	if balance, err := h.Queries.GetAdvertiserBalance(r.Context(), claims.AdvertiserID); err == nil && balance.SpendableAtomic < requiredAtomic {
		h.writeInsufficientBalance(w, r.Context(), claims.AdvertiserID, requiredAtomic)
		return
	}

	title := body.RunTitle
	if title == "" {
		title = fmt.Sprintf("%s Studio Batch", body.ProjectName)
	}

	var brandKitID *string
	if brandKit != nil {
		brandKitID = &brandKit.ID
	}

	run, err := h.Queries.CreateCreativeStudioRun(r.Context(), db.CreativeStudioRun{
		AdvertiserID:     claims.AdvertiserID,
		BrandKitID:       brandKitID,
		Title:            title,
		Brief:            body.Brief,
		BaseCreativeName: body.CreativeName,
		ProjectName:      body.ProjectName,
		LandingURL:       body.LandingURL,
		TargetAudiences:  body.TargetAudiences,
		StyleHint:        body.StyleHint,
		AspectRatio:      body.AspectRatio,
		VariantCount:     body.VariantCount,
		AutoSubmitAudit:  body.AutoSubmitAudit,
		Status:           db.CreativeStudioRunStatusQueued,
	})
	if err != nil {
		writeError(w, 500, "Failed to create studio run: "+err.Error())
		return
	}

	pendingJobs := make([]creativeStudioPendingJob, 0, body.VariantCount)
	createdCreativeIDs := make([]string, 0, body.VariantCount)
	cleanup := func(reason string) {
		log.Printf("[studio] cleanup run=%s reason=%s", run.ID, reason)
		for _, job := range pendingJobs {
			h.settleReservation(context.Background(), job.ReservationID, false, db.SpendReservationStatusReleased)
			if err := h.Queries.DeleteCreative(context.Background(), job.CreativeID, claims.AdvertiserID); err != nil {
				log.Printf("[studio] cleanup creative=%s failed: %v", job.CreativeID, err)
			}
		}
		now := time.Now().UTC()
		_ = h.Queries.UpdateCreativeStudioRunStatus(context.Background(), run.ID, db.CreativeStudioRunStatusFailed, &now)
	}

	for i := 0; i < body.VariantCount; i++ {
		variant := studioVariantPlans[i]
		creativeName := buildStudioCreativeName(body.CreativeName, variant, body.VariantCount)

		reservation, err := h.reserveSpend(
			r.Context(),
			claims.AdvertiserID,
			"creative_generation",
			nil,
			h.Config.GenerateBaseFeeAtomic,
			h.Config.GenerateExternalCapAtomic,
			map[string]interface{}{
				"studioRunId":  run.ID,
				"variantIndex": i + 1,
				"variantLabel": variant.Label,
				"creativeName": creativeName,
			},
		)
		if err != nil {
			cleanup("reserve spend failed")
			if errors.Is(err, db.ErrInsufficientBalance) {
				h.writeInsufficientBalance(w, r.Context(), claims.AdvertiserID, requiredAtomic)
				return
			}
			writeError(w, 500, "Failed to reserve generation budget: "+err.Error())
			return
		}

		initialNotes := buildStudioInitialNotes(body, run.ID, brandKit, variant)
		created, err := h.Queries.CreateCreative(r.Context(), db.Creative{
			AdvertiserID: claims.AdvertiserID,
			CreativeName: creativeName,
			ProjectName:  body.ProjectName,
			LandingURL:   body.LandingURL,
			Notes:        &initialNotes,
			Status:       db.CreativeStatusDraft,
		})
		if err != nil {
			h.settleReservation(context.Background(), reservation.ID, false, db.SpendReservationStatusReleased)
			cleanup("create creative failed")
			writeError(w, 500, "Failed to create creative placeholder: "+err.Error())
			return
		}
		if err := h.Queries.UpdateSpendReservationOperationRef(r.Context(), reservation.ID, created.ID); err != nil {
			log.Printf("[studio] creative=%s failed to attach reservation=%s: %v", created.ID, reservation.ID, err)
		}

		item, err := h.Queries.CreateCreativeStudioRunItem(r.Context(), db.CreativeStudioRunItem{
			RunID:        run.ID,
			CreativeID:   created.ID,
			VariantIndex: i + 1,
			VariantLabel: variant.Label,
			VariantAngle: variant.Angle,
			Phase:        "queued",
			Status:       db.CreativeStudioItemStatusQueued,
		})
		if err != nil {
			h.settleReservation(context.Background(), reservation.ID, false, db.SpendReservationStatusReleased)
			_ = h.Queries.DeleteCreative(context.Background(), created.ID, claims.AdvertiserID)
			cleanup("create studio item failed")
			writeError(w, 500, "Failed to create studio item: "+err.Error())
			return
		}

		h.SetGenerationState(created.ID, &GenerationState{
			CreativeID: created.ID,
			Phase:      "queued",
			Steps:      []audit.GenerationStep{},
		})

		pendingJobs = append(pendingJobs, creativeStudioPendingJob{
			RunID:         run.ID,
			ItemID:        item.ID,
			CreativeID:    created.ID,
			AdvertiserID:  claims.AdvertiserID,
			ReservationID: reservation.ID,
			Request: GenerateCreativeRequest{
				Brief:           body.Brief,
				CreativeName:    creativeName,
				ProjectName:     body.ProjectName,
				LandingURL:      body.LandingURL,
				TargetAudiences: body.TargetAudiences,
				StyleHint:       body.StyleHint,
				AspectRatio:     body.AspectRatio,
				AutoSubmitAudit: body.AutoSubmitAudit,
			},
			BrandKit: brandKit,
			Variant:  variant,
		})
		createdCreativeIDs = append(createdCreativeIDs, created.ID)
	}

	_ = h.Queries.UpdateCreativeStudioRunStatus(r.Context(), run.ID, db.CreativeStudioRunStatusRunning, nil)
	for _, job := range pendingJobs {
		go h.runCreativeStudioItemInBackground(job)
	}

	writeJSON(w, 202, map[string]interface{}{
		"runId":       run.ID,
		"status":      db.CreativeStudioRunStatusRunning,
		"creativeIds": createdCreativeIDs,
		"message":     "Batch creative studio run started.",
	})
}

func (h *Handler) runCreativeStudioItemInBackground(job creativeStudioPendingJob) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	state := h.GetGenerationState(job.CreativeID)
	if state == nil {
		state = &GenerationState{CreativeID: job.CreativeID}
		h.SetGenerationState(job.CreativeID, state)
	}

	if err := h.Queries.UpdateCreativeStudioRunItemState(ctx, job.ItemID, "queued", db.CreativeStudioItemStatusRunning, nil, nil); err != nil {
		log.Printf("[studio] item=%s queued update failed: %v", job.ItemID, err)
	}

	session, err := h.Payments.NewSession(job.AdvertiserID, job.ReservationID, h.Config.GenerateExternalCapAtomic)
	if err != nil {
		state.Phase = "failed"
		state.Error = "init x402 session: " + err.Error()
		errText := state.Error
		now := time.Now().UTC()
		_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, "failed", db.CreativeStudioItemStatusFailed, &errText, &now)
		h.settleReservation(context.Background(), job.ReservationID, false, db.SpendReservationStatusFailed)
		h.refreshCreativeStudioRunStatus(job.RunID)
		return
	}

	brief := buildStudioBrief(job.Request, job.BrandKit, job.Variant)
	onStep := func(s audit.GenerationStep) {
		state.Phase = s.Phase
		state.Steps = append(state.Steps, s)
		_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, s.Phase, db.CreativeStudioItemStatusRunning, nil, nil)
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
		errText := err.Error()
		now := time.Now().UTC()
		log.Printf("[studio] creative=%s FAILED: %v", job.CreativeID, err)
		_ = h.Queries.PatchCreativeNotes(ctx, job.CreativeID, buildStudioFailureNotes(job.Request, job.RunID, job.BrandKit, job.Variant, errText))
		_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, "failed", db.CreativeStudioItemStatusFailed, &errText, &now)
		h.settleReservation(context.Background(), job.ReservationID, false, db.SpendReservationStatusFailed)
		h.refreshCreativeStudioRunStatus(job.RunID)
		return
	}

	state.Directive = &out.Directive
	state.Prompt = out.ImagePrompt

	uploadDir := h.Config.UploadDir
	_ = os.MkdirAll(uploadDir, 0755)
	fileName := fmt.Sprintf("%d-ai-%s.png", time.Now().UnixMilli(), job.CreativeID[:8])
	filePath := filepath.Join(uploadDir, fileName)
	if err := os.WriteFile(filePath, out.ImageBytes, 0644); err != nil {
		state.Phase = "failed"
		state.Error = "save image: " + err.Error()
		errText := state.Error
		now := time.Now().UTC()
		_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, "failed", db.CreativeStudioItemStatusFailed, &errText, &now)
		h.settleReservation(context.Background(), job.ReservationID, false, db.SpendReservationStatusFailed)
		h.refreshCreativeStudioRunStatus(job.RunID)
		return
	}

	hash := sha256.Sum256(out.ImageBytes)
	hashStr := fmt.Sprintf("0x%x", hash)
	imageURL := "/uploads/" + fileName
	if err := h.Queries.UpdateCreativeImage(ctx, job.CreativeID, imageURL, hashStr); err != nil {
		state.Phase = "failed"
		state.Error = "update creative image: " + err.Error()
		errText := state.Error
		now := time.Now().UTC()
		_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, "failed", db.CreativeStudioItemStatusFailed, &errText, &now)
		h.settleReservation(context.Background(), job.ReservationID, false, db.SpendReservationStatusFailed)
		h.refreshCreativeStudioRunStatus(job.RunID)
		return
	}

	_ = h.Queries.PatchCreativeNotes(ctx, job.CreativeID, buildStudioFinalNotes(job.Request, job.RunID, job.BrandKit, job.Variant, out))

	state.Phase = "completed"
	now := time.Now().UTC()
	_ = h.Queries.UpdateCreativeStudioRunItemState(context.Background(), job.ItemID, "completed", db.CreativeStudioItemStatusCompleted, nil, &now)

	if _, err := h.Queries.FinalizeSpendReservation(ctx, job.ReservationID, true, db.SpendReservationStatusSettled); err != nil {
		state.Error = "billing finalize: " + err.Error()
		log.Printf("[studio] creative=%s finalize reservation failed: %v", job.CreativeID, err)
	}

	if job.Request.AutoSubmitAudit {
		h.autoSubmitAuditForCreative(job.CreativeID, out.ImageBytes)
	}

	h.refreshCreativeStudioRunStatus(job.RunID)
}

func buildStudioCreativeName(base string, variant studioVariantPlan, count int) string {
	if count <= 1 {
		return base
	}
	return fmt.Sprintf("%s — %s", base, variant.Label)
}

func buildStudioBrief(req GenerateCreativeRequest, brandKit *db.BrandKit, variant studioVariantPlan) audit.CreativeBrief {
	brief := audit.CreativeBrief{
		UserBrief:       req.Brief,
		ProjectName:     req.ProjectName,
		LandingURL:      req.LandingURL,
		TargetAudiences: req.TargetAudiences,
		StyleHint:       req.StyleHint,
		AspectRatio:     req.AspectRatio,
		VariantAngle:    variant.Angle,
	}
	if brandKit != nil {
		brief.BrandKitName = brandKit.Name
		brief.BrandDescription = brandKit.Description
		brief.BrandVoiceTone = brandKit.VoiceTone
		brief.BrandPrimaryMessage = brandKit.PrimaryMessage
		brief.BrandColorPalette = brandKit.ColorPalette
		brief.BrandMandatoryTerms = brandKit.MandatoryTerms
		brief.BrandBannedTerms = brandKit.BannedTerms
		brief.BrandVisualRules = brandKit.VisualRules
		brief.BrandCTAPreferences = brandKit.CtaPreferences
	}
	return brief
}

func buildStudioInitialNotes(req creativeStudioRunBody, runID string, brandKit *db.BrandKit, variant studioVariantPlan) string {
	var b strings.Builder
	b.WriteString("[AI-generated]\n")
	b.WriteString(fmt.Sprintf("[Studio Run: %s]\n", runID))
	b.WriteString(fmt.Sprintf("[Variant: %s]\n", variant.Label))
	if brandKit != nil {
		b.WriteString(fmt.Sprintf("[Brand Kit: %s]\n", brandKit.Name))
	}
	b.WriteString("\nBrief:\n")
	b.WriteString(req.Brief)
	return b.String()
}

func buildStudioFailureNotes(req GenerateCreativeRequest, runID string, brandKit *db.BrandKit, variant studioVariantPlan, errText string) string {
	var b strings.Builder
	b.WriteString("[AI-generated]\n")
	b.WriteString(fmt.Sprintf("[Studio Run: %s]\n", runID))
	b.WriteString(fmt.Sprintf("[Variant: %s]\n", variant.Label))
	if brandKit != nil {
		b.WriteString(fmt.Sprintf("[Brand Kit: %s]\n", brandKit.Name))
	}
	b.WriteString("\nBrief:\n")
	b.WriteString(req.Brief)
	b.WriteString("\n\n[Generation failed: ")
	b.WriteString(errText)
	b.WriteString("]")
	return b.String()
}

func buildStudioFinalNotes(req GenerateCreativeRequest, runID string, brandKit *db.BrandKit, variant studioVariantPlan, out *audit.GenerationOutput) string {
	directiveJSON, _ := json.MarshalIndent(out.Directive, "", "  ")
	var b strings.Builder
	b.WriteString("[AI-generated]\n")
	b.WriteString(fmt.Sprintf("[Studio Run: %s]\n", runID))
	b.WriteString(fmt.Sprintf("[Variant: %s]\n", variant.Label))
	b.WriteString(fmt.Sprintf("[Variant Angle: %s]\n", variant.Angle))
	if brandKit != nil {
		b.WriteString(fmt.Sprintf("[Brand Kit: %s]\n", brandKit.Name))
	}
	b.WriteString("\nBrief:\n")
	b.WriteString(req.Brief)
	b.WriteString("\n\nDirective:\n")
	b.WriteString(string(directiveJSON))
	b.WriteString("\n\nImage prompt:\n")
	b.WriteString(out.ImagePrompt)
	return b.String()
}

func (h *Handler) refreshCreativeStudioRunStatus(runID string) {
	items, err := h.Queries.ListCreativeStudioRunItems(context.Background(), runID)
	if err != nil {
		log.Printf("[studio] refresh run=%s failed to list items: %v", runID, err)
		return
	}
	status, completedAt := deriveStudioRunStatus(items)
	if err := h.Queries.UpdateCreativeStudioRunStatus(context.Background(), runID, status, completedAt); err != nil {
		log.Printf("[studio] refresh run=%s failed to update status: %v", runID, err)
	}
}

func deriveStudioRunStatus(items []db.CreativeStudioRunItem) (db.CreativeStudioRunStatus, *time.Time) {
	if len(items) == 0 {
		return db.CreativeStudioRunStatusQueued, nil
	}
	var queued, running, completed, failed int
	for _, item := range items {
		switch item.Status {
		case db.CreativeStudioItemStatusCompleted:
			completed++
		case db.CreativeStudioItemStatusFailed:
			failed++
		case db.CreativeStudioItemStatusRunning:
			running++
		default:
			queued++
		}
	}
	if completed == len(items) {
		now := time.Now().UTC()
		return db.CreativeStudioRunStatusCompleted, &now
	}
	if failed == len(items) {
		now := time.Now().UTC()
		return db.CreativeStudioRunStatusFailed, &now
	}
	if completed > 0 && failed > 0 && completed+failed == len(items) {
		now := time.Now().UTC()
		return db.CreativeStudioRunStatusPartial, &now
	}
	if running > 0 || completed > 0 || failed > 0 {
		return db.CreativeStudioRunStatusRunning, nil
	}
	if queued == len(items) {
		return db.CreativeStudioRunStatusQueued, nil
	}
	return db.CreativeStudioRunStatusRunning, nil
}

type studioItemSummary struct {
	CompletedCount int
	FailedCount    int
	ReadyCreativeIDs []string
}

func summarizeStudioItems(items []db.CreativeStudioRunItem) studioItemSummary {
	out := studioItemSummary{
		ReadyCreativeIDs: make([]string, 0, len(items)),
	}
	for _, item := range items {
		if item.Status == db.CreativeStudioItemStatusCompleted || item.ImageURL != nil {
			out.CompletedCount++
			out.ReadyCreativeIDs = append(out.ReadyCreativeIDs, item.CreativeID)
		}
		if item.Status == db.CreativeStudioItemStatusFailed {
			out.FailedCount++
		}
	}
	return out
}
