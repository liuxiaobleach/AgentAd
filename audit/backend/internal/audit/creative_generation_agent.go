package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

// CreativeBrief captures the advertiser-provided request for an AI-generated ad.
type CreativeBrief struct {
	UserBrief       string   `json:"userBrief"`
	ProjectName     string   `json:"projectName"`
	LandingURL      string   `json:"landingUrl"`
	TargetAudiences []string `json:"targetAudiences,omitempty"`
	StyleHint       string   `json:"styleHint,omitempty"`   // cyberpunk, minimal, bold, playful, ...
	AspectRatio     string   `json:"aspectRatio,omitempty"` // 1:1, 16:9, 9:16
}

// CreativeDirective is the structured plan produced by the Brief Agent (Claude).
type CreativeDirective struct {
	Headline         string   `json:"headline"`
	Subheadline      string   `json:"subheadline"`
	CallToAction     string   `json:"callToAction"`
	VisualConcept    string   `json:"visualConcept"`
	Mood             string   `json:"mood"`
	ColorPalette     []string `json:"colorPalette"`
	ForbiddenContent []string `json:"forbiddenContent,omitempty"`
}

// GenerationOutput aggregates everything produced by the pipeline.
type GenerationOutput struct {
	Directive   CreativeDirective `json:"directive"`
	ImagePrompt string            `json:"imagePrompt"`
	ImageBytes  []byte            `json:"-"`
	ImageFormat string            `json:"imageFormat"` // "png"
	Steps       []GenerationStep  `json:"steps"`
}

type GenerationStep struct {
	Phase     string `json:"phase"`
	Message   string `json:"message"`
	Output    string `json:"output,omitempty"`
	Timestamp string `json:"timestamp"`
}

func now() string { return time.Now().Format(time.RFC3339) }

// ImageProviderConfig bundles all the keys/models for image generation.
type ImageProviderConfig struct {
	OpenAIKey        string
	OpenAIModel      string
	OpenAIHTTPClient *http.Client
	GeminiKey        string
	GeminiModel      string
	GeminiHTTPClient *http.Client
}

// RunCreativeGeneration runs the full pipeline: brief → directive → image prompt → image.
func RunCreativeGeneration(
	ctx context.Context,
	anthropicKey string,
	claudeModel string,
	anthropicHTTPClient *http.Client,
	imgCfg ImageProviderConfig,
	brief CreativeBrief,
	onStep func(GenerationStep),
) (*GenerationOutput, error) {
	steps := []GenerationStep{}
	record := func(phase, msg, out string) {
		s := GenerationStep{Phase: phase, Message: msg, Output: out, Timestamp: now()}
		steps = append(steps, s)
		if onStep != nil {
			onStep(s)
		}
	}

	if anthropicKey == "" {
		return nil, fmt.Errorf("ANTHROPIC_API_KEY is not configured")
	}

	provider := NewImageProvider(
		imgCfg.OpenAIKey,
		imgCfg.OpenAIModel,
		imgCfg.OpenAIHTTPClient,
		imgCfg.GeminiKey,
		imgCfg.GeminiModel,
		imgCfg.GeminiHTTPClient,
	)

	client := newAnthropicClient(anthropicKey, anthropicHTTPClient)

	// ----- Step 1: Brief Agent -> structured directive -----
	record("brief", "正在解析广告主需求...", "")
	directive, err := planCreativeDirective(ctx, client, claudeModel, brief)
	if err != nil {
		return nil, fmt.Errorf("brief agent: %w", err)
	}
	directiveJSON, _ := json.MarshalIndent(directive, "", "  ")
	record("brief", "已生成创意方向", string(directiveJSON))

	// ----- Step 2: Visual Agent -> image prompt -----
	record("prompt", "正在撰写图像生成 prompt...", "")
	imagePrompt, err := buildImagePrompt(ctx, client, claudeModel, brief, directive)
	if err != nil {
		return nil, fmt.Errorf("visual agent: %w", err)
	}
	record("prompt", "已生成图像 prompt", imagePrompt)

	// ----- Step 3: Image generation -----
	record("image", "调用图像生成服务...", "")
	size := ParseAspectRatio(brief.AspectRatio)
	imgBytes, err := provider.Generate(ctx, imagePrompt, size)
	if err != nil {
		return nil, fmt.Errorf("image provider: %w", err)
	}
	record("image", fmt.Sprintf("已生成图像 (%d bytes)", len(imgBytes)), "")

	return &GenerationOutput{
		Directive:   directive,
		ImagePrompt: imagePrompt,
		ImageBytes:  imgBytes,
		ImageFormat: "png",
		Steps:       steps,
	}, nil
}

