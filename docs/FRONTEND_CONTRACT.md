# Frontend contract

API base `/api/v1`. Swagger `/docs`, OpenAPI `/openapi.json`, portable Pill JSON Schema `/api/v1/schema/pill`. All application endpoints require `Authorization: Bearer <token>`; health and OpenAPI are public. Tokens resolve to server-owned identities; never send actor/role headers.

## Views and endpoints

| View | API |
|---|---|
| Dashboard | `GET /dashboard`, `GET /pills`, `GET /cases` |
| Expert Capture | `GET /elicitation`, `POST /captures`, `GET /captures/{id}`, `POST /captures/{id}/extract`, `POST /captures/{id}/compile` |
| Pill detail/export | `GET /pills/{pill_id}/versions/{version}`, `POST /pills` for an expert-authored artifact |
| Operational case | `POST /cases`, `GET /cases/{id}`, `POST /cases/{id}/invoke` |
| Recommendation review | `GET /recommendations/{id}`, `POST /recommendations/{id}/decision`, `POST /recommendations/{id}/outcome`, `POST /recommendations/{id}/feedback` |
| Governance and diff | `POST /pills/{id}/versions/{v}/submit`, `/review`, `/validate`, `/approve`, `/reject`, `/deprecate`; `GET /pills/{id}/diff?from_version=1.0.0&to_version=1.1.0`; `POST /feedback/{id}/propose` |
| Version history | `GET /pills/{id}/versions` |
| Audit history | `GET /audit?entity_id=...&after=0&limit=100` |

Version detail contains immutable `content`, `content_hash`, lifecycle state, identities, review, validation and timestamps. Status is server-owned. Reviewers address unresolved questions/contradictions through a corrected candidate before approval. All revisions require explicit version, expected parent and change reason; conflicts return HTTP 409.

Runtime output separates authoritative structured decisions from optional, untrusted AI prose. Render **decision, escalation reasons, allowed recommendations, blocked actions, exact Pill versions and hashes, rule trace, observed evidence, assumptions and boundaries** before the AI supplement. Never interpret AI prose as an executable command. `execution_allowed` is always false. `ABSTAIN` means the supplied evidence/scope does not support a governed operational recommendation. A human cannot approve an escalation/abstention as routine; they can escalate, reject or correct it.

All evidence includes source, timezone-aware observation time, quality, value and unit. Numeric inputs do not accept booleans or numeric strings. Both scope and input quality are enforced at invocation. `pill_ids` may select one or two approved roots; dependencies are resolved only at their exact approved versions.

## Identity fixtures

Default local fixture tokens: `demo-expert`, `demo-reviewer`, `demo-approver`, `demo-operator`, `demo-viewer`. IDs: `expert`, `reviewer`, `approver`, `operator`, `viewer`. Approver is the default Pill owner; reviewer is the authorised reviewer. Author/reviewer separation is enforced. These are public test credentials, never deploy them publicly. Configure server-side token mappings in non-demo mode.

## Response and error convention

Successful single-object operations return an object; lists return arrays. Audit returns `{items, next_after}`. Create returns 201. Errors return `{error: {code, message, details}, request_id}` with 401 unauthenticated, 403 role/ownership, 404 missing entity, 409 state/stale-parent, 422 invalid evidence/schema, 502 unavailable or malformed AI, 500 sanitised internal error. Clients must handle optional error details and display request IDs when reporting problems. Server request IDs are echoed in `X-Request-ID`.

Mutation retries are not implicitly idempotent: after a timeout refresh the object/list before resubmitting. Decision and outcome are single-record operations per recommendation. Feedback can have multiple entries; every candidate version is unique. Capture extraction is retained once, so repeat extraction returns its existing result. No websocket or background-job infrastructure.

Feedback submission persists the observation first. `POST /feedback/{id}/propose` then calls the model and creates a separate DRAFT; model failure leaves the feedback readable and production unchanged. Only expert role can propose; operators can submit feedback. The sample CLI simulates the distinct roles explicitly.

Recommendations include `evaluated_at` and `valid_until`. Routine approval is rejected once observations expire or a referenced release is superseded/deprecated; escalation, rejection and correction can still be recorded. `quality=verified` means a caller attests verification, not that the server contacted a physical sensor. Clients should collect that attestation explicitly. Prerequisites/exclusions also need qualified human assessment; only enumerated asset/equipment/context and rule/input constraints are machine-checked.

The generated `docs/openapi.json`, `schemas/pill.schema.json`, `examples/` and API-driven demo are executable integration references. CORS defaults to common localhost frontend ports; configure exact origins for other clients.
