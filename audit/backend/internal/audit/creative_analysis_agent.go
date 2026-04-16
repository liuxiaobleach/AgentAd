package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

type CreativeAnalysisInput struct {
	CreativeID      string `json:"creativeId"`
	CreativeURL     string `json:"creativeUrl"`
	ProjectName     string `json:"projectName"`
	LandingURL      string `json:"declaredLandingUrl"`
	AuditSummary    string `json:"auditSummary"`
	ImageBase64     string `json:"-"`
}

type CreativeAnalysisOutput struct {
	MarketingSummary   string                 `json:"marketingSummary"`
	VisualTags         []string               `json:"visualTags"`
	CtaType            string                 `json:"ctaType"`
	CopyStyle          string                 `json:"copyStyle"`
	TargetAudiences    []string               `json:"targetAudiences"`
	PlacementFit       []PlacementScore       `json:"placementFit"`
	PredictedCtrPriors map[string]float64     `json:"predictedCtrPriors"`
	BidHints           map[string]interface{} `json:"bidHints"`
}

type PlacementScore struct {
	SlotType string  `json:"slotType"`
	Score    float64 `json:"score"`
}

const analysisSystemPrompt = `你是 ZKDSP 广告平台的素材分析 Agent。
你的任务是对已通过审核的广告素材进行结构化分析，提取竞价和投放所需的营销信息。

## 输出要求
你必须返回一个严格的 JSON 对象（不要加 markdown 代码块包裹），字段如下：
{
  "marketingSummary": "2-3 句话描述素材的核心卖点和适合场景",
  "visualTags": ["标签1", "标签2", ...],
  "ctaType": "claim-now | learn-more | sign-up | download | trade-now | stake | other",
  "copyStyle": "direct-response | brand-awareness | educational | promotional | urgency",
  "targetAudiences": ["audience1", "audience2", ...],
  "placementFit": [
    {"slotType": "mobile-banner", "score": 0.0-1.0},
    {"slotType": "desktop-rectangle", "score": 0.0-1.0},
    {"slotType": "desktop-leaderboard", "score": 0.0-1.0},
    {"slotType": "native-feed", "score": 0.0-1.0}
  ],
  "predictedCtrPriors": {
    "mobile-banner": 0.001-0.05,
    "desktop-rectangle": 0.001-0.05,
    "desktop-leaderboard": 0.001-0.05,
    "native-feed": 0.001-0.05
  },
  "bidHints": {
    "recommendedStrategy": "aggressive | moderately_aggressive | balanced | conservative",
    "suggestedMaxBidCpm": 数值
  }
}

## 分析角度
- visualTags：描述素材的视觉元素（如 token-airdrop, defi-yield, nft-mint, gaming, exchange 等）
- targetAudiences：基于素材内容推荐的受众群体
- placementFit：评估素材在不同广告位类型上的适配度（考虑尺寸、信息密度、CTA 强度）
- predictedCtrPriors：基于素材特征给出各广告位的 CTR 先验估计
- bidHints：给 bidder agent 的出价建议

请用中文写 marketingSummary，标签和受众可以用英文。
直接返回 JSON，不要包裹在代码块中。`

func RunCreativeAnalysis(ctx context.Context, apiKey, model string, input CreativeAnalysisInput) (*CreativeAnalysisOutput, error) {
	client := newAnthropicClient(apiKey)

	contextText := fmt.Sprintf(`## 素材信息
- 项目名：%s
- 落地页：%s
- 审核摘要：%s

请分析这张广告素材，生成结构化的素材画像。`, input.ProjectName, input.LandingURL, input.AuditSummary)

	resp, err := callClaudeMessageWithRetry(ctx, client, anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 4096,
		System:    []anthropic.TextBlockParam{{Text: analysisSystemPrompt}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewImageBlockBase64("image/jpeg", input.ImageBase64),
				anthropic.NewTextBlock(contextText),
			),
		},
	})
	if err != nil {
		return nil, err
	}

	// Extract text response
	var text string
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = b.Text
			break
		}
	}

	if text == "" {
		return nil, fmt.Errorf("empty response from Claude")
	}

	var output CreativeAnalysisOutput
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		return nil, fmt.Errorf("failed to parse analysis JSON: %w (raw: %s)", err, text[:min(len(text), 200)])
	}

	return &output, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
