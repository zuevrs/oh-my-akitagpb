---
description: Discover the current system under test, capture repo facts, and persist shared scan state.
agent: build
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
- `.oma/state/shared/scan/scan-state.json`
- optional derived summary: `.oma/state/shared/scan/scan-summary.md`

Then:
- inspect the target repo as a system under test instead of assuming a REST/OpenAPI-centered service model
- identify trigger surfaces, contract evidence, target candidates, prior art, runtime profile, flow candidates, and assertion opportunities grounded in repo evidence
- treat OpenAPI and AsyncAPI as first-class contract evidence when they are present, alongside code-first contracts, DTO or event schemas, and existing tests or feature files
- if OpenAPI or AsyncAPI is absent, do not crash or invent one; continue honestly from code and repo evidence and record the available contract evidence in `.oma/state/shared/scan/scan-state.json`
- trace side-effect and evidence surfaces such as DB, broker, files, documents, exports, response payloads, and async state transitions when the repo exposes them
- derive candidate flows from repo evidence plus manifest-listed capability truth; do not rely on README-only claims and do not turn scan into a pre-baked scenario catalog
- keep shared JSON and markdown redaction-first per `.oma/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- stop with `needs-review` guidance if any manifest-listed bundle file is missing, capability truth cannot be resolved from the manifest, or a requested behavior is explicitly unsupported
- leave scan results in structured JSON so `/akita-plan` can consume them later

If scan succeeds, say the next command is `/akita-plan`.
