// Small shared pieces that make workflow screens read like a real internal tool.
import type { PillVersion } from "../types";
import { Avatar, Term } from "./Term";
import { persona } from "../lib/glossary";

const ROLE_LABEL: Record<string, string> = {
  operator: "Operator", expert: "Expert", reviewer: "Reviewer", approver: "Approver", viewer: "Viewer",
};

/** "Waiting for Priya Nair (Reviewer) to …" — what a real task tool shows, plus a small demo-only hint. */
export function WaitingFor({ role, task }: { role: string; task: string }) {
  const p = persona(role);
  return (
    <div className="waiting">
      <Avatar actor={role} size={26} />
      <span>Waiting for <b>{p.name}</b> ({ROLE_LABEL[role] ?? role}) to {task}.</span>
      <span className="demo-chip" title="In a real deployment each person signs in as themselves.">Demo · switch to {ROLE_LABEL[role] ?? role} at top right</span>
    </div>
  );
}

/** Small demo-only hint, visually separate from product UI. */
export function DemoHint({ children }: { children: React.ReactNode }) {
  return <div className="demo-hint"><span className="demo-chip">Demo</span> {children}</div>;
}

const INPUT_PLAIN: Record<string, string> = {
  water_rise_mm_min: "Water level change (mm/min)",
  pump_running: "Pump light on",
  critical_equipment_exposed: "Electrical equipment at risk",
  alternative_route_verified: "Other entrance checked safe",
  tenant_arrivals_expected: "Tenants arriving",
  drain_backflow: "Water backing up from the drain",
};
const OP_PLAIN: Record<string, string> = { gt: "above", gte: "at or above", lt: "below", lte: "at or below", eq: "is", ne: "is not" };
function cond(c: { input: string; op: string; value: boolean | number | string }) {
  const label = INPUT_PLAIN[c.input] ?? c.input.replace(/_/g, " ");
  if (typeof c.value === "boolean") return `${label}: ${c.value ? "yes" : "no"}`;
  return `${label} ${OP_PLAIN[c.op] ?? c.op} ${c.value}`;
}

/** Plain-language summary of what changed between two pill versions. Raw diff stays available underneath. */
export function PlainChanges({ before, after }: { before: PillVersion["content"]; after: PillVersion["content"] }) {
  const act = (id: string) => (after.actions.find((a) => a.id === id)?.description ?? id.replace(/_/g, " ")).replace(/\.$/, "");
  const oldInputs = new Set(before.inputs.map((i) => i.key));
  const newInputs = after.inputs.filter((i) => !oldInputs.has(i.key));
  const oldRules = new Map(before.rules.map((r) => [r.id, JSON.stringify(r)]));
  const newRules = after.rules.filter((r) => !oldRules.has(r.id));
  const changedRules = after.rules.filter((r) => oldRules.has(r.id) && oldRules.get(r.id) !== JSON.stringify(r));
  const newInsights = after.expert_observations.filter((o) => !before.expert_observations.includes(o));
  const oldEvidence = new Set(before.evidence.map((e) => e.id));
  const newEvidence = after.evidence.filter((e) => !oldEvidence.has(e.id));
  const testsBefore = before.evaluation.length;
  const testsAfter = after.evaluation.length;

  return (
    <ul className="plain-changes">
      {newInsights.map((o) => (
        <li key={o}><span className="chg chg-add">New insight</span> “{o}”</li>
      ))}
      {newInputs.map((i) => (
        <li key={i.key}><span className="chg chg-add">New reading required</span> {INPUT_PLAIN[i.key] ?? i.key} — the pill will now <Term k="abstain">refuse to advise</Term> without it.</li>
      ))}
      {newRules.map((r) => (
        <li key={r.id}>
          <span className="chg chg-add">New rule</span> If {r.when.map(cond).join(" and ")}
          {r.recommend.length > 0 && <> → suggest {r.recommend.map(act).join("; ")}</>}
          {r.block.length > 0 && <> → <b>block</b> {r.block.map(act).join("; ")}</>}
          {r.escalate_to && <> → escalate to <b>{r.escalate_to}</b></>}
        </li>
      ))}
      {changedRules.map((r) => (
        <li key={r.id}><span className="chg chg-mod">Rule updated</span> {r.rationale}</li>
      ))}
      {testsAfter !== testsBefore ? (
        <li><span className="chg chg-mod">Test situations</span> {testsBefore} → {testsAfter}. Every existing situation is kept and must still pass.</li>
      ) : (
        <li><span className="chg chg-mod">Test situations</span> All {testsAfter} existing situations updated to include the new reading; all must still pass.</li>
      )}
      {newEvidence.map((e) => (
        <li key={e.id}><span className="chg chg-src">Source</span> {e.kind === "feedback" ? "Operator feedback from the last incident" : e.summary}</li>
      ))}
    </ul>
  );
}
