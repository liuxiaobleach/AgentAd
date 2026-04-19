"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface CreativeOption {
  id: string;
  creativeName: string;
  projectName: string;
  imageUrl?: string | null;
  status: string;
  createdAt: string;
}

interface CreativeProfile {
  marketingSummary?: string | null;
  visualTags?: string[];
  ctaType?: string | null;
  copyStyle?: string | null;
  targetAudiences?: string[];
  placementFit?: Record<string, unknown> | string[] | null;
  predictedCtrPriors?: Record<string, unknown> | null;
  bidHints?: Record<string, unknown> | null;
}

interface CreativeLabAudit {
  id: string;
  status: string;
  decision?: string | null;
  riskScore?: number | null;
  summary?: string | null;
  submittedAt: string;
}

interface CreativeLabItem {
  creative: CreativeOption & {
    landingUrl: string;
    placementDomains?: string[];
  };
  profile?: CreativeProfile | null;
  latestAudit?: CreativeLabAudit | null;
  stats: {
    impressions: number;
    clicks: number;
    ctr: number;
  };
  health: string;
}

interface CreativeLabResponse {
  items: CreativeLabItem[];
  generatedAt: string;
}

const statusPriority: Record<string, number> = {
  APPROVED: 0,
  AUDITING: 1,
  PENDING_AUDIT: 2,
  DRAFT: 3,
  REJECTED: 4,
};

function formatPercent(value?: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function getRiskValue(item: CreativeLabItem) {
  return item.latestAudit?.riskScore ?? 999;
}

function parsePlacementFit(value: CreativeProfile["placementFit"]): Array<[string, number | string]> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry): [string, number | string] | null => {
        if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          const label =
            typeof obj.slotType === "string" ? obj.slotType :
            typeof obj.slot === "string" ? obj.slot :
            typeof obj.label === "string" ? obj.label :
            typeof obj.name === "string" ? obj.name :
            null;
          const score =
            typeof obj.score === "number" ? obj.score :
            typeof obj.fit === "number" ? obj.fit :
            typeof obj.value === "number" ? obj.value :
            null;
          if (label !== null) return [label, score ?? "fit"];
          return null;
        }
        if (typeof entry === "string") return [entry, "fit"];
        return null;
      })
      .filter((entry): entry is [string, number | string] => entry !== null)
      .sort((left, right) => {
        const leftValue = typeof left[1] === "number" ? left[1] : 0;
        const rightValue = typeof right[1] === "number" ? right[1] : 0;
        return rightValue - leftValue;
      });
  }
  return Object.entries(value)
    .map(([key, raw]): [string, number | string] => {
      if (typeof raw === "number" || typeof raw === "string") return [key, raw];
      if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.score === "number") return [key, obj.score];
      }
      return [key, "fit"];
    })
    .sort((left, right) => {
      const leftValue = typeof left[1] === "number" ? left[1] : 0;
      const rightValue = typeof right[1] === "number" ? right[1] : 0;
      return rightValue - leftValue;
    });
}

function parseBidHints(value: CreativeProfile["bidHints"]): Array<[string, number | string]> {
  if (!value) return [];
  return Object.entries(value)
    .map(([key, raw]): [string, number | string] => {
      if (typeof raw === "number" || typeof raw === "string") return [key, raw];
      return [key, JSON.stringify(raw)];
    })
    .slice(0, 4);
}

function pickLabHighlights(items: CreativeLabItem[]) {
  if (items.length === 0) return [];

  const safest = [...items].sort((left, right) => getRiskValue(left) - getRiskValue(right))[0];
  const strongestCTR = [...items].sort((left, right) => right.stats.ctr - left.stats.ctr)[0];
  const bestReady = [...items].sort((left, right) => {
    const leftScore = (left.latestAudit?.decision === "PASS" ? 1000 : 0) - getRiskValue(left) + left.stats.ctr * 100;
    const rightScore = (right.latestAudit?.decision === "PASS" ? 1000 : 0) - getRiskValue(right) + right.stats.ctr * 100;
    return rightScore - leftScore;
  })[0];

  return [
    {
      label: "Safest",
      title: safest.creative.creativeName,
      detail: safest.latestAudit?.riskScore != null
        ? `Lowest observed risk score at ${safest.latestAudit.riskScore}.`
        : "This creative currently carries the least known policy risk.",
      accent: "#10b981",
    },
    {
      label: "Most Engaging",
      title: strongestCTR.creative.creativeName,
      detail: strongestCTR.stats.impressions > 0
        ? `Current CTR is ${formatPercent(strongestCTR.stats.ctr)} across ${strongestCTR.stats.impressions} impressions.`
        : "This one looks strongest on paper, but still needs live traffic.",
      accent: "#06b6d4",
    },
    {
      label: "Best Candidate",
      title: bestReady.creative.creativeName,
      detail: `${bestReady.health}. ${bestReady.latestAudit?.summary || "It balances audit readiness with performance upside."}`,
      accent: "#a855f7",
    },
  ];
}

