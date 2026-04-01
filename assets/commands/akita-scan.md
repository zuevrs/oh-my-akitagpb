---
description: Discover the current service, capture repo facts, and persist shared scan state.
agent: plan
subtask: false
---

Use the `akita-scan-workflow` skill from `.opencode/skills/akita-scan-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/scan/state-contract.json` and treat it as the canonical scan persistence contract.
2. Read `.oma/capability-manifest.json`.
3. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before reasoning.
4. Read `.oma/runtime/shared/data-handling-policy.json`.
5. Read the installed rule files under `.oma/instructions/rules/`.
6. Persist only the contract-defined shared scan outputs instead of relying on chat memory.

Required shared scan outputs:
- `.oma/state/shared/scan/contracts.json`
- `.oma/state/shared/scan/target-candidates.json`
- `.oma/state/shared/scan/prior-art.json`
- `.oma/state/shared/scan/service-runtime-profile.json`
- `.oma/state/shared/scan/flow-candidates.json`
- `.oma/state/shared/scan/assertion-opportunities.json`
- optional derived summary: `.oma/state/shared/scan/scan-summary.md`

Then:
- inspect the Java/OpenAPI service as it exists today
- identify target candidates, contracts, prior art, runtime profile, flow candidates, and assertion opportunities grounded in repo evidence
- if OpenAPI is present, record that contract evidence in `.oma/state/shared/scan/contracts.json`
- if OpenAPI is absent, do not crash or invent one; persist `code-first fallback` in the contract findings and continue scanning from code and repo structure
- keep shared JSON and markdown redaction-first per `.oma/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- stop with `needs-review` guidance if any manifest-listed bundle file is missing, capability truth cannot be resolved from the manifest, or a requested behavior is explicitly unsupported
- leave scan results in structured JSON so `/akita-plan` can consume them later

If scan succeeds, say the next command is `/akita-plan`.
