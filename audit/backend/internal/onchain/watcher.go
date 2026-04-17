package onchain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	ethereum "github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
)

const (
	defaultWatcherPollInterval = 12 * time.Second
	defaultBackfillBlocks      = int64(256)
	defaultChunkSize           = int64(250)
	depositWatcherSyncName     = "sepolia_usdc_treasury_watcher"
)

type SepoliaDepositWatcher struct {
	cfg            *config.Config
	queries        *db.Queries
	token          common.Address
	treasury       common.Address
	rpcURL         string
	pollInterval   time.Duration
	backfillBlocks int64
	chunkSize      int64
}

type aggregatedDeposit struct {
	txHash       string
	blockNumber  int64
	fromAddress  string
	amountAtomic int64
	matchedLogs  int
}

func NewSepoliaDepositWatcher(cfg *config.Config, queries *db.Queries) (*SepoliaDepositWatcher, error) {
	if strings.TrimSpace(cfg.SepoliaRPCURL) == "" {
		return nil, fmt.Errorf("sepolia rpc url is not configured")
	}

	tokenAddress, err := normalizeWatcherHexAddress(cfg.SepoliaUSDCAddress)
	if err != nil {
		return nil, fmt.Errorf("invalid sepolia usdc address: %w", err)
	}
	treasuryAddress, err := normalizeWatcherHexAddress(cfg.SepoliaTreasuryAddress)
	if err != nil {
		return nil, fmt.Errorf("invalid sepolia treasury address: %w", err)
	}

	return &SepoliaDepositWatcher{
		cfg:            cfg,
		queries:        queries,
		token:          common.HexToAddress(tokenAddress),
		treasury:       common.HexToAddress(treasuryAddress),
		rpcURL:         cfg.SepoliaRPCURL,
		pollInterval:   defaultWatcherPollInterval,
		backfillBlocks: defaultBackfillBlocks,
		chunkSize:      defaultChunkSize,
	}, nil
}

func (w *SepoliaDepositWatcher) Start(ctx context.Context) {
	go w.loop(ctx)
}

func (w *SepoliaDepositWatcher) loop(ctx context.Context) {
	if err := w.syncOnce(ctx); err != nil {
		log.Printf("[billing] sepolia deposit watcher initial sync failed: %v", err)
	}

	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := w.syncOnce(ctx); err != nil {
				log.Printf("[billing] sepolia deposit watcher sync failed: %v", err)
			}
		}
	}
}

func (w *SepoliaDepositWatcher) syncOnce(ctx context.Context) error {
	client, err := ethclient.DialContext(ctx, w.rpcURL)
	if err != nil {
		return fmt.Errorf("dial sepolia rpc: %w", err)
	}
	defer client.Close()

	latestBlock, err := client.BlockNumber(ctx)
	if err != nil {
		return fmt.Errorf("load latest sepolia block: %w", err)
	}

	defaultCursor := int64(0)
	if latestBlock > uint64(w.backfillBlocks) {
		defaultCursor = int64(latestBlock) - w.backfillBlocks
	}

	cursor, err := w.queries.EnsureChainSyncCursor(ctx, depositWatcherSyncName, defaultCursor)
	if err != nil {
		return err
	}

	if cursor.LastScannedBlock >= int64(latestBlock) {
		return nil
	}

	fromBlock := cursor.LastScannedBlock + 1
	latestInt := int64(latestBlock)
	for fromBlock <= latestInt {
		toBlock := minInt64(fromBlock+w.chunkSize-1, latestInt)
		if err := w.processBlockRange(ctx, client, fromBlock, toBlock); err != nil {
			return err
		}
		if _, err := w.queries.AdvanceChainSyncCursor(ctx, depositWatcherSyncName, toBlock); err != nil {
			return err
		}
		fromBlock = toBlock + 1
	}

	return nil
}

