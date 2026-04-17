package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

func (q *Queries) GetAdvertiserByEmail(ctx context.Context, email string) (Advertiser, error) {
	const sql = `
		SELECT id, name, wallet_address, contact_email, password_hash, created_at
		FROM advertisers WHERE contact_email = $1`
	var a Advertiser
	err := q.Pool.QueryRow(ctx, sql, email).Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.PasswordHash, &a.CreatedAt,
	)
	if err != nil {
		return Advertiser{}, fmt.Errorf("advertiser not found: %w", err)
	}
	return a, nil
}

func (q *Queries) GetAdvertiserByID(ctx context.Context, id string) (Advertiser, error) {
	const sql = `
		SELECT id, name, wallet_address, contact_email, password_hash, created_at
		FROM advertisers WHERE id = $1`
	var a Advertiser
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.PasswordHash, &a.CreatedAt,
	)
	if err != nil {
		return Advertiser{}, fmt.Errorf("advertiser not found: %w", err)
	}
	return a, nil
}

func (q *Queries) UpdateAdvertiserWalletAddress(ctx context.Context, advertiserID, walletAddress string) (Advertiser, error) {
	const sql = `
		UPDATE advertisers
		SET wallet_address = $1
		WHERE id = $2
		RETURNING id, name, wallet_address, contact_email, password_hash, created_at`
	var a Advertiser
	err := q.Pool.QueryRow(ctx, sql, walletAddress, advertiserID).Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.PasswordHash, &a.CreatedAt,
	)
	if err != nil {
		return Advertiser{}, fmt.Errorf("update advertiser wallet: %w", err)
	}
	return a, nil
}

func (q *Queries) GetAdvertiserByWalletAddress(ctx context.Context, walletAddress string) (Advertiser, error) {
	const sql = `
		SELECT id, name, wallet_address, contact_email, password_hash, created_at
		FROM advertisers
		WHERE LOWER(wallet_address) = LOWER($1)
		ORDER BY created_at ASC
		LIMIT 1`
	var a Advertiser
	err := q.Pool.QueryRow(ctx, sql, walletAddress).Scan(
		&a.ID, &a.Name, &a.WalletAddress, &a.ContactEmail, &a.PasswordHash, &a.CreatedAt,
	)
	if err != nil {
		return Advertiser{}, fmt.Errorf("advertiser not found by wallet: %w", err)
	}
	return a, nil
}

func (q *Queries) IsWalletAddressLinkedToOtherAdvertiser(ctx context.Context, walletAddress, advertiserID string) (bool, error) {
	const sql = `
		SELECT id
		FROM advertisers
		WHERE LOWER(wallet_address) = LOWER($1)
		  AND id <> $2
		LIMIT 1`
	var otherAdvertiserID string
	err := q.Pool.QueryRow(ctx, sql, walletAddress, advertiserID).Scan(&otherAdvertiserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check wallet uniqueness: %w", err)
	}
	return otherAdvertiserID != "", nil
}

// ---------------------------------------------------------------------------
// Creative Profiles
// ---------------------------------------------------------------------------

func (q *Queries) GetCreativeProfile(ctx context.Context, creativeID string) (CreativeProfile, error) {
	const sql = `
		SELECT id, creative_id, audit_case_id, analysis_version,
		       marketing_summary, visual_tags, cta_type, copy_style,
		       target_audiences, placement_fit, predicted_ctr_priors, bid_hints,
		       created_at, updated_at
		FROM creative_profiles WHERE creative_id = $1
		ORDER BY created_at DESC LIMIT 1`
	var p CreativeProfile
	err := q.Pool.QueryRow(ctx, sql, creativeID).Scan(
		&p.ID, &p.CreativeID, &p.AuditCaseID, &p.AnalysisVersion,
		&p.MarketingSummary, &p.VisualTags, &p.CtaType, &p.CopyStyle,
		&p.TargetAudiences, &p.PlacementFit, &p.PredictedCtrPriors, &p.BidHints,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return CreativeProfile{}, fmt.Errorf("creative profile not found: %w", err)
	}
	return p, nil
}