export default function CreativeLabPage() {
  const [creatives, setCreatives] = useState<CreativeOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lab, setLab] = useState<CreativeLabResponse | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingLab, setLoadingLab] = useState(false);

  useEffect(() => {
    let stopped = false;
    setLoadingList(true);

    apiFetch("/api/creatives")
      .then((res) => res.json())
      .then((data: CreativeOption[]) => {
        if (stopped) return;
        const next = Array.isArray(data) ? data : [];
        setCreatives(next);
        if (selectedIds.length === 0 && next.length > 0) {
          const defaults = [...next]
            .sort((left, right) => {
              const statusDiff = (statusPriority[left.status] ?? 99) - (statusPriority[right.status] ?? 99);
              if (statusDiff !== 0) return statusDiff;
              return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
            })
            .slice(0, 3)
            .map((creative) => creative.id);
          setSelectedIds(defaults);
        }
      })
      .catch(() => {
        if (!stopped) {
          setCreatives([]);
        }
      })
      .finally(() => {
        if (!stopped) setLoadingList(false);
      });

    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setLab(null);
      return;
    }

    let stopped = false;
    setLoadingLab(true);
    apiFetch(`/api/creative-lab?ids=${selectedIds.join(",")}`)
      .then((res) => res.json())
      .then((data: CreativeLabResponse) => {
        if (!stopped) {
          setLab(data);
        }
      })
      .catch(() => {
        if (!stopped) {
          setLab({ items: [], generatedAt: new Date().toISOString() });
        }
      })
      .finally(() => {
        if (!stopped) setLoadingLab(false);
      });

    return () => {
      stopped = true;
    };
  }, [selectedIds]);

  function toggleCreative(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  }

  const items = lab?.items || [];
  const highlights = pickLabHighlights(items);
  const maxCTR = Math.max(0.01, ...items.map((item) => item.stats.ctr || 0));
  const maxImpressions = Math.max(1, ...items.map((item) => item.stats.impressions || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 fx-enter-up">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.28em] px-2 py-1 rounded-full bg-fuchsia-500/10 text-fuchsia-400">
              Creative Lab
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Compare • Diagnose • Prioritize</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Creative Lab</h2>
          <p className="text-slate-500 mt-1">
            Compare up to three creatives across audit readiness, audience fit, and live auction performance.
          </p>
        </div>
        <Link href="/creatives" className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
          Back to Creatives
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 fx-enter-up fx-hover-lift" style={{ animationDelay: "80ms" }}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Select Comparison Set</h3>
            <p className="text-sm text-slate-500 mt-1">Pick up to three creatives. If you choose a fourth, the oldest selection rotates out.</p>
          </div>
          <div className="text-xs text-slate-400">{selectedIds.length}/3 selected</div>
        </div>

        {loadingList ? (
          <div className="text-sm text-slate-400">Loading creative catalog...</div>
        ) : creatives.length === 0 ? (
          <div className="text-sm text-slate-400">No creatives found yet.</div>
        ) : (
          <div className="grid xl:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
            {creatives.map((creative) => {
              const selected = selectedIds.includes(creative.id);
              return (
                <button
                  key={creative.id}
                  onClick={() => toggleCreative(creative.id)}
                  className={`text-left rounded-2xl p-4 transition-all fx-enter-up fx-hover-lift ${selected ? "fx-active-ring" : ""}`}
                  style={{
                    animationDelay: `${creatives.indexOf(creative) * 70}ms`,
                    border: selected ? "1px solid rgba(168,85,247,0.45)" : "1px solid rgba(51,65,85,0.9)",
                    background: selected
                      ? "linear-gradient(135deg, rgba(168,85,247,0.14), rgba(76,29,149,0.08))"
                      : "linear-gradient(180deg, rgba(15,23,42,0.88), rgba(10,14,26,0.94))",
                    boxShadow: selected
                      ? "0 12px 30px rgba(168,85,247,0.08)"
                      : "0 12px 28px rgba(2,6,23,0.18)",
                    color: selected ? "#d946ef" : "#cbd5e1",
                  }}
                >
                  <div className="flex items-start gap-3">
                    {creative.imageUrl ? (
                      <img src={creative.imageUrl} alt={creative.creativeName} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                        No image
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-slate-900 truncate">{creative.creativeName}</div>
                        {selected && <span className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-500">Selected</span>}
                      </div>
                      <div className="text-sm text-slate-500 truncate mt-1">{creative.projectName}</div>
                      <div className="text-xs mt-2" style={{ color: selected ? "#a78bfa" : "#64748b" }}>{creative.status}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid xl:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        {highlights.map((highlight) => (
          <div
            key={highlight.label}
            className="rounded-2xl p-5 fx-aurora-shell fx-enter-up fx-hover-lift"
            style={{
              animationDelay: `${highlights.indexOf(highlight) * 100}ms`,
              background: "rgba(15,23,42,0.7)",
              border: `1px solid ${highlight.accent}25`,
              boxShadow: `0 0 24px ${highlight.accent}10`,
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.28em] mb-2" style={{ color: highlight.accent }}>
              {highlight.label}
            </div>
            <div className="text-lg font-semibold text-white">{highlight.title}</div>
            <p className="text-sm text-slate-400 mt-2 leading-6">{highlight.detail}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 fx-enter-up fx-hover-lift fx-grid-shell" style={{ animationDelay: "180ms" }}>
        <div className="flex items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Comparison Matrix</h3>
            <p className="text-sm text-slate-500 mt-1">Audit, profile, and performance signals on one board.</p>
          </div>
          {lab?.generatedAt && <div className="text-xs text-slate-400">Updated {new Date(lab.generatedAt).toLocaleString()}</div>}
        </div>

        {loadingLab ? (
          <div className="text-sm text-slate-400">Building comparison board...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-400">Choose at least one creative to start the lab.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 pr-4 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Metric</th>
                  {items.map((item) => (
                    <th key={item.creative.id} className="text-left py-3 px-3">
                      <div className="font-semibold text-slate-900">{item.creative.creativeName}</div>
                      <div className="text-xs text-slate-500 mt-1">{item.creative.projectName}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {[
                  { label: "Health", values: items.map((item) => item.health) },
                  { label: "Status", values: items.map((item) => item.creative.status) },
                  { label: "Audit Decision", values: items.map((item) => item.latestAudit?.decision || item.latestAudit?.status || "-") },
                  { label: "Risk Score", values: items.map((item) => item.latestAudit?.riskScore != null ? String(item.latestAudit.riskScore) : "-") },
                  { label: "CTR", values: items.map((item) => formatPercent(item.stats.ctr)) },
                  { label: "Impressions", values: items.map((item) => String(item.stats.impressions)) },
                  { label: "Clicks", values: items.map((item) => String(item.stats.clicks)) },
                  { label: "CTA Type", values: items.map((item) => item.profile?.ctaType || "-") },
                  { label: "Copy Style", values: items.map((item) => item.profile?.copyStyle || "-") },
                  { label: "Audiences", values: items.map((item) => item.profile?.targetAudiences?.join(", ") || "-") },
                ].map((row) => (
                  <tr key={row.label}>
                    <td className="py-3 pr-4 font-medium text-slate-600">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.label}-${index}`} className="py-3 px-3 text-slate-800 align-top">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid xl:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
        {items.map((item, index) => {
          const placementFit = parsePlacementFit(item.profile?.placementFit || null);
          const bidHints = parseBidHints(item.profile?.bidHints || null);
          const ctrRatio = Math.min(100, (item.stats.ctr / maxCTR) * 100);
          const impressionRatio = Math.min(100, (item.stats.impressions / maxImpressions) * 100);
          const riskRatio = item.latestAudit?.riskScore != null ? Math.max(10, 100 - item.latestAudit.riskScore) : 36;
          return (
            <div
              key={item.creative.id}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden fx-enter-up fx-hover-lift"
              style={{ animationDelay: `${index * 110}ms` }}
            >
              <div className="p-5 border-b border-slate-200">
                <div className="flex items-start gap-3">
                  {item.creative.imageUrl ? (
                    <img src={item.creative.imageUrl} alt={item.creative.creativeName} className="w-20 h-20 object-cover rounded-2xl border border-slate-200" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-slate-900 truncate">{item.creative.creativeName}</h3>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{item.creative.status}</span>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">{item.creative.projectName}</p>
                    <p className="text-sm mt-2" style={{ color: "#8b5cf6" }}>{item.health}</p>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid sm:grid-cols-3 grid-cols-1 gap-3">
                  <MetricTile label="CTR" value={formatPercent(item.stats.ctr)} ratio={ctrRatio} accent="#06b6d4" />
                  <MetricTile label="Impressions" value={String(item.stats.impressions)} ratio={impressionRatio} accent="#8b5cf6" />
                  <MetricTile label="Risk" value={item.latestAudit?.riskScore != null ? String(item.latestAudit.riskScore) : "-"} ratio={riskRatio} accent="#10b981" />
                </div>

                {item.profile?.marketingSummary && (
                  <div className="rounded-xl p-4 bg-slate-50 border border-slate-200">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">Marketing summary</div>
                    <p className="text-sm text-slate-700 leading-7">{item.profile.marketingSummary}</p>
                  </div>
                )}

                {item.profile?.visualTags && item.profile.visualTags.length > 0 && (
                  <TagGroup label="Visual tags" values={item.profile.visualTags} />
                )}

                {item.profile?.targetAudiences && item.profile.targetAudiences.length > 0 && (
                  <TagGroup label="Target audiences" values={item.profile.targetAudiences} />
                )}

                {placementFit.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">Placement fit</div>
                    <div className="space-y-2">
                      {placementFit.slice(0, 4).map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-slate-50 border border-slate-100 text-sm fx-hover-lift">
                          <span className="text-slate-700">{String(label)}</span>
                          <span className="text-slate-500">
                            {typeof value === "number" ? value.toFixed(2) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {bidHints.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">Bid hints</div>
                    <div className="space-y-2">
                      {bidHints.map(([label, value]) => (
                        <div key={String(label)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-slate-50 border border-slate-100 text-sm fx-hover-lift">
                          <span className="text-slate-700">{String(label)}</span>
                          <span className="text-slate-500">{typeof value === "number" ? value.toFixed(2) : String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {item.latestAudit?.summary && (
                  <div className="rounded-xl p-4 bg-emerald-50 border border-emerald-200">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-700 mb-2">Latest audit</div>
                    <p className="text-sm text-emerald-900 leading-7">{item.latestAudit.summary}</p>
                  </div>
                )}

                <div className="flex items-center gap-3 text-sm">
                  <Link href={`/creatives/${item.creative.id}`} className="text-blue-600 hover:underline">
                    View Creative
                  </Link>
                  {item.latestAudit?.id && (
                    <Link href={`/audit-cases/${item.latestAudit.id}`} className="text-fuchsia-600 hover:underline">
                      View Audit
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricTile({ label, value, ratio, accent }: { label: string; value: string; ratio?: number; accent?: string }) {
  return (
    <div className="rounded-xl p-3 bg-slate-50 border border-slate-100 fx-hover-lift">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
      {ratio != null && accent && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-900/60 overflow-hidden fx-meter">
          <div
            className="h-full rounded-full fx-meter-fill"
            style={{
              width: `${Math.max(0, Math.min(100, ratio))}%`,
              background: `linear-gradient(90deg, ${accent}, rgba(255,255,255,0.9))`,
            }}
          />
        </div>
      )}
    </div>
  );
}

function TagGroup({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.24em] text-slate-500 mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => (
          <span key={value} className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}
