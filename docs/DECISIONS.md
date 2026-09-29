# Existing architecture decisions — review index

This indexes the MVP decisions already implemented before review preparation. It introduces no architecture changes. Rationale and diagrams remain in [ARCHITECTURE](ARCHITECTURE.md); scenario reasoning and sources remain in [SCENARIO_RESEARCH](SCENARIO_RESEARCH.md).

| Decision | Why it was selected | Review boundary / consequence |
|---|---|---|
| Asset Operations monsoon triage + Tenant Experience continuity | A clear expert pitfall and a natural cross-domain conflict, with a small reproducible story | All domain content is synthetic; public context does not validate operational rules |
| FastAPI/Pydantic/SQLite modular monolith | Schema/API productivity and transactional release without distributed infrastructure | One organisation, local demo scale; no SSO, large-scale concurrency or cloud production claims |
| Portable content plus server-owned version/governance envelope | Organisational judgement survives a model/vendor change | Two JSON Schemas; lifecycle authority is in deterministic application logic |
| Immutable content for every version, including drafts | Review/test results bind to exact content and historical recommendations remain reproducible | Corrections create new candidates; no PATCH/delete/update artifact route |
| Assigned independent reviewer and owner-controlled approval | Feedback/model output cannot self-publish | Author cannot review/approve own artifact; reviewer and approver may coincide if explicitly assigned both authorities |
| Transactional promotion with current-parent and regression checks | Prevent stale siblings/concurrent approval from silently replacing a release | Previous release becomes SUPERSEDED, remains readable and cannot be newly invoked as current expertise |
| Finite rule DSL and explicit orchestration of at most two capabilities | Explainable scope/evidence checks and cross-domain block precedence | No executable code in Pills, hydraulic model, autonomous swarm or equipment/message action integration |
| LLM structured-generation adapter at the edge | AI supports extraction, candidate revision and optional explanation without owning authority | Mock is exact fixture replay; Tencent-compatible HTTP adapter is contract-tested but not live-verified |
| Explicit evidence references rather than vector retrieval | Supporting documents are provenance; structured expert judgement is the core demo | No search/retrieval/document-ingestion subsystem |
| Append-only operational records and audit triggers | Preserve attributable lifecycle history within the local app | Not cryptographic tamper evidence against database administrators |
| Public fixture identities for loopback demos | Reproducible role separation without credentials | Must not expose demo mode publicly; production token checks are a limited guard, not production security |
| Commit OpenAPI, schemas and synthetic examples; ignore execution artifacts | Give an independent frontend/reviewer a stable contract while keeping data and secrets out of Git | Generated contracts are intentional; databases, reports, wheels, caches and environments remain local |
| Review freeze | Verify and document the accepted backend milestone before expanding scope | This checkpoint changes docs/ignore patterns only; no new product feature or dependency |
