# Six-minute demonstration

## Prepare

Run `python -m harvest.demo` from the configured environment. It creates a fresh database and `artifacts/demo-report.json`. Keep the output, report, Pill schema and frontend contract available. All human-role activity in the script is simulated. For a live rehearsal, credentials and a successful gated run are required; keep the offline fixture run available.

## Presenter flow

| Time | Show | Say / prove |
|---|---|---|
| 0:00–0:40 | The synthetic incident and interview in `seed[0].capture` | “The pump says running. The water is rising. What would your best engineer notice that a new colleague misses?” |
| 0:40–1:30 | `seed[0].extraction` and `seed[0].draft` | “Capture the judgement: running is not proof of drainage. Scope, evidence requirements, exceptions and escalation become an inspectable artifact.” Label fixture versus live provider. |
| 1:30–2:10 | Approved v1.0.0, content hash, reviewer and validation results | “The model creates a draft. Assigned reviewer and owner actions govern release. Passing test cases belong to this exact content.” |
| 2:10–3:10 | `recommendation.result` and both `capabilities` | “Asset Operations proposes an access-plan review. Tenant Experience blocks it because the alternative route is unverified. The shared result escalates. Here are the versions, rules and observed evidence.” |
| 3:10–3:45 | Decision/outcome from recommendation endpoint, and feedback | “A person records the decision and outcome. The script stands in for distinct human roles; no building action is executed.” |
| 3:45–4:40 | `candidate`, `production_unchanged_before_approval`, `diff` | “Backflow can hide behind a flat trend. Learning creates v1.1.0 as a draft. v1.0.0 remains unchanged. Inspect the new required input, rule, evidence and discriminating test.” |
| 4:40–5:25 | `before_revision` versus `after_revision`, historical version | “The same case previously suggested monitoring. After review and release it escalates. The old recommendation still records v1.0.0. Nothing was silently rewritten.” |
| 5:25–6:00 | JSON Schema, adapter interface, audit | “The organisation owns the capability artifact. Tencent can supply the model edge. Two specialist capabilities cooperate through one bounded workflow; humans own release and decisions.” |

## Optional live API checks

Use the role tokens from README. `GET /api/v1/pills` shows version status; `/api/v1/audit` shows events; `/docs` provides request forms. Submit with `demo-expert`, review/validate with `demo-reviewer`, approve with `demo-approver`, operate with `demo-operator`.

Useful demonstrations: attempt invocation while DRAFT (rejected); remove a required observation (ABSTAIN); set `alternative_route_verified=false` (access-plan recommendation blocked); try routine approval on ESCALATE (409); propose feedback while showing current content hash (unchanged); reject a candidate (production unchanged).

## What to avoid claiming

No real Keppel data, qualified field validation, measured loss prevention, autonomous equipment action or live Tencent use unless independently evidenced. Public PUB context motivates the scenario but does not certify these synthetic rules. AI narrative is optional and explicitly untrusted; deterministic rule trace and governance records are the demonstration's evidence.
