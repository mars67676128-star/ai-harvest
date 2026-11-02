import { getRole, type SifuAnswer } from "./api";

const API_BASE = "/api/v1";
const TOKENS: Record<string, string> = {
  expert: "demo-expert",
  reviewer: "demo-reviewer",
  approver: "demo-approver",
  operator: "demo-operator",
  viewer: "demo-viewer",
};

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const role = getRole();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKENS[role] ?? TOKENS.viewer}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const code = data?.error?.code ?? "UNKNOWN";
    const message = data?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`[${code}] ${message}`);
  }
  return data as T;
}

export interface SifuThreadMessage {
  id: string;
  kind: "employee_message" | "expert_message" | "sifu_message";
  created_at: string;
  role: "employee" | "expert" | "sifu";
  speaker: string;
  content: string;
  answer?: SifuAnswer;
}

export interface ExpertiseRequest {
  id: string;
  parent_id: string;
  created_at: string;
  expert_id: string;
  expert_name: string;
  expert_role: string;
  reason: string;
  requested_by: string;
  status: "pending" | "responded";
  response?: Record<string, unknown> | null;
  conversation_title?: string;
  created_by?: string;
}

export interface SifuConversation {
  id: string;
  kind: "sifu_conversation";
  parent_id: null;
  created_at: string;
  title: string;
  created_by: string;
  messages: SifuThreadMessage[];
  expertise_requests: ExpertiseRequest[];
}

export interface ExpertResponseResult {
  response: Record<string, unknown>;
  sifu?: SifuAnswer | null;
  sifu_error?: { code: string; message: string } | null;
  conversation: SifuConversation;
}

export type KnowledgeCandidateStatus =
  | "awaiting_expert_confirmation"
  | "not_reusable"
  | "awaiting_owner_validation"
  | "validated"
  | "changes_requested"
  | "rejected";

export interface KnowledgeCandidate {
  id: string;
  kind: "knowledge_candidate";
  parent_id: string;
  created_at: string;
  title: string;
  principle: string;
  applies_when: string[];
  checks: string[];
  escalate_when: string[];
  exceptions: string[];
  rationale?: string | null;
  source_experts: string[];
  unresolved_questions: string[];
  domain: string;
  knowledge_owner_id: string;
  knowledge_owner_name: string;
  source_request_id: string;
  source_expert_id: string;
  source_expert_name: string;
  status: KnowledgeCandidateStatus;
  expert_decision?: Record<string, unknown> | null;
  owner_decision?: Record<string, unknown> | null;
}

export async function startSifuConversation(question: string): Promise<SifuConversation> {
  return request<SifuConversation>("/sifu/conversations", "POST", { question, context: {} });
}

export async function addSifuMessage(
  conversationId: string,
  content: string,
): Promise<SifuConversation> {
  return request<SifuConversation>(`/sifu/conversations/${conversationId}/messages`, "POST", {
    content,
    context: {},
  });
}

export async function routeSifuExpert(
  conversationId: string,
  expertId: string,
): Promise<ExpertiseRequest> {
  return request<ExpertiseRequest>(`/sifu/conversations/${conversationId}/route`, "POST", {
    expert_id: expertId,
  });
}

export async function getSifuConversation(conversationId: string): Promise<SifuConversation> {
  return request<SifuConversation>(`/sifu/conversations/${conversationId}`);
}

export async function listExpertiseRequests(): Promise<ExpertiseRequest[]> {
  return request<ExpertiseRequest[]>("/sifu/expertise-requests");
}

export async function respondToExpertiseRequest(
  requestId: string,
  content: string,
  outcome: "answer" | "not_my_area" | "need_more_information" | "dont_know" = "answer",
): Promise<ExpertResponseResult> {
  return request<ExpertResponseResult>(`/sifu/expertise-requests/${requestId}/respond`, "POST", {
    content,
    outcome,
  });
}

export async function draftKnowledgeCandidate(
  conversationId: string,
  sourceRequestId: string,
): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/sifu/conversations/${conversationId}/candidate`, "POST", {
    source_request_id: sourceRequestId,
  });
}

export async function decideKnowledgeCandidate(
  candidateId: string,
  decision: "confirm" | "not_reusable",
  note = "",
): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/sifu/knowledge-candidates/${candidateId}/decision`, "POST", {
    decision,
    note,
  });
}

export async function listKnowledgeReviews(): Promise<KnowledgeCandidate[]> {
  return request<KnowledgeCandidate[]>("/sifu/reviews");
}

export async function decideKnowledgeOwnerReview(
  candidateId: string,
  decision: "validate" | "request_changes" | "reject",
  note = "",
): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/sifu/knowledge-candidates/${candidateId}/owner-decision`, "POST", {
    decision,
    note,
  });
}
