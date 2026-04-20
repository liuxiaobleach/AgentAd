package host

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math/big"

	"github.com/celer-network/zkdsp-audit/zk-settlement/types"
)

// EncodePublicInputs produces the exact byte sequence the guest commits to
// and the Solidity verifier re-hashes. Any change here forces matching edits
// in guest/src/main.rs::commit_public_inputs AND
// contracts/ZkClaimEscrow.sol::_hashPublicInputs.
//
// Layout (fixed-width, big-endian):
//    8 bytes  epoch_id
//   20 bytes  publisher
//   16 bytes  amount_claim   (u128 big-endian; caller checks it fits)
//   32 bytes  log_root
//   20 bytes  currency
// = 96 bytes
func EncodePublicInputs(p types.PublicInputs) ([]byte, error) {
	amt, ok := new(big.Int).SetString(p.AmountClaim, 10)
	if !ok {
		return nil, fmt.Errorf("amount_claim %q not a decimal integer", p.AmountClaim)
	}
	if amt.Sign() < 0 {
		return nil, fmt.Errorf("amount_claim must be non-negative")
	}
	// u128 max = 2^128 - 1.
	u128Max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 128), big.NewInt(1))
	if amt.Cmp(u128Max) > 0 {
		return nil, fmt.Errorf("amount_claim overflows u128")
	}

	var buf bytes.Buffer
	buf.Grow(96)

	_ = binary.Write(&buf, binary.BigEndian, p.EpochID)
	buf.Write(p.Publisher[:])

	// Left-pad amount to 16 bytes BE.
	ab := amt.Bytes()
	pad := make([]byte, 16-len(ab))
	buf.Write(pad)
	buf.Write(ab)

	buf.Write(p.LogRoot[:])
	buf.Write(p.Currency[:])

	return buf.Bytes(), nil
}
