# Bounded discovery — AI HARVEST

Decision date: 29 September 2026. Desk research of public, primary sources; no Keppel interviews or internal data. Scores and gaps below are product hypotheses, not measured competitor benchmarks. Research is closed for this MVP unless implementation exposes a serious blocker.

## Sources and what they establish

1. [PUB, Flood-Resilient Developments Guidebook launch, 18 June 2026](https://www.pub.gov.sg/Resources/News-Room/PressReleases/2026/06/Flood-Resilient-Developments-Guidebook): property-level flood resilience, risk assessment and response planning are real Singapore workflows.
2. [PUB, guides and handbooks](https://www.pub.gov.sg/Professionals/Resources/Guides-and-Handbooks): the guidebook addresses owners and property managers as well as design professionals. Used as context, not a source of executable thresholds.
3. [JLL Smart Building Platform](https://www.jll.com/en-us/products/smart-building-platform): predictive maintenance, fault diagnostics, leak detection and demand-led HVAC are already established product categories.
4. [CBRE Ellis AI](https://www.cbre.com/about-us/technology/artificial-intelligence): search, summarisation, lease extraction and tailored assistants are existing approaches.
5. [JLL Carbon Pathfinder](https://www.jll.com/en-us/products/carbon-pathfinder): climate transition modelling and capital prioritisation already have specialist tools.
6. [Building Engines Prism](https://www.buildingengines.com/platform-overview/): integrated work orders, inspections, tenant experience and AI insights.
7. [Building Engines tenant management](https://www.buildingengines.com/tenants/): service requests, tenant updates, bookings and communications are mature workflows.
8. [Managing Commercial HVAC Systems: What do Building Operators Really Need?](https://arxiv.org/abs/1612.06025): observational research grounds the importance of operator workflows and contextual understanding; older research, not a current market survey.

These descriptions do not establish that competitors lack governance or expert capture. Our differentiation hypothesis is the visible end-to-end capture → portable rule → tested release → operational use → reviewed revision loop.

## Six domains

| Domain | Promising scenarios (three each) | Existing approach | Opportunity for a Pill |
|---|---|---|---|
| Asset Operations | Monsoon water-ingress near miss; repeated nuisance alarm triage; contractor handover exceptions | CMMS work orders, Prism, BMS alarm dashboards [3,6] | Capture why apparently normal telemetry may be misleading; require corroborating evidence and encode escalation; release site-specific judgement with regression cases. |
| Energy Optimisation | Chiller low-load sequencing; after-hours cooling exception; comfort-versus-energy trade-off | BMS optimisation, JLL smart building analytics [3] | Encode when a savings recommendation must be withheld, including operating context and comfort constraints. Quantitative savings require reliable baselines we do not have. |
| Leasing | Renewal concession exceptions; tenant fit-out feasibility; unusual lease obligation handover | Lease extraction/search, Ellis AI [4] | Capture negotiation context and exception handling with accountable approval. Commercial confidentiality and subjective value make a short synthetic demo harder to validate. |
| Technical Services | Running pump with ineffective drainage; recurring AHU trip; post-maintenance return-to-service checks | Fault detection, predictive maintenance, inspection records [3,6] | Explain evidence hierarchy and novice pitfalls. Bound recommendations to qualified inspection rather than repair or actuation. |
| Sustainability | Meter anomaly before carbon reporting; retrofit prioritisation exceptions; embodied-versus-operational carbon trade-offs | Carbon Pathfinder, benchmarks and scenario models [5] | Encode evidence-quality checks and contextual exceptions before accepting numbers; history shows who approved assumptions. More data preparation than the selected incident story. |
| Tenant Experience | Safe access during an incident; repeated comfort complaints; after-hours service exception | Prism tenant requests, updates and bookings [7] | Bring tenant constraints into operational reasoning before recommending access changes; missing route verification must prevent a confident continuity plan. |

## Comparison matrix

1–5, higher is better. A Pill fit; B differentiation; C 60-second clarity; D cross-domain; E data feasibility; F impact; G human supervision; H governance; I implementation feasibility; J creative upside. Each row evaluates the strongest scenario in that domain, not the entire industry.

| Domain / representative scenario | A | B | C | D | E | F | G | H | I | J |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Asset Operations / monsoon near miss | 5 | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 5 |
| Energy / chiller sequencing | 5 | 2 | 4 | 4 | 3 | 5 | 4 | 5 | 4 | 2 |
| Leasing / renewal exception | 5 | 4 | 3 | 4 | 2 | 5 | 5 | 5 | 3 | 4 |
| Technical / misleading pump status | 5 | 4 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 4 |
| Sustainability / reporting anomaly | 4 | 3 | 3 | 4 | 3 | 4 | 5 | 5 | 4 | 3 |
| Tenant / incident access continuity | 4 | 4 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 4 |

## Decision

**Primary: Asset Operations — monsoon water-ingress triage, incorporating bounded technical judgement. Secondary: Tenant Experience — safe access and continuity.**

The fictional Harbour Exchange office reports a pump running while basement water rises. A novice might read “running” as “effective.” A synthetic expert instead asks about the water trend, corroboration and critical equipment proximity. The first Pill makes that judgement inspectable. The second refuses to recommend an access plan when an alternative route is unverified. Together they show that an operational recommendation can be technically plausible but unacceptable in the tenant context.

This wins on narrative clarity and the knowledge lifecycle, not the score total. Generic retrieval could find a flood procedure. Our demo exposes exactly which expert rule fired, which release authorised it, which evidence is missing, and why a subsequent correction remains a candidate until independently reviewed. A new drain-backflow observation becomes v1.1.0 without rewriting v1.0.0 or the recommendation that used it.

Energy optimisation remains a credible future domain but is crowded and invites unsupported savings claims. Leasing needs commercially sensitive context. Carbon reporting needs larger evidence preparation. The selected incident can be reproduced with a small, labelled fixture set and no building connectivity.

The MVP is a decision-support demonstration, not an emergency-response product. All operational thresholds and heuristics are synthetic. Measure workflow properties: time to review, completeness of evidence, detection of seeded exceptions, traceability, and prevention of unauthorised releases. Financial or safety outcomes require a future supervised pilot; no invented ROI claims.
