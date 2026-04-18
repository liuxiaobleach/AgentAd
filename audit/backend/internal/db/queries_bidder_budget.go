package db

import (
	"context"
	"fmt"
	"time"
)

// BidderAgentSpendWindow tracks an agent's aggregate spend within a rolling
// hourly or daily window. Used together with
// bidder_agents.{hourly,daily}_budget_atomic to enforce per-agent caps so a
// mis-behaving bidder agent cannot drain the advertiser's on-chain budget.
type BidderAgentSpendWindow struct {
	AgentID     string    `json:"agentId"`
	WindowType  string    `json:"windowType"` // "hourly" | "daily"
	WindowStart time.Time `json:"windowStart"`
	SpentAtomic int64     `json:"spentAtomic"`
}

// GetBidderAgentSpendWindows returns current-hour and current-day spend rows
// for the given agent (rows may not exist yet — returned as zero-value).
func (q *Queries) GetBidderAgentSpendWindows(ctx context.Context, agentID string) (hourly BidderAgentSpendWindow, daily BidderAgentSpendWindow, err error) {
	now := time.Now().UTC()
	hourStart := now.Truncate(time.Hour)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	hourly = BidderAgentSpendWindow{AgentID: agentID, WindowType: "hourly", WindowStart: hourStart}
	daily = BidderAgentSpendWindow{AgentID: agentID, WindowType: "daily", WindowStart: dayStart}

	const sql = `
		SELECT window_type, spent_atomic
		FROM bidder_agent_spend_windows
		WHERE agent_id = $1
		  AND (
		    (window_type = 'hourly' AND window_start = $2)
		    OR (window_type = 'daily' AND window_start = $3)
		  )`
	rows, err := q.Pool.Query(ctx, sql, agentID, hourStart, dayStart)
	if err != nil {
		return hourly, daily, fmt.Errorf("load spend windows: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var windowType string
		var spent int64
		if err := rows.Scan(&windowType, &spent); err != nil {
			return hourly, daily, err
		}
		switch windowType {
		case "hourly":
			hourly.SpentAtomic = spent
		case "daily":
			daily.SpentAtomic = spent
		}
	}
	return hourly, daily, rows.Err()
}

// IncrementBidderAgentSpend atomically upserts both the hourly and daily
// spend rows for the agent, adding amountAtomic. Safe to call under concurrency.
func (q *Queries) IncrementBidderAgentSpend(ctx context.Context, agentID string, amountAtomic int64) error {
	if amountAtomic <= 0 {
		return nil
	}
	now := time.Now().UTC()
	hourStart := now.Truncate(time.Hour)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	const sql = `
		INSERT INTO bidder_agent_spend_windows (agent_id, window_type, window_start, spent_atomic, updated_at)
		VALUES ($1,'hourly',$2,$4,NOW()), ($1,'daily',$3,$4,NOW())
		ON CONFLICT (agent_id, window_type, window_start)
		DO UPDATE SET
			spent_atomic = bidder_agent_spend_windows.spent_atomic + EXCLUDED.spent_atomic,
			updated_at = NOW()`
	_, err := q.Pool.Exec(ctx, sql, agentID, hourStart, dayStart, amountAtomic)
	if err != nil {
		return fmt.Errorf("increment bidder agent spend: %w", err)
	}
	return nil
}
