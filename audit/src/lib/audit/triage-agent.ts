import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { decodeQr, type QrDecodeResult } from "./tools/qr-decode";
import { canonicalizeUrl } from "./tools/url-canonicalizer";
import { traceRedirects } from "./tools/redirect-trace";
import { checkDomainReputation } from "./tools/domain-reputation";
import { checkTelegramLink } from "./tools/telegram-checker";

const anthropic = new Anthropic();

export interface TriageInput {
  creativeUrl: string;
  creativeHash: string;
  declaredLandingUrl: string;
  declaredTelegram?: string;
  contracts?: string[];
  projectName: string;
  chainId?: number;
  imageBuffer: Buffer;
}

export interface ExtractedEntities {
  urls: string[];
  telegramUrls: string[];
  qrPayloads: string[];
  contracts: string[];
  riskTerms: string[];
  walletAddresses: string[];
}

export interface ToolPlanItem {
  tool: string;
  input: Record<string, unknown>;
}

/** A single step in the agent's thinking process */
export interface AgentThinkingStep {
  turn: number;
  role: "assistant" | "tool_result";
  thinking?: string;        // Claude's extended thinking (if enabled)
  text?: string;            // Claude's visible text response
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }>;
  timestamp: string;
}

export interface TriageOutput {
  entities: ExtractedEntities;
  toolPlan: ToolPlanItem[];
  evidences: Array<{ toolName: string; payload: unknown; riskSignals?: string[] }>;
  summary: string;
  riskScore: number;
  agentThinking: AgentThinkingStep[];  // 完整思考过程
}

// Claude tool definitions for the audit agent
const AUDIT_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_domain_reputation",
    description:
      "Check the reputation and risk level of a domain. Use this for every URL/domain found in the ad creative.",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "The domain to check, e.g. 'example.com'",
        },
      },
      required: ["domain"],
    },
  },
  {
    name: "trace_redirects",
    description:
      "Trace the full redirect chain of a URL. Use this for short links or suspicious URLs to find the final destination.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to trace redirects for",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "check_telegram_link",
    description:
      "Verify a Telegram link and check if the handle matches the declared project name.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The Telegram URL (e.g. https://t.me/example)",
        },
        project_name: {
          type: "string",
          description: "The declared project name to verify against",
        },
      },
      required: ["url", "project_name"],
    },
  },
  {
    name: "canonicalize_url",
    description:
      "Normalize and parse a URL, extracting domain, path, params, and detecting short links.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to canonicalize",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "report_findings",
    description:
      "Submit your final analysis. Call this once after all checks are done.",
    input_schema: {
      type: "object" as const,
      properties: {
        entities: {
          type: "object",
          description: "All entities extracted from the ad creative",
          properties: {
            urls: { type: "array", items: { type: "string" } },
            telegram_urls: { type: "array", items: { type: "string" } },
            qr_payloads: { type: "array", items: { type: "string" } },
            contracts: { type: "array", items: { type: "string" } },
            risk_terms: { type: "array", items: { type: "string" } },
            wallet_addresses: { type: "array", items: { type: "string" } },
          },
        },
        risk_signals: {
          type: "array",
          items: { type: "string" },
          description:
            "List of risk signals found, e.g. 'qr_code_found', 'short_link_detected', 'risk_terms_detected', 'qr_url_mismatch_declared', 'suspicious_redirect', 'high_risk_domain', 'telegram_mismatch'",
        },
        risk_score: {
          type: "number",
          description: "Overall risk score from 0 (safe) to 100 (dangerous)",
        },
        summary: {
          type: "string",
          description: "Human-readable summary of findings in 2-3 sentences",
        },
        final_report: {
          type: "string",
          description:
            "Complete final analysis report in Chinese with overall judgment, key findings, comparison against declaration, and recommendation",
        },
      },
      required: ["entities", "risk_signals", "risk_score", "summary", "final_report"],
    },
  },
];

