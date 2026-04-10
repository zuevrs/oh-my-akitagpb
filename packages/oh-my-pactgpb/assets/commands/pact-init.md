---
description: Assess a zero-Pact Java/Spring repo and bootstrap minimal Pact provider verification only when justified.
agent: build
subtask: false
---

Use the `pact-init-workflow` skill from `.opencode/skills/pact-init-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-pactgpb/templates/init/state-contract.json` and treat it as the canonical init persistence contract.
2. Read `.oma/packs/oh-my-pactgpb/capability-manifest.json`.
3. Read `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`.
4. Read the installed rule files under `.oma/packs/oh-my-pactgpb/instructions/rules/`.
5. Persist only the contract-defined shared init outputs instead of relying on chat memory.

Required shared init outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/init/init-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/init/init-summary.md`

Then:
- treat `/pact-init` as a one-shot bootstrap entry for **zero-Pact Java/Spring provider repos**
- first determine whether meaningful Pact provider evidence already exists in the repo; if it does, persist `existing-pact-evidence-detected`, do not bootstrap a parallel setup, and point the user to `/pact-scan`
- for zero-Pact repos, decide whether Pact provider verification is justified here at all instead of assuming it should always be started
- identify the best candidate provider boundary and the best candidate HTTP contract surface using Spring controllers, request mappings, DTOs, integration-test prior art, and OpenAPI when present
- keep ambiguity explicit; if multiple provider boundaries are plausible, persist that as `insufficient-boundary-evidence` instead of guessing
- if the repo only exposes weak/internal/admin-style HTTP seams or otherwise lacks a strong contract boundary, persist `init-not-justified` instead of scaffolding
- only when init is justified, write a **minimal provider-side bootstrap**: narrow build dependency patching, a provider verification harness derived from the shipped baseline, optional neutral state-support shell when justified, and the persisted init outputs
- do not generate consumer pact files, broker publish automation, can-i-deploy automation, message pact support, or generic contract-platform abstractions
- keep shared JSON and markdown redaction-first per `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- after `init-completed`, recommend the exact missing grounding step; do not imply that `/pact-scan` is ready until pact artifact source evidence actually exists

If init succeeds, say the init state is persisted and call out the outcome, selected boundary, what bootstrap was written, what is still unproven, and the next grounding step plainly.