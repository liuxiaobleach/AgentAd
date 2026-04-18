-- 005: Per-agent daily / hourly budget caps and rolling spend windows.
-- 0 means unlimited (keeps backwards compatibility with seeded agents).

ALTER TABLE bidder_agents
    ADD COLUMN IF NOT EXISTS daily_budget_atomic BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hourly_budget_atomic BIGINT NOT NULL DEFAULT 0;

-- Rolling spend aggregated per (agent, window_type, window_start).
-- window_start is truncated to hour/day boundary.
CREATE TABLE IF NOT EXISTS bidder_agent_spend_windows (
    agent_id TEXT NOT NULL REFERENCES bidder_agents(id) ON DELETE CASCADE,
    window_type TEXT NOT NULL CHECK (window_type IN ('hourly','daily')),
    window_start TIMESTAMPTZ NOT NULL,
    spent_atomic BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_bidder_spend_windows_agent
    ON bidder_agent_spend_windows (agent_id, window_type, window_start DESC);

-- Sensible defaults for the seeded demo agents so the guard is exercised in demo runs.
UPDATE bidder_agents
SET daily_budget_atomic  = 10000000,   -- 10 USDC / day
    hourly_budget_atomic = 2000000     -- 2  USDC / hour
WHERE id IN ('ba_alpha','ba_beta')
  AND daily_budget_atomic = 0
  AND hourly_budget_atomic = 0;
