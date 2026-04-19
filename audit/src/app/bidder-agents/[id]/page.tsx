"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import {
  LibraryList,
  useLibrary,
  StrategyTemplate,
  AgentSkill,
} from "@/components/BidderLibrary";

// ---- Preset strategy templates ----
const STRATEGY_PRESETS = [
  {
    id: "growth",
    name: "Growth Aggressive",
    icon: "\u{1F680}",
    desc: "Maximize impressions and clicks. Willing to pay premium prices for high-CTR slots.",
    prompt: `Aggressive growth strategy:
- Prefer creatives with the highest predicted CTR, even at higher cost
- strategy_multiplier in [1.3, 1.5]
- For high-fit placements (placementFit > 0.7), bid boldly higher
- If historical CTR is strong (> 0.015), add an extra 10% to the bid
- Better to overspend than miss a premium impression`,
    vpc: 2.5,
    maxBid: 60,
  },
  {
    id: "balanced",
    name: "Balanced",
    icon: "\u2696\uFE0F",
    desc: "Balance between CTR performance and cost efficiency. Best for steady campaigns.",
    prompt: `Balanced strategy:
- Jointly weigh the creative's placementFit, targetAudience match, and historical CTR
- strategy_multiplier in [0.95, 1.1]
- If floor_cpm exceeds value_per_click * predicted_ctr * 800, reduce willingness to bid
- Prefer creatives that have historical performance data to reduce uncertainty
- Avoid overbidding on low-fit placements`,
    vpc: 1.5,
    maxBid: 35,
  },
  {
    id: "conservative",
    name: "Budget Saver",
    icon: "\u{1F6E1}\uFE0F",
    desc: "Minimize cost per click. Only bid on high-confidence opportunities.",
    prompt: `Conservative budget-saver strategy:
- Only bid on placements with placementFit > 0.6 and strong audience match
- strategy_multiplier in [0.6, 0.8]
- Prefer creatives with historical CTR data and stable performance
- If floor_cpm > max_bid_cpm * 0.5, lean toward skipping
- Strictly cap each bid at or below expected return`,
    vpc: 1.0,
    maxBid: 20,
  },
  {
    id: "ctr_optimizer",
    name: "CTR Optimizer",
    icon: "\u{1F3AF}",
    desc: "Focus on maximizing click-through rate. Chooses the best-matching creative for each slot.",
    prompt: `CTR optimization strategy:
- Primary goal: maximize click-through rate
- For each candidate, carefully analyze overlap between its targetAudiences and the bid request's userSegments
- Pick the creative whose placementFit scores highest for the current slotType
- If a creative has historical CTR data, prefer those with historical CTR > 0.012
- strategy_multiplier in [1.0, 1.2], raise moderately when predicted CTR is high`,
    vpc: 2.0,
    maxBid: 45,
  },
  {
    id: "audience_first",
    name: "Audience Matcher",
    icon: "\u{1F465}",
    desc: "Prioritize audience relevance. Best when your creatives target specific user segments.",
    prompt: `Audience-first strategy:
- Primary goal: overlap between the creative's targetAudiences and the userSegments
- If the creative's target audience strongly overlaps with the current user (>= 2 segment matches), bid aggressively (multiplier 1.3)
- If there is zero audience overlap, lean toward skipping even when floor_cpm is low
- When picking a creative, prioritize audience match first, placementFit second
- strategy_multiplier in [0.8, 1.3], adjust dynamically based on match quality`,
    vpc: 1.8,
    maxBid: 40,
  },
  {
    id: "custom",
    name: "Custom Strategy",
    icon: "\u{1F4DD}",
    desc: "Write your own strategy from scratch. Full control over the bidder agent's behavior.",
    prompt: "",
    vpc: 1.5,
    maxBid: 35,
  },
];

