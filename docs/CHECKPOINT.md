# Backend MVP — independent review checkpoint

Review preparation date: 29 September 2026. Branch: `codex/mvp-backend`.

The checkpoint is the Git commit containing this document (`git rev-parse HEAD` on the review branch). Application baseline: `d09e9c5`. This preparation changes documentation and secret-file exclusion patterns only. No product features, architecture redesign, dependency changes, database migrations, frontend work or runtime changes were made. No runtime defect requiring repair was reproduced in the requested governance checks.

## Verification results

| Check | Current result |
|---|---|
| Complete suite: `python -m pytest -q` | **48 passed**, one dependency deprecation warning |
| Static/lint: `python -m ruff check harvest tests scripts` | Passed |
| Format: `python -m ruff format --check harvest tests scripts` | Passed; 20 Python files formatted |
| Dependency consistency: `python -m pip check` | Passed; no broken requirements |
| Configured type checker | None. No mypy/pyright project configuration; no type-check pass is claimed |
| Default documented in-process demo | Passed; v1.0.0 → candidate → v1.1.0, 33 audit events |
| Clean source/environment verification | Passed from a Git archive of the baseline into a fresh virtual environment on Windows/Python 3.14.5 |
| Clean install | Exact lock-file wheels downloaded, then installed offline into the isolated environment; existing site-packages were not reused |
| Suite/checks in fresh environment | Same 48 passing tests, Ruff checks and dependency consistency |
| SQLite initialisation and seed | New file and numbered migration created automatically; two approved synthetic v1.0.0 Pills; repeat initial seeding preserved them |
| Real HTTP API demo | Passed using Uvicorn and the fresh environment/seeded database; health, full CLI demo and governance probes verified |
| OpenAPI/schema consistency | Checked-in OpenAPI equals app-generated specification; both Pill schemas equal model-generated schemas |
| Source/history secret audit | No candidate live secrets detected in 52 baseline tracked files / four commits / 54 unique blobs, plus inspection of the pending review changes |
| Unwanted tracked outputs | No runtime database, report, virtual environment, cache, log or real `.env` tracked |

The warning is `anyio.abc.BlockingPortal` deprecation in Starlette's test client. It does not fail tests; dependencies were deliberately not upgraded during the freeze.

The clean verification used an isolated Git archive under ignored `artifacts/`. Windows sandbox ownership prevented the elevated process from executing that private temporary environment directly; downloading the same pinned wheels and installing them offline resolved the verification issue without modifying project behaviour. This is a host permission detail, not an application setup requirement.

## Governance evidence

| Invariant | Tests / independent HTTP observation |
|---|---|
| Draft cannot be used as production knowledge | `test_draft_cannot_be_invoked`; HTTP invocation of a draft-only identity returns 404 |
| Feedback cannot mutate approved content | `test_complete_api_driven_demo`, `test_feedback_failure_keeps_original_and_feedback`, database immutability test; v1.0.0 hash unchanged before candidate approval |
| Feedback only leads to a candidate | Feedback submission persists an observation; separate expert `/feedback/{id}/propose` returns DRAFT. Full demo asserts production unchanged |
| Promotion requires authorised deterministic governance | Exact-review/validation, author-separation, failed-evaluation, stale-parent and concurrent-approval tests; HTTP promotion using expert token returns 403 |
| Previous releases remain available | Full demo reads SUPERSEDED v1.0.0 and its old recommendation; independent HTTP read confirms content hash matches the pre-release recommendation |
| Out-of-scope input abstains/escalates | Engine scope case and independent HTTP residential-asset probe return ABSTAIN with no actions |

Other covered boundaries include missing/stale/future/invalid/conflicting evidence, pinned dependencies, cross-domain block precedence, absent execution endpoints, escalation bypass prevention, model failure, injected model status, and expired recommendation approval.

## Reproduce and inspect

Follow the exact environment/database/seed/API/test commands in [README](../README.md). Read [DECISIONS](DECISIONS.md), [ARCHITECTURE](ARCHITECTURE.md), [FRONTEND_CONTRACT](FRONTEND_CONTRACT.md) and [TODO](TODO.md) before reviewing source.

Suggested code reading order: `harvest/models.py` → `harvest/migrations/001_initial.sql` → `harvest/governance.py` → `harvest/engine.py` → `harvest/service.py` → `harvest/providers.py` → `harvest/api.py` → tests. The finite rule DSL, approval transaction and provider boundary carry the core invariants.

Review artifacts remain local and ignored: `artifacts/review-demo-report.json`; the isolated clean source/environment and its seed/HTTP reports are under the directory recorded in `artifacts/review-clean-path.txt`. Reports can be regenerated and contain synthetic data, not credentials. The verification server created for this review was stopped after checks.

## Repository and credential handling

- Review branch created locally; one review-preparation checkpoint. No remote configured, no push, no merge into `main` or `master`.
- The original `3af2d08d-d3f0-4998-98a5-a820bd245910.pdf` is preserved, untracked and outside the application review checkpoint. A fresh checkout will not contain it.
- `.env.example` is intentional and contains blank secret fields/placeholders. `.env` and `.env.*` are excluded from Git and Docker context, except `.env.example`.
- Public `demo-*` bearer tokens and `test-secret`/`test` fixtures are intentionally tracked. They are not production credentials. Production mode rejects default demo token configuration.
- Secret review used targeted private-key/provider/cloud/token/credential-URL patterns across all reachable baseline Git blobs, filename inspection, and manual review of credential-bearing code/config/test sites. No dedicated secret scanner or vulnerability scan was run. No zero-secret guarantee is implied.
- OpenAPI, JSON Schemas and synthetic `examples/` files are intentionally committed integration artifacts. Example observation timestamps are fixed snapshots and will become stale. Databases, execution reports, wheels, caches and virtual environments are excluded.

## Remote publication commands

After creating an empty GitHub repository, replace `OWNER/REPOSITORY` with its actual path. This review branch already exists locally:

```sh
git switch codex/mvp-backend
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin codex/mvp-backend
```

For another checkout that has the checkpoint commit but lacks this branch, create it first with `git switch -c codex/mvp-backend CHECKPOINT_SHA`, replacing `CHECKPOINT_SHA` with the reported final SHA. Do not merge as part of review preparation. Git writes on this host may require `git -c safe.directory="C:/Users/Daymas Koh/hackathon" ...` because the initial directory was created by the sandbox account; avoid broad/global trust exceptions.

All operational assets, interviews, thresholds, outcomes and simulated human approvals are **SYNTHETIC DEMO DATA**. The software checks do not establish building safety, domain correctness or real expert approval. Live Tencent use, CodeBuddy/WorkBuddy evidence, Docker execution, Linux CI and a field pilot are not claimed.
