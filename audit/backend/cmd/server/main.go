package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/handler"
	"github.com/zkdsp/audit-backend/internal/onchain"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()

	queries := db.NewQueries(pool)
	h := handler.New(queries, cfg)
	if watcher, err := onchain.NewSepoliaDepositWatcher(cfg, queries); err != nil {
		log.Printf("[billing] sepolia deposit watcher disabled: %v", err)
	} else {
		watcher.Start(ctx)
		log.Printf("[billing] sepolia deposit watcher started treasury=%s token=%s", cfg.SepoliaTreasuryAddress, cfg.SepoliaUSDCAddress)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(handler.CORSMiddleware(cfg.AllowedOrigins))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	// Public routes (no auth)
	r.Post("/api/auth/login", h.Login)
	r.Post("/api/publisher/auth/login", h.PublisherLogin)
	r.Post("/api/ops/auth/login", h.OpsLogin)
	r.Post("/api/sdk/verify", h.SDKVerify)
	r.Get("/api/manifests/{id}", h.GetManifest)
	r.Post("/api/ad-slot/request", h.RequestAdSlot)
	r.Get("/api/ad-slot/result/{id}", h.GetAdSlotResult)
	r.Post("/api/ad-slot/click/{id}", h.TrackAdClick)
	r.Post("/api/assistant/chat", h.AssistantChat)

	// Protected routes (require JWT)
	r.Group(func(r chi.Router) {
		r.Use(handler.AuthMiddleware)

		// Auth
		r.Get("/api/auth/me", h.GetMe)
		r.Get("/api/billing/balance", h.GetBillingBalance)
		r.Get("/api/billing/ledger", h.ListBillingLedger)
		r.Get("/api/billing/wallet", h.GetBillingWallet)
		r.Get("/api/billing/wallet/link-challenge", h.GetBillingWalletLinkChallenge)
		r.Post("/api/billing/wallet/link", h.LinkBillingWallet)
		r.Post("/api/billing/claim-deposit", h.ClaimBillingDeposit)
		r.Post("/api/billing/topups", h.CreateBillingTopUp)

		// Creatives (scoped to advertiser)
		r.Post("/api/creatives", h.CreateCreative)
		r.Get("/api/creatives", h.ListCreatives)
		r.Get("/api/creatives/{id}", h.GetCreative)
		r.Delete("/api/creatives/{id}", h.DeleteCreative)
		r.Post("/api/creatives/{id}/submit-audit", h.SubmitAudit)

		// AI-generated creatives
		r.Post("/api/creatives/generate", h.GenerateCreative)
		r.Get("/api/creatives/{id}/generation-status", h.GetGenerationStatus)
		r.Get("/api/brand-kits", h.ListBrandKits)
		r.Post("/api/brand-kits", h.CreateBrandKit)
		r.Patch("/api/brand-kits/{id}", h.UpdateBrandKit)
		r.Delete("/api/brand-kits/{id}", h.DeleteBrandKit)
		r.Get("/api/creative-studio/runs", h.ListCreativeStudioRuns)
		r.Get("/api/creative-studio/runs/{id}", h.GetCreativeStudioRun)
		r.Post("/api/creative-studio/runs", h.CreateCreativeStudioRun)

		// Audit Cases
		r.Get("/api/audit-cases", h.ListAuditCases)
		r.Get("/api/audit-cases/{id}", h.GetAuditCase)

		// Creative Profiles
		r.Get("/api/creative-profiles/{creativeId}", h.GetCreativeProfile)
		r.Get("/api/creative-lab", h.GetCreativeLab)

		// Bidder Agents
		r.Get("/api/bidder-agents", h.ListBidderAgents)
		r.Post("/api/bidder-agents", h.CreateBidderAgent)
		r.Get("/api/bidder-agents/{id}", h.GetBidderAgentDetail)
		r.Patch("/api/bidder-agents/{id}", h.UpdateBidderAgent)
		r.Delete("/api/bidder-agents/{id}", h.DeleteBidderAgent)

		// Bidder Library (per-advertiser strategy templates + agent skills)
		r.Get("/api/bidder-library/templates", h.ListStrategyTemplates)
		r.Post("/api/bidder-library/templates", h.CreateStrategyTemplate)
		r.Patch("/api/bidder-library/templates/{id}", h.UpdateStrategyTemplate)
		r.Delete("/api/bidder-library/templates/{id}", h.DeleteStrategyTemplate)
		r.Get("/api/bidder-library/skills", h.ListAgentSkills)
		r.Post("/api/bidder-library/skills", h.CreateAgentSkill)
		r.Patch("/api/bidder-library/skills/{id}", h.UpdateAgentSkill)
		r.Delete("/api/bidder-library/skills/{id}", h.DeleteAgentSkill)

		// Auctions
		r.Get("/api/auctions", h.ListAuctions)
		r.Get("/api/auctions/{id}", h.GetAuction)
		r.Post("/api/simulation-runs", h.RunSimulation)

		// Analyst
		r.Get("/api/analyst/stats", h.GetPerformanceStats)
		r.Post("/api/analyst/analyze", h.RunAnalysis)

		// Reports
		r.Get("/api/reports/hourly", h.GetHourlyReport)

		// Certificates
		r.Get("/api/certificates", h.ListCertificates)

		// Support tickets (works for advertisers + publishers)
		r.Post("/api/support/tickets", h.CreateSupportTicket)
		r.Get("/api/support/tickets", h.ListSupportTickets)
		r.Get("/api/support/tickets/{id}", h.GetSupportTicket)
		r.Post("/api/support/tickets/{id}/messages", h.AppendSupportMessage)

		// Ops-only routes (manual-review console)
		r.Group(func(r chi.Router) {
			r.Use(handler.RequireOpsMiddleware)
			r.Get("/api/ops/me", h.GetOpsMe)
			r.Get("/api/ops/audit-queue", h.ListOpsAuditQueue)
			r.Get("/api/ops/audit-cases/{id}", h.GetOpsAuditCase)
			r.Patch("/api/ops/audit-cases/{id}", h.PatchOpsAuditCase)
			r.Get("/api/ops/audit-reviews", h.ListOpsReviewHistory)
		})

		// Publisher-only routes
		r.Group(func(r chi.Router) {
			r.Use(handler.RequirePublisherMiddleware)
			r.Get("/api/publisher/me", h.GetPublisherMe)
			r.Get("/api/publisher/billing/wallet", h.GetPublisherBillingWallet)
			r.Get("/api/publisher/billing/wallet/link-challenge", h.GetPublisherWalletLinkChallenge)
			r.Post("/api/publisher/billing/wallet/link", h.LinkPublisherWallet)
			r.Get("/api/publisher/earnings", h.GetPublisherEarnings)
			r.Get("/api/publisher/earnings/events", h.ListPublisherEarningEvents)
			r.Post("/api/publisher/claim/prepare", h.PreparePublisherClaim)
			r.Post("/api/publisher/claim/confirm", h.ConfirmPublisherClaim)
			r.Get("/api/publisher/claims", h.ListPublisherClaims)
		})
	})

	// Static uploads
	r.Get("/uploads/*", h.ServeUpload)

	// Ad test page (serve from project root /public/)
	r.Get("/ad-test", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../public/ad-test.html")
	})

	addr := ":" + cfg.Port
	log.Printf("ZKDSP Audit+DSP Go backend listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