// ---- Agent Skills ----
const AGENT_SKILLS = [
  {
    id: "audience_matching",
    name: "Audience Matching",
    icon: "\u{1F465}",
    desc: "Match creative target audiences with bid request user segments",
    promptSnippet: "\n[Skill: Audience Matching] Analyze overlap between the creative's targetAudiences and the request's userSegments. Prefer creatives with higher overlap.",
  },
  {
    id: "historical_learning",
    name: "Historical Learning",
    icon: "\u{1F4CA}",
    desc: "Leverage historical CTR data to improve predictions",
    promptSnippet: "\n[Skill: Historical Learning] If the creative has recentStats, use its actual CTR instead of the prior. If historical impressions > 100, apply higher confidence.",
  },
  {
    id: "budget_pacing",
    name: "Budget Pacing",
    icon: "\u{23F1}\uFE0F",
    desc: "Control spending rate to distribute budget evenly",
    promptSnippet: "\n[Skill: Budget Pacing] If the agent has already bid many times, gradually reduce strategy_multiplier (by 0.05 per round) to avoid burning the budget too fast.",
  },
  {
    id: "floor_awareness",
    name: "Floor Price Awareness",
    icon: "\u{1F4B0}",
    desc: "Optimize bids relative to floor price for better margins",
    promptSnippet: "\n[Skill: Floor Awareness] Analyze the ratio of floor_cpm to expected return. If floor_cpm > predicted_ctr * value_per_click * 700, lower the bid or skip.",
  },
  {
    id: "creative_rotation",
    name: "Creative Rotation",
    icon: "\u{1F504}",
    desc: "Avoid over-using a single creative to prevent ad fatigue",
    promptSnippet: "\n[Skill: Creative Rotation] If a creative's recent impressions > 500, prefer trying a different creative to avoid user fatigue.",
  },
  {
    id: "slot_specialization",
    name: "Slot Specialization",
    icon: "\u{1F4F1}",
    desc: "Specialize bidding strategy per slot type (mobile vs desktop)",
    promptSnippet: "\n[Skill: Slot Specialization] mobile-banner works best with conversion-focused creatives (strong CTA); desktop-rectangle suits information-rich creatives; native-feed suits educational content. Adjust creative preference based on slotType.",
  },
];

