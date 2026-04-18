package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrSupportTicketNotFound = errors.New("support ticket not found")

type SupportTicket struct {
	ID            string     `json:"id"`
	RequesterType string     `json:"requesterType"`
	RequesterID   string     `json:"requesterId"`
	RequesterName string     `json:"requesterName"`
	RequesterEmail string    `json:"requesterEmail"`
	Category      string     `json:"category"`
	Subject       string     `json:"subject"`
	Body          string     `json:"body"`
	Status        string     `json:"status"`
	Priority      string     `json:"priority"`
	LastMessageAt time.Time  `json:"lastMessageAt"`
	ResolvedAt    *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type SupportTicketMessage struct {
	ID         string    `json:"id"`
	TicketID   string    `json:"ticketId"`
	AuthorType string    `json:"authorType"`
	AuthorName string    `json:"authorName"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"createdAt"`
}

// CreateSupportTicket inserts a new ticket and seeds its first message (the
// original body) in the same transaction.
func (q *Queries) CreateSupportTicket(ctx context.Context, t SupportTicket) (SupportTicket, error) {
	if t.ID == "" {
		t.ID = newID()
	}
	if t.Status == "" {
		t.Status = "open"
	}
	if t.Priority == "" {
		t.Priority = "normal"
	}

	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return SupportTicket{}, err
	}
	defer tx.Rollback(ctx)

	const insertTicket = `
		INSERT INTO support_tickets
		  (id, requester_type, requester_id, requester_name, requester_email,
		   category, subject, body, status, priority)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING last_message_at, created_at, updated_at`
	if err := tx.QueryRow(ctx, insertTicket,
		t.ID, t.RequesterType, t.RequesterID, t.RequesterName, t.RequesterEmail,
		t.Category, t.Subject, t.Body, t.Status, t.Priority,
	).Scan(&t.LastMessageAt, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return SupportTicket{}, fmt.Errorf("insert ticket: %w", err)
	}

	const insertMsg = `
		INSERT INTO support_ticket_messages (id, ticket_id, author_type, author_name, body)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := tx.Exec(ctx, insertMsg,
		newID(), t.ID, t.RequesterType, t.RequesterName, t.Body,
	); err != nil {
		return SupportTicket{}, fmt.Errorf("insert first message: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return SupportTicket{}, err
	}
	return t, nil
}

func (q *Queries) ListSupportTicketsForRequester(
	ctx context.Context,
	requesterType, requesterID string,
	limit int,
) ([]SupportTicket, error) {
	if limit <= 0 {
		limit = 50
	}
	const sql = `
		SELECT id, requester_type, requester_id, requester_name, requester_email,
		       category, subject, body, status, priority,
		       last_message_at, resolved_at, created_at, updated_at
		FROM support_tickets
		WHERE requester_type = $1 AND requester_id = $2
		ORDER BY last_message_at DESC
		LIMIT $3`
	rows, err := q.Pool.Query(ctx, sql, requesterType, requesterID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SupportTicket
	for rows.Next() {
		var t SupportTicket
		if err := rows.Scan(
			&t.ID, &t.RequesterType, &t.RequesterID, &t.RequesterName, &t.RequesterEmail,
			&t.Category, &t.Subject, &t.Body, &t.Status, &t.Priority,
			&t.LastMessageAt, &t.ResolvedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []SupportTicket{}
	}
	return out, rows.Err()
}

// GetSupportTicketForRequester returns a ticket only if it belongs to the given
// requester (so a publisher can't read an advertiser's ticket and vice-versa).
func (q *Queries) GetSupportTicketForRequester(
	ctx context.Context,
	ticketID, requesterType, requesterID string,
) (SupportTicket, error) {
	const sql = `
		SELECT id, requester_type, requester_id, requester_name, requester_email,
		       category, subject, body, status, priority,
		       last_message_at, resolved_at, created_at, updated_at
		FROM support_tickets
		WHERE id = $1 AND requester_type = $2 AND requester_id = $3`
	var t SupportTicket
	err := q.Pool.QueryRow(ctx, sql, ticketID, requesterType, requesterID).Scan(
		&t.ID, &t.RequesterType, &t.RequesterID, &t.RequesterName, &t.RequesterEmail,
		&t.Category, &t.Subject, &t.Body, &t.Status, &t.Priority,
		&t.LastMessageAt, &t.ResolvedAt, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SupportTicket{}, ErrSupportTicketNotFound
		}
		return SupportTicket{}, err
	}
	return t, nil
}

func (q *Queries) ListSupportTicketMessages(
	ctx context.Context,
	ticketID string,
) ([]SupportTicketMessage, error) {
	const sql = `
		SELECT id, ticket_id, author_type, author_name, body, created_at
		FROM support_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC`
	rows, err := q.Pool.Query(ctx, sql, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SupportTicketMessage
	for rows.Next() {
		var m SupportTicketMessage
		if err := rows.Scan(&m.ID, &m.TicketID, &m.AuthorType, &m.AuthorName, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if out == nil {
		out = []SupportTicketMessage{}
	}
	return out, rows.Err()
}

// AppendSupportTicketMessage inserts a new reply and bumps last_message_at /
// re-opens the ticket if the requester replies on a resolved one.
func (q *Queries) AppendSupportTicketMessage(
	ctx context.Context,
	ticketID, authorType, authorName, body string,
) (SupportTicketMessage, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return SupportTicketMessage{}, err
	}
	defer tx.Rollback(ctx)

	msg := SupportTicketMessage{
		ID:         newID(),
		TicketID:   ticketID,
		AuthorType: authorType,
		AuthorName: authorName,
		Body:       body,
	}
	const insertSQL = `
		INSERT INTO support_ticket_messages (id, ticket_id, author_type, author_name, body)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING created_at`
	if err := tx.QueryRow(ctx, insertSQL, msg.ID, msg.TicketID, msg.AuthorType, msg.AuthorName, msg.Body).Scan(&msg.CreatedAt); err != nil {
		return SupportTicketMessage{}, fmt.Errorf("insert message: %w", err)
	}

	// If requester posts on a resolved/closed ticket, re-open it. If support
	// replies, flip to waiting-on-requester.
	newStatus := ""
	switch authorType {
	case "advertiser", "publisher":
		newStatus = "open"
	case "support":
		newStatus = "waiting"
	}
	const bumpSQL = `
		UPDATE support_tickets
		SET last_message_at = NOW(),
		    updated_at = NOW(),
		    status = CASE
		        WHEN $2 <> '' AND status IN ('resolved','closed') THEN 'open'
		        WHEN $2 <> '' THEN $2
		        ELSE status
		    END
		WHERE id = $1`
	if _, err := tx.Exec(ctx, bumpSQL, ticketID, newStatus); err != nil {
		return SupportTicketMessage{}, fmt.Errorf("bump ticket: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return SupportTicketMessage{}, err
	}
	return msg, nil
}
