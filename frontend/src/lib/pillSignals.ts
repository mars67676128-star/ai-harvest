// Trust signals for a pill: when it was last signed off, when it is due for
// review, and how often operators have actually used it. Read-only: derived from
// data the backend already records (approval record, recommendations, audit).
import type { PillVersion, RecommendationRecord } from "../types";
import type { AuditEntry } from "../api";

/** Review cycle shown in the UI. A policy assumption for the demo, not a backend rule. */
export const REVIEW_MONTHS = 6;

export type Freshness = "ok" | "soon" | "overdue";

export interface ReviewInfo {
  approvedAt: Date;
  approvedBy: string | null;
  dueAt: Date;
  state: Freshness;
}

export function reviewInfo(p: PillVersion | null | undefined, now = new Date()): ReviewInfo | null {
  const approval = p?.approval as { at?: string; actor?: string } | null | undefined;
  if (!approval?.at) return null;
  const approvedAt = new Date(approval.at);
  if (Number.isNaN(approvedAt.getTime())) return null;
  const dueAt = new Date(approvedAt);
  dueAt.setMonth(dueAt.getMonth() + REVIEW_MONTHS);
  const days = (dueAt.getTime() - now.getTime()) / 86_400_000;
  return { approvedAt, approvedBy: approval.actor ?? null, dueAt, state: days < 0 ? "overdue" : days <= 30 ? "soon" : "ok" };
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
}

export interface Usage {
  count: number;
  last: string | null;
}

/** Times each pill was used in a live assessment, from the operator's own cases. */
export function usageFromRecs(recs: RecommendationRecord[] | null | undefined): Record<string, Usage> | null {
  if (!recs) return null;
  const out: Record<string, Usage> = {};
  for (const r of recs) {
    for (const cap of r.capabilities ?? []) {
      const u = (out[cap.pill_id] ??= { count: 0, last: null });
      u.count += 1;
      if (!u.last || r.created_at > u.last) u.last = r.created_at;
    }
  }
  return out;
}

/** The same counts from the audit trail (reviewers and approvers can read it). */
export function usageFromAudit(entries: AuditEntry[] | null | undefined): Record<string, Usage> | null {
  if (!entries) return null;
  const out: Record<string, Usage> = {};
  for (const e of entries) {
    if (e.event !== "PILL_INVOKED") continue;
    const u = (out[e.entity_id] ??= { count: 0, last: null });
    u.count += 1;
    if (!u.last || e.created_at > u.last) u.last = e.created_at;
  }
  return out;
}

export function usageText(u: Usage | undefined): string {
  if (!u || u.count === 0) return "Not used in a live case yet";
  return `Used in ${u.count} live case${u.count === 1 ? "" : "s"}, last on ${shortDate(new Date(u.last!))}`;
}