export default function BidderAgentDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [agent, setAgent] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedPreset, setSelectedPreset] = useState("balanced");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [vpc, setVpc] = useState(1.5);
  const [maxBid, setMaxBid] = useState(35);
  const [pickerOpen, setPickerOpen] = useState<null | "templates" | "skills">(null);

  // Custom library data (for snippet lookup + display)
  const templatesLib = useLibrary<StrategyTemplate>("templates");
  const skillsLib = useLibrary<AgentSkill>("skills");

  const allSkills = useMemo(
    () => [
      ...AGENT_SKILLS.map((s) => ({ id: s.id, name: s.name, snippet: s.promptSnippet })),
      ...skillsLib.items.map((s) => ({
        id: s.id,
        name: s.name,
        snippet: s.promptSnippet,
      })),
    ],
    [skillsLib.items]
  );

  useEffect(() => {
    apiFetch(`/api/bidder-agents/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setAgent(data);
        // Restore state from agent data
        const preset = STRATEGY_PRESETS.find((p) => p.id === data.strategy);
        if (preset && preset.id !== "custom") {
          setSelectedPreset(data.strategy);
        } else {
          setSelectedPreset("custom");
        }
        setCustomPrompt(data.strategyPrompt || "");
        setVpc(data.valuePerClick);
        setMaxBid(data.maxBidCpm);

        // Try to extract skills from prompt
        const skills = new Set<string>();
        for (const skill of AGENT_SKILLS) {
          if (data.strategyPrompt?.includes(`[Skill: ${skill.name}]`)) {
            skills.add(skill.id);
          }
        }
        setSelectedSkills(skills);
      })
      .catch(() => {});
  }, [id]);

  // When custom skills finish loading, detect any whose snippet is already in the prompt.
  useEffect(() => {
    if (!agent?.strategyPrompt || skillsLib.items.length === 0) return;
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const s of skillsLib.items) {
        if (agent.strategyPrompt.includes(s.promptSnippet) && !next.has(s.id)) {
          next.add(s.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [agent?.strategyPrompt, skillsLib.items]);

  function handlePresetSelect(presetId: string) {
    setSelectedPreset(presetId);
    const preset = STRATEGY_PRESETS.find((p) => p.id === presetId);
    if (preset && preset.id !== "custom") {
      setCustomPrompt(preset.prompt);
      setVpc(preset.vpc);
      setMaxBid(preset.maxBid);
    }
  }

  function toggleSkill(skillId: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  }

  // Build final prompt = base prompt + skill snippets (built-in + custom)
  function buildFinalPrompt(): string {
    let prompt = customPrompt;
    for (const skill of allSkills) {
      prompt = prompt.split(skill.snippet).join("");
    }
    for (const skill of allSkills) {
      if (selectedSkills.has(skill.id)) {
        prompt += skill.snippet;
      }
    }
    return prompt.trim();
  }

  async function handleSave() {
    setSaving(true);
    const finalPrompt = buildFinalPrompt();
    const body = {
      strategy: selectedPreset === "custom" ? "custom" : selectedPreset,
      strategyPrompt: finalPrompt,
      valuePerClick: vpc,
      maxBidCpm: maxBid,
    };
    try {
      const res = await apiFetch(`/api/bidder-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated = await res.json();
        setAgent(updated);
        setCustomPrompt(finalPrompt);
        alert("Configuration saved!");
      }
    } catch {
      alert("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!agent) return <div className="text-center py-12 text-slate-400">Loading...</div>;

  const previewPrompt = buildFinalPrompt();

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{agent.name}</h2>
          <p className="text-slate-500 mt-1">Configure bidding strategy, skills and parameters</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Configuration"}
          </button>
          <button
            onClick={() => router.back()}
            className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
          >
            Back
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Config */}
        <div className="col-span-2 space-y-6">

          {/* Strategy Presets */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-slate-900">Strategy Template</h3>
              <button
                onClick={() => setPickerOpen("templates")}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Browse My Library ({templatesLib.items.length})
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Select a preset strategy, pick one you&apos;ve saved, or choose &quot;Custom&quot; to write your own.
              {" "}
              <Link href="/bidder-agents/library" className="text-blue-500 hover:underline">
                Manage library
              </Link>
            </p>

            <div className="grid grid-cols-3 gap-3">
              {STRATEGY_PRESETS.map((preset) => {
                const isActive = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handlePresetSelect(preset.id)}
                    className={`text-left p-3 rounded-lg border-2 transition-all ${
                      isActive
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{preset.icon}</span>
                      <span className={`text-sm font-semibold ${isActive ? "text-blue-700" : "text-slate-800"}`}>
                        {preset.name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{preset.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Agent Skills */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-slate-900">Agent Skills</h3>
              <button
                onClick={() => setPickerOpen("skills")}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Browse My Library ({skillsLib.items.length})
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Enable skills to enhance the agent. Each skill adds specialized instructions to the agent prompt.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {AGENT_SKILLS.map((skill) => {
                const isOn = selectedSkills.has(skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-all text-left ${
                      isOn
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] transition-colors ${
                      isOn
                        ? "bg-emerald-500 text-white"
                        : "border border-slate-300 bg-transparent"
                    }`}>
                      {isOn && "\u2713"}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{skill.icon}</span>
                        <span className={`text-sm font-medium ${isOn ? "text-emerald-800" : "text-slate-700"}`}>
                          {skill.name}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{skill.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {skillsLib.items.some((s) => selectedSkills.has(s.id)) && (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500 mb-2">Custom skills from your library</div>
                <div className="grid grid-cols-2 gap-3">
                  {skillsLib.items
                    .filter((s) => selectedSkills.has(s.id))
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSkill(s.id)}
                        className="flex items-start gap-3 p-3 rounded-lg border border-emerald-400 bg-emerald-50 text-left"
                      >
                        <div className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] bg-emerald-500 text-white">
                          ✓
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{s.icon || "⚙️"}</span>
                            <span className="text-sm font-medium text-emerald-800">{s.name}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {s.description || <span className="italic text-slate-400">No description</span>}
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Custom Prompt Editor */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-1">Strategy Prompt</h3>
            <p className="text-xs text-slate-400 mb-4">
              Edit the prompt that guides the AI bidder agent. Preset templates auto-fill this field. Skill instructions are appended automatically.
            </p>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Write your custom bidding strategy instructions here..."
            />
          </div>

          {/* Bidding Parameters */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Bidding Parameters</h3>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Value per Click ($)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={vpc}
                  onChange={(e) => setVpc(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">How much a single click is worth to you</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Max Bid CPM ($)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  value={maxBid}
                  onChange={(e) => setMaxBid(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">Maximum CPM the agent is allowed to bid</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="space-y-6">
          {/* Live Preview */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-8">
            <h3 className="font-semibold text-slate-900 mb-3">Final Prompt Preview</h3>
            <p className="text-xs text-slate-400 mb-3">
              This is the complete prompt that will be sent to the AI bidder agent.
            </p>
            <div className="bg-slate-900 rounded-lg p-4 max-h-[500px] overflow-y-auto">
              <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono leading-relaxed">
                {previewPrompt || "(empty - select a preset or write a custom prompt)"}
              </pre>
            </div>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Strategy</span>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {STRATEGY_PRESETS.find((p) => p.id === selectedPreset)?.name || "Custom"}
                </p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Active Skills</span>
                <p className="font-semibold text-slate-800 mt-0.5">{selectedSkills.size}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Value/Click</span>
                <p className="font-semibold text-slate-800 mt-0.5">${vpc.toFixed(1)}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Max Bid CPM</span>
                <p className="font-semibold text-slate-800 mt-0.5">${maxBid.toFixed(1)}</p>
              </div>
            </div>

            {/* Bid Formula */}
            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <span className="text-xs font-semibold text-blue-700">Bid Formula</span>
              <p className="text-xs text-blue-800 font-mono mt-1">
                bid_cpm = pCTR * {vpc.toFixed(1)} * 1000 * multiplier
              </p>
              <p className="text-xs text-blue-600 mt-1">
                cap: ${maxBid.toFixed(1)} CPM
              </p>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setPickerOpen(null)}
        >
          <div
            className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="font-semibold text-slate-900">
                  {pickerOpen === "templates"
                    ? "Pick a Strategy Template"
                    : "Pick Agent Skills"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {pickerOpen === "templates"
                    ? "Click a template to apply it to this agent."
                    : "Click to toggle skills. Selected skills are appended to the strategy prompt."}
                </p>
              </div>
              <button
                onClick={() => setPickerOpen(null)}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <LibraryList
                kind={pickerOpen}
                mode="pick"
                selectedIds={pickerOpen === "skills" ? selectedSkills : undefined}
                onPick={(item) => {
                  if (pickerOpen === "templates") {
                    const t = item as StrategyTemplate;
                    setSelectedPreset("custom");
                    setCustomPrompt(t.prompt);
                    if (t.valuePerClick != null) setVpc(t.valuePerClick);
                    if (t.maxBidCpm != null) setMaxBid(t.maxBidCpm);
                    setPickerOpen(null);
                  } else {
                    toggleSkill(item.id);
                  }
                }}
              />
              {pickerOpen === "templates" && templatesLib.items.length === 0 && !templatesLib.loading && (
                <div className="mt-4 text-center">
                  <Link
                    href="/bidder-agents/library"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Create your first template →
                  </Link>
                </div>
              )}
            </div>
            {pickerOpen === "skills" && (
              <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
                <button
                  onClick={() => setPickerOpen(null)}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
