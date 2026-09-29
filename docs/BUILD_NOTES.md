# Build notes

## Decisions and assumptions

- Research completed 2026-09-29; selected Asset Operations monsoon near-miss triage with Tenant Experience continuity. See SCENARIO_RESEARCH.md. Scenario selection is closed.
- A pump's running indicator versus actual drainage is the memorable expert-judgement example. All domain knowledge remains synthetic pending qualified review.
- Python/FastAPI/Pydantic + standard-library SQLite. Portable JSON artifact first; no vector retrieval, autonomous agents or actuation.
- Immutable version content, independent review and hash-bound tests. Approval is a transactional deterministic operation. Feedback only proposes new drafts.
- Single organisation and local demo deployment. Roles are server-configured; known demo tokens are for loopback demonstrations only.
- Two explicit capabilities; no agent swarm. Missing evidence or invalid scope makes the combined workflow abstain and escalate.
- The workspace initially contained a PDF but no application or Git repository. Preserve the PDF. The attached user brief is the implementation specification; hackathon eligibility still requires organiser confirmation.

## Tencent decision

Use TokenHub through a replaceable compatible HTTP adapter for structured expert extraction and candidate revisions. Official Tencent documentation now directs new integrations toward TokenHub. International default: `https://tokenhub-intl.tencentcloudmaas.com/v1`; mainland alternate: `https://tokenhub.tencentmaas.com/v1`. Model ID comes from the user's enabled console model, never an assumed entitlement. No credentials were provided. Implement and test the adapter contract using HTTP mocks; do not claim live usage or CodeBuddy/WorkBuddy proof.

## Limitations

Synthetic operational guidance is unvalidated. Runtime is a finite rule engine, not a hydraulic model. AI prose is untrusted and cannot change runtime decisions. Tests establish software invariants, not building safety. SQLite/local RBAC are demo-scale choices. No automated tenant messages, equipment control, SSO, document ingestion, semantic search or polished frontend.

## Execution and verification

Run instructions, demo steps and verification results are maintained in README.md and docs/DEMO.md. Evidence requirements and live-service limitations are in HACKATHON_EVIDENCE.md. Frontend integration uses FRONTEND_CONTRACT.md and the generated OpenAPI document.

Completed sections are saved as local Git checkpoint commits at the user's request. Initial checkpoints: `d8c9f7d` research/design, `0b31312` schema/foundation, `2a8af58` working lifecycle/AI/tests. The sandbox owns the initial Git directory; escalated checkpoint writes use an exact per-command safe-directory setting rather than changing global Git trust. No source PDF, secrets or generated databases are committed.

Verified so far: 48 passing local deterministic tests, successful complete in-process API demo, generated OpenAPI/schema/examples, lint and formatting checks. Runtime uses pinned Starlette 0.52.1 for the established HTTPX test-client API; a transitive AnyIO deprecation warning remains non-fatal. Docker/Linux CI are unexecuted configurations, not verified deployments.

Final handoff verification (2026-09-29): **48 tests passed**; Ruff lint and format checks passed; `pip check` reports no broken requirements. The complete lifecycle also passed through a real Uvicorn HTTP server at loopback port 8765, independently of the in-process demo. Saved outputs: `artifacts/demo-report.json` and `artifacts/http-demo-report.json` (intentionally untracked). Evidence shows cross-domain blocking, unchanged production before review, v1.1.0 promotion and historical v1.0.0 preservation. Both content and complete version schemas are exported. Live Tencent requests, Docker execution and Linux CI remain unverified.
