package main

import (
	"context"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/handler"
)

func main() {
	cfg := config.Load()

	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()

	queries := db.NewQueries(pool)
	h := handler.New(queries, cfg)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(handler.CORSMiddleware(cfg.AllowedOrigins))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	// Public routes (no auth)
	r.Post("/api/auth/login", h.Login)
	r.Post("/api/sdk/verify", h.SDKVerify)
	r.Get("/api/manifests/{id}", h.GetManifest)
	r.Post("/api/ad-slot/request", h.RequestAdSlot)
	r.Get("/api/ad-slot/result/{id}", h.GetAdSlotResult)
	r.Post("/api/ad-slot/click/{id}", h.TrackAdClick)

	// Protected routes (require JWT)
	r.Group(func(r chi.Router) {
		r.Use(handler.AuthMiddleware)

		// Auth
		r.Get("/api/auth/me", h.GetMe)

		// Creatives (scoped to advertiser)
		r.Post("/api/creatives", h.CreateCreative)
		r.Get("/api/creatives", h.ListCreatives)
		r.Get("/api/creatives/{id}", h.GetCreative)
		r.Delete("/api/creatives/{id}", h.DeleteCreative)
		r.Post("/api/creatives/{id}/submit-audit", h.SubmitAudit)

		// AI-generated creatives
		r.Post("/api/creatives/generate", h.GenerateCreative)
		r.Get("/api/creatives/{id}/generation-status", h.GetGenerationStatus)

		// Audit Cases
		r.Get("/api/audit-cases", h.ListAuditCases)
		r.Get("/api/audit-cases/{id}", h.GetAuditCase)

		// Creative Profiles
		r.Get("/api/creative-profiles/{creativeId}", h.GetCreativeProfile)

		// Bidder Agents
		r.Get("/api/bidder-agents", h.ListBidderAgents)
		r.Get("/api/bidder-agents/{id}", h.GetBidderAgentDetail)
		r.Patch("/api/bidder-agents/{id}", h.UpdateBidderAgent)

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
