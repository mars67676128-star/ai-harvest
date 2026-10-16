// Shared display formatters so every screen shows people, times, values and rules the same way.
import { persona } from "./glossary";

const ROLE_LABEL: Record<string, string> = {
  operator: "Operator", expert: "Expert", reviewer: "Reviewer", approver: "Approver", viewer: "Viewer",
};

/** "Priya Nair (Reviewer)" instead of "reviewer". */
export function actorLabel(actor: string | null | undefined): string {
  if (!actor) return "—";
  const key = String(actor).replace(/^demo[-_]/, "");
  const p = persona(key);
  return ROLE_LABEL[key] ? `${p.name} (${ROLE_LABEL[key]})` : p.name;
}

/** All times in Singapore time, e.g. "16 Oct, 19:32". */
export function sgTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const READING_LABEL: Record<string, string> = {
  water_rise_mm_min: "Water level change",
  pump_running: "Pump status",
  critical_equipment_exposed: "Electrical equipment at risk",
  alternative_route_verified: "Other entrance checked safe",
  tenant_arrivals_expected: "Tenants arriving",
  drain_backflow: "Water backing up from drain",
};
export function readingLabel(key: string): string {
  return READING_LABEL[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Human words for reading values: "Running" / "Yes" / "+3 mm/min". */
export function readingValue(key: string, value: unknown, unit = ""): string {
  if (typeof value === "boolean") {
    if (key === "pump_running") return value ? "Running" : "Not running";
    return value ? "Yes" : "No";
  }
  if (key === "water_rise_mm_min" && typeof value === "number") {
    if (value > 0) return `Rising ${value} mm/min`;
    if (value < 0) return `Falling ${Math.abs(value)} mm/min`;
    return "Steady";
  }
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

/** Plain-English rule condition, e.g. "Water is rising AND pump shows running". */
export function conditionText(c: { input: string; op: string; value: boolean | number | string }): string {
  const v = c.value;
  const pos = c.op === "ne" ? !v : v;
  switch (c.input) {
    case "water_rise_mm_min":
      if ((c.op === "gt" && Number(v) >= 0) || (c.op === "gte" && Number(v) > 0)) return "water is rising";
      if ((c.op === "lte" && Number(v) <= 0) || (c.op === "lt" && Number(v) <= 0)) return "water is steady or falling";
      break;
    case "pump_running": return pos ? "pump shows running" : "pump is not running";
    case "critical_equipment_exposed": return pos ? "electrical equipment is at risk" : "no electrical equipment at risk";
    case "alternative_route_verified": return pos ? "the other entrance is checked safe" : "the other entrance is not checked yet";
    case "tenant_arrivals_expected": return pos ? "tenants are arriving" : "no tenants are arriving";
    case "drain_backflow": return pos ? "water is backing up from the drain" : "no water backing up from the drain";
  }
  const ops: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", ne: "≠" };
  return `${readingLabel(c.input).toLowerCase()} ${ops[c.op] ?? c.op} ${String(v)}`;
}
export function conditionsText(when: Array<{ input: string; op: string; value: boolean | number | string }>): string {
  const t = when.map(conditionText).join(" AND ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Remove demo-data labels from content; one global banner covers it instead. */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  if (/^Compiled from capture:/i.test(String(text))) return "First version, compiled from the expert interview";
  return String(text)
    .replace(/^SYNTHETIC[A-Z ]*:\s*/i, "")
    .replace(/SYNTHETIC scripted (\w+);\s*demo role simulation, not qualified field approval\.?/i, "Signed off ($1)")
    .replace(/Synthetic verified demo observation/gi, "Verified reading")
    .replace(/Synthetic interview fixture;\s*not a real professional interview\.?/gi, "Expert interview")
    .replace(/^Synthetic regression:\s*/i, "")
    .replace(/^Synthetic fixture \w+[:.]\s*/i, "")
    .replace(/A qualified human owns the decision\.\s*No action is executed\.?/i, "You make the call. Sifu doesn't trigger any equipment or send any messages.")
    .replace(/Verified observations and qualified human assessment remain necessary\.?/i, "Check the situation on site before acting.")
    .replace(/\s*\(?(capture|feedback|extraction)?:?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)?/gi, "")
    .trim();
}
export function isDemoDisclaimer(text: string): boolean {
  return /synthetic|fictional/i.test(text) && /all operational values|people in this artifact|demo/i.test(text);
}
