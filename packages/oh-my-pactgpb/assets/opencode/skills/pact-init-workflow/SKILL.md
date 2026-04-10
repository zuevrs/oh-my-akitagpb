---
name: pact-init-workflow
description: Assess zero-Pact Java/Spring repos and bootstrap minimal provider-side Pact verification for the installed /pact-init command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/pact-init` flow.

## Required reads

Read these before reasoning:
- `.oma/packs/oh-my-pactgpb/templates/init/state-contract.json`
- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`
- `.oma/packs/oh-my-pactgpb/instructions/rules/*.md`

## Required writes

Persist exactly these shared init outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/init/init-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/init/init-summary.md`

## Procedure

1. Read `.oma/packs/oh-my-pactgpb/templates/init/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/packs/oh-my-pactgpb/capability-manifest.json` and confirm the installed `/pact-init` surface is present.
3. Read the shared data-handling policy and installed rule files before writing shared state.
4. Keep the worldview narrow: Java, Spring Boot providers, HTTP provider verification, provider-first, zero-Pact bootstrap only.
5. First detect whether meaningful Pact evidence already exists in the repo:
   - Pact dependencies
   - provider verification tests
   - pact files
   - broker-related config hints
   - `@Provider`
   - `@State`
6. If meaningful Pact evidence already exists, persist `existing-pact-evidence-detected`, record the evidence explicitly, do not bootstrap a second setup, and hand off to `/pact-scan`.
7. If the repo is zero-Pact, assess whether starting Pact provider verification is justified here at all. Use Spring controllers, request mappings, DTOs, integration-test prior art, OpenAPI when present, and external-boundary clues.
8. Choose a provider boundary only when repo evidence supports it. If multiple provider boundaries are plausible, persist the ambiguity as `insufficient-boundary-evidence` instead of guessing.
9. Distinguish weak/internal/admin-only HTTP seams from meaningful external contract surfaces. Persist `init-not-justified` when the repo does not show a strong enough reason to start Pact now.
10. Only for `init-completed`, write the narrowest safe bootstrap:
    - minimal Pact provider test dependency patching
    - a provider verification test harness derived from the shipped baseline
    - an optional neutral state-support shell when the repo evidence justifies it
    - persisted init state and derived summary
11. Never claim verification is already grounded or passing just because bootstrap files were written.
12. After `init-completed`, recommend the exact missing grounding step. Do not point directly to `/pact-scan` unless pact artifact source evidence already exists.

## Outcome taxonomy

Persist exactly one of these outcomes in init state:
- `init-completed`
- `init-not-justified`
- `insufficient-boundary-evidence`
- `existing-pact-evidence-detected`

## Stop without bootstrap when

Stop instead of scaffolding if:
- meaningful Pact evidence already exists
- no clear provider boundary can be chosen honestly
- the repo exposes no meaningful external HTTP contract surface
- a multi-provider repo stays ambiguous
- provider-state seams are too unclear for safe bootstrap
- the HTTP surface looks internal/admin-only and Pact would add weak value right now

When you stop, persist the blocker or justification in init-state instead of guessing.

## Evidence and redaction

- Ground findings in repo files, not chat memory.
- OpenAPI may strengthen the HTTP surface assessment, but OpenAPI alone is not enough to justify init.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values.

## Handoff

If init completes, tell the user the init state is persisted, summarize the selected provider boundary and scaffolded files, make the remaining grounding gaps explicit, and point to the next grounding step.
If init stops, say the persisted outcome plainly and explain why bootstrap was refused.