package tools

import (
	"net/url"
	"strings"
)

// shortLinkDomains is the set of well-known URL shortener domains.
var shortLinkDomains = map[string]bool{
	"bit.ly":      true,
	"t.co":        true,
	"goo.gl":      true,
	"tinyurl.com": true,
	"ow.ly":       true,
	"is.gd":       true,
	"buff.ly":     true,
	"rebrand.ly":  true,
	"bl.ink":      true,
	"short.io":    true,
}

// CanonicalizedURL holds the result of URL canonicalization.
type CanonicalizedURL struct {
	Original    string            `json:"original"`
	Canonical   string            `json:"canonical"`
	Domain      string            `json:"domain"`
	Path        string            `json:"path"`
	Params      map[string]string `json:"params"`
	IsShortLink bool              `json:"isShortLink"`
}

// CanonicalizeURL parses a raw URL string and returns a canonicalized
// representation with the host lowercased, trailing slashes removed,
// and short-link detection applied.
func CanonicalizeURL(raw string) *CanonicalizedURL {
	result := &CanonicalizedURL{
		Original: raw,
		Params:   make(map[string]string),
	}

	// Ensure the URL has a scheme so net/url can parse it properly.
	normalized := raw
	if !strings.Contains(normalized, "://") {
		normalized = "https://" + normalized
	}

	parsed, err := url.Parse(normalized)
	if err != nil {
		// On parse failure, return what we can.
		result.Canonical = raw
		return result
	}

	// Lowercase the host.
	parsed.Host = strings.ToLower(parsed.Host)

	// Extract domain (host without port).
	domain := parsed.Hostname()
	result.Domain = domain

	// Remove trailing slash from path.
	path := strings.TrimRight(parsed.Path, "/")
	result.Path = path
	parsed.Path = path

	// Flatten query parameters into a simple map (first value wins).
	for key, values := range parsed.Query() {
		if len(values) > 0 {
			result.Params[key] = values[0]
		}
	}

	// Detect short-link domains.
	result.IsShortLink = shortLinkDomains[domain]

	// Build the canonical URL.
	result.Canonical = parsed.String()

	return result
}
