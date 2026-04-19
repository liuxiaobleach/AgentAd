package onchain

import (
	"context"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strings"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

//go:embed attestation_registry_abi.json
var attestationRegistryABIRaw []byte

var attestationRegistryABI abi.ABI

func init() {
	parsed, err := abi.JSON(strings.NewReader(string(attestationRegistryABIRaw)))
	if err != nil {
		panic(fmt.Errorf("parse AdAttestationRegistry ABI: %w", err))
	}
	attestationRegistryABI = parsed
}

// AttestationIssueParams mirrors the on-chain issueAttestation arguments.
// All hash fields must be 0x-prefixed 32-byte hex (matches what the backend
// already computes and stores in manifests).
type AttestationIssueParams struct {
	AttestationID       string
	CreativeHash        string
	DestinationHash     string
	PlacementDomainHash string
	PolicyVersionHash   string
	ExpiresAt           int64
	ReportCID           string
}

// IssueAttestationOnchain sends issueAttestation(...) to the registry.
// Blocks until the tx is mined and returns the tx hash. The caller's key must
// be an authorized issuer (either owner or added via addIssuer).
func IssueAttestationOnchain(
	ctx context.Context,
	rpcURL string,
	registryAddress string,
	issuerPrivateKeyHex string,
	chainID int64,
	params AttestationIssueParams,
) (string, error) {
	if !common.IsHexAddress(registryAddress) {
		return "", fmt.Errorf("invalid registry address")
	}

	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return "", fmt.Errorf("connect rpc: %w", err)
	}
	defer client.Close()

	trimmedKey := strings.TrimPrefix(strings.TrimSpace(issuerPrivateKeyHex), "0x")
	if trimmedKey == "" {
		return "", errors.New("issuer private key is empty")
	}
	key, err := crypto.HexToECDSA(trimmedKey)
	if err != nil {
		return "", fmt.Errorf("parse issuer private key: %w", err)
	}

	attID, err := bytes32FromHex(params.AttestationID)
	if err != nil {
		return "", fmt.Errorf("attestationId: %w", err)
	}
	crHash, err := bytes32FromHex(params.CreativeHash)
	if err != nil {
		return "", fmt.Errorf("creativeHash: %w", err)
	}
	destHash, err := bytes32FromHex(params.DestinationHash)
	if err != nil {
		return "", fmt.Errorf("destinationHash: %w", err)
	}
	plcHash, err := bytes32FromHex(params.PlacementDomainHash)
	if err != nil {
		return "", fmt.Errorf("placementDomainHash: %w", err)
	}
	polHash, err := bytes32FromHex(params.PolicyVersionHash)
	if err != nil {
		return "", fmt.Errorf("policyVersionHash: %w", err)
	}

	data, err := attestationRegistryABI.Pack(
		"issueAttestation",
		attID, crHash, destHash, plcHash, polHash,
		big.NewInt(params.ExpiresAt),
		params.ReportCID,
	)
	if err != nil {
		return "", fmt.Errorf("abi pack: %w", err)
	}

	auth, err := bind.NewKeyedTransactorWithChainID(key, big.NewInt(chainID))
	if err != nil {
		return "", fmt.Errorf("build transactor: %w", err)
	}
	auth.Context = ctx

	nonce, err := client.PendingNonceAt(ctx, auth.From)
	if err != nil {
		return "", fmt.Errorf("pending nonce: %w", err)
	}
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		return "", fmt.Errorf("suggest gas price: %w", err)
	}

	to := common.HexToAddress(registryAddress)
	gasLimit, err := client.EstimateGas(ctx, ethereum.CallMsg{
		From: auth.From,
		To:   &to,
		Data: data,
	})
	if err != nil {
		// Fall back to a sane default; estimate can fail on RPCs that
		// don't support state override or when the registry rejects the call
		// in simulation (duplicate, etc.).
		gasLimit = 300000
	}

	tx := types.NewTransaction(nonce, to, big.NewInt(0), gasLimit, gasPrice, data)
	signed, err := auth.Signer(auth.From, tx)
	if err != nil {
		return "", fmt.Errorf("sign tx: %w", err)
	}
	if err := client.SendTransaction(ctx, signed); err != nil {
		return "", fmt.Errorf("send tx: %w", err)
	}

	receipt, err := bind.WaitMined(ctx, client, signed)
	if err != nil {
		return "", fmt.Errorf("wait mined: %w", err)
	}
	if receipt.Status != 1 {
		return signed.Hash().Hex(), fmt.Errorf("tx reverted on-chain")
	}
	return signed.Hash().Hex(), nil
}

func bytes32FromHex(s string) ([32]byte, error) {
	var out [32]byte
	trimmed := strings.TrimPrefix(strings.TrimSpace(s), "0x")
	if len(trimmed) != 64 {
		return out, fmt.Errorf("expected 32 bytes hex, got %d chars", len(trimmed))
	}
	raw, err := hex.DecodeString(trimmed)
	if err != nil {
		return out, err
	}
	copy(out[:], raw)
	return out, nil
}
