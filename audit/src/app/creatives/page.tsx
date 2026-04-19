"use client";

import { apiFetch } from "@/lib/api";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CreativeListItem {
  id: string;
  creativeName: string;
  projectName: string;
  imageUrl?: string | null;
  landingUrl: string;
  notes?: string | null;
  status: string;
  createdAt: string;
}

interface GenerationStep {
  phase: string;
  message: string;
  output?: string;
}

const GENERATION_PHASES = [
  { key: "queued", label: "Queued", subtitle: "Reservation cleared" },
  { key: "brief", label: "Brief Parse", subtitle: "Intent extracted" },
  { key: "prompt", label: "Prompt Build", subtitle: "Visual system authored" },
  { key: "image", label: "Image Render", subtitle: "Model generating output" },
  { key: "completed", label: "Creative Ready", subtitle: "Asset stored" },
] as const;

const GENERATION_META: Record<
  string,
  { eyebrow: string; title: string; description: string; accent: string }
> = {
  idle: {
    eyebrow: "Ready",
    title: "Brief to visual launch pad",
    description: "Set the creative brief, style, and audience. The agent will turn it into a shippable asset.",
    accent: "#a855f7",
  },
  queued: {
    eyebrow: "Queued",
    title: "Generation run has started",
    description: "Budget reservation and agent kickoff succeeded. The run is waiting for its first structured step.",
    accent: "#8b5cf6",
  },
  brief: {
    eyebrow: "Parse",
    title: "Reading the campaign brief",
    description: "The agent is extracting promise, audience, and conversion angle from the prompt you provided.",
    accent: "#06b6d4",
  },
  prompt: {
    eyebrow: "Compose",
    title: "Writing the image system prompt",
    description: "The agent is shaping composition, style, copy emphasis, and CTA direction for the renderer.",
    accent: "#ec4899",
  },
  image: {
    eyebrow: "Render",
    title: "Generating the creative asset",
    description: "The image model is producing the final visual and the system is preparing the creative record.",
    accent: "#f59e0b",
  },
  completed: {
    eyebrow: "Done",
    title: "Creative is ready to review",
    description: "The asset has been created successfully and can now move into audit or deeper comparison.",
    accent: "#10b981",
  },
  failed: {
    eyebrow: "Failed",
    title: "Generation run needs attention",
    description: "The run stopped before completion. Review the error and restart after adjusting the brief or billing state.",
    accent: "#ef4444",
  },
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DRAFT: "badge-pending",
    PENDING_AUDIT: "badge-pending",
    AUDITING: "badge-review",
    APPROVED: "badge-verified",
    REJECTED: "badge-rejected",
  };
  return map[status] || "badge-pending";
}

function statusHint(status: string) {
  const hints: Record<string, string> = {
    DRAFT: "Ready for refinement",
    PENDING_AUDIT: "Waiting in queue",
    AUDITING: "Agent review running",
    APPROVED: "Eligible for bidding",
    REJECTED: "Needs revision",
  };
  return hints[status] || "Awaiting next action";
}

function isAIGenerated(creative: CreativeListItem) {
  return creative.notes?.startsWith("[AI-generated]") || false;
}

