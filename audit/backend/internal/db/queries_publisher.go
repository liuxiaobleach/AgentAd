package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var ErrClaimReceiptNotFound = errors.New("claim receipt not found")

// ---------------------------------------------------------------------------
// Publishers + auth
// ---------------------------------------------------------------------------

func (q *Queries) GetPublisherByEmail(ctx context.Context, email string) (Publisher, error) {
	const sql = `
		SELECT id, name, contact_email, password_hash, wallet_address, wallet_linked_at, created_at
		FROM publishers WHERE contact_email = $1`
	var p Publisher
	err := q.Pool.QueryRow(ctx, sql, email).Scan(
		&p.ID, &p.Name, &p.ContactEmail, &p.PasswordHash,
		&p.WalletAddress, &p.WalletLinkedAt, &p.CreatedAt,
	)
	if err != nil {
		return Publisher{}, fmt.Errorf("publisher not found: %w", err)
	}
	return p, nil
}

func (q *Queries) GetPublisherByID(ctx context.Context, id string) (Publisher, error) {
	const sql = `
		SELECT id, name, contact_email, password_hash, wallet_address, wallet_linked_at, created_at
		FROM publishers WHERE id = $1`
	var p Publisher
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&p.ID, &p.Name, &p.ContactEmail, &p.PasswordHash,
		&p.WalletAddress, &p.WalletLinkedAt, &p.CreatedAt,
	)
	if err != nil {
		return Publisher{}, fmt.Errorf("publisher not found: %w", err)
	}
	return p, nil
}

func (q *Queries) UpdatePublisherWallet(ctx context.Context, publisherID, walletAddress string) (Publisher, error) {
	const sql = `
		UPDATE publishers
		SET wallet_address = $1, wallet_linked_at = NOW()
		WHERE id = $2
		RETURNING id, name, contact_email, password_hash, wallet_address, wallet_linked_at, created_at`
	var p Publisher
	err := q.Pool.QueryRow(ctx, sql, walletAddress, publisherID).Scan(
		&p.ID, &p.Name, &p.ContactEmail, &p.PasswordHash,
		&p.WalletAddress, &p.WalletLinkedAt, &p.CreatedAt,
	)
	if err != nil {
		return Publisher{}, fmt.Errorf("update publisher wallet: %w", err)
	}
	return p, nil
}

func (q *Queries) IsPublisherWalletLinkedToOther(ctx context.Context, walletAddress, publisherID string) (bool, error) {
	const sql = `
		SELECT id FROM publishers
		WHERE LOWER(wallet_address) = LOWER($1) AND id <> $2 LIMIT 1`
	var other string
	err := q.Pool.QueryRow(ctx, sql, walletAddress, publisherID).Scan(&other)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return other != "", nil
}

// ---------------------------------------------------------------------------
// Slot ownership
// ---------------------------------------------------------------------------

