---
name: akita-promote-workflow
description: Explicitly accept generated Akita artifacts and copy them into live repo paths for the installed /akita-promote command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-promote` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/promote/state-contract.json`
- `.oma/templates/write/state-contract.json`
- `.oma/state/shared/write/write-report.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/instructions/rules/respect-pack-ownership.md`

## Required writes

Persist exactly these local promote outputs:
- `.oma/state/local/promote/promote-report.json`
- optional derived summary: `.oma/state/local/promote/promote-summary.md`

## Procedure

1. Read `.oma/templates/promote/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/state/shared/write/write-report.json` from disk before reasoning about any artifact id or source path.
3. Accept only artifacts that appear in the write report and whose emitted paths stay under the contract-defined generated namespace.
4. Require one explicit repo-relative live destination per accepted artifact. Accept actions only in the shape `promote <artifact-id> to <repo-relative-path>` or `accept <artifact-id> as <repo-relative-path>`.
5. Never guess a live destination from approved plan intent, filenames, or repo conventions.
6. Copy accepted artifacts from `.oma/generated/**` into the explicit live destination. Use copy instead of move, and do not delete the generated source file.
7. Never overwrite existing files. Never copy into `.oma/` or `.opencode/`. Never promote from a source path outside the generated namespace.
8. Persist `.oma/state/local/promote/promote-report.json` with explicit `verdict` `ok`, `partial`, or `blocked`; `requestedPromotions`; `promotedArtifacts`; and `findings`.

## Stop with `blocked` or `needs-review` when

Stop instead of guessing if:
- `.oma/state/shared/write/write-report.json` is missing
- a requested artifact id is not present in the write report
- a requested source file is missing on disk
- the source path is outside the contract-defined generated namespace
- the user did not provide an explicit repo-relative destination
- the destination points under `.oma/` or `.opencode/`
- the destination already exists

Use `blocked` for missing write state, missing source files, generated-namespace violations, pack-managed destination roots, or destination conflicts.
Use `needs-review` when the request is ambiguous, such as missing artifact ids or missing explicit destinations.

## Evidence and redaction

- Promotion truth comes from the write report plus the explicit user-chosen destination paths.
- Do not use approved-plan prose or inferred naming conventions as destination truth.
- Never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values in local promote state.

## Handoff

- If promotion succeeds or partially succeeds, tell the user which live repo paths were copied and keep the generated source paths for traceability.
- If promotion blocks, stop with the exact blocker and do not overclaim publication.
