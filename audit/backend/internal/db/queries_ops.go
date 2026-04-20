package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Ops users + auth
// ---------------------------------------------------------------------------

func (q *Queries) GetOpsUserByEmail(ctx context.Context, email string) (OpsUser, error) {
	const sql = `
		SELECT id, name, contact_email, password_hash, role, created_at
		FROM ops_users WHERE contact_email = $1`
	var u OpsUser
	err := q.Pool.QueryRow(ctx, sql, email).Scan(
		&u.ID, &u.Name, &u.ContactEmail, &u.PasswordHash, &u.Role, &u.CreatedAt,
	)
	if err != nil {
		return OpsUser{}, fmt.Errorf("ops user not found: %w", err)
	}
	return u, nil
}

func (q *Queries) GetOpsUserByID(ctx context.Context, id string) (OpsUser, error) {
	const sql = `
		SELECT id, name, contact_email, password_hash, role, created_at
		FROM ops_users WHERE id = $1`
	var u OpsUser
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&u.ID, &u.Name, &u.ContactEmail, &u.PasswordHash, &u.Role, &u.CreatedAt,
	)
	if err != nil {
		return OpsUser{}, fmt.Errorf("ops user not found: %w", err)
	}
	return u, nil
}

// ---------------------------------------------------------------------------
// Ops queue — audit cases needing or eligible for human review.
// ---------------------------------------------------------------------------

// OpsQueueFilter narrows the set of audit cases listed on the ops queue.
// When Status is empty, the queue includes every case whose decision is
// MANUAL_REVIEW or whose status is MANUAL_REVIEW, regardless of whether a
// reviewer has already touched it.
type OpsQueueFilter struct {
	Status   string // "pending" | "resolved" | "" (all)
	Limit    int
	Decision string // "" | "PASS" | "REJECT" | "MANUAL_REVIEW"
}

func (q *Queries) ListOpsAuditQueue(ctx context.Context, f OpsQueueFilter) ([]AuditCase, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	// Pending = still in MANUAL_REVIEW status OR decision=MANUAL_REVIEW with no reviewer_id.
	// Resolved = reviewer_id IS NOT NULL (someone has acted on it).
	where := `WHERE (ac.status = 'MANUAL_REVIEW' OR ac.decision = 'MANUAL_REVIEW' OR ac.reviewer_id IS NOT NULL)`
	switch f.Status {
	case "pending":
		where = `WHERE (ac.status = 'MANUAL_REVIEW' OR ac.decision = 'MANUAL_REVIEW') AND ac.reviewer_id IS NULL`
	case "resolved":
		where = `WHERE ac.reviewer_id IS NOT NULL`
	}

	args := []any{limit}
	sql := `
		SELECT
			ac.id, ac.creative_id, ac.status, ac.risk_score, ac.decision,
			ac.policy_version, ac.summary, ac.agent_thinking,
			ac.submitted_at, ac.completed_at,
			ac.reviewer_id, ac.review_notes, ac.reviewed_at,
			c.id, c.creative_name, c.project_name, c.image_url,
			adv.id, adv.name, adv.contact_email
		FROM audit_cases ac
		JOIN creatives c ON c.id = ac.creative_id
		JOIN advertisers adv ON adv.id = c.advertiser_id
		` + where + `
		ORDER BY ac.submitted_at DESC
		LIMIT $1`

	rows, err := q.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("list ops queue: %w", err)
	}
	defer rows.Close()

	out := []AuditCase{}
	for rows.Next() {
		var ac AuditCase
		var cs CreativeSummary
		var advID, advName, advEmail string
		var reviewerID, reviewNotes *string
		var reviewedAt *time.Time
		if err := rows.Scan(
			&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
			&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
			&ac.SubmittedAt, &ac.CompletedAt,
			&reviewerID, &reviewNotes, &reviewedAt,
			&cs.ID, &cs.CreativeName, &cs.ProjectName, &cs.ImageURL,
			&advID, &advName, &advEmail,
		); err != nil {
			return nil, fmt.Errorf("scan ops queue row: %w", err)
		}
		ac.Creative = &cs
		ac.ReviewerID = reviewerID
		ac.ReviewNotes = reviewNotes
		ac.ReviewedAt = reviewedAt
		ac.AdvertiserID = advID
		ac.AdvertiserName = advName
		ac.AdvertiserEmail = advEmail
		out = append(out, ac)
	}
	return out, rows.Err()
}

