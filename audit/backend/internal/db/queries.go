package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Queries provides database access methods wrapping a pgxpool.Pool.
type Queries struct {
	Pool *pgxpool.Pool
}

// NewQueries creates a new Queries instance.
func NewQueries(pool *pgxpool.Pool) *Queries {
	return &Queries{Pool: pool}
}

// newID generates a cuid-like identifier: "c" + 24 random hex characters.
func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return "c" + hex.EncodeToString(b)
}

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

// GetOrCreateDefaultAdvertiser finds the first advertiser or creates one named
// "Default Advertiser" with email "demo@zkdsp.io".
func (q *Queries) GetOrCreateDefaultAdvertiser(ctx context.Context) (Advertiser, error) {
	const selectSQL = `
		SELECT id, name, wallet_address, contact_email, created_at
		FROM advertisers
		ORDER BY created_at ASC
		LIMIT 1`

	var a Advertiser
	err := q.Pool.QueryRow(ctx, selectSQL).Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.CreatedAt,
	)
	if err == nil {
		return a, nil
	}
	if err != pgx.ErrNoRows {
		return Advertiser{}, fmt.Errorf("query advertiser: %w", err)
	}

	// No advertiser exists — create the default.
	const insertSQL = `
		INSERT INTO advertisers (id, name, contact_email)
		VALUES ($1, $2, $3)
		RETURNING id, name, wallet_address, contact_email, created_at`

	a = Advertiser{}
	err = q.Pool.QueryRow(ctx, insertSQL, newID(), "Default Advertiser", "demo@zkdsp.io").Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.CreatedAt,
	)
	if err != nil {
		return Advertiser{}, fmt.Errorf("insert default advertiser: %w", err)
	}
	return a, nil
}

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

// ListCreatives returns all creatives ordered by created_at DESC, each with
// its latest audit case (if any) joined.
func (q *Queries) ListCreatives(ctx context.Context) ([]Creative, error) {
	const sql = `
		SELECT
			c.id, c.advertiser_id, c.creative_name, c.project_name,
			c.image_url, c.creative_hash, c.landing_url, c.telegram_url,
			c.click_url, c.chain_id, c.contract_address, c.placement_domains,
			c.notes, c.status, c.created_at, c.updated_at,
			ac.id, ac.creative_id, ac.status, ac.risk_score, ac.decision,
			ac.policy_version, ac.summary, ac.agent_thinking,
			ac.submitted_at, ac.completed_at
		FROM creatives c
		LEFT JOIN LATERAL (
			SELECT * FROM audit_cases
			WHERE creative_id = c.id
			ORDER BY submitted_at DESC
			LIMIT 1
		) ac ON true
		ORDER BY c.created_at DESC`

	rows, err := q.Pool.Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("list creatives: %w", err)
	}
	defer rows.Close()

	var creatives []Creative
	for rows.Next() {
		var c Creative
		var (
			acID            *string
			acCreativeID    *string
			acStatus        *AuditStatus
			acRiskScore     *float64
			acDecision      *AuditDecision
			acPolicyVersion *string
			acSummary       *string
			acThinking      json.RawMessage
			acSubmittedAt   *time.Time
			acCompletedAt   *time.Time
		)
		if err := rows.Scan(
			&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
			&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
			&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
			&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
			&acID, &acCreativeID, &acStatus, &acRiskScore, &acDecision,
			&acPolicyVersion, &acSummary, &acThinking,
			&acSubmittedAt, &acCompletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan creative row: %w", err)
		}

		if acID != nil {
			c.AuditCases = []AuditCase{{
				ID:            *acID,
				CreativeID:    *acCreativeID,
				Status:        *acStatus,
				RiskScore:     acRiskScore,
				Decision:      acDecision,
				PolicyVersion: *acPolicyVersion,
				Summary:       acSummary,
				AgentThinking: acThinking,
				SubmittedAt:   *acSubmittedAt,
				CompletedAt:   acCompletedAt,
			}}
		}

		creatives = append(creatives, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate creatives: %w", err)
	}
	return creatives, nil
}

