---
name: akita-validate-workflow
description: Validate generated Akita artifacts against the installed write state and active capability truth.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-validate` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/validate/state-contract.json`
- `.oma/templates/write/state-contract.json`
- `.oma/state/shared/write/write-report.json`
- `.oma/capability-manifest.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/instructions/rules/explicit-unsupported.md`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these local validate outputs:
- `.oma/state/local/validate/validation-report.json`
- optional derived summary: `.oma/state/local/validate/validate-summary.md`

## Procedure

1. Read `.oma/templates/validate/state-contract.json` first and treat it as the canonical persistence contract.
2. Read the write-state prerequisites from disk before validating any artifact.
3. Read the manifest-listed capability bundle surfaces and references from disk before evaluating support coverage. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before continuing.
4. Read the explicit-unsupported rule and the data-handling policy before writing local validation state.
5. Validate only the artifact set recorded in `.oma/state/shared/write/write-report.json`. Do not validate artifacts outside that bundle or invent missing coverage.
6. Compare that artifact set against the lineage and capability references recorded in `.oma/state/shared/write/write-report.json` and the active capability truth.
7. Persist `.oma/state/local/validate/validation-report.json` with explicit `verdict` `pass`, `fail`, or `blocked`; `reviewedArtifacts`; and `findings`.
8. Reject unsupported steps, unsupported assertions, and bundle-unknown constructs explicitly, and fail with a `lineage-drift` finding when provenance and artifact contents diverge, instead of silently passing partial coverage.

## Stop with `blocked` or `needs-review` when

Stop instead of guessing if:
- `.oma/state/shared/write/write-report.json` is missing
- any manifest-listed bundle file is missing
- the write-state artifact set is incomplete or cannot be reconciled to provenance

Use `blocked` for missing input state or missing capability bundle files. Record `missing-input-state` when write-state inputs are absent, and record `missing-capability-bundle-file` when a manifest-listed bundle file is absent.
Use `needs-review` only when the validation request itself is ambiguous and the contract does not provide an honest path forward.

## Evidence and redaction

- Validation truth comes from the generated artifact bundle plus manifest-listed bundle references.
- README or other prose may provide context, but not validation truth.
- Never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local credentials in local validation state.

## Handoff

- If validation passes, tell the user the generated artifact bundle is structurally/capability-valid, name the runtime verification command if one exists, and say the explicit publish step is `/akita-promote`.
- If validation fails or blocks, stop with the exact rejection reason and do not overclaim readiness.
