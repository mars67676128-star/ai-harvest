# Hackathon evidence — truthful status

The project brief requires meaningful Tencent tooling use. **An implemented adapter alone is not proof of actual use or hackathon eligibility.** Credentials and a real run remain external prerequisites.

## Integration decision

Tencent at the model edge: structured extraction of a synthetic expert interview and proposal of a governed revision. The same portable Pill, rule engine and approval transaction work with the fixture provider or another compatible provider.

Official sources checked 2026-09-29:

- [Tencent TokenHub migration guide, international endpoint](https://intl.cloud.tencent.com/ind/document/product/1300/79733)
- [Tencent migration guide, mainland endpoint](https://cloud.tencent.com/document/product/1823/131382)
- [Tencent Hunyuan invocation examples](https://cloud.tencent.com/document/product/1823/132252)
- [Legacy Hunyuan compatibility page and migration notice](https://cloud.tencent.com/document/product/1729/111007)

Endpoints and enabled model IDs are account/region dependent. Configure explicitly; do not use similarly named third-party TokenHub services.

## Evidence to collect before submission

- [ ] Confirm organiser requirements, permitted model/services and judging criteria.
- [ ] Configure a Tencent API key privately and an enabled model ID.
- [ ] Run `python -m harvest.demo --live` with the Tencent configuration.
- [ ] Retain a redacted provider request ID/model/prompt version and generated artifact hash from the run.
- [ ] Capture the actual Tencent console usage screen, with secrets redacted.
- [ ] Capture CodeBuddy/WorkBuddy screenshots only if those tools were actually used.
- [ ] Save notable prompts from `harvest/prompts/` with hashes/version and real development logs.
- [ ] Show the architecture boundary, immutable approved artifact, pending candidate and release audit.
- [ ] Keep an offline demo recording and test output as fallback.

Implemented, simulated and externally verified evidence must remain separate. Current status: local fallback and adapter implementation; no live Tencent, CodeBuddy or WorkBuddy use asserted.
