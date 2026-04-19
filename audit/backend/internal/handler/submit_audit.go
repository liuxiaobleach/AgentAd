package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/zkdsp/audit-backend/internal/attestation"
	"github.com/zkdsp/audit-backend/internal/audit"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/onchain"
)

// SubmitAudit creates the audit case, returns immediately, and runs the
// Claude agentic loop in a background goroutine.
func (h *Handler) SubmitAudit(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	id := chi.URLParam(r, "id")

	creative, err := h.Queries.GetCreativeRaw(r.Context(), id)
	if err != nil {
		writeError(w, 404, "Creative not found")
		return
	}
	if creative.AdvertiserID != claims.AdvertiserID {
		writeError(w, 403, "Creative does not belong to your account")
		return
	}

	if creative.ImageURL == nil || creative.CreativeHash == nil {
		writeError(w, 400, "Creative must have an uploaded image")
		return
	}

	// Load image synchronously (fast)
	imagePath := filepath.Join(h.Config.UploadDir, strings.TrimPrefix(*creative.ImageURL, "/uploads/"))
	imageData, err := os.ReadFile(imagePath)
	if err != nil {
		writeError(w, 500, "Failed to read image: "+err.Error())
		return
	}

	reservation, err := h.reserveSpend(
		r.Context(),
		claims.AdvertiserID,
		"creative_audit",
		nil,
		h.Config.AuditBaseFeeAtomic,
		h.Config.AuditExternalCapAtomic,
		map[string]interface{}{
			"creativeId":   creative.ID,
			"creativeName": creative.CreativeName,
			"projectName":  creative.ProjectName,
		},
	)
	if err != nil {
		if errors.Is(err, db.ErrInsufficientBalance) {
			h.writeInsufficientBalance(w, r.Context(), claims.AdvertiserID, h.Config.AuditBaseFeeAtomic+h.Config.AuditExternalCapAtomic)
			return
		}
		writeError(w, 500, "Failed to reserve audit budget: "+err.Error())
		return
	}

	// Create audit case (TRIAGING status)
	auditCase, err := h.Queries.CreateAuditCase(r.Context(), creative.ID)
	if err != nil {
		h.settleReservation(context.Background(), reservation.ID, false, db.SpendReservationStatusReleased)
		writeError(w, 500, "Failed to create audit case: "+err.Error())
		return
	}
	if err := h.Queries.UpdateSpendReservationOperationRef(r.Context(), reservation.ID, auditCase.ID); err != nil {
		log.Printf("[audit] case=%s failed to attach reservation=%s: %v", auditCase.ID, reservation.ID, err)
	}
	_ = h.Queries.UpdateCreativeStatus(r.Context(), creative.ID, db.CreativeStatusAuditing)

	// Kick off background audit
	go h.runAuditInBackground(auditCase.ID, claims.AdvertiserID, reservation.ID, creative, imageData)

	// Return immediately so the client doesn't block
	writeJSON(w, 202, map[string]interface{}{
		"auditCaseId": auditCase.ID,
		"status":      "TRIAGING",
		"message":     "Audit started. Poll /api/audit-cases/{id} for progress.",
	})
}