// GetCreative returns a single creative by ID together with all audit cases
// (each populated with evidences and attestation) and manifests.
func (q *Queries) GetCreative(ctx context.Context, id string) (Creative, error) {
	// 1. Fetch the creative itself.
	const creativeSQL = `
		SELECT id, advertiser_id, creative_name, project_name,
		       image_url, creative_hash, landing_url, telegram_url,
		       click_url, chain_id, contract_address, placement_domains,
		       notes, status, created_at, updated_at
		FROM creatives WHERE id = $1`

	var c Creative
	err := q.Pool.QueryRow(ctx, creativeSQL, id).Scan(
		&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
		&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
		&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
		&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return Creative{}, fmt.Errorf("get creative %s: %w", id, err)
	}

	// 2. Fetch audit cases for this creative.
	const casesSQL = `
		SELECT id, creative_id, status, risk_score, decision,
		       policy_version, summary, agent_thinking,
		       submitted_at, completed_at
		FROM audit_cases WHERE creative_id = $1
		ORDER BY submitted_at DESC`

	caseRows, err := q.Pool.Query(ctx, casesSQL, id)
	if err != nil {
		return Creative{}, fmt.Errorf("query audit cases for creative %s: %w", id, err)
	}
	defer caseRows.Close()

	var cases []AuditCase
	var caseIDs []string
	for caseRows.Next() {
		var ac AuditCase
		if err := caseRows.Scan(
			&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
			&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
			&ac.SubmittedAt, &ac.CompletedAt,
		); err != nil {
			return Creative{}, fmt.Errorf("scan audit case: %w", err)
		}
		cases = append(cases, ac)
		caseIDs = append(caseIDs, ac.ID)
	}
	if err := caseRows.Err(); err != nil {
		return Creative{}, fmt.Errorf("iterate audit cases: %w", err)
	}

	// 3. Fetch evidences for all audit cases in one query.
	if len(caseIDs) > 0 {
		const evidencesSQL = `
			SELECT id, audit_case_id, tool_name, payload, risk_signals, created_at
			FROM audit_evidences
			WHERE audit_case_id = ANY($1)
			ORDER BY created_at ASC`

		evRows, err := q.Pool.Query(ctx, evidencesSQL, caseIDs)
		if err != nil {
			return Creative{}, fmt.Errorf("query evidences: %w", err)
		}
		defer evRows.Close()

		evidenceMap := make(map[string][]AuditEvidence)
		for evRows.Next() {
			var ev AuditEvidence
			if err := evRows.Scan(
				&ev.ID, &ev.AuditCaseID, &ev.ToolName,
				&ev.Payload, &ev.RiskSignals, &ev.CreatedAt,
			); err != nil {
				return Creative{}, fmt.Errorf("scan evidence: %w", err)
			}
			evidenceMap[ev.AuditCaseID] = append(evidenceMap[ev.AuditCaseID], ev)
		}
		if err := evRows.Err(); err != nil {
			return Creative{}, fmt.Errorf("iterate evidences: %w", err)
		}

		// 4. Fetch attestations for all audit cases in one query.
		const attestationsSQL = `
			SELECT id, audit_case_id, attestation_id, chain_id, tx_hash,
			       status, report_cid, issued_at, expires_at, created_at
			FROM attestations
			WHERE audit_case_id = ANY($1)`

		attRows, err := q.Pool.Query(ctx, attestationsSQL, caseIDs)
		if err != nil {
			return Creative{}, fmt.Errorf("query attestations: %w", err)
		}
		defer attRows.Close()

		attMap := make(map[string]*Attestation)
		for attRows.Next() {
			var att Attestation
			if err := attRows.Scan(
				&att.ID, &att.AuditCaseID, &att.AttestationID, &att.ChainID,
				&att.TxHash, &att.Status, &att.ReportCID,
				&att.IssuedAt, &att.ExpiresAt, &att.CreatedAt,
			); err != nil {
				return Creative{}, fmt.Errorf("scan attestation: %w", err)
			}
			attMap[att.AuditCaseID] = &att
		}
		if err := attRows.Err(); err != nil {
			return Creative{}, fmt.Errorf("iterate attestations: %w", err)
		}

		// Stitch evidences and attestation onto each case.
		for i := range cases {
			cases[i].Evidences = evidenceMap[cases[i].ID]
			if att, ok := attMap[cases[i].ID]; ok {
				cases[i].Attestation = att
			}
		}
	}
	c.AuditCases = cases

	// 5. Fetch manifests.
	const manifestsSQL = `
		SELECT id, creative_id, attestation_id, manifest_json, version, created_at
		FROM manifests WHERE creative_id = $1
		ORDER BY version DESC`

	mRows, err := q.Pool.Query(ctx, manifestsSQL, id)
	if err != nil {
		return Creative{}, fmt.Errorf("query manifests for creative %s: %w", id, err)
	}
	defer mRows.Close()

	for mRows.Next() {
		var m Manifest
		if err := mRows.Scan(
			&m.ID, &m.CreativeID, &m.AttestationID,
			&m.ManifestJSON, &m.Version, &m.CreatedAt,
		); err != nil {
			return Creative{}, fmt.Errorf("scan manifest: %w", err)
		}
		c.Manifests = append(c.Manifests, m)
	}
	if err := mRows.Err(); err != nil {
		return Creative{}, fmt.Errorf("iterate manifests: %w", err)
	}

	return c, nil
}

