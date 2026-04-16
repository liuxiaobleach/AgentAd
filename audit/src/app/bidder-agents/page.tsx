"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

export default function BidderAgentsPage() {
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    apiFetch("/api/bidder-agents").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setAgents(data);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-8">Bidder Agents</h2>

      <div className="space-y-4">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{agent.name}</h3>
                <span className="badge-verified mt-1">{agent.status}</span>
              </div>
              <Link
                href={`/bidder-agents/${agent.id}`}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Configure
              </Link>
            </div>

            <div className="grid grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Strategy</span>
                <p className="font-semibold text-slate-900 mt-1">{agent.strategy}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Value per Click</span>
                <p className="font-semibold text-slate-900 mt-1">${agent.valuePerClick}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Max Bid CPM</span>
                <p className="font-semibold text-slate-900 mt-1">${agent.maxBidCpm}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Strategy Prompt</span>
                <p className="font-medium text-slate-700 mt-1 text-xs line-clamp-2">
                  {agent.strategyPrompt || "Default"}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
