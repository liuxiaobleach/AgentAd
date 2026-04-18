package db

import (
	"encoding/json"
	"time"
)

type Publisher struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	ContactEmail   string     `json:"contactEmail"`
	PasswordHash   string     `json:"-"`
	WalletAddress  *string    `json:"walletAddress"`
	WalletLinkedAt *time.Time `json:"walletLinkedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type PublisherEarnings struct {
	PublisherID       string    `json:"publisherId"`
	Currency          string    `json:"currency"`
	TotalEarnedAtomic int64     `json:"totalEarnedAtomic"`
	ClaimedAtomic     int64     `json:"claimedAtomic"`
	UnclaimedAtomic   int64     `json:"unclaimedAtomic"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type PublisherEarningEvent struct {
	ID               string          `json:"id"`
	PublisherID      string          `json:"publisherId"`
	EventType        string          `json:"eventType"` // "impression" | "click"
	AuctionRequestID *string         `json:"auctionRequestId"`
	AuctionBidID     *string         `json:"auctionBidId"`
	SlotID           *string         `json:"slotId"`
	AmountAtomic     int64           `json:"amountAtomic"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
}

type ClaimReceiptStatus string

const (
	ClaimReceiptStatusIssued  ClaimReceiptStatus = "issued"
	ClaimReceiptStatusClaimed ClaimReceiptStatus = "claimed"
	ClaimReceiptStatusExpired ClaimReceiptStatus = "expired"
)

type ClaimReceipt struct {
	ID               string             `json:"id"` // receiptId hex 0x...
	PublisherID      string             `json:"publisherId"`
	WalletAddress    string             `json:"walletAddress"`
	AmountAtomic     int64              `json:"amountAtomic"`
	ExpiryAt         time.Time          `json:"expiryAt"`
	Signature        string             `json:"signature"`
	EscrowAddress    string             `json:"escrowAddress"`
	ChainID          int64              `json:"chainId"`
	Status           ClaimReceiptStatus `json:"status"`
	ClaimTxHash      *string            `json:"claimTxHash"`
	ClaimBlockNumber *int64             `json:"claimBlockNumber"`
	IssuedAt         time.Time          `json:"issuedAt"`
	ClaimedAt        *time.Time         `json:"claimedAt"`
	Metadata         json.RawMessage    `json:"metadata,omitempty"`
}
