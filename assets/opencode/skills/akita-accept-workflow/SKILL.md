---
name: akita-accept-workflow
description: Validate selected generated Akita artifacts and copy accepted ones into live repo paths for the installed /akita-accept command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-accept` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/accept/state-contract.json`
- `.oma/templates/write/state-contract.json`
- `.oma/state/shared/write/write-report.json`
- `.oma/capability-manifest.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/instructions/rules/explicit-unsupported.md`
- `.oma/instructions/rules/respect-pack-ownership.md`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these local accept outputs:
- `.oma/state/local/accept/accept-report.json`
- optional derived summary: `.oma/state/local/accept/accept-summary.md`

## Procedure

1. Read `.oma/templates/accept/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/state/shared/write/write-report.json` from disk before reasoning about any artifact id, lineage, or source path.
3. Read the manifest-listed capability bundle surfaces and references from disk before evaluating support coverage. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before continuing.
4. Read the explicit-unsupported rule, the ownership rule, and the data-handling policy before writing local accept state.
5. Accept only artifacts that appear in the write report and whose emitted paths stay under the contract-defined generated namespace.
6. Require one explicit repo-relative live destination per accepted artifact in the shape `accept <artifact-id> as <repo-relative-path>`.
7. Validate the selected artifact set against the lineage recorded in `.oma/state/shared/write/write-report.json` and the active capability truth before copying anything into live repo paths.
8. Reject unsupported steps, unsupported assertions, bundle-unknown constructs, and lineage drift explicitly instead of silently passing partial coverage.
9. Copy accepted artifacts from `.oma/generated/**` into the explicit live destination only after the selected artifact passes the accept checks. Use copy instead of move, and do not delete the generated source file.
10. Never overwrite existing files. Never copy into `.oma/` or `.opencode/`. Never accept from a source path outside the generated namespace.
11. Persist `.oma/state/local/accept/accept-report.json` with explicit `verdict` `ok`, `partial`, or `blocked`; `requestedAccepts`; `acceptedArtifacts`; and `findings`.

## Stop with `blocked` or `needs-review` when

Stop instead of guessing if:
- `.oma/state/shared/write/write-report.json` is missing
- any manifest-listed bundle file is missing
- a requested artifact id is not present in the write report
- a requested source file is missing on disk
- the source path is outside the contract-defined generated namespace
- the user did not provide an explicit repo-relative destination
- the destination points under `.oma/` or `.opencode/`
- the destination already exists
- the selected artifact fails the capability or lineage checks

Use `blocked` for missing write state, missing source files, generated-namespace violations, pack-managed destination roots, destination conflicts, missing capability bundle files, unsupported constructs, or lineage drift.
Use `needs-review` when the request is ambiguous, such as missing artifact ids or missing explicit destinations.

## Evidence and redaction

- Accept truth comes from the write report, manifest-listed bundle references, and the explicit user-chosen destination paths.
- Do not use approved-plan prose or inferred naming conventions as destination truth.
- Never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values in local accept state.

## Handoff

- If accept succeeds or partially succeeds, tell the user which live repo paths were copied and keep the generated source paths for traceability.
- If accept blocks, stop with the exact blocker and do not overclaim publication.
