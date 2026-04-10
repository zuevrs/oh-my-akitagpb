---
name: pact-validate-workflow
description: Verify persisted Pact scan/plan/write outcomes against current repo reality for the installed /pact-validate command, then report whether the current coverage slice is enough for now or another coverage cycle is still required.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase4
---

## Use this skill when

Use this skill only for the installed `/pact-validate` flow.

## Required reads

Read these before reasoning:
- `.oma/packs/oh-my-pactgpb/templates/validate/state-contract.json`
- `.oma/packs/oh-my-pactgpb/templates/write/state-contract.json`
- `.oma/packs/oh-my-pactgpb/templates/plan/state-contract.json`
- `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json`
- `.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json`
- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`
- `.oma/packs/oh-my-pactgpb/instructions/rules/*.md`

## Required writes

Persist exactly these shared validate outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/validate/validate-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/validate/validate-summary.md`

## Procedure

1. Read `.oma/packs/oh-my-pactgpb/templates/validate/state-contract.json` first and treat it as the canonical persistence contract.
2. Read the persisted write, plan, and scan state from disk, not from chat memory.
3. Keep the worldview narrow: Java, Spring Boot providers, HTTP Pact provider verification, provider-first, broker-optional, read/verify/report-first.
4. Build a machine-readable validate state that answers at least:
   - which persisted scan/plan/write verdicts were validated
   - which coverage slice was just validated
   - whether the prior verdict chain is internally consistent
   - whether files claimed in write-state still exist and still contain the expected provider-verification scaffold substance
   - whether structural/compile proof succeeded, failed, or stayed blocked
   - whether runnable Pact verification is actually proven, merely ready, blocked, or still unproven
   - what remaining endpoint, interaction, and provider-state gaps are still open after this slice
   - whether the current iteration is enough for now or another coverage cycle is still required
   - which blockers and manual follow-ups remain
5. Respect the prior persisted verdict chain instead of inventing a new one:
   - `irrelevant` stays an honest no-op
   - `blocked` stays blocked
   - `partial` stays partial unless repo drift turns it inconsistent
   - a validated slice is not the same as full provider completion
   - bootstrap-only scaffolding is not a positive provider-verification stop point
   - never promote unresolved artifact/provider-state gaps into a fake success
6. Do not rescan the repo and do not re-plan implicitly inside validate.
7. Do not silently repair repo files inside validate. Report drift and inconsistency instead.
8. Keep shared JSON and markdown redaction-first. Never persist secrets, credentials, tokens, raw auth headers, or machine-local values.
9. Persist the exact shared outputs listed above.

## Stop with `blocked` or `inconsistent` when

Stop instead of guessing if:
- required persisted scan/plan/write inputs are missing
- the validate contract is missing or malformed
- the persisted verdict chain is incompatible
- files claimed as written are now missing or clearly drifted from the recorded scaffold
- runnable verification cannot be proven and the remaining blockers still materially prevent a ready claim

When you stop, persist the blocker or inconsistency in `.oma/packs/oh-my-pactgpb/state/shared/validate/validate-state.json` instead of pretending the repo is ready.

## Evidence and redaction

- Ground validate in persisted scan/plan/write state first, then in the current repo files.
- Prefer explicit evidence over optimistic heuristics.
- Do not treat README prose as proof that provider verification is runnable.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared validate state.

## Handoff

If validation succeeds, tell the user the validate state is persisted and summarize the validation outcome, repo reality result, compile/structural proof result, and runnable verification status.
If validation reports partial, blocked, irrelevant, or inconsistent, say that plainly and name the remaining blockers or drift.
