"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { apiFetch } from "@/lib/api";
import type { BrandKit } from "@/components/BrandKitManager";

type GenerationStep = {
  phase: string;
  message: string;
  output?: string;
};

type StudioRun = {
  id: string;
  title: string;
  brief: string;
  baseCreativeName: string;
  projectName: string;
  landingUrl: string;
  targetAudiences: string[];
  styleHint: string;
  aspectRatio: string;
  variantCount: number;
  autoSubmitAudit: boolean;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  createdAt: string;
};

type StudioRunItem = {
  id: string;
  creativeId: string;
  creativeName: string;
  imageUrl?: string | null;
  creativeStatus: string;
  variantIndex: number;
  variantLabel: string;
  variantAngle: string;
  phase: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  error?: string | null;
  latestMessage?: string;
};

type StudioRunDetail = {
  run: StudioRun;
  brandKit?: BrandKit | null;
  items: StudioRunItem[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
  readyCreativeIds: string[];
};

const STYLES = [
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "minimalist", label: "Minimalist" },
  { value: "corporate", label: "Corporate" },
  { value: "playful", label: "Playful" },
  { value: "luxurious", label: "Luxurious" },
  { value: "bold", label: "Bold / High Contrast" },
];

const RATIOS = [
  { value: "1:1", label: "Square 1:1" },
  { value: "16:9", label: "Landscape 16:9" },
  { value: "9:16", label: "Portrait 9:16" },
];

