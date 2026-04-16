"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

// ---- Preset strategy templates ----
const STRATEGY_PRESETS = [
  {
    id: "growth",
    name: "Growth Aggressive",
    icon: "\u{1F680}",
    desc: "Maximize impressions and clicks. Willing to pay premium prices for high-CTR slots.",
    prompt: `增长型激进策略：
- 优先选择预测 CTR 最高的素材，即使成本较高
- strategy_multiplier 取 1.3-1.5
- 对于匹配度高的广告位（placementFit > 0.7），大胆提高出价
- 如果历史 CTR 表现好（> 0.015），再额外加 10% 出价
- 宁可多花钱也不错过优质展示机会`,
    vpc: 2.5,
    maxBid: 60,
  },
  {
    id: "balanced",
    name: "Balanced",
    icon: "\u2696\uFE0F",
    desc: "Balance between CTR performance and cost efficiency. Best for steady campaigns.",
    prompt: `均衡型策略：
- 综合考虑素材的 placementFit、targetAudience 匹配度和历史 CTR
- strategy_multiplier 取 0.95-1.1
- 如果 floor_cpm 超过 value_per_click * predicted_ctr * 800，则降低出价意愿
- 优选有历史表现数据的素材，减少不确定性
- 避免对低匹配度的广告位过度出价`,
    vpc: 1.5,
    maxBid: 35,
  },
  {
    id: "conservative",
    name: "Budget Saver",
    icon: "\u{1F6E1}\uFE0F",
    desc: "Minimize cost per click. Only bid on high-confidence opportunities.",
    prompt: `保守节约策略：
- 只对 placementFit > 0.6 且 audience 匹配度高的广告位出价
- strategy_multiplier 取 0.6-0.8
- 优先选择有历史 CTR 数据且表现稳定的素材
- 如果 floor_cpm > max_bid_cpm * 0.5，倾向于不参与
- 严格控制每次出价不超过预期回报`,
    vpc: 1.0,
    maxBid: 20,
  },
  {
    id: "ctr_optimizer",
    name: "CTR Optimizer",
    icon: "\u{1F3AF}",
    desc: "Focus on maximizing click-through rate. Chooses the best-matching creative for each slot.",
    prompt: `CTR 优化策略：
- 最核心目标：最大化点击率
- 仔细分析每个候选素材的 targetAudiences 与 bid request 的 userSegments 的重合度
- 选择 placementFit 中当前 slotType 分数最高的素材
- 如果素材有历史 CTR 数据，优先选择历史 CTR > 0.012 的
- strategy_multiplier 取 1.0-1.2，在 CTR 预测高时适当提高`,
    vpc: 2.0,
    maxBid: 45,
  },
  {
    id: "audience_first",
    name: "Audience Matcher",
    icon: "\u{1F465}",
    desc: "Prioritize audience relevance. Best when your creatives target specific user segments.",
    prompt: `受众优先策略：
- 最核心目标：素材的 targetAudiences 与 userSegments 的匹配度
- 如果素材的目标受众和当前用户画像高度重合（>= 2 个 segment 匹配），大幅提高出价（multiplier 1.3）
- 如果没有任何受众重合，即使 floor_cpm 很低也倾向不参与
- 选材时优先看 audience 匹配，其次看 placementFit
- strategy_multiplier 取 0.8-1.3，视匹配度动态调整`,
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
    promptSnippet: "\n[Skill: Audience Matching] 分析素材的 targetAudiences 和请求的 userSegments，计算重合度。重合度高的素材优先选择。",
  },
  {
    id: "historical_learning",
    name: "Historical Learning",
    icon: "\u{1F4CA}",
    desc: "Leverage historical CTR data to improve predictions",
    promptSnippet: "\n[Skill: Historical Learning] 如果素材有 recentStats，用实际 CTR 替代 prior。如果历史展示 > 100 次，给予更高置信度。",
  },
  {
    id: "budget_pacing",
    name: "Budget Pacing",
    icon: "\u{23F1}\uFE0F",
    desc: "Control spending rate to distribute budget evenly",
    promptSnippet: "\n[Skill: Budget Pacing] 如果已出价次数较多，逐步降低 strategy_multiplier（减少 0.05/轮），避免预算集中消耗。",
  },
  {
    id: "floor_awareness",
    name: "Floor Price Awareness",
    icon: "\u{1F4B0}",
    desc: "Optimize bids relative to floor price for better margins",
    promptSnippet: "\n[Skill: Floor Awareness] 分析 floor_cpm 与预期回报的比值。如果 floor_cpm > predicted_ctr * value_per_click * 700，降低出价或不参与。",
  },
  {
    id: "creative_rotation",
    name: "Creative Rotation",
    icon: "\u{1F504}",
    desc: "Avoid over-using a single creative to prevent ad fatigue",
    promptSnippet: "\n[Skill: Creative Rotation] 如果某素材近期展示次数 > 500，优先尝试其他素材，避免用户疲劳。",
  },
  {
    id: "slot_specialization",
    name: "Slot Specialization",
    icon: "\u{1F4F1}",
    desc: "Specialize bidding strategy per slot type (mobile vs desktop)",
    promptSnippet: "\n[Skill: Slot Specialization] mobile-banner 更适合直接转化型素材（CTA 强）；desktop-rectangle 适合信息丰富型素材；native-feed 适合教育型内容。根据 slotType 调整选材偏好。",
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

  // Build final prompt = base prompt + skill snippets
  function buildFinalPrompt(): string {
    let prompt = customPrompt;
    for (const skill of AGENT_SKILLS) {
      // Remove existing skill snippet if present
      prompt = prompt.replace(skill.promptSnippet, "");
    }
    // Append selected skills
    for (const skill of AGENT_SKILLS) {
      if (selectedSkills.has(skill.id)) {
        prompt += skill.promptSnippet;
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
            <h3 className="font-semibold text-slate-900 mb-1">Strategy Template</h3>
            <p className="text-xs text-slate-400 mb-4">Select a preset strategy or choose "Custom" to write your own.</p>

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
            <h3 className="font-semibold text-slate-900 mb-1">Agent Skills</h3>
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
                    <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs ${
                      isOn ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400"
                    }`}>
                      {isOn ? "\u2713" : ""}
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
    </div>
  );
}