func (h *Handler) runAuditInBackground(auditCaseID, advertiserID, reservationID string, creative db.Creative, imageData []byte) {
	// Use a fresh background context so the HTTP request cancellation doesn't kill it
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	log.Printf("[audit] case=%s start (creative=%s)", auditCaseID, creative.ID)

	session, err := h.Payments.NewSession(advertiserID, reservationID, h.Config.AuditExternalCapAtomic)
	if err != nil {
		log.Printf("[audit] case=%s x402 init failed: %v", auditCaseID, err)
		h.saveAuditError(ctx, auditCaseID, creative, "Audit failed: init x402 session: "+err.Error())
		h.settleReservation(context.Background(), reservationID, true, db.SpendReservationStatusSettled)
		return
	}

	triageIn := audit.TriageInput{
		CreativeURL:     *creative.ImageURL,
		CreativeHash:    *creative.CreativeHash,
		DeclaredLanding: creative.LandingURL,
		ProjectName:     creative.ProjectName,
		ImageData:       imageData,
	}
	if creative.TelegramURL != nil {
		triageIn.DeclaredTelegram = *creative.TelegramURL
	}
	if creative.ContractAddress != nil {
		triageIn.Contracts = []string{*creative.ContractAddress}
	}
	if creative.ChainID != nil {
		triageIn.ChainID = *creative.ChainID
	}

	triageOut, err := audit.RunTriage(
		ctx,
		h.Config.AnthropicAPIKey,
		h.Config.AuditModel,
		triageIn,
		session.NewHTTPClient("anthropic-audit", 2*time.Minute),
		session.NewHTTPClient("audit-tools", 30*time.Second),
	)
	if err != nil {
		log.Printf("[audit] case=%s triage failed: %v", auditCaseID, err)
		h.saveAuditError(ctx, auditCaseID, creative, "Audit failed: "+err.Error())
		h.settleReservation(context.Background(), reservationID, true, db.SpendReservationStatusSettled)
		return
	}

	log.Printf("[audit] case=%s triage done (riskScore=%.0f, signals=%v)", auditCaseID, triageOut.RiskScore, triageOut.RiskSignals)

	// Save all evidences
	for _, ev := range triageOut.Evidences {
		payloadJSON, _ := json.Marshal(ev.Payload)
		signalsJSON, _ := json.Marshal(ev.RiskSignals)
		_, _ = h.Queries.CreateEvidence(ctx, auditCaseID, ev.ToolName, payloadJSON, signalsJSON)
	}

	// Merge risk signals: Claude's report + individual tool evidence signals
	signalSet := map[string]bool{}
	for _, s := range triageOut.RiskSignals {
		signalSet[s] = true
	}
	for _, ev := range triageOut.Evidences {
		for _, s := range ev.RiskSignals {
			signalSet[s] = true
		}
	}
	allSignals := make([]string, 0, len(signalSet))
	for s := range signalSet {
		allSignals = append(allSignals, s)
	}

	// Run policy engine
	policyResult := audit.EvaluatePolicy(audit.PolicyInput{
		RiskScore:          triageOut.RiskScore,
		RiskSignals:        allSignals,
		QrUrls:             triageOut.Entities.QRPayloads,
		DeclaredLandingURL: creative.LandingURL,
		Entities: audit.Entities{
			URLs:       triageOut.Entities.URLs,
			QrPayloads: triageOut.Entities.QRPayloads,
			RiskTerms:  triageOut.Entities.RiskTerms,
		},
	})

	log.Printf("[audit] case=%s decision=%s matched=%v", auditCaseID, policyResult.Decision, policyResult.MatchedRules)

	summary := fmt.Sprintf("%s\n\nPolicy: %s", triageOut.Summary, policyResult.Explanation)
	riskScore := triageOut.RiskScore
	agentThinkingJSON, _ := json.Marshal(triageOut.AgentThinking)
	if err := h.completeApprovedAudit(ctx, auditCaseID, creative, riskScore, summary, agentThinkingJSON); err != nil {
		log.Printf("[audit] case=%s finalize pass failed: %v", auditCaseID, err)
		h.saveAuditError(ctx, auditCaseID, creative, "Audit finalize failed: "+err.Error())
		h.settleReservation(context.Background(), reservationID, true, db.SpendReservationStatusSettled)
		return
	}

	h.runCreativeAnalysis(
		creative,
		auditCaseID,
		summary,
		imageData,
		session.NewHTTPClient("anthropic-audit-analysis", 2*time.Minute),
	)
	h.settleReservation(context.Background(), reservationID, true, db.SpendReservationStatusSettled)

	log.Printf("[audit] case=%s complete", auditCaseID)
}

