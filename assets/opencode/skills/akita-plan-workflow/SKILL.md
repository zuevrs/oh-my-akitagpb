---
name: akita-plan-workflow
description: Turn persisted scan state into an honest shortlist review for the installed /akita-plan command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-plan` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/plan/state-contract.json`
- `.oma/capability-manifest.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/state/shared/scan/contracts.json`
- `.oma/state/shared/scan/target-candidates.json`
- `.oma/state/shared/scan/prior-art.json`
- `.oma/state/shared/scan/service-runtime-profile.json`
- `.oma/state/shared/scan/flow-candidates.json`
- `.oma/state/shared/scan/assertion-opportunities.json`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these shared plan outputs:
- `.oma/state/shared/plan/active-target.json`
- `.oma/state/shared/plan/current-plan.json`
- `.oma/state/shared/plan/flow-scorecards.json`
- `.oma/state/shared/plan/scenario-capability-matrix.json`
- `.oma/state/shared/plan/decision-log.json`
- `.oma/state/shared/plan/approval-state.json`
- `.oma/state/shared/plan/unresolved.json`
- optional approved snapshot: `.oma/state/shared/plan/approved-plan.json`
- optional derived summary: `.oma/state/shared/plan/plan-summary.md`

## Procedure

1. Read `.oma/templates/plan/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/capability-manifest.json`, then resolve every manifest-listed capability bundle plus every manifest-listed `activeCapabilityBundles[*].skillPath` and `references.*` file from disk.
3. Read the persisted scan state from disk, not from chat memory.
4. Select only high-value candidate flows grounded in scan evidence and active capability truth.
5. If three to seven viable flows exist, produce a reviewable shortlist in that range and keep overflow candidates in backlog state.
6. If fewer than three viable flows exist, do **not** pad the shortlist. Persist the honest candidate set, record the shortage in `.oma/state/shared/plan/unresolved.json`, set `.oma/state/shared/plan/approval-state.json` to a `needs-review` status, and stop with an explicit shortage verdict.
7. Persist the exact shared plan outputs listed above.
8. Present these review actions verbatim: `approve all`, `approve <ids>`, `reject <ids>`, `adjust <id>: <instruction>`, `change target`, `regenerate shortlist`.
9. Do not create `.oma/state/shared/plan/approved-plan.json` unless the user explicitly chooses `approve all` or `approve <ids>`.

## Stop with `needs-review` when

Stop instead of guessing if:
- any required scan-state file is missing
- any manifest-listed bundle file is missing
- target selection is unresolved
- the viable flow set is below the honest minimum for review
- the needed behavior is only partial or unsupported in a way that prevents an honest shortlist

When you stop, say `needs-review`, name the exact blocker, and record it in `.oma/state/shared/plan/unresolved.json`.

## Evidence and redaction

- Keep the plan grounded in persisted scan state plus manifest-listed bundle truth.
- Do not use README prose as capability evidence.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared plan state.

## Handoff

- If the shortlist is reviewable, stop in review mode and wait for explicit user action.
- If the user approves, the next command is `/akita-write`.
- If the shortlist is short or blocked, do not hand off to `/akita-write`; stop with the exact shortage or blocker instead.
