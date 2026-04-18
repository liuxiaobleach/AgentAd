-- 007: Support ticket system — works for both advertisers and publishers.

CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    requester_type TEXT NOT NULL CHECK (requester_type IN ('advertiser','publisher')),
    requester_id TEXT NOT NULL,
    requester_name TEXT NOT NULL,
    requester_email TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low','normal','high','urgent')),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_requester
    ON support_tickets (requester_type, requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
    ON support_tickets (status, last_message_at DESC);

-- Thread of messages per ticket. The first row is the ticket's original body
-- (author_type = requester_type); subsequent rows are replies.
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK (author_type IN ('advertiser','publisher','support')),
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
    ON support_ticket_messages (ticket_id, created_at);