// GetOpsAuditCaseDetail returns the full audit case + creative + evidences +
// attestation for the ops detail view.
func (q *Queries) GetOpsAuditCaseDetail(ctx context.Context, id string) (AuditCase, error) {
	ac, err := q.GetAuditCase(ctx, id)
	if err != nil {
		return AuditCase{}, err
	}
	// Pull extra fields the ops view needs: reviewer_id, review_notes, reviewed_at, advertiser info.
	const extraSQL = `
		SELECT ac.reviewer_id, ac.review_notes, ac.reviewed_at,
		       adv.id, adv.name, adv.contact_email,
		       ou.name
		FROM audit_cases ac
		JOIN creatives c ON c.id = ac.creative_id
		JOIN advertisers adv ON adv.id = c.advertiser_id
		LEFT JOIN ops_users ou ON ou.id = ac.reviewer_id
		WHERE ac.id = $1`
	var reviewerID, reviewNotes, reviewerName *string
	var reviewedAt *time.Time
	var advID, advName, advEmail string
	err = q.Pool.QueryRow(ctx, extraSQL, id).Scan(
		&reviewerID, &reviewNotes, &reviewedAt,
		&advID, &advName, &advEmail,
		&reviewerName,
	)
	if err != nil {
		return AuditCase{}, fmt.Errorf("get ops extras for case %s: %w", id, err)
	}
	ac.ReviewerID = reviewerID
	ac.ReviewNotes = reviewNotes
	ac.ReviewedAt = reviewedAt
	ac.AdvertiserID = advID
	ac.AdvertiserName = advName
	ac.AdvertiserEmail = advEmail
	if reviewerName != nil {
		ac.ReviewerName = *reviewerName
	}
	return ac, nil
}

// ApplyOpsReview atomically: (1) writes the review log, (2) updates
// audit_cases.reviewer_id / review_notes / reviewed_at / decision / status /
// completed_at, and returns the updated row along with the creative.
// The caller is responsible for any side-effects (creative status bump,
// attestation issuance) performed outside this transaction.
type ApplyOpsReviewInput struct {
	AuditCaseID string
	ReviewerID  string
	NewDecision AuditDecision
	Notes       string
}

type ApplyOpsReviewResult struct {
	Case        AuditCase
	Creative    Creative
	LogID       string
	WasResolved bool // true if the case was already reviewed before this call
}

