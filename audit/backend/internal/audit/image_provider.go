package audit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ImageSize carries provider-specific size parameters.
type ImageSize struct {
	OpenAISize  string // "1024x1024", "1792x1024", "1024x1792"
	GeminiRatio string // "1:1", "16:9", "9:16"
}

var (
	SizeSquare    = ImageSize{OpenAISize: "1024x1024", GeminiRatio: "1:1"}
	SizeLandscape = ImageSize{OpenAISize: "1792x1024", GeminiRatio: "16:9"}
	SizePortrait  = ImageSize{OpenAISize: "1024x1792", GeminiRatio: "9:16"}
)

// ParseAspectRatio maps a human aspect label to an ImageSize.
func ParseAspectRatio(ar string) ImageSize {
	switch strings.TrimSpace(ar) {
	case "16:9", "landscape":
		return SizeLandscape
	case "9:16", "portrait":
		return SizePortrait
	default:
		return SizeSquare
	}
}

// ImageProvider abstracts over different image generation backends.
type ImageProvider interface {
	Generate(ctx context.Context, prompt string, size ImageSize) ([]byte, error)
}

// NewImageProvider auto-selects the backend based on what keys are available:
//   - If geminiKey is set → use Gemini Imagen 3
//   - Else if openaiKey is set → use OpenAI DALL-E / gpt-image
//   - Else → error at generation time
func NewImageProvider(openaiKey, openaiModel, geminiKey, geminiModel string) ImageProvider {
	if geminiKey != "" {
		if geminiModel == "" {
			geminiModel = "imagen-3.0-generate-002"
		}
		return &geminiProvider{apiKey: geminiKey, model: geminiModel}
	}
	if openaiKey != "" {
		if openaiModel == "" {
			openaiModel = "dall-e-3"
		}
		return &openAIProvider{apiKey: openaiKey, model: openaiModel}
	}
	return &noopProvider{}
}

// ---------------------------------------------------------------------------
// Gemini / Imagen 3
// ---------------------------------------------------------------------------

type geminiProvider struct {
	apiKey string
	model  string
}

type geminiImageRequest struct {
	Instances  []geminiInstance  `json:"instances"`
	Parameters geminiParameters `json:"parameters"`
}

type geminiInstance struct {
	Prompt string `json:"prompt"`
}

type geminiParameters struct {
	SampleCount    int    `json:"sampleCount"`
	AspectRatio    string `json:"aspectRatio,omitempty"`
	PersonGeneration string `json:"personGeneration,omitempty"`
}

type geminiImageResponse struct {
	Predictions []struct {
		BytesBase64Encoded string `json:"bytesBase64Encoded"`
		MimeType           string `json:"mimeType"`
	} `json:"predictions"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (p *geminiProvider) Generate(ctx context.Context, prompt string, size ImageSize) ([]byte, error) {
	url := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:predict?key=%s",
		p.model, p.apiKey,
	)

	reqBody := geminiImageRequest{
		Instances: []geminiInstance{{Prompt: prompt}},
		Parameters: geminiParameters{
			SampleCount:    1,
			AspectRatio:    size.GeminiRatio,
			PersonGeneration: "dont_allow",
		},
	}

	bodyBytes, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gemini image request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("gemini image API %d: %s", resp.StatusCode, string(respBytes))
	}

	var out geminiImageResponse
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return nil, fmt.Errorf("decode gemini response: %w", err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("gemini error %d: %s", out.Error.Code, out.Error.Message)
	}
	if len(out.Predictions) == 0 {
		return nil, fmt.Errorf("gemini returned no images")
	}

	return base64.StdEncoding.DecodeString(out.Predictions[0].BytesBase64Encoded)
}

// ---------------------------------------------------------------------------
// OpenAI DALL-E / gpt-image
// ---------------------------------------------------------------------------

type openAIProvider struct {
	apiKey string
	model  string
}

type openAIImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	Size           string `json:"size"`
	N              int    `json:"n"`
	ResponseFormat string `json:"response_format,omitempty"`
	Quality        string `json:"quality,omitempty"`
}

type openAIImageResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
		URL     string `json:"url"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

func (p *openAIProvider) Generate(ctx context.Context, prompt string, size ImageSize) ([]byte, error) {
	req := openAIImageRequest{
		Model:  p.model,
		Prompt: prompt,
		Size:   size.OpenAISize,
		N:      1,
	}

	if p.model == "gpt-image-1" {
		req.Quality = "high"
	} else {
		req.ResponseFormat = "b64_json"
		req.Quality = "hd"
	}

	bodyBytes, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(
		ctx, "POST",
		"https://api.openai.com/v1/images/generations",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("openai image request: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openai image API %d: %s", resp.StatusCode, string(respBytes))
	}

	var out openAIImageResponse
	if err := json.Unmarshal(respBytes, &out); err != nil {
		return nil, fmt.Errorf("decode openai response: %w", err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("openai error: %s", out.Error.Message)
	}
	if len(out.Data) == 0 {
		return nil, fmt.Errorf("openai returned no images")
	}

	if out.Data[0].B64JSON != "" {
		return base64.StdEncoding.DecodeString(out.Data[0].B64JSON)
	}
	if out.Data[0].URL != "" {
		getReq, _ := http.NewRequestWithContext(ctx, "GET", out.Data[0].URL, nil)
		getResp, err := client.Do(getReq)
		if err != nil {
			return nil, fmt.Errorf("download image: %w", err)
		}
		defer getResp.Body.Close()
		return io.ReadAll(getResp.Body)
	}

	return nil, fmt.Errorf("openai returned neither b64_json nor url")
}

// ---------------------------------------------------------------------------
// No-op (neither key configured)
// ---------------------------------------------------------------------------

type noopProvider struct{}

func (p *noopProvider) Generate(_ context.Context, _ string, _ ImageSize) ([]byte, error) {
	return nil, fmt.Errorf("no image generation API key configured (set GEMINI_API_KEY or OPENAI_API_KEY)")
}
