package onchain

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Verify the signer produces a signature that can be recovered to the issuer
// address — exact same recovery step the contract performs in claim().
func TestClaimSignerRecoversIssuer(t *testing.T) {
	// test key
	keyHex := "c9e7ab771089791a60db12e319a2bee493f2c3e07f25f0e65e1bb97768da007e"
	escrow := "0x84157B99209580675ebD3F9058ed57dAB93794FD"
	signer, err := NewClaimSigner(keyHex, escrow, 11155111)
	if err != nil {
		t.Fatalf("new signer: %v", err)
	}

	id, err := NewReceiptID()
	if err != nil {
		t.Fatalf("new receipt id: %v", err)
	}
	data := ClaimReceiptData{
		Publisher: common.HexToAddress("0x000000000000000000000000000000000000CAFE"),
		Amount:    big.NewInt(10_000_000),
		ReceiptID: id,
		Expiry:    big.NewInt(4_000_000_000),
	}

	sigHex, digest, err := signer.Sign(data)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if len(sigHex) != 2+65*2 {
		t.Fatalf("unexpected sig length: %d", len(sigHex))
	}

	// Parse the sig and recover to check against issuer address.
	sigBytes := common.FromHex(sigHex)
	if sigBytes[64] < 27 {
		t.Fatalf("v not normalized")
	}
	sigBytes[64] -= 27
	pub, err := crypto.SigToPub(digest[:], sigBytes)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	recovered := crypto.PubkeyToAddress(*pub)
	if recovered != signer.IssuerAddress() {
		t.Fatalf("recovered %s != issuer %s", recovered.Hex(), signer.IssuerAddress().Hex())
	}
}
