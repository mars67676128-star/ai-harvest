import type { PillVersion } from "../types";

// Browser-side *pointers* only. All state shown in the UI is read back from the backend;
// these keys just remember which recommendation / feedback record the demo is following,
// because the backend does not list feedback per recommendation and some roles cannot
// read recommendations directly.

export const LS_REC = "harvest.ke.recId";
const fbKey = (recId: string) => `harvest.ke.feedback.${recId}`;
const recCacheKey = (recId: string) => `harvest.ke.rec.${recId}`;
const rejectKey = (pillId: string, version: string) => `harvest.ke.reject.${pillId}@${version}`;

export function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
export function lsDel(k: string) {
  try { localStorage.removeItem(k); } catch { /* ignore */ }
}

export function setActiveRec(recId: string) { lsSet(LS_REC, recId); }
export function getActiveRec(): string | null { return lsGet(LS_REC); }

export function cacheRec(rec: { id: string }) { lsSet(recCacheKey(rec.id), JSON.stringify(rec)); }
export function getCachedRec<T>(recId: string): T | null {
  const raw = lsGet(recCacheKey(recId));
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
export function forgetRec(recId: string) {
  lsDel(recCacheKey(recId));
  lsDel(fbKey(recId));
  if (lsGet(LS_REC) === recId) lsDel(LS_REC);
}

/** Feedback ids submitted for a recommendation, oldest first (one per learning attempt). */
export function getFeedbackIds(recId: string): string[] {
  const raw = lsGet(fbKey(recId));
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [raw]; // legacy single value
  }
}
export function addFeedbackId(recId: string, id: string) {
  const ids = getFeedbackIds(recId).filter((x) => x !== id);
  ids.push(id);
  lsSet(fbKey(recId), JSON.stringify(ids));
}
export function setFeedbackIds(recId: string, ids: string[]) {
  lsSet(fbKey(recId), JSON.stringify(ids));
}

/** The note a reviewer typed when rejecting — kept so the author sees it even when their
 *  role cannot read the audit endpoint. The audit log remains the authoritative record. */
export function rememberRejection(pillId: string, version: string, note: string, actor: string) {
  lsSet(rejectKey(pillId, version), JSON.stringify({ note, actor, at: new Date().toISOString() }));
}
export function getRememberedRejection(pillId: string, version: string): { note: string; actor: string; at: string } | null {
  const raw = lsGet(rejectKey(pillId, version));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function semverCmp(a: string, b: string): number {
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Version number for the next learning attempt: minor bump on first revision of the
 *  active release, patch bump after a rejected attempt (1.1.0 → 1.1.1). */
export function nextCandidateVersion(vers: PillVersion[]): string {
  if (vers.length === 0) return "1.1.0";
  const active = vers.find((v) => v.status === "APPROVED");
  const max = [...vers].sort((a, b) => semverCmp(b.version, a.version))[0].version;
  const [maj, min, pat] = max.split(".").map(Number);
  if (active && active.version === max) return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${(pat ?? 0) + 1}`;
}

/** The candidate version produced from a given feedback record (matched by its evidence citation). */
export function candidateForFeedback(vers: PillVersion[], feedbackId: string | null): PillVersion | null {
  if (!feedbackId) return null;
  return vers.find((v) => v.content.evidence.some((e) => e.citation === `feedback:${feedbackId}`)) ?? null;
}