export default function CreativeStudioModal({
  brandKits,
  onClose,
  onChanged,
}: {
  brandKits: BrandKit[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const defaultKit = brandKits.find((kit) => kit.isDefault) || brandKits[0] || null;

  const [runTitle, setRunTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [creativeName, setCreativeName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [landingUrl, setLandingUrl] = useState("");
  const [styleHint, setStyleHint] = useState("cyberpunk");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [audiences, setAudiences] = useState("");
  const [variantCount, setVariantCount] = useState(3);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [brandKitId, setBrandKitId] = useState<string>(defaultKit?.id || "");

  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudioRunDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingUrl, setBillingUrl] = useState<string | null>(null);

  const selectedKit = useMemo(
    () => brandKits.find((kit) => kit.id === brandKitId) || null,
    [brandKitId, brandKits]
  );

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    async function load() {
      try {
        const res = await apiFetch(`/api/creative-studio/runs/${runId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to load studio run");
        }
        if (!cancelled) {
          setDetail(data);
          if (data.run?.status === "COMPLETED" || data.run?.status === "FAILED" || data.run?.status === "PARTIAL") {
            setSubmitting(false);
            onChanged();
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load studio run");
          setSubmitting(false);
        }
      }
    }

    load();
    const timer = window.setInterval(load, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runId, onChanged]);

  async function startRun() {
    if (!brief || !creativeName || !projectName || !landingUrl) {
      setError("Please fill in all required fields");
      return;
    }

    setSubmitting(true);
    setError(null);
    setBillingUrl(null);

    try {
      const res = await apiFetch("/api/creative-studio/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runTitle,
          brief,
          creativeName,
          projectName,
          landingUrl,
          styleHint,
          aspectRatio,
          variantCount,
          targetAudiences: audiences.split(",").map((entry) => entry.trim()).filter(Boolean),
          autoSubmitAudit: autoSubmit,
          brandKitId: brandKitId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402 && data.billingUrl) {
          setBillingUrl(data.billingUrl);
        }
        throw new Error(data.error || "Failed to start studio run");
      }
      setRunId(data.runId);
      onChanged();
    } catch (err: any) {
      setSubmitting(false);
      setError(err?.message || "Failed to start studio run");
    }
  }

  const readyIds = detail?.readyCreativeIds || [];
  const canOpenLab = readyIds.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
    >
      <div
        className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-[30px] overflow-hidden"
        style={{
          background: "rgba(15,23,42,0.96)",
          border: "1px solid rgba(168,85,247,0.28)",
          boxShadow: "0 0 60px rgba(168,85,247,0.14)",
        }}
      >
        <button onClick={onClose} className="absolute top-4 right-4 z-10 text-slate-400 hover:text-white text-xl">
          &#10005;
        </button>

        <div className="p-6 border-b border-white/10">
          <div className="flex lg:flex-row flex-col items-start justify-between gap-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-fuchsia-400 mb-2">Batch Creative Studio</div>
              <h3 className="text-2xl font-bold text-white leading-tight">
                Generate a branded variant set, then move the winners into Creative Lab.
              </h3>
              <p className="text-sm text-slate-400 mt-2 max-w-3xl leading-7">
                This workflow takes one brief, applies an optional Brand Kit, and produces up to four creative angles so you can compare them side by side before audit or scale.
              </p>
            </div>
            <div className="rounded-2xl p-4 min-w-[260px]" style={{ background: "rgba(2,6,23,0.45)", border: "1px solid rgba(30,41,59,0.85)" }}>
              <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">Studio Signals</div>
              <Signal label="Variants" value={`${variantCount}`} accent="#a855f7" />
              <Signal label="Brand Kit" value={selectedKit?.name || "None"} accent="#06b6d4" />
              <Signal label="Audit" value={autoSubmit ? "Auto submit" : "Manual later"} accent="#10b981" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!runId ? (
            <div className="grid xl:grid-cols-[1.08fr,0.92fr] grid-cols-1 gap-6">
              <div className="space-y-4">
                <Field label="Studio Run Name">
                  <input
                    value={runTitle}
                    onChange={(e) => setRunTitle(e.target.value)}
                    placeholder="Q2 Growth Variants"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <Field label="Brief (required)">
                  <textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    rows={5}
                    placeholder="e.g. Promote a DeFi protocol focused on transparent yield and audited infrastructure for advanced on-chain users."
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <div className="grid md:grid-cols-2 grid-cols-1 gap-4">
                  <Field label="Base Creative Name *">
                    <input
                      value={creativeName}
                      onChange={(e) => setCreativeName(e.target.value)}
                      placeholder="YieldLabs Launch Set"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                  <Field label="Project Name *">
                    <input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="YieldLabs"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                </div>

                <Field label="Landing URL *">
                  <input
                    value={landingUrl}
                    onChange={(e) => setLandingUrl(e.target.value)}
                    placeholder="https://yieldlabs.example"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <Field label="Target Audiences">
                  <input
                    value={audiences}
                    onChange={(e) => setAudiences(e.target.value)}
                    placeholder="defi-trader, on-chain builder, yield-farmer"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <div className="grid md:grid-cols-3 grid-cols-1 gap-4">
                  <Field label="Style Hint">
                    <select
                      value={styleHint}
                      onChange={(e) => setStyleHint(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    >
                      {STYLES.map((style) => (
                        <option key={style.value} value={style.value}>
                          {style.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Aspect Ratio">
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    >
                      {RATIOS.map((ratio) => (
                        <option key={ratio.value} value={ratio.value}>
                          {ratio.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Variant Count">
                    <select
                      value={variantCount}
                      onChange={(e) => setVariantCount(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    >
                      <option value={1}>1 variant</option>
                      <option value={2}>2 variants</option>
                      <option value={3}>3 variants</option>
                      <option value={4}>4 variants</option>
                    </select>
                  </Field>
                </div>

                <Field label="Brand Kit">
                  <select
                    value={brandKitId}
                    onChange={(e) => setBrandKitId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  >
                    <option value="">No brand kit</option>
                    {brandKits.map((kit) => (
                      <option key={kit.id} value={kit.id}>
                        {kit.name}{kit.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={autoSubmit}
                    onChange={(e) => setAutoSubmit(e.target.checked)}
                    style={{ accentColor: "#a855f7" }}
                  />
                  Auto-submit each generated variant for audit
                </label>
              </div>

              <div className="space-y-4">
                <Panel title="Variant Plan" eyebrow="Batch Logic">
                  <div className="space-y-3">
                    {Array.from({ length: variantCount }).map((_, index) => {
                      const variant = [
                        "Hero promise first",
                        "Trust and proof angle",
                        "Conversion push angle",
                        "Clean premium minimal angle",
                      ][index];
                      return (
                        <div key={index} className="rounded-2xl border border-slate-800 bg-slate-950/45 px-4 py-3">
                          <div className="text-xs font-semibold text-white">Variant {String.fromCharCode(65 + index)}</div>
                          <div className="text-sm text-slate-400 mt-1">{variant}</div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>

                <Panel title="Brand Kit Lens" eyebrow="Consistency">
                  {selectedKit ? (
                    <div className="space-y-3 text-sm text-slate-300">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">Tone</div>
                        <div>{selectedKit.voiceTone || "Not specified"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">Primary Message</div>
                        <div>{selectedKit.primaryMessage || "Not specified"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">Palette</div>
                        <div>{selectedKit.colorPalette?.length ? selectedKit.colorPalette.join(", ") : "No palette specified"}</div>
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-1">Required Terms</div>
                        <div>{selectedKit.mandatoryTerms?.length ? selectedKit.mandatoryTerms.join(", ") : "None"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400 leading-7">
                      No Brand Kit is attached. The batch will still generate multiple angles, but visual and copy consistency will rely entirely on the free-form brief.
                    </div>
                  )}
                </Panel>

                <Panel title="Why this matters" eyebrow="Studio Outcome">
                  <div className="text-sm text-slate-400 leading-7">
                    The batch run writes each output into your creative library, then gives you a direct path into Creative Lab for side-by-side comparison before audit or bidding.
                  </div>
                </Panel>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid lg:grid-cols-[1.1fr,0.9fr] grid-cols-1 gap-6">
                <Panel title={detail?.run.title || "Studio run in progress"} eyebrow="Run Status">
                  <div className="grid sm:grid-cols-4 grid-cols-2 gap-3">
                    <Metric label="Total" value={String(detail?.totalCount || 0)} accent="#a855f7" />
                    <Metric label="Ready" value={String(detail?.completedCount || 0)} accent="#10b981" />
                    <Metric label="Failed" value={String(detail?.failedCount || 0)} accent="#ef4444" />
                    <Metric label="Status" value={detail?.run.status || "RUNNING"} accent="#06b6d4" />
                  </div>
                  <div className="mt-4 text-sm text-slate-400 leading-7">
                    {detail?.brandKit
                      ? `Running with brand kit "${detail.brandKit.name}". As soon as one or more variants complete, you can open the full set in Creative Lab.`
                      : "Running without a brand kit. Variants will still separate angles, but brand consistency depends on the brief alone."}
                  </div>
                </Panel>

                <Panel title="Creative Lab Handoff" eyebrow="Next Step">
                  <div className="text-sm text-slate-400 leading-7">
                    Use Creative Lab to compare audit readiness, performance priors, and creative positioning across the completed outputs in this batch.
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => canOpenLab && router.push(`/creative-lab?runId=${runId}`)}
                      disabled={!canOpenLab}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg, #0891b2, #06b6d4)" }}
                    >
                      Open in Creative Lab
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-700 text-slate-300 hover:bg-white/5"
                    >
                      Close
                    </button>
                  </div>
                </Panel>
              </div>

              <div className="grid xl:grid-cols-2 grid-cols-1 gap-4">
                {(detail?.items || []).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[24px] border border-slate-800 bg-slate-950/40 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-2">{item.variantLabel}</div>
                        <div className="text-lg font-semibold text-white">{item.creativeName}</div>
                        <div className="text-sm text-slate-400 mt-2 leading-7">{item.variantAngle}</div>
                      </div>
                      <span
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                        style={{
                          background:
                            item.status === "COMPLETED"
                              ? "rgba(16,185,129,0.12)"
                              : item.status === "FAILED"
                              ? "rgba(239,68,68,0.12)"
                              : "rgba(6,182,212,0.12)",
                          color:
                            item.status === "COMPLETED"
                              ? "#34d399"
                              : item.status === "FAILED"
                              ? "#f87171"
                              : "#22d3ee",
                        }}
                      >
                        {item.phase}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-[88px,1fr] gap-4 items-start">
                      <div className="w-[88px] h-[88px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/70 flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.creativeName} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Pending</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest</div>
                        <div className="text-sm text-slate-300 leading-7">
                          {item.latestMessage || item.error || "Waiting for the next generation step..."}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 pt-1">
                          <span>Status: {item.creativeStatus || "DRAFT"}</span>
                          {item.status === "COMPLETED" && (
                            <button
                              onClick={() => router.push(`/creatives/${item.creativeId}`)}
                              className="text-cyan-300 hover:underline"
                            >
                              Open Creative
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!runId && (
          <div className="p-6 border-t border-white/10 bg-slate-950/60">
            {error && (
              <div className="p-3 rounded-xl text-sm mb-3" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}>
                <div>{error}</div>
                {billingUrl && (
                  <button onClick={() => router.push(billingUrl)} className="mt-2 underline" style={{ color: "#f8fafc" }}>
                    Open Billing
                  </button>
                )}
              </div>
            )}
            <div className="flex sm:flex-row flex-col items-center justify-between gap-3">
              <div className="text-xs text-slate-400 sm:max-w-md text-center sm:text-left">
                Launch one brief into a structured variant set. When the run completes, jump straight into Creative Lab for comparison.
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-300 border border-slate-700 hover:bg-white/5">
                  Cancel
                </button>
                <button
                  onClick={startRun}
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-semibold rounded-xl text-white disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, #a855f7, #ec4899)",
                    boxShadow: "0 0 20px rgba(168,85,247,0.35)",
                  }}
                >
                  {submitting ? "Starting..." : "Launch Batch Studio"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-400 mb-2">{label}</div>
      {children}
    </label>
  );
}

function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
      <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">{eyebrow}</div>
      <h4 className="text-lg font-semibold text-white">{title}</h4>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Signal({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-medium" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: `${accent}33`, background: `${accent}12` }}>
      <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: accent }}>
        {label}
      </div>
      <div className="text-lg font-semibold text-white mt-2">{value}</div>
    </div>
  );
}
