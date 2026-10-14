import type {
  CaseRecord,
  Dashboard,
  PillVersion,
  RecommendationRecord,
} from "./types";

const API_BASE = "/api/v1";

// Demo bearer tokens — publicly documented, insecure credentials for local demo only.
const TOKENS: Record<string, string> = {
  expert: "demo-expert",
  reviewer: "demo-reviewer",
  approver: "demo-approver",
  operator: "demo-operator",
  viewer: "demo-viewer",
};

let currentRole = "operator";

export function setRole(role: string) {
  currentRole = role;
}

export function getRole(): string {
  return currentRole;
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${TOKENS[currentRole] ?? TOKENS.viewer}` };
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    const code = data?.error?.code ?? "UNKNOWN";
    throw new Error(`[${code}] ${msg}`);
  }
  return data as T;
}

// --- API methods ---

export async function getHealth(): Promise<{
  status: string;
  environment: string;
  provider: string;
  synthetic_demo: boolean;
}> {
  const res = await fetch("/health");
  return res.json();
}

export async function getDashboard(): Promise<Dashboard> {
  return request<Dashboard>("/dashboard");
}

export async function getPills(): Promise<PillVersion[]> {
  return request<PillVersion[]>("/pills");
}

export async function getPillVersion(pillId: string, version: string): Promise<PillVersion> {
  return request<PillVersion>(`/pills/${pillId}/versions/${version}`);
}

export async function getCases(): Promise<CaseRecord[]> {
  return request<CaseRecord[]>("/cases");
}

export async function getCase(caseId: string): Promise<CaseRecord> {
  return request<CaseRecord>(`/cases/${caseId}`);
}

export async function getRecommendations(): Promise<RecommendationRecord[]> {
  return request<RecommendationRecord[]>("/recommendations");
}

export async function getRecommendation(id: string): Promise<RecommendationRecord> {
  return request<RecommendationRecord>(`/recommendations/${id}`);
}

export async function createCase(body: {
  title: string;
  asset_id: string;
  asset_type: string;
  equipment: string;
  context: string;
  observations: Record<string, unknown>;
  synthetic: boolean;
}): Promise<CaseRecord> {
  return request<CaseRecord>("/cases", "POST", body);
}

export async function invokeCase(
  caseId: string,
  pillIds: string[],
  includeAiExplanation = true
): Promise<RecommendationRecord> {
  return request<RecommendationRecord>(`/cases/${caseId}/invoke`, "POST", {
    pill_ids: pillIds,
    include_ai_explanation: includeAiExplanation,
  });
}

export async function recordDecision(
  recommendationId: string,
  decision: "approve" | "reject" | "correct" | "escalate",
  note: string
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/recommendations/${recommendationId}/decision`,
    "POST",
    { decision, note }
  );
}
