-- 006: Publisher system — ownership of ad slots, earnings ledger, claim receipts.

CREATE TABLE IF NOT EXISTS publishers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    wallet_address TEXT,
    wallet_linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publishers_wallet_ci
    ON publishers (LOWER(wallet_address))
    WHERE wallet_address IS NOT NULL;

-- One publisher can own many slot_ids. slot_id (string) is what the publisher
-- SDK sends in ad-slot requests. Unmapped slot_ids fall back to the default
-- publisher so the demo flow always has an owner to credit.
CREATE TABLE IF NOT EXISTS publisher_slots (
    slot_id TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_publisher_slots_publisher
    ON publisher_slots (publisher_id);

-- Aggregate per-publisher earnings (totals kept for O(1) lookup).
CREATE TABLE IF NOT EXISTS publisher_earnings (
    publisher_id TEXT PRIMARY KEY REFERENCES publishers(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USDC',
    total_earned_atomic BIGINT NOT NULL DEFAULT 0,
    claimed_atomic BIGINT NOT NULL DEFAULT 0,
    unclaimed_atomic BIGINT GENERATED ALWAYS AS (total_earned_atomic - claimed_atomic) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-event detail for auditability. Each auction impression / click that
-- credits a publisher is one row here.
CREATE TABLE IF NOT EXISTS publisher_earning_events (
    id TEXT PRIMARY KEY,
    publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('impression','click')),
    auction_request_id TEXT,
    auction_bid_id TEXT,
    slot_id TEXT,
    amount_atomic BIGINT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_publisher_earning_events_publisher_created_at
    ON publisher_earning_events (publisher_id, created_at DESC);

-- Claim receipts issued by the backend. Status walks:
--   issued   -> publisher has receipt; not yet submitted to chain
--   claimed  -> publisher submitted claim(); we saw the tx confirmed
--   expired  -> receipt expiry passed without being claimed
CREATE TABLE IF NOT EXISTS claim_receipts (
    id TEXT PRIMARY KEY,                   -- = receiptId passed to contract (bytes32 hex)
    publisher_id TEXT NOT NULL REFERENCES publishers(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    amount_atomic BIGINT NOT NULL,
    expiry_at TIMESTAMPTZ NOT NULL,
    signature TEXT NOT NULL,               -- 0x-prefixed hex
    escrow_address TEXT NOT NULL,
    chain_id BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'issued',
    claim_tx_hash TEXT,
    claim_block_number BIGINT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_claim_receipts_publisher_status_issued
    ON claim_receipts (publisher_id, status, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_receipts_tx_hash
    ON claim_receipts (claim_tx_hash)
    WHERE claim_tx_hash IS NOT NULL;

-- Seed: a default demo publisher and map the test slot_ids we already use.
-- password: demo123 (bcrypt hash same as advertisers).
INSERT INTO publishers (id, name, contact_email, password_hash) VALUES
    ('pub_demo', 'Demo Publisher', 'publisher@agentad.demo',
     '$2a$10$xJ8Kx5r5y5y5y5y5y5y5yOvKj0UmL3bA2w4ZxQ3n8m6oP9kR1sS2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO publisher_earnings (publisher_id)
SELECT id FROM publishers
ON CONFLICT (publisher_id) DO NOTHING;

-- Map the demo slot ids so every existing auction flow has an owner.
INSERT INTO publisher_slots (slot_id, publisher_id) VALUES
    ('test_slot_001','pub_demo'),
    ('slot-001','pub_demo'),
    ('demo-slot','pub_demo')
ON CONFLICT (slot_id) DO NOTHING;
