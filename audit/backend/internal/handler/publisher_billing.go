package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/onchain"
)

// ---------------------------------------------------------------------------
// Wallet link (mirrors advertiser flow but keyed by publisher id)
// ---------------------------------------------------------------------------

type PublisherBillingWalletResponse struct {
	PublisherID         string  `json:"publisherId"`
	LinkedWalletAddress *string `json:"linkedWalletAddress"`
	Network             string  `json:"network"`
	ChainID             int64   `json:"chainId"`
	ChainName           string  `json:"chainName"`
	RPCURL              string  `json:"rpcUrl"`
	TokenSymbol         string  `json:"tokenSymbol"`
	TokenDecimals       int     `json:"tokenDecimals"`
	TokenAddress        string  `json:"tokenAddress"`
	EscrowAddress       string  `json:"escrowAddress"`
	IssuerAddress       string  `json:"issuerAddress"`
	ExplorerBaseURL     string  `json:"explorerBaseUrl"`
}

func (h *Handler) GetPublisherBillingWallet(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	pub, err := h.Queries.GetPublisherByID(r.Context(), claims.PublisherID)
	if err != nil {
		writeError(w, 500, "Failed to load publisher: "+err.Error())
		return
	}
	resp, err := h.buildPublisherWalletResponse(pub)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, resp)
}

func (h *Handler) GetPublisherWalletLinkChallenge(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	issuedAt := time.Now().UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(walletLinkChallengeTTL)
	writeJSON(w, 200, WalletLinkChallengeResponse{
		Message:   buildPublisherWalletLinkMessage(claims.PublisherID, claims.Email, issuedAt, expiresAt),
		IssuedAt:  issuedAt.Format(time.RFC3339),
		ExpiresAt: expiresAt.Format(time.RFC3339),
	})
}

func (h *Handler) LinkPublisherWallet(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}

	var req LinkBillingWalletRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}

	walletAddress, err := normalizeHexAddress(req.WalletAddress)
	if err != nil {
		writeError(w, 400, "Invalid wallet address")
		return
	}
	issuedAt, expiresAt, err := parseWalletLinkTimes(req.IssuedAt, req.ExpiresAt)
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}

	message := buildPublisherWalletLinkMessage(claims.PublisherID, claims.Email, issuedAt, expiresAt)
	recoveredAddress, err := recoverWalletAddressFromPersonalSign(message, req.Signature)
	if err != nil {
		writeError(w, 400, "Invalid wallet signature")
		return
	}
	if recoveredAddress != walletAddress {
		writeError(w, 400, "Signed wallet does not match the requested wallet address")
		return
	}

	linkedElsewhere, err := h.Queries.IsPublisherWalletLinkedToOther(r.Context(), walletAddress, claims.PublisherID)
	if err != nil {
		writeError(w, 500, "Failed to validate wallet uniqueness: "+err.Error())
		return
	}
	if linkedElsewhere {
		writeError(w, 409, "This wallet is already linked to another publisher account")
		return
	}

	pub, err := h.Queries.UpdatePublisherWallet(r.Context(), claims.PublisherID, walletAddress)
	if err != nil {
		writeError(w, 500, "Failed to link wallet: "+err.Error())
		return
	}
	resp, err := h.buildPublisherWalletResponse(pub)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"ok": true,
		"publisher": map[string]interface{}{
			"id":            pub.ID,
			"name":          pub.Name,
			"email":         pub.ContactEmail,
			"walletAddress": normalizedOptionalWalletAddress(pub.WalletAddress),
		},
		"wallet": resp,
	})
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

func (h *Handler) GetPublisherEarnings(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	earnings, err := h.Queries.GetPublisherEarnings(r.Context(), claims.PublisherID)
	if err != nil {
		writeError(w, 500, "Failed to load earnings: "+err.Error())
		return
	}
	writeJSON(w, 200, earnings)
}

func (h *Handler) ListPublisherEarningEvents(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		// small and clamped — this is a dashboard view
		for i, c := range q {
			if c < '0' || c > '9' {
				q = q[:i]
				break
			}
		}
		if parsed := parsePositiveIntOr(q, 50); parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	events, err := h.Queries.ListPublisherEarningEvents(r.Context(), claims.PublisherID, limit)
	if err != nil {
		writeError(w, 500, "Failed to list earnings: "+err.Error())
		return
	}
	writeJSON(w, 200, events)
}

// ---------------------------------------------------------------------------
// Claim preparation + confirmation
// ---------------------------------------------------------------------------

type PrepareClaimRequest struct {
	AmountAtomic int64 `json:"amountAtomic"`
}