// ResolvePublisherForSlot returns the publisher_id owning this slot_id.
// Falls back to the default "pub_demo" publisher when the slot isn't mapped
// so the demo flow never drops credit on the floor.
func (q *Queries) ResolvePublisherForSlot(ctx context.Context, slotID string) (string, error) {
	const sql = `
		SELECT publisher_id FROM publisher_slots WHERE slot_id = $1
		UNION ALL
		SELECT 'pub_demo' WHERE NOT EXISTS (SELECT 1 FROM publisher_slots WHERE slot_id = $1)
		LIMIT 1`
	var id string
	err := q.Pool.QueryRow(ctx, sql, slotID).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

func ensurePublisherEarningsTx(ctx context.Context, tx pgx.Tx, publisherID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO publisher_earnings (publisher_id)
		VALUES ($1) ON CONFLICT (publisher_id) DO NOTHING`, publisherID)
	return err
}

func (q *Queries) GetPublisherEarnings(ctx context.Context, publisherID string) (PublisherEarnings, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return PublisherEarnings{}, err
	}
	defer tx.Rollback(ctx)
	if err := ensurePublisherEarningsTx(ctx, tx, publisherID); err != nil {
		return PublisherEarnings{}, err
	}
	const sql = `
		SELECT publisher_id, currency, total_earned_atomic, claimed_atomic, unclaimed_atomic, updated_at
		FROM publisher_earnings WHERE publisher_id = $1`
	var e PublisherEarnings
	err = tx.QueryRow(ctx, sql, publisherID).Scan(
		&e.PublisherID, &e.Currency, &e.TotalEarnedAtomic,
		&e.ClaimedAtomic, &e.UnclaimedAtomic, &e.UpdatedAt,
	)
	if err != nil {
		return PublisherEarnings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PublisherEarnings{}, err
	}
	return e, nil
}

// CreatePublisherEarningEvent records one impression/click credit and bumps
// the publisher's total_earned_atomic in the same transaction.
func (q *Queries) CreatePublisherEarningEvent(
	ctx context.Context,
	publisherID, eventType string,
	auctionRequestID, auctionBidID, slotID *string,
	amountAtomic int64,
	metadata json.RawMessage,
) (PublisherEarningEvent, error) {
	if amountAtomic <= 0 {
		return PublisherEarningEvent{}, fmt.Errorf("amount must be > 0")
	}
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return PublisherEarningEvent{}, err
	}
	defer tx.Rollback(ctx)

	if err := ensurePublisherEarningsTx(ctx, tx, publisherID); err != nil {
		return PublisherEarningEvent{}, err
	}

	ev := PublisherEarningEvent{
		ID:               newID(),
		PublisherID:      publisherID,
		EventType:        eventType,
		AuctionRequestID: auctionRequestID,
		AuctionBidID:     auctionBidID,
		SlotID:           slotID,
		AmountAtomic:     amountAtomic,
		Metadata:         metadata,
	}
	const insertSQL = `
		INSERT INTO publisher_earning_events
		  (id, publisher_id, event_type, auction_request_id, auction_bid_id, slot_id, amount_atomic, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at`
	if err := tx.QueryRow(ctx, insertSQL,
		ev.ID, ev.PublisherID, ev.EventType,
		ev.AuctionRequestID, ev.AuctionBidID, ev.SlotID,
		ev.AmountAtomic, ev.Metadata,
	).Scan(&ev.CreatedAt); err != nil {
		return PublisherEarningEvent{}, fmt.Errorf("insert earning event: %w", err)
	}

	const bumpSQL = `
		UPDATE publisher_earnings
		SET total_earned_atomic = total_earned_atomic + $1,
		    updated_at = NOW()
		WHERE publisher_id = $2`
	if _, err := tx.Exec(ctx, bumpSQL, amountAtomic, publisherID); err != nil {
		return PublisherEarningEvent{}, fmt.Errorf("bump earnings: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return PublisherEarningEvent{}, err
	}
	return ev, nil
}

func (q *Queries) ListPublisherEarningEvents(
	ctx context.Context,
	publisherID string,
	limit int,
) ([]PublisherEarningEvent, error) {
	const sql = `
		SELECT id, publisher_id, event_type, auction_request_id, auction_bid_id, slot_id,
		       amount_atomic, metadata, created_at
		FROM publisher_earning_events
		WHERE publisher_id = $1
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := q.Pool.Query(ctx, sql, publisherID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []PublisherEarningEvent
	for rows.Next() {
		var ev PublisherEarningEvent
		if err := rows.Scan(
			&ev.ID, &ev.PublisherID, &ev.EventType,
			&ev.AuctionRequestID, &ev.AuctionBidID, &ev.SlotID,
			&ev.AmountAtomic, &ev.Metadata, &ev.CreatedAt,
		); err != nil {
			return nil, err
		}
		events = append(events, ev)
	}
	if events == nil {
		events = []PublisherEarningEvent{}
	}
	return events, rows.Err()
}

// ---------------------------------------------------------------------------
// Claim receipts
// ---------------------------------------------------------------------------

// CreateClaimReceipt records a freshly-issued receipt and simultaneously marks
// the amount as "reserved" by bumping claimed_atomic — this prevents issuing
// overlapping receipts for the same unclaimed balance. If the publisher never
// submits the claim on-chain, a background job (not yet implemented) should
// re-open the receipt via ExpireClaimReceipt.
func (q *Queries) CreateClaimReceipt(
	ctx context.Context,
	rec ClaimReceipt,
) (ClaimReceipt, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return ClaimReceipt{}, err
	}
	defer tx.Rollback(ctx)

	if err := ensurePublisherEarningsTx(ctx, tx, rec.PublisherID); err != nil {
		return ClaimReceipt{}, err
	}

	// Atomically verify enough unclaimed balance and reserve it.
	const bumpSQL = `
		UPDATE publisher_earnings
		SET claimed_atomic = claimed_atomic + $1, updated_at = NOW()
		WHERE publisher_id = $2
		  AND total_earned_atomic - claimed_atomic >= $1
		RETURNING total_earned_atomic, claimed_atomic`
	var total, claimed int64
	if err := tx.QueryRow(ctx, bumpSQL, rec.AmountAtomic, rec.PublisherID).Scan(&total, &claimed); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ClaimReceipt{}, fmt.Errorf("insufficient unclaimed earnings")
		}
		return ClaimReceipt{}, fmt.Errorf("reserve claim: %w", err)
	}

	const insertSQL = `
		INSERT INTO claim_receipts (
		  id, publisher_id, wallet_address, amount_atomic, expiry_at, signature,
		  escrow_address, chain_id, status, metadata
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING issued_at`
	if err := tx.QueryRow(ctx, insertSQL,
		rec.ID, rec.PublisherID, rec.WalletAddress, rec.AmountAtomic,
		rec.ExpiryAt, rec.Signature, rec.EscrowAddress, rec.ChainID,
		string(ClaimReceiptStatusIssued), rec.Metadata,
	).Scan(&rec.IssuedAt); err != nil {
		return ClaimReceipt{}, fmt.Errorf("insert receipt: %w", err)
	}
	rec.Status = ClaimReceiptStatusIssued

	if err := tx.Commit(ctx); err != nil {
		return ClaimReceipt{}, err
	}
	return rec, nil
}

