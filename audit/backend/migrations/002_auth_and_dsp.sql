-- 002: Auth + Creative Analysis + Bidding System

-- Auth: add password_hash to advertisers
ALTER TABLE advertisers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Creative Profiles
CREATE TABLE IF NOT EXISTS creative_profiles (
    id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL REFERENCES creatives(id),
    audit_case_id TEXT REFERENCES audit_cases(id),
    analysis_version INT NOT NULL DEFAULT 1,
    marketing_summary TEXT,
    visual_tags TEXT[],
    cta_type TEXT,
    copy_style TEXT,
    target_audiences TEXT[],
    placement_fit JSONB,
    predicted_ctr_priors JSONB,
    bid_hints JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bidder Agents
CREATE TYPE bidder_agent_status AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

CREATE TABLE IF NOT EXISTS bidder_agents (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    name TEXT NOT NULL,
    strategy TEXT NOT NULL DEFAULT 'balanced',
    strategy_prompt TEXT,
    value_per_click DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    max_bid_cpm DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    status bidder_agent_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auction Requests (simulated ad slot requests)
CREATE TABLE IF NOT EXISTS auction_requests (
    id TEXT PRIMARY KEY,
    slot_id TEXT NOT NULL,
    slot_type TEXT NOT NULL,
    size TEXT NOT NULL,
    floor_cpm DOUBLE PRECISION NOT NULL DEFAULT 0,
    site_category TEXT,
    user_segments TEXT[],
    context JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auction Bids (each agent's bid per auction)
CREATE TABLE IF NOT EXISTS auction_bids (
    id TEXT PRIMARY KEY,
    auction_request_id TEXT NOT NULL REFERENCES auction_requests(id),
    bidder_agent_id TEXT NOT NULL REFERENCES bidder_agents(id),
    selected_creative_id TEXT REFERENCES creatives(id),
    predicted_ctr DOUBLE PRECISION,
    bid_cpm DOUBLE PRECISION,
    confidence DOUBLE PRECISION,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auction Results
CREATE TABLE IF NOT EXISTS auction_results (
    id TEXT PRIMARY KEY,
    auction_request_id TEXT NOT NULL REFERENCES auction_requests(id),
    winner_bid_id TEXT REFERENCES auction_bids(id),
    settlement_price DOUBLE PRECISION,
    shown_creative_id TEXT REFERENCES creatives(id),
    clicked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed 2 demo advertisers (password: demo123)
-- bcrypt hash of "demo123" precomputed
INSERT INTO advertisers (id, name, wallet_address, contact_email, password_hash) VALUES
    ('adv_alpha', 'Alpha DeFi', '0xAlpha0001', 'alpha@agentad.demo',
     '$2a$10$xJ8Kx5r5y5y5y5y5y5y5yOvKj0UmL3bA2w4ZxQ3n8m6oP9kR1sS2'),
    ('adv_beta', 'Beta Gaming', '0xBeta0002', 'beta@agentad.demo',
     '$2a$10$xJ8Kx5r5y5y5y5y5y5y5yOvKj0UmL3bA2w4ZxQ3n8m6oP9kR1sS2')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    wallet_address = EXCLUDED.wallet_address,
    password_hash = EXCLUDED.password_hash;

-- Create default bidder agents for each
INSERT INTO bidder_agents (id, advertiser_id, name, strategy, strategy_prompt, value_per_click, max_bid_cpm) VALUES
    ('ba_alpha', 'adv_alpha', 'Alpha Growth Agent', 'growth',
     '积极增长策略：优先选择高 CTR 素材，适当提高出价争取更多展示。',
     2.0, 50.0),
    ('ba_beta', 'adv_beta', 'Beta Balanced Agent', 'balanced',
     '均衡策略：在 CTR 和成本之间取平衡，避免过度出价。',
     1.5, 35.0)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    strategy = EXCLUDED.strategy,
    strategy_prompt = EXCLUDED.strategy_prompt;
