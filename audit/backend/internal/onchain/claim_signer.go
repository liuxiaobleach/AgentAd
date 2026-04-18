package onchain

import (
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/crypto/sha3"
)

// ClaimReceiptData is the payload signed by the issuer for publisher claims.
// Fields mirror the contract's ClaimReceipt struct.
type ClaimReceiptData struct {
	Publisher common.Address // receiving wallet
	Amount    *big.Int       // atomic USDC (6 decimals)
	ReceiptID [32]byte       // unique nonce per receipt
	Expiry    *big.Int       // unix seconds
}

// ClaimSigner holds the EIP-712 domain + issuer key. One instance per
// (chainId, contractAddress) pair. Safe for concurrent use.
type ClaimSigner struct {
	domainSeparator [32]byte
	issuerKey       *ecdsa.PrivateKey
	issuerAddress   common.Address
	escrowAddress   common.Address
	chainID         *big.Int
}

// claimTypeHash = keccak256("ClaimReceipt(address publisher,uint256 amount,bytes32 receiptId,uint256 expiry)")
var claimTypeHash = crypto.Keccak256Hash(
	[]byte("ClaimReceipt(address publisher,uint256 amount,bytes32 receiptId,uint256 expiry)"),
)

// eip712DomainTypeHash = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
var eip712DomainTypeHash = crypto.Keccak256Hash(
	[]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
)

// NewClaimSigner constructs a signer bound to the given escrow deployment.
// The name/version MUST match BudgetEscrow's EIP712 constructor arguments
// ("AgentAdBudgetEscrow", "1") — any drift and verify() will fail on-chain.
func NewClaimSigner(issuerPrivateKeyHex string, escrowAddress string, chainID int64) (*ClaimSigner, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(issuerPrivateKeyHex), "0x")
	if trimmed == "" {
		return nil, fmt.Errorf("issuer private key is empty")
	}
	key, err := crypto.HexToECDSA(trimmed)
	if err != nil {
		return nil, fmt.Errorf("parse issuer private key: %w", err)
	}
	if !common.IsHexAddress(escrowAddress) {
		return nil, fmt.Errorf("invalid escrow address")
	}
	addr := crypto.PubkeyToAddress(key.PublicKey)

	domainSeparator := buildDomainSeparator("AgentAdBudgetEscrow", "1", chainID, common.HexToAddress(escrowAddress))

	return &ClaimSigner{
		domainSeparator: domainSeparator,
		issuerKey:       key,
		issuerAddress:   addr,
		escrowAddress:   common.HexToAddress(escrowAddress),
		chainID:         big.NewInt(chainID),
	}, nil
}

func (s *ClaimSigner) IssuerAddress() common.Address { return s.issuerAddress }
func (s *ClaimSigner) EscrowAddress() common.Address { return s.escrowAddress }
func (s *ClaimSigner) ChainID() int64                { return s.chainID.Int64() }

// NewReceiptID generates a random 32-byte receipt id. Collisions are
// cryptographically impossible; that's also what the contract relies on for
// replay protection.
func NewReceiptID() ([32]byte, error) {
	var id [32]byte
	if _, err := rand.Read(id[:]); err != nil {
		return id, err
	}
	return id, nil
}

// Sign produces a 65-byte EIP-712 signature over the receipt. The contract
// expects [r || s || v] with v ∈ {27, 28}; go-ethereum's Sign returns v ∈ {0, 1}
// so we normalize.
func (s *ClaimSigner) Sign(data ClaimReceiptData) (string, [32]byte, error) {
	structHash := keccak256EncodePacked(
		claimTypeHash.Bytes(),
		leftPad32(data.Publisher.Bytes()),
		leftPadBigInt(data.Amount),
		data.ReceiptID[:],
		leftPadBigInt(data.Expiry),
	)

	digest := keccak256EncodePacked(
		[]byte{0x19, 0x01},
		s.domainSeparator[:],
		structHash[:],
	)

	sig, err := crypto.Sign(digest[:], s.issuerKey)
	if err != nil {
		return "", digest, err
	}
	// Normalize v for EVM (0/1 -> 27/28).
	sig[64] += 27
	return "0x" + hex.EncodeToString(sig), digest, nil
}

// ParseAddress validates a hex address string and returns the checksummed
// common.Address. Returns an error for malformed input.
func ParseAddress(hexAddr string) (common.Address, error) {
	if !common.IsHexAddress(hexAddr) {
		return common.Address{}, fmt.Errorf("invalid hex address")
	}
	return common.HexToAddress(hexAddr), nil
}

// ReceiptIDHex formats the receipt id as 0x-prefixed bytes32 hex.
func ReceiptIDHex(id [32]byte) string {
	return "0x" + hex.EncodeToString(id[:])
}

// ReceiptIDFromHex parses a 0x-prefixed bytes32 hex.
func ReceiptIDFromHex(hexStr string) ([32]byte, error) {
	var out [32]byte
	trimmed := strings.TrimPrefix(strings.TrimSpace(hexStr), "0x")
	if len(trimmed) != 64 {
		return out, fmt.Errorf("receipt id must be 32 bytes hex")
	}
	raw, err := hex.DecodeString(trimmed)
	if err != nil {
		return out, err
	}
	copy(out[:], raw)
	return out, nil
}

// ---------- internals ----------

func buildDomainSeparator(name, version string, chainID int64, verifyingContract common.Address) [32]byte {
	nameHash := crypto.Keccak256Hash([]byte(name))
	versionHash := crypto.Keccak256Hash([]byte(version))

	cid := new(big.Int).SetInt64(chainID)
	return keccak256EncodePacked(
		eip712DomainTypeHash.Bytes(),
		nameHash.Bytes(),
		versionHash.Bytes(),
		leftPadBigInt(cid),
		leftPad32(verifyingContract.Bytes()),
	)
}

func keccak256EncodePacked(chunks ...[]byte) [32]byte {
	hasher := sha3.NewLegacyKeccak256()
	for _, c := range chunks {
		hasher.Write(c)
	}
	var out [32]byte
	copy(out[:], hasher.Sum(nil))
	return out
}

func leftPad32(b []byte) []byte {
	if len(b) >= 32 {
		return b[len(b)-32:]
	}
	padded := make([]byte, 32)
	copy(padded[32-len(b):], b)
	return padded
}

func leftPadBigInt(v *big.Int) []byte {
	if v == nil {
		return make([]byte, 32)
	}
	bs := v.Bytes()
	return leftPad32(bs)
}
