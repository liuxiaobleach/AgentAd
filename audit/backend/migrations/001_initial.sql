-- ZKDSP Audit Database Schema

CREATE TYPE creative_status AS ENUM ('DRAFT', 'PENDING_AUDIT', 'AUDITING', 'APPROVED', 'REJECTED');
CREATE TYPE audit_status AS ENUM ('PENDING', 'TRIAGING', 'TOOLS_RUNNING', 'EVALUATING', 'MANUAL_REVIEW', 'COMPLETED');
CREATE TYPE audit_decision AS ENUM ('PASS', 'REJECT', 'MANUAL_REVIEW');
CREATE TYPE attestation_status AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE advertisers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wallet_address TEXT,
    contact_email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE creatives (
    id TEXT PRIMARY KEY,
    advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
    creative_name TEXT NOT NULL,
    project_name TEXT NOT NULL,
    image_url TEXT,
    creative_hash TEXT,
    landing_url TEXT NOT NULL,
    telegram_url TEXT,
    click_url TEXT,
    chain_id INT,
    contract_address TEXT,
    placement_domains TEXT[] DEFAULT '{}',
    notes TEXT,
    status creative_status NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_cases (
    id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL REFERENCES creatives(id),
    status audit_status NOT NULL DEFAULT 'PENDING',
    risk_score DOUBLE PRECISION,
    decision audit_decision,
    policy_version TEXT NOT NULL DEFAULT 'v1.0',
    summary TEXT,
    agent_thinking JSONB,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE audit_evidences (
    id TEXT PRIMARY KEY,
    audit_case_id TEXT NOT NULL REFERENCES audit_cases(id),
    tool_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    risk_signals JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attestations (
    id TEXT PRIMARY KEY,
    audit_case_id TEXT UNIQUE NOT NULL REFERENCES audit_cases(id),
    attestation_id TEXT UNIQUE NOT NULL,
    chain_id INT NOT NULL,
    tx_hash TEXT,
    status attestation_status NOT NULL DEFAULT 'PENDING',
    report_cid TEXT,
    issued_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE manifests (
    id TEXT PRIMARY KEY,
    creative_id TEXT NOT NULL REFERENCES creatives(id),
    attestation_id TEXT NOT NULL,
    manifest_json JSONB NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
