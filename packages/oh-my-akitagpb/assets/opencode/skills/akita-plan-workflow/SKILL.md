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
- `.oma/packs/oh-my-akitagpb/templates/plan/state-contract.json`
- `.oma/packs/oh-my-akitagpb/capability-manifest.json`
- `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json`
- `.oma/packs/oh-my-akitagpb/state/shared/scan/scan-state.json`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these shared plan outputs:
- `.oma/packs/oh-my-akitagpb/state/shared/plan/plan-state.json`
- optional approved snapshot: `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json`
- optional derived summary: `.oma/packs/oh-my-akitagpb/state/shared/plan/plan-summary.md`

## Procedure

1. Read `.oma/packs/oh-my-akitagpb/templates/plan/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/packs/oh-my-akitagpb/capability-manifest.json`, then resolve every manifest-listed capability bundle plus every manifest-listed `activeCapabilityBundles[*].skillPath` and `references.*` file from disk.
3. Read the persisted scan state from disk, not from chat memory.
4. Select only high-value candidate flows grounded in persisted scan evidence: target candidates, flow candidates, assertion opportunities, runtime profile, prior art, and contract evidence.
5. Evaluate each candidate against active capability truth from the manifest-listed bundles and reviewed references. OpenAPI or AsyncAPI evidence may strengthen a candidate, but neither should be treated as the default center of planning.
6. If three to seven viable flows exist, produce a reviewable shortlist in that range and keep overflow candidates in backlog state.
7. If fewer than three viable flows exist, do **not** pad the shortlist. Persist the honest candidate set in `.oma/packs/oh-my-akitagpb/state/shared/plan/plan-state.json`, record the shortage there, set the embedded `approvalState` to `needs-review`, and stop with an explicit shortage verdict.
8. Persist the exact shared plan outputs listed above.
9. Present these review actions verbatim: `approve all`, `approve <ids>`, `reject <ids>`, `adjust <id>: <instruction>`, `change target`, `regenerate shortlist`.
10. Do not create `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json` unless the user explicitly chooses `approve all` or `approve <ids>`.
11. Keep the shortlist honest and evidence-derived. Do not turn planning into a catalog of pre-approved flow patterns.

## Stop with `needs-review` when

Stop instead of guessing if:
- any required scan-state file is missing
- any manifest-listed bundle file is missing
- target selection is unresolved
- the viable flow set is below the honest minimum for review
- the needed behavior is only partial or unsupported in a way that prevents an honest shortlist

When you stop, say `needs-review`, name the exact blocker, and record it in `.oma/packs/oh-my-akitagpb/state/shared/plan/plan-state.json`.

## Evidence and redaction

- Keep the plan grounded in persisted scan state plus manifest-listed bundle truth.
- Do not use README prose as capability evidence.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared plan state.

## Handoff

- If the shortlist is reviewable, stop in review mode and wait for explicit user action.
- If the user approves, the next command is `/akita-write`.
- If the shortlist is short or blocked, do not hand off to `/akita-write`; stop with the exact shortage or blocker instead.
