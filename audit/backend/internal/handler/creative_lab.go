package handler

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/zkdsp/audit-backend/internal/db"
)

type CreativeLabStats struct {
	Impressions int     `json:"impressions"`
	Clicks      int     `json:"clicks"`
	CTR         float64 `json:"ctr"`
}

type CreativeLabAuditSummary struct {
	ID          string            `json:"id"`
	Status      db.AuditStatus    `json:"status"`
	Decision    *db.AuditDecision `json:"decision"`
	RiskScore   *float64          `json:"riskScore"`
	Summary     *string           `json:"summary"`
	SubmittedAt time.Time         `json:"submittedAt"`
	CompletedAt *time.Time        `json:"completedAt"`
}

type CreativeLabItem struct {
	Creative    db.Creative              `json:"creative"`
	Profile     *db.CreativeProfile      `json:"profile,omitempty"`
	LatestAudit *CreativeLabAuditSummary `json:"latestAudit,omitempty"`
	Stats       CreativeLabStats         `json:"stats"`
	Health      string                   `json:"health"`
}

type CreativeLabResponse struct {
	Items       []CreativeLabItem `json:"items"`
	GeneratedAt time.Time         `json:"generatedAt"`
}

func (h *Handler) GetCreativeLab(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	creatives, err := h.Queries.ListCreativesByAdvertiser(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to load creatives: "+err.Error())
		return
	}

	creativeByID := make(map[string]db.Creative, len(creatives))
	for _, creative := range creatives {
		creativeByID[creative.ID] = creative
	}

	selectedIDs := parseCreativeLabIDs(r.URL.Query().Get("ids"))
	if len(selectedIDs) == 0 {
		for _, creative := range creatives {
			selectedIDs = append(selectedIDs, creative.ID)
			if len(selectedIDs) == 3 {
				break
			}
		}
	}
	if len(selectedIDs) == 0 {
		writeJSON(w, 200, CreativeLabResponse{
			Items:       []CreativeLabItem{},
			GeneratedAt: time.Now().UTC(),
		})
		return
	}

	items := make([]CreativeLabItem, 0, len(selectedIDs))
	for _, creativeID := range selectedIDs {
		creative, ok := creativeByID[creativeID]
		if !ok {
			writeError(w, 404, "Creative not found in advertiser scope")
			return
		}

		impressions, clicks, err := h.Queries.GetCreativeStats(r.Context(), creativeID)
		if err != nil {
			writeError(w, 500, "Failed to load creative stats: "+err.Error())
			return
		}

		var profile *db.CreativeProfile
		profileData, err := h.Queries.GetCreativeProfile(r.Context(), creativeID)
		if err == nil {
			profile = &profileData
		} else if !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, 500, "Failed to load creative profile: "+err.Error())
			return
		}

		var latestAudit *CreativeLabAuditSummary
		auditCase, err := h.Queries.GetLastAuditCaseForCreative(r.Context(), creativeID)
		if err == nil {
			latestAudit = &CreativeLabAuditSummary{
				ID:          auditCase.ID,
				Status:      auditCase.Status,
				Decision:    auditCase.Decision,
				RiskScore:   auditCase.RiskScore,
				Summary:     auditCase.Summary,
				SubmittedAt: auditCase.SubmittedAt,
				CompletedAt: auditCase.CompletedAt,
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, 500, "Failed to load audit summary: "+err.Error())
			return
		}

		ctr := 0.0
		if impressions > 0 {
			ctr = float64(clicks) / float64(impressions)
		}

		items = append(items, CreativeLabItem{
			Creative:    creative,
			Profile:     profile,
			LatestAudit: latestAudit,
			Stats: CreativeLabStats{
				Impressions: impressions,
				Clicks:      clicks,
				CTR:         ctr,
			},
			Health: deriveCreativeLabHealth(creative.Status, latestAudit),
		})
	}

	writeJSON(w, 200, CreativeLabResponse{
		Items:       items,
		GeneratedAt: time.Now().UTC(),
	})
}

func parseCreativeLabIDs(raw string) []string {
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	ids := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		id := strings.TrimSpace(part)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) == 4 {
			break
		}
	}
	return ids
}

func deriveCreativeLabHealth(status db.CreativeStatus, auditSummary *CreativeLabAuditSummary) string {
	if auditSummary != nil {
		if auditSummary.Decision != nil {
			switch *auditSummary.Decision {
			case db.AuditDecisionPass:
				if auditSummary.RiskScore != nil && *auditSummary.RiskScore <= 30 {
					return "Ready to scale"
				}
				return "Approved with caution"
			case db.AuditDecisionReject:
				return "Needs revision"
			case db.AuditDecisionManualReview:
				return "Needs manual review"
			}
		}

		if auditSummary.Status != db.AuditStatusCompleted {
			return "Audit in progress"
		}
	}

	switch status {
	case db.CreativeStatusApproved:
		return "Approved asset"
	case db.CreativeStatusRejected:
		return "Blocked asset"
	case db.CreativeStatusPendingAudit, db.CreativeStatusAuditing:
		return "Pending clearance"
	default:
		return "Draft candidate"
	}
}