const SYSTEM_PROMPT = `You are an ad audit agent for a Web3 advertising platform (AgentAd).
Your job is to analyze ad creatives (images) and their metadata to detect scams, phishing, and policy violations.

## Output formatting rules:
- Write visible analysis text in concise Chinese using simple "字段：内容" lines when possible
- Except for the fixed first-round analysis table, do not output code blocks or JSON in the visible analysis text
- Do not use separators like --- , *** , ###, or excessive bullet symbols
- Do not wrap field names or values in extra quotation marks
- Keep field names short, such as 图片内容, 发现链接, 风险判断, 对比结果, 后续检查

## First visible response format:
In the first assistant-visible response, output exactly one structured section named 图片内容分析 and keep only these 4 parts:

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

- If a field is not found, write 未发现
- Do not output Overview
- Use 其他提取信息 to capture valuable findings beyond 主标题、副标题、内容、主办方、公司信息、活动内容
- Extract 2-5 useful items when possible, such as reward mechanism, time limit, target audience, brand element, CTA, risk hint, or visual selling point
- If nothing extra is worth adding, write 未进一步提取 in that section
- Do not add a fifth section
- After this first visible analysis, continue with tool usage as needed

## Final report requirement:
- After all tool checks are finished, produce a complete final analysis report
- The final report must include: overall judgment, image content summary, key risk points, comparison against advertiser declaration, and recommended handling
- This complete final report must be included in the final_report field of report_findings
- summary should stay brief, while final_report should be complete and readable in Chinese

## Your analysis process:
1. Carefully examine the ad image — read all text, identify QR codes, logos, branding, and visual elements.
2. Extract all entities: URLs, Telegram links, wallet/contract addresses, risk terms.
3. Use the provided tools to verify domains, trace redirects, and check links.
4. Compare what the image shows vs what the advertiser declared.
5. Report your findings with a risk score.

## High-risk signals to watch for:
- QR codes (especially if their destination differs from the declared landing page)
- "airdrop", "claim", "claim now", "connect wallet", "free mint" language
- Short links hiding the real destination
- Image URL/domain different from declared landing URL
- Telegram handle not matching the project name
- Suspicious TLDs (.xyz, .top, .click)
- Fake branding or impersonation of known protocols
- Wallet connect / authorization prompts
- Guaranteed returns / profit promises

## Risk scoring guidelines:
- 0-15: Clean, no issues
- 16-40: Minor signals, low risk
- 41-60: Multiple signals, medium risk, likely needs human review
- 61-80: Significant risk signals
- 81-100: Clear scam/phishing indicators

Think step by step about what you see in the image and what it means for user safety.
After your analysis, call report_findings with your complete assessment.`;

