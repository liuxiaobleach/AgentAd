"use client";

import { useMemo, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";

export type BrandKit = {
  id: string;
  advertiserId: string;
  name: string;
  description: string;
  voiceTone: string;
  primaryMessage: string;
  colorPalette: string[];
  mandatoryTerms: string[];
  bannedTerms: string[];
  visualRules: string;
  ctaPreferences: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type BrandKitDraft = {
  name: string;
  description: string;
  voiceTone: string;
  primaryMessage: string;
  colorPalette: string;
  mandatoryTerms: string;
  bannedTerms: string;
  visualRules: string;
  ctaPreferences: string;
  isDefault: boolean;
};

const EMPTY_DRAFT: BrandKitDraft = {
  name: "",
  description: "",
  voiceTone: "",
  primaryMessage: "",
  colorPalette: "",
  mandatoryTerms: "",
  bannedTerms: "",
  visualRules: "",
  ctaPreferences: "",
  isDefault: true,
};

function toDraft(kit?: BrandKit | null): BrandKitDraft {
  if (!kit) return EMPTY_DRAFT;
  return {
    name: kit.name || "",
    description: kit.description || "",
    voiceTone: kit.voiceTone || "",
    primaryMessage: kit.primaryMessage || "",
    colorPalette: (kit.colorPalette || []).join(", "),
    mandatoryTerms: (kit.mandatoryTerms || []).join(", "),
    bannedTerms: (kit.bannedTerms || []).join(", "),
    visualRules: kit.visualRules || "",
    ctaPreferences: kit.ctaPreferences || "",
    isDefault: kit.isDefault,
  };
}

function splitList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export default function BrandKitManager({
  kits,
  onRefresh,
}: {
  kits: BrandKit[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(kits[0]?.id || null);
  const [draft, setDraft] = useState<BrandKitDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => kits.find((kit) => kit.id === selectedId) || kits.find((kit) => kit.isDefault) || kits[0] || null,
    [kits, selectedId]
  );

  const defaultKit = kits.find((kit) => kit.isDefault) || kits[0] || null;

  function openNew() {
    setSelectedId(null);
    setDraft({
      ...EMPTY_DRAFT,
      isDefault: kits.length === 0,
    });
    setError(null);
    setOpen(true);
  }

  function openEdit(kit: BrandKit) {
    setSelectedId(kit.id);
    setDraft(toDraft(kit));
    setError(null);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      name: draft.name,
      description: draft.description,
      voiceTone: draft.voiceTone,
      primaryMessage: draft.primaryMessage,
      colorPalette: splitList(draft.colorPalette),
      mandatoryTerms: splitList(draft.mandatoryTerms),
      bannedTerms: splitList(draft.bannedTerms),
      visualRules: draft.visualRules,
      ctaPreferences: draft.ctaPreferences,
      isDefault: draft.isDefault,
    };

    try {
      const res = await apiFetch(selectedId ? `/api/brand-kits/${selectedId}` : "/api/brand-kits", {
        method: selectedId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to save brand kit");
      }
      setOpen(false);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || "Failed to save brand kit");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    if (!window.confirm("Delete this brand kit?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/brand-kits/${selectedId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete brand kit");
      }
      setOpen(false);
      onRefresh();
    } catch (err: any) {
      setError(err?.message || "Failed to delete brand kit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="rounded-[24px] border p-5 bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-fuchsia-500 mb-2">Brand Kit</div>
            <h3 className="text-lg font-semibold text-slate-900">
              {defaultKit ? defaultKit.name : "No brand kit saved yet"}
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-xl">
              {defaultKit
                ? defaultKit.description || "Use a reusable brand voice, palette, and copy guardrail set for batch generation."
                : "Save your brand voice, palette, required terms, and CTA preferences before launching batch generation."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => (defaultKit ? openEdit(defaultKit) : openNew())}
              className="px-4 py-2 text-sm rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {defaultKit ? "Manage Brand Kit" : "Create Brand Kit"}
            </button>
          </div>
        </div>

        {defaultKit ? (
          <div className="grid md:grid-cols-4 grid-cols-1 gap-3 mt-5">
            <InfoPill label="Voice" value={defaultKit.voiceTone || "Not specified"} accent="#a855f7" />
            <InfoPill label="Primary Message" value={defaultKit.primaryMessage || "Not specified"} accent="#06b6d4" />
            <InfoPill
              label="Palette"
              value={defaultKit.colorPalette?.length ? defaultKit.colorPalette.join(", ") : "No palette"}
              accent="#ec4899"
            />
            <InfoPill
              label="Guardrails"
              value={defaultKit.mandatoryTerms?.length ? `Must include: ${defaultKit.mandatoryTerms.join(", ")}` : "No copy guardrails"}
              accent="#10b981"
            />
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
            Batch Creative Studio can run without a brand kit, but saving one now will make variants much more consistent.
          </div>
        )}

        {kits.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {kits.map((kit) => (
              <button
                key={kit.id}
                onClick={() => openEdit(kit)}
                className="px-3 py-1.5 text-xs rounded-full border transition-colors"
                style={{
                  background: kit.isDefault ? "rgba(168,85,247,0.08)" : "#fff",
                  borderColor: kit.isDefault ? "rgba(168,85,247,0.3)" : "rgba(148,163,184,0.25)",
                  color: kit.isDefault ? "#a855f7" : "#64748b",
                }}
              >
                {kit.name}{kit.isDefault ? " · Default" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="w-full max-w-5xl max-h-[92vh] overflow-auto rounded-[28px] border"
            style={{ background: "rgba(15,23,42,0.96)", borderColor: "rgba(168,85,247,0.25)" }}
          >
            <div className="p-6 border-b border-white/10 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-fuchsia-400 mb-2">Brand Kit Manager</div>
                <h3 className="text-2xl font-semibold text-white">
                  {selected ? `Edit ${selected.name}` : "Create a new brand kit"}
                </h3>
                <p className="text-sm text-slate-400 mt-2">
                  Save reusable voice, palette, and copy constraints, then apply them to any batch generation run.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white text-xl">
                &#10005;
              </button>
            </div>

            <div className="grid lg:grid-cols-[260px,1fr] grid-cols-1 gap-0">
              <aside className="border-r border-white/10 p-4 space-y-3">
                <button
                  onClick={openNew}
                  className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-white bg-fuchsia-500/15 border border-fuchsia-400/25 hover:bg-fuchsia-500/20"
                >
                  + New Brand Kit
                </button>
                <div className="space-y-2">
                  {kits.map((kit) => (
                    <button
                      key={kit.id}
                      onClick={() => openEdit(kit)}
                      className="w-full rounded-xl px-4 py-3 text-left border transition-colors"
                      style={{
                        background: selectedId === kit.id ? "rgba(6,182,212,0.12)" : "rgba(2,6,23,0.45)",
                        borderColor: selectedId === kit.id ? "rgba(6,182,212,0.3)" : "rgba(148,163,184,0.16)",
                      }}
                    >
                      <div className="text-sm font-medium text-white">{kit.name}</div>
                      <div className="text-xs text-slate-400 mt-1 line-clamp-2">{kit.description || "No description"}</div>
                      {kit.isDefault && (
                        <div className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-300 mt-2">Default</div>
                      )}
                    </button>
                  ))}
                </div>
              </aside>

              <div className="p-6 space-y-4">
                <div className="grid sm:grid-cols-2 grid-cols-1 gap-4">
                  <Field label="Kit Name">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                  <Field label="Voice Tone">
                    <input
                      value={draft.voiceTone}
                      onChange={(e) => setDraft((prev) => ({ ...prev, voiceTone: e.target.value }))}
                      placeholder="credible, premium, builder-focused"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                </div>

                <Field label="Description">
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Short summary shown when choosing this kit"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <Field label="Primary Message">
                  <input
                    value={draft.primaryMessage}
                    onChange={(e) => setDraft((prev) => ({ ...prev, primaryMessage: e.target.value }))}
                    placeholder="What must every creative reinforce?"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                  />
                </Field>

                <div className="grid sm:grid-cols-3 grid-cols-1 gap-4">
                  <Field label="Color Palette">
                    <input
                      value={draft.colorPalette}
                      onChange={(e) => setDraft((prev) => ({ ...prev, colorPalette: e.target.value }))}
                      placeholder="cyan, midnight blue, silver"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                  <Field label="Mandatory Terms">
                    <input
                      value={draft.mandatoryTerms}
                      onChange={(e) => setDraft((prev) => ({ ...prev, mandatoryTerms: e.target.value }))}
                      placeholder="audited, non-custodial"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                  <Field label="Banned Terms">
                    <input
                      value={draft.bannedTerms}
                      onChange={(e) => setDraft((prev) => ({ ...prev, bannedTerms: e.target.value }))}
                      placeholder="guaranteed, risk-free"
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                </div>

                <div className="grid sm:grid-cols-2 grid-cols-1 gap-4">
                  <Field label="Visual Rules">
                    <textarea
                      rows={4}
                      value={draft.visualRules}
                      onChange={(e) => setDraft((prev) => ({ ...prev, visualRules: e.target.value }))}
                      placeholder="Avoid faces, keep clean UI motifs, use product screenshots sparingly..."
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                  <Field label="CTA Preferences">
                    <textarea
                      rows={4}
                      value={draft.ctaPreferences}
                      onChange={(e) => setDraft((prev) => ({ ...prev, ctaPreferences: e.target.value }))}
                      placeholder="Prefer low-friction CTAs like Explore, Learn More, Start Building..."
                      className="w-full px-3 py-2 rounded-xl text-sm bg-slate-950/55 border border-slate-700 text-white"
                    />
                  </Field>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.isDefault}
                    onChange={(e) => setDraft((prev) => ({ ...prev, isDefault: e.target.checked }))}
                    style={{ accentColor: "#a855f7" }}
                  />
                  Set as default brand kit
                </label>

                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-500">
                    Saved kits can be reused in Batch Creative Studio and attached to future variants.
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedId && (
                      <button
                        onClick={remove}
                        disabled={saving}
                        className="px-4 py-2 text-sm rounded-xl text-red-300 border border-red-500/20 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      onClick={() => setOpen(false)}
                      className="px-4 py-2 text-sm rounded-xl text-slate-300 border border-slate-700 hover:bg-white/5"
                    >
                      Close
                    </button>
                    <button
                      onClick={save}
                      disabled={saving || !draft.name.trim()}
                      className="px-5 py-2 text-sm rounded-xl text-white bg-gradient-to-r from-fuchsia-500 to-cyan-500 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : selectedId ? "Save Changes" : "Create Kit"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-slate-400 mb-2">{label}</div>
      {children}
    </label>
  );
}

function InfoPill({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      className="rounded-2xl border px-4 py-3"
      style={{
        borderColor: `${accent}33`,
        background: `${accent}0d`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: accent }}>
        {label}
      </div>
      <div className="text-sm text-slate-700 mt-2 leading-6">{value}</div>
    </div>
  );
}
