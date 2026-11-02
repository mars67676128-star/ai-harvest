// Reads the backend's governance outcome for a pill version and turns it into
// review states people understand. Nothing here changes governance logic: it
// only interprets what the backend already recorded (status, validation report,
// open questions, change reason).
import type { PillVersion } from "../types";

export interface AcceptanceRow {
  case_id: string;
  passed: boolean;
  expected?: { decision?: string; actions?: string[]; blocked?: string[] };
  actual?: { decision?: string; actions?: string[]; blocked?: string[] };
}

export interface Acceptance {
  passed: boolean;
  results: AcceptanceRow[];
}

export type StageKey =
  | "ai_draft"
  | "corrected_draft"
  | "needs_review"
  | "checks_failed"
  | "validation_passed"
  | "approved"
  | "clarification"
  | "rejected"
  | "superseded"
  | "retired";

export interface Stage {
  key: StageKey;
  label: string;
}

/** Source-grounded acceptance results the server attached at validation, if any. */
export function acceptanceOf(p: PillVersion | null | undefined): Acceptance | null {
  const a = (p?.validation as Record<string, unknown> | null | undefined)?.acceptance as Acceptance | undefined;
  if (!a || typeof a.passed !== "boolean") return null;
  return { passed: a.passed, results: Array.isArray(a.results) ? a.results : [] };
}

export function failedChecks(p: PillVersion | null | undefined): AcceptanceRow[] {
  return (acceptanceOf(p)?.results ?? []).filter((r) => !r.passed);
}

/** Questions or contradictions the AI could not resolve from the source. */
export function openQuestions(p: PillVersion | null | undefined): string[] {
  if (!p) return [];
  return [...(p.content.unresolved_questions ?? []), ...(p.content.contradictions ?? [])];
}

export function isHumanCorrected(p: PillVersion | null | undefined): boolean {
  return /HUMAN CORRECTION/i.test(p?.change_reason ?? "");
}

/** The AI draft a human correction replaced, and the checks that draft failed. */
export function correctionSource(p: PillVersion | null | undefined): { aiDraft: string | null; failed: string[] } | null {
  if (!isHumanCorrected(p)) return null;
  const reason = p?.change_reason ?? "";
  const draft = reason.match(/AI draft v([\w.-]+)/i)?.[1] ?? null;
  const failedPart = reason.split(/failed semantic acceptance:\s*/i)[1] ?? "";
  const failed = failedPart.split(",").map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
  return { aiDraft: draft, failed };
}

export function validationPassed(p: PillVersion | null | undefined): boolean {
  const v = p?.validation as Record<string, unknown> | null | undefined;
  if (!v || v.passed !== true) return false;
  const a = acceptanceOf(p);
  return a ? a.passed : true;
}

const isOpen = (p: PillVersion) => p.status === "DRAFT" || p.status === "IN_REVIEW";

export function stageOf(p: PillVersion): Stage {
  switch (p.status) {
    case "APPROVED": return { key: "approved", label: "Approved" };
    case "SUPERSEDED": return { key: "superseded", label: "Superseded" };
    case "DEPRECATED": return { key: "retired", label: "Retired" };
    case "REJECTED": return { key: "rejected", label: "Not released" };
  }
  if (isOpen(p) && openQuestions(p).length > 0) {
    return { key: "clarification", label: p.previous_version ? "Revision blocked · clarification required" : "Clarification required" };
  }
  if (failedChecks(p).length > 0) return { key: "checks_failed", label: "Needs review" };
  if (validationPassed(p)) return { key: "validation_passed", label: "Validation passed" };
  if (p.status === "IN_REVIEW") return { key: "needs_review", label: "Needs review" };
  return isHumanCorrected(p)
    ? { key: "corrected_draft", label: "Draft" }
    : { key: "ai_draft", label: "AI-generated draft" };
}

/** Where the version's content came from: an AI draft, or a human correction of one. */
export function provenanceOf(p: PillVersion): Stage | null {
  if (isHumanCorrected(p)) return { key: "corrected_draft", label: "Human corrected" };
  if (stageOf(p).key === "ai_draft") return null; // the stage chip already says it
  return { key: "ai_draft", label: "AI-drafted" };
}