func (q *Queries) GetClaimReceipt(ctx context.Context, id string) (ClaimReceipt, error) {
	const sql = `
		SELECT id, publisher_id, wallet_address, amount_atomic, expiry_at, signature,
		       escrow_address, chain_id, status, claim_tx_hash, claim_block_number,
		       issued_at, claimed_at, metadata
		FROM claim_receipts WHERE id = $1`
	var rec ClaimReceipt
	var statusStr string
	err := q.Pool.QueryRow(ctx, sql, id).Scan(
		&rec.ID, &rec.PublisherID, &rec.WalletAddress, &rec.AmountAtomic,
		&rec.ExpiryAt, &rec.Signature, &rec.EscrowAddress, &rec.ChainID,
		&statusStr, &rec.ClaimTxHash, &rec.ClaimBlockNumber,
		&rec.IssuedAt, &rec.ClaimedAt, &rec.Metadata,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ClaimReceipt{}, ErrClaimReceiptNotFound
		}
		return ClaimReceipt{}, err
	}
	rec.Status = ClaimReceiptStatus(statusStr)
	return rec, nil
}

func (q *Queries) ListPublisherClaimReceipts(
	ctx context.Context,
	publisherID string,
	limit int,
) ([]ClaimReceipt, error) {
	const sql = `
		SELECT id, publisher_id, wallet_address, amount_atomic, expiry_at, signature,
		       escrow_address, chain_id, status, claim_tx_hash, claim_block_number,
		       issued_at, claimed_at, metadata
		FROM claim_receipts
		WHERE publisher_id = $1
		ORDER BY issued_at DESC
		LIMIT $2`
	rows, err := q.Pool.Query(ctx, sql, publisherID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ClaimReceipt
	for rows.Next() {
		var rec ClaimReceipt
		var statusStr string
		if err := rows.Scan(
			&rec.ID, &rec.PublisherID, &rec.WalletAddress, &rec.AmountAtomic,
			&rec.ExpiryAt, &rec.Signature, &rec.EscrowAddress, &rec.ChainID,
			&statusStr, &rec.ClaimTxHash, &rec.ClaimBlockNumber,
			&rec.IssuedAt, &rec.ClaimedAt, &rec.Metadata,
		); err != nil {
			return nil, err
		}
		rec.Status = ClaimReceiptStatus(statusStr)
		out = append(out, rec)
	}
	if out == nil {
		out = []ClaimReceipt{}
	}
	return out, rows.Err()
}

// MarkClaimReceiptClaimed is idempotent — second call on the same txHash
// returns the existing record.
func (q *Queries) MarkClaimReceiptClaimed(
	ctx context.Context,
	receiptID, txHash string,
	blockNumber int64,
) (ClaimReceipt, error) {
	const sql = `
		UPDATE claim_receipts
		SET status = $1,
		    claim_tx_hash = $2,
		    claim_block_number = $3,
		    claimed_at = NOW()
		WHERE id = $4 AND status = $5
		RETURNING id, publisher_id, wallet_address, amount_atomic, expiry_at, signature,
		          escrow_address, chain_id, status, claim_tx_hash, claim_block_number,
		          issued_at, claimed_at, metadata`
	var rec ClaimReceipt
	var statusStr string
	err := q.Pool.QueryRow(ctx, sql,
		string(ClaimReceiptStatusClaimed), txHash, blockNumber,
		receiptID, string(ClaimReceiptStatusIssued),
	).Scan(
		&rec.ID, &rec.PublisherID, &rec.WalletAddress, &rec.AmountAtomic,
		&rec.ExpiryAt, &rec.Signature, &rec.EscrowAddress, &rec.ChainID,
		&statusStr, &rec.ClaimTxHash, &rec.ClaimBlockNumber,
		&rec.IssuedAt, &rec.ClaimedAt, &rec.Metadata,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Already claimed or expired — return current state.
			return q.GetClaimReceipt(ctx, receiptID)
		}
		return ClaimReceipt{}, err
	}
	rec.Status = ClaimReceiptStatus(statusStr)
	return rec, nil
}
