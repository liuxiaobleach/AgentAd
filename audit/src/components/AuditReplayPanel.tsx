"use client";

import { useEffect, useState } from "react";

interface ReplayToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: string | Record<string, unknown>;
  error?: string;
}

interface ReplayStep {
  turn: number;
  role: string;
  thinking?: string;
  text?: string;
  toolCalls?: ReplayToolCall[];
  timestamp: string;
}

interface AuditReplayPanelProps {
  steps: ReplayStep[];
  status: string;
  decision?: string | null;
  riskScore?: number | null;
  summary?: string | null;
  evidenceCount: number;
}

const TOOL_LABELS: Record<string, string> = {
  initial_analysis: "Initial analysis",
  qr_decode: "QR decode",
  url_scan: "URL scan",
  web_fetch: "Landing page fetch",
  report_findings: "Final decision",
};

function getStepTitle(step: ReplayStep, index: number, total: number) {
  const tools = (step.toolCalls || []).map((tool) => tool.name);
  if (tools.includes("report_findings")) {
    return "Final verdict assembled";
  }
  if (index === 0) {
    return "Creative intake and first-pass scan";
  }
  if (tools.length > 0) {
    return `Evidence verification via ${tools
      .filter((tool) => tool !== "report_findings")
      .map((tool) => TOOL_LABELS[tool] || tool)
      .join(", ")}`;
  }
  if (index === total - 1) {
    return "Audit wrap-up";
  }
  return `Reasoning checkpoint ${index + 1}`;
}

function getStepTone(step: ReplayStep, index: number) {
  const tools = (step.toolCalls || []).map((tool) => tool.name);
  if (tools.includes("report_findings")) {
    return {
      badge: "Decision",
      accent: "#10b981",
      soft: "rgba(16,185,129,0.12)",
      border: "rgba(16,185,129,0.22)",
    };
  }
  if (index === 0) {
    return {
      badge: "Intake",
      accent: "#06b6d4",
      soft: "rgba(6,182,212,0.12)",
      border: "rgba(6,182,212,0.22)",
    };
  }
  return {
    badge: "Verify",
    accent: "#6366f1",
    soft: "rgba(99,102,241,0.12)",
    border: "rgba(99,102,241,0.22)",
  };
}

