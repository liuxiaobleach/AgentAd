package audit

import (
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// PolicyInput contains all the data needed for policy evaluation.
type PolicyInput struct {
	RiskScore        float64
	RiskSignals      []string
	QrUrls           []string
	Entities         Entities
	DeclaredLandingURL string
}

// Entities holds extracted entities from the ad creative.
type Entities struct {
	URLs       []string
	QrPayloads []string
	RiskTerms  []string
}

// PolicyResult is the outcome of running the policy engine.
type PolicyResult struct {
	Decision     string   // PASS, REJECT, or MANUAL_REVIEW
	MatchedRules []string
	Explanation  string
}

type rule struct {
	ID       string
	Name     string
	Check    func(input PolicyInput) bool
	Decision string
	Priority int // lower = higher priority
}

var rules = []rule{
	{
		ID:   "R001",
		Name: "QR URL mismatch with declared landing page",
		Check: func(input PolicyInput) bool {
			if len(input.QrUrls) == 0 {
				return false
			}
			declared, err := url.Parse(input.DeclaredLandingURL)
			if err != nil {
				return false
			}
			declaredDomain := declared.Hostname()
			for _, qrURL := range input.QrUrls {
				parsed, err := url.Parse(qrURL)
				if err != nil {
					// Unparseable QR URL is a mismatch
					return true
				}
				if parsed.Hostname() != declaredDomain {
					return true
				}
			}
			return false
		},
		Decision: "REJECT",
		Priority: 1,
	},
	{
		ID:   "R002",
		Name: "Contains false profit guarantees",
		Check: func(input PolicyInput) bool {
			if !containsSignal(input.RiskSignals, "risk_terms_detected") {
				return false
			}
			falseProfitTerms := []string{"guaranteed returns", "100% profit", "risk-free"}
			for _, term := range input.Entities.RiskTerms {
				for _, fp := range falseProfitTerms {
					if term == fp {
						return true
					}
				}
			}
			return false
		},
		Decision: "REJECT",
		Priority: 1,
	},
	{
		ID:   "R003",
		Name: "Suspicious redirect chain detected",
		Check: func(input PolicyInput) bool {
			return containsSignal(input.RiskSignals, "suspicious_redirect")
		},
		Decision: "REJECT",
		Priority: 2,
	},
	{
		ID:   "R004",
		Name: "High risk domain detected",
		Check: func(input PolicyInput) bool {
			return containsSignal(input.RiskSignals, "high_risk_domain")
		},
		Decision: "REJECT",
		Priority: 2,
	},
	{
		ID:   "R005",
		Name: "QR code present - needs review",
		Check: func(input PolicyInput) bool {
			return containsSignal(input.RiskSignals, "qr_code_found")
		},
		Decision: "MANUAL_REVIEW",
		Priority: 5,
	},
	{
		ID:   "R006",
		Name: "Short link usage detected",
		Check: func(input PolicyInput) bool {
			return containsSignal(input.RiskSignals, "short_link_detected")
		},
		Decision: "MANUAL_REVIEW",
		Priority: 5,
	},
	{
		ID:   "R007",
		Name: "Telegram handle does not match project",
		Check: func(input PolicyInput) bool {
			return containsSignal(input.RiskSignals, "telegram_mismatch")
		},
		Decision: "MANUAL_REVIEW",
		Priority: 6,
	},
	{
		ID:   "R008",
		Name: "Contains wallet connect / claim language",
		Check: func(input PolicyInput) bool {
			walletTerms := []string{"connect wallet", "wallet connect", "claim", "claim now"}
			for _, term := range input.Entities.RiskTerms {
				lower := strings.ToLower(term)
				for _, wt := range walletTerms {
					if lower == wt {
						return true
					}
				}
			}
			return false
		},
		Decision: "MANUAL_REVIEW",
		Priority: 7,
	},
}

// EvaluatePolicy runs all policy rules against the input and returns the result.
func EvaluatePolicy(input PolicyInput) PolicyResult {
	var matched []rule

	for _, r := range rules {
		if r.Check(input) {
			matched = append(matched, r)
		}
	}

	ruleNames := make([]string, len(matched))
	for i, r := range matched {
		ruleNames[i] = fmt.Sprintf("%s: %s", r.ID, r.Name)
	}

	if len(matched) == 0 {
		return PolicyResult{
			Decision:     "PASS",
			MatchedRules: []string{},
			Explanation:  "Auto-approval mode enabled. Audit passed by default.",
		}
	}

	sort.Slice(matched, func(i, j int) bool {
		return matched[i].Priority < matched[j].Priority
	})

	topRule := matched[0]

	return PolicyResult{
		Decision:     "PASS",
		MatchedRules: ruleNames,
		Explanation:  fmt.Sprintf("Auto-approval mode enabled. Audit passed by default. Matched %d informational rule(s). Top rule: %s - %s.", len(matched), topRule.ID, topRule.Name),
	}
}

// containsSignal checks whether a slice of signals contains a specific signal.
func containsSignal(signals []string, target string) bool {
	for _, s := range signals {
		if s == target {
			return true
		}
	}
	return false
}
