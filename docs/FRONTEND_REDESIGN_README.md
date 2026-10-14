# AI HARVEST Frontend Redesign Brief

You are taking ownership of the **AI HARVEST frontend UX and visual design**, including the final feedback lifecycle.

## Important: you ARE allowed to redesign the existing frontend

The current frontend is functionally correct, but its visual design is not considered final.

You may substantially change:

- page layouts
- navigation
- information hierarchy
- spacing and typography
- colors
- cards, panels and tables
- interaction patterns
- responsive structure
- component organization
- how provenance/governance information is progressively disclosed
- the Operational Case screen
- the Intelligence Pills screen

You may split large screens into subviews, drawers, tabs, side panels or focused sections if that improves comprehension.

**Do not treat the existing dark engineering-console design as something that must be preserved.**

The goal is to make this feel like a polished enterprise product that could plausibly be shown to Keppel management and operations teams.

---

# Product design objective

A judge should understand the product within roughly **10 seconds**:

**AI HARVEST captures expert operational judgement, governs it as versioned Intelligence Pills, uses those Pills to support live decisions, and learns from outcomes without allowing AI to silently modify approved knowledge.**

The UI should feel:

- professional
- modern
- calm
- trustworthy
- high-quality
- operational rather than consumer-like
- visually polished enough for a hackathon final

Avoid making it look like:

- a developer console
- an API inspector
- a database admin panel
- a cybersecurity SOC dashboard
- a generic AI chatbot
- a wall of tables

---

# Visual direction

You have freedom to choose the exact aesthetic, but favour a **premium enterprise operations product**.

Consider:

- light or dark themes based on what produces the clearest result
- stronger typography and whitespace
- clear section hierarchy
- restrained accent colours
- meaningful semantic colour for approved / review / warning / escalation / blocked
- readable typography suitable for presentation on a projector
- fewer visible borders
- fewer dense tables
- progressive disclosure for technical metadata
- visually distinct operational vs governance views
- icons where they improve scanning

Large UUIDs, hashes, timestamps and raw IDs should generally be secondary information, not primary visual content.

Human-readable terminology should lead.

Raw technical identifiers can appear in expandable **Technical Details** sections.

Do not use gratuitous gradients, excessive glassmorphism, fake charts or decorative AI imagery.

---

# Information architecture

You may redesign the navigation.

A possible structure is:

```text
AI HARVEST

Operations
  └─ Live Case

Intelligence
  ├─ Intelligence Pills
  └─ Knowledge Evolution

Governance
  └─ Review & Approval
```

This is only a suggestion. Choose a structure that makes the product story clearer.

Remove unfinished placeholder navigation such as the standalone Audit page unless you implement a useful version of it.

---

# Screen 1 — Live Operational Case

Redesign the current Operational Case screen.

It must still use the real backend.

The wet-weather scenario must communicate immediately:

```text
Pump status: RUNNING
Water trend: RISING
Alternative route: UNVERIFIED

→ ESCALATION REQUIRED
```

The first viewport should prioritise:

1. what is happening;
2. what AI HARVEST recommends;
3. what is blocked;
4. why;
5. who must act.

The cross-domain conflict is one of the strongest demo moments:

**Asset Operations proposes access-plan review, but Tenant Experience blocks it because the alternative route has not been verified.**

Make this visually obvious.

Detailed evidence, rule traces, hashes and provenance may be progressively disclosed rather than occupying the main decision area.

Preserve:

- deterministic rule trace
- exact Pill versions
- evidence provenance
- prohibited actions
- `execution_allowed = false`
- non-authoritative AI explanation
- human escalation recording

Never show routine approval for an `ESCALATE` recommendation.

---

# Screen 2 — Intelligence Pill

Redesign the existing Intelligence Pills screen so that it feels like a **controlled operational knowledge artifact**, not a giant schema dump.

The primary message should be:

**This is approved organisational expertise with explicit scope, evidence, rules, safety boundaries and regression obligations.**

Prioritise:

```text
Monsoon Near-Miss Triage
Asset Operations
APPROVED · v1.0.0
```

Then make it easy to understand:

