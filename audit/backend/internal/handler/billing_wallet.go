package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/zkdsp/audit-backend/internal/db"
	"github.com/zkdsp/audit-backend/internal/onchain"
)

const walletLinkChallengeTTL = 10 * time.Minute

type BillingWalletResponse struct {
	AdvertiserID        string  `json:"advertiserId"`
	LinkedWalletAddress *string `json:"linkedWalletAddress"`
	Network             string  `json:"network"`
	ChainID             int64   `json:"chainId"`
	ChainName           string  `json:"chainName"`
	RPCURL              string  `json:"rpcUrl"`
	TokenSymbol         string  `json:"tokenSymbol"`
	TokenDecimals       int     `json:"tokenDecimals"`
	TokenAddress        string  `json:"tokenAddress"`
	TreasuryAddress     string  `json:"treasuryAddress"`
	ExplorerBaseURL     string  `json:"explorerBaseUrl"`
}

type WalletLinkChallengeResponse struct {
	Message   string `json:"message"`
	IssuedAt  string `json:"issuedAt"`
	ExpiresAt string `json:"expiresAt"`
}

type LinkBillingWalletRequest struct {
	WalletAddress string `json:"walletAddress"`
	IssuedAt      string `json:"issuedAt"`
	ExpiresAt     string `json:"expiresAt"`
	Signature     string `json:"signature"`
}

type ClaimDepositRequest struct {
	TransactionHash string `json:"transactionHash"`
}

func (h *Handler) GetBillingWallet(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	advertiser, err := h.Queries.GetAdvertiserByID(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to load billing wallet: "+err.Error())
		return
	}

	resp, err := h.buildBillingWalletResponse(advertiser)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	writeJSON(w, 200, resp)
}

func (h *Handler) GetBillingWalletLinkChallenge(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	issuedAt := time.Now().UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(walletLinkChallengeTTL)
	writeJSON(w, 200, WalletLinkChallengeResponse{
		Message:   buildWalletLinkMessage(claims.AdvertiserID, claims.Email, issuedAt, expiresAt),
		IssuedAt:  issuedAt.Format(time.RFC3339),
		ExpiresAt: expiresAt.Format(time.RFC3339),
	})
}

func (h *Handler) LinkBillingWallet(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
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

	message := buildWalletLinkMessage(claims.AdvertiserID, claims.Email, issuedAt, expiresAt)
	recoveredAddress, err := recoverWalletAddressFromPersonalSign(message, req.Signature)
	if err != nil {
		writeError(w, 400, "Invalid wallet signature")
		return
	}
	if recoveredAddress != walletAddress {
		writeError(w, 400, "Signed wallet does not match the requested wallet address")
		return
	}
	linkedElsewhere, err := h.Queries.IsWalletAddressLinkedToOtherAdvertiser(r.Context(), walletAddress, claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to validate wallet uniqueness: "+err.Error())
		return
	}
	if linkedElsewhere {
		writeError(w, 409, "This wallet is already linked to another advertiser account")
		return
	}

	advertiser, err := h.Queries.UpdateAdvertiserWalletAddress(r.Context(), claims.AdvertiserID, walletAddress)
	if err != nil {
		writeError(w, 500, "Failed to link wallet: "+err.Error())
		return
	}

	resp, err := h.buildBillingWalletResponse(advertiser)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"ok": true,
		"advertiser": map[string]interface{}{
			"id":            advertiser.ID,
			"name":          advertiser.Name,
			"email":         advertiser.ContactEmail,
			"walletAddress": advertiser.WalletAddress,
		},
		"wallet": resp,
	})
}

