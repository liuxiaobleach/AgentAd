"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export type StrategyTemplate = {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
  valuePerClick?: number | null;
  maxBidCpm?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  icon: string;
  description: string;
  promptSnippet: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LibraryKind = "templates" | "skills";
export type LibraryMode = "manage" | "pick";

export function useLibrary<T extends { id: string }>(kind: LibraryKind) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/bidder-library/${kind}`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load library");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (body: Partial<T>) => {
      const res = await apiFetch(`/api/bidder-library/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || `Create failed (${res.status})`);
      }
      await refresh();
    },
    [kind, refresh]
  );

  const update = useCallback(
    async (id: string, body: Partial<T>) => {
      const res = await apiFetch(`/api/bidder-library/${kind}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || `Update failed (${res.status})`);
      }
      await refresh();
    },
    [kind, refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await apiFetch(`/api/bidder-library/${kind}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || `Delete failed (${res.status})`);
      }
      await refresh();
    },
    [kind, refresh]
  );

  return { items, loading, error, refresh, create, update, remove };
}

// -------- Template form --------

function TemplateForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: Partial<StrategyTemplate>;
  onCancel: () => void;
  onSubmit: (body: Partial<StrategyTemplate>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [icon, setIcon] = useState(initial?.icon || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [vpc, setVpc] = useState<string>(
    initial?.valuePerClick != null ? String(initial.valuePerClick) : ""
  );
  const [maxBid, setMaxBid] = useState<string>(
    initial?.maxBidCpm != null ? String(initial.maxBidCpm) : ""
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const body: Partial<StrategyTemplate> = {
        name: name.trim(),
        icon: icon.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        valuePerClick: vpc ? Number(vpc) : null,
        maxBidCpm: maxBid ? Number(maxBid) : null,
      };
      await onSubmit(body);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
      <div className="grid grid-cols-[80px_1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Icon</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🚀"
            maxLength={8}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aggressive Black Friday"
            maxLength={60}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short summary shown on the template card"
          maxLength={280}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          placeholder="Write the bidding strategy instructions..."
          className="w-full px-2 py-2 border border-slate-300 rounded text-sm font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Default Value/Click ($, optional)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={vpc}
            onChange={(e) => setVpc(e.target.value)}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Default Max Bid CPM ($, optional)
          </label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={maxBid}
            onChange={(e) => setMaxBid(e.target.value)}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim() || !prompt.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// -------- Skill form --------

function SkillForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: Partial<AgentSkill>;
  onCancel: () => void;
  onSubmit: (body: Partial<AgentSkill>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [icon, setIcon] = useState(initial?.icon || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [promptSnippet, setPromptSnippet] = useState(initial?.promptSnippet || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        icon: icon.trim(),
        description: description.trim(),
        promptSnippet: promptSnippet.trim(),
      });
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-lg">
      <div className="grid grid-cols-[80px_1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Icon</label>
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="🎯"
            maxLength={8}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="E-commerce Conversion Boost"
            maxLength={60}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short summary shown on the skill card"
          maxLength={280}
          className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Prompt Snippet (appended to the agent prompt when enabled)
        </label>
        <textarea
          value={promptSnippet}
          onChange={(e) => setPromptSnippet(e.target.value)}
          rows={4}
          placeholder="[Skill: My Skill] Instructions appended to the agent's base prompt..."
          className="w-full px-2 py-2 border border-slate-300 rounded text-sm font-mono"
        />
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !name.trim() || !promptSnippet.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// -------- List --------

export function LibraryList({
  kind,
  mode,
  onPick,
  selectedIds,
}: {
  kind: LibraryKind;
  mode: LibraryMode;
  onPick?: (item: StrategyTemplate | AgentSkill) => void;
  selectedIds?: Set<string>;
}) {
  const lib = useLibrary<StrategyTemplate | AgentSkill>(kind);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isTemplates = kind === "templates";
  const label = isTemplates ? "strategy template" : "agent skill";

  return (
    <div>
      {mode === "manage" && (
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500">
            {isTemplates
              ? "Reusable strategy prompts, picked when configuring agents."
              : "Reusable prompt snippets appended to an agent's strategy."}
          </p>
          {!creating && editing === null && (
            <button
              onClick={() => setCreating(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + New {isTemplates ? "Template" : "Skill"}
            </button>
          )}
        </div>
      )}

      {creating && mode === "manage" && (
        <div className="mb-4">
          {isTemplates ? (
            <TemplateForm
              onCancel={() => setCreating(false)}
              onSubmit={async (body) => {
                await lib.create(body as Partial<StrategyTemplate>);
                setCreating(false);
              }}
            />
          ) : (
            <SkillForm
              onCancel={() => setCreating(false)}
              onSubmit={async (body) => {
                await lib.create(body as Partial<AgentSkill>);
                setCreating(false);
              }}
            />
          )}
        </div>
      )}

      {lib.loading && <div className="text-sm text-slate-400">Loading...</div>}
      {lib.error && <div className="text-sm text-red-500">{lib.error}</div>}

      {!lib.loading && lib.items.length === 0 && !creating && (
        <div className="text-center py-8 text-sm text-slate-400 border border-dashed border-slate-300 rounded-lg">
          No custom {label}s yet.
          {mode === "manage" && " Click \"New\" above to add one."}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {lib.items.map((item) => {
          const isEditing = editing === item.id;
          const isPicked = selectedIds?.has(item.id);
          if (isEditing && mode === "manage") {
            return (
              <div key={item.id} className="md:col-span-2">
                {isTemplates ? (
                  <TemplateForm
                    initial={item as StrategyTemplate}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (body) => {
                      await lib.update(item.id, body as Partial<StrategyTemplate>);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <SkillForm
                    initial={item as AgentSkill}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (body) => {
                      await lib.update(item.id, body as Partial<AgentSkill>);
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            );
          }
          return (
            <div
              key={item.id}
              className={`p-3 rounded-lg border transition-all ${
                mode === "pick"
                  ? isPicked
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-200 hover:border-blue-400 cursor-pointer"
                  : "border-slate-200"
              }`}
              onClick={mode === "pick" ? () => onPick?.(item) : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{item.icon || "⚙️"}</span>
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {item.name}
                    </span>
                    {mode === "pick" && isPicked && (
                      <span className="text-xs text-emerald-600 font-medium">✓ Selected</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {item.description || <span className="italic text-slate-400">No description</span>}
                  </p>
                  {isTemplates && (
                    <div className="mt-2 flex gap-3 text-[11px] text-slate-400">
                      {(item as StrategyTemplate).valuePerClick != null && (
                        <span>VPC: ${(item as StrategyTemplate).valuePerClick}</span>
                      )}
                      {(item as StrategyTemplate).maxBidCpm != null && (
                        <span>Max CPM: ${(item as StrategyTemplate).maxBidCpm}</span>
                      )}
                    </div>
                  )}
                </div>
                {mode === "manage" && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(item.id)}
                      className="text-xs text-slate-500 hover:text-blue-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Delete "${item.name}"?`)) return;
                        try {
                          await lib.remove(item.id);
                        } catch (e: any) {
                          alert(e?.message || "Delete failed");
                        }
                      }}
                      className="text-xs text-slate-500 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
