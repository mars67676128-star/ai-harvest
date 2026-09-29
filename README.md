# AI HARVEST

**Capture how experienced people judge a situation. Release that knowledge as portable, tested, versioned Intelligence Pills. Keep humans accountable.**

Backend MVP for the Keppel real-estate challenge in the supplied Tencent Cloud Hackathon Singapore 2026 brief. All demo people, assets, interviews, thresholds and outcomes are synthetic. This repository is not connected to Keppel systems or building controls.

The selected story: **the pump is green, but the water is rising.** Asset Operations expertise recognises that a running signal does not prove effective drainage. A Tenant Experience Pill blocks a proposed access plan when the alternative route has not been verified. An operational correction later adds a backflow exception through an independently reviewed v1.1.0 release.

## Run locally

Python 3.11+ is required. Verified on Windows / Python 3.14.5; the other platforms/versions in CI have not yet run. Use the commands below from the repository root. No PostgreSQL server, manual SQL, `.env` file, cloud credentials or paid model calls are needed. The pinned dependency files are the reproducible install path.

### Windows PowerShell: environment, database, seed and API

On a clean checkout:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock
$env:HARVEST_ENV = 'demo'
$env:HARVEST_LLM_PROVIDER = 'mock'
$env:HARVEST_DB = 'data/review.db'
Remove-Item Env:HARVEST_AUTH_TOKENS -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -m harvest.demo --seed-only --database data/review.db --output artifacts/review-seed.json
.\.venv\Scripts\python.exe -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000
```

`Remove-Item Env:...` clears an inherited token override in this shell only; it does not delete a file. The seed command creates the database directory/file, applies `harvest/migrations/001_initial.sql`, and releases two synthetic v1.0.0 Pills through the actual governance endpoints. API startup also applies any missing numbered migrations automatically. No separate database setup command is required. For another clean run choose a new database filename; preserve existing history.

API: [http://127.0.0.1:8000](http://127.0.0.1:8000). Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Health: `/health`. Stop the process with Ctrl+C. The seed CLI uses fixed demo identities; use it against demo environments only.

In a second PowerShell terminal, still at the repository root:

```powershell
.\.venv\Scripts\python.exe -m harvest.demo --output artifacts/demo-report.json
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check harvest tests scripts
.\.venv\Scripts\python.exe -m ruff format --check harvest tests scripts
.\.venv\Scripts\python.exe -m pip check
```

The default demo exercises the **actual REST API in process**, using its own newly timestamped database; it does not need the running server and does not change `data/review.db`. Its JSON report includes API payloads, rule traces, candidate diff and audit. Separate expert/reviewer/approver/operator roles are simulated; this is not qualified field review.

### macOS/Linux: equivalent clean start

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.lock
export HARVEST_ENV=demo HARVEST_LLM_PROVIDER=mock HARVEST_DB=data/review.db
unset HARVEST_AUTH_TOKENS
.venv/bin/python -m harvest.demo --seed-only --database data/review.db --output artifacts/review-seed.json
.venv/bin/python -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000
# In another terminal at the repository root:
.venv/bin/python -m harvest.demo
.venv/bin/python -m pytest -q
.venv/bin/python -m ruff check harvest tests scripts
.venv/bin/python -m ruff format --check harvest tests scripts
.venv/bin/python -m pip check
```

### Optional launcher and HTTP demo

`powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1` or `sh scripts/start.sh` starts the same API. The launcher creates a virtual environment and installs dependencies if absent; it does not seed data, reset a database, load `.env`, or clear inherited configuration. Without `HARVEST_DB`, the default file is `data/harvest.db`.

To seed an otherwise empty running demo API instead of seeding its database before startup:

```powershell
.\.venv\Scripts\python.exe -m harvest.demo --url http://127.0.0.1:8000 --seed-only
```

The seeder leaves existing Pill identities unchanged, regardless of their state. It does not repair an interrupted draft, reapprove a deprecated version or reset a completed demo. Inspect `/api/v1/pills` or choose a fresh database if the prior run stopped midway.

Run the complete workflow against the running API only while its data is fresh or contains just the initial v1.0.0 seed:

```powershell
.\.venv\Scripts\python.exe -m harvest.demo --url http://127.0.0.1:8000
```

Use a new database for each full HTTP demo; it deliberately does not overwrite v1.1.0 on repeat. The default in-process demo creates a fresh database automatically. `--database path/to/demo.db` selects the local demo's file and is ignored when `--url` selects a running API. Swagger is a developer aid; the scripted lifecycle is the demo.

Ruff supplies the configured lint/static and formatting checks. No mypy/pyright type-check configuration or dedicated secret-scanning tool is installed/configured in this repository. See [review checkpoint](docs/CHECKPOINT.md) for verification scope and [TODO](docs/TODO.md) for known limitations.

## What works

