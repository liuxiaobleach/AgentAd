"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface Finding {
  category: string;
  finding: string;
  impact: string;
}
interface Recommendation {
  priority: string;
  action: string;
  rationale: string;
  expectedImpact: string;
}
interface CreativeInsight {
  creativeName: string;
  assessment: string;
  suggestion: string;
}
interface AnalysisResult {
  overallAssessment: string;
  performanceScore: number;
  keyFindings: Finding[];
  recommendations: Recommendation[];
  creativeInsights: CreativeInsight[];
  strategyAdvice: string;
}

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-green-100 text-green-700",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  win_rate: "Win Rate",
  ctr: "CTR",
  cost: "Cost",
  creative: "Creative",
  strategy: "Strategy",
};

type StrategyTone = {
  label: string;
  neon: string; // border + text color
  glow: string; // box-shadow color
  dot: string; // leading status dot color
};

const STRATEGY_TONES: Record<string, StrategyTone> = {
  growth: {
    label: "GROWTH",
    neon: "#f472b6",
    glow: "rgba(244, 114, 182, 0.45)",
    dot: "#ec4899",
  },
  balanced: {
    label: "BALANCED",
    neon: "#22d3ee",
    glow: "rgba(34, 211, 238, 0.45)",
    dot: "#06b6d4",
  },
  conservative: {
    label: "CONSERVATIVE",
    neon: "#34d399",
    glow: "rgba(52, 211, 153, 0.4)",
    dot: "#10b981",
  },
  ctr_optimizer: {
    label: "CTR-OPTIMIZER",
    neon: "#fbbf24",
    glow: "rgba(251, 191, 36, 0.4)",
    dot: "#f59e0b",
  },
  audience_first: {
    label: "AUDIENCE-FIRST",
    neon: "#c084fc",
    glow: "rgba(192, 132, 252, 0.45)",
    dot: "#a855f7",
  },
  custom: {
    label: "CUSTOM",
    neon: "#94a3b8",
    glow: "rgba(148, 163, 184, 0.35)",
    dot: "#64748b",
  },
};

function strategyTone(strategy: string): StrategyTone {
  return (
    STRATEGY_TONES[strategy] || {
      label: strategy.toUpperCase().replace(/_/g, "-"),
      neon: "#94a3b8",
      glow: "rgba(148, 163, 184, 0.35)",
      dot: "#64748b",
    }
  );
}

function StrategyChip({ strategy }: { strategy: string }) {
  const t = strategyTone(strategy);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm font-mono text-[10px] tracking-[0.12em]"
      style={{
        background: "linear-gradient(135deg, #0d1321 0%, #070b14 100%)",
        border: `1px solid ${t.neon}`,
        color: t.neon,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 0 10px ${t.glow}, inset 0 0 8px rgba(0,0,0,0.6)`,
        textShadow: `0 0 6px ${t.glow}`,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: t.dot, boxShadow: `0 0 6px ${t.dot}` }}
      />
      {t.label}
    </span>
  );
}

export default function AnalystPage() {
  const [stats, setStats] = useState<any>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/analyst/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  async function runAnalysis() {
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const res = await apiFetch("/api/analyst/analyze", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      } else {
        const err = await res.json();
        setError(err.error || "Analysis failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setAnalyzing(false);
    }
  }

  const agentStats = stats?.agentStats || [];
  const creativeStats = stats?.creativeStats || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Ad Analyst</h2>
          <p className="text-slate-500 mt-1">AI-powered analysis of your bidding performance</p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {analyzing ? "Analyzing..." : "Run Analysis"}
        </button>
      </div>

      {/* Raw Stats Overview */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Agent Stats */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Agent Performance</h3>
          {agentStats.length === 0 ? (
            <p className="text-sm text-slate-400">No auction data yet. Run some simulations first.</p>
          ) : (
            <div className="space-y-3">
              {agentStats.map((a: any) => (
                <div key={a.agentId} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-slate-900">{a.agentName}</span>
                    <StrategyChip strategy={a.strategy} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">Bids</span>
                      <p className="font-semibold text-slate-800">{a.totalBids}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Win Rate</span>
                      <p className="font-semibold text-slate-800">{(a.winRate * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <span className="text-slate-400">CTR</span>
                      <p className="font-semibold text-slate-800">{(a.ctr * 100).toFixed(2)}%</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Spend</span>
                      <p className="font-semibold text-slate-800">${a.totalSpend.toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Creative Stats */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-4">Creative Performance</h3>
          {creativeStats.length === 0 ? (
            <p className="text-sm text-slate-400">No creative data yet.</p>
          ) : (
            <div className="space-y-3">
              {creativeStats.map((c: any) => (
                <div key={c.creativeId} className="p-3 bg-slate-50 rounded-lg">
                  <div className="font-medium text-sm text-slate-900 mb-2">{c.creativeName}</div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-slate-400">Selected</span>
                      <p className="font-semibold text-slate-800">{c.timesSelected}x</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Wins</span>
                      <p className="font-semibold text-slate-800">{c.wins}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">Impressions</span>
                      <p className="font-semibold text-slate-800">{c.impressions}</p>
                    </div>
                    <div>
                      <span className="text-slate-400">CTR</span>
                      <p className="font-semibold text-slate-800">{(c.ctr * 100).toFixed(2)}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Analysis Loading */}
      {analyzing && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-500 text-sm">Analyst Agent is reviewing your performance data...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-6">
          {/* Overall Assessment */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-900">Overall Assessment</h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{analysis.overallAssessment}</p>
              </div>
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold ${
                analysis.performanceScore >= 70 ? "bg-green-100 text-green-700" :
                analysis.performanceScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}>
                {analysis.performanceScore}
              </div>
            </div>
          </div>

          {/* Key Findings */}
          {analysis.keyFindings.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Key Findings</h3>
              <div className="space-y-2">
                {analysis.keyFindings.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${IMPACT_COLORS[f.impact] || "bg-slate-100 text-slate-600"}`}>
                      {f.impact}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium text-slate-500 uppercase">
                          {CATEGORY_LABELS[f.category] || f.category}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800">{f.finding}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {analysis.recommendations.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Optimization Recommendations</h3>
              <div className="space-y-3">
                {analysis.recommendations.map((r, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[r.priority] || "bg-slate-400"}`} />
                      <span className="text-sm font-semibold text-slate-800">{r.action}</span>
                      <span className="text-xs text-slate-400 ml-auto">{r.priority} priority</span>
                    </div>
                    <div className="px-4 py-3 space-y-2 text-sm">
                      <div>
                        <span className="text-slate-500 font-medium">Rationale: </span>
                        <span className="text-slate-700">{r.rationale}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium">Expected Impact: </span>
                        <span className="text-slate-700">{r.expectedImpact}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Creative Insights */}
          {analysis.creativeInsights.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Creative Insights</h3>
              <div className="space-y-3">
                {analysis.creativeInsights.map((c, i) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-lg">
                    <div className="font-medium text-sm text-slate-900 mb-2">{c.creativeName}</div>
                    <div className="space-y-1 text-sm">
                      <p className="text-slate-600"><span className="text-slate-500 font-medium">Assessment:</span> {c.assessment}</p>
                      <p className="text-blue-700"><span className="text-slate-500 font-medium">Suggestion:</span> {c.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Advice */}
          {analysis.strategyAdvice && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
              <h3 className="font-semibold text-blue-900 mb-3">Strategy Configuration Advice</h3>
              <p className="text-sm text-blue-800 leading-relaxed whitespace-pre-wrap">{analysis.strategyAdvice}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
