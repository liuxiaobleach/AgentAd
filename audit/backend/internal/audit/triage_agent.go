package audit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/disintegration/imaging"
	"github.com/zkdsp/audit-backend/internal/audit/tools"
)

type TriageInput struct {
	CreativeURL      string   `json:"creativeUrl"`
	CreativeHash     string   `json:"creativeHash"`
	DeclaredLanding  string   `json:"declaredLandingUrl"`
	DeclaredTelegram string   `json:"declaredTelegram,omitempty"`
	Contracts        []string `json:"contracts,omitempty"`
	ProjectName      string   `json:"projectName"`
	ChainID          int      `json:"chainId,omitempty"`
	ImageData        []byte   `json:"-"`
}

type ExtractedEntities struct {
	URLs            []string `json:"urls"`
	TelegramURLs    []string `json:"telegram_urls"`
	QRPayloads      []string `json:"qr_payloads"`
	Contracts       []string `json:"contracts"`
	RiskTerms       []string `json:"risk_terms"`
	WalletAddresses []string `json:"wallet_addresses"`
}

type AgentThinkingStep struct {
	Turn      int              `json:"turn"`
	Role      string           `json:"role"`
	Thinking  string           `json:"thinking,omitempty"`
	Text      string           `json:"text,omitempty"`
	ToolCalls []ToolCallRecord `json:"toolCalls,omitempty"`
	Timestamp string           `json:"timestamp"`
}

