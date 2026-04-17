package payments

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	x402 "github.com/coinbase/x402/go"
	x402http "github.com/coinbase/x402/go/http"
	evmclient "github.com/coinbase/x402/go/mechanisms/evm/exact/client"
	evmsigners "github.com/coinbase/x402/go/signers/evm"
	"github.com/zkdsp/audit-backend/internal/config"
	"github.com/zkdsp/audit-backend/internal/db"
)

type BuyerFactory struct {
	enabled        bool
	networkPattern string
	rpcURL         string
	privateKey     string
	queries        *db.Queries
}

type Session struct {
	enabled           bool
	advertiserID      string
	reservationID     string
	maxExternalAtomic int64
	queries           *db.Queries
	client            *x402.X402Client

	mu          sync.Mutex
	spentAtomic int64
}

func NewBuyerFactory(cfg *config.Config, queries *db.Queries) *BuyerFactory {
	enabled := cfg.X402Enabled && cfg.X402EVMPrivateKey != ""
	return &BuyerFactory{
		enabled:        enabled,
		networkPattern: cfg.X402Network,
		rpcURL:         cfg.X402RPCURL,
		privateKey:     cfg.X402EVMPrivateKey,
		queries:        queries,
	}
}

func (f *BuyerFactory) NewSession(advertiserID, reservationID string, maxExternalAtomic int64) (*Session, error) {
	session := &Session{
		enabled:           f.enabled,
		advertiserID:      advertiserID,
		reservationID:     reservationID,
		maxExternalAtomic: maxExternalAtomic,
		queries:           f.queries,
	}

	if !f.enabled {
		return session, nil
	}

	signer, err := evmsigners.NewClientSignerFromPrivateKey(f.privateKey)
	if err != nil {
		return nil, fmt.Errorf("create x402 signer: %w", err)
	}

	var schemeConfig *evmclient.ExactEvmSchemeConfig
	if f.rpcURL != "" {
		schemeConfig = &evmclient.ExactEvmSchemeConfig{
			RPCURL: f.rpcURL,
		}
	}

	client := x402.Newx402Client().
		Register(x402.Network(f.networkPattern), evmclient.NewExactEvmScheme(signer, schemeConfig))

	client.OnBeforePaymentCreation(func(ctx x402.PaymentCreationContext) (*x402.BeforePaymentCreationHookResult, error) {
		amountAtomic, err := strconv.ParseInt(ctx.SelectedRequirements.GetAmount(), 10, 64)
		if err != nil {
			return &x402.BeforePaymentCreationHookResult{
				Abort:  true,
				Reason: "invalid x402 amount returned by upstream",
			}, nil
		}

		session.mu.Lock()
		spentAtomic := session.spentAtomic
		session.mu.Unlock()

		if spentAtomic+amountAtomic > session.maxExternalAtomic {
			return &x402.BeforePaymentCreationHookResult{
				Abort:  true,
				Reason: "x402 payment exceeds reserved external budget",
			}, nil
		}
		return nil, nil
	})

	client.OnPaymentCreationFailure(func(ctx x402.PaymentCreationFailureContext) (*x402.PaymentCreationFailureHookResult, error) {
		log.Printf("[x402] payment creation failed reservation=%s network=%s err=%v", session.reservationID, ctx.SelectedRequirements.GetNetwork(), ctx.Error)
		return nil, nil
	})

	session.client = client
	return session, nil
}

func (s *Session) Enabled() bool {
	return s != nil && s.enabled
}

func (s *Session) NewHTTPClient(provider string, timeout time.Duration) *http.Client {
	base := &http.Client{Timeout: timeout}
	if s == nil || !s.enabled || s.client == nil {
		return base
	}

	x402Client := x402http.Newx402HTTPClient(s.client)
	wrapped := x402http.WrapHTTPClientWithPayment(base, x402Client)
	inner := wrapped.Transport
	if inner == nil {
		inner = http.DefaultTransport
	}
	wrapped.Transport = &accountingRoundTripper{
		inner:    inner,
		session:  s,
		provider: provider,
	}
	return wrapped
}

type accountingRoundTripper struct {
	inner    http.RoundTripper
	session  *Session
	provider string
}

func (rt *accountingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	resp, err := rt.inner.RoundTrip(req)
	if err != nil || resp == nil || rt.session == nil {
		return resp, err
	}

	settleResp, ok := decodeSettleResponse(resp.Header)
	if !ok || !settleResp.Success {
		return resp, err
	}

	amountAtomic, parseErr := strconv.ParseInt(settleResp.Amount, 10, 64)
	if parseErr != nil || amountAtomic <= 0 {
		return resp, err
	}

	var network *string
	if settleResp.Network != "" {
		v := string(settleResp.Network)
		network = &v
	}
	var payer *string
	if settleResp.Payer != "" {
		v := settleResp.Payer
		payer = &v
	}
	var txHash *string
	if settleResp.Transaction != "" {
		v := settleResp.Transaction
		txHash = &v
	}

	respJSON, _ := json.Marshal(settleResp)
	if recordErr := rt.session.recordExternalSpend(
		req.Context(),
		rt.provider,
		req.URL.String(),
		network,
		nil,
		amountAtomic,
		payer,
		txHash,
		respJSON,
	); recordErr != nil {
		log.Printf("[x402] record outbound payment failed reservation=%s err=%v", rt.session.reservationID, recordErr)
	}

	return resp, err
}

func (s *Session) recordExternalSpend(
	ctx context.Context,
	provider string,
	requestURL string,
	network *string,
	asset *string,
	amountAtomic int64,
	payer *string,
	transactionHash *string,
	responseJSON json.RawMessage,
) error {
	if s == nil || s.queries == nil {
		return nil
	}

	if provider == "" {
		provider = "x402-upstream"
	}

	recorded, err := s.queries.RecordOutboundPaymentEvent(
		ctx,
		s.advertiserID,
		s.reservationID,
		provider,
		requestURL,
		network,
		asset,
		amountAtomic,
		payer,
		transactionHash,
		db.OutboundPaymentEventStatusSettled,
		responseJSON,
	)
	if err != nil {
		return err
	}
	if !recorded {
		return nil
	}

	s.mu.Lock()
	s.spentAtomic += amountAtomic
	s.mu.Unlock()
	return nil
}

func decodeSettleResponse(headers http.Header) (*x402.SettleResponse, bool) {
	headerValue := headers.Get("PAYMENT-RESPONSE")
	if headerValue == "" {
		headerValue = headers.Get("X-PAYMENT-RESPONSE")
	}
	if headerValue == "" {
		return nil, false
	}

	decoded, err := base64.StdEncoding.DecodeString(headerValue)
	if err != nil {
		return nil, false
	}

	var settleResp x402.SettleResponse
	if err := json.Unmarshal(decoded, &settleResp); err != nil {
		return nil, false
	}
	return &settleResp, true
}