type PrepareClaimResponse struct {
	ReceiptID     string `json:"receiptId"`     // bytes32 hex
	Publisher     string `json:"publisher"`     // wallet (the claim recipient)
	AmountAtomic  int64  `json:"amountAtomic"`  // 6-decimal USDC
	Expiry        int64  `json:"expiry"`        // unix seconds (matches contract field)
	Signature     string `json:"signature"`     // 65-byte hex
	EscrowAddress string `json:"escrowAddress"` // contract target
	ChainID       int64  `json:"chainId"`
	IssuerAddress string `json:"issuerAddress"`
	IssuedAt      string `json:"issuedAt"`
	ExpiresAt     string `json:"expiresAt"`
}

func (h *Handler) PreparePublisherClaim(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	if h.ClaimSigner == nil {
		writeError(w, 503, "Claim signer not configured on backend")
		return
	}

	pub, err := h.Queries.GetPublisherByID(r.Context(), claims.PublisherID)
	if err != nil {
		writeError(w, 500, "Failed to load publisher: "+err.Error())
		return
	}
	if pub.WalletAddress == nil || strings.TrimSpace(*pub.WalletAddress) == "" {
		writeError(w, 400, "Link a wallet before preparing a claim")
		return
	}
	wallet, err := normalizeHexAddress(*pub.WalletAddress)
	if err != nil {
		writeError(w, 400, "Linked wallet address is invalid. Relink before claiming.")
		return
	}

	var req PrepareClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}
	if req.AmountAtomic <= 0 {
		writeError(w, 400, "amountAtomic must be positive")
		return
	}

	// Issue the receipt with a 1-hour TTL. Short enough that reserved
	// balance gets returned quickly if the user doesn't submit on-chain.
	issuedAt := time.Now().UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(1 * time.Hour)

	receiptBytes, err := onchain.NewReceiptID()
	if err != nil {
		writeError(w, 500, "Failed to generate receipt id: "+err.Error())
		return
	}
	receiptHex := onchain.ReceiptIDHex(receiptBytes)

	data := onchain.ClaimReceiptData{
		Publisher: h.ClaimSigner.EscrowAddress(), // placeholder; overwritten below
		Amount:    big.NewInt(req.AmountAtomic),
		ReceiptID: receiptBytes,
		Expiry:    big.NewInt(expiresAt.Unix()),
	}
	// assign the real publisher address via onchain package helper
	publisherAddr, err := onchain.ParseAddress(wallet)
	if err != nil {
		writeError(w, 400, "Invalid publisher wallet: "+err.Error())
		return
	}
	data.Publisher = publisherAddr

	sigHex, _, err := h.ClaimSigner.Sign(data)
	if err != nil {
		writeError(w, 500, "Failed to sign receipt: "+err.Error())
		return
	}

	metadata := mustJSONRaw(map[string]interface{}{
		"issuedAt":  issuedAt.Format(time.RFC3339),
		"expiresAt": expiresAt.Format(time.RFC3339),
	})

	rec := db.ClaimReceipt{
		ID:            receiptHex,
		PublisherID:   pub.ID,
		WalletAddress: wallet,
		AmountAtomic:  req.AmountAtomic,
		ExpiryAt:      expiresAt,
		Signature:     sigHex,
		EscrowAddress: h.ClaimSigner.EscrowAddress().Hex(),
		ChainID:       h.ClaimSigner.ChainID(),
		Metadata:      metadata,
	}
	saved, err := h.Queries.CreateClaimReceipt(r.Context(), rec)
	if err != nil {
		if strings.Contains(err.Error(), "insufficient unclaimed earnings") {
			writeError(w, 400, "Insufficient unclaimed earnings")
			return
		}
		writeError(w, 500, "Failed to persist receipt: "+err.Error())
		return
	}

	writeJSON(w, 200, PrepareClaimResponse{
		ReceiptID:     saved.ID,
		Publisher:     wallet,
		AmountAtomic:  saved.AmountAtomic,
		Expiry:        expiresAt.Unix(),
		Signature:     saved.Signature,
		EscrowAddress: saved.EscrowAddress,
		ChainID:       saved.ChainID,
		IssuerAddress: h.ClaimSigner.IssuerAddress().Hex(),
		IssuedAt:      saved.IssuedAt.Format(time.RFC3339),
		ExpiresAt:     expiresAt.Format(time.RFC3339),
	})
}

type ConfirmClaimRequest struct {
	ReceiptID       string `json:"receiptId"`
	TransactionHash string `json:"transactionHash"`
}