// CreateCreative inserts a new creative and returns it with its generated ID.
func (q *Queries) CreateCreative(ctx context.Context, c Creative) (Creative, error) {
	c.ID = newID()

	const sql = `
		INSERT INTO creatives (
			id, advertiser_id, creative_name, project_name,
			image_url, creative_hash, landing_url, telegram_url,
			click_url, chain_id, contract_address, placement_domains,
			notes, status
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8,
			$9, $10, $11, $12,
			$13, $14
		)
		RETURNING id, advertiser_id, creative_name, project_name,
		          image_url, creative_hash, landing_url, telegram_url,
		          click_url, chain_id, contract_address, placement_domains,
		          notes, status, created_at, updated_at`

	var out Creative
	err := q.Pool.QueryRow(ctx, sql,
		c.ID, c.AdvertiserID, c.CreativeName, c.ProjectName,
		c.ImageURL, c.CreativeHash, c.LandingURL, c.TelegramURL,
		c.ClickURL, c.ChainID, c.ContractAddress, c.PlacementDomains,
		c.Notes, c.Status,
	).Scan(
		&out.ID, &out.AdvertiserID, &out.CreativeName, &out.ProjectName,
		&out.ImageURL, &out.CreativeHash, &out.LandingURL, &out.TelegramURL,
		&out.ClickURL, &out.ChainID, &out.ContractAddress, &out.PlacementDomains,
		&out.Notes, &out.Status, &out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return Creative{}, fmt.Errorf("insert creative: %w", err)
	}
	return out, nil
}

// PatchCreativeNotes overwrites the notes field on a creative. Used by the
// generation pipeline to store brief / directive / prompt and final status.
func (q *Queries) PatchCreativeNotes(ctx context.Context, id, notes string) error {
	const sql = `UPDATE creatives SET notes = $1, updated_at = NOW() WHERE id = $2`
	_, err := q.Pool.Exec(ctx, sql, notes, id)
	return err
}