func (q *Queries) ApplyOpsReview(ctx context.Context, in ApplyOpsReviewInput) (ApplyOpsReviewResult, error) {
	if in.NewDecision != AuditDecisionPass && in.NewDecision != AuditDecisionReject {
		return ApplyOpsReviewResult{}, fmt.Errorf("new decision must be PASS or REJECT, got %q", in.NewDecision)
	}

	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return ApplyOpsReviewResult{}, err
	}
	defer tx.Rollback(ctx)

	// Load current case + creative under the tx so we can write an accurate
	// before/after snapshot and return it.
	const loadSQL = `
		SELECT ac.status, ac.decision, ac.reviewer_id,
		       c.id, c.advertiser_id, c.creative_name, c.project_name,
		       c.image_url, c.creative_hash, c.landing_url, c.telegram_url,
		       c.click_url, c.chain_id, c.contract_address,
		       c.placement_domains, c.notes, c.status, c.created_at, c.updated_at
		FROM audit_cases ac
		JOIN creatives c ON c.id = ac.creative_id
		WHERE ac.id = $1
		FOR UPDATE OF ac`
	var prevStatus AuditStatus
	var prevDecision *AuditDecision
	var prevReviewerID *string
	var creative Creative
	err = tx.QueryRow(ctx, loadSQL, in.AuditCaseID).Scan(
		&prevStatus, &prevDecision, &prevReviewerID,
		&creative.ID, &creative.AdvertiserID, &creative.CreativeName, &creative.ProjectName,
		&creative.ImageURL, &creative.CreativeHash, &creative.LandingURL, &creative.TelegramURL,
		&creative.ClickURL, &creative.ChainID, &creative.ContractAddress,
		&creative.PlacementDomains, &creative.Notes, &creative.Status, &creative.CreatedAt, &creative.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ApplyOpsReviewResult{}, fmt.Errorf("audit case %s not found", in.AuditCaseID)
		}
		return ApplyOpsReviewResult{}, fmt.Errorf("load case for review: %w", err)
	}

	wasResolved := prevReviewerID != nil

	newStatus := AuditStatusCompleted

	// Update the audit case itself. decisionText is a separate TEXT param
	// so that $2 stays unambiguously audit_decision and $6 stays unambiguously
	// TEXT — postgres otherwise can't deduce types when one param is used
	// in both an enum column and a string concatenation.
	const updateSQL = `
		UPDATE audit_cases SET
			status       = $1,
			decision     = $2,
			reviewer_id  = $3,
			review_notes = $4,
			reviewed_at  = NOW(),
			completed_at = COALESCE(completed_at, NOW()),
			summary      = COALESCE(summary, '') ||
			               E'\n\n[Manual review] decision=' || $6 ||
			               CASE WHEN $4 <> '' THEN E'\nNotes: ' || $4 ELSE '' END
		WHERE id = $5
		RETURNING id, creative_id, status, risk_score, decision,
		          policy_version, summary, agent_thinking,
		          submitted_at, completed_at, reviewer_id, review_notes, reviewed_at`
	var ac AuditCase
	var reviewerID, reviewNotes *string
	var reviewedAt *time.Time
	notesArg := in.Notes
	err = tx.QueryRow(ctx, updateSQL,
		newStatus, in.NewDecision, in.ReviewerID, notesArg, in.AuditCaseID,
		string(in.NewDecision),
	).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
		&reviewerID, &reviewNotes, &reviewedAt,
	)
	if err != nil {
		return ApplyOpsReviewResult{}, fmt.Errorf("update audit case: %w", err)
	}
	ac.ReviewerID = reviewerID
	ac.ReviewNotes = reviewNotes
	ac.ReviewedAt = reviewedAt

	// Append the review log row.
	logID := newID()
	const logSQL = `
		INSERT INTO audit_review_logs
		  (id, audit_case_id, reviewer_id, previous_decision, new_decision,
		   previous_status, new_status, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	var notesForLog *string
	if notesArg != "" {
		notesForLog = &notesArg
	}
	if _, err := tx.Exec(ctx, logSQL,
		logID, in.AuditCaseID, in.ReviewerID, prevDecision, in.NewDecision,
		prevStatus, newStatus, notesForLog,
	); err != nil {
		return ApplyOpsReviewResult{}, fmt.Errorf("insert review log: %w", err)
	}

	// Flip the creative's status to match the new decision so downstream
	// bidding / serving picks up the ops verdict.
	var newCreativeStatus CreativeStatus
	switch in.NewDecision {
	case AuditDecisionPass:
		newCreativeStatus = CreativeStatusApproved
	case AuditDecisionReject:
		newCreativeStatus = CreativeStatusRejected
	}
	const cStatusSQL = `UPDATE creatives SET status = $1, updated_at = NOW() WHERE id = $2`
	if _, err := tx.Exec(ctx, cStatusSQL, newCreativeStatus, creative.ID); err != nil {
		return ApplyOpsReviewResult{}, fmt.Errorf("update creative status: %w", err)
	}
	creative.Status = newCreativeStatus

	if err := tx.Commit(ctx); err != nil {
		return ApplyOpsReviewResult{}, err
	}

	ac.Creative = &CreativeSummary{
		ID:           creative.ID,
		CreativeName: creative.CreativeName,
		ProjectName:  creative.ProjectName,
		ImageURL:     creative.ImageURL,
	}
	return ApplyOpsReviewResult{
		Case:        ac,
		Creative:    creative,
		LogID:       logID,
		WasResolved: wasResolved,
	}, nil
}

// ListOpsReviewHistory returns the reviewer's past actions, most recent first.
func (q *Queries) ListOpsReviewHistory(ctx context.Context, reviewerID string, limit int) ([]AuditReviewLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const sql = `
		SELECT
			l.id, l.audit_case_id, l.reviewer_id,
			l.previous_decision, l.new_decision,
			l.previous_status, l.new_status,
			l.notes, l.created_at,
			ou.name,
			c.creative_name, c.project_name
		FROM audit_review_logs l
		JOIN ops_users ou ON ou.id = l.reviewer_id
		JOIN audit_cases ac ON ac.id = l.audit_case_id
		JOIN creatives c ON c.id = ac.creative_id
		WHERE l.reviewer_id = $1
		ORDER BY l.created_at DESC
		LIMIT $2`
	rows, err := q.Pool.Query(ctx, sql, reviewerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list ops review history: %w", err)
	}
	defer rows.Close()

	out := []AuditReviewLog{}
	for rows.Next() {
		var l AuditReviewLog
		if err := rows.Scan(
			&l.ID, &l.AuditCaseID, &l.ReviewerID,
			&l.PreviousDecision, &l.NewDecision,
			&l.PreviousStatus, &l.NewStatus,
			&l.Notes, &l.CreatedAt,
			&l.ReviewerName, &l.CreativeName, &l.ProjectName,
		); err != nil {
			return nil, fmt.Errorf("scan review log: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
