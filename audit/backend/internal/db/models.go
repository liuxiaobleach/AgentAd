package db

import (
	"encoding/json"
	"time"
)

type CreativeStatus string

const (
	CreativeStatusDraft        CreativeStatus = "DRAFT"
	CreativeStatusPendingAudit CreativeStatus = "PENDING_AUDIT"
	CreativeStatusAuditing     CreativeStatus = "AUDITING"
	CreativeStatusApproved     CreativeStatus = "APPROVED"
	CreativeStatusRejected     CreativeStatus = "REJECTED"
)

type AuditStatus string

const (
	AuditStatusPending      AuditStatus = "PENDING"
	AuditStatusTriaging     AuditStatus = "TRIAGING"
	AuditStatusToolsRunning AuditStatus = "TOOLS_RUNNING"
	AuditStatusEvaluating   AuditStatus = "EVALUATING"
	AuditStatusManualReview AuditStatus = "MANUAL_REVIEW"
	AuditStatusCompleted    AuditStatus = "COMPLETED"
)

type AuditDecision string

const (
	AuditDecisionPass         AuditDecision = "PASS"
	AuditDecisionReject       AuditDecision = "REJECT"
	AuditDecisionManualReview AuditDecision = "MANUAL_REVIEW"
)

type AttestationStatus string

const (
	AttestationStatusPending AttestationStatus = "PENDING"
	AttestationStatusActive  AttestationStatus = "ACTIVE"
	AttestationStatusRevoked AttestationStatus = "REVOKED"
	AttestationStatusExpired AttestationStatus = "EXPIRED"
)

type Advertiser struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	WalletAddress *string   `json:"walletAddress"`
	ContactEmail  string    `json:"contactEmail"`
	PasswordHash  *string   `json:"-"`
	CreatedAt     time.Time `json:"createdAt"`
}

type BalanceLedgerEntryType string

const (
	BalanceLedgerEntryTopUp      BalanceLedgerEntryType = "TOPUP"
	BalanceLedgerEntryCapture    BalanceLedgerEntryType = "CAPTURE"
	BalanceLedgerEntryAdjustment BalanceLedgerEntryType = "ADJUSTMENT"
)

type SpendReservationStatus string

const (
	SpendReservationStatusAuthorized SpendReservationStatus = "AUTHORIZED"
	SpendReservationStatusInProgress SpendReservationStatus = "IN_PROGRESS"
	SpendReservationStatusSettled    SpendReservationStatus = "SETTLED"
	SpendReservationStatusReleased   SpendReservationStatus = "RELEASED"
	SpendReservationStatusFailed     SpendReservationStatus = "FAILED"
)

type OutboundPaymentEventStatus string

const (
	OutboundPaymentEventStatusSettled OutboundPaymentEventStatus = "SETTLED"
)

