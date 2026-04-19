// Command attestation-backfill pushes every attestation that has no
// tx_hash yet to the on-chain AdAttestationRegistry. Reuses the same ABI
// client as the live submit path so the resulting on-chain state matches
// what a fresh audit would produce.
//
// Requires env: DATABASE_URL, REGISTRY_ADDRESS, ISSUER_PRIVATE_KEY,
// SEPOLIA_RPC_URL (defaults applied by config.Load if unset).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"log"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/onchain"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "log what would happen without sending tx")
	flag.Parse()

	cfg := config.Load()
	if cfg.RegistryAddress == "" || cfg.RegistryAddress == "0x0000000000000000000000000000000000000000" {
		log.Fatalf("REGISTRY_ADDRESS not configured")
	}
	if cfg.IssuerPrivateKey == "" {
		log.Fatalf("ISSUER_PRIVATE_KEY not configured")
	}
	if cfg.SepoliaRPCURL == "" {
		log.Fatalf("SEPOLIA_RPC_URL not configured")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()
	queries := db.NewQueries(pool)

	rows, err := queries.ListAttestationsMissingTxHash(ctx)
	if err != nil {
		log.Fatalf("list attestations: %v", err)
	}
	log.Printf("[backfill] %d attestations missing tx_hash", len(rows))

	now := time.Now().Unix()
	success := 0
	skipped := 0
	failed := 0

	for _, att := range rows {
		if att.ExpiresAt != nil && att.ExpiresAt.Unix() <= now {
			log.Printf("[backfill] skip %s: already expired at %s", att.AttestationID, att.ExpiresAt.Format(time.RFC3339))
			skipped++
			continue
		}

		_, creative, err := queries.GetAttestationForVerify(ctx, att.AttestationID)
		if err != nil {
			log.Printf("[backfill] skip %s: load creative failed: %v", att.AttestationID, err)
			skipped++
			continue
		}
		if creative.CreativeHash == nil || *creative.CreativeHash == "" {
			log.Printf("[backfill] skip %s: creative_hash empty", att.AttestationID)
			skipped++
			continue
		}

		destURL := creative.LandingURL
		if creative.ClickURL != nil && *creative.ClickURL != "" {
			destURL = *creative.ClickURL
		}

		domains := make([]string, len(creative.PlacementDomains))
		copy(domains, creative.PlacementDomains)
		sort.Strings(domains)

		params := onchain.AttestationIssueParams{
			AttestationID:       att.AttestationID,
			CreativeHash:        *creative.CreativeHash,
			DestinationHash:     sha256Hex(destURL),
			PlacementDomainHash: sha256Hex(strings.Join(domains, ",")),
			PolicyVersionHash:   sha256Hex("v1.0"),
			ExpiresAt:           att.ExpiresAt.Unix(),
			ReportCID:           "",
		}

		if *dryRun {
			log.Printf("[dry-run] would issue %s (creative=%s dest=%s)",
				att.AttestationID, creative.ID, destURL)
			success++
			continue
		}

		txCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		txHash, err := onchain.IssueAttestationOnchain(txCtx,
			cfg.SepoliaRPCURL, cfg.RegistryAddress, cfg.IssuerPrivateKey,
			cfg.SepoliaChainID, params)
		cancel()
		if err != nil {
			log.Printf("[backfill] FAIL %s: %v", att.AttestationID, err)
			failed++
			continue
		}
		if err := queries.UpdateAttestationTxHash(ctx, att.AttestationID, txHash); err != nil {
			log.Printf("[backfill] issued %s tx=%s but persist failed: %v",
				att.AttestationID, txHash, err)
			failed++
			continue
		}
		log.Printf("[backfill] OK %s tx=%s", att.AttestationID, txHash)
		success++
	}

	log.Printf("[backfill] done: success=%d skipped=%d failed=%d", success, skipped, failed)
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return "0x" + hex.EncodeToString(h[:])
}
