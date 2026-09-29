# Data provenance

All assets, people, interviews, telemetry, incident IDs, thresholds and outcomes in the seed/demo are **SYNTHETIC DEMO DATA**, not Keppel operational data. No measured safety benefit, cost saving or professional endorsement is claimed.

| Dataset / source | Real or synthetic | Licence / handling | Purpose and transformation |
|---|---|---|---|
| [PUB FRD launch, June 2026](https://www.pub.gov.sg/Resources/News-Room/PressReleases/2026/06/Flood-Resilient-Developments-Guidebook) | Real public context | Linked, not redistributed; no open-data licence assumed | Establish Singapore relevance of property-level flood response planning. No regulatory thresholds extracted. |
| Public product pages in SCENARIO_RESEARCH.md | Real marketing descriptions | Links and short paraphrases; no vendor assets copied | Bound the product landscape. No product performance claims adopted. |
| Harbour Exchange office, basement sump, tenant arrival | Synthetic | Repository demo fixtures | Small reproducible case with equipment metadata, observed evidence and access constraints. No actual site layout. |
| Two expert case interviews and elicitation questions | Synthetic | Repository demo fixtures | Reconstruct incident, novice mistake, exceptions, uncertainty and escalation; exact offline extraction fixtures. |
| Asset Operations and Tenant Experience Pills | Synthetic | Repository demo fixtures | Typed rules, thresholds and tests authored for demonstration, not a safety standard. Public context does not validate these rules. |
| Water rise rate, sensor ages, pump status, route verification, backflow | Synthetic | Repository demo fixtures | Controlled normal, missing, unsafe, out-of-scope and revised cases. Unit and timestamp supplied per observation. |
| Human correction, operational outcome and v1.1 proposal | Synthetic | Repository demo fixtures | Illustrate learning governance; never described as a real incident or achieved result. |
| Deterministic AI extraction/explanation | Synthetic fixture output | Explicit `provider=mock`, prompt version and content hash | Offline replay only; not proof of model quality. |

No bulk dataset is necessary. Every rule carries evidence references, and runtime observations carry source, collection time and quality. Evidence links are provenance only: the service never fetches arbitrary URLs. Live AI sends only submitted capture/case context to the configured provider; do not submit real confidential tenant or building information without organisational authorisation. Retention and redaction are production work.
