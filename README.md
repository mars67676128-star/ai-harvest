# SIFU — Shared Intelligence From Us

**Ask once. Teach forever.**

SIFU is the current product in this repository for the Tencent Cloud Hackathon Singapore 2026 Keppel Real Estate challenge, **AI HARVEST — Turning Expert Know-How into Reusable Intelligence**.

SIFU is an organisational mentor, not a generic chatbot. It helps employees ask operational questions, detects when validated organisational knowledge is insufficient, routes the gap to the right human expert, converts the expert's teaching into a governed knowledge candidate, requires human validation, and then reuses the validated teaching with provenance in future work.

## Current product flow

```text
Employee question
      ↓
SIFU checks validated organisational knowledge
      ↓
Knowledge gap → route to configured expert
      ↓
Expert teaches in natural language
      ↓
SIFU proposes a reusable knowledge candidate
      ↓
Expert confirms meaning
      ↓
Knowledge Owner validates
      ↓
Validated organisational knowledge
      ↓
Future answers + operational case guidance with provenance
```

The Demo Day story uses a wet-weather sump-pump scenario:

- Amanda Lee asks whether a pump showing `RUNNING` proves it is actually draining.
- SIFU identifies that validated knowledge is insufficient and routes the question to Tan Wei Ming, Senior M&E Technician.
- Tan explains that `RUNNING` may only represent command/motor state and does not prove discharge; actual discharge and water-level trend must be checked.
- SIFU structures that teaching into a candidate.
- Tan confirms the candidate and Jennifer Lim, Knowledge Owner for Technical Services, validates it.
- Amanda asks the same operational problem in a different way and receives the newly validated teaching with provenance.
- Harbour Exchange applies the validated knowledge to a live wet-weather case and reaches `ESCALATE`.

## Active frontend

The active application entry point is `frontend/src/main.tsx` and mounts only the current SIFU workspaces:

- `SifuApp.tsx` — employee / Ask Sifu workspace
- `ExpertDemoShell.tsx` + `ExpertRequestsView.tsx` — expert teaching workflow
- `OwnerDemoShell.tsx` + `KnowledgeOwnerReviewsView.tsx` — Knowledge Owner validation
- `OperationalCaseShell.tsx` + `SifuCaseGuidance.tsx` — Harbour Exchange case guidance
- `components/SifuPet.tsx` — SIFU mascot

The previous AI Harvest frontend has been removed from the active product branch. Its complete pre-cleanup state is preserved on:

```text
archive/pre-final-sifu-cleanup-2026-11-03
```

## Backend

The current backend is the SIFU agent path under `harvest/`, including:

- `harvest/sifu_agent.py` — grounded live SIFU reasoning
- `harvest/sifu_threads.py` — persistent conversations and expert handoff
- `harvest/sifu_candidates.py` / `harvest/sifu_candidate_routes.py` — reusable teaching capture and governance
- `harvest/config.py` — provider, expert directory and Knowledge Owner configuration
- `harvest/providers.py` — model-provider integration

SIFU is designed to fail closed: model output cannot invent approved citations or configured experts, and reusable organisational knowledge requires human confirmation/validation.

## Local setup

### Backend

From the repository root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.lock

$env:HARVEST_ENV = 'demo'
$env:HARVEST_DB = 'data/harvest.db'
$env:HARVEST_LLM_PROVIDER = 'openai'
$env:HARVEST_LLM_BASE_URL = 'https://api.openai.com/v1'
$env:HARVEST_LLM_API_KEY = '<your key>'

$env:SIFU_EXPERT_DIRECTORY = '[{"id":"expert","name":"Tan Wei Ming","role":"Senior M&E Technician","skills":["sump systems","drainage","pump maintenance"],"domains":["Technical Services"]}]'
$env:SIFU_KNOWLEDGE_OWNERS = '[{"id":"approver","name":"Jennifer Lim","domains":["Technical Services"]}]'

.\.venv\Scripts\python.exe -m uvicorn harvest.main:app --host 127.0.0.1 --port 8000
```

Model and reasoning settings can be configured with the remaining variables documented in `.env.example`.

### Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open:

```text
http://127.0.0.1:5173/
```

Demo personas are selected through the existing persona query flow used by the recorder. The Harbour Exchange case is available through the case route used by the demo workflow.

## Final Demo Day recording

There is one supported recording command:

```powershell
.\scripts\record-demo-final.ps1
```

The launcher:

1. verifies the final recorder patches and generated JavaScript syntax;
2. creates a fresh recording database;
3. ensures Tan Wei Ming and Jennifer Lim exist in the recording configuration;
4. activates recording-only deterministic routing/reuse safeguards;
5. starts the SIFU agent backend and Vite frontend;
6. records the full browser workflow with Playwright;
7. cleans up the launched processes afterward.

Output:

```text
artifacts\video\Sifu_DemoDay_Final.webm
```

The final visual treatment intentionally uses **smooth zooms, typewriter interaction, click ripples, captions and branded transition cards without rectangular focus boxes**. The mascot remains visible but is docked small in a safe top-right position during recording so it does not cover working content.

`frontend/scripts/record-demo-final.mjs` is the public final recorder. `frontend/scripts/record-demo-take3.mjs` remains only as its internal implementation base and should not be run directly.

## Demo-data note

All people, assets, incidents, thresholds and outcomes in the hackathon demo are synthetic. The repository is not connected to Keppel production systems or building controls.

The recording-only stabilisation code is scoped to the dedicated Demo Day recording database. Normal SIFU behaviour continues to use the live agent and its grounding/governance rules.

## Tests

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend production build:

```powershell
cd frontend
npm run build
```

## Archive policy

The active branch should contain only the current SIFU product and the final recording workflow. Older UI/product iterations and recorder experiments are retained through Git history and the explicit archive branch rather than remaining mixed into the active source tree.