async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectName: string
): Promise<unknown> {
  switch (toolName) {
    case "check_domain_reputation":
      return await checkDomainReputation(toolInput.domain as string);
    case "trace_redirects":
      return await traceRedirects(toolInput.url as string);
    case "check_telegram_link":
      return checkTelegramLink(
        toolInput.url as string,
        (toolInput.project_name as string) || projectName
      );
    case "canonicalize_url":
      return canonicalizeUrl(toolInput.url as string);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/** Resize image if too large, convert to JPEG for smaller payload */
async function prepareImageForClaude(
  imageBuffer: Buffer
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  // Resize if larger than 1568px on any side (Claude's recommended max)
  let pipeline = sharp(imageBuffer);
  if (width > 1568 || height > 1568) {
    pipeline = pipeline.resize(1568, 1568, { fit: "inside" });
  }

  // Convert to JPEG for smaller size
  const processed = await pipeline.jpeg({ quality: 85 }).toBuffer();
  return {
    base64: processed.toString("base64"),
    mediaType: "image/jpeg",
  };
}

export async function runTriage(input: TriageInput): Promise<TriageOutput> {
  const evidences: TriageOutput["evidences"] = [];
  const toolPlan: ToolPlanItem[] = [];
  const agentThinking: AgentThinkingStep[] = [];

  // Step 1: QR decode (deterministic, run before Claude)
  let qrResult: QrDecodeResult;
  try {
    qrResult = await decodeQr(input.imageBuffer);
    evidences.push({
      toolName: "qr_decode",
      payload: qrResult,
      riskSignals: qrResult.found ? ["has_qr_code"] : [],
    });
  } catch (err) {
    qrResult = { found: false, payloads: [], urls: [] };
    evidences.push({
      toolName: "qr_decode",
      payload: { error: err instanceof Error ? err.message : "QR decode failed" },
    });
  }

  // Step 2: Prepare image for Claude (resize + compress)
  let imageData: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  try {
    imageData = await prepareImageForClaude(input.imageBuffer);
  } catch (err) {
    // If image processing fails, return early with error
    agentThinking.push({
      turn: 0,
      role: "assistant",
      text: `Image processing failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      timestamp: new Date().toISOString(),
    });
    return {
      entities: { urls: [], telegramUrls: [], qrPayloads: qrResult.payloads, contracts: input.contracts || [], riskTerms: [], walletAddresses: [] },
      toolPlan: [],
      evidences,
      summary: "Failed to process image for analysis.",
      riskScore: 50,
      agentThinking,
    };
  }

  // Step 3: Build the message for Claude with the image + context
  const contextText = [
    `## Advertiser Declaration`,
    `- Project: ${input.projectName}`,
    `- Declared Landing URL: ${input.declaredLandingUrl}`,
    input.declaredTelegram ? `- Declared Telegram: ${input.declaredTelegram}` : null,
    input.contracts?.length ? `- Contracts: ${input.contracts.join(", ")}` : null,
    input.chainId ? `- Chain ID: ${input.chainId}` : null,
    `- Creative Hash: ${input.creativeHash}`,
    ``,
    `## QR Code Scan Result`,
    qrResult.found
      ? `Found QR code(s). Payloads: ${qrResult.payloads.join(", ")}. URLs: ${qrResult.urls.join(", ")}`
      : `No QR code detected in the image.`,
    ``,
    `Please analyze this ad creative image thoroughly. Extract all text, URLs, risk terms, and entities you can see.`,
    `Then use the tools to verify domains and links. Finally, call report_findings with your assessment.`,
  ]
    .filter(Boolean)
    .join("\n");

  // Step 4: Call Claude with vision + tool use in an agentic loop
  const model = process.env.AUDIT_MODEL || "claude-sonnet-4-20250514";
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: imageData.mediaType,
            data: imageData.base64,
          },
        },
        {
          type: "text",
          text: contextText,
        },
      ],
    },
  ];

  let reportFindings: Record<string, unknown> | null = null;

  for (let turn = 0; turn < 10; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8096,
      system: SYSTEM_PROMPT,
      tools: AUDIT_TOOLS,
      messages,
    });

    // Capture Claude's text responses and thinking
    const thinkingStep: AgentThinkingStep = {
      turn,
      role: "assistant",
      timestamp: new Date().toISOString(),
      toolCalls: [],
    };

    // Extract text blocks (Claude's reasoning)
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        textParts.push(block.text);
      } else if (block.type === "thinking" && "thinking" in block) {
        thinkingStep.thinking = (block as any).thinking;
      }
    }
    if (textParts.length > 0) {
      thinkingStep.text = textParts.join("\n");
    }

    // Check for tool use blocks
    const toolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      agentThinking.push(thinkingStep);
      break;
    }

    // Add assistant response to messages
    messages.push({
      role: "assistant",
      content: response.content as Anthropic.ContentBlockParam[],
    });

    // Execute each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;
      const toolUse = block as unknown as {
        id: string;
        name: string;
        input: Record<string, unknown>;
      };

      const toolCallRecord: NonNullable<AgentThinkingStep["toolCalls"]>[number] = {
        name: toolUse.name,
        input: toolUse.input,
      };

      if (toolUse.name === "report_findings") {
        reportFindings = toolUse.input;
        toolCallRecord.result = "Findings recorded.";
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: "Findings recorded. Audit complete.",
        });
      } else {
        toolPlan.push({ tool: toolUse.name, input: toolUse.input });
        try {
          const result = await executeToolCall(
            toolUse.name,
            toolUse.input,
            input.projectName
          );
          toolCallRecord.result = result;
          evidences.push({
            toolName: toolUse.name,
            payload: result,
            riskSignals: extractRiskSignals(toolUse.name, result),
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Tool execution failed";
          toolCallRecord.error = errorMsg;
          evidences.push({
            toolName: toolUse.name,
            payload: { error: errorMsg },
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          });
        }
      }

      thinkingStep.toolCalls!.push(toolCallRecord);
    }

    agentThinking.push(thinkingStep);
    messages.push({ role: "user", content: toolResults });

    if (reportFindings) break;
  }

  // Step 5: Parse Claude's report into our output format
  if (reportFindings) {
    const entities = reportFindings.entities as Record<string, string[]> | undefined;
    return {
      entities: {
        urls: entities?.urls || [],
        telegramUrls: entities?.telegram_urls || [],
        qrPayloads: qrResult.payloads,
        contracts: entities?.contracts || input.contracts || [],
        riskTerms: entities?.risk_terms || [],
        walletAddresses: entities?.wallet_addresses || [],
      },
      toolPlan,
      evidences,
      summary: (reportFindings.summary as string) || "Analysis complete.",
      riskScore: (reportFindings.risk_score as number) || 0,
      agentThinking,
    };
  }

  return {
    entities: {
      urls: [],
      telegramUrls: [],
      qrPayloads: qrResult.payloads,
      contracts: input.contracts || [],
      riskTerms: [],
      walletAddresses: [],
    },
    toolPlan,
    evidences,
    summary: "Claude analysis completed without structured report.",
    riskScore: qrResult.found ? 30 : 0,
    agentThinking,
  };
}

function extractRiskSignals(toolName: string, result: unknown): string[] {
  const signals: string[] = [];
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case "check_domain_reputation":
      if (r.riskLevel === "high") signals.push("high_risk_domain");
      if (r.riskLevel === "medium") signals.push("medium_risk_domain");
      if (Array.isArray(r.flags)) signals.push(...(r.flags as string[]));
      break;
    case "trace_redirects":
      if (r.suspicious) signals.push("suspicious_redirect_chain");
      if ((r.totalRedirects as number) > 3) signals.push("excessive_redirects");
      break;
    case "check_telegram_link":
      if (!r.matchesProject) signals.push("telegram_project_mismatch");
      if (!r.isValid) signals.push("invalid_telegram_url");
      break;
    case "canonicalize_url":
      if (r.isShortLink) signals.push("short_link_detected");
      break;
  }

  return signals;
}