// UpdateCreativeImage sets the image_url and creative_hash on an existing creative.
// Used by the AI generation pipeline once the image is produced.
func (q *Queries) UpdateCreativeImage(ctx context.Context, id, imageURL, creativeHash string) error {
	const sql = `
		UPDATE creatives
		SET image_url = $1, creative_hash = $2, updated_at = NOW()
		WHERE id = $3`
	tag, err := q.Pool.Exec(ctx, sql, imageURL, creativeHash, id)
	if err != nil {
		return fmt.Errorf("update creative image: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("creative %s not found", id)
	}
	return nil
}

// UpdateCreativeStatus sets the status of a creative.
func (q *Queries) UpdateCreativeStatus(ctx context.Context, id string, status CreativeStatus) error {
	const sql = `
		UPDATE creatives SET status = $1, updated_at = NOW()
		WHERE id = $2`

	tag, err := q.Pool.Exec(ctx, sql, status, id)
	if err != nil {
		return fmt.Errorf("update creative status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("creative %s not found", id)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Audit Cases
// ---------------------------------------------------------------------------

// ListAuditCases returns all audit cases with a creative summary and
// attestation joined.
// ListAuditCases returns audit cases, optionally scoped to a single
// advertiser. Pass an empty advertiserID to return all cases (ops/admin view).
func (q *Queries) ListAuditCases(ctx context.Context, advertiserID string) ([]AuditCase, error) {
	base := `
		SELECT
			ac.id, ac.creative_id, ac.status, ac.risk_score, ac.decision,
			ac.policy_version, ac.summary, ac.agent_thinking,
			ac.submitted_at, ac.completed_at,
			c.id, c.creative_name, c.project_name, c.image_url,
			att.id, att.audit_case_id, att.attestation_id, att.chain_id,
			att.tx_hash, att.status, att.report_cid,
			att.issued_at, att.expires_at, att.created_at
		FROM audit_cases ac
		JOIN creatives c ON c.id = ac.creative_id
		LEFT JOIN attestations att ON att.audit_case_id = ac.id`

	var (
		rows pgx.Rows
		err  error
	)
	if advertiserID == "" {
		rows, err = q.Pool.Query(ctx, base+` ORDER BY ac.submitted_at DESC`)
	} else {
		rows, err = q.Pool.Query(ctx,
			base+` WHERE c.advertiser_id = $1 ORDER BY ac.submitted_at DESC`,
			advertiserID)
	}
	if err != nil {
		return nil, fmt.Errorf("list audit cases: %w", err)
	}
	defer rows.Close()

	var cases []AuditCase
	for rows.Next() {
		var ac AuditCase
		var cs CreativeSummary
		var (
			attID            *string
			attAuditCaseID   *string
			attAttestationID *string
			attChainID       *int
			attTxHash        *string
			attStatus        *AttestationStatus
			attReportCID     *string
			attIssuedAt      *time.Time
			attExpiresAt     *time.Time
			attCreatedAt     *time.Time
		)

		if err := rows.Scan(
			&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
			&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
			&ac.SubmittedAt, &ac.CompletedAt,
			&cs.ID, &cs.CreativeName, &cs.ProjectName, &cs.ImageURL,
			&attID, &attAuditCaseID, &attAttestationID, &attChainID,
			&attTxHash, &attStatus, &attReportCID,
			&attIssuedAt, &attExpiresAt, &attCreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit case row: %w", err)
		}

		ac.Creative = &cs

		if attID != nil {
			ac.Attestation = &Attestation{
				ID:            *attID,
				AuditCaseID:   *attAuditCaseID,
				AttestationID: *attAttestationID,
				ChainID:       *attChainID,
				TxHash:        attTxHash,
				Status:        *attStatus,
				ReportCID:     attReportCID,
				IssuedAt:      attIssuedAt,
				ExpiresAt:     attExpiresAt,
				CreatedAt:     *attCreatedAt,
			}
		}

		cases = append(cases, ac)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit cases: %w", err)
	}
	return cases, nil
}

// GetAuditCase returns a single audit case by ID with its creative, evidences
// (ordered by created_at ASC), and attestation.
func (q *Queries) GetAuditCase(ctx context.Context, id string) (AuditCase, error) {
	// 1. Fetch audit case + creative.
	const caseSQL = `
		SELECT
			ac.id, ac.creative_id, ac.status, ac.risk_score, ac.decision,
			ac.policy_version, ac.summary, ac.agent_thinking,
			ac.submitted_at, ac.completed_at,
			c.id, c.creative_name, c.project_name, c.image_url
		FROM audit_cases ac
		JOIN creatives c ON c.id = ac.creative_id
		WHERE ac.id = $1`

	var ac AuditCase
	var cs CreativeSummary
	err := q.Pool.QueryRow(ctx, caseSQL, id).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
		&cs.ID, &cs.CreativeName, &cs.ProjectName, &cs.ImageURL,
	)
	if err != nil {
		return AuditCase{}, fmt.Errorf("get audit case %s: %w", id, err)
	}
	ac.Creative = &cs

	// 2. Fetch evidences.
	const evidencesSQL = `
		SELECT id, audit_case_id, tool_name, payload, risk_signals, created_at
		FROM audit_evidences
		WHERE audit_case_id = $1
		ORDER BY created_at ASC`

	evRows, err := q.Pool.Query(ctx, evidencesSQL, id)
	if err != nil {
		return AuditCase{}, fmt.Errorf("query evidences for case %s: %w", id, err)
	}
	defer evRows.Close()

	for evRows.Next() {
		var ev AuditEvidence
		if err := evRows.Scan(
			&ev.ID, &ev.AuditCaseID, &ev.ToolName,
			&ev.Payload, &ev.RiskSignals, &ev.CreatedAt,
		); err != nil {
			return AuditCase{}, fmt.Errorf("scan evidence: %w", err)
		}
		ac.Evidences = append(ac.Evidences, ev)
	}
	if err := evRows.Err(); err != nil {
		return AuditCase{}, fmt.Errorf("iterate evidences: %w", err)
	}

	// 3. Fetch attestation.
	const attSQL = `
		SELECT id, audit_case_id, attestation_id, chain_id, tx_hash,
		       status, report_cid, issued_at, expires_at, created_at
		FROM attestations
		WHERE audit_case_id = $1`

	var att Attestation
	err = q.Pool.QueryRow(ctx, attSQL, id).Scan(
		&att.ID, &att.AuditCaseID, &att.AttestationID, &att.ChainID,
		&att.TxHash, &att.Status, &att.ReportCID,
		&att.IssuedAt, &att.ExpiresAt, &att.CreatedAt,
	)
	if err == nil {
		ac.Attestation = &att
	} else if err != pgx.ErrNoRows {
		return AuditCase{}, fmt.Errorf("query attestation for case %s: %w", id, err)
	}

	return ac, nil
}

// CreateAuditCase creates a new audit case for a creative with TRIAGING status.
func (q *Queries) CreateAuditCase(ctx context.Context, creativeID string) (AuditCase, error) {
	const sql = `
		INSERT INTO audit_cases (id, creative_id, status)
		VALUES ($1, $2, $3)
		RETURNING id, creative_id, status, risk_score, decision,
		          policy_version, summary, agent_thinking,
		          submitted_at, completed_at`

	var ac AuditCase
	err := q.Pool.QueryRow(ctx, sql, newID(), creativeID, AuditStatusTriaging).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
	)
	if err != nil {
		return AuditCase{}, fmt.Errorf("insert audit case: %w", err)
	}
	return ac, nil
}

// AuditCaseUpdate holds the mutable fields that UpdateAuditCase can set.
// Only non-nil fields are applied.
type AuditCaseUpdate struct {
	Status        *AuditStatus
	RiskScore     *float64
	Decision      *AuditDecision
	Summary       *string
	AgentThinking json.RawMessage // nil means no change
	CompletedAt   *time.Time
}

// UpdateAuditCase updates the specified fields on an audit case.
func (q *Queries) UpdateAuditCase(ctx context.Context, id string, u AuditCaseUpdate) (AuditCase, error) {
	const sql = `
		UPDATE audit_cases SET
			status        = COALESCE($1, status),
			risk_score    = COALESCE($2, risk_score),
			decision      = COALESCE($3, decision),
			summary       = COALESCE($4, summary),
			agent_thinking = COALESCE($5, agent_thinking),
			completed_at  = COALESCE($6, completed_at)
		WHERE id = $7
		RETURNING id, creative_id, status, risk_score, decision,
		          policy_version, summary, agent_thinking,
		          submitted_at, completed_at`

	var ac AuditCase
	err := q.Pool.QueryRow(ctx, sql,
		u.Status, u.RiskScore, u.Decision, u.Summary,
		u.AgentThinking, u.CompletedAt, id,
	).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
	)
	if err != nil {
		return AuditCase{}, fmt.Errorf("update audit case %s: %w", id, err)
	}
	return ac, nil
}

// PatchAuditCaseDecision sets the decision and optional review notes on an
// audit case, intended for manual review overrides.
func (q *Queries) PatchAuditCaseDecision(ctx context.Context, id string, decision AuditDecision, reviewNotes *string) (AuditCase, error) {
	const sql = `
		UPDATE audit_cases SET
			decision = $1,
			summary  = COALESCE($2, summary),
			status   = $3,
			completed_at = NOW()
		WHERE id = $4
		RETURNING id, creative_id, status, risk_score, decision,
		          policy_version, summary, agent_thinking,
		          submitted_at, completed_at`

	var ac AuditCase
	err := q.Pool.QueryRow(ctx, sql, decision, reviewNotes, AuditStatusCompleted, id).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
	)
	if err != nil {
		return AuditCase{}, fmt.Errorf("patch audit case decision %s: %w", id, err)
	}
	return ac, nil
}

