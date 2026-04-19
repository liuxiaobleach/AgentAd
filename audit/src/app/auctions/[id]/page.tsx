"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

interface AuctionBid {
  id: string;
  bidderAgentId: string;
  selectedCreativeId?: string | null;
  predictedCtr?: number | null;
  bidCpm?: number | null;
  confidence?: number | null;
  reason?: string | null;
  createdAt: string;
  agentName?: string;
  creativeName?: string;
}

interface AuctionResult {
  winnerBidId?: string | null;
  settlementPrice?: number | null;
  shownCreativeId?: string | null;
  clicked: boolean;
  createdAt: string;
}

interface AuctionDetail {
  id: string;
  slotId: string;
  slotType: string;
  size: string;
  floorCpm: number;
  siteCategory?: string | null;
  userSegments?: string[];
  context?: Record<string, unknown> | null;
  createdAt: string;
  bids?: AuctionBid[];
  result?: AuctionResult | null;
}

interface ReplayStep {
  key: string;
  title: string;
  subtitle: string;
  body: string;
  metricLabel: string;
  metricValue: string;
  timestamp: string;
  accent: string;
  winner?: boolean;
}

function formatPercent(value?: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value?: number | null) {
  if (value == null) return "-";
  return `$${value.toFixed(2)}`;
}

