"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import OpsShell from "@/components/OpsShell";
import { opsApiFetch, OpsAuditCase } from "@/lib/ops-api";

type ThinkingStep = {
  turn: number;
  role: string;
  thinking?: string;
  text?: string;
  toolCalls?: Array<{
    name: string;
    input?: Record<string, unknown>;
    result?: string | Record<string, unknown>;
    error?: string;
  }>;
  timestamp?: string;
};

function isThinkingArray(v: unknown): v is ThinkingStep[] {
  return Array.isArray(v);
}

function backendImage(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const base = process.env.NEXT_PUBLIC_API_BASE || "";
  return base + url;
}

export default function OpsCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [caseData, setCaseData] = useState<OpsAuditCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<"PASS" | "REJECT" | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    opsApiFetch(`/api/ops/audit-cases/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load case");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setCaseData(data);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submitReview() {
    if (!decision) return;
    if (decision === "REJECT" && !notes.trim()) {
      setError("Notes are required when rejecting.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await opsApiFetch(`/api/ops/audit-cases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: notes.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit review");
      }
      const data = await res.json();
      setCaseData((prev) => (prev ? { ...prev, ...data.auditCase } : prev));
      setSuccessMsg(
        decision === "PASS"
          ? "Case approved. Attestation has been issued."
          : "Case rejected. Creative status set to REJECTED."
      );
      setDecision(null);
      setNotes("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <OpsShell>
        <div className="text-center py-20" style={{ color: "#64748b" }}>
          Loading case…
        </div>
      </OpsShell>
    );
  }
  if (!caseData) {
    return (
      <OpsShell>
        <div className="text-center py-20" style={{ color: "#f87171" }}>
          {error || "Case not found"}
        </div>
      </OpsShell>
    );
  }

  const thinking = isThinkingArray(caseData.agentThinking)
    ? (caseData.agentThinking as ThinkingStep[])
    : [];
  const resolved = Boolean(caseData.reviewerId);

  return (
    <OpsShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/ops/queue"
            className="text-xs"
            style={{ color: "#64748b" }}
          >
            ← Back to queue
          </Link>
          <h1 className="text-2xl font-bold mt-2" style={{ color: "#e2e8f0" }}>
            {caseData.creative?.creativeName || caseData.creativeId}
          </h1>
          <p className="text-sm" style={{ color: "#64748b" }}>
            {caseData.creative?.projectName} · submitted by{" "}
            <span style={{ color: "#94a3b8" }}>{caseData.advertiserName}</span>{" "}
            ({caseData.advertiserEmail})
          </p>
        </div>
        <div className="flex gap-2">
          <Badge label={`Status ${caseData.status}`} color="#67e8f9" bg="rgba(6,182,212,0.1)" />
          <Badge
            label={`Decision ${caseData.decision || "PENDING"}`}
            color={
              caseData.decision === "PASS"
                ? "#34d399"
                : caseData.decision === "REJECT"
                ? "#f87171"
                : "#facc15"
            }
            bg={
              caseData.decision === "PASS"
                ? "rgba(16,185,129,0.12)"
                : caseData.decision === "REJECT"
                ? "rgba(239,68,68,0.12)"
                : "rgba(234,179,8,0.12)"
            }
          />
          {caseData.riskScore != null && (
            <Badge
              label={`Risk ${Math.round(caseData.riskScore)}`}
              color={
                caseData.riskScore >= 70
                  ? "#f87171"
                  : caseData.riskScore >= 40
                  ? "#facc15"
                  : "#34d399"
              }
              bg="rgba(15,23,42,0.6)"
            />
          )}
        </div>
      </div>

      {resolved && caseData.reviewedAt && (
        <Card className="mb-5">
          <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>
            Prior reviewer
          </div>
          <div style={{ color: "#e2e8f0" }}>
            {caseData.reviewerName} decided{" "}
            <span
              style={{
                color: caseData.decision === "PASS" ? "#34d399" : "#f87171",
              }}
            >
              {caseData.decision}
            </span>{" "}
            on {new Date(caseData.reviewedAt).toLocaleString()}
          </div>
          {caseData.reviewNotes && (
            <div
              className="mt-2 p-3 rounded text-sm"
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                color: "#cbd5e1",
                borderLeft: "2px solid rgba(168, 85, 247, 0.4)",
              }}
            >
              {caseData.reviewNotes}
            </div>
          )}
        </Card>
      )}

      {successMsg && (
        <Card className="mb-5" borderColor="rgba(16, 185, 129, 0.3)">
          <div style={{ color: "#34d399" }}>{successMsg}</div>
        </Card>
      )}

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4 space-y-5">
          <Card>
            <SectionTitle>Creative</SectionTitle>
            {caseData.creative?.imageUrl ? (
              <img
                src={backendImage(caseData.creative.imageUrl) || undefined}
                alt="creative"
                className="w-full rounded-lg"
                style={{ border: "1px solid rgba(30,41,59,0.8)" }}
              />
            ) : (
              <div
                className="h-48 rounded-lg flex items-center justify-center"
                style={{
                  background: "rgba(15,23,42,0.4)",
                  color: "#475569",
                }}
              >
                No preview
              </div>
            )}
            <KV label="Creative ID" value={caseData.creativeId} mono />
            <KV label="Case ID" value={caseData.id} mono />
            <KV
              label="Submitted"
              value={new Date(caseData.submittedAt).toLocaleString()}
            />
            {caseData.completedAt && (
              <KV
                label="Completed"
                value={new Date(caseData.completedAt).toLocaleString()}
              />
            )}
          </Card>

          <Card>
            <SectionTitle>Decide</SectionTitle>
            <div className="flex gap-2 mb-3">
              <DecisionButton
                label="Approve (PASS)"
                color="#10b981"
                active={decision === "PASS"}
                onClick={() => setDecision("PASS")}
              />
              <DecisionButton
                label="Reject"
                color="#ef4444"
                active={decision === "REJECT"}
                onClick={() => setDecision("REJECT")}
              />
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                decision === "REJECT"
                  ? "Reason for rejection (required)…"
                  : "Optional notes for the audit log…"
              }
              rows={4}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "rgba(6, 10, 20, 0.6)",
                border: "1px solid rgba(30, 41, 59, 0.8)",
                color: "#e2e8f0",
              }}
            />
            {error && (
              <div
                className="mt-2 p-2 rounded text-xs"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                {error}
              </div>
            )}
            <button
              onClick={submitReview}
              disabled={!decision || submitting}
              className="w-full mt-3 py-2.5 rounded-lg text-sm font-semibold tracking-wide disabled:opacity-40 transition-all"
              style={{
                background:
                  decision === "REJECT"
                    ? "linear-gradient(135deg, #b91c1c, #ef4444)"
                    : "linear-gradient(135deg, #7c3aed, #a855f7)",
                color: "white",
                border:
                  "1px solid " +
                  (decision === "REJECT"
                    ? "rgba(239,68,68,0.4)"
                    : "rgba(168,85,247,0.4)"),
              }}
            >
              {submitting
                ? "SUBMITTING…"
                : resolved
                ? "SUBMIT OVERRIDE"
                : "SUBMIT DECISION"}
            </button>
            {resolved && (
              <p className="text-[10px] mt-2" style={{ color: "#64748b" }}>
                This case already has a review. Submitting will append a new log entry.
              </p>
            )}
          </Card>
        </div>

        <div className="col-span-8 space-y-5">
          <Card>
            <SectionTitle>Audit Summary</SectionTitle>
            <pre
              className="whitespace-pre-wrap text-sm"
              style={{ color: "#cbd5e1" }}
            >
              {caseData.summary || "—"}
            </pre>
          </Card>

          {caseData.evidences && caseData.evidences.length > 0 && (
            <Card>
              <SectionTitle>Evidence ({caseData.evidences.length})</SectionTitle>
              <div className="space-y-2">
                {caseData.evidences.map((ev) => (
                  <details
                    key={ev.id}
                    className="rounded-lg p-3"
                    style={{
                      background: "rgba(6, 10, 20, 0.5)",
                      border: "1px solid rgba(30, 41, 59, 0.6)",
                    }}
                  >
                    <summary className="cursor-pointer flex items-center justify-between">
                      <span style={{ color: "#e2e8f0" }}>{ev.toolName}</span>
                      <span className="text-[10px] font-mono" style={{ color: "#64748b" }}>
                        {new Date(ev.createdAt).toLocaleTimeString()}
                      </span>
                    </summary>
                    <pre
                      className="mt-2 text-xs overflow-auto"
                      style={{ color: "#94a3b8", maxHeight: 240 }}
                    >
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                    {Boolean(ev.riskSignals) && (
                      <pre
                        className="mt-1 text-xs"
                        style={{ color: "#facc15" }}
                      >
                        signals: {JSON.stringify(ev.riskSignals)}
                      </pre>
                    )}
                  </details>
                ))}
              </div>
            </Card>
          )}

          {thinking.length > 0 && (
            <Card>
              <SectionTitle>Agent Thinking ({thinking.length} turns)</SectionTitle>
              <div className="space-y-3 max-h-[500px] overflow-auto pr-2">
                {thinking.map((t, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg"
                    style={{
                      background:
                        t.role === "assistant"
                          ? "rgba(168, 85, 247, 0.06)"
                          : "rgba(6, 182, 212, 0.05)",
                      border:
                        "1px solid " +
                        (t.role === "assistant"
                          ? "rgba(168, 85, 247, 0.15)"
                          : "rgba(6, 182, 212, 0.1)"),
                    }}
                  >
                    <div
                      className="text-[10px] uppercase tracking-widest mb-1"
                      style={{ color: "#64748b" }}
                    >
                      Turn {t.turn} · {t.role}
                    </div>
                    {t.thinking && (
                      <pre
                        className="whitespace-pre-wrap text-xs italic mb-2"
                        style={{ color: "#94a3b8" }}
                      >
                        {t.thinking}
                      </pre>
                    )}
                    {t.text && (
                      <pre
                        className="whitespace-pre-wrap text-sm"
                        style={{ color: "#e2e8f0" }}
                      >
                        {t.text}
                      </pre>
                    )}
                    {t.toolCalls?.map((tc, j) => (
                      <div
                        key={j}
                        className="mt-2 p-2 rounded text-xs"
                        style={{
                          background: "rgba(6, 10, 20, 0.6)",
                          color: "#cbd5e1",
                        }}
                      >
                        <span style={{ color: "#67e8f9" }}>⇢ {tc.name}</span>
                        {tc.input && (
                          <pre style={{ color: "#94a3b8" }}>
                            {JSON.stringify(tc.input, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </OpsShell>
  );
}

function Card({
  children,
  className = "",
  borderColor = "rgba(30, 41, 59, 0.8)",
}: {
  children: React.ReactNode;
  className?: string;
  borderColor?: string;
}) {
  return (
    <div
      className={`rounded-xl p-5 ${className}`}
      style={{
        background: "rgba(15, 23, 42, 0.5)",
        border: `1px solid ${borderColor}`,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs uppercase tracking-widest mb-3"
      style={{ color: "#64748b" }}
    >
      {children}
    </h3>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-2 text-xs flex justify-between">
      <span style={{ color: "#64748b" }}>{label}</span>
      <span
        style={{
          color: "#cbd5e1",
          fontFamily: mono ? "monospace" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Badge({
  label,
  color,
  bg,
}: {
  label: string;
  color: string;
  bg: string;
}) {
  return (
    <span
      className="px-2.5 py-1 rounded text-[10px] uppercase tracking-wide font-mono"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function DecisionButton({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 py-2 rounded-lg text-xs tracking-wide transition-all"
      style={{
        background: active ? `${color}22` : "rgba(6, 10, 20, 0.5)",
        color: active ? color : "#94a3b8",
        border: `1px solid ${active ? color + "66" : "rgba(30, 41, 59, 0.8)"}`,
      }}
    >
      {label}
    </button>
  );
}