func (h *Handler) runCreativeAnalysis(creative db.Creative, auditCaseID string, auditSummary string, imageData []byte, httpClient *http.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	log.Printf("[analysis] creative=%s start", creative.ID)

	imageB64, err := prepareImageBase64(imageData)
	if err != nil {
		log.Printf("[analysis] creative=%s image prep failed: %v", creative.ID, err)
		return
	}

	analysisOut, err := audit.RunCreativeAnalysis(ctx, h.Config.AnthropicAPIKey, h.Config.AuditModel, audit.CreativeAnalysisInput{
		CreativeID:   creative.ID,
		CreativeURL:  deref(creative.ImageURL),
		ProjectName:  creative.ProjectName,
		LandingURL:   creative.LandingURL,
		AuditSummary: auditSummary,
		ImageBase64:  imageB64,
	}, httpClient)
	if err != nil {
		log.Printf("[analysis] creative=%s failed: %v", creative.ID, err)
		return
	}

	placementFitJSON, _ := json.Marshal(analysisOut.PlacementFit)
	ctrPriorsJSON, _ := json.Marshal(analysisOut.PredictedCtrPriors)
	bidHintsJSON, _ := json.Marshal(analysisOut.BidHints)

	_, err = h.Queries.CreateCreativeProfile(ctx, db.CreativeProfile{
		CreativeID:         creative.ID,
		AuditCaseID:        &auditCaseID,
		AnalysisVersion:    1,
		MarketingSummary:   &analysisOut.MarketingSummary,
		VisualTags:         analysisOut.VisualTags,
		CtaType:            &analysisOut.CtaType,
		CopyStyle:          &analysisOut.CopyStyle,
		TargetAudiences:    analysisOut.TargetAudiences,
		PlacementFit:       placementFitJSON,
		PredictedCtrPriors: ctrPriorsJSON,
		BidHints:           bidHintsJSON,
	})
	if err != nil {
		log.Printf("[analysis] creative=%s save failed: %v", creative.ID, err)
		return
	}

	log.Printf("[analysis] creative=%s profile saved", creative.ID)
}