- what this Pill knows;
- where it applies;
- what inputs it requires;
- the expert heuristic;
- deterministic decision logic;
- safety boundaries;
- evidence;
- governance state;
- version lineage.

The key heuristic:

**“A running pump indication does not prove effective drainage.”**

should be visually prominent.

Governance should be understandable without raw JSON:

```text
Review       ✓
Validation   ✓
Approval     ✓
```

Keep complete machine records available under expandable technical details.

Regression obligations should remain a visible differentiator:

**Approved regression obligations are inherited by successor versions and cannot be silently removed or weakened.**

---

# Screen 3 — Knowledge Evolution / Feedback Lifecycle

Build the final lifecycle:

```text
Operational decision
       ↓
Outcome
       ↓
Feedback
       ↓
AI-proposed candidate
       ↓
Human-reviewed diff
       ↓
Regression validation
       ↓
Approval
       ↓
New approved Pill version
```

Use the existing backend APIs.

The scenario should demonstrate the drain-backflow learning example.

The user should be able to see:

## 1. Operational outcome

Record what actually happened after the escalation.

## 2. Feedback

Associate the feedback with:

- exact recommendation
- exact Pill ID
- exact Pill version

## 3. Candidate revision

AI may propose a candidate `v1.1.0`.

Make this extremely explicit:

**AI PROPOSAL — NOT PRODUCTION KNOWLEDGE**

The currently approved v1.0.0 remains active.

## 4. Diff

Create a polished human-readable diff.

Highlight:

- new drain-backflow exception
- changed assumptions / rules
- added inputs where applicable
- inherited regression cases
- newly added regression cases

Avoid dumping raw JSON as the primary diff interface.

## 5. Governance

Use existing role boundaries:

```text
Expert     → submit/review
Reviewer   → independent review/validation
Approver   → final approval
```

Never silently switch bearer identities.

After approval, show:

```text
v1.0.0  SUPERSEDED
v1.1.0  APPROVED
```

only if that is what the real backend returns.

---

# UX principles

Use **progressive disclosure**.

A normal operator should not have to read:

- UUIDs
- hashes
- raw JSON
- every evaluation case
- every audit record

just to understand the recommendation.

Those details must still be available for auditability.

Think in layers:

```text
Layer 1 — Decision
What should I know/do?

Layer 2 — Explanation
Why did the system reach this result?

Layer 3 — Evidence
What observations and expertise support it?

Layer 4 — Governance
Which approved Pill/version authorised this?

Layer 5 — Technical record
IDs, hashes, timestamps, raw records
```

---

# Hard constraints

You may redesign the frontend freely, but **do not change these system semantics**:

- approved Pills are immutable;
- AI cannot approve knowledge;
- AI cannot bypass governance;
- AI cannot execute operational actions;
- runtime decision authority remains deterministic;
- the LLM may extract/propose/explain but not control authoritative decisions;
- successor Pills inherit regression obligations;
- authorization must use the selected user's actual role;
- synthetic demo evidence must remain labelled synthetic;
- public contextual evidence must not be presented as validation of Pill rules.

Do not redesign the backend.

If a genuinely missing API prevents a critical UX requirement, document it before making backend changes.

---

# Technical freedom

You may:

- refactor React components;
- create reusable design-system components;
- reorganise CSS;
- create new frontend routes/views;
- change the theme;
- redesign navigation;
- introduce a **small, justified frontend dependency** if it substantially improves the product.

Avoid introducing a large UI framework merely for convenience.

Prefer maintainable components over one enormous JSX file.

---

# Before implementing

Spend a short design pass first.

Inspect:

- `OperationalCase.tsx`
- `IntelligencePills.tsx`
- `App.tsx`
- `api.ts`
- `types.ts`
- existing CSS

Then report:

1. the biggest UX/design problems you see;
2. your proposed information architecture;
3. your visual direction;
4. which existing components you intend to redesign;
5. how you will preserve the backend/governance invariants.

**Do not modify files until that design plan is presented.**

Once the direction is agreed, implement the redesign plus the feedback lifecycle.

Run `npm run build`.

Do not commit until the redesigned interface has been visually reviewed.

---

# Design mandate

Keep the working backend and governance model; make the frontend look like a product worth winning with.
