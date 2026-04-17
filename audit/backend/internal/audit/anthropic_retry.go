package audit

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const (
	claudeSDKMaxRetries    = 4
	claudeOuterRetryRounds = 3
)

var claudeOuterBackoffs = []time.Duration{
	0,
	2 * time.Second,
	5 * time.Second,
}

func newAnthropicClient(apiKey string, httpClient *http.Client) anthropic.Client {
	options := []option.RequestOption{
		option.WithAPIKey(apiKey),
		option.WithMaxRetries(claudeSDKMaxRetries),
	}
	if httpClient != nil {
		options = append(options, option.WithHTTPClient(httpClient))
	}

	return anthropic.NewClient(options...)
}

func callClaudeMessageWithRetry(
	ctx context.Context,
	client anthropic.Client,
	params anthropic.MessageNewParams,
) (*anthropic.Message, error) {
	var lastErr error

	for attempt := 0; attempt < claudeOuterRetryRounds; attempt++ {
		if attempt > 0 {
			wait := claudeOuterBackoffs[min(attempt, len(claudeOuterBackoffs)-1)]
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
			}
		}

		resp, err := client.Messages.New(ctx, params)
		if err == nil {
			return resp, nil
		}

		lastErr = err
		if !isRetryableClaudeError(err) {
			return nil, fmt.Errorf("claude API error: %w", err)
		}
	}

	return nil, fmt.Errorf(
		"claude API error after %d attempts: %w",
		claudeOuterRetryRounds,
		lastErr,
	)
}

func isRetryableClaudeError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 408 ||
			apiErr.StatusCode == 409 ||
			apiErr.StatusCode == 429 ||
			apiErr.StatusCode >= 500
	}

	// Non-API errors are usually transport-level and are worth retrying once more.
	return true
}