function summarizeText(text?: string, maxLength = 260) {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function formatToolName(name: string) {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

export default function AuditReplayPanel({
  steps,
  status,
  decision,
  riskScore,
  summary,
  evidenceCount,
}: AuditReplayPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setCurrentIndex(0);
    setPlaying(false);
  }, [steps.length]);

  useEffect(() => {
    if (!playing || steps.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= steps.length - 1) {
          window.clearInterval(timer);
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 2200);

    return () => window.clearInterval(timer);
  }, [playing, steps.length]);

  if (steps.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-slate-400 text-sm">Replay will unlock as soon as the audit records its first step.</p>
      </div>
    );
  }

  const currentStep = steps[Math.min(currentIndex, steps.length - 1)];
  const tone = getStepTone(currentStep, currentIndex);
  const progress = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 100;

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-5 fx-aurora-shell fx-grid-shell fx-enter-up"
        style={{
          background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.92))",
          border: "1px solid rgba(71,85,105,0.35)",
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="text-[10px] uppercase tracking-[0.3em] px-2 py-1 rounded-full"
                style={{ background: "rgba(6,182,212,0.16)", color: "#67e8f9" }}
              >
                Audit Replay
              </span>
              <span className="text-xs text-slate-400">{steps.length} stages</span>
            </div>
            <h3 className="text-xl font-semibold text-white">{getStepTitle(currentStep, currentIndex, steps.length)}</h3>
            <p className="text-sm text-slate-400 mt-1">
              Reconstructing how the agent moved from raw creative intake to final policy decision.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
              className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => {
                if (currentIndex >= steps.length - 1) {
                  setCurrentIndex(0);
                }
                setPlaying((prev) => !prev);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${playing ? "fx-active-ring" : ""}`}
              style={{ background: tone.accent, color: "white" }}
            >
              {playing ? "Pause" : currentIndex >= steps.length - 1 ? "Replay" : "Play"}
            </button>
            <button
              onClick={() => setCurrentIndex((prev) => Math.min(prev + 1, steps.length - 1))}
              className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Next
            </button>
          </div>
        </div>

        <div className="grid xl:grid-cols-4 sm:grid-cols-2 grid-cols-1 gap-3 mb-5">
          <ReplayMetric label="Status" value={status} accent="#cbd5e1" delay={0} />
          <ReplayMetric label="Decision" value={decision || "Pending"} accent={decision === "PASS" ? "#34d399" : decision === "REJECT" ? "#f87171" : "#fbbf24"} delay={90} />
          <ReplayMetric label="Risk" value={riskScore != null ? String(riskScore) : "N/A"} accent={riskScore != null && riskScore <= 30 ? "#34d399" : riskScore != null && riskScore <= 60 ? "#fbbf24" : "#f87171"} delay={180} />
          <ReplayMetric label="Evidence" value={String(evidenceCount)} accent="#67e8f9" delay={270} />
        </div>

        <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-4 fx-progress-track">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${tone.accent}, rgba(255,255,255,0.92))`,
            }}
          />
        </div>

        <div className="grid lg:grid-cols-4 sm:grid-cols-2 grid-cols-1 gap-2 mb-5">
          {steps.map((step, index) => {
            const stepTone = getStepTone(step, index);
            const active = index === currentIndex;
            const completed = index < currentIndex;
            return (
              <button
                key={`marker-${step.turn}-${step.timestamp}`}
                onClick={() => {
                  setCurrentIndex(index);
                  setPlaying(false);
                }}
                className="rounded-xl px-3 py-2 text-left transition-all fx-enter-up"
                style={{
                  animationDelay: `${index * 70}ms`,
                  background: active ? `${stepTone.accent}20` : completed ? "rgba(15,23,42,0.72)" : "rgba(15,23,42,0.4)",
                  border: `1px solid ${active ? `${stepTone.accent}44` : "rgba(71,85,105,0.22)"}`,
                  color: active ? stepTone.accent : completed ? "#cbd5e1" : "#64748b",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${active ? "fx-active-ring" : ""}`}
                    style={{ background: active ? stepTone.accent : completed ? "#94a3b8" : "#334155" }}
                  />
                  <span className="text-[11px] uppercase tracking-[0.22em]">{index + 1}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid xl:grid-cols-[1.4fr,0.9fr] grid-cols-1 gap-5">
          <div
            key={`${currentStep.turn}-${currentStep.timestamp}`}
            className="rounded-2xl p-5 transition-all duration-300 fx-stage-reveal fx-scan-card"
            style={{
              background: tone.soft,
              border: `1px solid ${tone.border}`,
              boxShadow: `0 18px 48px ${tone.soft}`,
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] uppercase tracking-[0.25em] px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(255,255,255,0.08)", color: tone.accent }}
                >
                  {tone.badge}
                </span>
                <span className="text-sm text-slate-300">Step {currentIndex + 1}</span>
              </div>
              <span className="text-xs text-slate-400">{new Date(currentStep.timestamp).toLocaleTimeString()}</span>
            </div>

            {currentStep.thinking && (
              <div className="mb-4 rounded-xl p-4 bg-black/20 border border-white/10">
                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 mb-2">Agent reasoning</div>
                <p className="text-sm leading-7 text-slate-100 whitespace-pre-wrap">{currentStep.thinking}</p>
              </div>
            )}

            {currentStep.text && (
              <div className="mb-4 rounded-xl p-4 bg-white/5 border border-white/10">
                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 mb-2">Observed output</div>
                <p className="text-sm leading-7 text-slate-200 whitespace-pre-wrap">{summarizeText(currentStep.text, 420)}</p>
              </div>
            )}

            {currentStep.toolCalls && currentStep.toolCalls.length > 0 && (
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Tools engaged</div>
                {currentStep.toolCalls.map((tool, index) => (
                  <div key={`${tool.name}-${index}`} className="rounded-xl p-3 bg-black/20 border border-white/10">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-sm font-medium text-white">{formatToolName(tool.name)}</span>
                      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{tool.error ? "error" : "ok"}</span>
                    </div>
                    {tool.result && (
                      <p className="text-xs leading-6 text-slate-300">
                        {typeof tool.result === "string"
                          ? summarizeText(tool.result, 180)
                          : summarizeText(JSON.stringify(tool.result), 180)}
                      </p>
                    )}
                    {!tool.result && tool.input && Object.keys(tool.input).length > 0 && (
                      <p className="text-xs leading-6 text-slate-400">
                        Input: {summarizeText(JSON.stringify(tool.input), 180)}
                      </p>
                    )}
                    {tool.error && <p className="text-xs text-red-300 mt-1">{tool.error}</p>}
                  </div>
                ))}
              </div>
            )}

            {summary && currentIndex === steps.length - 1 && (
              <div className="mt-4 rounded-xl p-4 bg-emerald-400/10 border border-emerald-300/20">
                <div className="text-[11px] uppercase tracking-[0.25em] text-emerald-300 mb-2">Final summary</div>
                <p className="text-sm leading-7 text-emerald-50">{summary}</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {steps.map((step, index) => {
              const stepTone = getStepTone(step, index);
              const active = index === currentIndex;
              const completed = index < currentIndex;
              return (
                <button
                  key={`${step.turn}-${step.timestamp}`}
                  onClick={() => {
                    setCurrentIndex(index);
                    setPlaying(false);
                  }}
                  className={`w-full text-left rounded-xl p-4 transition-all fx-enter-right ${active ? "fx-hover-lift" : ""}`}
                  style={{
                    animationDelay: `${index * 90}ms`,
                    background: active ? stepTone.soft : completed ? "rgba(15,23,42,0.75)" : "rgba(15,23,42,0.45)",
                    border: `1px solid ${active ? stepTone.border : "rgba(71,85,105,0.35)"}`,
                    transform: active ? "translateY(-1px)" : "none",
                    boxShadow: active ? `0 16px 36px ${stepTone.soft}` : "none",
                    color: active ? stepTone.accent : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em]" style={{ color: active ? stepTone.accent : "#64748b" }}>
                        {active ? "Current" : completed ? "Completed" : "Queued"}
                      </div>
                      <div className="text-sm font-medium mt-1 text-white">{getStepTitle(step, index, steps.length)}</div>
                    </div>
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold"
                      style={{
                        background: active ? stepTone.accent : "rgba(51,65,85,0.85)",
                        color: "white",
                      }}
                    >
                      {index + 1}
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-slate-400">{summarizeText(step.thinking || step.text, 90) || "Waiting for structured output."}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplayMetric({ label, value, accent, delay }: { label: string; value: string; accent: string; delay?: number }) {
  return (
    <div
      className="rounded-xl p-4 bg-black/20 border border-white/10 fx-enter-up fx-hover-lift"
      style={{ animationDelay: `${delay || 0}ms` }}
    >
      <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500 mb-2">{label}</div>
      <div className="text-lg font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}
