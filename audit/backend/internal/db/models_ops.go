package db

import "time"

// OpsUser is a human reviewer who can override MANUAL_REVIEW audit cases.
type OpsUser struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	ContactEmail string    `json:"contactEmail"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"createdAt"`
}

// AuditReviewLog is an append-only audit trail of every manual override.
type AuditReviewLog struct {
	ID                 string         `json:"id"`
	AuditCaseID        string         `json:"auditCaseId"`
	ReviewerID         string         `json:"reviewerId"`
	ReviewerName       string         `json:"reviewerName,omitempty"` // joined
	PreviousDecision   *AuditDecision `json:"previousDecision"`
	NewDecision        AuditDecision  `json:"newDecision"`
	PreviousStatus     *AuditStatus   `json:"previousStatus"`
	NewStatus          AuditStatus    `json:"newStatus"`
	Notes              *string        `json:"notes"`
	CreatedAt          time.Time      `json:"createdAt"`
	CreativeName       string         `json:"creativeName,omitempty"` // joined for history listings
	ProjectName        string         `json:"projectName,omitempty"`
}
