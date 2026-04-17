-- 003: Billing ledger, reservations, and outbound x402 payment events

CREATE TABLE IF NOT EXISTS advertiser_balances (
    advertiser_id TEXT PRIMARY KEY REFERENCES advertisers(id),
    currency TEXT NOT NULL DEFAULT 'USDC',
    total_atomic BIGINT NOT NULL DEFAULT 0,
    reserved_atomic BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS balance_ledger_entries (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    entry_type TEXT NOT NULL,
    amount_atomic BIGINT NOT NULL,
    description TEXT NOT NULL,
    reservation_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_ledger_entries_advertiser_created_at
    ON balance_ledger_entries(advertiser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS spend_reservations (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    operation_type TEXT NOT NULL,
    operation_ref TEXT,
    status TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDC',
    base_fee_atomic BIGINT NOT NULL DEFAULT 0,
    max_external_spend_atomic BIGINT NOT NULL DEFAULT 0,
    reserved_atomic BIGINT NOT NULL DEFAULT 0,
    external_spend_atomic BIGINT NOT NULL DEFAULT 0,
    captured_atomic BIGINT NOT NULL DEFAULT 0,
    released_atomic BIGINT NOT NULL DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_spend_reservations_advertiser_created_at
    ON spend_reservations(advertiser_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spend_reservations_operation_ref
    ON spend_reservations(operation_ref);

CREATE TABLE IF NOT EXISTS outbound_payment_events (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    reservation_id TEXT NOT NULL REFERENCES spend_reservations(id),
    provider TEXT NOT NULL,
    request_url TEXT NOT NULL,
    network TEXT,
    asset TEXT,
    amount_atomic BIGINT NOT NULL,
    payer TEXT,
    transaction_hash TEXT,
    status TEXT NOT NULL,
    response_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_payment_events_reservation_created_at
    ON outbound_payment_events(reservation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_payment_events_transaction_hash
    ON outbound_payment_events(transaction_hash)
    WHERE transaction_hash IS NOT NULL;

INSERT INTO advertiser_balances (advertiser_id)
SELECT id FROM advertisers
ON CONFLICT (advertiser_id) DO NOTHING;