// Plain-language names for the server's source-grounded check IDs.
const CHECK_NAMES: Record<string, string> = {
  "ops-rising-escalate": "Water rising while the pump shows running",
  "ops-stable-human-review": "Water steady, pump running, nothing at risk",
  "ops-critical-escalate-blocks-access": "Electrical equipment at risk",
  "ops-missing-abstain": "Required readings missing",
  "ops-scope-abstain": "Outside the pill's scope (different building type)",
  "tenant-unverified-escalate": "Other route not checked, tenants arriving",
  "tenant-verified-human-review": "Other route checked, tenants arriving",
  "tenant-missing-abstain": "Required readings missing",
};

const DECISION_WORDS: Record<string, string> = {
  ESCALATE: "Escalate",
  HUMAN_REVIEW: "Person reviews",
  ABSTAIN: "No advice (not enough data)",
};

const ACTION_WORDS: Record<string, string> = {
  inspect_drainage: "inspect drainage",
  monitor_trend: "routine monitoring",
  review_access_plan: "access plan changes",
  draft_tenant_update: "tenant update",
  tenant_liaison: "tenant liaison",
};
const act = (id: string) => ACTION_WORDS[id] ?? id.replace(/_/g, " ");

/** What the draft got wrong for one check, in plain words. */
export function checkDifference(row: AcceptanceRow): string {
  const e = row.expected ?? {}, a = row.actual ?? {};
  const parts: string[] = [];
  if (e.decision !== a.decision) parts.push(`Expected: ${decisionWord(e.decision)} · Draft gave: ${decisionWord(a.decision)}`);
  const missingBlock = (e.blocked ?? []).filter((x) => !(a.blocked ?? []).includes(x));
  const extraBlock = (a.blocked ?? []).filter((x) => !(e.blocked ?? []).includes(x));
  const missingAct = (e.actions ?? []).filter((x) => !(a.actions ?? []).includes(x));
  const extraAct = (a.actions ?? []).filter((x) => !(e.actions ?? []).includes(x));
  if (missingBlock.length) parts.push(`Should block: ${missingBlock.map(act).join(", ")}`);
  if (extraBlock.length) parts.push(`Should not block: ${extraBlock.map(act).join(", ")}`);
  if (missingAct.length) parts.push(`Should suggest: ${missingAct.map(act).join(", ")}`);
  if (extraAct.length) parts.push(`Should not suggest: ${extraAct.map(act).join(", ")}`);
  return parts.join(" · ") || "Did not match the expert's source";
}

export function checkName(id: string): string {
  return CHECK_NAMES[id] ?? id.replace(/^(ops|tenant)-/, "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function decisionWord(d?: string): string {
  return d ? DECISION_WORDS[d] ?? d.replace(/_/g, " ").toLowerCase() : "—";
}

/** Matches backend codes that are intentional governance holds, not failures. */
export const GOVERNED_HOLD = /\b(SEMANTIC_REGRESSION|UNRESOLVED_KNOWLEDGE|INCOMPLETE_KNOWLEDGE)\b/;

// Plain-language names for a pill's own test situations (evaluation cases).
const TEST_TITLES: Record<string, string> = {
  rising: "Water rising while the pump shows running",
  stable: "Water steady, pump running, nothing at risk",
  critical: "Electrical equipment at risk",
  missing: "Required readings missing",
  scope: "Outside the pill's scope",
  "flat-but-backflow": "Water steady but backing up from the drain",
  "unverified-route": "Other entrance not checked, tenants arriving",
  "verified-route": "Other entrance checked, tenants arriving",
};

export function testTitle(id: string, description?: string): string {
  return TEST_TITLES[id] ?? (description ? description.replace(/^SYNTHETIC[^:]*:\s*/i, "") : id.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase()));
}

export function expectedText(decision?: string, actions: string[] = []): string {
  if (decision === "HUMAN_REVIEW" && actions.includes("monitor_trend")) return "Keep monitoring, a person confirms";
  return decisionWord(decision);
}
