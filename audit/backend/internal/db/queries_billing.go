package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrInsufficientBalance = errors.New("insufficient balance")
var ErrOnchainDepositClaimed = errors.New("onchain deposit already claimed")

func ensureAdvertiserBalanceTx(ctx context.Context, tx pgx.Tx, advertiserID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO advertiser_balances (advertiser_id)
		VALUES ($1)
		ON CONFLICT (advertiser_id) DO NOTHING
	`, advertiserID)
	return err
}

func getAdvertiserBalanceTx(ctx context.Context, tx pgx.Tx, advertiserID string) (AdvertiserBalance, error) {
	if err := ensureAdvertiserBalanceTx(ctx, tx, advertiserID); err != nil {
		return AdvertiserBalance{}, err
	}

	const sql = `
		SELECT advertiser_id, currency, total_atomic, reserved_atomic, created_at, updated_at
		FROM advertiser_balances
		WHERE advertiser_id = $1
		FOR UPDATE`

	var b AdvertiserBalance
	err := tx.QueryRow(ctx, sql, advertiserID).Scan(
		&b.AdvertiserID, &b.Currency, &b.TotalAtomic, &b.ReservedAtomic, &b.CreatedAt, &b.UpdatedAt,
	)
	if err != nil {
		return AdvertiserBalance{}, fmt.Errorf("load advertiser balance: %w", err)
	}
	return b, nil
}

func (q *Queries) GetAdvertiserBalance(ctx context.Context, advertiserID string) (BalanceSummary, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return BalanceSummary{}, err
	}
	defer tx.Rollback(ctx)

	b, err := getAdvertiserBalanceTx(ctx, tx, advertiserID)
	if err != nil {
		return BalanceSummary{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return BalanceSummary{}, err
	}

	return BalanceSummary{
		AdvertiserID:    b.AdvertiserID,
		Currency:        b.Currency,
		TotalAtomic:     b.TotalAtomic,
		ReservedAtomic:  b.ReservedAtomic,
		SpendableAtomic: b.TotalAtomic - b.ReservedAtomic,
		UpdatedAt:       b.UpdatedAt,
	}, nil
}

func (q *Queries) EnsureChainSyncCursor(ctx context.Context, syncName string, defaultLastScannedBlock int64) (ChainSyncCursor, error) {
	const insertSQL = `
		INSERT INTO chain_sync_cursors (sync_name, last_scanned_block)
		VALUES ($1, $2)
		ON CONFLICT (sync_name) DO NOTHING`
	if _, err := q.Pool.Exec(ctx, insertSQL, syncName, defaultLastScannedBlock); err != nil {
		return ChainSyncCursor{}, fmt.Errorf("ensure chain sync cursor: %w", err)
	}

	const selectSQL = `
		SELECT sync_name, last_scanned_block, updated_at
		FROM chain_sync_cursors
		WHERE sync_name = $1`
	var cursor ChainSyncCursor
	if err := q.Pool.QueryRow(ctx, selectSQL, syncName).Scan(
		&cursor.SyncName,
		&cursor.LastScannedBlock,
		&cursor.UpdatedAt,
	); err != nil {
		return ChainSyncCursor{}, fmt.Errorf("load chain sync cursor: %w", err)
	}
	return cursor, nil
}

func (q *Queries) AdvanceChainSyncCursor(ctx context.Context, syncName string, lastScannedBlock int64) (ChainSyncCursor, error) {
	const sql = `
		INSERT INTO chain_sync_cursors (sync_name, last_scanned_block)
		VALUES ($1, $2)
		ON CONFLICT (sync_name)
		DO UPDATE SET
			last_scanned_block = GREATEST(chain_sync_cursors.last_scanned_block, EXCLUDED.last_scanned_block),
			updated_at = NOW()
		RETURNING sync_name, last_scanned_block, updated_at`
	var cursor ChainSyncCursor
	if err := q.Pool.QueryRow(ctx, sql, syncName, lastScannedBlock).Scan(
		&cursor.SyncName,
		&cursor.LastScannedBlock,
		&cursor.UpdatedAt,
	); err != nil {
		return ChainSyncCursor{}, fmt.Errorf("advance chain sync cursor: %w", err)
	}
	return cursor, nil
}

func (q *Queries) ListLedgerEntriesByAdvertiser(ctx context.Context, advertiserID string, limit int) ([]BalanceLedgerEntry, error) {
	const sql = `
		SELECT id, advertiser_id, entry_type, amount_atomic, description, reservation_id, metadata, created_at
		FROM balance_ledger_entries
		WHERE advertiser_id = $1
		ORDER BY created_at DESC
		LIMIT $2`

	rows, err := q.Pool.Query(ctx, sql, advertiserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []BalanceLedgerEntry
	for rows.Next() {
		var entry BalanceLedgerEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.AdvertiserID,
			&entry.EntryType,
			&entry.AmountAtomic,
			&entry.Description,
			&entry.ReservationID,
			&entry.Metadata,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if entries == nil {
		return []BalanceLedgerEntry{}, nil
	}
	return entries, nil
}

func (q *Queries) CreateBalanceTopUp(ctx context.Context, advertiserID string, amountAtomic int64, description string, metadata json.RawMessage) (BalanceSummary, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return BalanceSummary{}, err
	}
	defer tx.Rollback(ctx)

	if err := ensureAdvertiserBalanceTx(ctx, tx, advertiserID); err != nil {
		return BalanceSummary{}, err
	}

	const updateSQL = `
		UPDATE advertiser_balances
		SET total_atomic = total_atomic + $1, updated_at = NOW()
		WHERE advertiser_id = $2
		RETURNING advertiser_id, currency, total_atomic, reserved_atomic, created_at, updated_at`

	var balance AdvertiserBalance
	if err := tx.QueryRow(ctx, updateSQL, amountAtomic, advertiserID).Scan(
		&balance.AdvertiserID,
		&balance.Currency,
		&balance.TotalAtomic,
		&balance.ReservedAtomic,
		&balance.CreatedAt,
		&balance.UpdatedAt,
	); err != nil {
		return BalanceSummary{}, fmt.Errorf("update balance: %w", err)
	}

	const ledgerSQL = `
		INSERT INTO balance_ledger_entries (id, advertiser_id, entry_type, amount_atomic, description, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)`
	if _, err := tx.Exec(ctx, ledgerSQL, newID(), advertiserID, BalanceLedgerEntryTopUp, amountAtomic, description, metadata); err != nil {
		return BalanceSummary{}, fmt.Errorf("insert ledger entry: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return BalanceSummary{}, err
	}

	return BalanceSummary{
		AdvertiserID:    balance.AdvertiserID,
		Currency:        balance.Currency,
		TotalAtomic:     balance.TotalAtomic,
		ReservedAtomic:  balance.ReservedAtomic,
		SpendableAtomic: balance.TotalAtomic - balance.ReservedAtomic,
		UpdatedAt:       balance.UpdatedAt,
	}, nil
}

func (q *Queries) ClaimOnchainDeposit(
	ctx context.Context,
	advertiserID string,
	walletAddress string,
	treasuryAddress string,
	tokenAddress string,
	network string,
	txHash string,
	blockNumber int64,
	amountAtomic int64,
	description string,
	metadata json.RawMessage,
) (BalanceSummary, OnchainDeposit, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return BalanceSummary{}, OnchainDeposit{}, err
	}
	defer tx.Rollback(ctx)

	if err := ensureAdvertiserBalanceTx(ctx, tx, advertiserID); err != nil {
		return BalanceSummary{}, OnchainDeposit{}, err
	}

	deposit := OnchainDeposit{
		ID:              newID(),
		AdvertiserID:    advertiserID,
		WalletAddress:   walletAddress,
		TreasuryAddress: treasuryAddress,
		TokenAddress:    tokenAddress,
		Network:         network,
		TxHash:          txHash,
		BlockNumber:     blockNumber,
		AmountAtomic:    amountAtomic,
		Metadata:        metadata,
	}

	const depositSQL = `
		INSERT INTO onchain_deposits (
			id, advertiser_id, wallet_address, treasury_address, token_address,
			network, tx_hash, block_number, amount_atomic, metadata
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (tx_hash) DO NOTHING
		RETURNING id, advertiser_id, wallet_address, treasury_address, token_address,
		          network, tx_hash, block_number, amount_atomic, metadata, created_at, credited_at`
	if err := tx.QueryRow(
		ctx,
		depositSQL,
		deposit.ID,
		deposit.AdvertiserID,
		deposit.WalletAddress,
		deposit.TreasuryAddress,
		deposit.TokenAddress,
		deposit.Network,
		deposit.TxHash,
		deposit.BlockNumber,
		deposit.AmountAtomic,
		deposit.Metadata,
	).Scan(
		&deposit.ID,
		&deposit.AdvertiserID,
		&deposit.WalletAddress,
		&deposit.TreasuryAddress,
		&deposit.TokenAddress,
		&deposit.Network,
		&deposit.TxHash,
		&deposit.BlockNumber,
		&deposit.AmountAtomic,
		&deposit.Metadata,
		&deposit.CreatedAt,
		&deposit.CreditedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return BalanceSummary{}, OnchainDeposit{}, ErrOnchainDepositClaimed
		}
		return BalanceSummary{}, OnchainDeposit{}, fmt.Errorf("insert onchain deposit: %w", err)
	}

	const updateSQL = `
		UPDATE advertiser_balances
		SET total_atomic = total_atomic + $1, updated_at = NOW()
		WHERE advertiser_id = $2
		RETURNING advertiser_id, currency, total_atomic, reserved_atomic, created_at, updated_at`

	var balance AdvertiserBalance
	if err := tx.QueryRow(ctx, updateSQL, amountAtomic, advertiserID).Scan(
		&balance.AdvertiserID,
		&balance.Currency,
		&balance.TotalAtomic,
		&balance.ReservedAtomic,
		&balance.CreatedAt,
		&balance.UpdatedAt,
	); err != nil {
		return BalanceSummary{}, OnchainDeposit{}, fmt.Errorf("update balance: %w", err)
	}

	const ledgerSQL = `
		INSERT INTO balance_ledger_entries (id, advertiser_id, entry_type, amount_atomic, description, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)`
	if _, err := tx.Exec(ctx, ledgerSQL, newID(), advertiserID, BalanceLedgerEntryTopUp, amountAtomic, description, metadata); err != nil {
		return BalanceSummary{}, OnchainDeposit{}, fmt.Errorf("insert ledger entry: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return BalanceSummary{}, OnchainDeposit{}, err
	}

	return BalanceSummary{
		AdvertiserID:    balance.AdvertiserID,
		Currency:        balance.Currency,
		TotalAtomic:     balance.TotalAtomic,
		ReservedAtomic:  balance.ReservedAtomic,
		SpendableAtomic: balance.TotalAtomic - balance.ReservedAtomic,
		UpdatedAt:       balance.UpdatedAt,
	}, deposit, nil
}

func (q *Queries) CreateSpendReservation(
	ctx context.Context,
	advertiserID string,
	operationType string,
	operationRef *string,
	baseFeeAtomic int64,
	maxExternalSpendAtomic int64,
	metadata json.RawMessage,
) (SpendReservation, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return SpendReservation{}, err
	}
	defer tx.Rollback(ctx)

	balance, err := getAdvertiserBalanceTx(ctx, tx, advertiserID)
	if err != nil {
		return SpendReservation{}, err
	}

	reservedAtomic := baseFeeAtomic + maxExternalSpendAtomic
	spendable := balance.TotalAtomic - balance.ReservedAtomic
	if reservedAtomic > spendable {
		return SpendReservation{}, ErrInsufficientBalance
	}

	const updateSQL = `
		UPDATE advertiser_balances
		SET reserved_atomic = reserved_atomic + $1, updated_at = NOW()
		WHERE advertiser_id = $2`
	if _, err := tx.Exec(ctx, updateSQL, reservedAtomic, advertiserID); err != nil {
		return SpendReservation{}, fmt.Errorf("reserve balance: %w", err)
	}

	reservation := SpendReservation{
		ID:                     newID(),
		AdvertiserID:           advertiserID,
		OperationType:          operationType,
		OperationRef:           operationRef,
		Status:                 SpendReservationStatusAuthorized,
		Currency:               balance.Currency,
		BaseFeeAtomic:          baseFeeAtomic,
		MaxExternalSpendAtomic: maxExternalSpendAtomic,
		ReservedAtomic:         reservedAtomic,
		Metadata:               metadata,
	}

	const insertSQL = `
		INSERT INTO spend_reservations (
			id, advertiser_id, operation_type, operation_ref, status, currency,
			base_fee_atomic, max_external_spend_atomic, reserved_atomic, metadata
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, advertiser_id, operation_type, operation_ref, status, currency,
		          base_fee_atomic, max_external_spend_atomic, reserved_atomic,
		          external_spend_atomic, captured_atomic, released_atomic,
		          metadata, created_at, updated_at, finalized_at`
	if err := tx.QueryRow(
		ctx,
		insertSQL,
		reservation.ID,
		reservation.AdvertiserID,
		reservation.OperationType,
		reservation.OperationRef,
		reservation.Status,
		reservation.Currency,
		reservation.BaseFeeAtomic,
		reservation.MaxExternalSpendAtomic,
		reservation.ReservedAtomic,
		reservation.Metadata,
	).Scan(
		&reservation.ID,
		&reservation.AdvertiserID,
		&reservation.OperationType,
		&reservation.OperationRef,
		&reservation.Status,
		&reservation.Currency,
		&reservation.BaseFeeAtomic,
		&reservation.MaxExternalSpendAtomic,
		&reservation.ReservedAtomic,
		&reservation.ExternalSpendAtomic,
		&reservation.CapturedAtomic,
		&reservation.ReleasedAtomic,
		&reservation.Metadata,
		&reservation.CreatedAt,
		&reservation.UpdatedAt,
		&reservation.FinalizedAt,
	); err != nil {
		return SpendReservation{}, fmt.Errorf("insert spend reservation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return SpendReservation{}, err
	}
	return reservation, nil
}

func (q *Queries) UpdateSpendReservationOperationRef(ctx context.Context, reservationID, operationRef string) error {
	const sql = `
		UPDATE spend_reservations
		SET operation_ref = $1, updated_at = NOW()
		WHERE id = $2`
	_, err := q.Pool.Exec(ctx, sql, operationRef, reservationID)
	return err
}

func (q *Queries) RecordOutboundPaymentEvent(
	ctx context.Context,
	advertiserID string,
	reservationID string,
	provider string,
	requestURL string,
	network *string,
	asset *string,
	amountAtomic int64,
	payer *string,
	transactionHash *string,
	status OutboundPaymentEventStatus,
	responseJSON json.RawMessage,
) (bool, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	const reservationSQL = `
		SELECT id, advertiser_id, operation_type, operation_ref, status, currency,
		       base_fee_atomic, max_external_spend_atomic, reserved_atomic,
		       external_spend_atomic, captured_atomic, released_atomic,
		       metadata, created_at, updated_at, finalized_at
		FROM spend_reservations
		WHERE id = $1
		FOR UPDATE`

	var reservation SpendReservation
	if err := tx.QueryRow(ctx, reservationSQL, reservationID).Scan(
		&reservation.ID,
		&reservation.AdvertiserID,
		&reservation.OperationType,
		&reservation.OperationRef,
		&reservation.Status,
		&reservation.Currency,
		&reservation.BaseFeeAtomic,
		&reservation.MaxExternalSpendAtomic,
		&reservation.ReservedAtomic,
		&reservation.ExternalSpendAtomic,
		&reservation.CapturedAtomic,
		&reservation.ReleasedAtomic,
		&reservation.Metadata,
		&reservation.CreatedAt,
		&reservation.UpdatedAt,
		&reservation.FinalizedAt,
	); err != nil {
		return false, fmt.Errorf("load spend reservation: %w", err)
	}

	if reservation.ExternalSpendAtomic+amountAtomic > reservation.MaxExternalSpendAtomic {
		return false, fmt.Errorf("outbound payment exceeds reserved external budget")
	}

	const insertSQL = `
		INSERT INTO outbound_payment_events (
			id, advertiser_id, reservation_id, provider, request_url, network,
			asset, amount_atomic, payer, transaction_hash, status, response_json
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (transaction_hash) WHERE transaction_hash IS NOT NULL DO NOTHING`
	insertResult, err := tx.Exec(
		ctx,
		insertSQL,
		newID(),
		advertiserID,
		reservationID,
		provider,
		requestURL,
		network,
		asset,
		amountAtomic,
		payer,
		transactionHash,
		status,
		responseJSON,
	)
	if err != nil {
		return false, fmt.Errorf("insert outbound payment event: %w", err)
	}

	if insertResult.RowsAffected() == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, err
		}
		return false, nil
	}

	const updateSQL = `
		UPDATE spend_reservations
		SET external_spend_atomic = external_spend_atomic + $1,
		    status = $2,
		    updated_at = NOW()
	WHERE id = $3`
	if _, err := tx.Exec(ctx, updateSQL, amountAtomic, SpendReservationStatusInProgress, reservationID); err != nil {
		return false, fmt.Errorf("update spend reservation external spend: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (q *Queries) FinalizeSpendReservation(ctx context.Context, reservationID string, captureBaseFee bool, finalStatus SpendReservationStatus) (SpendReservation, error) {
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		return SpendReservation{}, err
	}
	defer tx.Rollback(ctx)

	const reservationSQL = `
		SELECT id, advertiser_id, operation_type, operation_ref, status, currency,
		       base_fee_atomic, max_external_spend_atomic, reserved_atomic,
		       external_spend_atomic, captured_atomic, released_atomic,
		       metadata, created_at, updated_at, finalized_at
		FROM spend_reservations
		WHERE id = $1
		FOR UPDATE`

	var reservation SpendReservation
	if err := tx.QueryRow(ctx, reservationSQL, reservationID).Scan(
		&reservation.ID,
		&reservation.AdvertiserID,
		&reservation.OperationType,
		&reservation.OperationRef,
		&reservation.Status,
		&reservation.Currency,
		&reservation.BaseFeeAtomic,
		&reservation.MaxExternalSpendAtomic,
		&reservation.ReservedAtomic,
		&reservation.ExternalSpendAtomic,
		&reservation.CapturedAtomic,
		&reservation.ReleasedAtomic,
		&reservation.Metadata,
		&reservation.CreatedAt,
		&reservation.UpdatedAt,
		&reservation.FinalizedAt,
	); err != nil {
		return SpendReservation{}, fmt.Errorf("load spend reservation: %w", err)
	}

	if reservation.FinalizedAt != nil {
		if err := tx.Commit(ctx); err != nil {
			return SpendReservation{}, err
		}
		return reservation, nil
	}

	captureAtomic := reservation.ExternalSpendAtomic
	if captureBaseFee {
		captureAtomic += reservation.BaseFeeAtomic
	}
	if captureAtomic > reservation.ReservedAtomic {
		captureAtomic = reservation.ReservedAtomic
	}
	releasedAtomic := reservation.ReservedAtomic - captureAtomic
	now := time.Now()

	const balanceSQL = `
		UPDATE advertiser_balances
		SET total_atomic = total_atomic - $1,
		    reserved_atomic = reserved_atomic - $2,
		    updated_at = NOW()
		WHERE advertiser_id = $3`
	if _, err := tx.Exec(ctx, balanceSQL, captureAtomic, reservation.ReservedAtomic, reservation.AdvertiserID); err != nil {
		return SpendReservation{}, fmt.Errorf("settle advertiser balance: %w", err)
	}

	if captureAtomic > 0 {
		description := fmt.Sprintf("%s charge", reservation.OperationType)
		metadata := reservation.Metadata
		const ledgerSQL = `
			INSERT INTO balance_ledger_entries (
				id, advertiser_id, entry_type, amount_atomic, description, reservation_id, metadata
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`
		if _, err := tx.Exec(
			ctx,
			ledgerSQL,
			newID(),
			reservation.AdvertiserID,
			BalanceLedgerEntryCapture,
			-captureAtomic,
			description,
			reservation.ID,
			metadata,
		); err != nil {
			return SpendReservation{}, fmt.Errorf("insert capture ledger entry: %w", err)
		}
	}

	const updateSQL = `
		UPDATE spend_reservations
		SET status = $1,
		    captured_atomic = $2,
		    released_atomic = $3,
		    updated_at = NOW(),
		    finalized_at = $4
		WHERE id = $5
		RETURNING id, advertiser_id, operation_type, operation_ref, status, currency,
		          base_fee_atomic, max_external_spend_atomic, reserved_atomic,
		          external_spend_atomic, captured_atomic, released_atomic,
		          metadata, created_at, updated_at, finalized_at`
	if err := tx.QueryRow(
		ctx,
		updateSQL,
		finalStatus,
		captureAtomic,
		releasedAtomic,
		now,
		reservation.ID,
	).Scan(
		&reservation.ID,
		&reservation.AdvertiserID,
		&reservation.OperationType,
		&reservation.OperationRef,
		&reservation.Status,
		&reservation.Currency,
		&reservation.BaseFeeAtomic,
		&reservation.MaxExternalSpendAtomic,
		&reservation.ReservedAtomic,
		&reservation.ExternalSpendAtomic,
		&reservation.CapturedAtomic,
		&reservation.ReleasedAtomic,
		&reservation.Metadata,
		&reservation.CreatedAt,
		&reservation.UpdatedAt,
		&reservation.FinalizedAt,
	); err != nil {
		return SpendReservation{}, fmt.Errorf("finalize spend reservation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return SpendReservation{}, err
	}
	return reservation, nil
}
