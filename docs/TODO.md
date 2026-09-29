# Known limitations and review queue

Backend MVP is frozen for independent review. This is a record of open work, not authorisation to implement it now. No frontend work or new product features should start during this review checkpoint.

## Recovery status — 29 September 2026

- [x] Confirmed the interrupted review task changed no tracked application code; all committed application work is preserved.
- [x] Ran the existing full suite once: 48 passed, one existing dependency deprecation warning. No new tests or runtime changes.
- [x] Preserved the incomplete packet as untracked `docs/REVIEW_PACKET.partial.md`; it contains placeholders/missing sections and is not a completed review report. Completion is outside this recovery task.
- [x] Preserved the original untracked user PDF. The recovery checkpoint contains only CHECKPOINT/TODO updates.
- [ ] Publish the development branch when a GitHub remote is supplied. No remote is configured; no push or merge occurred. Commands remain in CHECKPOINT.md.

## Independent review focus

- [ ] Review the exact authority boundaries: caller roles, Pill owner/assigned reviewer, author separation, stale-parent rejection, current-release uniqueness and immutable content. Reviewer and approver need not be distinct from each other; each must differ from the author.
- [ ] Assess rule/evaluation adequacy beyond the synthetic fixtures. Passing artifact-defined tests is not independent professional validation; a qualified reviewer must scrutinise scope changes, removed tests, guards and newly proposed rules.
- [ ] Review model-output trust and presentation. The optional narrative can contain misleading prose despite its untrusted label; it never controls structured decisions or execution. Generic live extraction/revision quality is unverified.
- [ ] Assess production security separately: static bearer identities, all-authenticated-user read access, no SSO/multi-tenancy, no rate limiting, and body-size enforcement after buffering. `HARVEST_ENV=production` does not make this a production-ready deployment.
- [ ] Assess SQLite operational constraints: single-process demo deployment, migration/backup/restore procedures, retention and administrative write access. Append-only triggers are not tamper-proof against a database administrator.

## External validation still required

- [ ] Provide privately configured Tencent credentials/enabled model and perform a real gated run; collect redacted proof-of-use. Do not label mock output as live Tencent use.
- [ ] Confirm hackathon tool/eligibility requirements and obtain actual CodeBuddy/WorkBuddy evidence if applicable.
- [ ] Have qualified building/tenant-domain experts validate the synthetic rules and thresholds before any field use. No measured operational or financial benefit exists.
- [ ] Execute Docker and Linux/Python 3.11 CI configurations. Only Windows/Python 3.14.5 has been verified here.

## Existing engineering gaps, deferred

- [ ] No configured mypy/pyright type-check gate, dedicated secret scanner or dependency vulnerability scan. Current gates are pytest, Ruff and dependency consistency.
- [ ] Starlette's test-client AnyIO alias produces one deprecation warning. No dependency upgrade was made during the freeze.
- [ ] Capture/extraction/feedback/diff/audit and some other responses do not have detailed OpenAPI response models. Request models and core Pill/case/recommendation responses are typed; see the frontend contract for actual wrappers and statuses.
- [ ] OpenAPI's shared error declarations do not enumerate every 413/500 response and also appear on public health. Runtime error envelopes are standardised.
- [ ] Only audit lists are paginated. Recommendation list results do not hydrate human-decision/outcome children; use the detail endpoint.
- [ ] Retry idempotency is limited. Decisions/outcomes are single records; capture extraction is retained once. Retrying other mutations after timeouts requires inspecting current state.
- [ ] The seeder skips any existing Pill identity, including interrupted/unapproved/deprecated entries. It does not repair partial seed state. Use a fresh database for a repeat full demo; immutable v1.1.0 cannot be overwritten.
- [ ] The offline provider understands only exact labelled demo interview/correction fixtures. Arbitrary interviews require a live provider or direct expert-authored artifacts.
- [ ] `verified` observation quality is caller attestation, not live sensor validation. Structured asset/equipment/context/input rules are checked; narrative prerequisites/exclusions still require human judgement.
- [ ] Examples contain export-time observation timestamps; stale inputs intentionally abstain. Regenerate examples or supply fresh observations before invoking them.

## Completed at the prior review checkpoint

- [x] Full suite and configured checks pass in the existing and fresh environments.
- [x] In-process and real HTTP demos pass; all six requested governance invariants checked.
- [x] Git history/working content credential audit; no candidate live secret found. Demo/test credentials explicitly classified.
- [x] Secret-file exclusion patterns cover `.env.*` variants without excluding `.env.example`.
- [x] Exact clean-start/database/seed/API/demo/test instructions and current API limitations documented.
- [x] Review branch created; checkpoint documentation and decision index prepared. No remote exists; push commands recorded in CHECKPOINT.md.
