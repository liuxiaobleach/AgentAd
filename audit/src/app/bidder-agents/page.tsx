"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

type Agent = {
  id: string;
  name: string;
  strategy: string;
  strategyPrompt: string | null;
  valuePerClick: number;
  maxBidCpm: number;
  status: string;
  dailyBudgetAtomic: number;
  hourlyBudgetAtomic: number;
};

export default function BidderAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/bidder-agents");
      const data = await res.json();
      if (Array.isArray(data)) setAgents(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete agent "${name}"? Its bid history will be kept, but it will no longer participate in auctions.`)) {
      return;
    }
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/bidder-agents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Delete failed (${res.status})`);
        return;
      }
      await reload();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-slate-900">Bidder Agents</h2>
        <div className="flex gap-2">
          <Link
            href="/bidder-agents/library"
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
          >
            Strategy Library
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + New Agent
          </button>
        </div>
      </div>

      {agents.length === 0 && !loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <div className="text-slate-700 font-semibold mb-2">No Bidder Agents yet</div>
          <div className="text-sm text-slate-500 mb-4">
            An agent is your bidding "delegate" in auctions. Each advertiser can create multiple agents, each with a different strategy.
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Create your first agent
          </button>
        </div>
      )}

      <div className="space-y-4">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{agent.name}</h3>
                <span className="badge-verified mt-1">{agent.status}</span>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/bidder-agents/${agent.id}`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Configure
                </Link>
                <button
                  onClick={() => onDelete(agent.id, agent.name)}
                  disabled={deletingId === agent.id}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{
                    border: "1px solid rgba(239,68,68,0.35)",
                    color: "#f87171",
                    background: "rgba(239,68,68,0.08)",
                    opacity: deletingId === agent.id ? 0.5 : 1,
                    cursor: deletingId === agent.id ? "not-allowed" : "pointer",
                  }}
                >
                  {deletingId === agent.id ? "Deleting..." : "Delete"}
                </button>
              </div>
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

      {agents.length > 1 && (
        <div
          className="mt-4 rounded-lg px-4 py-3 text-xs"
          style={{
            background: "rgba(6,182,212,0.06)",
            border: "1px solid rgba(6,182,212,0.2)",
            color: "#94a3b8",
          }}
        >
          <strong style={{ color: "#22d3ee" }}>Multi-agent note:</strong>
          {" "}Multiple agents under the same advertiser evaluate and bid independently in each auction. To avoid self-competition inflating the clearing price,
          the system automatically picks the one with the <em>highest confidence</em> to represent you in final settlement; sibling bids are kept only as an audit trail.
        </div>
      )}

      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState("balanced");
  const [strategyPrompt, setStrategyPrompt] = useState("");
  const [valuePerClick, setValuePerClick] = useState("1.0");
  const [maxBidCpm, setMaxBidCpm] = useState("50");
  const [dailyBudgetUsdc, setDailyBudgetUsdc] = useState("10");
  const [hourlyBudgetUsdc, setHourlyBudgetUsdc] = useState("2");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    if (!n) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/bidder-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: n,
          strategy,
          strategyPrompt: strategyPrompt.trim(),
          valuePerClick: Number(valuePerClick) || 0,
          maxBidCpm: Number(maxBidCpm) || 0,
          dailyBudgetAtomic: Math.round((Number(dailyBudgetUsdc) || 0) * 1_000_000),
          hourlyBudgetAtomic: Math.round((Number(hourlyBudgetUsdc) || 0) * 1_000_000),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Create failed (${res.status})`);
      }
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 80px)",
          overflowY: "auto",
          background: "#0d1321",
          border: "1px solid rgba(6,182,212,0.25)",
          borderRadius: 12,
          padding: 20,
          color: "#e2e8f0",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>New Bidder Agent</h3>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "#64748b",
              fontSize: 20,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aggressive Growth Bot"
            maxLength={60}
            style={inputStyle}
          />
        </Field>

        <Field label="Strategy">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            style={inputStyle}
          >
            <option value="growth">growth (aggressive 1.2-1.5x)</option>
            <option value="balanced">balanced (balanced 0.9-1.1x)</option>
            <option value="conservative">conservative (conservative 0.6-0.8x)</option>
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Value per Click (USDC)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={valuePerClick}
              onChange={(e) => setValuePerClick(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Max Bid CPM (USDC)">
            <input
              type="number"
              step="0.1"
              min="0"
              value={maxBidCpm}
              onChange={(e) => setMaxBidCpm(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Daily Budget (USDC, 0 = unlimited)">
            <input
              type="number"
              step="1"
              min="0"
              value={dailyBudgetUsdc}
              onChange={(e) => setDailyBudgetUsdc(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Hourly Budget (USDC, 0 = unlimited)">
            <input
              type="number"
              step="0.5"
              min="0"
              value={hourlyBudgetUsdc}
              onChange={(e) => setHourlyBudgetUsdc(e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Strategy Prompt (optional, appended to the agent's system prompt)">
          <textarea
            value={strategyPrompt}
            onChange={(e) => setStrategyPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Bid aggressively only on defi / exchange sites; halve budget at night"
            style={{ ...inputStyle, resize: "vertical", minHeight: 80, fontFamily: "inherit" }}
            maxLength={2000}
          />
        </Field>

        {error && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.25)",
              background: "transparent",
              color: "#94a3b8",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 8,
              border: "1px solid rgba(6,182,212,0.4)",
              background: submitting
                ? "#1e293b"
                : "linear-gradient(135deg, #0891b2, #06b6d4)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || !name.trim() ? "not-allowed" : "pointer",
              opacity: submitting || !name.trim() ? 0.6 : 1,
            }}
          >
            {submitting ? "Creating..." : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.03em" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#070b14",
  border: "1px solid rgba(148,163,184,0.2)",
  borderRadius: 8,
  padding: "8px 10px",
  color: "#e2e8f0",
  fontSize: 13,
  outline: "none",
  width: "100%",
};
