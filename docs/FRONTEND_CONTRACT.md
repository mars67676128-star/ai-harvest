# Frontend contract

API base `/api/v1`. Swagger `/docs`, OpenAPI `/openapi.json`, portable Pill JSON Schema `/api/v1/schema/pill`. All application endpoints require `Authorization: Bearer <token>`; health and OpenAPI are public. Tokens resolve to server-owned identities; never send actor/role headers.

## Views and endpoints

| View | API |
|---|---|
| Dashboard | `GET /dashboard`, `GET /pills`, `GET /cases`, `GET /recommendations` |
| Expert Capture | `GET /elicitation`, `POST /captures`, `GET /captures/{id}`, `POST /captures/{id}/extract`, `POST /captures/{id}/compile` |
| Pill detail/export | `GET /pills/{pill_id}/versions/{version}`, `POST /pills` for an expert-authored artifact |
| Operational case | `POST /cases`, `GET /cases/{id}`, `POST /cases/{id}/invoke` |
| Recommendation review | `GET /recommendations/{id}`, `POST /recommendations/{id}/decision`, `POST /recommendations/{id}/outcome`, `POST /recommendations/{id}/feedback` |
| Governance and diff | `POST /pills/{id}/versions/{v}/{operation}`, where operation is `submit`, `review`, `validate`, `approve`, `reject` or `deprecate`; `GET /pills/{id}/diff?from_version=1.0.0&to_version=1.1.0`; `GET /feedback/{id}`, `POST /feedback/{id}/propose` |
| Version history | `GET /pills/{id}/versions` |
| Audit history | `GET /audit?entity_id=...&after=0&limit=100` |

Version detail contains immutable `content`, `content_hash`, lifecycle state, identities, review, validation and timestamps. Status is server-owned. Reviewers address unresolved questions/contradictions through a corrected candidate before approval. All revisions require explicit version, expected parent and change reason; conflicts return HTTP 409.

The paths in the table are relative to `/api/v1`. There are 30 application HTTP operations plus public `GET /health`; the checked-in `docs/openapi.json` matches the app factory at the review checkpoint. `/api/v1/schema/pill` returns the knowledge-content schema. Complete version/export metadata is defined by `PillVersion` in OpenAPI and `schemas/pill-version.schema.json`; there is no separate full-version schema endpoint.

## Mutation permissions and bodies

| Operation | Required role and additional condition | Request body |
|---|---|---|
| Create capture | `expert` | `CaptureRequest`: title, transcript, domain; synthetic defaults true |
| Extract capture | `expert` | No body; exact offline fixtures only when provider is mock |
| Compile capture | `expert`; extraction must exist | `CompileRequest`: pill_id; default version `1.0.0`, owner `approver`, reviewers `[reviewer]` |
| Create Pill/candidate directly | `expert` | `CreatePill`: pill_id, version, owner, reviewers, content, change_reason; previous_version for a revision |
| Submit | `expert` and artifact author; DRAFT | `{ "note": "..." }` |
| Review / validate / reject | `reviewer`, assigned in reviewers, different from author; IN_REVIEW | `{ "note": "..." }` |
| Approve | `approver`, Pill owner, different from author; IN_REVIEW, reviewed, passing tests, current parent | `{ "note": "..." }` |
| Deprecate | `approver`, Pill owner, different from author; APPROVED | `{ "note": "..." }` |
| Create case | `operator` | `CaseInput`: title, asset_id, asset_type, equipment, context, observations, synthetic |
| Invoke case | `operator` | `{ "pill_ids": ["asset.monsoon.triage"], "include_ai_explanation": true }` |
| Human decision | `operator`; one decision per recommendation | `{ "decision": "approve|reject|correct|escalate", "note": "..." }` (choose one decision value) |
| Outcome | `operator`; prior decision, one outcome | `{ "summary": "...", "resolved": true, "synthetic": true }` |
| Feedback | `expert` or `operator`; prior outcome, Pill used by the recommendation | `{ "pill_id": "...", "correction": "...", "proposed_version": "1.1.0" }` |
| Propose from feedback | `expert`; feedback parent must still be approved | No body; creates DRAFT, inheriting ownership and review assignments |

All authenticated identities can read the single-organisation data, including captures; there is no resource-level confidentiality or multi-tenant boundary. Reviewer and approver may be the same configured person if both roles and assignments permit it, but neither may be the artifact author. Demo identities happen to use three separate people.