func (q *Queries) CreateCreativeProfile(ctx context.Context, p CreativeProfile) (CreativeProfile, error) {
	p.ID = newID()
	const sql = `
		INSERT INTO creative_profiles (
			id, creative_id, audit_case_id, analysis_version,
			marketing_summary, visual_tags, cta_type, copy_style,
			target_audiences, placement_fit, predicted_ctr_priors, bid_hints
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id, creative_id, audit_case_id, analysis_version,
		          marketing_summary, visual_tags, cta_type, copy_style,
		          target_audiences, placement_fit, predicted_ctr_priors, bid_hints,
		          created_at, updated_at`
	var out CreativeProfile
	err := q.Pool.QueryRow(ctx, sql,
		p.ID, p.CreativeID, p.AuditCaseID, p.AnalysisVersion,
		p.MarketingSummary, p.VisualTags, p.CtaType, p.CopyStyle,
		p.TargetAudiences, p.PlacementFit, p.PredictedCtrPriors, p.BidHints,
	).Scan(
		&out.ID, &out.CreativeID, &out.AuditCaseID, &out.AnalysisVersion,
		&out.MarketingSummary, &out.VisualTags, &out.CtaType, &out.CopyStyle,
		&out.TargetAudiences, &out.PlacementFit, &out.PredictedCtrPriors, &out.BidHints,
		&out.CreatedAt, &out.UpdatedAt,
	)
	if err != nil {
		return CreativeProfile{}, fmt.Errorf("insert creative profile: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Bidder Agents
// ---------------------------------------------------------------------------

func (q *Queries) GetBidderAgentsByAdvertiser(ctx context.Context, advertiserID string) ([]BidderAgent, error) {
	const sql = `
		SELECT id, advertiser_id, name, strategy, strategy_prompt,
		       value_per_click, max_bid_cpm, status, created_at, updated_at
		FROM bidder_agents WHERE advertiser_id = $1 ORDER BY created_at`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []BidderAgent
	for rows.Next() {
		var a BidderAgent
		if err := rows.Scan(
			&a.ID, &a.AdvertiserID, &a.Name, &a.Strategy, &a.StrategyPrompt,
			&a.ValuePerClick, &a.MaxBidCpm, &a.Status, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

func (q *Queries) GetBidderAgent(ctx context.Context, id string) (BidderAgent, error) {
	const sql = `
		SELECT id, advertiser_id, name, strategy, strategy_prompt,
		       value_per_click, max_bid_cpm, status, created_at, updated_at
		FROM bidder_agents WHERE id = $1`
	var a BidderAgent
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&a.ID, &a.AdvertiserID, &a.Name, &a.Strategy, &a.StrategyPrompt,
		&a.ValuePerClick, &a.MaxBidCpm, &a.Status, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return BidderAgent{}, err
	}
	return a, nil
}

func (q *Queries) UpdateBidderAgent(ctx context.Context, id string, strategy string, strategyPrompt *string, vpc, maxBid float64) error {
	const sql = `
		UPDATE bidder_agents SET strategy=$1, strategy_prompt=$2,
		       value_per_click=$3, max_bid_cpm=$4, updated_at=NOW()
		WHERE id=$5`
	_, err := q.Pool.Exec(ctx, sql, strategy, strategyPrompt, vpc, maxBid, id)
	return err
}

func (q *Queries) GetAllActiveBidderAgents(ctx context.Context) ([]BidderAgent, error) {
	const sql = `
		SELECT id, advertiser_id, name, strategy, strategy_prompt,
		       value_per_click, max_bid_cpm, status, created_at, updated_at
		FROM bidder_agents WHERE status = 'ACTIVE' ORDER BY created_at`
	rows, err := q.Pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []BidderAgent
	for rows.Next() {
		var a BidderAgent
		if err := rows.Scan(
			&a.ID, &a.AdvertiserID, &a.Name, &a.Strategy, &a.StrategyPrompt,
			&a.ValuePerClick, &a.MaxBidCpm, &a.Status, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

// ---------------------------------------------------------------------------
// Approved Creatives for bidding
// ---------------------------------------------------------------------------

func (q *Queries) GetApprovedCreativesByAdvertiser(ctx context.Context, advertiserID string) ([]Creative, error) {
	const sql = `
		SELECT c.id, c.advertiser_id, c.creative_name, c.project_name,
		       c.image_url, c.creative_hash, c.landing_url, c.telegram_url,
		       c.click_url, c.chain_id, c.contract_address, c.placement_domains,
		       c.notes, c.status, c.created_at, c.updated_at
		FROM creatives c
		JOIN attestations a ON a.audit_case_id IN (
			SELECT ac.id FROM audit_cases ac WHERE ac.creative_id = c.id AND ac.decision = 'PASS'
		)
		WHERE c.advertiser_id = $1 AND c.status = 'APPROVED' AND a.status = 'ACTIVE'
		ORDER BY c.created_at DESC`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var creatives []Creative
	for rows.Next() {
		var c Creative
		if err := rows.Scan(
			&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
			&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
			&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
			&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		creatives = append(creatives, c)
	}
	return creatives, rows.Err()
}

// ---------------------------------------------------------------------------
// Auction Requests / Bids / Results
// ---------------------------------------------------------------------------

func (q *Queries) CreateAuctionRequest(ctx context.Context, ar AuctionRequest) (AuctionRequest, error) {
	ar.ID = newID()
	const sql = `
		INSERT INTO auction_requests (id, slot_id, slot_type, size, floor_cpm, site_category, user_segments, context)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, slot_id, slot_type, size, floor_cpm, site_category, user_segments, context, created_at`
	err := q.Pool.QueryRow(ctx, sql,
		ar.ID, ar.SlotID, ar.SlotType, ar.Size, ar.FloorCpm,
		ar.SiteCategory, ar.UserSegments, ar.Context,
	).Scan(
		&ar.ID, &ar.SlotID, &ar.SlotType, &ar.Size, &ar.FloorCpm,
		&ar.SiteCategory, &ar.UserSegments, &ar.Context, &ar.CreatedAt,
	)
	return ar, err
}

func (q *Queries) CreateAuctionBid(ctx context.Context, bid AuctionBid) (AuctionBid, error) {
	bid.ID = newID()
	const sql = `
		INSERT INTO auction_bids (id, auction_request_id, bidder_agent_id, selected_creative_id,
		                          predicted_ctr, bid_cpm, confidence, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, auction_request_id, bidder_agent_id, selected_creative_id,
		          predicted_ctr, bid_cpm, confidence, reason, created_at`
	err := q.Pool.QueryRow(ctx, sql,
		bid.ID, bid.AuctionRequestID, bid.BidderAgentID, bid.SelectedCreativeID,
		bid.PredictedCtr, bid.BidCpm, bid.Confidence, bid.Reason,
	).Scan(
		&bid.ID, &bid.AuctionRequestID, &bid.BidderAgentID, &bid.SelectedCreativeID,
		&bid.PredictedCtr, &bid.BidCpm, &bid.Confidence, &bid.Reason, &bid.CreatedAt,
	)
	return bid, err
}

func (q *Queries) CreateAuctionResult(ctx context.Context, res AuctionResult) (AuctionResult, error) {
	res.ID = newID()
	const sql = `
		INSERT INTO auction_results (id, auction_request_id, winner_bid_id, settlement_price, shown_creative_id, clicked)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, auction_request_id, winner_bid_id, settlement_price, shown_creative_id, clicked, created_at`
	err := q.Pool.QueryRow(ctx, sql,
		res.ID, res.AuctionRequestID, res.WinnerBidID, res.SettlementPrice,
		res.ShownCreativeID, res.Clicked,
	).Scan(
		&res.ID, &res.AuctionRequestID, &res.WinnerBidID, &res.SettlementPrice,
		&res.ShownCreativeID, &res.Clicked, &res.CreatedAt,
	)
	return res, err
}

// BidListRow is a bid-centric row for the auctions list scoped to one advertiser.
// Each row represents a single bid made by one of the advertiser's agents,
// joined with the auction context and the outcome (won/lost, settled, clicked).
type BidListRow struct {
	BidID           string    `json:"bidId"`
	AuctionID       string    `json:"auctionId"`
	SlotID          string    `json:"slotId"`
	SlotType        string    `json:"slotType"`
	Size            string    `json:"size"`
	FloorCpm        float64   `json:"floorCpm"`
	SiteCategory    *string   `json:"siteCategory"`
	UserSegments    []string  `json:"userSegments"`
	AgentID         string    `json:"agentId"`
	AgentName       string    `json:"agentName"`
	Strategy        string    `json:"strategy"`
	CreativeID      *string   `json:"creativeId"`
	CreativeName    *string   `json:"creativeName"`
	BidCpm          *float64  `json:"bidCpm"`
	PredictedCtr    *float64  `json:"predictedCtr"`
	Confidence      *float64  `json:"confidence"`
	Reason          *string   `json:"reason"`
	Won             bool      `json:"won"`
	SettlementPrice *float64  `json:"settlementPrice"`
	Clicked         *bool     `json:"clicked"`
	BidCount        int       `json:"bidCount"`
	CreatedAt       time.Time `json:"createdAt"`
}

// ListBidsByAdvertiser returns all bids (including losing and non-participating bids)
// made by the given advertiser's agents, ordered by auction creation time DESC.
func (q *Queries) ListBidsByAdvertiser(ctx context.Context, advertiserID string, limit int) ([]BidListRow, error) {
	const sql = `
		SELECT
			b.id, ar.id, ar.slot_id, ar.slot_type, ar.size, ar.floor_cpm,
			ar.site_category, ar.user_segments,
			ba.id, ba.name, ba.strategy,
			b.selected_creative_id, c.creative_name,
			b.bid_cpm, b.predicted_ctr, b.confidence, b.reason,
			(res.winner_bid_id = b.id) as won,
			res.settlement_price, res.clicked,
			COALESCE((SELECT COUNT(*) FROM auction_bids ab WHERE ab.auction_request_id = ar.id), 0) as bid_count,
			ar.created_at
		FROM auction_bids b
		JOIN auction_requests ar ON ar.id = b.auction_request_id
		JOIN bidder_agents ba ON ba.id = b.bidder_agent_id
		LEFT JOIN creatives c ON c.id = b.selected_creative_id
		LEFT JOIN auction_results res ON res.auction_request_id = ar.id
		WHERE ba.advertiser_id = $1
		ORDER BY ar.created_at DESC, b.bid_cpm DESC NULLS LAST
		LIMIT $2`

	rows, err := q.Pool.Query(ctx, sql, advertiserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BidListRow
	for rows.Next() {
		var r BidListRow
		var won *bool
		if err := rows.Scan(
			&r.BidID, &r.AuctionID, &r.SlotID, &r.SlotType, &r.Size, &r.FloorCpm,
			&r.SiteCategory, &r.UserSegments,
			&r.AgentID, &r.AgentName, &r.Strategy,
			&r.CreativeID, &r.CreativeName,
			&r.BidCpm, &r.PredictedCtr, &r.Confidence, &r.Reason,
			&won, &r.SettlementPrice, &r.Clicked, &r.BidCount, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		if won != nil {
			r.Won = *won
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// HourlyReportBucket is one hour of aggregate advertiser activity.
type HourlyReportBucket struct {
	Hour     time.Time `json:"hour"`
	Requests int       `json:"requests"`
	Wins     int       `json:"wins"`
	Clicks   int       `json:"clicks"`
	Spend    float64   `json:"spend"`
}

// GetHourlyReport returns hourly aggregates over the last `hours` hours for a given
// advertiser. Buckets with no activity are included with zero values so the chart
// has a continuous x-axis.
func (q *Queries) GetHourlyReport(ctx context.Context, advertiserID string, hours int) ([]HourlyReportBucket, error) {
	const sql = `
		WITH hours AS (
			SELECT generate_series(
				date_trunc('hour', NOW() - ($2::int - 1 || ' hours')::interval),
				date_trunc('hour', NOW()),
				'1 hour'
			) AS hour
		),
		bids AS (
			SELECT ar.id as auction_id, ar.created_at, b.id as bid_id
			FROM auction_bids b
			JOIN auction_requests ar ON ar.id = b.auction_request_id
			JOIN bidder_agents ba ON ba.id = b.bidder_agent_id
			WHERE ba.advertiser_id = $1
			  AND ar.created_at >= date_trunc('hour', NOW() - ($2::int - 1 || ' hours')::interval)
		),
		agg AS (
			SELECT
				date_trunc('hour', b.created_at) as hour,
				COUNT(DISTINCT b.auction_id) as requests,
				COUNT(DISTINCT b.bid_id) FILTER (WHERE res.winner_bid_id = b.bid_id) as wins,
				COUNT(DISTINCT b.bid_id) FILTER (WHERE res.winner_bid_id = b.bid_id AND res.clicked = true) as clicks,
				COALESCE(SUM(res.settlement_price) FILTER (WHERE res.winner_bid_id = b.bid_id), 0) as spend
			FROM bids b
			LEFT JOIN auction_results res ON res.auction_request_id = b.auction_id
			GROUP BY date_trunc('hour', b.created_at)
		)
		SELECT h.hour,
		       COALESCE(agg.requests, 0),
		       COALESCE(agg.wins, 0),
		       COALESCE(agg.clicks, 0),
		       COALESCE(agg.spend, 0)
		FROM hours h
		LEFT JOIN agg ON agg.hour = h.hour
		ORDER BY h.hour ASC`

	rows, err := q.Pool.Query(ctx, sql, advertiserID, hours)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []HourlyReportBucket
	for rows.Next() {
		var b HourlyReportBucket
		if err := rows.Scan(&b.Hour, &b.Requests, &b.Wins, &b.Clicks, &b.Spend); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// MarkAuctionClicked sets clicked=true on the auction result for the given request.
// Used when a real user clicks the rendered ad.
func (q *Queries) MarkAuctionClicked(ctx context.Context, auctionRequestID string) error {
	const sql = `UPDATE auction_results SET clicked = true WHERE auction_request_id = $1`
	_, err := q.Pool.Exec(ctx, sql, auctionRequestID)
	return err
}

type AuctionListRow struct {
	AuctionRequest
	WinnerAgentName *string  `json:"winnerAgentName"`
	SettlementPrice *float64 `json:"settlementPrice"`
	Clicked         *bool    `json:"clicked"`
	BidCount        int      `json:"bidCount"`
}

func (q *Queries) ListAuctionRequests(ctx context.Context, limit int) ([]AuctionListRow, error) {
	const sql = `
		SELECT ar.id, ar.slot_id, ar.slot_type, ar.size, ar.floor_cpm,
		       ar.site_category, ar.user_segments, ar.context, ar.created_at,
		       ba.name as winner_agent_name,
		       res.settlement_price,
		       res.clicked,
		       COALESCE((SELECT COUNT(*) FROM auction_bids b WHERE b.auction_request_id = ar.id), 0) as bid_count
		FROM auction_requests ar
		LEFT JOIN auction_results res ON res.auction_request_id = ar.id
		LEFT JOIN auction_bids wb ON wb.id = res.winner_bid_id
		LEFT JOIN bidder_agents ba ON ba.id = wb.bidder_agent_id
		ORDER BY ar.created_at DESC LIMIT $1`
	rows, err := q.Pool.Query(ctx, sql, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reqs []AuctionListRow
	for rows.Next() {
		var r AuctionListRow
		if err := rows.Scan(
			&r.ID, &r.SlotID, &r.SlotType, &r.Size, &r.FloorCpm,
			&r.SiteCategory, &r.UserSegments, &r.Context, &r.CreatedAt,
			&r.WinnerAgentName, &r.SettlementPrice, &r.Clicked, &r.BidCount,
		); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func (q *Queries) GetAuctionRequestWithDetails(ctx context.Context, id string) (AuctionRequest, error) {
	const sqlReq = `
		SELECT id, slot_id, slot_type, size, floor_cpm, site_category, user_segments, context, created_at
		FROM auction_requests WHERE id = $1`
	var ar AuctionRequest
	err := q.Pool.QueryRow(ctx, sqlReq, id).Scan(
		&ar.ID, &ar.SlotID, &ar.SlotType, &ar.Size, &ar.FloorCpm,
		&ar.SiteCategory, &ar.UserSegments, &ar.Context, &ar.CreatedAt,
	)
	if err != nil {
		return ar, err
	}

	// Load bids
	const sqlBids = `
		SELECT b.id, b.auction_request_id, b.bidder_agent_id, b.selected_creative_id,
		       b.predicted_ctr, b.bid_cpm, b.confidence, b.reason, b.created_at,
		       ba.name, COALESCE(c.creative_name, '')
		FROM auction_bids b
		JOIN bidder_agents ba ON ba.id = b.bidder_agent_id
		LEFT JOIN creatives c ON c.id = b.selected_creative_id
		WHERE b.auction_request_id = $1
		ORDER BY b.bid_cpm DESC NULLS LAST`
	rows, err := q.Pool.Query(ctx, sqlBids, id)
	if err != nil {
		return ar, err
	}
	defer rows.Close()
	for rows.Next() {
		var b AuctionBid
		if err := rows.Scan(
			&b.ID, &b.AuctionRequestID, &b.BidderAgentID, &b.SelectedCreativeID,
			&b.PredictedCtr, &b.BidCpm, &b.Confidence, &b.Reason, &b.CreatedAt,
			&b.AgentName, &b.CreativeName,
		); err != nil {
			return ar, err
		}
		ar.Bids = append(ar.Bids, b)
	}

	// Load result
	const sqlResult = `
		SELECT id, auction_request_id, winner_bid_id, settlement_price, shown_creative_id, clicked, created_at
		FROM auction_results WHERE auction_request_id = $1 LIMIT 1`
	var res AuctionResult
	err = q.Pool.QueryRow(ctx, sqlResult, id).Scan(
		&res.ID, &res.AuctionRequestID, &res.WinnerBidID, &res.SettlementPrice,
		&res.ShownCreativeID, &res.Clicked, &res.CreatedAt,
	)
	if err == nil {
		ar.Result = &res
	} else if err != pgx.ErrNoRows {
		return ar, err
	}

	return ar, nil
}

// ListCreativesByAdvertiser returns creatives for a specific advertiser
func (q *Queries) ListCreativesByAdvertiser(ctx context.Context, advertiserID string) ([]Creative, error) {
	const sql = `
		SELECT id, advertiser_id, creative_name, project_name,
		       image_url, creative_hash, landing_url, telegram_url,
		       click_url, chain_id, contract_address, placement_domains,
		       notes, status, created_at, updated_at
		FROM creatives WHERE advertiser_id = $1 ORDER BY created_at DESC`
	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var creatives []Creative
	for rows.Next() {
		var c Creative
		if err := rows.Scan(
			&c.ID, &c.AdvertiserID, &c.CreativeName, &c.ProjectName,
			&c.ImageURL, &c.CreativeHash, &c.LandingURL, &c.TelegramURL,
			&c.ClickURL, &c.ChainID, &c.ContractAddress, &c.PlacementDomains,
			&c.Notes, &c.Status, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		creatives = append(creatives, c)
	}
	return creatives, rows.Err()
}

// GetCreativeStats returns impression/click stats for a creative from auction history
func (q *Queries) GetCreativeStats(ctx context.Context, creativeID string) (impressions int, clicks int, err error) {
	const sql = `
		SELECT
			COUNT(*) as impressions,
			COUNT(*) FILTER (WHERE ar.clicked = true) as clicks
		FROM auction_results ar
		WHERE ar.shown_creative_id = $1`
	err = q.Pool.QueryRow(ctx, sql, creativeID).Scan(&impressions, &clicks)
	return
}

// GetLastAuditCaseForCreative returns the latest audit case for a creative
func (q *Queries) GetLastAuditCaseForCreative(ctx context.Context, creativeID string) (AuditCase, error) {
	const sql = `
		SELECT id, creative_id, status, risk_score, decision, policy_version,
		       summary, agent_thinking, submitted_at, completed_at
		FROM audit_cases WHERE creative_id = $1
		ORDER BY submitted_at DESC LIMIT 1`
	var ac AuditCase
	err := q.Pool.QueryRow(ctx, sql, creativeID).Scan(
		&ac.ID, &ac.CreativeID, &ac.Status, &ac.RiskScore, &ac.Decision,
		&ac.PolicyVersion, &ac.Summary, &ac.AgentThinking,
		&ac.SubmittedAt, &ac.CompletedAt,
	)
	return ac, err
}

// DeleteCreative removes a creative and all its related data (cascade).
func (q *Queries) DeleteCreative(ctx context.Context, id, advertiserID string) error {
	// Verify ownership
	var ownerID string
	err := q.Pool.QueryRow(ctx, `SELECT advertiser_id FROM creatives WHERE id = $1`, id).Scan(&ownerID)
	if err != nil {
		return fmt.Errorf("creative not found")
	}
	if ownerID != advertiserID {
		return fmt.Errorf("not authorized")
	}

	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Delete in dependency order
	tx.Exec(ctx, `DELETE FROM auction_bids WHERE selected_creative_id = $1`, id)
	tx.Exec(ctx, `UPDATE auction_results SET shown_creative_id = NULL WHERE shown_creative_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM creative_profiles WHERE creative_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM manifests WHERE creative_id = $1`, id)

	// Delete attestations linked through audit_cases
	tx.Exec(ctx, `DELETE FROM attestations WHERE audit_case_id IN (SELECT id FROM audit_cases WHERE creative_id = $1)`, id)
	tx.Exec(ctx, `DELETE FROM audit_evidences WHERE audit_case_id IN (SELECT id FROM audit_cases WHERE creative_id = $1)`, id)
	tx.Exec(ctx, `DELETE FROM audit_cases WHERE creative_id = $1`, id)
	tx.Exec(ctx, `DELETE FROM creatives WHERE id = $1`, id)

	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Advertiser Performance Stats (for analyst agent)
// ---------------------------------------------------------------------------

type AgentPerformanceStats struct {
	AgentID          string  `json:"agentId"`
	AgentName        string  `json:"agentName"`
	Strategy         string  `json:"strategy"`
	TotalAuctions    int     `json:"totalAuctions"`
	TotalBids        int     `json:"totalBids"`
	Wins             int     `json:"wins"`
	WinRate          float64 `json:"winRate"`
	TotalImpressions int     `json:"totalImpressions"`
	TotalClicks      int     `json:"totalClicks"`
	CTR              float64 `json:"ctr"`
	AvgBidCpm        float64 `json:"avgBidCpm"`
	AvgSettlement    float64 `json:"avgSettlement"`
	TotalSpend       float64 `json:"totalSpend"`
}

type CreativePerformanceStats struct {
	CreativeID    string  `json:"creativeId"`
	CreativeName  string  `json:"creativeName"`
	Impressions   int     `json:"impressions"`
	Clicks        int     `json:"clicks"`
	CTR           float64 `json:"ctr"`
	TimesSelected int     `json:"timesSelected"`
	Wins          int     `json:"wins"`
	AvgBidCpm     float64 `json:"avgBidCpm"`
}

type RecentAuctionRecord struct {
	AuctionID    string    `json:"auctionId"`
	SlotType     string    `json:"slotType"`
	SiteCategory *string   `json:"siteCategory"`
	BidCpm       *float64  `json:"bidCpm"`
	PredictedCtr *float64  `json:"predictedCtr"`
	Won          bool      `json:"won"`
	Clicked      bool      `json:"clicked"`
	Settlement   *float64  `json:"settlementPrice"`
	CreativeName string    `json:"creativeName"`
	Reason       *string   `json:"reason"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (q *Queries) GetAgentPerformanceStats(ctx context.Context, advertiserID string) ([]AgentPerformanceStats, error) {
	const sql = `
		SELECT
			ba.id, ba.name, ba.strategy,
			COUNT(DISTINCT b.auction_request_id) as total_auctions,
			COUNT(b.id) as total_bids,
			COUNT(ar.id) FILTER (WHERE ar.winner_bid_id = b.id) as wins,
			COUNT(ar.id) FILTER (WHERE ar.shown_creative_id IS NOT NULL AND ar.winner_bid_id = b.id) as impressions,
			COUNT(ar.id) FILTER (WHERE ar.clicked = true AND ar.winner_bid_id = b.id) as clicks,
			COALESCE(AVG(b.bid_cpm) FILTER (WHERE b.bid_cpm IS NOT NULL), 0) as avg_bid,
			COALESCE(AVG(ar.settlement_price) FILTER (WHERE ar.winner_bid_id = b.id), 0) as avg_settlement,
			COALESCE(SUM(ar.settlement_price) FILTER (WHERE ar.winner_bid_id = b.id), 0) as total_spend
		FROM bidder_agents ba
		LEFT JOIN auction_bids b ON b.bidder_agent_id = ba.id
		LEFT JOIN auction_results ar ON ar.auction_request_id = b.auction_request_id
		WHERE ba.advertiser_id = $1
		GROUP BY ba.id, ba.name, ba.strategy`

	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []AgentPerformanceStats
	for rows.Next() {
		var s AgentPerformanceStats
		err := rows.Scan(
			&s.AgentID, &s.AgentName, &s.Strategy,
			&s.TotalAuctions, &s.TotalBids, &s.Wins,
			&s.TotalImpressions, &s.TotalClicks,
			&s.AvgBidCpm, &s.AvgSettlement, &s.TotalSpend,
		)
		if err != nil {
			return nil, err
		}
		if s.TotalBids > 0 {
			s.WinRate = float64(s.Wins) / float64(s.TotalBids)
		}
		if s.TotalImpressions > 0 {
			s.CTR = float64(s.TotalClicks) / float64(s.TotalImpressions)
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (q *Queries) GetCreativePerformanceStats(ctx context.Context, advertiserID string) ([]CreativePerformanceStats, error) {
	const sql = `
		SELECT
			c.id, c.creative_name,
			COUNT(ar.id) FILTER (WHERE ar.shown_creative_id = c.id) as impressions,
			COUNT(ar.id) FILTER (WHERE ar.shown_creative_id = c.id AND ar.clicked = true) as clicks,
			COUNT(b.id) as times_selected,
			COUNT(ar.id) FILTER (WHERE ar.winner_bid_id = b.id) as wins,
			COALESCE(AVG(b.bid_cpm) FILTER (WHERE b.bid_cpm IS NOT NULL), 0) as avg_bid
		FROM creatives c
		LEFT JOIN auction_bids b ON b.selected_creative_id = c.id
		LEFT JOIN auction_results ar ON ar.auction_request_id = b.auction_request_id
		WHERE c.advertiser_id = $1 AND c.status = 'APPROVED'
		GROUP BY c.id, c.creative_name`

	rows, err := q.Pool.Query(ctx, sql, advertiserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []CreativePerformanceStats
	for rows.Next() {
		var s CreativePerformanceStats
		err := rows.Scan(&s.CreativeID, &s.CreativeName, &s.Impressions, &s.Clicks,
			&s.TimesSelected, &s.Wins, &s.AvgBidCpm)
		if err != nil {
			return nil, err
		}
		if s.Impressions > 0 {
			s.CTR = float64(s.Clicks) / float64(s.Impressions)
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}

func (q *Queries) GetRecentAuctionRecords(ctx context.Context, agentID string, limit int) ([]RecentAuctionRecord, error) {
	const sql = `
		SELECT
			b.auction_request_id,
			aq.slot_type,
			aq.site_category,
			b.bid_cpm,
			b.predicted_ctr,
			(ar.winner_bid_id = b.id) as won,
			COALESCE(ar.clicked, false) as clicked,
			ar.settlement_price,
			COALESCE(c.creative_name, '') as creative_name,
			b.reason,
			b.created_at
		FROM auction_bids b
		JOIN auction_requests aq ON aq.id = b.auction_request_id
		LEFT JOIN auction_results ar ON ar.auction_request_id = b.auction_request_id
		LEFT JOIN creatives c ON c.id = b.selected_creative_id
		WHERE b.bidder_agent_id = $1
		ORDER BY b.created_at DESC
		LIMIT $2`

	rows, err := q.Pool.Query(ctx, sql, agentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []RecentAuctionRecord
	for rows.Next() {
		var r RecentAuctionRecord
		err := rows.Scan(&r.AuctionID, &r.SlotType, &r.SiteCategory,
			&r.BidCpm, &r.PredictedCtr, &r.Won, &r.Clicked,
			&r.Settlement, &r.CreativeName, &r.Reason, &r.CreatedAt)
		if err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, rows.Err()
}

// --- helpers to avoid import cycle ---
func toJSON(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func nowPtr() *time.Time {
	t := time.Now()
	return &t
}
