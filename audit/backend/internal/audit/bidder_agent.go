package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

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

// BidderTools is the dependency surface the bidder agent needs to serve
// tool_use calls. It is intentionally small so callers can swap in a stub for
// testing.
type BidderTools interface {
	GetCreativeStatsWindow(ctx context.Context, creativeID string, days int) (impressions int, clicks int, err error)
	GetAdvertiserSpendToday(ctx context.Context, advertiserID string) (int64, error)
}

const bidderSystemPrompt = `你是 ZKDSP 广告平台的竞价 Agent（Bidder Agent）。
你的任务是：在你的已审核通过素材中选择一个最佳素材，预测点击率，并给出出价。

## 出价公式参考
bid_cpm = predicted_ctr * value_per_click * 1000 * strategy_multiplier

其中 strategy_multiplier:
- growth（增长型）: 1.2 - 1.5
- balanced（均衡型）: 0.9 - 1.1
- conservative（保守型）: 0.6 - 0.8

## 工具使用（可选）
在给出最终决策前，你可以调用以下工具补充信息：
- get_creative_stats_window: 查询某素材在最近 N 天的展示/点击，用于更新 CTR 判断
- get_today_spend: 查询当前广告主今日累计花费（原子单位，USDC 6 位小数），用于预算节奏控制
- submit_bid: 当你准备好最终决策时调用此工具提交结果；调用后停止

工具调用不是必须。只有当 input 中已有的 recentStats 不足以做判断、或启用了 Budget Pacing 技能时才推荐调用。

## 决策规则
1. 从候选素材中选择与当前广告位请求最匹配的 1 个素材
2. 考虑素材画像中的 placementFit 和 targetAudiences 与请求的匹配度
3. 结合历史表现（如果有）调整 CTR 预测
4. 确保 bid_cpm >= floor_cpm（否则设 participate=false）
5. 确保 bid_cpm <= max_bid_cpm
6. 如果没有合适素材，设 participate=false

## 最终输出
通过 submit_bid 工具提交。字段与下列 JSON 结构一致：
{
  "participate": true/false,
  "selectedCreativeId": "选中的素材 ID",
  "predictedCtr": 预测点击率(0-1),
  "bidCpm": 出价 CPM,
  "confidence": 置信度(0-1),
  "reason": "中文解释你为什么选这个素材、为什么出这个价"
}
如果 participate=false，其他字段可以为空或零值，但 reason 必须解释原因。`

func buildBidderTools() []anthropic.ToolUnionParam {
	tools := []anthropic.ToolParam{
		{
			Name:        "get_creative_stats_window",
			Description: anthropic.String("Return impression and click counts for a creative over the last N days."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"creative_id": map[string]any{"type": "string", "description": "Creative ID from the candidate list"},
					"days":        map[string]any{"type": "integer", "description": "Window size in days, 1-30", "minimum": 1, "maximum": 30},
				},
				Required: []string{"creative_id", "days"},
			},
		},
		{
			Name:        "get_today_spend",
			Description: anthropic.String("Return total captured spend since UTC midnight for the current advertiser, in atomic USDC units (6 decimals)."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{},
			},
		},
		{
			Name:        "submit_bid",
			Description: anthropic.String("Submit the final bid decision. Call this exactly once. After this call the agent stops."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"participate":        map[string]any{"type": "boolean"},
					"selectedCreativeId": map[string]any{"type": "string"},
					"predictedCtr":       map[string]any{"type": "number", "minimum": 0, "maximum": 1},
					"bidCpm":             map[string]any{"type": "number", "minimum": 0},
					"confidence":         map[string]any{"type": "number", "minimum": 0, "maximum": 1},
					"reason":             map[string]any{"type": "string"},
				},
				Required: []string{"participate", "reason"},
			},
		},
	}
	result := make([]anthropic.ToolUnionParam, len(tools))
	for i := range tools {
		t := tools[i]
		result[i] = anthropic.ToolUnionParam{OfTool: &t}
	}
	return result
}

var bidderToolDefs = buildBidderTools()