// ---------------------------------------------------------------------------
// Audit Evidences
// ---------------------------------------------------------------------------

// CreateEvidence inserts a new audit evidence row.
func (q *Queries) CreateEvidence(ctx context.Context, auditCaseID, toolName string, payload, riskSignals json.RawMessage) (AuditEvidence, error) {
	const sql = `
		INSERT INTO audit_evidences (id, audit_case_id, tool_name, payload, risk_signals)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, audit_case_id, tool_name, payload, risk_signals, created_at`

	var ev AuditEvidence
	err := q.Pool.QueryRow(ctx, sql, newID(), auditCaseID, toolName, payload, riskSignals).Scan(
		&ev.ID, &ev.AuditCaseID, &ev.ToolName,
		&ev.Payload, &ev.RiskSignals, &ev.CreatedAt,
	)
	if err != nil {
		return AuditEvidence{}, fmt.Errorf("insert evidence: %w", err)
	}
	return ev, nil
}

// ---------------------------------------------------------------------------
// Attestations
// ---------------------------------------------------------------------------

// ListAttestations returns all attestations with their nested
// audit_case.creative summary.
func (q *Queries) ListAttestations(ctx context.Context) ([]Attestation, error) {
	const sql = `
		SELECT
			att.id, att.audit_case_id, att.attestation_id, att.chain_id,
			att.tx_hash, att.status, att.report_cid,
			att.issued_at, att.expires_at, att.created_at,
			c.id, c.creative_name, c.project_name, c.image_url
		FROM attestations att
		JOIN audit_cases ac ON ac.id = att.audit_case_id
		JOIN creatives c ON c.id = ac.creative_id
		ORDER BY att.created_at DESC`

	rows, err := q.Pool.Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("list attestations: %w", err)
	}
	defer rows.Close()

	var attestations []Attestation
	for rows.Next() {
		var att Attestation
		var cs CreativeSummary

		if err := rows.Scan(
			&att.ID, &att.AuditCaseID, &att.AttestationID, &att.ChainID,
			&att.TxHash, &att.Status, &att.ReportCID,
			&att.IssuedAt, &att.ExpiresAt, &att.CreatedAt,
			&cs.ID, &cs.CreativeName, &cs.ProjectName, &cs.ImageURL,
		); err != nil {
			return nil, fmt.Errorf("scan attestation row: %w", err)
		}

		att.AuditCase = &AuditCaseWithCreative{
			Creative: &cs,
		}
		attestations = append(attestations, att)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate attestations: %w", err)
	}
	return attestations, nil
}