Runtime output separates authoritative structured decisions from optional, untrusted AI prose. Render **decision, escalation reasons, allowed recommendations, blocked actions, exact Pill versions and hashes, rule trace, observed evidence, assumptions and boundaries** before the AI supplement. Never interpret AI prose as an executable command. `execution_allowed` is always false. `ABSTAIN` means the supplied evidence/scope does not support a governed operational recommendation. A human cannot approve an escalation/abstention as routine; they can escalate, reject or correct it.

Operational observations include source, timezone-aware observation time, quality, value and unit. Supporting Pill evidence instead has an ID, kind, citation, summary and synthetic marker. Case creation can store a boolean/string observation, but a Pill requiring a number will reject that type at evaluation and return ABSTAIN. Scope and input quality are enforced at invocation. `pill_ids` selects one or two approved root identities, not versions; dependencies resolve at their pinned approved versions. A draft with no current approved release returns 404 on invocation. Missing, stale, conflicting or out-of-scope observations produce a stored recommendation with HTTP 201 and `result.decision=ABSTAIN`, not necessarily a request validation error. Unavailable/unapproved dependencies return an error without a recommendation.

## Identity fixtures

Default local fixture tokens: `demo-expert`, `demo-reviewer`, `demo-approver`, `demo-operator`, `demo-viewer`. IDs: `expert`, `reviewer`, `approver`, `operator`, `viewer`. Approver is the default Pill owner; reviewer is the authorised reviewer. Author/reviewer separation is enforced. These are public test credentials, never deploy them publicly. Configure server-side token mappings in non-demo mode.

## Response and error convention

Successful single-object operations return an object; lists return arrays. Audit returns `{items, next_after}`. Create returns 201. Errors return `{error: {code, message, details}, request_id}` with 401 unauthenticated, 403 role/ownership, 404 missing entity, 409 state/stale-parent, 422 invalid evidence/schema, 502 unavailable or malformed AI, 500 sanitised internal error. Clients must handle optional error details and display request IDs when reporting problems. Server request IDs are echoed in `X-Request-ID`.

Extraction returns 200, including on repeated reads of the retained extraction. All governance operations return 200 and the complete `PillVersion`. Validation can return 200 with `validation.passed=false`: inspect the report; approval will fail. Body size above 250,000 bytes returns 413. The current middleware buffers the body before enforcing that limit, so it is not a streaming upload defence.

`GET /cases/{id}` wraps its submitted payload in `case`. Recommendations wrap combined decisions in `result` and individual Pill traces in `capabilities`. Decision and outcome are append-only child records; `GET /recommendations/{id}` includes them, while `GET /recommendations` does not hydrate those child records (the response fields default to null). Fetch the detail before rendering review completion. Record IDs are opaque strings. An empty version list is `[]`, whereas a missing specific version is 404. Only audit is paginated; other list endpoints return all records at demo scale.

Mutation retries are not implicitly idempotent: after a timeout refresh the object/list before resubmitting. Decision and outcome are single-record operations per recommendation. Feedback can have multiple entries; every candidate version is unique. Capture extraction is retained once, so repeat extraction returns its existing result. No websocket or background-job infrastructure.

Feedback submission persists the observation first. `POST /feedback/{id}/propose` then calls the model and creates a separate DRAFT; model failure leaves the feedback readable and production unchanged. Only expert role can propose; operators can submit feedback. The sample CLI simulates the distinct roles explicitly.

Recommendations include `evaluated_at` and `valid_until`. Routine approval is rejected once observations expire or a referenced release is superseded/deprecated; escalation, rejection and correction can still be recorded. `quality=verified` means a caller attests verification, not that the server contacted a physical sensor. Clients should collect that attestation explicitly. Prerequisites/exclusions also need qualified human assessment; only enumerated asset/equipment/context and rule/input constraints are machine-checked.

The generated `docs/openapi.json`, `schemas/pill.schema.json`, `examples/` and API-driven demo are executable integration references. CORS defaults to common localhost frontend ports; configure exact origins for other clients.

Pill, case and recommendation responses have explicit OpenAPI response models. Capture, extraction, decision, outcome, feedback, diff, dashboard and audit responses currently have inferred/unstructured response schemas; inspect the saved demo report and handlers for their full shape. Error envelopes are standardised at runtime; 413 and 500 are not explicitly listed in every generated operation. These are review limitations, not an invitation for the frontend to assume undocumented fields.
