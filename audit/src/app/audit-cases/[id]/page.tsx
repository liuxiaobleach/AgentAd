"use client";

import { apiFetch } from "@/lib/api";
import AuditReplayPanel from "@/components/AuditReplayPanel";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface ThinkingStep {
  turn: number;
  role: string;
  thinking?: string;
  text?: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: string | Record<string, unknown>;
    error?: string;
  }>;
  timestamp: string;
}

interface AuditEvidenceRecord {
  id: string;
  toolName: string;
  payload: Record<string, unknown> | null;
  riskSignals?: string[];
  createdAt?: string;
}

// Parse agent text into structured sections
interface AnalysisSection {
  title: string;
  type: "table" | "list" | "text";
  rows: Array<{ key: string; value: string; isRisk: boolean }>;
  paragraphs: string[];
}

interface AnalysisRow {
  key: string;
  value: string;
  isRisk: boolean;
}

interface InitialAnalysisBlock {
  title: string;
  rows: AnalysisRow[];
}

const RISK_KEYWORDS = ["风险", "risk", "诈骗", "scam", "恶意", "伪装", "冒充", "虚假", "空投", "airdrop", "claim", "钓鱼", "phishing", "二维码", "qr"];
const INITIAL_TEXT_FIELDS = ["主标题", "副标题", "内容", "主办方", "公司信息", "活动内容"] as const;

function isRiskText(text: string): boolean {
  return RISK_KEYWORDS.some((k) => text.toLowerCase().includes(k));
}

