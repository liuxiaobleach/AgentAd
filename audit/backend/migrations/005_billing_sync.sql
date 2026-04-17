-- 005: Wallet uniqueness for valid EVM addresses and persistent chain sync cursors

CREATE UNIQUE INDEX IF NOT EXISTS idx_advertisers_wallet_address_valid_lower
    ON advertisers (LOWER(wallet_address))
    WHERE wallet_address ~* '^0x[0-9a-f]{40}$';

CREATE TABLE IF NOT EXISTS chain_sync_cursors (
    sync_name TEXT PRIMARY KEY,
    last_scanned_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
