-- 008: Per-advertiser library of reusable bidder strategy templates and agent skills.
-- These are referenced from the bidder-agents UI so an advertiser can save their own
-- templates/skills alongside the built-in presets and pick from them when editing agents.

CREATE TABLE IF NOT EXISTS bidder_strategy_templates (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL,
    value_per_click NUMERIC(18, 6),
    max_bid_cpm NUMERIC(18, 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bidder_strategy_templates_advertiser
    ON bidder_strategy_templates (advertiser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bidder_agent_skills (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    prompt_snippet TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bidder_agent_skills_advertiser
    ON bidder_agent_skills (advertiser_id, created_at DESC);