// planCreativeDirective asks Claude to convert the free-form brief into a structured directive.
func planCreativeDirective(
	ctx context.Context,
	client anthropic.Client,
	model string,
	brief CreativeBrief,
) (CreativeDirective, error) {
	sys := `你是一名资深广告创意总监。将广告主提供的需求转化为可执行的创意方向，用于后续生成广告图像。

输出严格的 JSON（不要任何额外文字），结构如下：
{
  "headline": "主标题（≤10 个汉字或 ≤30 英文字符，抓住核心卖点）",
  "subheadline": "辅助文案（≤20 个汉字）",
  "callToAction": "行动号召（≤8 个字，例如 立即体验）",
  "visualConcept": "视觉概念描述（画面主体、构图、氛围）",
  "mood": "情绪/调性，例如 充满未来感的科技光晕",
  "colorPalette": ["主色描述", "辅色描述", "点缀色描述"],
  "forbiddenContent": ["禁止出现的元素列表，例如 真人肖像、知名商标、暴力"]
}

要求：
1. 文案要有吸引力，但不得含有"100% 收益 / 保证赚钱 / 点此领取"这类诱导性话术。
2. Web3 / DeFi 项目不要编造具体收益数字。
3. 视觉概念与品牌名相符。`

	userMsg := fmt.Sprintf(`广告主需求：
"""
%s
"""

项目名：%s
落地页：%s
目标受众：%s
风格偏好：%s
画面比例：%s

请输出 JSON。`,
		brief.UserBrief,
		brief.ProjectName,
		brief.LandingURL,
		strings.Join(brief.TargetAudiences, ", "),
		coalesce(brief.StyleHint, "无特别偏好"),
		coalesce(brief.AspectRatio, "1:1"),
	)

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 1024,
		System: []anthropic.TextBlockParam{
			{Text: sys},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userMsg)),
		},
	}

	resp, err := callClaudeMessageWithRetry(ctx, client, params)
	if err != nil {
		return CreativeDirective{}, err
	}

	text := extractAssistantText(resp)
	raw := extractJSONBlob(text)

	var directive CreativeDirective
	if err := json.Unmarshal([]byte(raw), &directive); err != nil {
		return CreativeDirective{}, fmt.Errorf("brief JSON parse: %w\nRaw: %s", err, text)
	}
	return directive, nil
}

// buildImagePrompt asks Claude to compose a detailed image-generation prompt.
func buildImagePrompt(
	ctx context.Context,
	client anthropic.Client,
	model string,
	brief CreativeBrief,
	directive CreativeDirective,
) (string, error) {
	sys := `你是图像生成 prompt 工程师。根据创意方向撰写一段高质量的英文 prompt，用于 OpenAI 图像生成 API（DALL-E 3 / gpt-image-1）。

输出规范：
- 纯英文，单一段落，200 词以内
- 描述画面主体、构图、光影、色调、风格流派、质感、氛围
- 显式要求画面中以大号、清晰、无乱码的字体渲染标题与 CTA 文字（只能英文或广告主提供的中文）
- 不得出现真人、知名商标、政治符号
- 适合广告使用，品牌化、干净、专业

只输出 prompt 文本，不要任何解释或前后缀。`

	directiveJSON, _ := json.Marshal(directive)
	userMsg := fmt.Sprintf(`项目：%s
创意方向 JSON：%s
风格偏好：%s
画面比例：%s

请输出 prompt。`,
		brief.ProjectName,
		string(directiveJSON),
		coalesce(brief.StyleHint, "modern professional"),
		coalesce(brief.AspectRatio, "1:1"),
	)

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 600,
		System: []anthropic.TextBlockParam{
			{Text: sys},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userMsg)),
		},
	}

	resp, err := callClaudeMessageWithRetry(ctx, client, params)
	if err != nil {
		return "", err
	}

	prompt := strings.TrimSpace(extractAssistantText(resp))
	// strip accidental code fences
	prompt = strings.TrimPrefix(prompt, "```")
	prompt = strings.TrimSuffix(prompt, "```")
	prompt = strings.TrimSpace(prompt)
	return prompt, nil
}

func extractAssistantText(resp *anthropic.Message) string {
	if resp == nil {
		return ""
	}
	var b strings.Builder
	for _, block := range resp.Content {
		if tb, ok := block.AsAny().(anthropic.TextBlock); ok {
			b.WriteString(tb.Text)
		}
	}
	return b.String()
}

// extractJSONBlob finds the first {...} JSON object in text (tolerates
// ```json fences / prose wrapping).
func extractJSONBlob(text string) string {
	trimmed := strings.TrimSpace(text)
	// Strip code fences
	fenced := regexp.MustCompile("(?s)```(?:json)?\\s*(.*?)\\s*```")
	if m := fenced.FindStringSubmatch(trimmed); len(m) > 1 {
		trimmed = strings.TrimSpace(m[1])
	}
	first := strings.Index(trimmed, "{")
	last := strings.LastIndex(trimmed, "}")
	if first == -1 || last == -1 || last <= first {
		return trimmed
	}
	return trimmed[first : last+1]
}

func coalesce(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
