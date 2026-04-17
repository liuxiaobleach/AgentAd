"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CreativesListPage() {
  const [creatives, setCreatives] = useState<any[]>([]);
  const [showGenModal, setShowGenModal] = useState(false);

  const load = () => {
    apiFetch("/api/creatives")
      .then((r) => r.json())
      .then(setCreatives)
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      DRAFT: "badge-pending",
      PENDING_AUDIT: "badge-pending",
      AUDITING: "badge-review",
      APPROVED: "badge-verified",
      REJECTED: "badge-rejected",
    };
    return map[status] || "badge-pending";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Creatives</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGenModal(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.9), rgba(236,72,153,0.9))",
              color: "white",
              boxShadow: "0 0 20px rgba(168,85,247,0.3)",
              border: "1px solid rgba(168,85,247,0.3)",
            }}
          >
            ✨ Generate with AI
          </button>
          <Link
            href="/creatives/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + New Creative
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Project</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Landing URL</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {creatives.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  No creatives yet.{" "}
                  <Link href="/creatives/new" className="text-blue-600 hover:underline">
                    Create one
                  </Link>
                </td>
              </tr>
            ) : (
              creatives.map((c: any) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <Link href={`/creatives/${c.id}`} className="font-medium text-blue-600 hover:underline">
                      {c.creativeName}
                    </Link>
                    {c.notes?.startsWith("[AI-generated]") && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(168,85,247,0.15)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)" }}>
                        AI
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{c.projectName}</td>
                  <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate">{c.landingUrl}</td>
                  <td className="px-6 py-4">
                    <span className={statusBadge(c.status)}>{c.status}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showGenModal && (
        <GenerateModal onClose={() => setShowGenModal(false)} onCreated={(id) => {
          setShowGenModal(false);
          load();
        }} />
      )}
    </div>
  );
}

function GenerateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [creativeName, setCreativeName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [styleHint, setStyleHint] = useState("cyberpunk");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [audiences, setAudiences] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(false);

  const [creativeId, setCreativeId] = useState<string | null>(null);
  const [phase, setPhase] = useState<string>("idle");
  const [steps, setSteps] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [billingUrl, setBillingUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function startGeneration() {
    if (!brief || !creativeName || !projectName || !landingUrl) {
      setError("Please fill in all required fields");
      return;
    }
    setError(null);
    setBillingUrl(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief,
          creativeName,
          projectName,
          landingUrl,
          styleHint,
          aspectRatio,
          targetAudiences: audiences.split(",").map((s) => s.trim()).filter(Boolean),
          autoSubmitAudit: autoSubmit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402 && data.billingUrl) {
          setBillingUrl(data.billingUrl);
        }
        setError(data.error || "Generation failed to start");
        setSubmitting(false);
        return;
      }
      setCreativeId(data.creativeId);
      setPhase("queued");
      pollStatus(data.creativeId);
    } catch (e: any) {
      setError(e.message || "Network error");
      setSubmitting(false);
    }
  }

  function pollStatus(id: string) {
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/creatives/${id}/generation-status`);
        const data = await res.json();
        setPhase(data.phase);
        setSteps(data.steps || []);
        if (data.phase === "completed" || data.phase === "failed") {
          clearInterval(timer);
          setSubmitting(false);
          if (data.phase === "failed") {
            setError(data.error || "Generation failed");
          }
        }
      } catch {}
    }, 2000);
    // Safety timeout
    setTimeout(() => clearInterval(timer), 360000);
  }

  const isRunning = submitting && phase !== "completed" && phase !== "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-auto rounded-2xl p-6" style={{
        background: "rgba(15,23,42,0.95)",
        border: "1px solid rgba(168,85,247,0.3)",
        boxShadow: "0 0 60px rgba(168,85,247,0.15)",
      }}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white text-xl">&#10005;</button>

        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">✨</span>
          <h3 className="text-lg font-bold" style={{ color: "#c084fc", textShadow: "0 0 10px rgba(168,85,247,0.5)" }}>
            Generate Ad with AI
          </h3>
        </div>
        <p className="text-xs mb-6" style={{ color: "#64748b" }}>
          Agent 会根据你的需求：解析 brief → 撰写图像 prompt → 调用图像模型 → 自动落地为 Creative
        </p>

        {!creativeId ? (
          <div className="space-y-4">
            <Field label="Brief (required)">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                placeholder="例如：推广一款 DeFi 借贷协议，主打高年化与链上透明度，面向有经验的 DeFi 用户"
                className="w-full px-3 py-2 rounded-lg text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Creative Name *">
                <input type="text" value={creativeName} onChange={(e) => setCreativeName(e.target.value)}
                  placeholder="Q2 DeFi Campaign" className="w-full px-3 py-2 rounded-lg text-sm" />
              </Field>
              <Field label="Project Name *">
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
                  placeholder="YieldLabs" className="w-full px-3 py-2 rounded-lg text-sm" />
              </Field>
            </div>

            <Field label="Landing URL *">
              <input type="url" value={landingUrl} onChange={(e) => setLandingUrl(e.target.value)}
                placeholder="https://yieldlabs.example" className="w-full px-3 py-2 rounded-lg text-sm" />
            </Field>

            <Field label="Target Audiences (comma-separated)">
              <input type="text" value={audiences} onChange={(e) => setAudiences(e.target.value)}
                placeholder="defi-trader, yield-farmer" className="w-full px-3 py-2 rounded-lg text-sm" />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Style Hint">
                <select value={styleHint} onChange={(e) => setStyleHint(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm">
                  <option value="cyberpunk">Cyberpunk</option>
                  <option value="minimalist">Minimalist</option>
                  <option value="corporate">Corporate</option>
                  <option value="playful">Playful</option>
                  <option value="luxurious">Luxurious</option>
                  <option value="bold">Bold / High Contrast</option>
                </select>
              </Field>
              <Field label="Aspect Ratio">
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm">
                  <option value="1:1">Square 1:1</option>
                  <option value="16:9">Landscape 16:9</option>
                  <option value="9:16">Portrait 9:16</option>
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#94a3b8" }}>
              <input type="checkbox" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)}
                className="w-4 h-4" style={{ accentColor: "#a855f7" }} />
              生成完成后自动提交审核
            </label>

            {error && (
              <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                <div>{error}</div>
                {billingUrl && (
                  <button
                    onClick={() => router.push(billingUrl)}
                    className="mt-2 underline"
                    style={{ color: "#f8fafc" }}
                  >
                    Open Billing
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg" style={{ color: "#94a3b8" }}>Cancel</button>
              <button
                onClick={startGeneration}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold rounded-lg"
                style={{
                  background: "linear-gradient(135deg, #a855f7, #ec4899)",
                  color: "white",
                  boxShadow: "0 0 20px rgba(168,85,247,0.4)",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Starting..." : "✨ Generate"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <PhaseTimeline phase={phase} steps={steps} />

            {phase === "completed" && (
              <div className="space-y-3 pt-2">
                <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}>
                  ✓ Generation complete! Your creative is ready.
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg" style={{ color: "#94a3b8" }}>Close</button>
                  <button
                    onClick={() => { onClose(); router.push(`/creatives/${creativeId}`); }}
                    className="px-5 py-2 text-sm font-semibold rounded-lg"
                    style={{
                      background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                      color: "white",
                      boxShadow: "0 0 20px rgba(6,182,212,0.4)",
                    }}
                  >
                    View Creative →
                  </button>
                </div>
              </div>
            )}

            {phase === "failed" && (
              <div className="p-3 rounded-lg text-sm mt-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                {error || "Generation failed"}
              </div>
            )}

            {isRunning && (
              <div className="flex items-center gap-2 text-sm" style={{ color: "#c084fc" }}>
                <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                正在处理，请稍候... (通常需要 15-60 秒)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "#64748b" }}>{label}</label>
      {children}
    </div>
  );
}

function PhaseTimeline({ phase, steps }: { phase: string; steps: any[] }) {
  const phases = [
    { key: "queued", label: "Queued" },
    { key: "brief", label: "Parsing Brief" },
    { key: "prompt", label: "Writing Image Prompt" },
    { key: "image", label: "Generating Image" },
    { key: "completed", label: "Done" },
  ];
  const currentIdx = phases.findIndex((p) => p.key === phase);

  return (
    <div>
      <div className="flex items-center gap-1 mb-4">
        {phases.map((p, i) => {
          const reached = i <= currentIdx;
          const active = i === currentIdx && phase !== "completed" && phase !== "failed";
          return (
            <div key={p.key} className="flex-1">
              <div className="flex items-center">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{
                    background: reached ? "linear-gradient(135deg, #a855f7, #ec4899)" : "rgba(30,41,59,0.8)",
                    color: reached ? "white" : "#475569",
                    boxShadow: active ? "0 0 12px rgba(168,85,247,0.6)" : "none",
                  }}>
                  {i + 1}
                </div>
                {i < phases.length - 1 && (
                  <div className="flex-1 h-0.5" style={{
                    background: i < currentIdx ? "rgba(168,85,247,0.6)" : "rgba(30,41,59,0.8)"
                  }} />
                )}
              </div>
              <div className="text-[10px] mt-1" style={{ color: reached ? "#c084fc" : "#475569" }}>
                {p.label}
              </div>
            </div>
          );
        })}
      </div>

      {steps.length > 0 && (
        <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(6,11,22,0.6)", border: "1px solid rgba(30,41,59,0.8)" }}>
          {steps.map((s, i) => (
            <div key={i} className="text-xs font-mono" style={{ color: "#94a3b8" }}>
              <span className="mr-2" style={{ color: "#c084fc" }}>[{s.phase}]</span>
              {s.message}
              {s.output && (
                <pre className="mt-1 pl-6 text-[10px] whitespace-pre-wrap" style={{ color: "#64748b" }}>
                  {s.output.length > 300 ? s.output.slice(0, 300) + "..." : s.output}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