func (h *Handler) ClaimBillingDeposit(w http.ResponseWriter, r *http.Request) {
	claims := GetClaims(r.Context())
	if claims == nil {
		writeError(w, 401, "Not authenticated")
		return
	}

	advertiser, err := h.Queries.GetAdvertiserByID(r.Context(), claims.AdvertiserID)
	if err != nil {
		writeError(w, 500, "Failed to load advertiser: "+err.Error())
		return
	}
	if advertiser.WalletAddress == nil || strings.TrimSpace(*advertiser.WalletAddress) == "" {
		writeError(w, 400, "Link a wallet before claiming Sepolia USDC deposits")
		return
	}

	var req ClaimDepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "Invalid JSON: "+err.Error())
		return
	}

	txHash, err := normalizeTransactionHash(req.TransactionHash)
	if err != nil {
		writeError(w, 400, "Invalid transaction hash")
		return
	}

	treasuryAddress, err := normalizeHexAddress(h.Config.SepoliaTreasuryAddress)
	if err != nil {
		writeError(w, 500, "SEPOLIA_TREASURY_ADDRESS is not configured correctly")
		return
	}
	tokenAddress, err := normalizeHexAddress(h.Config.SepoliaUSDCAddress)
	if err != nil {
		writeError(w, 500, "SEPOLIA_USDC_ADDRESS is not configured correctly")
		return
	}
	linkedWallet, err := normalizeHexAddress(*advertiser.WalletAddress)
	if err != nil {
		writeError(w, 400, "The currently linked wallet address is invalid. Relink your MetaMask wallet before claiming deposits.")
		return
	}
	if strings.TrimSpace(h.Config.SepoliaRPCURL) == "" {
		writeError(w, 500, "SEPOLIA_RPC_URL is not configured")
		return
	}

	verification, err := onchain.VerifyERC20TransferToTreasury(
		r.Context(),
		h.Config.SepoliaRPCURL,
		txHash,
		tokenAddress,
		linkedWallet,
		treasuryAddress,
	)
	if err != nil {
		switch {
		case errors.Is(err, onchain.ErrTransactionPending):
			writeJSON(w, 409, map[string]interface{}{
				"error":  "The transaction has not been mined yet. Wait for confirmation, then claim it again.",
				"txHash": txHash,
			})
		case errors.Is(err, onchain.ErrTransactionFailed):
			writeError(w, 400, "That transaction reverted on Sepolia and cannot be credited")
		case errors.Is(err, onchain.ErrNoMatchingTransfer):
			writeError(w, 400, "No matching Sepolia USDC transfer from your linked wallet to the treasury was found in that transaction")
		default:
			writeError(w, 500, "Failed to verify deposit: "+err.Error())
		}
		return
	}

	metadata := mustJSONRaw(map[string]interface{}{
		"source":          "sepolia_usdc_deposit",
		"network":         "eip155:11155111",
		"txHash":          verification.TxHash,
		"walletAddress":   verification.FromAddress,
		"treasuryAddress": verification.TreasuryAddress,
		"tokenAddress":    verification.TokenAddress,
		"blockNumber":     verification.BlockNumber,
		"matchedLogs":     verification.MatchedLogs,
	})

	balance, deposit, err := h.Queries.ClaimOnchainDeposit(
		r.Context(),
		claims.AdvertiserID,
		verification.FromAddress,
		verification.TreasuryAddress,
		verification.TokenAddress,
		"eip155:11155111",
		verification.TxHash,
		verification.BlockNumber,
		verification.AmountAtomic,
		"Sepolia USDC deposit",
		metadata,
	)
	if err != nil {
		if errors.Is(err, db.ErrOnchainDepositClaimed) {
			writeJSON(w, 409, map[string]interface{}{
				"error":  "This Sepolia deposit has already been credited.",
				"txHash": verification.TxHash,
			})
			return
		}
		writeError(w, 500, "Failed to credit deposit: "+err.Error())
		return
	}

	writeJSON(w, 200, map[string]interface{}{
		"ok":      true,
		"balance": balance,
		"deposit": deposit,
	})
}

