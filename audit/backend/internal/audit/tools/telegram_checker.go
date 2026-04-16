package tools

import (
	"net/url"
	"regexp"
	"strings"
)

// telegramHandleRe matches a Telegram handle: alphanumeric plus underscores, 5+ chars.
var telegramHandleRe = regexp.MustCompile(`^[A-Za-z0-9_]{5,}$`)

// TelegramCheckResult holds the result of a Telegram link analysis.
type TelegramCheckResult struct {
	URL            string   `json:"url"`
	Handle         string   `json:"handle"`
	IsValid        bool     `json:"isValid"`
	MatchesProject bool     `json:"matchesProject"`
	Flags          []string `json:"flags"`
}

// CheckTelegramLink parses a t.me URL and checks whether the extracted
// handle is valid and whether it matches the given project name.
func CheckTelegramLink(rawURL, projectName string) *TelegramCheckResult {
	result := &TelegramCheckResult{
		URL:   rawURL,
		Flags: make([]string, 0),
	}

	// Parse the URL.
	parsed, err := url.Parse(rawURL)
	if err != nil {
		result.Flags = append(result.Flags, "invalid_url")
		return result
	}

	host := strings.ToLower(parsed.Hostname())
	if host != "t.me" && host != "telegram.me" {
		result.Flags = append(result.Flags, "not_telegram_domain")
		return result
	}

	// Extract the handle from the path: t.me/{handle}
	path := strings.Trim(parsed.Path, "/")
	segments := strings.SplitN(path, "/", 2)
	if len(segments) == 0 || segments[0] == "" {
		result.Flags = append(result.Flags, "no_handle_found")
		return result
	}

	handle := segments[0]
	// Strip leading @ if present.
	handle = strings.TrimPrefix(handle, "@")
	result.Handle = handle

	// Validate the handle format.
	if !telegramHandleRe.MatchString(handle) {
		result.Flags = append(result.Flags, "invalid_handle_format")
		return result
	}

	result.IsValid = true

	// Check if the handle matches the project name using normalized substring matching.
	normalizedHandle := normalizeForComparison(handle)
	normalizedProject := normalizeForComparison(projectName)

	if normalizedProject != "" && normalizedHandle != "" {
		if strings.Contains(normalizedHandle, normalizedProject) || strings.Contains(normalizedProject, normalizedHandle) {
			result.MatchesProject = true
		} else {
			result.Flags = append(result.Flags, "handle_does_not_match_project")
		}
	}

	return result
}

// normalizeForComparison lowercases and strips common separators and
// suffixes to allow fuzzy matching between handles and project names.
func normalizeForComparison(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "_", "")
	s = strings.ReplaceAll(s, "-", "")
	s = strings.ReplaceAll(s, " ", "")
	s = strings.ReplaceAll(s, ".", "")
	// Remove common suffixes that projects append to their handles.
	for _, suffix := range []string{"official", "community", "chat", "ann", "group", "channel"} {
		s = strings.TrimSuffix(s, suffix)
	}
	return s
}