function summarizeOutput(text?: string, maxLength = 260) {
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

export default function CreativesListPage() {
  const [creatives, setCreatives] = useState<CreativeListItem[]>([]);
  const [showGenModal, setShowGenModal] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch("/api/creatives")
      .then((r) => r.json())
      .then((data: CreativeListItem[]) => {
        if (Array.isArray(data)) {
          setCreatives(data);
        } else {
          setCreatives([]);
        }
      })
      .catch(() => {
        setCreatives([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const totalCreatives = creatives.length;
  const approvedCreatives = creatives.filter((creative) => creative.status === "APPROVED").length;
  const reviewPipeline = creatives.filter((creative) => creative.status === "PENDING_AUDIT" || creative.status === "AUDITING").length;
  const aiGenerated = creatives.filter((creative) => isAIGenerated(creative)).length;

  return (
    <div className="space-y-6">
      <section
        className="rounded-[28px] px-6 py-7 fx-aurora-shell fx-grid-shell fx-enter-up"
        style={{
          background: "linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.92))",
          border: "1px solid rgba(71,85,105,0.35)",
        }}
      >
        <div className="grid xl:grid-cols-[1.2fr,0.8fr] grid-cols-1 gap-6 items-start">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] uppercase tracking-[0.28em] px-2.5 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-300">
                Creative Studio
              </span>
              <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Create • Compare • Ship</span>
            </div>
            <h2 className="text-3xl font-bold text-white leading-tight">Build and launch campaign-ready creatives from one runway.</h2>
            <p className="text-sm text-slate-400 mt-3 max-w-2xl leading-7">
              This page is now the top of the funnel: draft manually, generate with AI, compare in Creative Lab, then move the best asset into audit and bidding.
            </p>
            <div className="flex gap-3 mt-6">
              <Link
                href="/creative-lab"
                className="px-4 py-2.5 text-sm font-medium rounded-xl transition-all fx-hover-lift"
                style={{
                  background: "rgba(15,23,42,0.78)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(168,85,247,0.25)",
                }}
              >
                Open Creative Lab
              </Link>
              <button
                onClick={() => setShowGenModal(true)}
                className="px-4 py-2.5 text-sm font-medium rounded-xl transition-all fx-hover-lift"
                style={{
                  background: "linear-gradient(135deg, rgba(168,85,247,0.92), rgba(236,72,153,0.92))",
                  color: "white",
                  boxShadow: "0 0 20px rgba(168,85,247,0.3)",
                  border: "1px solid rgba(168,85,247,0.3)",
                }}
              >
                ✨ Generate with AI
              </button>
              <Link
                href="/creatives/new"
                className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors fx-hover-lift"
              >
                + New Creative
              </Link>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 grid-cols-1 gap-3">
            <SignalPanel
              label="Studio Health"
              title={approvedCreatives > 0 ? "Inventory ready to spend" : "Needs approved inventory"}
              body={approvedCreatives > 0
                ? `${approvedCreatives} approved creatives are currently available to bidder agents.`
                : "You do not have an approved creative yet. Use Generate with AI to quickly seed the pipeline."}
              accent="#10b981"
              delay={70}
            />
            <SignalPanel
              label="Review Pressure"
              title={reviewPipeline > 0 ? "Audit queue active" : "Queue is clear"}
              body={reviewPipeline > 0
                ? `${reviewPipeline} creatives are still moving through audit.`
                : "No creative is stuck in audit right now, which makes this a good moment to ship a new one."}
              accent="#06b6d4"
              delay={140}
            />
            <SignalPanel
              label="AI Throughput"
              title={aiGenerated > 0 ? "AI generation is in use" : "Manual-only so far"}
              body={aiGenerated > 0
                ? `${aiGenerated} creatives in this workspace were generated by the agent flow.`
                : "You have not generated an asset with AI yet. The modal now previews the full generation pipeline."}
              accent="#a855f7"
              delay={210}
            />
            <SignalPanel
              label="Creative Count"
              title={`${totalCreatives} assets in library`}
              body="Use the comparison lab to narrow down which version should earn the next audit slot."
              accent="#ec4899"
              delay={280}
            />
          </div>
        </div>
      </section>

      <div className="grid xl:grid-cols-4 sm:grid-cols-2 grid-cols-1 gap-4">
        <StudioStatCard label="Total Creatives" value={String(totalCreatives)} accent="#06b6d4" delay={0} />
        <StudioStatCard label="Approved" value={String(approvedCreatives)} accent="#10b981" delay={80} />
        <StudioStatCard label="In Audit" value={String(reviewPipeline)} accent="#f59e0b" delay={160} />
        <StudioStatCard label="AI Generated" value={String(aiGenerated)} accent="#a855f7" delay={240} />
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden fx-enter-up fx-hover-lift" style={{ animationDelay: "120ms" }}>
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Creative Inventory</h3>
            <p className="text-sm text-slate-500 mt-1">Review launch status, AI origin, and where each asset sits in the pipeline.</p>
          </div>
          <div className="text-xs text-slate-400">
            {loading ? "Refreshing..." : `${totalCreatives} creatives`}
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl p-4 border border-slate-200 bg-slate-50 fx-enter-up"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900/70 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 rounded-full bg-slate-900/70 animate-pulse max-w-[220px]" />
                    <div className="h-2 rounded-full bg-slate-900/60 animate-pulse max-w-[420px]" />
                  </div>
                  <div className="w-24 h-8 rounded-full bg-slate-900/60 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : creatives.length === 0 ? (
          <EmptyStudioState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Creative</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Project</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Landing URL</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Created</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-500 uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {creatives.map((creative, index) => (
                  <tr
                    key={creative.id}
                    className="hover:bg-slate-50 transition-colors fx-enter-up"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {creative.imageUrl ? (
                          <img src={creative.imageUrl} alt={creative.creativeName} className="w-14 h-14 object-cover rounded-2xl border border-slate-200" />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400">
                            Draft
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link href={`/creatives/${creative.id}`} className="font-medium text-blue-600 hover:underline">
                            {creative.creativeName}
                          </Link>
                          <div className="flex items-center gap-2 mt-1">
                            {isAIGenerated(creative) && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{
                                  background: "rgba(168,85,247,0.15)",
                                  color: "#c084fc",
                                  border: "1px solid rgba(168,85,247,0.3)",
                                }}
                              >
                                AI
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500">{statusHint(creative.status)}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{creative.projectName}</td>
                    <td className="px-6 py-4 text-sm text-slate-500 max-w-xs">
                      <a href={creative.landingUrl} target="_blank" rel="noreferrer" className="truncate block hover:text-cyan-300 transition-colors">
                        {creative.landingUrl}
                      </a>
                    </td>
                    <td className="px-6 py-4">
                      <span className={statusBadge(creative.status)}>{creative.status}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">{new Date(creative.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <Link href={`/creatives/${creative.id}`} className="text-blue-600 text-sm hover:underline">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showGenModal && (
        <GenerateModal
          onClose={() => setShowGenModal(false)}
          onCreated={() => {
            setShowGenModal(false);
            load();
          }}
        />
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
  const [steps, setSteps] = useState<GenerationStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [billingUrl, setBillingUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!creativeId || phase === "completed" || phase === "failed") {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/generation-status`);
        const data = await res.json();
        setPhase(data.phase);
        setSteps(Array.isArray(data.steps) ? data.steps : []);
        if (data.phase === "completed" || data.phase === "failed") {
          window.clearInterval(timer);
          setSubmitting(false);
          if (data.phase === "failed") {
            setError(data.error || "Generation failed");
          }
        }
      } catch {
        // Keep polling quietly while the run is still progressing.
      }
    }, 1800);

    const timeout = window.setTimeout(() => window.clearInterval(timer), 360000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [creativeId, phase]);

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
          targetAudiences: audiences.split(",").map((segment) => segment.trim()).filter(Boolean),
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
      setSteps([]);
    } catch (e: any) {
      setError(e.message || "Network error");
      setSubmitting(false);
    }
  }

  const currentMeta = GENERATION_META[phase] || GENERATION_META.idle;
  const isRunning = submitting && phase !== "completed" && phase !== "failed";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-[30px] overflow-hidden fx-aurora-shell fx-enter-up"
        style={{
          background: "rgba(15,23,42,0.96)",
          border: "1px solid rgba(168,85,247,0.28)",
          boxShadow: "0 0 60px rgba(168,85,247,0.14)",
        }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 text-slate-400 hover:text-white text-xl transition-colors">
          &#10005;
        </button>

        <div className="flex-shrink-0 p-4 sm:p-6 pb-0 flex lg:flex-row flex-col items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-[0.28em] px-2.5 py-1 rounded-full" style={{ background: `${currentMeta.accent}20`, color: currentMeta.accent }}>
                {currentMeta.eyebrow}
              </span>
              <span className="text-[10px] uppercase tracking-[0.24em]" style={{ color: "#64748b" }}>
                Agent Creative Generation
              </span>
            </div>
            <h3 className="text-2xl font-bold leading-tight" style={{ color: "#f8fafc" }}>
              {currentMeta.title}
            </h3>
            <p className="text-sm mt-2 max-w-2xl leading-7" style={{ color: "#94a3b8" }}>
              {currentMeta.description}
            </p>
          </div>

          <div className="rounded-2xl p-4 min-w-[220px] fx-hover-lift" style={{ background: "rgba(2,6,23,0.42)", border: "1px solid rgba(30,41,59,0.9)" }}>
            <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">Run Signals</div>
            <div className="space-y-2 text-sm">
              <MiniSignal label="Style" value={styleHint} accent="#a855f7" />
              <MiniSignal label="Aspect" value={aspectRatio} accent="#06b6d4" />
              <MiniSignal label="Audit" value={autoSubmit ? "Auto submit" : "Manual review later"} accent="#10b981" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-6 pt-4">

        {!creativeId ? (
          <>
            <div className="grid xl:grid-cols-[1.08fr,0.92fr] grid-cols-1 gap-6">
              <div className="space-y-4">
              <Field label="Brief (required)">
                <textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  rows={5}
                  placeholder="e.g. Promote a DeFi lending protocol with high APY and on-chain transparency, targeting experienced DeFi users"
                  className="w-full px-3 py-2 rounded-xl text-sm"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Creative Name *">
                  <input
                    type="text"
                    value={creativeName}
                    onChange={(e) => setCreativeName(e.target.value)}
                    placeholder="Q2 DeFi Campaign"
                    className="w-full px-3 py-2 rounded-xl text-sm"
                  />
                </Field>
                <Field label="Project Name *">
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="YieldLabs"
                    className="w-full px-3 py-2 rounded-xl text-sm"
                  />
                </Field>
              </div>

              <Field label="Landing URL *">
                <input
                  type="url"
                  value={landingUrl}
                  onChange={(e) => setLandingUrl(e.target.value)}
                  placeholder="https://yieldlabs.example"
                  className="w-full px-3 py-2 rounded-xl text-sm"
                />
              </Field>

              <Field label="Target Audiences (comma-separated)">
                <input
                  type="text"
                  value={audiences}
                  onChange={(e) => setAudiences(e.target.value)}
                  placeholder="defi-trader, yield-farmer"
                  className="w-full px-3 py-2 rounded-xl text-sm"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Style Hint">
                  <select value={styleHint} onChange={(e) => setStyleHint(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm">
                    <option value="cyberpunk">Cyberpunk</option>
                    <option value="minimalist">Minimalist</option>
                    <option value="corporate">Corporate</option>
                    <option value="playful">Playful</option>
                    <option value="luxurious">Luxurious</option>
                    <option value="bold">Bold / High Contrast</option>
                  </select>
                </Field>
                <Field label="Aspect Ratio">
                  <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full px-3 py-2 rounded-xl text-sm">
                    <option value="1:1">Square 1:1</option>
                    <option value="16:9">Landscape 16:9</option>
                    <option value="9:16">Portrait 9:16</option>
                  </select>
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "#94a3b8" }}>
                <input
                  type="checkbox"
                  checked={autoSubmit}
                  onChange={(e) => setAutoSubmit(e.target.checked)}
                  className="w-4 h-4"
                  style={{ accentColor: "#a855f7" }}
                />
                Auto-submit for audit after generation
              </label>

            </div>

            <div className="space-y-4">
              <GenerationBlueprint />
              <LiveBriefCard
                creativeName={creativeName}
                projectName={projectName}
                landingUrl={landingUrl}
                audiences={audiences}
                styleHint={styleHint}
                aspectRatio={aspectRatio}
              />
            </div>
            </div>
          </>
        ) : (
          <div className="grid xl:grid-cols-[1.12fr,0.88fr] grid-cols-1 gap-6">
            <div className="space-y-4">
              <div
                className="rounded-2xl p-5 fx-stage-reveal fx-scan-card"
                style={{
                  background: `${currentMeta.accent}16`,
                  border: `1px solid ${currentMeta.accent}2f`,
                  boxShadow: `0 0 30px ${currentMeta.accent}16`,
                }}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.28em]" style={{ color: currentMeta.accent }}>
                      Live Run
                    </div>
                    <div className="text-lg font-semibold text-white mt-2">
                      {creativeName || "Untitled creative"}
                    </div>
                    <div className="text-sm text-slate-300 mt-2 leading-7">{currentMeta.description}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-1">Status</div>
                    <div className="text-lg font-semibold" style={{ color: currentMeta.accent }}>
                      {phase}
                    </div>
                  </div>
                </div>
              </div>

              <PhaseTimeline phase={phase} steps={steps} />

              {phase === "completed" && (
                <div className="space-y-3 pt-2">
                  <div className="p-4 rounded-2xl text-sm fx-enter-up" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}>
                    ✓ Generation complete. The creative is now available in your library and ready for audit or lab comparison.
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        if (creativeId) {
                          onCreated(creativeId);
                        }
                      }}
                      className="px-4 py-2 text-sm rounded-lg"
                      style={{ color: "#94a3b8" }}
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        if (!creativeId) return;
                        onCreated(creativeId);
                        router.push(`/creatives/${creativeId}`);
                      }}
                      className="px-5 py-2.5 text-sm font-semibold rounded-xl fx-hover-lift"
                      style={{
                        background: "linear-gradient(135deg, #0891b2, #06b6d4)",
                        color: "white",
                        boxShadow: "0 0 20px rgba(6,182,212,0.35)",
                      }}
                    >
                      View Creative →
                    </button>
                  </div>
                </div>
              )}

              {phase === "failed" && (
                <div className="p-4 rounded-2xl text-sm mt-2" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                  {error || "Generation failed"}
                </div>
              )}

              {isRunning && (
                <div className="flex items-center gap-2 text-sm fx-enter-up" style={{ color: "#c084fc" }}>
                  <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  Processing, please wait... (usually 15-60 seconds)
                </div>
              )}
            </div>

            <div className="space-y-4">
              <RunSignalCard label="Creative" value={creativeName || "Waiting for name"} accent="#a855f7" />
              <RunSignalCard label="Project" value={projectName || "Waiting for project"} accent="#06b6d4" />
              <RunSignalCard label="Auto Audit" value={autoSubmit ? "Enabled" : "Disabled"} accent="#10b981" />
              <RunSignalCard
                label="Recent Log"
                value={steps.length > 0 ? summarizeOutput(steps[steps.length - 1]?.message, 90) : "No step emitted yet"}
                accent={currentMeta.accent}
                multiline
              />
              <LiveBriefCard
                creativeName={creativeName}
                projectName={projectName}
                landingUrl={landingUrl}
                audiences={audiences}
                styleHint={styleHint}
                aspectRatio={aspectRatio}
              />
            </div>
          </div>
        )}

        </div>

        {!creativeId && (
          <div
            className="flex-shrink-0 p-4 sm:p-6 pt-4 space-y-3"
            style={{
              background: "rgba(2,6,23,0.72)",
              borderTop: "1px solid rgba(168,85,247,0.22)",
              backdropFilter: "blur(8px)",
              borderBottomLeftRadius: "30px",
              borderBottomRightRadius: "30px",
            }}
          >
            {error && (
              <div className="p-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                <div>{error}</div>
                {billingUrl && (
                  <button onClick={() => router.push(billingUrl)} className="mt-2 underline" style={{ color: "#f8fafc" }}>
                    Open Billing
                  </button>
                )}
              </div>
            )}
            <div className="flex sm:flex-row flex-col items-center sm:justify-between justify-end gap-3">
              <div className="text-xs text-slate-400 sm:max-w-sm text-center sm:text-left">
                Ready to launch? Review the brief above, then submit this run to start AI generation.
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg" style={{ color: "#94a3b8" }}>
                  Cancel
                </button>
                <button
                  onClick={startGeneration}
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-semibold rounded-xl fx-hover-lift"
                  style={{
                    background: "linear-gradient(135deg, #a855f7, #ec4899)",
                    color: "white",
                    boxShadow: "0 0 20px rgba(168,85,247,0.35)",
                    opacity: submitting ? 0.5 : 1,
                  }}
                >
                  {submitting ? "Starting..." : "Submit Generation"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "#64748b" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function PhaseTimeline({ phase, steps }: { phase: string; steps: GenerationStep[] }) {
  const currentIdx = GENERATION_PHASES.findIndex((item) => item.key === phase);

  return (
    <div className="space-y-4">
      <div className="grid xl:grid-cols-5 md:grid-cols-3 sm:grid-cols-2 grid-cols-1 gap-3">
        {GENERATION_PHASES.map((item, index) => {
          const reached = currentIdx >= 0 ? index <= currentIdx : false;
          const active = index === currentIdx && phase !== "completed" && phase !== "failed";
          return (
            <div
              key={item.key}
              className={`rounded-2xl p-4 fx-enter-up ${active ? "fx-active-ring" : ""}`}
              style={{
                animationDelay: `${index * 70}ms`,
                background: reached ? "rgba(168,85,247,0.12)" : "rgba(2,6,23,0.34)",
                border: `1px solid ${reached ? "rgba(168,85,247,0.28)" : "rgba(30,41,59,0.85)"}`,
                color: reached ? "#f5d0fe" : "#64748b",
                boxShadow: active ? "0 0 24px rgba(168,85,247,0.18)" : "none",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold"
                  style={{
                    background: reached ? "linear-gradient(135deg, #a855f7, #ec4899)" : "rgba(30,41,59,0.9)",
                    color: reached ? "white" : "#475569",
                  }}
                >
                  {index + 1}
                </span>
                <span className="text-[10px] uppercase tracking-[0.24em]">{active ? "Live" : reached ? "Done" : "Pending"}</span>
              </div>
              <div className="text-sm font-medium mt-3">{item.label}</div>
              <div className="text-[11px] mt-1 leading-5" style={{ color: reached ? "#cbd5e1" : "#475569" }}>
                {item.subtitle}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl p-4 fx-scan-card" style={{ background: "rgba(6,11,22,0.65)", border: "1px solid rgba(30,41,59,0.85)" }}>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Run Log</div>
            <div className="text-sm text-slate-300 mt-1">Structured events emitted by the generation agent.</div>
          </div>
          <div className="text-xs text-slate-500">{steps.length} entries</div>
        </div>

        {steps.length === 0 ? (
          <div className="rounded-xl p-4 border border-slate-800 text-sm text-slate-500">
            Waiting for the first generation event...
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-auto pr-1">
            {steps.map((step, index) => (
              <div
                key={`${step.phase}-${index}`}
                className="rounded-xl p-3 border border-slate-800 bg-black/15 fx-enter-right"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-[0.24em]" style={{ color: "#c084fc" }}>
                    [{step.phase}]
                  </span>
                  <span className="text-xs text-slate-500">agent event</span>
                </div>
                <div className="text-sm text-slate-300 leading-6">{step.message}</div>
                {step.output && (
                  <div className="mt-2 text-[11px] text-slate-500 leading-5">
                    {summarizeOutput(step.output, 240)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StudioStatCard({ label, value, accent, delay }: { label: string; value: string; accent: string; delay?: number }) {
  return (
    <div
      className="rounded-2xl p-4 fx-enter-up fx-hover-lift"
      style={{
        animationDelay: `${delay || 0}ms`,
        background: "rgba(15,23,42,0.7)",
        border: `1px solid ${accent}22`,
        boxShadow: `0 0 24px ${accent}10`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">{label}</div>
      <div className="text-2xl font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function SignalPanel({
  label,
  title,
  body,
  accent,
  delay,
}: {
  label: string;
  title: string;
  body: string;
  accent: string;
  delay?: number;
}) {
  return (
    <div
      className="rounded-2xl p-4 fx-enter-up fx-hover-lift"
      style={{
        animationDelay: `${delay || 0}ms`,
        background: "rgba(2,6,23,0.42)",
        border: `1px solid ${accent}25`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: accent }}>
        {label}
      </div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs text-slate-400 mt-2 leading-6">{body}</div>
    </div>
  );
}

function EmptyStudioState() {
  return (
    <div className="p-10">
      <div className="rounded-[28px] p-8 text-center fx-aurora-shell fx-grid-shell" style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(30,41,59,0.9)" }}>
        <div className="text-[10px] uppercase tracking-[0.28em] text-fuchsia-400 mb-3">Creative Studio Empty</div>
        <h4 className="text-2xl font-semibold text-white">No creatives yet.</h4>
        <p className="text-sm text-slate-400 mt-3 max-w-xl mx-auto leading-7">
          Start with an AI-generated asset or upload one manually. Once the first creative exists, you can compare it in Creative Lab and push it into audit.
        </p>
        <div className="flex justify-center gap-3 mt-6">
          <Link href="/creatives/new" className="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
            Create Manually
          </Link>
          <Link href="/creative-lab" className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "rgba(168,85,247,0.14)", color: "#e9d5ff", border: "1px solid rgba(168,85,247,0.26)" }}>
            Open Lab
          </Link>
        </div>
      </div>
    </div>
  );
}

function GenerationBlueprint() {
  return (
    <div className="rounded-2xl p-5 fx-grid-shell fx-hover-lift" style={{ background: "rgba(2,6,23,0.42)", border: "1px solid rgba(30,41,59,0.85)" }}>
      <div className="text-[10px] uppercase tracking-[0.24em] text-fuchsia-400 mb-3">Generation Blueprint</div>
      <div className="space-y-3">
        {GENERATION_PHASES.map((item, index) => (
          <div
            key={item.key}
            className="rounded-xl px-4 py-3 border border-slate-800 bg-black/15 fx-enter-right"
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ background: "rgba(168,85,247,0.16)", color: "#d8b4fe" }}>
                {index + 1}
              </span>
              <div>
                <div className="text-sm font-medium text-white">{item.label}</div>
                <div className="text-xs text-slate-400 mt-1">{item.subtitle}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveBriefCard({
  creativeName,
  projectName,
  landingUrl,
  audiences,
  styleHint,
  aspectRatio,
}: {
  creativeName: string;
  projectName: string;
  landingUrl: string;
  audiences: string;
  styleHint: string;
  aspectRatio: string;
}) {
  const audienceList = audiences.split(",").map((item) => item.trim()).filter(Boolean);

  return (
    <div className="rounded-2xl p-5 fx-hover-lift" style={{ background: "rgba(2,6,23,0.42)", border: "1px solid rgba(30,41,59,0.85)" }}>
      <div className="text-[10px] uppercase tracking-[0.24em] text-cyan-400 mb-3">Live Brief Snapshot</div>
      <div className="space-y-3">
        <SnapshotRow label="Creative" value={creativeName || "Name not set"} />
        <SnapshotRow label="Project" value={projectName || "Project not set"} />
        <SnapshotRow label="Landing" value={landingUrl || "Landing URL not set"} />
        <SnapshotRow label="Style" value={styleHint} />
        <SnapshotRow label="Aspect" value={aspectRatio} />
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-2">Audience Signals</div>
          {audienceList.length === 0 ? (
            <div className="text-xs text-slate-500">No audience tags yet.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {audienceList.map((item) => (
                <span key={item} className="px-2.5 py-1 rounded-full text-xs" style={{ background: "rgba(6,182,212,0.12)", color: "#67e8f9", border: "1px solid rgba(6,182,212,0.18)" }}>
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2 bg-black/15 border border-slate-800">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-200 break-all">{value}</div>
    </div>
  );
}

function MiniSignal({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 bg-black/15 border border-slate-800">
      <span className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{label}</span>
      <span className="text-xs font-medium" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

function RunSignalCard({
  label,
  value,
  accent,
  multiline,
}: {
  label: string;
  value: string;
  accent: string;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-2xl p-4 fx-enter-right fx-hover-lift" style={{ background: "rgba(2,6,23,0.42)", border: `1px solid ${accent}22` }}>
      <div className="text-[10px] uppercase tracking-[0.24em] mb-2" style={{ color: accent }}>
        {label}
      </div>
      <div className={`text-sm text-slate-200 ${multiline ? "leading-7" : ""}`}>{value}</div>
    </div>
  );
}