// RunBidderAgent runs the agentic loop for a single bid decision. `tools` may
// be nil, in which case tool_use calls will fail fast and push the model to
// return directly via submit_bid without any intermediate queries.
func RunBidderAgent(ctx context.Context, apiKey, model string, input BidderInput, tools BidderTools) (*BidderOutput, error) {
	client := newAnthropicClient(apiKey, nil)

	inputJSON, _ := json.MarshalIndent(input, "", "  ")
	userPrompt := fmt.Sprintf(`以下是本次竞价的输入信息：

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

	// System prompt is split so the large, stable portion gets prompt-cached
	// across every bid call (5-minute TTL), while the per-advertiser strategy
	// text stays cheap to vary.
	systemBlocks := []anthropic.TextBlockParam{
		{
			Text:         bidderSystemPrompt,
			CacheControl: anthropic.CacheControlEphemeralParam{Type: "ephemeral"},
		},
	}

	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(anthropic.NewTextBlock(userPrompt)),
	}

	const maxTurns = 4
	var submitted *BidderOutput

	for turn := 0; turn < maxTurns; turn++ {
		resp, err := callClaudeMessageWithRetry(ctx, client, anthropic.MessageNewParams{
			Model:     anthropic.Model(model),
			MaxTokens: 1024,
			System:    systemBlocks,
			Tools:     bidderToolDefs,
			Messages:  messages,
		})
		if err != nil {
			return nil, err
		}

		// Collect tool_use blocks from this assistant turn.
		type toolCall struct {
			ID    string
			Name  string
			Input json.RawMessage
		}
		var toolUses []toolCall
		for _, block := range resp.Content {
			if tu, ok := block.AsAny().(anthropic.ToolUseBlock); ok {
				toolUses = append(toolUses, toolCall{ID: tu.ID, Name: tu.Name, Input: tu.Input})
			}
		}

		// If the model produced no tool call, nudge it once then give up.
		if len(toolUses) == 0 {
			if turn == maxTurns-1 {
				return &BidderOutput{Participate: false, Reason: "Agent did not submit a bid"}, nil
			}
			messages = append(messages, resp.ToParam())
			messages = append(messages, anthropic.NewUserMessage(
				anthropic.NewTextBlock("请通过调用 submit_bid 工具提交最终决策。"),
			))
			continue
		}

		messages = append(messages, resp.ToParam())
		var toolResults []anthropic.ContentBlockParamUnion

		for _, tu := range toolUses {
			switch tu.Name {
			case "submit_bid":
				var out BidderOutput
				if err := json.Unmarshal(tu.Input, &out); err != nil {
					toolResults = append(toolResults, anthropic.NewToolResultBlock(
						tu.ID, `{"error":"could not parse submit_bid input"}`, true,
					))
					continue
				}
				submitted = &out
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, "ok", false))

			case "get_creative_stats_window":
				payload, isErr := callCreativeStatsWindow(ctx, tools, tu.Input)
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, payload, isErr))

			case "get_today_spend":
				payload, isErr := callTodaySpend(ctx, tools, input.AdvertiserID)
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, payload, isErr))

			default:
				errJSON, _ := json.Marshal(map[string]string{"error": "unknown tool: " + tu.Name})
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, string(errJSON), true))
			}
		}

		messages = append(messages, anthropic.NewUserMessage(toolResults...))

		if submitted != nil {
			break
		}
	}

	if submitted == nil {
		return &BidderOutput{Participate: false, Reason: "Agent exceeded tool-use turn budget"}, nil
	}

	// L1: final clamp in case the LLM violated constraints despite the prompt.
	if submitted.BidCpm > input.MaxBidCpm {
		log.Printf("[bidder] clamp bid %.2f -> %.2f (max_bid_cpm)", submitted.BidCpm, input.MaxBidCpm)
		submitted.BidCpm = input.MaxBidCpm
	}

	return submitted, nil
}

func callCreativeStatsWindow(ctx context.Context, tools BidderTools, raw json.RawMessage) (string, bool) {
	if tools == nil {
		return `{"error":"tool not available in this context"}`, true
	}
	var args struct {
		CreativeID string `json:"creative_id"`
		Days       int    `json:"days"`
	}
	if err := json.Unmarshal(raw, &args); err != nil || args.CreativeID == "" {
		return `{"error":"invalid arguments"}`, true
	}
	impr, clicks, err := tools.GetCreativeStatsWindow(ctx, args.CreativeID, args.Days)
	if err != nil {
		errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
		return string(errJSON), true
	}
	ctr := 0.0
	if impr > 0 {
		ctr = float64(clicks) / float64(impr)
	}
	body, _ := json.Marshal(map[string]any{
		"creative_id": args.CreativeID,
		"days":        args.Days,
		"impressions": impr,
		"clicks":      clicks,
		"ctr":         ctr,
	})
	return string(body), false
}

func callTodaySpend(ctx context.Context, tools BidderTools, advertiserID string) (string, bool) {
	if tools == nil {
		return `{"error":"tool not available in this context"}`, true
	}
	spent, err := tools.GetAdvertiserSpendToday(ctx, advertiserID)
	if err != nil {
		errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
		return string(errJSON), true
	}
	body, _ := json.Marshal(map[string]any{
		"advertiser_id": advertiserID,
		"spent_atomic":  spent,
		"spent_usdc":    float64(spent) / 1_000_000.0,
		"currency":      "USDC",
	})
	return string(body), false
}