func (h *Handler) ConfirmPublisherClaim(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	if strings.TrimSpace(h.Config.SepoliaRPCURL) == "" {
		writeError(w, 500, "SEPOLIA_RPC_URL is not configured")
		return
	}

	var req ConfirmClaimRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}
	if strings.TrimSpace(req.ReceiptID) == "" {
		writeError(w, 400, "receiptId required")
		return
	}
	txHash, err := normalizeTransactionHash(req.TransactionHash)
	if err != nil {
		writeError(w, 400, "Invalid transaction hash")
		return
	}

	rec, err := h.Queries.GetClaimReceipt(r.Context(), req.ReceiptID)
	if err != nil {
		if errors.Is(err, db.ErrClaimReceiptNotFound) {
			writeError(w, 404, "Receipt not found")
			return
		}
		writeError(w, 500, "Failed to load receipt: "+err.Error())
		return
	}
	if rec.PublisherID != claims.PublisherID {
		writeError(w, 403, "Not your receipt")
		return
	}
	if rec.Status == db.ClaimReceiptStatusClaimed && rec.ClaimTxHash != nil {
		// idempotent return
		writeJSON(w, 200, map[string]interface{}{"ok": true, "receipt": rec})
		return
	}

	// Verify the tx is mined & succeeded.
	ver, err := onchain.VerifyClaimOnchain(
		r.Context(),
		h.Config.SepoliaRPCURL,
		txHash,
		rec.EscrowAddress,
	)
	if err != nil {
		switch {
		case errors.Is(err, onchain.ErrTransactionPending):
			writeJSON(w, 409, map[string]interface{}{
				"error":  "Claim tx not mined yet. Wait for confirmation and retry.",
				"txHash": txHash,
			})
		case errors.Is(err, onchain.ErrTransactionFailed):
			writeError(w, 400, "Claim tx reverted on Sepolia")
		default:
			writeError(w, 500, "Failed to verify claim: "+err.Error())
		}
		return
	}

	updated, err := h.Queries.MarkClaimReceiptClaimed(r.Context(), rec.ID, ver.TxHash, ver.BlockNumber)
	if err != nil {
		writeError(w, 500, "Failed to mark receipt claimed: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"receipt": updated,
	})
}

func (h *Handler) ListPublisherClaims(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil || !claims.IsPublisher() {
		writeError(w, 401, "Not authenticated as publisher")
		return
	}
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if parsed := parsePositiveIntOr(q, 50); parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	out, err := h.Queries.ListPublisherClaimReceipts(r.Context(), claims.PublisherID, limit)
	if err != nil {
		writeError(w, 500, "Failed to list claims: "+err.Error())
		return
	}
	writeJSON(w, 200, out)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func (h *Handler) buildPublisherWalletResponse(pub db.Publisher) (PublisherBillingWalletResponse, error) {
	tokenAddress, err := normalizeHexAddress(h.Config.SepoliaUSDCAddress)
	if err != nil {
		return PublisherBillingWalletResponse{}, fmt.Errorf("SEPOLIA_USDC_ADDRESS is not configured correctly")
	}
	escrowAddress := ""
	issuerAddress := ""
	if h.ClaimSigner != nil {
		escrowAddress = h.ClaimSigner.EscrowAddress().Hex()
		issuerAddress = h.ClaimSigner.IssuerAddress().Hex()
	} else if h.Config.BudgetEscrowAddress != "" {
		if addr, err := normalizeHexAddress(h.Config.BudgetEscrowAddress); err == nil {
			escrowAddress = addr
		}
	}
	var linkedWalletAddress *string
	if pub.WalletAddress != nil {
		if normalized, err := normalizeHexAddress(*pub.WalletAddress); err == nil {
			linkedWalletAddress = &normalized
		}
	}
	return PublisherBillingWalletResponse{
		PublisherID:         pub.ID,
		LinkedWalletAddress: linkedWalletAddress,
		Network:             "eip155:11155111",
		ChainID:             h.Config.SepoliaChainID,
		ChainName:           "Ethereum Sepolia",
		RPCURL:              h.Config.SepoliaRPCURL,
		TokenSymbol:         "USDC",
		TokenDecimals:       6,
		TokenAddress:        tokenAddress,
		EscrowAddress:       escrowAddress,
		IssuerAddress:       issuerAddress,
		ExplorerBaseURL:     h.Config.SepoliaExplorerBaseURL,
	}, nil
}

func buildPublisherWalletLinkMessage(publisherID, email string, issuedAt, expiresAt time.Time) string {
	return fmt.Sprintf(
		"ZKDSP Publisher Wallet Link\n\nAction: Link an Ethereum Sepolia wallet to receive USDC ad earnings\nPublisher ID: %s\nPublisher Email: %s\nIssued At: %s\nExpires At: %s",
		publisherID,
		email,
		issuedAt.Format(time.RFC3339),
		expiresAt.Format(time.RFC3339),
	)
}

func parsePositiveIntOr(s string, fallback int) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return fallback
		}
		n = n*10 + int(c-'0')
		if n > 1_000_000 {
			return fallback
		}
	}
	if n == 0 {
		return fallback
	}
	return n
}
