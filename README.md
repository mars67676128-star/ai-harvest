# AI HARVEST

**Capture how experienced people judge a situation. Release that knowledge as portable, tested, versioned Intelligence Pills. Keep humans accountable.**

Backend MVP for the Keppel real-estate challenge in the supplied Tencent Cloud Hackathon Singapore 2026 brief. All demo people, assets, interviews, thresholds and outcomes are synthetic. This repository is not connected to Keppel systems or building controls.

The selected story: **the pump is green, but the water is rising.** Asset Operations expertise recognises that a running signal does not prove effective drainage. A Tenant Experience Pill blocks a proposed access plan when the alternative route has not been verified. An operational correction later adds a backflow exception through an independently reviewed v1.1.0 release.

## Run locally

Python 3.11+ is required. Tested here on Windows / Python 3.14.5. The default provider is deterministic and needs no credentials or paid calls.

From the repository root, Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock
.\.venv\Scripts\python.exe -m harvest.demo
.\.venv\Scripts\python.exe -m pytest -q
```

The demo exercises the **actual REST API in process**, creates a new timestamped SQLite database, prints the narrative, and writes `artifacts/demo-report.json` with full API payloads, rule trace, diff and audit. It simulates separate expert/reviewer/approver/operator roles and labels them as simulated. It does not claim an actual qualified professional reviewed the synthetic rules.

One-command API startup after checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

On macOS/Linux:

```sh
sh scripts/start.sh
# In another terminal:
.venv/bin/python -m harvest.demo
.venv/bin/python -m pytest -q
```

The launcher creates a virtual environment and installs dependencies if the environment is absent, then binds to loopback. If you already have an environment, run the install command after dependency changes.

API: [http://127.0.0.1:8000](http://127.0.0.1:8000). Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Health: `/health`. The interactive docs are a developer aid; the scripted lifecycle is the demo.

Seed the running API idempotently with two approved demo Pills:

```powershell
.\.venv\Scripts\python.exe -m harvest.demo --url http://127.0.0.1:8000 --seed-only
```

Or run the complete workflow against a **fresh** running API:

```powershell
.\.venv\Scripts\python.exe -m harvest.demo --url http://127.0.0.1:8000
```

Use a fresh database for each full demo; the workflow deliberately does not overwrite v1.1.0 on repeat. The default in-process demo does this automatically. `--database path/to/demo.db` selects a persistent file. Numbered SQL migrations apply automatically on application creation.

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
| Verification | [Acceptance evidence](docs/ACCEPTANCE.md) |

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
