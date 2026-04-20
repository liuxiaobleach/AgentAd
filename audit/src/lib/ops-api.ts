// Ops-scoped fetch helper. Uses a separate localStorage key so an ops session
// doesn't collide with advertiser or publisher sessions — all three UIs can
// coexist in the same browser.
export const OPS_TOKEN_KEY = "zkdsp_ops_token";
export const OPS_USER_KEY = "zkdsp_ops_user";

export function opsApiFetch(url: string, options?: RequestInit): Promise<Response> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem(OPS_TOKEN_KEY) : null;

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { ...options, headers });
}

export function getOpsToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(OPS_TOKEN_KEY);
}

export function setOpsSession(token: string, user: OpsUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(OPS_TOKEN_KEY, token);
  localStorage.setItem(OPS_USER_KEY, JSON.stringify(user));
}

export function clearOpsSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(OPS_TOKEN_KEY);
  localStorage.removeItem(OPS_USER_KEY);
}

export function getOpsUser(): OpsUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(OPS_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpsUser;
  } catch {
    return null;
  }
}

export type OpsUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type OpsAuditCase = {
  id: string;
  creativeId: string;
  status: string;
  riskScore: number | null;
  decision: string | null;
  policyVersion: string;
  summary: string | null;
  agentThinking: unknown;
  submittedAt: string;
  completedAt: string | null;
  reviewerId?: string | null;
  reviewerName?: string;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  advertiserId?: string;
  advertiserName?: string;
  advertiserEmail?: string;
  creative?: {
    id: string;
    creativeName: string;
    projectName: string;
    imageUrl: string | null;
  };
  evidences?: Array<{
    id: string;
    toolName: string;
    payload: unknown;
    riskSignals: unknown;
    createdAt: string;
  }>;
  attestation?: {
    attestationId: string;
    txHash: string | null;
    status: string;
  } | null;
};

export type OpsReviewLog = {
  id: string;
  auditCaseId: string;
  reviewerId: string;
  reviewerName?: string;
  previousDecision: string | null;
  newDecision: string;
  previousStatus: string | null;
  newStatus: string;
  notes: string | null;
  createdAt: string;
  creativeName?: string;
  projectName?: string;
};
