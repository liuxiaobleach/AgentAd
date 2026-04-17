package tools

import (
	"crypto/tls"
	"net/http"
	"strings"
	"time"
)

// suspiciousTLDs are top-level domains commonly associated with spam or abuse.
var suspiciousTLDs = map[string]bool{
	".xyz":   true,
	".top":   true,
	".click": true,
	".buzz":  true,
	".icu":   true,
	".fun":   true,
}

// knownSafeDomains are well-known, trusted domains in the crypto ecosystem.
var knownSafeDomains = map[string]bool{
	"ethereum.org": true,
	"uniswap.org":  true,
	"aave.com":     true,
	"opensea.io":   true,
	"coinbase.com": true,
	"binance.com":  true,
}

// DomainReputationResult holds the reputation analysis for a domain.
type DomainReputationResult struct {
	Domain              string   `json:"domain"`
	RegistrationAgeDays *int     `json:"registrationAgeDays"`
	HasSSL              bool     `json:"hasSSL"`
	RiskLevel           string   `json:"riskLevel"`
	Flags               []string `json:"flags"`
}

// CheckDomainReputation performs a lightweight reputation check on the
// given domain, inspecting its TLD, known-safe status, and SSL availability.
func CheckDomainReputation(domain string) *DomainReputationResult {
	return CheckDomainReputationWithClient(domain, nil)
}

func CheckDomainReputationWithClient(domain string, httpClient *http.Client) *DomainReputationResult {
	domain = strings.ToLower(strings.TrimSpace(domain))

	result := &DomainReputationResult{
		Domain: domain,
		Flags:  make([]string, 0),
	}

	// Check if the domain is known safe.
	if knownSafeDomains[domain] {
		result.RiskLevel = "low"
		result.Flags = append(result.Flags, "known_safe_domain")
		// Still check SSL for completeness.
		result.HasSSL = checkSSL(domain, httpClient)
		return result
	}

	// Check for suspicious TLD.
	hasSuspiciousTLD := false
	for tld := range suspiciousTLDs {
		if strings.HasSuffix(domain, tld) {
			hasSuspiciousTLD = true
			result.Flags = append(result.Flags, "suspicious_tld")
			break
		}
	}

	// Check SSL.
	result.HasSSL = checkSSL(domain, httpClient)
	if !result.HasSSL {
		result.Flags = append(result.Flags, "no_ssl")
	}

	// Determine risk level based on collected signals.
	switch {
	case hasSuspiciousTLD && !result.HasSSL:
		result.RiskLevel = "high"
	case hasSuspiciousTLD || !result.HasSSL:
		result.RiskLevel = "medium"
	default:
		result.RiskLevel = "low"
	}

	return result
}

// checkSSL attempts an HTTPS HEAD request to the domain to determine
// whether it has a valid SSL certificate.
func checkSSL(domain string, httpClient *http.Client) bool {
	client := httpClient
	if client == nil {
		client = &http.Client{
			Timeout: 5 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					MinVersion: tls.VersionTLS12,
				},
			},
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}

	resp, err := client.Head("https://" + domain)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true
}
