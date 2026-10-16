import type { PillVersion } from "../types";

// Portable exports of an Intelligence Pill version.
// JSON = the complete machine-readable record (vendor/model independent).
// PDF  = a printable "pill sheet" for people (opened in a print dialog → Save as PDF).

function fileBase(p: PillVersion): string {
  return `${p.pill_id}-v${p.version}`;
}

export function downloadPillJson(p: PillVersion) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase(p)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanise(id: string): string {
  const s = id.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function list(items: string[] | undefined, empty = "None recorded"): string {
  if (!items || items.length === 0) return `<p class="muted">${empty}</p>`;
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function gate(label: string, g: Record<string, unknown> | null): string {
  if (!g) return `<div class="gate"><b>${label}</b><span class="muted">Not recorded</span></div>`;
  const actor = String(g.actor ?? g.reviewer ?? g.approver ?? "—").replace(/^demo[-_]/, "");
  const at = String(g.at ?? g.timestamp ?? g.created_at ?? "").slice(0, 19).replace("T", " ");
  const note = g.note ? `<div class="muted">“${esc(g.note)}”</div>` : "";
  return `<div class="gate"><b>${label}</b><span>${esc(humanise(actor))}${at ? ` · ${esc(at)} UTC` : ""}</span>${note}</div>`;
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "#2f9e44", IN_REVIEW: "#b8650a", DRAFT: "#6b7775",
  REJECTED: "#d9443a", SUPERSEDED: "#6b7775", DEPRECATED: "#d9443a",
};

export function printPillSheet(p: PillVersion) {
  const c = p.content;
  const heuristic = c.expert_observations.find((o) => /running/i.test(o) && /drain/i.test(o)) ?? c.expert_observations[0];
  const rules = c.rules
    .map((r) => {
      const when = r.when.map((w) => `${esc(humanise(w.input))} ${esc(w.op)} ${esc(w.value)}`).join(" and ");
      const then = [
        r.recommend.length ? `recommend ${r.recommend.map(humanise).map(esc).join(", ")}` : "",
        r.block.length ? `block ${r.block.map(humanise).map(esc).join(", ")}` : "",
        r.escalate_to ? `escalate to ${esc(r.escalate_to)}` : "",
      ].filter(Boolean).join("; ");
      return `<tr><td><span class="tag ${r.category}">${esc(r.category)}</span></td><td><b>When</b> ${when || "—"}<br/><b>Then</b> ${then || "—"}<div class="muted">${esc(r.rationale)}</div></td></tr>`;
    })
    .join("");
  const inputs = c.inputs
    .map((i) => `<tr><td>${esc(humanise(i.key))}</td><td>${esc(i.description)}</td><td>${esc(i.kind)}${i.unit ? ` · ${esc(i.unit)}` : ""}${i.required ? " · required" : ""}</td></tr>`)
    .join("");
  const cases = (c.evaluation ?? [])
    .map((tc) => {
      const t = tc as Record<string, unknown>;
      const acts = ((t.expected_actions as string[]) ?? []).map(humanise).join(", ");
      const blocks = ((t.expected_blocked as string[]) ?? []).map(humanise).join(", ");
      return `<tr><td>${esc(t.id ?? "")}</td><td>${esc(t.description ?? "")}</td><td><b>${esc(t.expected_decision ?? "")}</b>${acts ? `<div class="muted">Expects: ${esc(acts)}</div>` : ""}${blocks ? `<div class="muted">Blocks: ${esc(blocks)}</div>` : ""}</td></tr>`;
    })
    .join("");
  const evidence = c.evidence
    .map((e) => `<li><b>${esc(humanise(e.kind))}</b>${e.synthetic ? ' <span class="tag synthetic">synthetic</span>' : ""} — ${esc(e.summary)}<div class="muted small">${esc(e.citation)}</div></li>`)
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(fileBase(p))} — Intelligence Pill</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Plus Jakarta Sans", -apple-system, sans-serif; color: #13201f; font-size: 11.5px; line-height: 1.55; margin: 0; }
  .brand { display:flex; justify-content:space-between; align-items:center; border-bottom: 3px solid #0d7377; padding-bottom: 8px; margin-bottom: 18px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color:#0d7377; font-weight:700; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -.02em; }
  h2 { font-size: 13px; margin: 22px 0 8px; color:#0d7377; }
  .meta { display:flex; gap:8px; flex-wrap:wrap; margin: 8px 0 14px; }
  .chip { padding: 2px 9px; border-radius: 99px; background:#eef2f1; font-weight:600; font-size: 10.5px; }
  .quote { border-left: 4px solid #0d7377; padding: 6px 0 6px 14px; font-size: 16px; font-weight: 700; margin: 14px 0; }
  table { width:100%; border-collapse: collapse; }
  td { padding: 7px 8px; border-bottom: 1px solid #e3e8e6; vertical-align: top; }
  ul { margin: 4px 0; padding-left: 18px; }
  .muted { color:#6b7775; } .small { font-size: 9.5px; word-break: break-all; }
  .tag { display:inline-block; padding:1px 7px; border-radius: 99px; font-size: 9.5px; font-weight:700; text-transform: uppercase; background:#e7f3f2; color:#0d7377; }
  .tag.guardrail { background:#fdeeec; color:#d9443a; } .tag.escalation { background:#fdf4e3; color:#b8650a; }
  .tag.exception { background:#f2eefd; color:#6d4bd8; } .tag.synthetic { background:#eef2f1; color:#6b7775; }
  .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .gates { display:grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
  .gate { background:#f2f5f4; border-radius: 8px; padding: 8px 10px; display:flex; flex-direction:column; gap:2px; }
  .note { margin-top: 22px; padding: 10px 12px; background:#f2f5f4; border-radius: 8px; font-size: 10px; }
  .foot { margin-top: 14px; font-size: 9px; color:#6b7775; word-break: break-all; }
  h2, tr, .gate, .quote { break-inside: avoid; }
</style></head><body>
<div class="brand"><span>Sifu · Intelligence Pill</span><span>Demo environment · fictional data</span></div>
<h1>${esc(c.name)}</h1>
<div class="muted">${esc(c.description)}</div>
<div class="meta">
  <span class="chip">${esc(c.domain)}</span>
  <span class="chip">v${esc(p.version)}</span>
  <span class="chip" style="color:${STATUS_COLOR[p.status] ?? "#13201f"}">${esc(p.status.replace("_", " "))}</span>
  <span class="chip">Owner: ${esc(humanise(p.owner.replace(/^demo[-_]/, "")))}</span>
</div>
${heuristic ? `<div class="quote">“${esc(heuristic)}”</div>` : ""}

<h2>Where it applies</h2>
<div class="grid">
  <div><b>Asset types</b>${list(c.scope.asset_types)}</div>
  <div><b>Equipment</b>${list(c.scope.equipment)}</div>
  <div><b>Contexts</b>${list(c.scope.contexts)}</div>
  <div><b>Exclusions</b>${list(c.scope.exclusions)}</div>
</div>

<h2>What it knows</h2>
<div class="grid">
  <div><b>Expert observations</b>${list(c.expert_observations)}</div>
  <div><b>Assumptions</b>${list(c.assumptions)}</div>
</div>

<h2>Required inputs</h2>
<table>${inputs}</table>

<h2>Decision logic (deterministic)</h2>
<table>${rules}</table>

<h2>Safety boundaries</h2>
<div class="grid">
  <div><b>Never does</b>${list(c.prohibited_actions.map(humanise))}</div>
  <div><b>Guardrails</b>${list(c.guardrails)}</div>
</div>

<h2>Regression obligations</h2>
<p class="muted">Inherited by every successor version — cannot be silently removed or weakened.</p>
<table>${cases}</table>

<h2>Evidence &amp; provenance</h2>
<ul>${evidence}</ul>

<h2>Governance</h2>
<div class="gates">${gate("Review", p.review)}${gate("Validation", p.validation)}${gate("Approval", p.approval)}</div>

<div class="note"><b>Portability.</b> This pill is owned by the organisation as a versioned, schema-validated record. The complete machine-readable version is available as JSON (${esc(fileBase(p))}.json) and is independent of any AI vendor or model.</div>
<div class="foot">Pill ID ${esc(p.pill_id)} · Content hash ${esc(p.content_hash)} · Created ${esc(p.created_at.slice(0, 19).replace("T", " "))} UTC · Previous version ${esc(p.previous_version ?? "—")}</div>
<script>window.onload = () => setTimeout(() => window.print(), 400);</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Allow pop-ups for this site to download the pill as PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
