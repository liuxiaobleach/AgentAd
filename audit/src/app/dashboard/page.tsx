"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0, auditing: 0 });
  const [recentCases, setRecentCases] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    apiFetch("/api/creatives").then((r) => r.json()).then((creatives: any[]) => {
      if (!Array.isArray(creatives)) return;
      setStats({
        total: creatives.length,
        pending: creatives.filter((c) => c.status === "DRAFT" || c.status === "PENDING_AUDIT").length,
        approved: creatives.filter((c) => c.status === "APPROVED").length,
        rejected: creatives.filter((c) => c.status === "REJECTED").length,
        auditing: creatives.filter((c) => c.status === "AUDITING").length,
      });
    }).catch(() => {});

    apiFetch("/api/audit-cases").then((r) => r.json()).then((cases: any[]) => {
      if (Array.isArray(cases)) setRecentCases(cases.slice(0, 5));
    }).catch(() => {});

    apiFetch("/api/bidder-agents").then((r) => r.json()).then((a: any[]) => {
      if (Array.isArray(a)) setAgents(a);
    }).catch(() => {});
  }, []);

  const statCards = [
    { label: "Total Creatives", value: stats.total, color: "bg-blue-500" },
    { label: "Pending", value: stats.pending, color: "bg-yellow-500" },
    { label: "Approved", value: stats.approved, color: "bg-green-500" },
    { label: "Rejected", value: stats.rejected, color: "bg-red-500" },
    { label: "Auditing", value: stats.auditing, color: "bg-orange-500" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Dashboard</h2>
          {user && <p className="text-slate-500 mt-1">Welcome, {user.name}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/docs#advertiser-quickstart"
            className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-white transition-colors"
          >
            Open Guide
          </Link>
          <Link
            href="/creatives/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            + New Creative
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className={`w-2 h-2 rounded-full ${card.color} mb-3`} />
            <p className="text-2xl font-bold text-slate-900">{card.value}</p>
            <p className="text-sm text-slate-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Recent Audit Cases */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Recent Audit Cases</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {recentCases.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No audit cases yet.</div>
            ) : (
              recentCases.map((c: any) => (
                <Link key={c.id} href={`/audit-cases/${c.id}`}
                  className="flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="font-medium text-slate-900 text-sm">{c.creative?.creativeName || "Untitled"}</p>
                    <p className="text-xs text-slate-500">{c.creative?.projectName}</p>
                  </div>
                  <span className={c.decision === "PASS" ? "badge-verified" : c.decision === "REJECT" ? "badge-rejected" : "badge-review"}>
                    {c.decision || c.status}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Bidder Agents */}
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">My Bidder Agents</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {agents.length === 0 ? (
              <div className="px-6 py-8 text-center text-slate-400 text-sm">No agents configured.</div>
            ) : (
              agents.map((a: any) => (
                <Link key={a.id} href={`/bidder-agents/${a.id}`}
                  className="flex items-center justify-between px-6 py-3 hover:bg-slate-50 transition-colors">
                  <div>
                    <p className="font-medium text-slate-900 text-sm">{a.name}</p>
                    <p className="text-xs text-slate-500">Strategy: {a.strategy}</p>
                  </div>
                  <span className="badge-verified">{a.status}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
