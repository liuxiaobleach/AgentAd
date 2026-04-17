package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

type BidderInput struct {
	AgentID        string              `json:"agentId"`
	AdvertiserID   string              `json:"advertiserId"`
	Strategy       string              `json:"strategy"`
	StrategyPrompt string              `json:"strategyPrompt"`
	ValuePerClick  float64             `json:"valuePerClick"`
	MaxBidCpm      float64             `json:"maxBidCpm"`
	BidRequest     BidRequestInfo      `json:"bidRequest"`
	Candidates     []CandidateCreative `json:"candidateCreatives"`
}

type BidRequestInfo struct {
	SlotID       string   `json:"slotId"`
	SlotType     string   `json:"slotType"`
	Size         string   `json:"size"`
	FloorCpm     float64  `json:"floorCpm"`
	SiteCategory string   `json:"siteCategory"`
	UserSegments []string `json:"userSegments"`
}

type CandidateCreative struct {
	CreativeID   string                 `json:"creativeId"`
	CreativeName string                 `json:"creativeName"`
	Profile      map[string]interface{} `json:"profile,omitempty"`
	RecentStats  map[string]interface{} `json:"recentStats,omitempty"`
}

type BidderOutput struct {
	Participate        bool    `json:"participate"`
	SelectedCreativeID string  `json:"selectedCreativeId"`
	PredictedCtr       float64 `json:"predictedCtr"`
	BidCpm             float64 `json:"bidCpm"`
	Confidence         float64 `json:"confidence"`
	Reason             string  `json:"reason"`
}

const bidderSystemPrompt = `你是 ZKDSP 广告平台的竞价 Agent（Bidder Agent）。
你的任务是：在你的已审核通过素材中选择一个最佳素材，预测点击率，并给出出价。

## 出价公式参考
bid_cpm = predicted_ctr * value_per_click * 1000 * strategy_multiplier

其中 strategy_multiplier:
- growth（增长型）: 1.2 - 1.5
- balanced（均衡型）: 0.9 - 1.1
- conservative（保守型）: 0.6 - 0.8

## 决策规则
1. 从候选素材中选择与当前广告位请求最匹配的 1 个素材
2. 考虑素材画像中的 placementFit 和 targetAudiences 与请求的匹配度
3. 结合历史表现（如果有）调整 CTR 预测
4. 确保 bid_cpm >= floor_cpm（否则设 participate=false）
5. 确保 bid_cpm <= max_bid_cpm
6. 如果没有合适素材，设 participate=false

## 输出格式
返回严格 JSON（不要代码块包裹）：
{
  "participate": true/false,
  "selectedCreativeId": "选中的素材 ID",
  "predictedCtr": 预测点击率(0-1),
  "bidCpm": 出价 CPM,
  "confidence": 置信度(0-1),
  "reason": "中文解释你为什么选这个素材、为什么出这个价"
}

如果 participate=false，其他字段可以为空或零值，但 reason 必须解释原因。`

func RunBidderAgent(ctx context.Context, apiKey, model string, input BidderInput) (*BidderOutput, error) {
	client := newAnthropicClient(apiKey, nil)

	inputJSON, _ := json.MarshalIndent(input, "", "  ")
	prompt := fmt.Sprintf(`以下是本次竞价的输入信息：

%s

请基于策略 "%s" 做出竞价决策。
你的 value_per_click = %.2f，max_bid_cpm = %.2f。
floor_cpm = %.2f（出价必须 >= 这个值才能参与）。

%s`, string(inputJSON), input.Strategy, input.ValuePerClick, input.MaxBidCpm,
		input.BidRequest.FloorCpm,
		func() string {
			if input.StrategyPrompt != "" {
				return "策略补充说明：" + input.StrategyPrompt
			}
			return ""
		}())

	resp, err := callClaudeMessageWithRetry(ctx, client, anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 2048,
		System:    []anthropic.TextBlockParam{{Text: bidderSystemPrompt}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return nil, err
	}

	var text string
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.TextBlock); ok {
			text = b.Text
			break
		}
	}

	if text == "" {
		return &BidderOutput{Participate: false, Reason: "Empty response from model"}, nil
	}

	var output BidderOutput
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		return &BidderOutput{Participate: false, Reason: fmt.Sprintf("Failed to parse: %s", text[:min(len(text), 200)])}, nil
	}

	// Clamp bid to max
	if output.BidCpm > input.MaxBidCpm {
		output.BidCpm = input.MaxBidCpm
	}

	return &output, nil
}
