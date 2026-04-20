"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import OpsShell from "@/components/OpsShell";
import { opsApiFetch, OpsReviewLog } from "@/lib/ops-api";

export default function OpsHistoryPage() {
  const [items, setItems] = useState<OpsReviewLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    opsApiFetch("/api/ops/audit-reviews?limit=200")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load history");
        return res.json();
      })
      .then((data) => !cancelled && setItems(data.items || []))
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <OpsShell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#e2e8f0" }}>
          My Reviews
        </h1>
        <p className="text-sm mt-1" style={{ color: "#64748b" }}>
          Every decision you've made on an audit case, newest first.
        </p>
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
              <th className="text-left px-5 py-3">When</th>
              <th className="text-left px-5 py-3">Creative</th>
              <th className="text-left px-5 py-3">Transition</th>
              <th className="text-left px-5 py-3">Notes</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center" style={{ color: "#475569" }}>
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center" style={{ color: "#475569" }}>
                  No reviews yet.
                </td>
              </tr>
            ) : (
              items.map((log) => (
                <tr
                  key={log.id}
                  className="border-t"
                  style={{ borderColor: "rgba(30, 41, 59, 0.6)" }}
                >
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: "#94a3b8" }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <div style={{ color: "#e2e8f0" }}>
                      {log.creativeName || log.auditCaseId}
                    </div>
                    <div
                      className="text-[10px] font-mono mt-0.5"
                      style={{ color: "#475569" }}
                    >
                      {log.projectName}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="text-[10px] font-mono"
                      style={{ color: "#64748b" }}
                    >
                      {log.previousDecision || "—"} →{" "}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wide ml-1"
                      style={{
                        background:
                          log.newDecision === "PASS"
                            ? "rgba(16,185,129,0.12)"
                            : "rgba(239,68,68,0.12)",
                        color: log.newDecision === "PASS" ? "#34d399" : "#f87171",
                      }}
                    >
                      {log.newDecision}
                    </span>
                  </td>
                  <td
                    className="px-5 py-3 text-xs"
                    style={{ color: "#cbd5e1", maxWidth: 320 }}
                  >
                    {log.notes ? (
                      <span className="line-clamp-2">{log.notes}</span>
                    ) : (
                      <span style={{ color: "#475569" }}>—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/ops/cases/${log.auditCaseId}`}
                      className="text-xs"
                      style={{ color: "#c084fc" }}
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </OpsShell>
  );
}
