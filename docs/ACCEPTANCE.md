# Acceptance evidence

Local verification is against synthetic fixtures. Tests do not make paid network calls. The provider wire test uses HTTPX MockTransport.

| Requirement | Implementation / evidence |
|---|---|
| Bounded six-domain research and chosen scenario | SCENARIO_RESEARCH.md; primary sources and explicit hypothesis scores |
| Provenance | DATA_PROVENANCE.md; every artifact/case carries synthetic labelling and evidence |
| Capture → structured draft | `/captures`, `/extract`, `/compile`; full API demo test |
| Portable schema | models.py, generated pill.schema.json; bad rule graph validation tests |
| Expert review and approved release | governance.py; exact review/hash/test and independent author tests |
| Draft unusable in production | `test_draft_cannot_be_invoked` |
| Approved invocation, provenance and explanation | API demo; typed RecommendationRecord, content hashes and rule trace |
| Missing/stale/mistyped/conflicting evidence and scope | parametrised engine tests; ABSTAIN with reasons |
| Cross-domain cooperation | both capabilities in API demo; dependency and block-precedence tests |
| Human authority and no prohibited execution | distinct roles, escalation bypass rejection, absent execution/mutation routes |
| Outcome and learning | decision → outcome → feedback → separate candidate endpoint; single-outcome checks |
| Feedback cannot modify production | complete demo hash equality; failed-model feedback preservation test |
| Candidate review/diff, approval/rejection | semantic field/rule diff; stale-parent and rejection preservation tests |
| History and audit | immutable DB triggers, historical recommendation test, event-set assertion |
| Concurrent promotion | real threaded SQLite test: exactly one winner, stale sibling rejected |
| Model safety/failure | broken provider, injected status, malformed/truncated/429 response and untrusted-narrative tests |
| Frontend handoff | generated OpenAPI, portable schema, example payloads and FRONTEND_CONTRACT.md |
| Local run/demo | README, launch scripts, CLI uses actual API handlers and produces saved report |
| Tencent portability | configurable real compatible adapter; mocked wire contract verified |
| Live Tencent / CodeBuddy / WorkBuddy evidence | **Pending credentials and actual use.** HACKATHON_EVIDENCE.md checklist |
| Production field validation / cloud deployment | **Not claimed.** Synthetic prototype; Docker/CI configurations not executed locally |

Checkpoint commits preserve completed sections. The final handoff checkpoint records the verified result and integration artifacts. See BUILD_NOTES.md for exact run results.
