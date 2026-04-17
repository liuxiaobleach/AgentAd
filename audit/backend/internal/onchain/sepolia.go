package onchain

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

var (
	ErrTransactionPending  = errors.New("transaction not mined yet")
	ErrTransactionFailed   = errors.New("transaction execution failed")
	ErrNoMatchingTransfer  = errors.New("no matching usdc transfer found")
	transferEventSignature = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))
)

type ERC20TransferVerification struct {
	TxHash          string
	BlockNumber     int64
	TokenAddress    string
	FromAddress     string
	TreasuryAddress string
	AmountAtomic    int64
	MatchedLogs     int
}

func VerifyERC20TransferToTreasury(
	ctx context.Context,
	rpcURL string,
	txHash string,
	tokenAddress string,
	fromAddress string,
	treasuryAddress string,
) (ERC20TransferVerification, error) {
	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return ERC20TransferVerification{}, fmt.Errorf("connect rpc: %w", err)
	}
	defer client.Close()

	receipt, err := client.TransactionReceipt(ctx, common.HexToHash(txHash))
	if err != nil {
		if errors.Is(err, ethereum.NotFound) {
			return ERC20TransferVerification{}, ErrTransactionPending
		}
		return ERC20TransferVerification{}, fmt.Errorf("load transaction receipt: %w", err)
	}

	if receipt.Status != 1 {
		return ERC20TransferVerification{}, ErrTransactionFailed
	}

	token := common.HexToAddress(tokenAddress)
	from := common.HexToAddress(fromAddress)
	treasury := common.HexToAddress(treasuryAddress)
	total := big.NewInt(0)
	matchedLogs := 0

	for _, logEntry := range receipt.Logs {
		if logEntry == nil {
			continue
		}
		if logEntry.Address != token || len(logEntry.Topics) != 3 {
			continue
		}
		if logEntry.Topics[0] != transferEventSignature {
			continue
		}
		logFrom := common.BytesToAddress(logEntry.Topics[1].Bytes()[12:])
		logTo := common.BytesToAddress(logEntry.Topics[2].Bytes()[12:])
		if logFrom != from || logTo != treasury {
			continue
		}
		if len(logEntry.Data) != 32 {
			continue
		}

		amount := new(big.Int).SetBytes(logEntry.Data)
		if amount.Sign() <= 0 {
			continue
		}
		total.Add(total, amount)
		matchedLogs++
	}

	if matchedLogs == 0 {
		return ERC20TransferVerification{}, ErrNoMatchingTransfer
	}
	if !total.IsInt64() {
		return ERC20TransferVerification{}, fmt.Errorf("transfer amount exceeds int64 range")
	}

	return ERC20TransferVerification{
		TxHash:          common.HexToHash(txHash).Hex(),
		BlockNumber:     int64(receipt.BlockNumber.Uint64()),
		TokenAddress:    token.Hex(),
		FromAddress:     from.Hex(),
		TreasuryAddress: treasury.Hex(),
		AmountAtomic:    total.Int64(),
		MatchedLogs:     matchedLogs,
	}, nil
}