func (w *SepoliaDepositWatcher) processBlockRange(ctx context.Context, client *ethclient.Client, fromBlock, toBlock int64) error {
	treasuryTopic := common.BytesToHash(common.LeftPadBytes(w.treasury.Bytes(), 32))
	logs, err := client.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: big.NewInt(fromBlock),
		ToBlock:   big.NewInt(toBlock),
		Addresses: []common.Address{w.token},
		Topics: [][]common.Hash{
			{transferEventSignature},
			nil,
			{treasuryTopic},
		},
	})
	if err != nil {
		return fmt.Errorf("filter sepolia transfer logs [%d,%d]: %w", fromBlock, toBlock, err)
	}

	if len(logs) == 0 {
		return nil
	}

	for _, deposit := range aggregateTransferLogs(logs) {
		advertiser, err := w.queries.GetAdvertiserByWalletAddress(ctx, deposit.fromAddress)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			log.Printf("[billing] lookup advertiser by wallet failed wallet=%s tx=%s err=%v", deposit.fromAddress, deposit.txHash, err)
			continue
		}

		metadata, _ := json.Marshal(map[string]interface{}{
			"source":          "sepolia_usdc_watcher",
			"network":         "eip155:11155111",
			"txHash":          deposit.txHash,
			"walletAddress":   deposit.fromAddress,
			"treasuryAddress": w.treasury.Hex(),
			"tokenAddress":    w.token.Hex(),
			"blockNumber":     deposit.blockNumber,
			"matchedLogs":     deposit.matchedLogs,
			"detectedRange": map[string]int64{
				"fromBlock": fromBlock,
				"toBlock":   toBlock,
			},
		})

		_, _, err = w.queries.ClaimOnchainDeposit(
			ctx,
			advertiser.ID,
			deposit.fromAddress,
			w.treasury.Hex(),
			w.token.Hex(),
			"eip155:11155111",
			deposit.txHash,
			deposit.blockNumber,
			deposit.amountAtomic,
			"Automatic Sepolia USDC deposit",
			metadata,
		)
		if err != nil {
			if errors.Is(err, db.ErrOnchainDepositClaimed) {
				continue
			}
			log.Printf("[billing] auto-credit failed advertiser=%s tx=%s err=%v", advertiser.ID, deposit.txHash, err)
			continue
		}

		log.Printf(
			"[billing] auto-credited sepolia deposit advertiser=%s wallet=%s tx=%s amount_atomic=%d",
			advertiser.ID,
			deposit.fromAddress,
			deposit.txHash,
			deposit.amountAtomic,
		)
	}

	return nil
}

func aggregateTransferLogs(logs []types.Log) []aggregatedDeposit {
	type key string
	aggregated := make(map[key]aggregatedDeposit)

	for _, logEntry := range logs {
		if len(logEntry.Topics) != 3 || len(logEntry.Data) != 32 {
			continue
		}
		fromAddress := common.BytesToAddress(logEntry.Topics[1].Bytes()[12:]).Hex()
		amount := new(big.Int).SetBytes(logEntry.Data)
		if !amount.IsInt64() || amount.Sign() <= 0 {
			continue
		}

		mapKey := key(logEntry.TxHash.Hex())
		current := aggregated[mapKey]
		if current.txHash == "" {
			current.txHash = logEntry.TxHash.Hex()
			current.blockNumber = int64(logEntry.BlockNumber)
			current.fromAddress = fromAddress
		}
		current.amountAtomic += amount.Int64()
		current.matchedLogs++
		aggregated[mapKey] = current
	}

	deposits := make([]aggregatedDeposit, 0, len(aggregated))
	for _, deposit := range aggregated {
		if deposit.txHash == "" || deposit.fromAddress == "" || deposit.amountAtomic <= 0 {
			continue
		}
		deposits = append(deposits, deposit)
	}
	return deposits
}

func normalizeWatcherHexAddress(raw string) (string, error) {
	if !common.IsHexAddress(raw) {
		return "", fmt.Errorf("invalid address")
	}
	return common.HexToAddress(raw).Hex(), nil
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
