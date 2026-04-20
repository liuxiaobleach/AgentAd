"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import OpsShell from "@/components/OpsShell";
import { opsApiFetch, OpsAuditCase } from "@/lib/ops-api";

type Filter = "pending" | "resolved" | "all";

const filterLabels: Record<Filter, string> = {
  pending: "Pending",
  resolved: "Resolved",
  all: "All",
};

function decisionBadge(decision: string | null) {
  if (!decision) {
    return { bg: "rgba(100, 116, 139, 0.12)", color: "#94a3b8", label: "—" };
  }
  if (decision === "PASS") {
    return { bg: "rgba(16, 185, 129, 0.12)", color: "#34d399", label: "PASS" };
  }
  if (decision === "REJECT") {
    return { bg: "rgba(239, 68, 68, 0.12)", color: "#f87171", label: "REJECT" };
  }
  return {
    bg: "rgba(234, 179, 8, 0.12)",
    color: "#facc15",
    label: "MANUAL",
  };
}

function riskBadge(score: number | null) {
  if (score == null) return { bg: "rgba(71, 85, 105, 0.2)", color: "#94a3b8", label: "—" };
  if (score >= 70) return { bg: "rgba(239,68,68,0.12)", color: "#f87171", label: `${Math.round(score)}` };
  if (score >= 40) return { bg: "rgba(234,179,8,0.12)", color: "#facc15", label: `${Math.round(score)}` };
  return { bg: "rgba(16,185,129,0.12)", color: "#34d399", label: `${Math.round(score)}` };
}

export default function OpsQueuePage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [items, setItems] = useState<OpsAuditCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    opsApiFetch(`/api/ops/audit-queue?status=${filter}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load queue");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <OpsShell>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#e2e8f0" }}>
            Review Queue
          </h1>
          <p className="text-sm mt-1" style={{ color: "#64748b" }}>
            Audit cases flagged for human decision by the policy engine.
          </p>
        </div>
        <div className="flex gap-1.5">
          {(Object.keys(filterLabels) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-xs tracking-wide transition-all"
              style={{
                background:
                  filter === f ? "rgba(168,85,247,0.15)" : "rgba(15, 23, 42, 0.6)",
                color: filter === f ? "#c084fc" : "#64748b",
                border:
                  filter === f
                    ? "1px solid rgba(168, 85, 247, 0.3)"
                    : "1px solid rgba(30, 41, 59, 0.8)",
              }}
            >
              {filterLabels[f]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          className="p-4 rounded-lg text-sm mb-4"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "#f87171",
          }}
        >
          {error}
        </div>
      )}

      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(15, 23, 42, 0.5)",
          border: "1px solid rgba(30, 41, 59, 0.8)",
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "#475569", background: "rgba(6, 10, 20, 0.6)" }}
            >
              <th className="text-left px-5 py-3">Case</th>
              <th className="text-left px-5 py-3">Advertiser</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Decision</th>
              <th className="text-left px-5 py-3">Risk</th>
              <th className="text-left px-5 py-3">Reviewer</th>
              <th className="text-left px-5 py-3">Submitted</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center" style={{ color: "#475569" }}>
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center" style={{ color: "#475569" }}>
                  No cases in this bucket.
                </td>
              </tr>
            ) : (
              items.map((c) => {
                const db = decisionBadge(c.decision);
                const rb = riskBadge(c.riskScore);
                return (
                  <tr
                    key={c.id}
                    className="border-t"
                    style={{ borderColor: "rgba(30, 41, 59, 0.6)" }}
                  >
                    <td className="px-5 py-3">
                      <div className="font-semibold" style={{ color: "#e2e8f0" }}>
                        {c.creative?.creativeName || c.creativeId}
                      </div>
                      <div
                        className="text-[10px] font-mono mt-0.5"
                        style={{ color: "#475569" }}
                      >
                        {c.creative?.projectName}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div style={{ color: "#cbd5e1" }}>{c.advertiserName || "—"}</div>
                      <div className="text-[10px] font-mono" style={{ color: "#475569" }}>
                        {c.advertiserEmail}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wide"
                        style={{
                          background: "rgba(6, 182, 212, 0.1)",
                          color: "#67e8f9",
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wide"
                        style={{ background: db.bg, color: db.color }}
                      >
                        {db.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-mono"
                        style={{ background: rb.bg, color: rb.color }}
                      >
                        {rb.label}
                      </span>
                    </td>
                    <td className="px-5 py-3" style={{ color: "#94a3b8" }}>
                      {c.reviewerName || <span style={{ color: "#475569" }}>—</span>}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: "#64748b" }}>
                      {new Date(c.submittedAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/ops/cases/${c.id}`}
                        className="text-xs px-3 py-1.5 rounded-lg"
                        style={{
                          background: "rgba(168, 85, 247, 0.12)",
                          color: "#c084fc",
                          border: "1px solid rgba(168, 85, 247, 0.3)",
                        }}
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </OpsShell>
  );
}
