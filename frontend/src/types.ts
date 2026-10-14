// Types matching the AI HARVEST backend models (harvest/models.py)

export type Decision = "HUMAN_REVIEW" | "ESCALATE" | "ABSTAIN";
export type Status = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "DEPRECATED";
export type Domain =
  | "Asset Operations"
  | "Energy Optimisation"
  | "Leasing"
  | "Technical Services"
  | "Sustainability"
  | "Tenant Experience";

export interface Actor {
  id: string;
  roles: string[];
}

export interface Observation {
  value: boolean | number | string;
  unit: string;
  source: string;
  observed_at: string;
  quality: "verified" | "unverified" | "conflicting";
}

export interface CaseInput {
  title: string;
  asset_id: string;
  asset_type: string;
  equipment: string;
  context: string;
  observations: Record<string, Observation>;
  synthetic: boolean;
}

export interface CaseRecord {
  id: string;
  kind: "case";
  parent_id: string | null;
  created_at: string;
  case: CaseInput;
  author: string;
}

export interface Action {
  id: string;
  description: string;
  human_approval_required: true;
}

export interface Evidence {
  id: string;
  kind: "expert_interview" | "public_context" | "incident" | "feedback";
  citation: string;
  summary: string;
  synthetic: boolean;
}

export interface RuleTraceEntry {
  rule_id: string;
  category: "heuristic" | "guardrail" | "escalation" | "exception";
  rationale: string;
  evidence_ids: string[];
  observations: Record<string, Observation>;
}

export interface CapabilityResult {
  pill_id: string;
  version: string;
  content_hash: string;
  domain: string;
  decision: Decision;
  actions: Action[];
  blocked_actions: string[];
  trace: RuleTraceEntry[];
  escalations: string[];
  assumptions: string[];
  boundaries: string[];
  evidence: Evidence[];
  execution_allowed: false;
}

export interface RuntimeResult {
  decision: Decision;
  actions: Action[];
  blocked_actions: string[];
  escalations: string[];
  execution_allowed: false;
  human_responsibility: string;
}

export interface RecommendationRecord {
  id: string;
  kind: "recommendation";
  parent_id: string;
  created_at: string;
  case_id: string;
  result: RuntimeResult;
  capabilities: CapabilityResult[];
  observations: Record<string, Observation>;
  ai_explanation: {
    summary: string;
    uncertainty: string;
    authoritative: false;
  } | null;
  ai: {
    status: string;
    [key: string]: unknown;
  };
  synthetic: boolean;
  actor: string;
  evaluated_at: string | null;
  valid_until: string | null;
  human_decision: {
    decision: "approve" | "reject" | "correct" | "escalate";
    note: string;
    actor: string;
    execution_allowed: false;
  } | null;
  outcome: {
    summary: string;
    resolved: boolean;
    synthetic: boolean;
    actor: string;
  } | null;
}

export interface PillVersion {
  pill_id: string;
  version: string;
  owner: string;
  reviewers: string[];
  content: {
    name: string;
    domain: Domain;
    description: string;
    scope: {
      asset_types: string[];
      equipment: string[];
      contexts: string[];
      prerequisites: string[];
      exclusions: string[];
    };
    inputs: Array<{
      key: string;
      description: string;
      kind: "number" | "boolean" | "string";
      required: boolean;
      unit: string;
      max_age_seconds: number;
      minimum: number | null;
      maximum: number | null;
      choices: Array<boolean | number | string>;
    }>;
    facts: string[];
    expert_observations: string[];
    assumptions: string[];
    exceptions: string[];
    actions: Action[];
    prohibited_actions: string[];
    guardrails: string[];
    rules: Array<{
      id: string;
      category: "heuristic" | "guardrail" | "escalation" | "exception";
      when: Array<{ input: string; op: string; value: boolean | number | string }>;
      recommend: string[];
      block: string[];
      escalate_to: string | null;
      rationale: string;
      evidence_ids: string[];
    }>;
    evidence: Evidence[];
    dependencies: Array<{ pill_id: string; version: string }>;
    evaluation: Array<Record<string, unknown>>;
    unresolved_questions: string[];
    contradictions: string[];
    synthetic: boolean;
    schema_version: "1.0";
  };
  status: Status;
  author: string;
  created_at: string;
  content_hash: string;
  review: Record<string, unknown> | null;
  validation: Record<string, unknown> | null;
  approval: Record<string, unknown> | null;
  previous_version: string | null;
  change_reason: string;
}

export interface Dashboard {
  pill_states: Record<string, number>;
  workflow_counts: Record<string, number>;
  execution_allowed: false;
  purpose: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
  request_id: string;
}
