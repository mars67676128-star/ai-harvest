// Plain-language glossary — one place to define every term the app uses.
// Pattern borrowed from Document360 / KnowledgeOwl glossaries: define a term once,
// show it on hover wherever it appears, and list everything on one page.

export interface GlossaryEntry {
  key: string;
  term: string;
  plain: string;
  example?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { key: "pill", term: "Intelligence pill",
    plain: "One expert's know-how for one kind of situation, written as a small set of checked rules. Think of a recipe card the whole team uses — with a version number and named sign-offs.",
    example: "“Monsoon near-miss triage” — what to do when the basement pump looks fine but water keeps rising." },
  { key: "domain", term: "Domain",
    plain: "The area of building work a pill belongs to. Each domain looks after a different concern, so two pills can look at the same situation from different angles.",
    example: "Asset Operations (equipment), Tenant Experience (the people using the building)." },
  { key: "asset-ops", term: "Asset Operations",
    plain: "The domain about the building's equipment — pumps, chillers, drains, power. Its pills help the shift team judge equipment problems.",
    example: "The sump pump is running but basement water is rising." },
  { key: "tenant", term: "Tenant Experience",
    plain: "The domain about the building's tenants — the companies and people who rent and use it. Its pills protect their safety, access and communication.",
    example: "Don't redirect tenants to another entrance until someone confirms it is safe." },
  { key: "blocked", term: "Blocked action",
    plain: "A pill can stop an action another pill suggested until a condition is met. A block is a safety stop, not an error.",
    example: "The tenant pill blocks “review access plan” until the alternative route is checked." },
  { key: "case", term: "Assessment (case)",
    plain: "One situation on site that the operator checks against the approved pills. The result is a recommendation — never an automatic action." },
  { key: "observation", term: "Reading (evidence)",
    plain: "A measured or reported fact about the situation, with where it came from and when. Pills only use verified, recent readings.",
    example: "Water rising 3 mm/min · from the basement level sensor · 14:02." },
  { key: "evidence", term: "Evidence (for a rule)",
    plain: "Where a rule came from: an expert interview, a past incident, operator feedback or public guidance. Every rule must point to at least one.",
    example: "“Expert interview: the Harbour Exchange green-light incident.”" },
  { key: "backflow", term: "Drain backflow",
    plain: "When the drains outside are already full (e.g. in a monsoon downpour), water pushes back into the building through the drain instead of leaving. The pit's level can look steady even though the pump isn't really getting rid of water.",
    example: "Pump light on, level flat, but water is coming back in — the night shift must still call the engineer." },
  { key: "capture", term: "Capture (guided interview)",
    plain: "How know-how gets in: an expert is interviewed about a real incident with questions designed to surface what isn't in any manual — what they noticed, what a junior would miss, when the rule doesn't apply, who must take over. AI then drafts structured rules from the answers for people to check.",
    example: "“What would a junior operator commonly miss?”" },
  { key: "rule-trace", term: "Rule trace",
    plain: "The list of rules that matched this situation, and the reading that set each one off. It is the “show your working” behind a recommendation." },
  { key: "provenance", term: "Provenance",
    plain: "The record of exactly which pill version gave this advice and who wrote, reviewed and approved it — so any decision can be traced back later." },
  { key: "hash", term: "Content fingerprint (hash)",
    plain: "A code calculated from the pill's exact content. Change one word and the code changes, so nobody can quietly edit a pill after it was approved." },
  { key: "boundaries", term: "Boundaries (guardrails)",
    plain: "Hard limits that apply whatever the readings say — things the system will never do or suggest.",
    example: "Never switch equipment, change access or message tenants automatically." },
  { key: "heuristic", term: "Rule of thumb (heuristic)",
    plain: "Something an expert knows from experience rather than from the manual. Capturing these is the point of Sifu.",
    example: "“A running pump indication does not prove effective drainage.”" },
  { key: "escalate", term: "Escalate",
    plain: "Hand the decision to a named person with the authority to act, because the situation is beyond routine.",
    example: "Escalate to the duty facilities engineer." },
  { key: "needs-review", term: "Needs review",
    plain: "The pill has a suggestion, but a person must confirm it before anything happens." },
  { key: "abstain", term: "Abstain",
    plain: "The pill refuses to recommend anything because a reading it needs is missing or unreliable. Better to say “I can't tell” than to guess.",
    example: "No drain-backflow reading → abstain." },
  { key: "candidate", term: "Proposal (candidate version)",
    plain: "A suggested new version of a pill, often drafted by AI from feedback. It changes nothing until it is reviewed, tested and approved." },
  { key: "regression", term: "Test situations (regression tests)",
    plain: "Saved example situations with the answer the pill must give. Every new version must still pass all of them, so fixing one thing can't silently break another." },
  { key: "review", term: "Independent review",
    plain: "A second expert — never the author — checks that the change makes sense. They can reject it with a reason." },
  { key: "approve", term: "Approve (release)",
    plain: "The pill owner makes a reviewed, tested version the one everyone uses. The previous version is then superseded." },
  { key: "superseded", term: "Superseded",
    plain: "Replaced by a newer approved version. Kept for the record, no longer used. There is only ever one current version — no “final_v3_FINAL” copies." },
  { key: "deprecated", term: "Retired (deprecated)",
    plain: "Switched off on purpose, without a replacement." },
  { key: "audit", term: "Audit trail",
    plain: "A permanent log of who did what and when. Entries can't be edited or deleted." },
  { key: "synthetic", term: "Synthetic",
    plain: "Made up for this demo. No real Keppel buildings, people, readings or procedures are used." },
];

export const GLOSSARY_BY_KEY: Record<string, GlossaryEntry> = Object.fromEntries(
  GLOSSARY.map((g) => [g.key, g])
);

// Fictional demo people for each role — so the app reads like a team's workspace.
export interface Persona { name: string; title: string; initials: string; tone: string }
export const PERSONAS: Record<string, Persona> = {
  operator: { name: "Aisha Rahman", title: "Asset Operations Manager (on duty)", initials: "AR", tone: "#2f7de1" },
  expert: { name: "Tan Wei Ming", title: "Senior M&E technician", initials: "TW", tone: "#0d7377" },
  reviewer: { name: "Priya Nair", title: "Facilities engineer", initials: "PN", tone: "#b7791f" },
  approver: { name: "Daniel Lim", title: "Head of building operations", initials: "DL", tone: "#6d4bd8" },
  viewer: { name: "Guest", title: "Read-only viewer", initials: "G", tone: "#64748b" },
};
export function persona(actor: string | undefined | null): Persona {
  const k = String(actor ?? "").replace(/^demo[-_]/, "");
  return PERSONAS[k] ?? { name: k || "Someone", title: "", initials: (k[0] ?? "?").toUpperCase(), tone: "#64748b" };
}
