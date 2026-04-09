---
name: pact-write-workflow
description: Materialize only plan-obedient Pact provider verification scaffolding for the installed /pact-write command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase3
---

## Use this skill when

Use this skill only for the installed `/pact-write` flow.

## Required reads

Read these before reasoning:
- `.oma/packs/oh-my-pactgpb/templates/write/state-contract.json`
- `.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json`
- `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json`
- `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json`
- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`
- `.oma/packs/oh-my-pactgpb/instructions/rules/*.md`

## Required writes

Persist exactly these shared write outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/write/write-summary.md`

## Procedure

1. Read `.oma/packs/oh-my-pactgpb/templates/write/state-contract.json` first and treat it as the canonical persistence contract.
2. Read the persisted plan and scan state from disk, not from chat memory.
3. Keep the worldview narrow: Java, Spring Boot providers, HTTP Pact provider verification, provider-first, broker-optional, consumer-generation-free.
4. Use the plan verdict as the binding write budget:
   - `ready-to-scaffold`: write the minimal provider verification scaffold or patch the existing setup.
   - `needs-provider-state-work`: write only safe partial scaffold/remediation and keep provider-state gaps explicit.
   - `needs-artifact-source-clarification`: write only safe partial scaffold that does not pretend artifact retrieval is solved.
   - `blocked`: do not write misleading provider verification artifacts.
   - `irrelevant`: do not write Pact provider verification artifacts.
5. Prefer extending existing provider verification files over generating a second parallel suite.
6. Keep repo writes narrow and attributable. Only touch the provider verification test, provider-state support, and minimal build/config surfaces when the persisted evidence makes that safe.
7. Persist a machine-readable write state that distinguishes files planned, files written, files modified, writes intentionally skipped, unresolved blockers, manual follow-ups, and the next expected verification command.
8. Keep the write state explicit about partial success versus honest no-write outcomes.
9. Persist the exact shared outputs listed above.
10. Keep shared JSON and markdown redaction-first. Never persist secrets, credentials, tokens, raw auth headers, or machine-local values.

## Stop with `blocked` or `irrelevant` when

Stop instead of guessing if:
- `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json` is missing
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json` is missing
- provider selection is blocked in persisted plan state
- the persisted plan verdict is `blocked` or `irrelevant`
- the safe target file cannot be identified without inventing a new architecture

When you stop, persist the blocker in `.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json` instead of inventing setup.

## Evidence and redaction

- Ground write decisions in persisted scan and plan state first, then in the current repo files.
- Do not rescan or re-plan implicitly inside write.
- Do not treat README prose as proof that verification is runnable.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared write state.

## Handoff

If write succeeds or partially succeeds, tell the user the write state is persisted and summarize what was written, what was skipped, and the next verification step.
If write blocks or is irrelevant, say that plainly and do not hand off as if runnable verification now exists.
