-- 009: Ops 审核台 — manual-review reviewers, case assignment, audit trail.

-- Ops users: human reviewers who can override MANUAL_REVIEW audit cases.
CREATE TABLE IF NOT EXISTS ops_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reviewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional reviewer attribution on audit_cases. Null for auto-decided cases.
ALTER TABLE audit_cases
    ADD COLUMN IF NOT EXISTS reviewer_id TEXT REFERENCES ops_users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS review_notes TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_audit_cases_status_submitted
    ON audit_cases (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_cases_reviewer
    ON audit_cases (reviewer_id, reviewed_at DESC);

-- Audit trail of every manual review action. Append-only; never updated.
CREATE TABLE IF NOT EXISTS audit_review_logs (
    id TEXT PRIMARY KEY,
    audit_case_id TEXT NOT NULL REFERENCES audit_cases(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
    previous_decision audit_decision,
    new_decision audit_decision NOT NULL,
    previous_status audit_status,
    new_status audit_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_review_logs_case
    ON audit_review_logs (audit_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_review_logs_reviewer
    ON audit_review_logs (reviewer_id, created_at DESC);

-- Seed: one demo ops reviewer. Password: demo123 (real bcrypt hash).
INSERT INTO ops_users (id, name, contact_email, password_hash, role) VALUES
    ('ops_demo', 'Demo Reviewer', 'ops@agentad.demo',
     '$2a$10$acJpunpxT7VYW3nAeOKRHuF4bkkqz6n2Ma804mAOEsCUA/EhT5WUu', 'reviewer')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    contact_email = EXCLUDED.contact_email,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role;