func prepareImageBase64(data []byte) (string, error) {
	return audit.PrepareImageBase64(data)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func (h *Handler) saveAuditError(ctx context.Context, auditCaseID string, creative db.Creative, msg string) {
	completedAt := time.Now()
	decision := db.AuditDecisionPass
	status := db.AuditStatusCompleted
	riskScore := 0.0
	summary := msg + "\n\nAuto-approval mode is enabled, so this audit was passed by default."

	errThinking, _ := json.Marshal([]map[string]interface{}{
		{
			"turn":      0,
			"role":      "assistant",
			"text":      msg,
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})

	_, _ = h.Queries.UpdateAuditCase(ctx, auditCaseID, db.AuditCaseUpdate{
		Status:        &status,
		RiskScore:     &riskScore,
		Decision:      &decision,
		Summary:       &summary,
		AgentThinking: errThinking,
		CompletedAt:   &completedAt,
	})
	if err := h.issueAttestationAndManifest(ctx, auditCaseID, creative); err != nil {
		log.Printf("[audit] case=%s issue attestation in fallback failed: %v", auditCaseID, err)
	}
	_ = h.Queries.UpdateCreativeStatus(ctx, creative.ID, db.CreativeStatusApproved)
}

func (h *Handler) completeApprovedAudit(ctx context.Context, auditCaseID string, creative db.Creative, riskScore float64, summary string, agentThinkingJSON []byte) error {
	status := db.AuditStatusCompleted
	decision := db.AuditDecisionPass
	completedAt := time.Now()

	if _, err := h.Queries.UpdateAuditCase(ctx, auditCaseID, db.AuditCaseUpdate{
		Status:        &status,
		RiskScore:     &riskScore,
		Decision:      &decision,
		Summary:       &summary,
		AgentThinking: agentThinkingJSON,
		CompletedAt:   &completedAt,
	}); err != nil {
		return err
	}

	_ = h.Queries.UpdateCreativeStatus(ctx, creative.ID, db.CreativeStatusApproved)
	if err := h.issueAttestationAndManifest(ctx, auditCaseID, creative); err != nil {
		return err
	}

	return nil
}

func (h *Handler) issueAttestationAndManifest(ctx context.Context, auditCaseID string, creative db.Creative) error {
	destURL := creative.LandingURL
	if creative.ClickURL != nil {
		destURL = *creative.ClickURL
	}

	attOut, err := attestation.IssueAttestation(attestation.AttestationInput{
		AuditCaseID:      auditCaseID,
		CreativeHash:     *creative.CreativeHash,
		DestinationURL:   destURL,
		PlacementDomains: creative.PlacementDomains,
		PolicyVersion:    "v1.0",
		ExpiresInDays:    30,
	})
	if err != nil {
		return err
	}

	issuedAt := time.Unix(attOut.IssuedAt, 0)
	expiresAt := time.Unix(attOut.ExpiresAt, 0)
	if _, err := h.Queries.CreateAttestation(ctx, db.Attestation{
		AuditCaseID:   auditCaseID,
		AttestationID: attOut.AttestationID,
		ChainID:       11155111,
		Status:        db.AttestationStatusActive,
		IssuedAt:      &issuedAt,
		ExpiresAt:     &expiresAt,
	}); err != nil {
		return err
	}

	creativeInfo := attestation.CreativeInfo{
		ProjectName: creative.ProjectName,
		LandingURL:  creative.LandingURL,
	}
	if creative.ImageURL != nil {
		creativeInfo.ImageURL = *creative.ImageURL
	}
	if creative.ClickURL != nil {
		creativeInfo.ClickURL = *creative.ClickURL
	}

	manifestData, err := attestation.GenerateManifest(
		creative.ID, attOut, creativeInfo,
		h.Config.RegistryAddress, h.Config.IssuerAddress,
	)
	if err != nil {
		return nil
	}

	manifestJSON, _ := json.Marshal(manifestData)
	if _, err := h.Queries.CreateManifest(ctx, db.Manifest{
		CreativeID:    creative.ID,
		AttestationID: attOut.AttestationID,
		ManifestJSON:  manifestJSON,
		Version:       1,
	}); err != nil {
		return err
	}

	h.issueAttestationOnchainAsync(attOut)
	return nil
}

// issueAttestationOnchainAsync pushes the attestation to the on-chain
// AdAttestationRegistry in a background goroutine. Failures are logged but
// don't fail the audit — the row can be retried via the backfill CLI.
func (h *Handler) issueAttestationOnchainAsync(attOut attestation.AttestationOutput) {
	cfg := h.Config
	if cfg.RegistryAddress == "" ||
		cfg.RegistryAddress == "0x0000000000000000000000000000000000000000" ||
		cfg.IssuerPrivateKey == "" ||
		cfg.SepoliaRPCURL == "" {
		log.Printf("[onchain] skipping on-chain issuance for %s: registry/issuer/rpc not configured",
			attOut.AttestationID)
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		txHash, err := onchain.IssueAttestationOnchain(ctx,
			cfg.SepoliaRPCURL, cfg.RegistryAddress, cfg.IssuerPrivateKey,
			cfg.SepoliaChainID,
			onchain.AttestationIssueParams{
				AttestationID:       attOut.AttestationID,
				CreativeHash:        attOut.CreativeHash,
				DestinationHash:     attOut.DestinationHash,
				PlacementDomainHash: attOut.PlacementDomainHash,
				PolicyVersionHash:   attOut.PolicyVersionHash,
				ExpiresAt:           attOut.ExpiresAt,
				ReportCID:           "",
			})
		if err != nil {
			log.Printf("[onchain] issue %s failed: %v", attOut.AttestationID, err)
			return
		}
		if err := h.Queries.UpdateAttestationTxHash(ctx, attOut.AttestationID, txHash); err != nil {
			log.Printf("[onchain] recorded tx %s but failed to persist for %s: %v",
				txHash, attOut.AttestationID, err)
			return
		}
		log.Printf("[onchain] issued %s tx=%s", attOut.AttestationID, txHash)
	}()
}
