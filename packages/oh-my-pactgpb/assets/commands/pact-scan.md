---
description: Scan a Java/Spring repository for Pact provider-verification evidence and persist grounded scan state.
agent: build
subtask: false
---

Use the `pact-scan-workflow` skill from `.opencode/skills/pact-scan-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json` and treat it as the canonical scan persistence contract.
2. Read `.oma/packs/oh-my-pactgpb/capability-manifest.json`.
3. Read `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`.
4. Read the installed rule files under `.oma/packs/oh-my-pactgpb/instructions/rules/`.
5. Persist only the contract-defined shared scan outputs instead of relying on chat memory.

Required shared scan outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-summary.md`

Then:
- inspect the repository as a potential Pact **provider verification** target, not as a generic testing platform
- look specifically for Java/Spring HTTP provider evidence: Maven/Gradle Pact dependencies, provider verification tests, local pact files, broker-related config, provider state hooks, Spring controllers/request mappings, DTOs/serializers, and integration-test prior art
- identify the most likely provider under contract and explain why it is the best fit; if ambiguous, persist the ambiguity instead of guessing
- determine where Pact artifacts are expected to come from: local files, broker-related config, or unclear
- record whether an existing verification setup already exists and what pieces are missing
- capture provider-state-oriented evidence honestly, including annotations, helper methods, fixtures, and setup gaps
- keep shared JSON and markdown redaction-first per `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- if Pact provider verification does not look relevant, persist that conclusion with repo evidence and explicit reasons instead of inventing a flow
- leave scan results in structured JSON so later work can build on persisted evidence instead of chat memory

If scan succeeds, say the scan state is persisted and call out the main gaps/blockers plainly.
