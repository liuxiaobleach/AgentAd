import type { AuditDecision } from "@prisma/client";

export interface PolicyInput {
  riskScore: number;
  riskSignals: string[];
  entities: {
    urls: string[];
    qrPayloads: string[];
    riskTerms: string[];
  };
  declaredLandingUrl: string;
  qrUrls: string[];
}

export interface PolicyResult {
  decision: AuditDecision;
  matchedRules: string[];
  explanation: string;
}

interface Rule {
  id: string;
  name: string;
  check: (input: PolicyInput) => boolean;
  decision: AuditDecision;
  priority: number; // lower = higher priority
}

const RULES: Rule[] = [
  {
    id: "R001",
    name: "QR URL mismatch with declared landing page",
    check: (input) => {
      if (input.qrUrls.length === 0) return false;
      try {
        const declaredDomain = new URL(input.declaredLandingUrl).hostname;
        return input.qrUrls.some((url) => {
          try {
            return new URL(url).hostname !== declaredDomain;
          } catch {
            return true;
          }
        });
      } catch {
        return false;
      }
    },
    decision: "REJECT",
    priority: 1,
  },
  {
    id: "R002",
    name: "Contains false profit guarantees",
    check: (input) =>
      input.riskSignals.includes("risk_terms_detected") &&
      input.entities.riskTerms.some((t) =>
        ["guaranteed returns", "100% profit", "risk-free"].includes(t)
      ),
    decision: "REJECT",
    priority: 1,
  },
  {
    id: "R003",
    name: "Suspicious redirect chain detected",
    check: (input) => input.riskSignals.includes("suspicious_redirect"),
    decision: "REJECT",
    priority: 2,
  },
  {
    id: "R004",
    name: "High risk domain detected",
    check: (input) => input.riskSignals.includes("high_risk_domain"),
    decision: "REJECT",
    priority: 2,
  },
  {
    id: "R005",
    name: "QR code present - needs review",
    check: (input) => input.riskSignals.includes("qr_code_found"),
    decision: "MANUAL_REVIEW",
    priority: 5,
  },
  {
    id: "R006",
    name: "Short link usage detected",
    check: (input) => input.riskSignals.includes("short_link_detected"),
    decision: "MANUAL_REVIEW",
    priority: 5,
  },
  {
    id: "R007",
    name: "Telegram handle does not match project",
    check: (input) => input.riskSignals.includes("telegram_mismatch"),
    decision: "MANUAL_REVIEW",
    priority: 6,
  },
  {
    id: "R008",
    name: "Contains wallet connect / claim language",
    check: (input) =>
      input.entities.riskTerms.some((t) =>
        ["connect wallet", "wallet connect", "claim", "claim now"].includes(t)
      ),
    decision: "MANUAL_REVIEW",
    priority: 7,
  },
];

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const matchedRules: Rule[] = [];

  for (const rule of RULES) {
    if (rule.check(input)) {
      matchedRules.push(rule);
    }
  }

  if (matchedRules.length === 0) {
    return {
      decision: "PASS",
      matchedRules: [],
      explanation: "Auto-approval mode enabled. Audit passed by default.",
    };
  }

  matchedRules.sort((a, b) => a.priority - b.priority);
  const topRule = matchedRules[0];

  return {
    decision: "PASS" as AuditDecision,
    matchedRules: matchedRules.map((r) => `${r.id}: ${r.name}`),
    explanation: `Auto-approval mode enabled. Audit passed by default. Matched ${matchedRules.length} informational rule(s). Top rule: ${topRule.id} - ${topRule.name}.`,
  };
}
