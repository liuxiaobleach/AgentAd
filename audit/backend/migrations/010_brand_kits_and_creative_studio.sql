-- 010: Brand kits + creative studio batch generation.
-- Advertisers can save reusable brand constraints, then launch multi-variant
-- studio runs that generate several creatives and later compare them in
-- Creative Lab.

CREATE TABLE IF NOT EXISTS brand_kits (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    voice_tone TEXT NOT NULL DEFAULT '',
    primary_message TEXT NOT NULL DEFAULT '',
    color_palette TEXT[] NOT NULL DEFAULT '{}',
    mandatory_terms TEXT[] NOT NULL DEFAULT '{}',
    banned_terms TEXT[] NOT NULL DEFAULT '{}',
    visual_rules TEXT NOT NULL DEFAULT '',
    cta_preferences TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_kits_advertiser
    ON brand_kits (advertiser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creative_studio_runs (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
    brand_kit_id TEXT REFERENCES brand_kits(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    base_creative_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    landing_url TEXT NOT NULL,
    target_audiences TEXT[] NOT NULL DEFAULT '{}',
    style_hint TEXT NOT NULL DEFAULT '',
    aspect_ratio TEXT NOT NULL DEFAULT '',
    variant_count INTEGER NOT NULL CHECK (variant_count >= 1 AND variant_count <= 4),
    auto_submit_audit BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creative_studio_runs_advertiser
    ON creative_studio_runs (advertiser_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creative_studio_run_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES creative_studio_runs(id) ON DELETE CASCADE,
    creative_id TEXT NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
    variant_index INTEGER NOT NULL,
    variant_label TEXT NOT NULL,
    variant_angle TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL DEFAULT 'queued',
    status TEXT NOT NULL DEFAULT 'QUEUED',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creative_studio_run_items_run
    ON creative_studio_run_items (run_id, variant_index ASC);