- Case-based expert elicitation, stored interviews, schema-validated extraction and draft compilation.
- Portable JSON knowledge with scope, typed inputs/units/freshness, rules, evidence, assumptions, prohibitions and executable evaluations.
- `DRAFT → IN_REVIEW → APPROVED`; independent review, hash-bound passing tests, owner-only promotion and atomic supersession.
- Explicit orchestration of up to two approved capabilities, including pinned dependencies and block precedence.
- Recommendations expose exact versions/hashes, rule matches, input evidence, limitations, escalation and untrusted optional AI explanation.
- Human decision, outcome, feedback, separate candidate proposal, field/rule diff, rejection, deprecation and readable history.
- Transactional append-only audit; immutable content and operational-history database triggers.
- Deterministic tests, concurrent approval protection, safe model-failure behaviour and a real compatible HTTP adapter for Tencent.

Feedback and model output have **no path to editing an approved artifact**. Routine human approval cannot bypass escalation or use expired observations/retired knowledge. No equipment-control or outbound-message operation exists.

## Architecture and integration

FastAPI + Pydantic + SQLite in a modular monolith. Expert judgement lives in a finite declarative rule DSL, not only prompts. HTTPX connects to a replaceable LLM provider. No vector database, microservices or autonomous-agent network is required for this scenario.

| Area | Read |
|---|---|
| Research and decision | [Scenario research](docs/SCENARIO_RESEARCH.md) |
| Design and trade-offs | [Architecture](docs/ARCHITECTURE.md), [build notes](docs/BUILD_NOTES.md) |
| Knowledge specification | [Content JSON Schema](schemas/pill.schema.json), [complete version/export schema](schemas/pill-version.schema.json), [example artifact](examples/asset-pill.json) |
| Frontend integration | [Contract](docs/FRONTEND_CONTRACT.md), [OpenAPI snapshot](docs/openapi.json), [examples](examples/) |
| Demo and judging story | [Six-minute walkthrough](docs/DEMO.md) |
| Provenance and Tencent evidence | [Data provenance](docs/DATA_PROVENANCE.md), [hackathon evidence](docs/HACKATHON_EVIDENCE.md) |
| Independent review | [Checkpoint and verification](docs/CHECKPOINT.md), [known limitations](docs/TODO.md), [decision index](docs/DECISIONS.md), [acceptance evidence](docs/ACCEPTANCE.md) |

Regenerate schemas and examples with `python scripts/export_contracts.py`. Example observation timestamps are fixed export snapshots: regenerate or replace them with current verified observations before invoking; stale observations intentionally abstain.

Local fixture bearer tokens: `demo-expert`, `demo-reviewer`, `demo-approver`, `demo-operator`, `demo-viewer`. They identify separate roles in the demo and are publicly documented, insecure credentials. All application data is single-organisation. There is no multi-tenant isolation or SSO.

## Live Tencent edge

Set environment variables; the Python application does **not** automatically load `.env`. Copy `.env.example` for deployment reference or use Docker's env-file support. No keys were supplied, so no live Tencent call or CodeBuddy/WorkBuddy usage is claimed.

```powershell
$env:HARVEST_LLM_PROVIDER = 'tencent'
$env:HARVEST_LLM_BASE_URL = 'https://tokenhub-intl.tencentcloudmaas.com/v1'
$env:HARVEST_LLM_MODEL = '<enabled model ID from your Tencent console>'
# Set HARVEST_LLM_API_KEY through your environment/secret manager; do not commit it.
.\.venv\Scripts\python.exe -m harvest.demo --live
```

For mainland accounts use the documented regional endpoint in the evidence guide. A model must support Chat Completions JSON-object output; unsupported/malformed responses fail safely. `HARVEST_LLM_PROVIDER=compatible` uses the same replaceable adapter for other services. Live output must pass the same schema, review and evaluation gates; a failed model-generated candidate stops the demo release for inspection. The offline provider only replays the exact synthetic interview/correction fixtures and does not pretend to understand arbitrary text.

For non-demo deployment set `HARVEST_ENV=production` and `HARVEST_AUTH_TOKENS` to a private JSON map of long random tokens to `{id, roles}`. The server rejects default demo tokens in production mode. Role checks are enforced against server configuration, not request-supplied identity headers. Replace these static tokens with organisational identity before a real pilot.

## Packaging and boundaries

`docker compose up --build` is an optional loopback demo deployment with a persistent volume. Docker and Linux CI are supplied but were not executed in this Windows environment. The local Windows tests and HTTP demo are the verified path. Runtime and development dependency snapshots are pinned separately.

No financial or safety benefit has been measured. Synthetic thresholds need qualified domain validation. `verified` evidence is a caller attestation; there is no live BMS connector. Local audit triggers are not tamper-proof against a database administrator. Production requires identity integration, TLS, rate limits, backup/restore and retention design. The workspace's original PDF is preserved and excluded from application checkpoints.

Checkpoint policy: commit each completed implementation section locally; inspect `git log --oneline`. Generated databases, demo reports, secrets and the virtual environment are excluded from commits. No remote repository has been configured or pushed.
