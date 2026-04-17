-- 004: On-chain Sepolia USDC deposits claimed into advertiser balances

CREATE TABLE IF NOT EXISTS onchain_deposits (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    wallet_address TEXT NOT NULL,
    treasury_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'eip155:11155111',
    tx_hash TEXT NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    amount_atomic BIGINT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onchain_deposits_advertiser_created_at
    ON onchain_deposits(advertiser_id, created_at DESC);
