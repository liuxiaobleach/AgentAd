package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

type AnalystInput struct {
	AdvertiserName string      `json:"advertiserName"`
	AgentStats     interface{} `json:"agentStats"`
	CreativeStats  interface{} `json:"creativeStats"`
	RecentRecords  interface{} `json:"recentRecords"`
	CurrentConfig  interface{} `json:"currentConfig"`
}

type AnalystOutput struct {
	OverallAssessment  string              `json:"overallAssessment"`
	PerformanceScore   int                 `json:"performanceScore"`
	KeyFindings        []AnalystFinding    `json:"keyFindings"`
	Recommendations    []AnalystRecommendation `json:"recommendations"`
	CreativeInsights   []CreativeInsight   `json:"creativeInsights"`
	StrategyAdvice     string              `json:"strategyAdvice"`
}

type AnalystFinding struct {
	Category string `json:"category"`
	Finding  string `json:"finding"`
	Impact   string `json:"impact"`
}

type AnalystRecommendation struct {
	Priority    string `json:"priority"`
	Action      string `json:"action"`
	Rationale   string `json:"rationale"`
	ExpectedImpact string `json:"expectedImpact"`
}

type CreativeInsight struct {
	CreativeName string `json:"creativeName"`
	Assessment   string `json:"assessment"`
	Suggestion   string `json:"suggestion"`
}

const analystSystemPrompt = `你是 ZKDSP 广告平台的广告分析师 Agent。
你的任务是分析广告主的投放数据，给出专业的诊断和优化建议。

## 输出要求
返回严格的 JSON（不要包裹在代码块中），字段如下：
{
  "overallAssessment": "2-3 句话总结当前投放状况",
  "performanceScore": 0-100 的整体评分,
  "keyFindings": [
    {
      "category": "win_rate | ctr | cost | creative | strategy",
      "finding": "发现的具体问题或亮点",
      "impact": "high | medium | low"
    }
  ],
  "recommendations": [
    {
      "priority": "high | medium | low",
      "action": "具体的优化建议",
      "rationale": "为什么建议这样做",
      "expectedImpact": "预期效果"
    }
  ],
  "creativeInsights": [
    {
      "creativeName": "素材名称",
      "assessment": "该素材的表现评价",
      "suggestion": "针对该素材的建议"
    }
  ],
  "strategyAdvice": "针对 bidder agent 策略配置的总体建议，包括 strategy_multiplier、value_per_click、max_bid_cpm 的调整方向"
}

## 分析维度
1. **胜率分析**：胜率是否合理？过低说明出价不足，过高可能出价过多
2. **CTR 分析**：实际 CTR vs 预测 CTR 的偏差，说明模型校准程度
3. **成本效率**：平均结算价 vs 平均出价的差距，bid shading 空间
4. **素材效果**：不同素材的 CTR 差异，是否有素材该淘汰或加大使用
5. **策略匹配**：当前策略是否适合目前的竞争环境

## 注意
- 如果数据量很少（< 5 次竞价），说明数据不足，建议先积累更多数据
- 所有文字用中文
- 建议要具体可操作，不要泛泛而谈`

func RunAnalystAgent(ctx context.Context, apiKey, model string, input AnalystInput) (*AnalystOutput, error) {
	client := newAnthropicClient(apiKey)

	inputJSON, _ := json.MarshalIndent(input, "", "  ")
	prompt := fmt.Sprintf(`请分析以下广告主 "%s" 的投放数据，给出诊断和优化建议：

%s`, input.AdvertiserName, string(inputJSON))

	resp, err := callClaudeMessageWithRetry(ctx, client, anthropic.MessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 4096,
		System:    []anthropic.TextBlockParam{{Text: analystSystemPrompt}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	})
	if err != nil {
		return nil, fmt.Errorf("claude API error: %w", err)
	}

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

	var output AnalystOutput
	if err := json.Unmarshal([]byte(text), &output); err != nil {
		return nil, fmt.Errorf("failed to parse analyst JSON: %w (raw: %s)", err, text[:min(len(text), 300)])
	}

	return &output, nil
}
