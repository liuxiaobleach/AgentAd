package db

import (
	"context"
)

// CreativeWindowStats returns impressions/clicks for a creative within the
// last N days. Used by the bidder agent's tool-use path so Claude can fetch
// narrow time windows on demand instead of receiving a pre-baked blob.
func (q *Queries) GetCreativeStatsWindow(ctx context.Context, creativeID string, days int) (impressions int, clicks int, err error) {
	if days <= 0 {
		days = 7
	}
	const sql = `
		SELECT
			COUNT(*) AS impressions,
			COUNT(*) FILTER (WHERE ar.clicked = true) AS clicks
		FROM auction_results ar
		WHERE ar.shown_creative_id = $1
		  AND ar.created_at >= NOW() - ($2 || ' days')::interval`
	err = q.Pool.QueryRow(ctx, sql, creativeID, days).Scan(&impressions, &clicks)
	return
}

// GetAdvertiserSpendToday returns the total captured spend for an advertiser
// since local midnight UTC (positive atomic units). Bidder agent uses it to
// reason about budget pacing.
func (q *Queries) GetAdvertiserSpendToday(ctx context.Context, advertiserID string) (int64, error) {
	const sql = `
		SELECT COALESCE(SUM(-amount_atomic), 0)
		FROM balance_ledger_entries
		WHERE advertiser_id = $1
		  AND entry_type = $2
		  AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')`
	var spent int64
	err := q.Pool.QueryRow(ctx, sql, advertiserID, BalanceLedgerEntryCapture).Scan(&spent)
	return spent, err
}
