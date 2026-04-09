---
name: akita-write-workflow
description: Materialize only approved, capability-supported Akita artifacts for the installed /akita-write command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-write` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/write/state-contract.json`
- `.oma/templates/feature/README.md`
- `.oma/templates/feature/default.feature.md`
- `.oma/templates/feature/with-background.feature.md`
- `.oma/templates/feature/with-omissions-note.feature.md`
- `.oma/templates/payload/README.md`
- `.oma/templates/payload/json-body.md`
- `.oma/templates/payload/property-file.md`
- `.oma/templates/payload/minimal-fixture.md`
- `.oma/state/shared/plan/approved-plan.json`
- `.oma/capability-manifest.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/instructions/rules/respect-pack-ownership.md`
- `.oma/instructions/rules/never-invent-steps.md`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these shared write outputs:
- `.oma/state/shared/write/write-report.json`
- optional derived summary: `.oma/state/shared/write/write-summary.md`

## Procedure

1. Read `.oma/templates/write/state-contract.json` first and treat it as the canonical persistence contract.
2. Read the approved plan snapshot from disk before materializing any artifact intent.
3. Read the installed feature and payload template assets from disk before generating artifacts.
4. Read the manifest-listed capability bundle surfaces and references before selecting any steps. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file from disk before continuing.
5. Read the data-handling policy plus the ownership and never-invent rules before writing state or repo artifacts.
6. Materialize only the supported subset grounded in the approved plan, the capability matrix, the active bundle truth, and the installed feature/payload templates.
7. Use `.oma/templates/write/state-contract.json` as the only source of truth for allowed generated output paths under `.oma/generated/`.
8. Persist the exact shared write outputs listed above.
9. Keep `.oma/state/shared/write/write-report.json` explicit about both the approved artifact intent and the emitted repo-relative path for each generated file.
10. Keep `.oma/state/shared/write/write-report.json` explicit with verdict `ok`, `partial`, or `blocked`, plus generated artifact references, omissions, ownership blocks, stop conditions, and capability bundle references.
11. If support is partial, omit unsupported outputs from the generated artifact list in `.oma/state/shared/write/write-report.json` and record the omissions plus reasons there.
12. Treat `.oma/state/shared/plan/approved-plan.json` as approved artifact intent, not as final live target paths for new files.
13. If the emitted path is ownership-uncertain or falls outside the contract-defined generated namespace, block the write and record the refusal in `.oma/state/shared/write/write-report.json` instead of overwriting or publishing outside pack-managed locations.

## Stop with `needs-review` when

Stop instead of guessing if:
- `.oma/state/shared/plan/approved-plan.json` is missing
- any manifest-listed bundle file is missing
- the needed step or assertion is unsupported
- no installed template matches the approved artifact shape honestly
- the emitted path falls outside the contract-defined generated namespace or pack-managed locations

When you stop, say `needs-review`, name the exact missing or blocked surface, and record the stop condition in `.oma/state/shared/write/write-report.json` instead of inventing steps or provenance.

## Evidence and redaction

- Provenance must point back to the approved plan snapshot, the active capability bundle ids/module pins, and the generated artifact set, including each emitted repo-relative path.
- README or other prose may provide context, but not capability truth.
- Never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values in shared write state.

## Handoff

- If write succeeds or partially succeeds, tell the user which artifacts were materialized, the next command is `/akita-validate`, and generated files remain under `.oma/generated/**` until an explicit `/akita-promote`.
- If write blocks, do not hand off to `/akita-validate` until the blocker is resolved.