// CreateAttestation inserts a new attestation and returns it.
func (q *Queries) CreateAttestation(ctx context.Context, att Attestation) (Attestation, error) {
	att.ID = newID()

	const sql = `
		INSERT INTO attestations (
			id, audit_case_id, attestation_id, chain_id,
			tx_hash, status, report_cid, issued_at, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, audit_case_id, attestation_id, chain_id,
		          tx_hash, status, report_cid, issued_at, expires_at, created_at`

	var out Attestation
	err := q.Pool.QueryRow(ctx, sql,
		att.ID, att.AuditCaseID, att.AttestationID, att.ChainID,
		att.TxHash, att.Status, att.ReportCID, att.IssuedAt, att.ExpiresAt,
	).Scan(
		&out.ID, &out.AuditCaseID, &out.AttestationID, &out.ChainID,
		&out.TxHash, &out.Status, &out.ReportCID,
		&out.IssuedAt, &out.ExpiresAt, &out.CreatedAt,
	)
	if err != nil {
		return Attestation{}, fmt.Errorf("insert attestation: %w", err)
	}
	return out, nil
}

// UpdateAttestationTxHash records the on-chain tx hash for an attestation
// after the background goroutine lands it on Sepolia. Lookups are by the
// random 32-byte attestationId (unique).
func (q *Queries) UpdateAttestationTxHash(ctx context.Context, attestationID string, txHash string) error {
	const sql = `UPDATE attestations SET tx_hash = $2 WHERE attestation_id = $1`
	_, err := q.Pool.Exec(ctx, sql, attestationID, txHash)
	if err != nil {
		return fmt.Errorf("update attestation tx_hash: %w", err)
	}
	return nil
}

