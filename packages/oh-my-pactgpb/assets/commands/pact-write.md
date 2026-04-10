---
description: Read persisted Pact scan + plan state and implement only the next safe coverage-aware provider-verification increment.
agent: build
subtask: false
---

Use the `pact-write-workflow` skill from `.opencode/skills/pact-write-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-pactgpb/templates/write/state-contract.json` and treat it as the canonical write persistence contract.
2. Read `.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json`.
3. Read `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json`.
4. Read `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json` from disk as the canonical write input.
5. Read `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json` from disk as supporting evidence.
6. Read `.oma/packs/oh-my-pactgpb/capability-manifest.json`.
7. Read `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`.
8. Read the installed rule files under `.oma/packs/oh-my-pactgpb/instructions/rules/`.
9. Persist only the contract-defined shared write outputs instead of relying on chat memory.

Required shared write outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/write/write-summary.md`

Then:
- treat persisted `plan-state.json` as the canonical write budget and persisted `scan-state.json` as the canonical coverage model
- do not rescan the repo and do not re-plan implicitly inside write
- keep the worldview narrow: Java, Spring Boot providers, HTTP Pact provider verification, provider-first, consumer-generation-free
- implement only the next legitimate coverage slice the persisted plan/coverage support: extend existing verification in place, add grounded missing provider states, extend partially covered endpoints/interactions, or prepare the next uncovered endpoint conservatively when that is all the evidence allows
- prefer extending an existing provider verification setup over generating a second parallel suite
- if the plan verdict is `needs-provider-state-work` or `needs-artifact-source-clarification`, stay honest about any unresolved gaps; partial preparation is allowed, fake coverage is not
- if the plan verdict is `blocked` or `irrelevant`, persist an honest no-write outcome instead of generating misleading artifacts
- keep shared JSON and markdown redaction-first per `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- keep repo writes narrow and attributable; do not overwrite unrelated files, do not rewrite broad test architecture, and do not add unsupported broker or consumer flows

If write succeeds or partially succeeds, say the write state is persisted and call out what coverage slice was targeted, what files were changed, what was intentionally skipped, and the next expected verification step. If write stops with `blocked` or `irrelevant`, say that plainly and do not pretend verification is ready.
