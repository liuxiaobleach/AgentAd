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

// DSP new types

type BidderAgentStatus string

const (
	BidderAgentActive   BidderAgentStatus = "ACTIVE"
	BidderAgentPaused   BidderAgentStatus = "PAUSED"
	BidderAgentDisabled BidderAgentStatus = "DISABLED"
)

type CreativeProfile struct {
	ID                string          `json:"id"`
	CreativeID        string          `json:"creativeId"`
	AuditCaseID       *string         `json:"auditCaseId"`
	AnalysisVersion   int             `json:"analysisVersion"`
	MarketingSummary  *string         `json:"marketingSummary"`
	VisualTags        []string        `json:"visualTags"`
	CtaType           *string         `json:"ctaType"`
	CopyStyle         *string         `json:"copyStyle"`
	TargetAudiences   []string        `json:"targetAudiences"`
	PlacementFit      json.RawMessage `json:"placementFit"`
	PredictedCtrPriors json.RawMessage `json:"predictedCtrPriors"`
	BidHints          json.RawMessage `json:"bidHints"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
}

type BidderAgent struct {
	ID             string            `json:"id"`
	AdvertiserID   string            `json:"advertiserId"`
	Name           string            `json:"name"`
	Strategy       string            `json:"strategy"`
	StrategyPrompt *string           `json:"strategyPrompt"`
	ValuePerClick  float64           `json:"valuePerClick"`
	MaxBidCpm      float64           `json:"maxBidCpm"`
	Status         BidderAgentStatus `json:"status"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
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
	Bids   []AuctionBid    `json:"bids,omitempty"`
	Result *AuctionResult  `json:"result,omitempty"`
}

type AuctionBid struct {
	ID                string   `json:"id"`
	AuctionRequestID  string   `json:"auctionRequestId"`
	BidderAgentID     string   `json:"bidderAgentId"`
	SelectedCreativeID *string `json:"selectedCreativeId"`
	PredictedCtr      *float64 `json:"predictedCtr"`
	BidCpm            *float64 `json:"bidCpm"`
	Confidence        *float64 `json:"confidence"`
	Reason            *string  `json:"reason"`
	CreatedAt         time.Time `json:"createdAt"`

	// Joined
	AgentName    string `json:"agentName,omitempty"`
	CreativeName string `json:"creativeName,omitempty"`
}

type AuctionResult struct {
	ID                string   `json:"id"`
	AuctionRequestID  string   `json:"auctionRequestId"`
	WinnerBidID       *string  `json:"winnerBidId"`
	SettlementPrice   *float64 `json:"settlementPrice"`
	ShownCreativeID   *string  `json:"shownCreativeId"`
	Clicked           bool     `json:"clicked"`
	CreatedAt         time.Time `json:"createdAt"`
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