type AdvertiserBalance struct {
	AdvertiserID   string    `json:"advertiserId"`
	Currency       string    `json:"currency"`
	TotalAtomic    int64     `json:"totalAtomic"`
	ReservedAtomic int64     `json:"reservedAtomic"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type BalanceSummary struct {
	AdvertiserID    string    `json:"advertiserId"`
	Currency        string    `json:"currency"`
	TotalAtomic     int64     `json:"totalAtomic"`
	ReservedAtomic  int64     `json:"reservedAtomic"`
	SpendableAtomic int64     `json:"spendableAtomic"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type BalanceLedgerEntry struct {
	ID            string                 `json:"id"`
	AdvertiserID  string                 `json:"advertiserId"`
	EntryType     BalanceLedgerEntryType `json:"entryType"`
	AmountAtomic  int64                  `json:"amountAtomic"`
	Description   string                 `json:"description"`
	ReservationID *string                `json:"reservationId"`
	Metadata      json.RawMessage        `json:"metadata"`
	CreatedAt     time.Time              `json:"createdAt"`
}

type SpendReservation struct {
	ID                     string                 `json:"id"`
	AdvertiserID           string                 `json:"advertiserId"`
	OperationType          string                 `json:"operationType"`
	OperationRef           *string                `json:"operationRef"`
	Status                 SpendReservationStatus `json:"status"`
	Currency               string                 `json:"currency"`
	BaseFeeAtomic          int64                  `json:"baseFeeAtomic"`
	MaxExternalSpendAtomic int64                  `json:"maxExternalSpendAtomic"`
	ReservedAtomic         int64                  `json:"reservedAtomic"`
	ExternalSpendAtomic    int64                  `json:"externalSpendAtomic"`
	CapturedAtomic         int64                  `json:"capturedAtomic"`
	ReleasedAtomic         int64                  `json:"releasedAtomic"`
	Metadata               json.RawMessage        `json:"metadata"`
	CreatedAt              time.Time              `json:"createdAt"`
	UpdatedAt              time.Time              `json:"updatedAt"`
	FinalizedAt            *time.Time             `json:"finalizedAt"`
}

type OutboundPaymentEvent struct {
	ID              string                     `json:"id"`
	AdvertiserID    string                     `json:"advertiserId"`
	ReservationID   string                     `json:"reservationId"`
	Provider        string                     `json:"provider"`
	RequestURL      string                     `json:"requestUrl"`
	Network         *string                    `json:"network"`
	Asset           *string                    `json:"asset"`
	AmountAtomic    int64                      `json:"amountAtomic"`
	Payer           *string                    `json:"payer"`
	TransactionHash *string                    `json:"transactionHash"`
	Status          OutboundPaymentEventStatus `json:"status"`
	ResponseJSON    json.RawMessage            `json:"responseJson"`
	CreatedAt       time.Time                  `json:"createdAt"`
}

type OnchainDeposit struct {
	ID              string          `json:"id"`
	AdvertiserID    string          `json:"advertiserId"`
	WalletAddress   string          `json:"walletAddress"`
	TreasuryAddress string          `json:"treasuryAddress"`
	TokenAddress    string          `json:"tokenAddress"`
	Network         string          `json:"network"`
	TxHash          string          `json:"txHash"`
	BlockNumber     int64           `json:"blockNumber"`
	AmountAtomic    int64           `json:"amountAtomic"`
	Metadata        json.RawMessage `json:"metadata"`
	CreatedAt       time.Time       `json:"createdAt"`
	CreditedAt      time.Time       `json:"creditedAt"`
}

type ChainSyncCursor struct {
	SyncName         string    `json:"syncName"`
	LastScannedBlock int64     `json:"lastScannedBlock"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// DSP new types

type BidderAgentStatus string

const (
	BidderAgentActive   BidderAgentStatus = "ACTIVE"
	BidderAgentPaused   BidderAgentStatus = "PAUSED"
	BidderAgentDisabled BidderAgentStatus = "DISABLED"
)

type CreativeProfile struct {
	ID                 string          `json:"id"`
	CreativeID         string          `json:"creativeId"`
	AuditCaseID        *string         `json:"auditCaseId"`
	AnalysisVersion    int             `json:"analysisVersion"`
	MarketingSummary   *string         `json:"marketingSummary"`
	VisualTags         []string        `json:"visualTags"`
	CtaType            *string         `json:"ctaType"`
	CopyStyle          *string         `json:"copyStyle"`
	TargetAudiences    []string        `json:"targetAudiences"`
	PlacementFit       json.RawMessage `json:"placementFit"`
	PredictedCtrPriors json.RawMessage `json:"predictedCtrPriors"`
	BidHints           json.RawMessage `json:"bidHints"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

type BidderAgent struct {
	ID                 string            `json:"id"`
	AdvertiserID       string            `json:"advertiserId"`
	Name               string            `json:"name"`
	Strategy           string            `json:"strategy"`
	StrategyPrompt     *string           `json:"strategyPrompt"`
	ValuePerClick      float64           `json:"valuePerClick"`
	MaxBidCpm          float64           `json:"maxBidCpm"`
	DailyBudgetAtomic  int64             `json:"dailyBudgetAtomic"`
	HourlyBudgetAtomic int64             `json:"hourlyBudgetAtomic"`
	Status             BidderAgentStatus `json:"status"`
	CreatedAt          time.Time         `json:"createdAt"`
	UpdatedAt          time.Time         `json:"updatedAt"`
}

type AuctionRequest struct {
	ID           string          `json:"id"`
	SlotID       string          `json:"slotId"`
	SlotType     string          `json:"slotType"`
	Size         string          `json:"size"`
	FloorCpm     float64         `json:"floorCpm"`
	SiteCategory *string         `json:"siteCategory"`
	UserSegments []string        `json:"userSegments"`
	Context      json.RawMessage `json:"context"`
	CreatedAt    time.Time       `json:"createdAt"`

	// Joined
	Bids   []AuctionBid   `json:"bids,omitempty"`
	Result *AuctionResult `json:"result,omitempty"`
}

type AuctionBid struct {
	ID                 string    `json:"id"`
	AuctionRequestID   string    `json:"auctionRequestId"`
	BidderAgentID      string    `json:"bidderAgentId"`
	SelectedCreativeID *string   `json:"selectedCreativeId"`
	PredictedCtr       *float64  `json:"predictedCtr"`
	BidCpm             *float64  `json:"bidCpm"`
	Confidence         *float64  `json:"confidence"`
	Reason             *string   `json:"reason"`
	CreatedAt          time.Time `json:"createdAt"`

	// Joined
	AgentName    string `json:"agentName,omitempty"`
	CreativeName string `json:"creativeName,omitempty"`
}

type AuctionResult struct {
	ID               string    `json:"id"`
	AuctionRequestID string    `json:"auctionRequestId"`
	WinnerBidID      *string   `json:"winnerBidId"`
	SettlementPrice  *float64  `json:"settlementPrice"`
	ShownCreativeID  *string   `json:"shownCreativeId"`
	Clicked          bool      `json:"clicked"`
	CreatedAt        time.Time `json:"createdAt"`
}

type Creative struct {
	ID               string         `json:"id"`
	AdvertiserID     string         `json:"advertiserId"`
	CreativeName     string         `json:"creativeName"`
	ProjectName      string         `json:"projectName"`
	ImageURL         *string        `json:"imageUrl"`
	CreativeHash     *string        `json:"creativeHash"`
	LandingURL       string         `json:"landingUrl"`
	TelegramURL      *string        `json:"telegramUrl"`
	ClickURL         *string        `json:"clickUrl"`
	ChainID          *int           `json:"chainId"`
	ContractAddress  *string        `json:"contractAddress"`
	PlacementDomains []string       `json:"placementDomains"`
	Notes            *string        `json:"notes"`
	Status           CreativeStatus `json:"status"`
	CreatedAt        time.Time      `json:"createdAt"`
	UpdatedAt        time.Time      `json:"updatedAt"`

	// Joined fields (not always populated)
	AuditCases []AuditCase `json:"auditCases,omitempty"`
	Manifests  []Manifest  `json:"manifests,omitempty"`
}

type AuditCase struct {
	ID            string          `json:"id"`
	CreativeID    string          `json:"creativeId"`
	Status        AuditStatus     `json:"status"`
	RiskScore     *float64        `json:"riskScore"`
	Decision      *AuditDecision  `json:"decision"`
	PolicyVersion string          `json:"policyVersion"`
	Summary       *string         `json:"summary"`
	AgentThinking json.RawMessage `json:"agentThinking"`
	SubmittedAt   time.Time       `json:"submittedAt"`
	CompletedAt   *time.Time      `json:"completedAt"`

	// Ops review fields — set when a human reviewer has acted on the case.
	ReviewerID   *string    `json:"reviewerId,omitempty"`
	ReviewerName string     `json:"reviewerName,omitempty"`
	ReviewNotes  *string    `json:"reviewNotes,omitempty"`
	ReviewedAt   *time.Time `json:"reviewedAt,omitempty"`

	// Advertiser info (populated for ops-facing listings only; advertisers
	// reading their own cases don't need it).
	AdvertiserID    string `json:"advertiserId,omitempty"`
	AdvertiserName  string `json:"advertiserName,omitempty"`
	AdvertiserEmail string `json:"advertiserEmail,omitempty"`

	// Joined
	Creative    *CreativeSummary `json:"creative,omitempty"`
	Evidences   []AuditEvidence  `json:"evidences,omitempty"`
	Attestation *Attestation     `json:"attestation,omitempty"`
}

type CreativeSummary struct {
	ID           string  `json:"id"`
	CreativeName string  `json:"creativeName"`
	ProjectName  string  `json:"projectName"`
	ImageURL     *string `json:"imageUrl"`
}

type AuditEvidence struct {
	ID          string          `json:"id"`
	AuditCaseID string          `json:"auditCaseId"`
	ToolName    string          `json:"toolName"`
	Payload     json.RawMessage `json:"payload"`
	RiskSignals json.RawMessage `json:"riskSignals"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type Attestation struct {
	ID            string            `json:"id"`
	AuditCaseID   string            `json:"auditCaseId"`
	AttestationID string            `json:"attestationId"`
	ChainID       int               `json:"chainId"`
	TxHash        *string           `json:"txHash"`
	Status        AttestationStatus `json:"status"`
	ReportCID     *string           `json:"reportCID"`
	IssuedAt      *time.Time        `json:"issuedAt"`
	ExpiresAt     *time.Time        `json:"expiresAt"`
	CreatedAt     time.Time         `json:"createdAt"`

	// Joined
	AuditCase *AuditCaseWithCreative `json:"auditCase,omitempty"`
}

type AuditCaseWithCreative struct {
	Creative *CreativeSummary `json:"creative,omitempty"`
}

type Manifest struct {
	ID            string          `json:"id"`
	CreativeID    string          `json:"creativeId"`
	AttestationID string          `json:"attestationId"`
	ManifestJSON  json.RawMessage `json:"manifestJson"`
	Version       int             `json:"version"`
	CreatedAt     time.Time       `json:"createdAt"`
}

// BidderStrategyTemplate is an advertiser-owned, reusable bidding strategy
// that can be applied to a bidder agent. Its `prompt` mirrors the free-text
// `strategy_prompt` column on `bidder_agents`.
type BidderStrategyTemplate struct {
	ID            string    `json:"id"`
	AdvertiserID  string    `json:"advertiserId"`
	Name          string    `json:"name"`
	Icon          string    `json:"icon"`
	Description   string    `json:"description"`
	Prompt        string    `json:"prompt"`
	ValuePerClick *float64  `json:"valuePerClick,omitempty"`
	MaxBidCpm     *float64  `json:"maxBidCpm,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// BidderAgentSkill is an advertiser-owned, reusable capability snippet
// that the advertiser may append to an agent's strategy prompt.
type BidderAgentSkill struct {
	ID            string    `json:"id"`
	AdvertiserID  string    `json:"advertiserId"`
	Name          string    `json:"name"`
	Icon          string    `json:"icon"`
	Description   string    `json:"description"`
	PromptSnippet string    `json:"promptSnippet"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type BrandKit struct {
	ID             string    `json:"id"`
	AdvertiserID   string    `json:"advertiserId"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	VoiceTone      string    `json:"voiceTone"`
	PrimaryMessage string    `json:"primaryMessage"`
	ColorPalette   []string  `json:"colorPalette"`
	MandatoryTerms []string  `json:"mandatoryTerms"`
	BannedTerms    []string  `json:"bannedTerms"`
	VisualRules    string    `json:"visualRules"`
	CtaPreferences string    `json:"ctaPreferences"`
	IsDefault      bool      `json:"isDefault"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CreativeStudioRunStatus string

const (
	CreativeStudioRunStatusQueued    CreativeStudioRunStatus = "QUEUED"
	CreativeStudioRunStatusRunning   CreativeStudioRunStatus = "RUNNING"
	CreativeStudioRunStatusCompleted CreativeStudioRunStatus = "COMPLETED"
	CreativeStudioRunStatusPartial   CreativeStudioRunStatus = "PARTIAL"
	CreativeStudioRunStatusFailed    CreativeStudioRunStatus = "FAILED"
)

type CreativeStudioItemStatus string

const (
	CreativeStudioItemStatusQueued    CreativeStudioItemStatus = "QUEUED"
	CreativeStudioItemStatusRunning   CreativeStudioItemStatus = "RUNNING"
	CreativeStudioItemStatusCompleted CreativeStudioItemStatus = "COMPLETED"
	CreativeStudioItemStatusFailed    CreativeStudioItemStatus = "FAILED"
)

type CreativeStudioRun struct {
	ID              string                  `json:"id"`
	AdvertiserID    string                  `json:"advertiserId"`
	BrandKitID      *string                 `json:"brandKitId,omitempty"`
	Title           string                  `json:"title"`
	Brief           string                  `json:"brief"`
	BaseCreativeName string                 `json:"baseCreativeName"`
	ProjectName     string                  `json:"projectName"`
	LandingURL      string                  `json:"landingUrl"`
	TargetAudiences []string                `json:"targetAudiences"`
	StyleHint       string                  `json:"styleHint"`
	AspectRatio     string                  `json:"aspectRatio"`
	VariantCount    int                     `json:"variantCount"`
	AutoSubmitAudit bool                    `json:"autoSubmitAudit"`
	Status          CreativeStudioRunStatus `json:"status"`
	CreatedAt       time.Time               `json:"createdAt"`
	UpdatedAt       time.Time               `json:"updatedAt"`
	CompletedAt     *time.Time              `json:"completedAt,omitempty"`
}

type CreativeStudioRunItem struct {
	ID             string                   `json:"id"`
	RunID          string                   `json:"runId"`
	CreativeID     string                   `json:"creativeId"`
	VariantIndex   int                      `json:"variantIndex"`
	VariantLabel   string                   `json:"variantLabel"`
	VariantAngle   string                   `json:"variantAngle"`
	Phase          string                   `json:"phase"`
	Status         CreativeStudioItemStatus `json:"status"`
	Error          *string                  `json:"error,omitempty"`
	CreatedAt      time.Time                `json:"createdAt"`
	UpdatedAt      time.Time                `json:"updatedAt"`
	CompletedAt    *time.Time               `json:"completedAt,omitempty"`

	CreativeName   string         `json:"creativeName,omitempty"`
	ImageURL       *string        `json:"imageUrl,omitempty"`
	CreativeStatus CreativeStatus `json:"creativeStatus,omitempty"`
}
