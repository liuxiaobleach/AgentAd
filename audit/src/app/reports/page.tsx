"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface Bucket {
  hour: string;
  requests: number;
  wins: number;
  clicks: number;
  spend: number;
}

const WINDOWS = [
  { value: 6, label: "6H" },
  { value: 12, label: "12H" },
  { value: 24, label: "24H" },
  { value: 72, label: "3D" },
  { value: 168, label: "7D" },
];

export default function ReportsPage() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/reports/hourly?hours=${hours}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setBuckets(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hours]);

  const totalRequests = buckets.reduce((s, b) => s + b.requests, 0);
  const totalWins = buckets.reduce((s, b) => s + b.wins, 0);
  const totalClicks = buckets.reduce((s, b) => s + b.clicks, 0);
  const totalSpend = buckets.reduce((s, b) => s + b.spend, 0);
  const ctr = totalWins > 0 ? (totalClicks / totalWins) * 100 : 0;
  const winRate = totalRequests > 0 ? (totalWins / totalRequests) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Reports</h2>
          <p className="text-slate-500 mt-1">Hourly time-series of bid activity, clicks and spend.</p>
        </div>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(30,41,59,0.8)" }}>
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setHours(w.value)}
              className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all"
              style={{
                background: hours === w.value ? "linear-gradient(135deg, #0891b2, #06b6d4)" : "transparent",
                color: hours === w.value ? "white" : "#64748b",
                boxShadow: hours === w.value ? "0 0 15px rgba(6,182,212,0.3)" : "none",
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-6 gap-4 mb-8">
        <StatCard label="Requests" value={totalRequests.toString()} color="#06b6d4" />
        <StatCard label="Wins" value={totalWins.toString()} color="#10b981" />
        <StatCard label="Clicks" value={totalClicks.toString()} color="#f59e0b" />
        <StatCard label="Spend" value={`$${totalSpend.toFixed(2)}`} color="#ec4899" />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} color="#a855f7" />
        <StatCard label="CTR" value={`${ctr.toFixed(2)}%`} color="#22d3ee" />
      </div>

      <div className="space-y-6">
        <ChartCard
          title="Request Volume"
          subtitle="Number of auctions where your agents were asked to bid"
          data={buckets.map((b) => ({ hour: b.hour, value: b.requests }))}
          color="#06b6d4"
          loading={loading}
          yLabel="requests"
        />
        <ChartCard
          title="Clicks"
          subtitle="Impressions that were actually clicked (won + clicked)"
          data={buckets.map((b) => ({ hour: b.hour, value: b.clicks }))}
          color="#f59e0b"
          loading={loading}
          yLabel="clicks"
        />
        <ChartCard
          title="Spend"
          subtitle="Settlement price sum on winning bids"
          data={buckets.map((b) => ({ hour: b.hour, value: b.spend }))}
          color="#ec4899"
          loading={loading}
          yLabel="USD"
          isCurrency
        />
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
      <p className="text-xl font-bold mt-1" style={{ color, textShadow: `0 0 10px ${color}66` }}>{value}</p>
    </div>
  );
}

function ChartCard({
  title, subtitle, data, color, loading, yLabel, isCurrency,
}: {
  title: string;
  subtitle: string;
  data: { hour: string; value: number }[];
  color: string;
  loading: boolean;
  yLabel: string;
  isCurrency?: boolean;
}) {
  return (
    <div className="rounded-xl p-6" style={{
      background: "rgba(15,23,42,0.6)",
      border: "1px solid rgba(30,41,59,0.8)",
    }}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: "#e2e8f0" }}>{title}</h3>
        </div>
        <p className="text-xs mt-1" style={{ color: "#64748b" }}>{subtitle}</p>
      </div>
      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="inline-block w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: color, borderTopColor: "transparent" }} />
        </div>
      ) : (
        <BarChart data={data} color={color} yLabel={yLabel} isCurrency={isCurrency} />
      )}
    </div>
  );
}

function BarChart({
  data, color, yLabel, isCurrency,
}: {
  data: { hour: string; value: number }[];
  color: string;
  yLabel: string;
  isCurrency?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm" style={{ color: "#475569" }}>No data</div>;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const width = 100; // percent based
  const height = 180;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 30;
  const innerW = 1000 - padL - padR;
  const innerH = height - padT - padB;
  const barW = innerW / data.length;

  // Y-axis ticks (4 ticks)
  const niceMax = niceCeil(maxVal);
  const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];

  // X labels: show every Nth to avoid overlap
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  const fmtVal = (v: number) => (isCurrency ? `$${v.toFixed(2)}` : v.toString());
  const fmtHour = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:00`;
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 1000 ${height}`} className="w-full" style={{ overflow: "visible" }}>
        {/* Y grid lines + tick labels */}
        {ticks.map((t, i) => {
          const y = padT + innerH - (t / niceMax) * innerH;
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={padL + innerW}
                y1={y}
                y2={y}
                stroke="rgba(30,41,59,0.6)"
                strokeDasharray={i === 0 ? "" : "2 4"}
              />
              <text x={padL - 6} y={y + 3} fontSize="10" textAnchor="end" fill="#475569">
                {isCurrency ? `$${niceFmt(t)}` : niceFmt(t)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const barHeight = (d.value / niceMax) * innerH;
          const x = padL + i * barW + barW * 0.15;
          const y = padT + innerH - barHeight;
          const w = barW * 0.7;
          const isHover = hover === i;
          const hasValue = d.value > 0;

          return (
            <g key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Hover rect (full column for easier hover) */}
              <rect
                x={padL + i * barW}
                y={padT}
                width={barW}
                height={innerH}
                fill="transparent"
              />
              {hasValue && (
                <>
                  <defs>
                    <linearGradient id={`bar-grad-${color.replace("#", "")}-${i}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={isHover ? "1" : "0.9"} />
                      <stop offset="100%" stopColor={color} stopOpacity="0.3" />
                    </linearGradient>
                  </defs>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={barHeight}
                    rx="2"
                    fill={`url(#bar-grad-${color.replace("#", "")}-${i})`}
                    style={{ filter: isHover ? `drop-shadow(0 0 8px ${color})` : "none", transition: "filter 0.15s" }}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* X labels */}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          const x = padL + i * barW + barW / 2;
          return (
            <text
              key={i}
              x={x}
              y={height - 10}
              fontSize="9"
              textAnchor="middle"
              fill="#64748b"
            >
              {fmtHour(d.hour)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hover !== null && (
        <div
          className="absolute pointer-events-none px-3 py-2 rounded-lg text-xs"
          style={{
            left: `${(padL + hover * barW + barW / 2) / 10}%`,
            top: 0,
            transform: "translateX(-50%)",
            background: "rgba(6,11,22,0.95)",
            border: `1px solid ${color}`,
            boxShadow: `0 0 20px ${color}66`,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ color: "#64748b", fontSize: "10px" }}>{fmtHour(data[hover].hour)}</div>
          <div style={{ color, fontWeight: 700, marginTop: 2 }}>
            {fmtVal(data[hover].value)} <span style={{ color: "#475569", fontWeight: 400 }}>{yLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / mag;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function niceFmt(n: number): string {
  if (n === 0) return "0";
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