// ListAttestationsMissingTxHash is used by the backfill CLI to iterate the
// rows that need to be pushed on-chain.
func (q *Queries) ListAttestationsMissingTxHash(ctx context.Context) ([]Attestation, error) {
	const sql = `
		SELECT id, audit_case_id, attestation_id, chain_id,
		       tx_hash, status, report_cid, issued_at, expires_at, created_at
		FROM attestations
		WHERE tx_hash IS NULL AND status = $1
		ORDER BY created_at ASC`
	rows, err := q.Pool.Query(ctx, sql, AttestationStatusActive)
	if err != nil {
		return nil, fmt.Errorf("list attestations missing tx_hash: %w", err)
	}
	defer rows.Close()
	var out []Attestation
	for rows.Next() {
		var a Attestation
		if err := rows.Scan(
			&a.ID, &a.AuditCaseID, &a.AttestationID, &a.ChainID,
			&a.TxHash, &a.Status, &a.ReportCID,
			&a.IssuedAt, &a.ExpiresAt, &a.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan attestation: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------

// GetManifest returns a single manifest by ID.
func (q *Queries) GetManifest(ctx context.Context, id string) (Manifest, error) {
	const sql = `
		SELECT id, creative_id, attestation_id, manifest_json, version, created_at
		FROM manifests WHERE id = $1`

	var m Manifest
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&m.ID, &m.CreativeID, &m.AttestationID,
		&m.ManifestJSON, &m.Version, &m.CreatedAt,
	)
	if err != nil {
		return Manifest{}, fmt.Errorf("get manifest %s: %w", id, err)
	}
	return m, nil
}

// CreateManifest inserts a new manifest and returns it.
func (q *Queries) CreateManifest(ctx context.Context, m Manifest) (Manifest, error) {
	m.ID = newID()

	const sql = `
		INSERT INTO manifests (id, creative_id, attestation_id, manifest_json, version)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, creative_id, attestation_id, manifest_json, version, created_at`

	var out Manifest
	err := q.Pool.QueryRow(ctx, sql,
		m.ID, m.CreativeID, m.AttestationID, m.ManifestJSON, m.Version,
	).Scan(
		&out.ID, &out.CreativeID, &out.AttestationID,
		&out.ManifestJSON, &out.Version, &out.CreatedAt,
	)
	if err != nil {
		return Manifest{}, fmt.Errorf("insert manifest: %w", err)
	}
	return out, nil
}

// GetAttestationForVerify loads an attestation with the linked creative info
// needed for SDK verification.
func (q *Queries) GetAttestationForVerify(ctx context.Context, attestationID string) (Attestation, Creative, error) {
	const sql = `
		SELECT
			att.id, att.audit_case_id, att.attestation_id, att.chain_id,
			att.tx_hash, att.status, att.report_cid,
			att.issued_at, att.expires_at, att.created_at,
			c.id, c.advertiser_id, c.creative_name, c.project_name,
			c.image_url, c.creative_hash, c.landing_url, c.telegram_url,
			c.click_url, c.chain_id, c.contract_address, c.placement_domains,
			c.notes, c.status, c.created_at, c.updated_at
		FROM attestations att
		JOIN audit_cases ac ON ac.id = att.audit_case_id
		JOIN creatives c ON c.id = ac.creative_id
		WHERE att.attestation_id = $1
		LIMIT 1`

	var att Attestation
	var c Creative
	err := q.Pool.QueryRow(ctx, sql, attestationID).Scan(
		&att.ID, &att.AuditCaseID, &att.AttestationID, &att.ChainID,
		&att.TxHash, &att.Status, &att.ReportCID,
		&att.IssuedAt, &att.ExpiresAt, &att.CreatedAt,
		&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
		&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
		&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
		&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return Attestation{}, Creative{}, fmt.Errorf("get attestation %s: %w", attestationID, err)
	}
	return att, c, nil
}

// GetCreativeRaw returns a creative without nested relations.
func (q *Queries) GetCreativeRaw(ctx context.Context, id string) (Creative, error) {
	const sql = `
		SELECT id, advertiser_id, creative_name, project_name,
		       image_url, creative_hash, landing_url, telegram_url,
		       click_url, chain_id, contract_address, placement_domains,
		       notes, status, created_at, updated_at
		FROM creatives WHERE id = $1`

	var c Creative
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
		&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
		&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
		&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return Creative{}, fmt.Errorf("creative %s not found", id)
		}
		return Creative{}, fmt.Errorf("get creative raw: %w", err)
	}
	return c, nil
}