func (h *Handler) buildBillingWalletResponse(advertiser db.Advertiser) (BillingWalletResponse, error) {
	tokenAddress, err := normalizeHexAddress(h.Config.SepoliaUSDCAddress)
	if err != nil {
		return BillingWalletResponse{}, fmt.Errorf("SEPOLIA_USDC_ADDRESS is not configured correctly")
	}
	treasuryAddress, err := normalizeHexAddress(h.Config.SepoliaTreasuryAddress)
	if err != nil {
		return BillingWalletResponse{}, fmt.Errorf("SEPOLIA_TREASURY_ADDRESS is not configured correctly")
	}

	var linkedWalletAddress *string
	if advertiser.WalletAddress != nil {
		if normalizedWallet, err := normalizeHexAddress(*advertiser.WalletAddress); err == nil {
			linkedWalletAddress = &normalizedWallet
		}
	}

	return BillingWalletResponse{
		AdvertiserID:        advertiser.ID,
		LinkedWalletAddress: linkedWalletAddress,
		Network:             "eip155:11155111",
		ChainID:             h.Config.SepoliaChainID,
		ChainName:           "Ethereum Sepolia",
		RPCURL:              h.Config.SepoliaRPCURL,
		TokenSymbol:         "USDC",
		TokenDecimals:       6,
		TokenAddress:        tokenAddress,
		TreasuryAddress:     treasuryAddress,
		ExplorerBaseURL:     h.Config.SepoliaExplorerBaseURL,
	}, nil
}

func buildWalletLinkMessage(advertiserID, email string, issuedAt, expiresAt time.Time) string {
	return fmt.Sprintf(
		"ZKDSP Billing Wallet Link\n\nAction: Link an Ethereum Sepolia wallet for USDC top-ups\nAdvertiser ID: %s\nAdvertiser Email: %s\nIssued At: %s\nExpires At: %s",
		advertiserID,
		email,
		issuedAt.Format(time.RFC3339),
		expiresAt.Format(time.RFC3339),
	)
}

func parseWalletLinkTimes(rawIssuedAt, rawExpiresAt string) (time.Time, time.Time, error) {
	issuedAt, err := time.Parse(time.RFC3339, rawIssuedAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("Invalid issuedAt timestamp")
	}
	expiresAt, err := time.Parse(time.RFC3339, rawExpiresAt)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("Invalid expiresAt timestamp")
	}

	now := time.Now().UTC()
	if expiresAt.Before(now) {
		return time.Time{}, time.Time{}, errors.New("Wallet link challenge expired. Request a fresh challenge and sign again.")
	}
	if issuedAt.After(now.Add(1 * time.Minute)) {
		return time.Time{}, time.Time{}, errors.New("Wallet link challenge is not valid yet")
	}
	if expiresAt.Sub(issuedAt) > walletLinkChallengeTTL || expiresAt.Sub(issuedAt) <= 0 {
		return time.Time{}, time.Time{}, errors.New("Invalid wallet link challenge window")
	}
	return issuedAt.UTC(), expiresAt.UTC(), nil
}

func recoverWalletAddressFromPersonalSign(message, signature string) (string, error) {
	sigBytes, err := hexutil.Decode(signature)
	if err != nil {
		return "", err
	}
	if len(sigBytes) != 65 {
		return "", fmt.Errorf("unexpected signature length")
	}

	if sigBytes[64] >= 27 {
		sigBytes[64] -= 27
	}
	if sigBytes[64] > 1 {
		return "", fmt.Errorf("invalid signature recovery id")
	}

	hash := accounts.TextHash([]byte(message))
	pubKey, err := crypto.SigToPub(hash, sigBytes)
	if err != nil {
		return "", err
	}
	return crypto.PubkeyToAddress(*pubKey).Hex(), nil
}

func normalizeHexAddress(raw string) (string, error) {
	if !common.IsHexAddress(raw) {
		return "", fmt.Errorf("invalid hex address")
	}
	return common.HexToAddress(raw).Hex(), nil
}

func normalizeTransactionHash(raw string) (string, error) {
	decoded, err := hexutil.Decode(raw)
	if err != nil {
		return "", err
	}
	if len(decoded) != 32 {
		return "", fmt.Errorf("unexpected transaction hash length")
	}
	return common.BytesToHash(decoded).Hex(), nil
}
