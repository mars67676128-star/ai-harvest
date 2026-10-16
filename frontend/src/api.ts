import type {
  CaseRecord,
  Dashboard,
  PillVersion,
  RecommendationRecord,
  Feedback,
  DiffResult,
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

export async function getPillVersions(pillId: string): Promise<PillVersion[]> {
  return request<PillVersion[]>(`/pills/${pillId}/versions`);
}

export interface AuditEntry {
  sequence: number;
  event: string;
  entity_id: string;
  actor: string;
  created_at: string;
  detail: Record<string, unknown>;
}

export interface AuditHistory {
  items: AuditEntry[];
  next_after: number;
}

export async function getAuditHistory(
  entityId?: string,
  after = 0,
  limit = 100
): Promise<AuditHistory> {
  const params = new URLSearchParams();
  if (entityId) params.set("entity_id", entityId);
  params.set("after", String(after));
  params.set("limit", String(limit));
  return request<AuditHistory>(`/audit?${params.toString()}`);
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

export async function recordOutcome(
  recommendationId: string,
  summary: string,
  resolved: boolean,
  synthetic: boolean
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/recommendations/${recommendationId}/outcome`,
    "POST",
    { summary, resolved, synthetic }
  );
}

export async function submitFeedback(
  recommendationId: string,
  pillId: string,
  correction: string,
  proposedVersion: string
): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/recommendations/${recommendationId}/feedback`,
    "POST",
    { pill_id: pillId, correction, proposed_version: proposedVersion }
  );
}

export async function getFeedback(feedbackId: string): Promise<Feedback> {
  return request<Feedback>(`/feedback/${feedbackId}`);
}

export async function proposeCandidate(
  feedbackId: string
): Promise<PillVersion> {
  return request<PillVersion>(`/feedback/${feedbackId}/propose`, "POST");
}

export async function getPillDiff(
  pillId: string,
  fromVersion: string,
  toVersion: string
): Promise<DiffResult> {
  const params = new URLSearchParams();
  params.set("from_version", fromVersion);
  params.set("to_version", toVersion);
  return request<DiffResult>(`/pills/${pillId}/diff?${params.toString()}`);
}

export async function transitionPill(
  pillId: string,
  version: string,
  operation: "submit" | "review" | "validate" | "approve" | "reject" | "deprecate",
  note = ""
): Promise<PillVersion> {
  return request<PillVersion>(
    `/pills/${pillId}/versions/${version}/${operation}`,
    "POST",
    { note }
  );
}

// --- Capture: guided interview → AI extraction (draft pill content) ---

export interface ElicitationQuestion { technique: string; question: string }

export async function getElicitation(): Promise<ElicitationQuestion[]> {
  return request<ElicitationQuestion[]>("/elicitation");
}

export interface CaptureRecord {
  id: string;
  title: string;
  transcript: string;
  domain: string;
  synthetic: boolean;
  author: string;
  created_at: string;
}

export async function createCapture(body: {
  title: string;
  transcript: string;
  domain: string;
  synthetic: boolean;
}): Promise<CaptureRecord> {
  return request<CaptureRecord>("/captures", "POST", body);
}

export interface ExtractionRecord {
  id: string;
  created_at: string;
  summary: string;
  elicitation_gaps: string[];
  content: import("./types").PillVersion["content"];
  ai: { provider?: string; model?: string; live?: boolean; prompt_version?: string; [k: string]: unknown };
}

export async function extractCapture(captureId: string): Promise<ExtractionRecord> {
  return request<ExtractionRecord>(`/captures/${captureId}/extract`, "POST");
}