function cleanDisplayText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/[|｜]{2,}/g, " ")
    .replace(/[-=]{3,}/g, " ")
    .replace(/^[>\-•*#=\s]+/, "")
    .replace(/^[\""'“”‘’]+/, "")
    .replace(/[\""'“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanReportText(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`+/g, "")
    .replace(/[|｜]{2,}/g, " ")
    .replace(/[-=]{3,}/g, " ")
    .replace(/^[\""'“”‘’]+/, "")
    .replace(/[\""'“”‘’]+$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getFieldLabel(value: string): string {
  const normalized = cleanDisplayText(value);
  if (!normalized) {
    return "Text Summary";
  }

  const breakChars = ["。", "！", "？", ".", "!", "?", "；", ";", "，", ",", "：", ":"];
  let label = normalized;

  for (const ch of breakChars) {
    const idx = normalized.indexOf(ch);
    if (idx > 0) {
      label = normalized.slice(0, idx).trim();
      break;
    }
  }

  if (!label) {
    label = normalized;
  }

  return label.length > 18 ? `${label.slice(0, 18)}...` : label;
}

function normalizeHeading(line: string): string {
  return cleanDisplayText(line.replace(/^#+\s*/, "").replace(/[:：]$/, ""));
}

function parseMarkdownTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }

  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cleanDisplayText(cell));

  if (cells.length < 2) {
    return null;
  }

  const isDivider = cells.every((cell) => /^:?-{2,}:?$/.test(cell));
  if (isDivider) {
    return [];
  }

  return cells;
}

function normalizeInitialTextField(key: string): string {
  const cleaned = cleanDisplayText(key);
  if (!cleaned) return "";
  if (cleaned.includes("主标题") || cleaned === "标题") return "主标题";
  if (cleaned.includes("副标题")) return "副标题";
  if (cleaned === "正文" || cleaned.includes("文案") || cleaned.includes("内容")) return "内容";
  if (cleaned.includes("主办") || cleaned.includes("举办")) return "主办方";
  if (cleaned.includes("公司")) return "公司信息";
  if (cleaned.includes("活动")) return "活动内容";
  return cleaned;
}

function upsertBlockRow(
  rows: AnalysisRow[],
  key: string,
  value: string,
  isRisk: boolean
): AnalysisRow[] {
  const normalizedKey = cleanDisplayText(key);
  const normalizedValue = cleanDisplayText(value);
  if (!normalizedValue) {
    return rows;
  }

  const existingIndex = rows.findIndex((row) => row.key === normalizedKey);
  if (existingIndex >= 0) {
    const next = [...rows];
    next[existingIndex] = { key: normalizedKey, value: normalizedValue, isRisk };
    return next;
  }

  return [...rows, { key: normalizedKey, value: normalizedValue, isRisk }];
}

function parseInitialAnalysisText(text: string): InitialAnalysisBlock[] {
  const blocks: Record<string, AnalysisRow[]> = {
    "文字内容": [],
    "其他提取信息": [],
    "二维码实体": [],
    "网站链接实体": [],
  };

  const lines = text.split("\n");
  let currentBlock: keyof typeof blocks | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const heading = normalizeHeading(trimmed);
    if (heading === "图片内容分析") {
      continue;
    }
    if (
      heading === "文字内容" ||
      heading === "其他提取信息" ||
      heading === "二维码实体" ||
      heading === "网站链接实体"
    ) {
      currentBlock = heading;
      continue;
    }

    const tableCells = parseMarkdownTableCells(trimmed);
    if (tableCells) {
      if (tableCells.length === 0) {
        continue;
      }

      const firstCell = tableCells[0];
      const secondCell = tableCells.slice(1).join(" ");
      if (firstCell === "字段" && secondCell === "内容") {
        continue;
      }

      const targetBlock = currentBlock || "文字内容";
      const blockKey =
        targetBlock === "文字内容"
          ? normalizeInitialTextField(firstCell)
          : cleanDisplayText(firstCell);
      blocks[targetBlock] = upsertBlockRow(
        blocks[targetBlock],
        blockKey,
        secondCell,
        isRiskText(`${firstCell} ${secondCell}`)
      );
      continue;
    }

    const clean = cleanDisplayText(trimmed);
    if (!clean) continue;

    const colonIdx = clean.indexOf("：") !== -1 ? clean.indexOf("：") : clean.indexOf(":");
    if (colonIdx > 0 && colonIdx < 40 && clean.length > colonIdx + 1) {
      const rawKey = clean.slice(0, colonIdx);
      const rawValue = clean.slice(colonIdx + 1);
      const targetBlock = currentBlock || "文字内容";
      const blockKey =
        targetBlock === "文字内容"
          ? normalizeInitialTextField(rawKey)
          : cleanDisplayText(rawKey);
      blocks[targetBlock] = upsertBlockRow(
        blocks[targetBlock],
        blockKey,
        rawValue,
        isRiskText(clean)
      );
      continue;
    }

    if (currentBlock) {
      blocks[currentBlock] = upsertBlockRow(
        blocks[currentBlock],
        currentBlock === "文字内容" ? getFieldLabel(clean) : "Notes",
        clean,
        isRiskText(clean)
      );
    }
  }

  const textRowsByKey = new Map(
    blocks["文字内容"].map((row) => [normalizeInitialTextField(row.key), row])
  );
  const normalizedTextRows: AnalysisRow[] = INITIAL_TEXT_FIELDS.map((field) => {
    const row = textRowsByKey.get(field);
    return row || { key: field, value: "Not found", isRisk: false };
  });

  const qrRows =
    blocks["二维码实体"].length > 0
      ? blocks["二维码实体"]
      : [{ key: "QR Info", value: "Not found", isRisk: false }];

  const extraRows =
    blocks["其他提取信息"].length > 0
      ? blocks["其他提取信息"]
      : [{ key: "Extra Info", value: "No additional information extracted", isRisk: false }];

  const linkRows =
    blocks["网站链接实体"].length > 0
      ? blocks["网站链接实体"]
      : [{ key: "Website Link", value: "Not found", isRisk: false }];

  return [
    { title: "Text Content", rows: normalizedTextRows },
    { title: "Extra Extracted Info", rows: extraRows },
    { title: "QR Code Entities", rows: qrRows },
    { title: "Website Link Entities", rows: linkRows },
  ];
}

function parseAnalysisText(text: string): { sections: AnalysisSection[] } {
  const sections: AnalysisSection[] = [];
  const lines = text.split("\n");
  let current: AnalysisSection | null = null;

  const flushCurrent = () => {
    if (!current) return;
    // Determine type: if most rows have keys → table, else list
    if (current.rows.length > 0 && current.rows.filter((r) => r.key).length >= current.rows.length * 0.4) {
      current.type = "table";
    } else if (current.rows.length > 0) {
      current.type = "list";
    } else {
      current.type = "text";
    }
    sections.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect section headers: **Title** or ## Title or **Title：** (with colon)
    const isHeader =
      (trimmed.startsWith("**") && trimmed.endsWith("**") && !trimmed.includes("：") && !trimmed.includes(":") && trimmed.length < 50) ||
      trimmed.startsWith("## ");

    if (isHeader) {
      flushCurrent();
      current = {
        title: trimmed.replace(/\*\*/g, "").replace(/^#+\s*/, "").replace(/[:：]$/, ""),
        type: "list",
        rows: [],
        paragraphs: [],
      };
      continue;
    }

    if (!current) {
      current = { title: "Overview", type: "list", rows: [], paragraphs: [] };
    }

    // List items: - xxx or * xxx or 1. xxx
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s*(.+)$/);
    if (listMatch) {
      const content = cleanDisplayText(listMatch[1]);
      if (!content) continue;
      // Try to split on ：or :
      const colonIdx = content.indexOf("：") !== -1 ? content.indexOf("：") : content.indexOf(":");
      if (colonIdx > 0 && colonIdx < 40) {
        const key = cleanDisplayText(content.slice(0, colonIdx));
        const value = cleanDisplayText(content.slice(colonIdx + 1));
        current.rows.push({ key, value, isRisk: isRiskText(content) });
      } else {
        current.rows.push({ key: "", value: content, isRisk: isRiskText(content) });
      }
    } else {
      // Regular line — try key:value split for lines like **Title:** xxx
      const clean = cleanDisplayText(trimmed);
      if (!clean) continue;
      const colonIdx = clean.indexOf("：") !== -1 ? clean.indexOf("：") : clean.indexOf(":");
      if (colonIdx > 0 && colonIdx < 40 && clean.length > colonIdx + 1) {
        const key = cleanDisplayText(clean.slice(0, colonIdx));
        const value = cleanDisplayText(clean.slice(colonIdx + 1));
        if (value) {
          current.rows.push({ key, value, isRisk: isRiskText(clean) });
          continue;
        }
      }
      current.paragraphs.push(clean);
    }
  }
  flushCurrent();

  return { sections };
}

const TOOL_ICONS: Record<string, string> = {
  check_domain_reputation: "\u{1F310}",
  trace_redirects: "\u{1F517}",
  check_telegram_link: "\u{2708}\uFE0F",
  canonicalize_url: "\u{1F50D}",
  report_findings: "\u{1F4CB}",
  qr_decode: "\u{1F4F1}",
};

const TOOL_LABELS: Record<string, string> = {
  check_domain_reputation: "Domain Reputation",
  trace_redirects: "Redirect Trace",
  check_telegram_link: "Telegram Check",
  canonicalize_url: "URL Canonicalize",
  report_findings: "Final Report",
  qr_decode: "QR Verification",
};

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanDisplayText(String(item)))
    .filter(Boolean);
}

function hasDetectedQRCode(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) {
    return false;
  }

  return payload.found === true;
}

function hasQRCodeRiskSignal(thinkingSteps: ThinkingStep[]): boolean {
  return thinkingSteps.some((step) =>
    step.toolCalls?.some((toolCall) => {
      if (!toolCall.result || typeof toolCall.result === "string") {
        return false;
      }

      const riskSignals = toolCall.result.risk_signals;
      return Array.isArray(riskSignals) && riskSignals.includes("qr_code_found");
    })
  );
}

function agentClaimsQRCodeVisible(thinkingSteps: ThinkingStep[]): boolean {
  return thinkingSteps.some((step) => {
    if (!step.text) {
      return false;
    }

    return step.text
      .split("\n")
      .some((line) => /是否检测到二维码/.test(line) && /\|\s*是\s*\|?$/.test(line.trim()));
  });
}

function buildQRCodeVerificationStep(
  evidences: AuditEvidenceRecord[],
  thinkingSteps: ThinkingStep[]
): ThinkingStep | null {
  const qrEvidence = evidences.find((ev) => ev.toolName === "qr_decode");
  if (!qrEvidence) {
    return null;
  }

  const alreadyShown = thinkingSteps.some((step) =>
    step.toolCalls?.some((toolCall) => toolCall.name === "qr_decode")
  );
  if (alreadyShown) {
    return null;
  }

  const payload = qrEvidence.payload || {};
  const shouldShow =
    hasDetectedQRCode(payload) ||
    hasQRCodeRiskSignal(thinkingSteps) ||
    agentClaimsQRCodeVisible(thinkingSteps);
  if (!shouldShow) {
    return null;
  }

  const payloads = toStringList(payload.payloads);
  const urls = toStringList(payload.urls);
  const summaryParts: string[] = [];

  if (payloads.length > 0) {
    summaryParts.push(`recognized ${payloads.length} QR payload${payloads.length > 1 ? "s" : ""}`);
  }
  if (urls.length > 0) {
    summaryParts.push(`extracted ${urls.length} QR link${urls.length > 1 ? "s" : ""}`);
  }

  return {
    turn: 0,
    role: "tool",
    text:
      hasDetectedQRCode(payload)
        ? summaryParts.length > 0
          ? `QR verification complete. ${summaryParts.join("; ")}.`
          : "QR verification complete — QR content detected in the image."
        : "QR verification ran, but the tool did not decode any payload. The agent still judged this creative to contain a QR code based on visible elements; manual review is recommended.",
    toolCalls: [
      {
        name: "qr_decode",
        input: { source: "uploaded creative image" },
        result: payload,
      },
    ],
    timestamp: qrEvidence.createdAt || thinkingSteps[0]?.timestamp || new Date().toISOString(),
  };
}

function buildDisplayThinkingSteps(
  rawThinkingSteps: ThinkingStep[],
  evidences: AuditEvidenceRecord[]
): ThinkingStep[] {
  const baseSteps = rawThinkingSteps.map((step) => ({
    ...step,
    toolCalls: step.toolCalls ? [...step.toolCalls] : undefined,
  }));

  const qrVerificationStep = buildQRCodeVerificationStep(evidences, baseSteps);
  if (!qrVerificationStep) {
    return baseSteps;
  }

  const insertAt = baseSteps.length > 0 ? 1 : 0;
  const mergedSteps = [
    ...baseSteps.slice(0, insertAt),
    qrVerificationStep,
    ...baseSteps.slice(insertAt),
  ];

  return mergedSteps.map((step, index) => ({
    ...step,
    turn: index,
  }));
}

export default function AuditCaseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [auditCase, setAuditCase] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"thinking" | "replay" | "evidence" | "summary">("thinking");
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set([0]));
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      apiFetch(`/api/audit-cases/${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (stopped) return;
          setAuditCase(data);
          if (data.status !== "COMPLETED" && data.status !== "MANUAL_REVIEW") {
            setTimeout(load, 2000);
          }
        })
        .catch(() => { if (!stopped) setTimeout(load, 3000); });
    };
    load();
    return () => { stopped = true; };
  }, [id]);

  const rawThinkingSteps: ThinkingStep[] = auditCase?.agentThinking || [];
  const evidenceRecords: AuditEvidenceRecord[] = auditCase?.evidences || [];
  const thinkingSteps = buildDisplayThinkingSteps(rawThinkingSteps, evidenceRecords);
  const totalSteps = thinkingSteps.length;

  if (!auditCase) {
    return <div className="text-center py-12 text-slate-400">Loading...</div>;
  }

  const creative = auditCase.creative;

  const toggleTurn = (turn: number) => {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) next.delete(turn);
      else next.add(turn);
      return next;
    });
  };

  async function handleRedoAudit() {
    if (!creative?.id || rerunning) {
      return;
    }

    setRerunning(true);
    try {
      const res = await apiFetch(`/api/creatives/${creative.id}/submit-audit`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        router.push(`/audit-cases/${result.auditCaseId}`);
        return;
      }
      alert(result.error || "Redo audit failed");
    } catch {
      alert("Network error");
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Audit Case Detail</h2>
          <p className="text-slate-500 mt-1">{creative?.creativeName} - {creative?.projectName}</p>
        </div>
        <div className="flex gap-3 items-center">
          <button
            onClick={handleRedoAudit}
            disabled={rerunning || !creative?.id}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {rerunning ? "Redoing..." : "Redo Audit"}
          </button>
          {auditCase.decision && (
            <span className={`text-lg ${auditCase.decision === "PASS" ? "badge-verified" : auditCase.decision === "REJECT" ? "badge-rejected" : "badge-review"}`}>
              {auditCase.decision}
            </span>
          )}
          {auditCase.riskScore !== null && (
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
              auditCase.riskScore <= 30 ? "bg-green-100 text-green-800" :
              auditCase.riskScore <= 60 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
            }`}>Risk: {auditCase.riskScore}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Tabs */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex border-b border-slate-200">
              {[
                { key: "thinking", label: "Agent Thinking", count: thinkingSteps.length },
                { key: "replay", label: "Audit Replay", count: thinkingSteps.length },
                { key: "evidence", label: "Evidence", count: auditCase.evidences?.length || 0 },
                { key: "summary", label: "Summary" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "text-blue-600 border-b-2 border-blue-600 bg-blue-50/50"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                  {"count" in tab && tab.count !== undefined && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-6">
              {/* ==================== THINKING TAB ==================== */}
              {activeTab === "thinking" && (
                <div className="space-y-0">
                  {thinkingSteps.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                      <p className="text-slate-400 text-sm">Agent is analyzing...</p>
                    </div>
                  ) : (
                    <>
                      {thinkingSteps.map((step, i) => {
                        const isExpanded = expandedTurns.has(step.turn);
                        const isQRCodeStep = step.toolCalls?.some((tc) => tc.name === "qr_decode") || false;
                        const isFirst = i === 0 && !isQRCodeStep;
                        const parsed = step.text ? parseAnalysisText(step.text) : null;
                        const initialBlocks = isFirst && step.text ? parseInitialAnalysisText(step.text) : [];
                        const isLast = i === totalSteps - 1;
                        const isReport = step.toolCalls?.some((tc) => tc.name === "report_findings");

                        // Determine step label
                        const stepLabel = isReport
                          ? "Final Report"
                          : isFirst
                          ? "Agent Initial Analysis"
                          : `Tool Verification (${step.toolCalls?.filter((tc) => tc.name !== "report_findings").map((tc) => TOOL_LABELS[tc.name] || tc.name).join(", ") || "Processing"})`;

                        // Step colors
                        const dotColor = isReport
                          ? "bg-emerald-500 text-white"
                          : isFirst
                          ? "bg-blue-600 text-white"
                          : isExpanded
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-300 text-slate-600 hover:bg-slate-400";
                        const borderColor = isReport
                          ? "border-emerald-200"
                          : isFirst
                          ? "border-blue-200"
                          : "border-slate-200";
                        const headerBgStyle = isReport
                          ? { background: "rgba(16,185,129,0.08)" }
                          : isFirst
                          ? { background: "rgba(6,182,212,0.08)" }
                          : { background: "rgba(15,23,42,0.6)" };

                        return (
                          <div key={i} id={`turn-${step.turn}`} className="relative">
                            {/* Vertical connector line */}
                            {!isLast && (
                              <div className="absolute left-5 top-12 bottom-0 w-0.5" style={{
                                background: isReport ? "rgba(16,185,129,0.3)" : "rgba(30,41,59,0.8)"
                              }} />
                            )}

                            <div className="relative pl-12 pb-5">
                              {/* Timeline dot */}
                              <div className={`absolute left-2.5 top-3 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${dotColor} transition-colors`}>
                                {isReport ? "\u2713" : step.turn + 1}
                              </div>

                              {/* Card */}
                              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${isReport ? "rgba(16,185,129,0.2)" : isFirst ? "rgba(6,182,212,0.2)" : "rgba(30,41,59,0.8)"}` }}>
                                {/* Header (always visible, clickable) */}
                                <button
                                  onClick={() => toggleTurn(step.turn)}
                                  className="w-full flex items-center justify-between text-left px-4 py-3 transition-all hover:brightness-110"
                                  style={headerBgStyle}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold" style={{
                                      color: isReport ? "#34d399" : isFirst ? "#22d3ee" : "#e2e8f0",
                                      textShadow: isReport ? "0 0 10px rgba(16,185,129,0.5)" : isFirst ? "0 0 10px rgba(6,182,212,0.5)" : "none",
                                    }}>
                                      {stepLabel}
                                    </span>
                                    {/* Tool pills on collapsed */}
                                    {!isExpanded && !isFirst && !isReport && step.toolCalls && step.toolCalls.length > 0 && (
                                      <div className="flex gap-1">
                                        {step.toolCalls.filter((tc) => tc.name !== "report_findings").map((tc, j) => (
                                          <span key={j} className="text-xs px-1.5 py-0.5 bg-white/60 text-slate-600 rounded">
                                            {TOOL_ICONS[tc.name] || "\u2699"}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-400">{new Date(step.timestamp).toLocaleTimeString()}</span>
                                    <span className={`text-slate-400 transition-transform text-xs ${isExpanded ? "rotate-180" : ""}`}>&#9662;</span>
                                  </div>
                                </button>

                                {/* Expanded Content */}
                                {isExpanded && (
                                  <div className="p-4 space-y-3">
                                  {/* Thinking */}
                                  {step.thinking && (
                                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                                      <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded">THINKING</span>
                                      <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{step.thinking}</p>
                                    </div>
                                  )}

                                  {/* Analysis Text → Per-section independent cards */}
                                  {isFirst && initialBlocks.length > 0 ? (
                                    <InitialAnalysisCard blocks={initialBlocks} />
                                  ) : parsed && parsed.sections.length > 0 && (
                                    <div className="space-y-3">
                                      {parsed.sections.map((section, si) => {
                                        const hasRows = section.rows.length > 0;
                                        const isTable = section.type === "table";

                                        return (
                                          <div key={si} className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(30,41,59,0.8)" }}>
                                            {/* Section header */}
                                            <div className="px-4 py-2.5 flex items-center gap-2" style={{ background: "rgba(15,23,42,0.6)", borderBottom: "1px solid rgba(30,41,59,0.8)" }}>
                                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#06b6d4", boxShadow: "0 0 6px #06b6d4" }} />
                                              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>{section.title}</span>
                                              {hasRows && (
                                                <span className="text-[10px] ml-auto" style={{ color: "#475569" }}>{section.rows.length} items</span>
                                              )}
                                            </div>

                                            {/* Table view: key-value rows */}
                                            {isTable && hasRows && (
                                              <table className="w-full text-sm">
                                                <thead>
                                                  <tr>
                                                    <th className="w-1/3 text-left px-4 py-2.5 text-xs font-medium" style={{ background: "rgba(6,182,212,0.06)", color: "#64748b" }}>Field</th>
                                                    <th className="text-left px-4 py-2.5 text-xs font-medium" style={{ background: "rgba(15,23,42,0.4)", color: "#64748b" }}>Content</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {section.rows.map((row, ri) => (
                                                    <tr key={ri} style={{ borderTop: "1px solid rgba(30,41,59,0.6)" }}>
                                                      <td className="px-4 py-2.5 align-top text-sm font-medium" style={{
                                                        background: row.isRisk ? "rgba(239,68,68,0.08)" : "rgba(6,182,212,0.04)",
                                                        color: row.isRisk ? "#f87171" : "#94a3b8",
                                                      }}>
                                                        <div className="flex items-center gap-1.5">
                                                          {row.isRisk && <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />}
                                                          {row.key || getFieldLabel(row.value)}
                                                        </div>
                                                      </td>
                                                      <td className="px-4 py-2.5 text-sm" style={{
                                                        background: row.isRisk ? "rgba(239,68,68,0.05)" : "transparent",
                                                        color: row.isRisk ? "#f87171" : "#cbd5e1",
                                                        fontWeight: row.isRisk ? 500 : 400,
                                                      }}>
                                                        {row.value}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            )}

                                            {/* List view: items without clear keys */}
                                            {!isTable && hasRows && (
                                              <div className="px-4 py-3 space-y-1.5">
                                                {section.rows.map((row, ri) => (
                                                  <div key={ri} className={`text-sm flex items-start gap-2 ${row.isRisk ? "text-red-700" : "text-slate-700"}`}>
                                                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.isRisk ? "bg-red-500" : "bg-slate-300"}`} />
                                                    {row.key ? (
                                                      <span><span className="font-medium text-slate-600">{row.key}:</span> {row.value}</span>
                                                    ) : (
                                                      <span>{row.value}</span>
                                                    )}
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {/* Paragraph text */}
                                            {section.paragraphs.length > 0 && (
                                              <div className={`px-4 ${hasRows ? "pt-0 pb-3" : "py-3"}`}>
                                                {section.paragraphs.map((p, pi) => (
                                                  <p key={pi} className={`text-sm leading-relaxed ${isRiskText(p) ? "text-red-700" : "text-slate-600"}`}>{p}</p>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* Fallback: raw text if no sections parsed */}
                                  {!isFirst && parsed && parsed.sections.length === 0 && step.text && (
                                    <div className="p-4 bg-slate-50 rounded-lg">
                                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{step.text}</p>
                                    </div>
                                  )}

                                  {/* Tool Calls */}
                                  {step.toolCalls && step.toolCalls.length > 0 && (
                                    <div className="space-y-2">
                                      {step.toolCalls.map((tc, j) => (
                                        <div key={j} className={`border rounded-lg overflow-hidden ${
                                          tc.name === "report_findings" ? "border-emerald-300" : "border-slate-200"
                                        }`}>
                                          <div className={`px-4 py-2 flex items-center justify-between ${
                                            tc.name === "report_findings"
                                              ? "bg-gradient-to-r from-emerald-50 to-green-50"
                                              : "bg-slate-50"
                                          }`}>
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm">{TOOL_ICONS[tc.name] || "\u2699"}</span>
                                              <span className="text-sm font-semibold text-slate-800">
                                                {TOOL_LABELS[tc.name] || tc.name}
                                              </span>
                                              {tc.error && <span className="badge-rejected text-xs">Error</span>}
                                            </div>
                                            <span className="font-mono text-xs text-slate-400">{tc.name}</span>
                                          </div>
                                          <div className="p-3 space-y-2">
                                            {tc.name !== "report_findings" && (
                                              <div>
                                                <span className="text-xs text-slate-500 font-medium">Input</span>
                                                <pre className="text-xs text-slate-600 bg-slate-50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
                                              </div>
                                            )}
                                            {tc.result && (
                                              <div>
                                                <span className="text-xs text-slate-500 font-medium">
                                                  {tc.name === "report_findings" ? "Final Assessment" : "Result"}
                                                </span>
                                                {tc.name === "report_findings" ? (
                                                  <ReportFindings data={typeof tc.result === "string" ? {} : tc.result as Record<string, unknown>} />
                                                ) : (
                                                  <pre className="text-xs text-green-700 bg-green-50/50 p-2 rounded mt-1 overflow-x-auto max-h-32">
                                                    {typeof tc.result === "string" ? (tc.result as string) : JSON.stringify(tc.result, null, 2)}
                                                  </pre>
                                                )}
                                              </div>
                                            )}
                                            {tc.error && (
                                              <pre className="text-xs text-red-600 bg-red-50 p-2 rounded">{tc.error}</pre>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {activeTab === "replay" && (
                <AuditReplayPanel
                  steps={thinkingSteps}
                  status={auditCase.status}
                  decision={auditCase.decision || null}
                  riskScore={auditCase.riskScore ?? null}
                  summary={auditCase.summary || null}
                  evidenceCount={auditCase.evidences?.length || 0}
                />
              )}

              {/* ==================== EVIDENCE TAB ==================== */}
              {activeTab === "evidence" && (
                <div className="space-y-4">
                  {(auditCase.evidences?.length || 0) === 0 ? (
                    <p className="text-slate-400 text-sm">No evidence collected.</p>
                  ) : (
                    auditCase.evidences?.map((ev: any) => (
                      <div key={ev.id} className="border border-slate-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-sm font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                            {TOOL_ICONS[ev.toolName] || "\u2699"} {ev.toolName}
                          </span>
                          {ev.riskSignals && Array.isArray(ev.riskSignals) && ev.riskSignals.length > 0 && (
                            <div className="flex gap-1">
                              {ev.riskSignals.map((s: string) => (
                                <span key={s} className="badge-rejected text-xs">{s}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <pre className="text-xs text-slate-600 bg-slate-50 p-3 rounded overflow-x-auto max-h-48">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* ==================== SUMMARY TAB ==================== */}
              {activeTab === "summary" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500">Status</span>
                      <p className="font-medium mt-1">{auditCase.status}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500">Risk Score</span>
                      <p className={`font-bold text-xl mt-1 ${
                        (auditCase.riskScore ?? 0) <= 30 ? "text-green-600" :
                        (auditCase.riskScore ?? 0) <= 60 ? "text-yellow-600" : "text-red-600"
                      }`}>{auditCase.riskScore ?? "N/A"}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500">Policy Version</span>
                      <p className="font-medium mt-1">{auditCase.policyVersion}</p>
                    </div>
                  </div>
                  {auditCase.summary && (
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500 font-medium">Summary</span>
                      <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap leading-relaxed">{auditCase.summary}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ==================== RIGHT SIDEBAR ==================== */}
        <div className="space-y-6">
          {/* Creative */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Creative</h3>
            {creative?.imageUrl && (
              <img src={creative.imageUrl} alt={creative.creativeName} className="w-full rounded-lg border mb-4" />
            )}
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Landing URL</dt><dd className="text-slate-900 break-all">{creative?.landingUrl}</dd></div>
              {creative?.clickUrl && <div><dt className="text-slate-500">Click URL</dt><dd className="text-slate-900 break-all">{creative.clickUrl}</dd></div>}
              {creative?.telegramUrl && <div><dt className="text-slate-500">Telegram</dt><dd className="text-slate-900 break-all">{creative.telegramUrl}</dd></div>}
              {creative?.creativeHash && <div><dt className="text-slate-500">Hash</dt><dd className="font-mono text-xs break-all">{creative.creativeHash}</dd></div>}
            </dl>
            <Link href={`/creatives/${creative?.id}`} className="block mt-4 text-blue-600 text-sm hover:underline">View Creative Detail</Link>
          </div>

          {/* Attestation */}
          {auditCase.attestation && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Attestation</h3>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-slate-500">Attestation ID</dt><dd className="font-mono text-xs break-all">{auditCase.attestation.attestationId}</dd></div>
                <div><dt className="text-slate-500">Chain</dt><dd>Ethereum Sepolia (11155111)</dd></div>
                <div>
                  <dt className="text-slate-500">On-chain Tx</dt>
                  <dd className="font-mono text-xs break-all">
                    {auditCase.attestation.txHash ? (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${auditCase.attestation.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-600 hover:text-cyan-700 hover:underline"
                      >
                        {auditCase.attestation.txHash} ↗
                      </a>
                    ) : (
                      <span className="text-slate-400">pending on-chain…</span>
                    )}
                  </dd>
                </div>
                <div><dt className="text-slate-500">Status</dt><dd><span className="badge-verified">{auditCase.attestation.status}</span></dd></div>
                {auditCase.attestation.issuedAt && <div><dt className="text-slate-500">Issued</dt><dd>{new Date(auditCase.attestation.issuedAt).toLocaleString()}</dd></div>}
                {auditCase.attestation.expiresAt && <div><dt className="text-slate-500">Expires</dt><dd>{new Date(auditCase.attestation.expiresAt).toLocaleString()}</dd></div>}
              </dl>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Timeline</h3>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-slate-500">Submitted</dt><dd>{new Date(auditCase.submittedAt).toLocaleString()}</dd></div>
              {auditCase.completedAt && <div><dt className="text-slate-500">Completed</dt><dd>{new Date(auditCase.completedAt).toLocaleString()}</dd></div>}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function InitialAnalysisCard({ blocks }: { blocks: InitialAnalysisBlock[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(6,182,212,0.2)" }}>
        <div className="px-4 py-3 border-b" style={{ background: "linear-gradient(90deg, rgba(6,182,212,0.12), rgba(56,189,248,0.08))", borderColor: "rgba(6,182,212,0.2)" }}>
          <h4 className="text-sm font-bold tracking-wide" style={{ color: "#22d3ee", textShadow: "0 0 10px rgba(6,182,212,0.5)" }}>Image Content Analysis</h4>
        </div>

        <div className="p-4 space-y-4">
          {blocks.map((block) => (
            <div key={block.title} className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(30,41,59,0.8)" }}>
              <div className="px-4 py-2.5" style={{ background: "rgba(15,23,42,0.6)", borderBottom: "1px solid rgba(30,41,59,0.8)" }}>
                <span className="text-sm font-semibold" style={{ color: "#94a3b8" }}>{block.title}</span>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="w-1/3 text-left px-4 py-2.5 text-xs font-medium" style={{ background: "rgba(6,182,212,0.06)", color: "#64748b" }}>
                      {block.title === "Extra Extracted Info" ? "Attribute" : "Field"}
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium" style={{ background: "rgba(15,23,42,0.4)", color: "#64748b" }}>
                      Content
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, index) => (
                    <tr key={`${block.title}-${row.key}-${index}`} style={{ borderTop: "1px solid rgba(30,41,59,0.6)" }}>
                      <td
                        className="px-4 py-2.5 align-top text-sm font-medium"
                        style={{
                          background: row.isRisk ? "rgba(239,68,68,0.08)" : "rgba(6,182,212,0.04)",
                          color: row.isRisk ? "#f87171" : "#94a3b8",
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {row.isRisk && (
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          )}
                          {row.key}
                        </div>
                      </td>
                      <td
                        className="px-4 py-2.5 text-sm"
                        style={{
                          background: row.isRisk ? "rgba(239,68,68,0.05)" : "transparent",
                          color: row.isRisk ? "#f87171" : "#cbd5e1",
                          fontWeight: row.isRisk ? 500 : 400,
                        }}
                      >
                        {row.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Report Findings structured display
function ReportFindings({ data }: { data: Record<string, unknown> }) {
  const entities = (data.entities || {}) as Record<string, unknown>;
  const riskSignals = (data.risk_signals || []) as string[];
  const riskScore = (data.risk_score || 0) as number;
  const summary = (data.summary || "") as string;
  const finalReport = cleanReportText((data.final_report || data.finalReport || "") as string);

  return (
    <div className="mt-2 space-y-3">
      {/* Summary */}
      {summary && (
        <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
          <p className="text-sm text-emerald-900 font-medium">{summary}</p>
        </div>
      )}

      {finalReport && (
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Final Analysis Report
          </div>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {finalReport}
          </p>
        </div>
      )}

      {/* Score + Signals */}
      <div className="flex items-center gap-4">
        <div className={`px-4 py-2 rounded-lg font-bold text-lg ${
          riskScore <= 30 ? "bg-green-100 text-green-800" :
          riskScore <= 60 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
        }`}>
          {riskScore}
        </div>
        <div className="flex flex-wrap gap-1">
          {riskSignals.map((s) => (
            <span key={s} className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-full border border-red-200">{s}</span>
          ))}
        </div>
      </div>

      {/* Entities Table */}
      {Object.keys(entities).length > 0 && (
        <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left px-3 py-2 text-slate-500 font-medium">Entity Type</th>
              <th className="text-left px-3 py-2 text-slate-500 font-medium">Values</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Object.entries(entities).map(([key, vals]) => {
              const arr = Array.isArray(vals) ? vals : [];
              if (arr.length === 0) return null;
              return (
                <tr key={key}>
                  <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap align-top">{key}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {arr.map((v: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">{v}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
