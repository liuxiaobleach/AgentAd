"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface BidRow {
  bidId: string;
  auctionId: string;
  slotId: string;
  slotType: string;
  size: string;
  floorCpm: number;
  siteCategory: string | null;
  userSegments: string[] | null;
  agentId: string;
  agentName: string;
  strategy: string;
  creativeId: string | null;
  creativeName: string | null;
  bidCpm: number | null;
  predictedCtr: number | null;
  confidence: number | null;
  reason: string | null;
  won: boolean;
  settlementPrice: number | null;
  clicked: boolean | null;
  bidCount: number;
  createdAt: string;
}

export default function AuctionsPage() {
  const [bids, setBids] = useState<BidRow[]>([]);
  const [running, setRunning] = useState(false);

  const load = () => {
    apiFetch("/api/auctions").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setBids(data);
    }).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  async function runSimulation() {
    setRunning(true);
    try {
      const res = await apiFetch("/api/simulation-runs", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const pollId = data.auctionRequestId;
        const poll = setInterval(() => {
          apiFetch(`/api/auctions/${pollId}`).then((r) => r.json()).then((ar) => {
            if (ar.result) {
              clearInterval(poll);
              setRunning(false);
              load();
            }
          });
        }, 2000);
        setTimeout(() => { clearInterval(poll); setRunning(false); load(); }, 120000);
      } else {
        alert(data.error || "Simulation failed");
        setRunning(false);
      }
    } catch {
      alert("Network error");
      setRunning(false);
    }
  }

  // Summary stats
  const totalBids = bids.length;
  const participated = bids.filter((b) => b.bidCpm != null).length;
  const wins = bids.filter((b) => b.won).length;
  const clicks = bids.filter((b) => b.won && b.clicked).length;
  const spend = bids
    .filter((b) => b.won && b.settlementPrice != null)
    .reduce((s, b) => s + (b.settlementPrice || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Bids</h2>
          <p className="text-slate-500 mt-1">All bids placed by your agents, including losing bids.</p>
        </div>
        <button
          onClick={runSimulation}
          disabled={running}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? "Running..." : "Run Simulation"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Bids" value={totalBids.toString()} color="#06b6d4" />
        <StatCard label="Participated" value={participated.toString()} color="#a855f7" />
        <StatCard label="Wins" value={wins.toString()} color="#10b981" />
        <StatCard label="Clicks" value={clicks.toString()} color="#f59e0b" />
        <StatCard label="Total Spend" value={`$${spend.toFixed(2)}`} color="#ec4899" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Agent</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Slot</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Category</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Floor</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Bid</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">pCTR</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Creative</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Result</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Settlement</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Click</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Time</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bids.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center text-slate-400">
                  No bids yet. Your agents will show up here as soon as they respond to an auction.
                </td>
              </tr>
            ) : (
              bids.map((b) => {
                const participated = b.bidCpm != null;
                const hasResult = b.settlementPrice != null || !participated;

                return (
                  <tr key={b.bidId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium" style={{ color: "#22d3ee" }}>{b.agentName}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{b.strategy}</div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-mono text-xs">{b.slotId}</div>
                      <div className="text-[10px] text-slate-400">{b.slotType}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{b.siteCategory || "-"}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">${b.floorCpm?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-sm">
                      {participated ? (
                        <span className="font-semibold" style={{ color: "#e2e8f0" }}>${b.bidCpm!.toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-500 text-xs italic">skipped</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {b.predictedCtr != null ? `${(b.predictedCtr * 100).toFixed(2)}%` : "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {b.creativeName ? (
                        <span className="text-slate-300">{b.creativeName}</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!participated ? (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(100,116,139,0.15)", color: "#94a3b8", border: "1px solid rgba(100,116,139,0.3)" }}>
                          No Bid
                        </span>
                      ) : b.won ? (
                        <span className="badge-verified">Won</span>
                      ) : hasResult ? (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                          Lost
                        </span>
                      ) : (
                        <span className="badge-pending">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {b.won && b.settlementPrice != null ? (
                        <span className="font-semibold" style={{ color: "#34d399" }}>${b.settlementPrice.toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {b.won && b.clicked ? (
                        <span className="badge-verified">Clicked</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Link href={`/auctions/${b.auctionId}`} className="text-blue-600 text-sm hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{
      background: "rgba(15,23,42,0.6)",
      border: `1px solid ${color}33`,
      boxShadow: `0 0 20px ${color}11`,
    }}>
      <p className="text-[10px] uppercase tracking-widest" style={{ color: "#64748b" }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color, textShadow: `0 0 10px ${color}66` }}>{value}</p>
    </div>
  );
}
