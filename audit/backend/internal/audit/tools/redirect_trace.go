package tools

import (
	"net/http"
	"net/url"
	"time"
)

const userAgent = "Mozilla/5.0 (compatible; ZKDSPAuditBot/1.0)"

// RedirectHop represents a single hop in a redirect chain.
type RedirectHop struct {
	URL        string `json:"url"`
	StatusCode int    `json:"statusCode"`
}

// RedirectTraceResult holds the full redirect chain analysis.
type RedirectTraceResult struct {
	Hops           []RedirectHop `json:"hops"`
	FinalURL       string        `json:"finalURL"`
	TotalRedirects int           `json:"totalRedirects"`
	Suspicious     bool          `json:"suspicious"`
}

// TraceRedirects follows the redirect chain starting from the given URL
// up to maxRedirects hops. It marks the result as suspicious if there
// are more than 3 hops or the final domain differs from the initial domain.
func TraceRedirects(rawURL string, maxRedirects int) *RedirectTraceResult {
	return TraceRedirectsWithClient(rawURL, maxRedirects, nil)
}

func TraceRedirectsWithClient(rawURL string, maxRedirects int, httpClient *http.Client) *RedirectTraceResult {
	result := &RedirectTraceResult{
		Hops: make([]RedirectHop, 0),
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Prevent automatic redirect following; we handle it manually.
			return http.ErrUseLastResponse
		},
	}
	if httpClient != nil {
		client.Transport = httpClient.Transport
		client.Timeout = httpClient.Timeout
		client.Jar = httpClient.Jar
	}

	currentURL := rawURL
	var firstDomain string

	for i := 0; i <= maxRedirects; i++ {
		req, err := http.NewRequest(http.MethodGet, currentURL, nil)
		if err != nil {
			break
		}
		req.Header.Set("User-Agent", userAgent)

		resp, err := client.Do(req)
		if err != nil {
			break
		}
		resp.Body.Close()

		// Record the first domain for later comparison.
		if i == 0 {
			if parsed, err := url.Parse(currentURL); err == nil {
				firstDomain = parsed.Hostname()
			}
		}

		hop := RedirectHop{
			URL:        currentURL,
			StatusCode: resp.StatusCode,
		}
		result.Hops = append(result.Hops, hop)

		// If this is not a redirect status, we have reached the final destination.
		if resp.StatusCode < 300 || resp.StatusCode >= 400 {
			result.FinalURL = currentURL
			break
		}

		// Follow the Location header.
		location := resp.Header.Get("Location")
		if location == "" {
			result.FinalURL = currentURL
			break
		}

		// Resolve relative redirects against the current URL.
		base, err := url.Parse(currentURL)
		if err != nil {
			result.FinalURL = currentURL
			break
		}
		ref, err := url.Parse(location)
		if err != nil {
			result.FinalURL = currentURL
			break
		}
		currentURL = base.ResolveReference(ref).String()

		// If we are at the last allowed redirect, record the final URL.
		if i == maxRedirects {
			result.FinalURL = currentURL
		}
	}

	// If FinalURL was never set, use the last known URL.
	if result.FinalURL == "" && len(result.Hops) > 0 {
		result.FinalURL = result.Hops[len(result.Hops)-1].URL
	}

	// TotalRedirects is the number of hops minus the final (non-redirect) request.
	if len(result.Hops) > 1 {
		result.TotalRedirects = len(result.Hops) - 1
	}

	// Determine if the redirect chain is suspicious.
	finalDomain := ""
	if parsed, err := url.Parse(result.FinalURL); err == nil {
		finalDomain = parsed.Hostname()
	}
	if result.TotalRedirects > 3 || (firstDomain != "" && finalDomain != "" && firstDomain != finalDomain) {
		result.Suspicious = true
	}

	return result
}