function summarizeReason(reason?: string | null, fallback?: string) {
  if (!reason) return fallback || "The bidder returned a standard strategy response.";
  const normalized = reason.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function buildReplaySteps(auction: AuctionDetail) {
  const bids = [...(auction.bids || [])].sort((left, right) => {
    const timeDiff = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (right.bidCpm || 0) - (left.bidCpm || 0);
  });
  const winnerBid = bids.find((bid) => bid.id === auction.result?.winnerBidId);

  const steps: ReplayStep[] = [
    {
      key: "request",
      title: "Auction request received",
      subtitle: `${auction.slotType} inventory requested for ${auction.size}`,
      body: `The exchange opened bidding for slot ${auction.slotId} with a floor CPM of ${formatMoney(auction.floorCpm)}.`,
      metricLabel: "Floor CPM",
      metricValue: formatMoney(auction.floorCpm),
      timestamp: auction.createdAt,
      accent: "#06b6d4",
    },
  ];

  bids.forEach((bid) => {
    const participated = bid.bidCpm != null;
    steps.push({
      key: bid.id,
      title: participated ? `${bid.agentName} submitted a bid` : `${bid.agentName} held back`,
      subtitle: participated
        ? `${bid.creativeName || "Unnamed creative"} was evaluated for this slot`
        : "The bidder decided not to clear the opportunity",
      body: summarizeReason(
        bid.reason,
        participated
          ? "The bidder found enough value to participate and sent a priced response."
          : "The bidder skipped because the opportunity did not fit its strategy or constraints."
      ),
      metricLabel: participated ? "Bid CPM" : "Decision",
      metricValue: participated ? formatMoney(bid.bidCpm) : "No bid",
      timestamp: bid.createdAt,
      accent: participated ? "#6366f1" : "#64748b",
      winner: auction.result?.winnerBidId === bid.id,
    });
  });

  if (auction.result?.winnerBidId && winnerBid) {
    const runnerUp = bids
      .filter((bid) => bid.id !== winnerBid.id && bid.bidCpm != null)
      .sort((left, right) => (right.bidCpm || 0) - (left.bidCpm || 0))[0];
    const winGap = runnerUp?.bidCpm != null && winnerBid.bidCpm != null
      ? winnerBid.bidCpm - runnerUp.bidCpm
      : null;

    steps.push({
      key: "settlement",
      title: `${winnerBid.agentName} won the auction`,
      subtitle: `Winning creative: ${winnerBid.creativeName || auction.result.shownCreativeId || "Unknown"}`,
      body: winGap != null && winGap > 0
        ? `The winning bid cleared the floor and beat the nearest competitor by ${formatMoney(winGap)} CPM. Settlement happened at ${formatMoney(auction.result.settlementPrice)}.`
        : `The winning bid cleared the floor and converted into a settled impression at ${formatMoney(auction.result.settlementPrice)}.`,
      metricLabel: "Settlement",
      metricValue: formatMoney(auction.result.settlementPrice),
      timestamp: auction.result.createdAt,
      accent: "#10b981",
      winner: true,
    });
  } else if (auction.result) {
    steps.push({
      key: "no-fill",
      title: "Auction closed without a winner",
      subtitle: "No bid was able to clear this opportunity",
      body: "This request ended in a no-fill, usually because every agent skipped or all bids stayed below the floor.",
      metricLabel: "Outcome",
      metricValue: "No fill",
      timestamp: auction.result.createdAt,
      accent: "#f59e0b",
    });
  }

  if (auction.result?.clicked) {
    steps.push({
      key: "click",
      title: "Post-impression click recorded",
      subtitle: "The shown ad converted into a click",
      body: "The auction did not just win the impression. It also drove a click event after the creative was rendered.",
      metricLabel: "Result",
      metricValue: "Clicked",
      timestamp: auction.result.createdAt,
      accent: "#ec4899",
      winner: true,
    });
  }

  return { steps, winnerBid, bids };
}

function buildOutcomeNarrative(auction: AuctionDetail, bids: AuctionBid[], winnerBid?: AuctionBid) {
  if (!auction.result) {
    return {
      headline: "Auction still resolving",
      detail: "Bids are in flight. Once the settlement is written, this panel will explain the winning path.",
      bullets: ["Waiting for settlement event.", "Replay will update automatically while the page is open."],
    };
  }

  if (!winnerBid) {
    const highestBid = bids
      .filter((bid) => bid.bidCpm != null)
      .sort((left, right) => (right.bidCpm || 0) - (left.bidCpm || 0))[0];
    return {
      headline: "No winner for this auction",
      detail: highestBid?.bidCpm != null
        ? `The strongest submitted bid reached ${formatMoney(highestBid.bidCpm)}, which was not enough to clear the ${formatMoney(auction.floorCpm)} floor.`
        : "Every bidder skipped, so the exchange had nothing eligible to show.",
      bullets: [
        `${bids.filter((bid) => bid.bidCpm != null).length} participating bids`,
        `${bids.filter((bid) => bid.bidCpm == null).length} skipped responses`,
        "Consider lowering the floor or improving creative fit for this inventory type.",
      ],
    };
  }

  const runnerUp = bids
    .filter((bid) => bid.id !== winnerBid.id && bid.bidCpm != null)
    .sort((left, right) => (right.bidCpm || 0) - (left.bidCpm || 0))[0];
  const bullets = [
    `Winning bid: ${formatMoney(winnerBid.bidCpm)} vs floor ${formatMoney(auction.floorCpm)}`,
    winnerBid.predictedCtr != null
      ? `Predicted CTR landed at ${formatPercent(winnerBid.predictedCtr)}`
      : "The bid still won without a surfaced CTR prior",
    winnerBid.confidence != null
      ? `Model confidence reached ${(winnerBid.confidence * 100).toFixed(0)}%`
      : "No explicit confidence value was returned",
  ];

  if (runnerUp?.bidCpm != null && winnerBid.bidCpm != null) {
    bullets.push(`Runner-up gap: ${formatMoney(winnerBid.bidCpm - runnerUp.bidCpm)} over ${runnerUp.agentName}`);
  } else {
    bullets.push("No competing bid came close enough to force a narrow decision.");
  }

  if (auction.result.clicked) {
    bullets.push("The impression later converted into a click, reinforcing the win quality.");
  }

  return {
    headline: "Why this bid won",
    detail: summarizeReason(
      winnerBid.reason,
      `${winnerBid.agentName} paired ${winnerBid.creativeName || "the selected creative"} with enough bid strength to take the slot.`
    ),
    bullets,
  };
}

export default function AuctionDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [auction, setAuction] = useState<AuctionDetail | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!id) return;

    let stopped = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const res = await apiFetch(`/api/auctions/${id}`);
        const data = (await res.json()) as AuctionDetail;
        if (stopped) return;
        setAuction(data);
        if (!data.result) {
          timer = window.setTimeout(load, 2000);
        }
      } catch {
        if (!stopped) {
          timer = window.setTimeout(load, 3000);
        }
      }
    };

    load();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [id]);

  const replay = auction ? buildReplaySteps(auction) : null;

  useEffect(() => {
    setCurrentStep(0);
    setPlaying(false);
  }, [auction?.id, replay?.steps.length]);

  useEffect(() => {
    if (!playing || !replay || replay.steps.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= replay.steps.length - 1) {
          window.clearInterval(timer);
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 2400);

    return () => window.clearInterval(timer);
  }, [playing, replay]);

  if (!auction || !replay) {
    return <div className="text-center py-12 text-slate-400">Loading auction replay...</div>;
  }

  const activeStep = replay.steps[Math.min(currentStep, replay.steps.length - 1)];
  const winnerBid = replay.winnerBid;
  const outcome = buildOutcomeNarrative(auction, replay.bids, winnerBid);
  const progress = replay.steps.length > 1 ? (currentStep / (replay.steps.length - 1)) * 100 : 100;
  const maxBidValue = Math.max(auction.floorCpm, ...replay.bids.map((bid) => bid.bidCpm || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 fx-enter-up">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.28em] px-2 py-1 rounded-full bg-cyan-500/10 text-cyan-400">
              Auction Replay
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Why I Won</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Auction Detail</h2>
          <p className="text-slate-500 mt-1">
            {auction.slotId} • {auction.slotType} • {auction.size}
          </p>
        </div>
        <Link href="/auctions" className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
          Back to Bids
        </Link>
      </div>

      <div className="grid xl:grid-cols-4 sm:grid-cols-2 grid-cols-1 gap-4">
        <SummaryCard label="Floor CPM" value={formatMoney(auction.floorCpm)} accent="#06b6d4" delay={0} />
        <SummaryCard label="Winning Agent" value={winnerBid?.agentName || "No winner"} accent={winnerBid ? "#10b981" : "#f59e0b"} delay={90} />
        <SummaryCard label="Settlement" value={formatMoney(auction.result?.settlementPrice)} accent="#a855f7" delay={180} />
        <SummaryCard label="Click Result" value={auction.result?.clicked ? "Clicked" : auction.result ? "No click" : "Pending"} accent={auction.result?.clicked ? "#ec4899" : "#94a3b8"} delay={270} />
      </div>

      <div className="grid xl:grid-cols-[1.4fr,0.9fr] grid-cols-1 gap-6">
        <div
          className="rounded-2xl p-6 fx-aurora-shell fx-grid-shell fx-enter-left"
          style={{
            background: "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.94))",
            border: "1px solid rgba(71,85,105,0.35)",
          }}
        >
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h3 className="text-lg font-semibold text-white">Replay Timeline</h3>
              <p className="text-sm text-slate-400 mt-1">
                Walk through bidder participation, settlement, and post-impression outcome.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 0))}
                className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => {
                  if (currentStep >= replay.steps.length - 1) {
                    setCurrentStep(0);
                  }
                  setPlaying((prev) => !prev);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: activeStep.accent }}
              >
                {playing ? "Pause" : currentStep >= replay.steps.length - 1 ? "Replay" : "Play"}
              </button>
              <button
                onClick={() => setCurrentStep((prev) => Math.min(prev + 1, replay.steps.length - 1))}
                className="px-3 py-2 rounded-lg text-sm border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Next
              </button>
            </div>
          </div>

          <div className="h-2 rounded-full bg-slate-800 overflow-hidden mb-4 fx-progress-track">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${activeStep.accent}, rgba(255,255,255,0.9))` }}
            />
          </div>

          <div className="grid lg:grid-cols-4 sm:grid-cols-2 grid-cols-1 gap-2 mb-5">
            {replay.steps.map((step, index) => {
              const active = index === currentStep;
              const completed = index < currentStep;
              return (
                <button
                  key={`track-${step.key}`}
                  onClick={() => {
                    setCurrentStep(index);
                    setPlaying(false);
                  }}
                  className="rounded-xl px-3 py-2 text-left fx-enter-up"
                  style={{
                    animationDelay: `${index * 70}ms`,
                    background: active ? `${step.accent}20` : completed ? "rgba(15,23,42,0.72)" : "rgba(15,23,42,0.42)",
                    border: `1px solid ${active ? `${step.accent}45` : "rgba(71,85,105,0.22)"}`,
                    color: active ? step.accent : completed ? "#cbd5e1" : "#64748b",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${active ? "fx-active-ring" : ""}`}
                      style={{ background: active ? step.accent : completed ? "#94a3b8" : "#334155" }}
                    />
                    <span className="text-[11px] uppercase tracking-[0.22em]">{index + 1}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid xl:grid-cols-[1.2fr,0.8fr] grid-cols-1 gap-5">
            <div
              key={`${activeStep.key}-${currentStep}`}
              className="rounded-2xl p-5 fx-stage-reveal fx-scan-card"
              style={{
                background: `${activeStep.accent}18`,
                border: `1px solid ${activeStep.accent}33`,
                boxShadow: `0 18px 48px ${activeStep.accent}18`,
              }}
            >
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.26em]" style={{ color: activeStep.accent }}>
                    {activeStep.winner ? "Winning stage" : "Replay stage"}
                  </div>
                  <h4 className="text-xl font-semibold text-white mt-1">{activeStep.title}</h4>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{activeStep.metricLabel}</div>
                  <div className="text-lg font-semibold text-white mt-1">{activeStep.metricValue}</div>
                </div>
              </div>

              <div className="rounded-xl p-4 bg-black/20 border border-white/10 mb-4">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500 mb-2">Stage summary</div>
                <p className="text-sm text-slate-200 leading-7">{activeStep.subtitle}</p>
              </div>

              <div className="rounded-xl p-4 bg-white/5 border border-white/10">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500 mb-2">What happened</div>
                <p className="text-sm text-slate-300 leading-7">{activeStep.body}</p>
              </div>

              <div className="mt-4 text-xs text-slate-500">
                {new Date(activeStep.timestamp).toLocaleString()}
              </div>
            </div>

            <div className="space-y-3">
              {replay.steps.map((step, index) => {
                const isActive = index === currentStep;
                return (
                  <button
                    key={step.key}
                    onClick={() => {
                      setCurrentStep(index);
                      setPlaying(false);
                    }}
                    className={`w-full text-left rounded-xl p-4 transition-all fx-enter-right ${isActive ? "fx-hover-lift" : ""}`}
                    style={{
                      animationDelay: `${index * 90}ms`,
                      background: isActive ? `${step.accent}18` : "rgba(15,23,42,0.6)",
                      border: `1px solid ${isActive ? `${step.accent}33` : "rgba(71,85,105,0.28)"}`,
                      boxShadow: isActive ? `0 16px 36px ${step.accent}18` : "none",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm font-medium text-white">{step.title}</div>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                        style={{ background: isActive ? step.accent : "rgba(51,65,85,0.85)" }}
                      >
                        {index + 1}
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 leading-5">{step.subtitle}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 fx-enter-right fx-hover-lift" style={{ animationDelay: "120ms" }}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{outcome.headline}</h3>
                <p className="text-sm text-slate-500 mt-1">The key factors behind this auction result.</p>
              </div>
              {winnerBid && <span className="badge-verified">Winner</span>}
            </div>
            <div className="rounded-xl p-4 bg-slate-50 border border-slate-200 mb-4">
              <p className="text-sm text-slate-700 leading-7">{outcome.detail}</p>
            </div>
            <div className="space-y-2">
              {outcome.bullets.map((bullet) => (
                <div key={bullet} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-cyan-500 flex-shrink-0" />
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 fx-enter-right fx-hover-lift" style={{ animationDelay: "220ms" }}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Competitive Landscape</h3>
            <div className="space-y-3">
              {replay.bids.length === 0 ? (
                <p className="text-sm text-slate-400">Waiting for bidder responses...</p>
              ) : (
                replay.bids
                  .sort((left, right) => (right.bidCpm || -1) - (left.bidCpm || -1))
                  .map((bid) => {
                    const isWinner = bid.id === auction.result?.winnerBidId;
                    return (
                      <div
                        key={bid.id}
                        className="rounded-xl p-4 border fx-enter-up fx-hover-lift"
                        style={{
                          animationDelay: `${replay.bids.indexOf(bid) * 90}ms`,
                          borderColor: isWinner ? "rgba(16,185,129,0.28)" : "rgba(226,232,240,1)",
                          background: isWinner ? "rgba(16,185,129,0.06)" : "white",
                        }}
                      >
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div>
                            <div className="font-medium text-slate-900">{bid.agentName}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{bid.creativeName || "No creative selected"}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-slate-900">
                              {bid.bidCpm != null ? formatMoney(bid.bidCpm) : "No bid"}
                            </div>
                            {isWinner && <span className="badge-verified">Won</span>}
                          </div>
                        </div>
                        <div className="grid md:grid-cols-3 grid-cols-1 gap-3 text-xs">
                          <div className="rounded-lg p-3 bg-slate-50">
                            <div className="text-slate-500 uppercase tracking-wide mb-1">pCTR</div>
                            <div className="font-medium text-slate-800">{formatPercent(bid.predictedCtr)}</div>
                          </div>
                          <div className="rounded-lg p-3 bg-slate-50">
                            <div className="text-slate-500 uppercase tracking-wide mb-1">Confidence</div>
                            <div className="font-medium text-slate-800">
                              {bid.confidence != null ? `${(bid.confidence * 100).toFixed(0)}%` : "-"}
                            </div>
                          </div>
                          <div className="rounded-lg p-3 bg-slate-50">
                            <div className="text-slate-500 uppercase tracking-wide mb-1">Decision</div>
                            <div className="font-medium text-slate-800">{bid.bidCpm != null ? "Participated" : "Skipped"}</div>
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">
                            <span>Bid strength</span>
                            <span>{bid.bidCpm != null ? `${Math.round(((bid.bidCpm || 0) / maxBidValue) * 100)}% of max` : "0%"}</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-900/60 overflow-hidden fx-meter">
                            <div
                              className="h-full rounded-full fx-meter-fill"
                              style={{
                                width: `${bid.bidCpm != null ? ((bid.bidCpm || 0) / maxBidValue) * 100 : 0}%`,
                                background: isWinner
                                  ? "linear-gradient(90deg, rgba(16,185,129,0.95), rgba(110,231,183,0.92))"
                                  : "linear-gradient(90deg, rgba(99,102,241,0.95), rgba(129,140,248,0.92))",
                              }}
                            />
                          </div>
                        </div>
                        {bid.reason && (
                          <div className="mt-3 text-xs leading-6 text-slate-500">
                            {summarizeReason(bid.reason, "")}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 fx-enter-right fx-hover-lift" style={{ animationDelay: "320ms" }}>
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Auction Context</h3>
            <div className="grid sm:grid-cols-2 grid-cols-1 gap-3 text-sm">
              <ContextMetric label="Site Category" value={auction.siteCategory || "-"} />
              <ContextMetric label="User Segments" value={auction.userSegments?.length ? auction.userSegments.join(", ") : "-"} />
              <ContextMetric label="Slot Type" value={auction.slotType} />
              <ContextMetric label="Slot Size" value={auction.size} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, delay }: { label: string; value: string; accent: string; delay?: number }) {
  return (
    <div
      className="rounded-xl p-4 fx-enter-up fx-hover-lift"
      style={{
        animationDelay: `${delay || 0}ms`,
        background: "rgba(15,23,42,0.72)",
        border: `1px solid ${accent}22`,
        boxShadow: `0 0 20px ${accent}10`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.25em] text-slate-500 mb-2">{label}</div>
      <div className="text-lg font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3 bg-slate-50 border border-slate-100 fx-hover-lift">
      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-800 leading-6">{value}</div>
    </div>
  );
}
