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
	VariantAngle    string   `json:"variantAngle,omitempty"`

	BrandKitName        string   `json:"brandKitName,omitempty"`
	BrandDescription    string   `json:"brandDescription,omitempty"`
	BrandVoiceTone      string   `json:"brandVoiceTone,omitempty"`
	BrandPrimaryMessage string   `json:"brandPrimaryMessage,omitempty"`
	BrandColorPalette   []string `json:"brandColorPalette,omitempty"`
	BrandMandatoryTerms []string `json:"brandMandatoryTerms,omitempty"`
	BrandBannedTerms    []string `json:"brandBannedTerms,omitempty"`
	BrandVisualRules    string   `json:"brandVisualRules,omitempty"`
	BrandCTAPreferences string   `json:"brandCtaPreferences,omitempty"`
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
  "headline": "主标题，必须为英文，≤4 个单词、≤30 字符，抓住核心卖点（会直接渲染到图片上）",
  "subheadline": "辅助文案，必须为英文，≤8 个单词（会直接渲染到图片上）",
  "callToAction": "行动号召，必须为英文，≤3 个单词，例如 Get Started / Try Now / Join Beta（会直接渲染到图片上）",
  "visualConcept": "视觉概念描述（画面主体、构图、氛围），可用中文",
  "mood": "情绪/调性，例如 充满未来感的科技光晕，可用中文",
  "colorPalette": ["主色描述", "辅色描述", "点缀色描述"],
  "forbiddenContent": ["禁止出现的元素列表，例如 真人肖像、知名商标、暴力"]
}

文案语言要求（非常重要）：
- headline / subheadline / callToAction 三个字段必须是英文，因为图像模型对中文字符渲染效果极差。
- 即使广告主的需求是中文，也要把中文意图翻译/改写成自然地道的英文广告文案，而不是直译。
- 保留品牌名（项目名）的原始拼写（无论中英文均照搬）。
- 其他字段（visualConcept / mood / colorPalette / forbiddenContent）可以继续用中文，它们只用于指导构图，不会出现在图像上。

文案质量要求：
1. 有吸引力，但不得含有 "100% return / guaranteed profit / click to claim" 这类诱导性话术。
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
	if strings.TrimSpace(brief.VariantAngle) != "" {
		userMsg += fmt.Sprintf("\n\n本次批量变体角度：%s", brief.VariantAngle)
	}
	if strings.TrimSpace(brief.BrandKitName) != "" ||
		strings.TrimSpace(brief.BrandDescription) != "" ||
		strings.TrimSpace(brief.BrandVoiceTone) != "" ||
		strings.TrimSpace(brief.BrandPrimaryMessage) != "" ||
		len(brief.BrandColorPalette) > 0 ||
		len(brief.BrandMandatoryTerms) > 0 ||
		len(brief.BrandBannedTerms) > 0 ||
		strings.TrimSpace(brief.BrandVisualRules) != "" ||
		strings.TrimSpace(brief.BrandCTAPreferences) != "" {
		userMsg += "\n\n品牌约束："
		if brief.BrandKitName != "" {
			userMsg += fmt.Sprintf("\n- Brand Kit: %s", brief.BrandKitName)
		}
		if brief.BrandDescription != "" {
			userMsg += fmt.Sprintf("\n- 品牌描述: %s", brief.BrandDescription)
		}
		if brief.BrandVoiceTone != "" {
			userMsg += fmt.Sprintf("\n- 品牌语气: %s", brief.BrandVoiceTone)
		}
		if brief.BrandPrimaryMessage != "" {
			userMsg += fmt.Sprintf("\n- 核心 message: %s", brief.BrandPrimaryMessage)
		}
		if len(brief.BrandColorPalette) > 0 {
			userMsg += fmt.Sprintf("\n- 品牌色板: %s", strings.Join(brief.BrandColorPalette, ", "))
		}
		if len(brief.BrandMandatoryTerms) > 0 {
			userMsg += fmt.Sprintf("\n- 必须优先体现的术语: %s", strings.Join(brief.BrandMandatoryTerms, ", "))
		}
		if len(brief.BrandBannedTerms) > 0 {
			userMsg += fmt.Sprintf("\n- 禁止出现的术语: %s", strings.Join(brief.BrandBannedTerms, ", "))
		}
		if brief.BrandVisualRules != "" {
			userMsg += fmt.Sprintf("\n- 视觉守则: %s", brief.BrandVisualRules)
		}
		if brief.BrandCTAPreferences != "" {
			userMsg += fmt.Sprintf("\n- CTA 偏好: %s", brief.BrandCTAPreferences)
		}
	}

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
- 画面中渲染的所有文字必须是英文，直接引用 directive 中的 headline / subheadline / callToAction 原字符串，不得改写、不得加入其他文字、不得出现任何中文字符或非拉丁字符
- 强调字体清晰、拼写正确、无乱码、高对比度、大号字号、留足背景空间
- 不得出现真人、知名商标、政治符号
- 适合广告使用，品牌化、干净、专业

文字渲染提示词示例（请在 prompt 中体现）：
"with the exact English text 'HEADLINE HERE' rendered in a large, bold, clean sans-serif font, perfectly legible, no misspellings, no extra characters, no non-Latin glyphs"

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
	if strings.TrimSpace(brief.VariantAngle) != "" {
		userMsg += fmt.Sprintf("\n本次批量变体角度：%s", brief.VariantAngle)
	}
	if strings.TrimSpace(brief.BrandKitName) != "" ||
		strings.TrimSpace(brief.BrandDescription) != "" ||
		strings.TrimSpace(brief.BrandVoiceTone) != "" ||
		strings.TrimSpace(brief.BrandPrimaryMessage) != "" ||
		len(brief.BrandColorPalette) > 0 ||
		len(brief.BrandMandatoryTerms) > 0 ||
		len(brief.BrandBannedTerms) > 0 ||
		strings.TrimSpace(brief.BrandVisualRules) != "" ||
		strings.TrimSpace(brief.BrandCTAPreferences) != "" {
		userMsg += "\n品牌约束："
		if brief.BrandKitName != "" {
			userMsg += fmt.Sprintf("\n- Brand Kit: %s", brief.BrandKitName)
		}
		if brief.BrandDescription != "" {
			userMsg += fmt.Sprintf("\n- 品牌描述: %s", brief.BrandDescription)
		}
		if brief.BrandVoiceTone != "" {
			userMsg += fmt.Sprintf("\n- 品牌语气: %s", brief.BrandVoiceTone)
		}
		if brief.BrandPrimaryMessage != "" {
			userMsg += fmt.Sprintf("\n- 核心 message: %s", brief.BrandPrimaryMessage)
		}
		if len(brief.BrandColorPalette) > 0 {
			userMsg += fmt.Sprintf("\n- 品牌色板: %s", strings.Join(brief.BrandColorPalette, ", "))
		}
		if len(brief.BrandMandatoryTerms) > 0 {
			userMsg += fmt.Sprintf("\n- 文案里尽量体现: %s", strings.Join(brief.BrandMandatoryTerms, ", "))
		}
		if len(brief.BrandBannedTerms) > 0 {
			userMsg += fmt.Sprintf("\n- 文案与画面都禁止出现: %s", strings.Join(brief.BrandBannedTerms, ", "))
		}
		if brief.BrandVisualRules != "" {
			userMsg += fmt.Sprintf("\n- 视觉守则: %s", brief.BrandVisualRules)
		}
		if brief.BrandCTAPreferences != "" {
			userMsg += fmt.Sprintf("\n- CTA 偏好: %s", brief.BrandCTAPreferences)
		}
	}

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