type ToolCallRecord struct {
	Name   string      `json:"name"`
	Input  interface{} `json:"input"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type TriageOutput struct {
	Entities      ExtractedEntities   `json:"entities"`
	Evidences     []Evidence          `json:"evidences"`
	Summary       string              `json:"summary"`
	RiskScore     float64             `json:"riskScore"`
	RiskSignals   []string            `json:"riskSignals"`
	AgentThinking []AgentThinkingStep `json:"agentThinking"`
}

type Evidence struct {
	ToolName    string      `json:"toolName"`
	Payload     interface{} `json:"payload"`
	RiskSignals []string    `json:"riskSignals,omitempty"`
}

const systemPrompt = `你是 ZKDSP Web3 广告审核平台的审核 Agent。
你的任务是分析广告素材（图片）和元数据，检测诈骗、钓鱼和违规行为。

## 重要：所有输出请使用中文
- 所有分析文本、总结、思考过程都请用中文描述
- 只有 risk_signals 字段保留英文标签（例如 "qr_code_found", "short_link_detected"），因为它们是规则引擎的枚举值
- 调用工具时，tool input 参数保持原始值（例如 domain 名、URL 等不要翻译）
- 可见分析文本请尽量使用简洁的“字段：内容”格式，每行一个结论
- 除首轮固定表格外，不要输出代码块或 JSON
- 不要使用 "---"、"***"、"###"、多余项目符号或分段分隔符
- 不要给字段名或内容额外加双引号、单引号
- 字段名尽量简短，例如：图片内容、发现链接、风险判断、与申报信息对比、后续检查

## 首轮可见分析输出格式（必须严格遵守）
在第一次 assistant 可见回复中，先输出“图片内容分析”，并且只保留以下 4 个部分：

图片内容分析

文字内容
| 字段 | 内容 |
| --- | --- |
| 主标题 | ... |
| 副标题 | ... |
| 内容 | ... |
| 主办方 | ... |
| 公司信息 | ... |
| 活动内容 | ... |

其他提取信息
| 属性 | 内容 |
| --- | --- |
| 属性1 | ... |
| 属性2 | ... |
| 属性3 | ... |

二维码实体
| 字段 | 内容 |
| --- | --- |
| 是否检测到二维码 | ... |
| 二维码内容 | ... |
| 二维码链接 | ... |
| 补充说明 | ... |

网站链接实体
| 字段 | 内容 |
| --- | --- |
| 图片内链接 | ... |
| 主要域名 | ... |
| 与申报链接对比 | ... |
| 补充说明 | ... |

- 如果某项未发现，明确写“未发现”
- 不要输出 Overview
- 其他提取信息用于补充主标题、副标题、内容、主办方、公司信息、活动内容之外，仍然有价值的素材信息
- 其他提取信息请自行提取 2-5 条有用内容，例如：奖励机制、时间限制、目标受众、品牌元素、行动号召、风险暗示、视觉卖点
- 如果没有更多内容可提取，在其他提取信息中写“未进一步提取”
- 不要添加第 5 个部分
- 在完成这一步可见分析后，再继续调用工具
- 后续 turn 的可见分析也尽量延续清晰的字段化表达

## 最终报告要求
- 在全部工具检查完成后，必须形成一份最终分析报告
- 最终分析报告要包含：总体判断、图片内容总结、主要风险点、与广告主申报信息对比、建议处理方式
- 这份最终分析报告必须写入 report_findings 的 final_report 字段
- final_report 必须是中文，内容完整、可读，不要只写一句话
- summary 继续保持 2-3 句简短摘要，final_report 负责完整结论

## 分析流程：
1. 仔细检查广告图片——读取所有文字、识别二维码、Logo、品牌元素和视觉内容。
2. 抽取所有实体：URL、Telegram 链接、钱包/合约地址、风险词。
3. 使用提供的工具验证域名、追踪跳转、检查链接。
4. 对比图片显示内容 vs 广告主的申报信息。
5. 输出审核结论和风险评分。

## 高风险信号（需要重点关注）：
- 二维码（尤其是二维码目标域名与申报落地页不一致）
- "airdrop"、"claim"、"claim now"、"connect wallet"、"free mint" 等话术
- 短链（隐藏真实跳转目标）
- 图片显示 URL 与申报落地页不一致
- Telegram 句柄与项目名不匹配
- 可疑 TLD（.xyz、.top、.click）
- 冒充知名协议或品牌
- 钱包连接 / 授权诱导
- 保证收益 / 稳赚不赔等虚假承诺

## 风险评分标准：
- 0-15：无风险，可以通过
- 16-40：轻微信号，低风险
- 41-60：多个信号，中等风险，建议人工复审
- 61-80：存在明显风险
- 81-100：明确的诈骗/钓鱼指标

## 可用的 risk_signals 标签（请从这些中选择）：
- qr_code_found（图片中检测到二维码）
- short_link_detected（检测到短链）
- risk_terms_detected（检测到高风险话术）
- qr_url_mismatch_declared（二维码 URL 与申报落地页不一致）
- suspicious_redirect（跳转链异常）
- high_risk_domain（高风险域名）
- telegram_mismatch（Telegram 句柄与项目不匹配）
- wallet_connect_prompt（诱导钱包连接）
- impersonation（冒充知名品牌）

请逐步思考你在图片中看到的内容以及它对用户安全的含义。
分析完成后，调用 report_findings 提交完整的评估结果。
再次提醒：summary 和所有文本描述请用中文。`

func buildAuditTools() []anthropic.ToolUnionParam {
	tools := []anthropic.ToolParam{
		{
			Name:        "check_domain_reputation",
			Description: anthropic.String("Check the reputation and risk level of a domain."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"domain": map[string]any{"type": "string", "description": "The domain to check"},
				},
				Required: []string{"domain"},
			},
		},
		{
			Name:        "trace_redirects",
			Description: anthropic.String("Trace the full redirect chain of a URL to find the final destination."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"url": map[string]any{"type": "string", "description": "The URL to trace"},
				},
				Required: []string{"url"},
			},
		},
		{
			Name:        "check_telegram_link",
			Description: anthropic.String("Verify a Telegram link and check if handle matches the project."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"url":          map[string]any{"type": "string", "description": "The Telegram URL"},
					"project_name": map[string]any{"type": "string", "description": "The declared project name"},
				},
				Required: []string{"url", "project_name"},
			},
		},
		{
			Name:        "canonicalize_url",
			Description: anthropic.String("Normalize a URL, extract domain/path/params, detect short links."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"url": map[string]any{"type": "string", "description": "The URL to canonicalize"},
				},
				Required: []string{"url"},
			},
		},
		{
			Name:        "report_findings",
			Description: anthropic.String("Submit your final analysis. Call this once after all checks are done."),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"entities": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"urls":             map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"telegram_urls":    map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"qr_payloads":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"contracts":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"risk_terms":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
							"wallet_addresses": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
						},
					},
					"risk_signals": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					"risk_score":   map[string]any{"type": "number", "description": "Risk score 0-100"},
					"summary":      map[string]any{"type": "string", "description": "2-3 sentence summary"},
					"final_report": map[string]any{"type": "string", "description": "Complete final analysis report in Chinese with overall judgment, key findings, comparison against declaration, and recommendation."},
				},
				Required: []string{"entities", "risk_signals", "risk_score", "summary", "final_report"},
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

var auditToolDefs = buildAuditTools()

func PrepareImageBase64(data []byte) (string, error) {
	return prepareImage(data)
}

func prepareImage(data []byte) (string, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}

	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w > 1568 || h > 1568 {
		img = imaging.Fit(img, 1568, 1568, imaging.Lanczos)
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return "", fmt.Errorf("encode jpeg: %w", err)
	}

	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func executeToolCall(name string, input map[string]interface{}, projectName string, httpClient *http.Client) (interface{}, error) {
	switch name {
	case "check_domain_reputation":
		domain, _ := input["domain"].(string)
		return tools.CheckDomainReputationWithClient(domain, httpClient), nil
	case "trace_redirects":
		url, _ := input["url"].(string)
		return tools.TraceRedirectsWithClient(url, 10, httpClient), nil
	case "check_telegram_link":
		url, _ := input["url"].(string)
		pn, _ := input["project_name"].(string)
		if pn == "" {
			pn = projectName
		}
		return tools.CheckTelegramLink(url, pn), nil
	case "canonicalize_url":
		url, _ := input["url"].(string)
		return tools.CanonicalizeURL(url), nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

func extractRiskSignals(toolName string, result interface{}) []string {
	data, _ := json.Marshal(result)
	var m map[string]interface{}
	json.Unmarshal(data, &m)

	var signals []string
	switch toolName {
	case "check_domain_reputation":
		if m["riskLevel"] == "high" {
			signals = append(signals, "high_risk_domain")
		}
		if m["riskLevel"] == "medium" {
			signals = append(signals, "medium_risk_domain")
		}
		if flags, ok := m["flags"].([]interface{}); ok {
			for _, f := range flags {
				signals = append(signals, fmt.Sprint(f))
			}
		}
	case "trace_redirects":
		if m["suspicious"] == true {
			signals = append(signals, "suspicious_redirect")
		}
	case "check_telegram_link":
		if m["matchesProject"] == false {
			signals = append(signals, "telegram_mismatch")
		}
	case "canonicalize_url":
		if m["isShortLink"] == true {
			signals = append(signals, "short_link_detected")
		}
	}
	return signals
}

type qrToolCheckState struct {
	requiredURLs     []string
	canonicalized    map[string]bool
	traced           map[string]bool
	checkedDomains   map[string]bool
	canonicalDomains map[string]string
	traceDomains     map[string]string
}

func newQRToolCheckState(urls []string) *qrToolCheckState {
	required := uniqueNormalizedURLs(urls)
	return &qrToolCheckState{
		requiredURLs:     required,
		canonicalized:    make(map[string]bool),
		traced:           make(map[string]bool),
		checkedDomains:   make(map[string]bool),
		canonicalDomains: make(map[string]string),
		traceDomains:     make(map[string]string),
	}
}

func uniqueNormalizedURLs(urls []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(urls))
	for _, raw := range urls {
		norm := normalizeComparableURL(raw)
		if norm == "" || seen[norm] {
			continue
		}
		seen[norm] = true
		result = append(result, norm)
	}
	return result
}

func normalizeComparableURL(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func parseHostname(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		parsed, err = url.Parse("https://" + raw)
		if err != nil {
			return ""
		}
	}
	return strings.ToLower(parsed.Hostname())
}

func (s *qrToolCheckState) hasRequiredChecks() bool {
	return len(s.requiredURLs) > 0
}

func (s *qrToolCheckState) noteToolResult(name string, input map[string]interface{}, result interface{}) {
	switch name {
	case "canonicalize_url":
		rawURL, _ := input["url"].(string)
		key := normalizeComparableURL(rawURL)
		if !s.isRequiredURL(key) {
			return
		}
		s.canonicalized[key] = true
		if res, ok := result.(*tools.CanonicalizedURL); ok {
			if domain := strings.ToLower(strings.TrimSpace(res.Domain)); domain != "" {
				s.canonicalDomains[key] = domain
			}
		}
		if s.canonicalDomains[key] == "" {
			if domain := parseHostname(rawURL); domain != "" {
				s.canonicalDomains[key] = domain
			}
		}
	case "trace_redirects":
		rawURL, _ := input["url"].(string)
		key := normalizeComparableURL(rawURL)
		if !s.isRequiredURL(key) {
			return
		}
		s.traced[key] = true
		if res, ok := result.(*tools.RedirectTraceResult); ok {
			if domain := parseHostname(res.FinalURL); domain != "" {
				s.traceDomains[key] = domain
			}
		}
		if s.traceDomains[key] == "" {
			if domain := parseHostname(rawURL); domain != "" {
				s.traceDomains[key] = domain
			}
		}
	case "check_domain_reputation":
		domain, _ := input["domain"].(string)
		domain = strings.ToLower(strings.TrimSpace(domain))
		if domain != "" {
			s.checkedDomains[domain] = true
		}
	}
}

func (s *qrToolCheckState) isRequiredURL(raw string) bool {
	for _, required := range s.requiredURLs {
		if required == raw {
			return true
		}
	}
	return false
}

func (s *qrToolCheckState) missingChecks() []string {
	missing := []string{}
	for _, qrURL := range s.requiredURLs {
		if !s.canonicalized[qrURL] {
			missing = append(missing, fmt.Sprintf("请对二维码链接 %s 调用 canonicalize_url", qrURL))
		}
		if !s.traced[qrURL] {
			missing = append(missing, fmt.Sprintf("请对二维码链接 %s 调用 trace_redirects", qrURL))
		}

		domains := []string{}
		if d := s.canonicalDomains[qrURL]; d != "" {
			domains = append(domains, d)
		}
		if d := s.traceDomains[qrURL]; d != "" && d != s.canonicalDomains[qrURL] {
			domains = append(domains, d)
		}
		if len(domains) == 0 {
			if d := parseHostname(qrURL); d != "" {
				domains = append(domains, d)
			}
		}

		domainChecked := false
		for _, domain := range domains {
			if s.checkedDomains[domain] {
				domainChecked = true
				break
			}
		}
		if !domainChecked {
			if len(domains) > 0 {
				missing = append(missing, fmt.Sprintf(
					"请对二维码相关域名 %s 调用 check_domain_reputation",
					strings.Join(domains, " / "),
				))
			} else {
				missing = append(missing, fmt.Sprintf("请对二维码链接 %s 的目标域名调用 check_domain_reputation", qrURL))
			}
		}
	}
	return missing
}

func (s *qrToolCheckState) checksComplete() bool {
	return len(s.missingChecks()) == 0
}

func (s *qrToolCheckState) reminderMessage() string {
	if !s.hasRequiredChecks() || s.checksComplete() {
		return ""
	}

	lines := []string{
		"检测到二维码链接后，不能直接给出最终结论。",
		"请先完成以下额外检查，再继续分析并提交 report_findings：",
	}
	for _, item := range s.missingChecks() {
		lines = append(lines, "- "+item)
	}
	return strings.Join(lines, "\n")
}

func RunTriage(ctx context.Context, apiKey, model string, input TriageInput, anthropicHTTPClient *http.Client, toolHTTPClient *http.Client) (*TriageOutput, error) {
	client := newAnthropicClient(apiKey, anthropicHTTPClient)

	evidences := []Evidence{}
	thinkingSteps := []AgentThinkingStep{}

	// Step 1: QR decode
	qrResult := tools.DecodeQR(input.ImageData)
	evidences = append(evidences, Evidence{
		ToolName: "qr_decode",
		Payload:  qrResult,
		RiskSignals: func() []string {
			if qrResult.Found {
				return []string{"qr_code_found"}
			}
			return nil
		}(),
	})
	qrChecks := newQRToolCheckState(qrResult.URLs)

	// Step 2: Prepare image
	imageB64, err := prepareImage(input.ImageData)
	if err != nil {
		return &TriageOutput{
			Summary:       "Failed to process image: " + err.Error(),
			RiskScore:     50,
			Evidences:     evidences,
			AgentThinking: []AgentThinkingStep{{Turn: 0, Role: "assistant", Text: "Image processing failed: " + err.Error(), Timestamp: time.Now().Format(time.RFC3339)}},
		}, nil
	}

	// Step 3: Build context
	contextText := fmt.Sprintf(`## Advertiser Declaration
- Project: %s
- Declared Landing URL: %s`, input.ProjectName, input.DeclaredLanding)
	if input.DeclaredTelegram != "" {
		contextText += fmt.Sprintf("\n- Declared Telegram: %s", input.DeclaredTelegram)
	}
	if len(input.Contracts) > 0 {
		contextText += fmt.Sprintf("\n- Contracts: %s", fmt.Sprint(input.Contracts))
	}
	if input.ChainID != 0 {
		contextText += fmt.Sprintf("\n- Chain ID: %d", input.ChainID)
	}
	contextText += fmt.Sprintf("\n- Creative Hash: %s", input.CreativeHash)

	qrInfo := "No QR code detected in the image."
	if qrResult.Found {
		qrInfo = fmt.Sprintf("Found QR code(s). Payloads: %v. URLs: %v", qrResult.Payloads, qrResult.URLs)
		if len(qrChecks.requiredURLs) > 0 {
			qrInfo += "\nMandatory follow-up: for each QR URL you must call canonicalize_url, trace_redirects, and check_domain_reputation before submitting the final report."
		}
	}
	contextText += fmt.Sprintf("\n\n## QR Code Scan Result\n%s\n\nPlease analyze this ad creative image thoroughly. Extract all text, URLs, risk terms, and entities you can see.\nThen use the tools to verify domains and links. Finally, call report_findings with your assessment.", qrInfo)

	// Step 4: Agentic loop
	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(
			anthropic.NewImageBlockBase64("image/jpeg", imageB64),
			anthropic.NewTextBlock(contextText),
		),
	}

	var reportFindings map[string]interface{}

	for turn := 0; turn < 10; turn++ {
		resp, err := callClaudeMessageWithRetry(ctx, client, anthropic.MessageNewParams{
			Model:     anthropic.Model(model),
			MaxTokens: 8096,
			System:    []anthropic.TextBlockParam{{Text: systemPrompt}},
			Tools:     auditToolDefs,
			Messages:  messages,
		})
		if err != nil {
			return nil, err
		}

		step := AgentThinkingStep{
			Turn:      turn,
			Role:      "assistant",
			Timestamp: time.Now().Format(time.RFC3339),
		}

		// Extract text and tool_use blocks
		var textParts []string
		var toolUseBlocks []struct {
			ID    string
			Name  string
			Input map[string]interface{}
		}

		for _, block := range resp.Content {
			switch b := block.AsAny().(type) {
			case anthropic.TextBlock:
				textParts = append(textParts, b.Text)
			case anthropic.ToolUseBlock:
				var input map[string]interface{}
				json.Unmarshal(b.Input, &input)
				toolUseBlocks = append(toolUseBlocks, struct {
					ID    string
					Name  string
					Input map[string]interface{}
				}{ID: b.ID, Name: b.Name, Input: input})
			}
		}

		if len(textParts) > 0 {
			combined := ""
			for _, t := range textParts {
				combined += t + "\n"
			}
			step.Text = combined
		}

		if len(toolUseBlocks) == 0 {
			if qrChecks.hasRequiredChecks() && !qrChecks.checksComplete() {
				thinkingSteps = append(thinkingSteps, step)
				messages = append(messages, resp.ToParam())
				messages = append(messages, anthropic.NewUserMessage(
					anthropic.NewTextBlock(qrChecks.reminderMessage()),
				))
				continue
			}
			thinkingSteps = append(thinkingSteps, step)
			break
		}

		// Add assistant response to messages
		messages = append(messages, resp.ToParam())

		// Execute tools
		var toolResults []anthropic.ContentBlockParamUnion
		for _, tu := range toolUseBlocks {
			tc := ToolCallRecord{Name: tu.Name, Input: tu.Input}

			if tu.Name == "report_findings" {
				if qrChecks.hasRequiredChecks() && !qrChecks.checksComplete() {
					errMsg := qrChecks.reminderMessage()
					tc.Error = errMsg
					errJSON, _ := json.Marshal(map[string]string{"error": errMsg})
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, string(errJSON), true))
					step.ToolCalls = append(step.ToolCalls, tc)
					continue
				}
				reportFindings = tu.Input
				tc.Result = tu.Input
				toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, "Findings recorded. Audit complete.", false))
			} else {
				result, err := executeToolCall(tu.Name, tu.Input, input.ProjectName, toolHTTPClient)
				if err != nil {
					tc.Error = err.Error()
					errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, string(errJSON), true))
				} else {
					tc.Result = result
					qrChecks.noteToolResult(tu.Name, tu.Input, result)
					signals := extractRiskSignals(tu.Name, result)
					evidences = append(evidences, Evidence{ToolName: tu.Name, Payload: result, RiskSignals: signals})
					resultJSON, _ := json.Marshal(result)
					toolResults = append(toolResults, anthropic.NewToolResultBlock(tu.ID, string(resultJSON), false))
				}
			}
			step.ToolCalls = append(step.ToolCalls, tc)
		}

		thinkingSteps = append(thinkingSteps, step)
		messages = append(messages, anthropic.NewUserMessage(toolResults...))

		if reportFindings != nil {
			break
		}
	}

	// Step 5: Parse report
	if reportFindings != nil {
		entities := ExtractedEntities{QRPayloads: qrResult.Payloads}
		if e, ok := reportFindings["entities"].(map[string]interface{}); ok {
			entities.URLs = toStringSlice(e["urls"])
			entities.TelegramURLs = toStringSlice(e["telegram_urls"])
			entities.Contracts = toStringSlice(e["contracts"])
			entities.RiskTerms = toStringSlice(e["risk_terms"])
			entities.WalletAddresses = toStringSlice(e["wallet_addresses"])
		}
		if len(entities.Contracts) == 0 {
			entities.Contracts = input.Contracts
		}

		summary, _ := reportFindings["summary"].(string)
		riskScore, _ := reportFindings["risk_score"].(float64)
		claudeSignals := toStringSlice(reportFindings["risk_signals"])

		return &TriageOutput{
			Entities:      entities,
			Evidences:     evidences,
			Summary:       summary,
			RiskScore:     riskScore,
			RiskSignals:   claudeSignals,
			AgentThinking: thinkingSteps,
		}, nil
	}

	return &TriageOutput{
		Entities: ExtractedEntities{
			QRPayloads: qrResult.Payloads,
			Contracts:  input.Contracts,
		},
		Evidences: evidences,
		Summary:   "Claude analysis completed without structured report.",
		RiskScore: func() float64 {
			if qrResult.Found {
				return 30
			}
			return 0
		}(),
		AgentThinking: thinkingSteps,
	}, nil
}

func toStringSlice(v interface{}) []string {
	if v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}
