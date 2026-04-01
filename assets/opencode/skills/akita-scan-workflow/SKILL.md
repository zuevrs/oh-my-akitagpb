---
name: akita-scan-workflow
description: Persist repo-backed scan findings for the installed /akita-scan command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/akita-scan` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/scan/state-contract.json`
- `.oma/capability-manifest.json`
- `.oma/runtime/shared/data-handling-policy.json`
- `.oma/instructions/rules/*.md`
- every manifest-listed `activeCapabilityBundles[*].skillPath`
- every manifest-listed `references.*` file for those bundles

## Required writes

Persist exactly these shared scan outputs:
- `.oma/state/shared/scan/contracts.json`
- `.oma/state/shared/scan/target-candidates.json`
- `.oma/state/shared/scan/prior-art.json`
- `.oma/state/shared/scan/service-runtime-profile.json`
- `.oma/state/shared/scan/flow-candidates.json`
- `.oma/state/shared/scan/assertion-opportunities.json`
- optional derived summary: `.oma/state/shared/scan/scan-summary.md`

## Procedure

1. Read `.oma/templates/scan/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/capability-manifest.json` and resolve every manifest-listed capability bundle plus every manifest-listed `activeCapabilityBundles[*].skillPath` and `references.*` file from disk before reasoning.
3. Read the shared data-handling policy and the installed rule files before writing shared state.
4. Inspect the repo for contracts, target candidates, prior art, runtime profile, flow candidates, and assertion opportunities.
5. If OpenAPI exists, record that evidence in `.oma/state/shared/scan/contracts.json`.
6. If OpenAPI does not exist, persist `code-first fallback` in `.oma/state/shared/scan/contracts.json` and continue from repo/code evidence instead of crashing.
7. Persist the exact shared scan outputs listed above.
8. Keep machine state in JSON. Keep markdown summary output derived and secondary.

## Stop with `needs-review` when

Stop instead of guessing if:
- any manifest-listed bundle file is missing
- capability truth cannot be resolved from the manifest-listed bundle set
- the target repo requires behavior the active bundles explicitly mark unsupported
- target binding is ambiguous enough that scan cannot produce an honest candidate set

When you stop, say `needs-review`, name the exact missing or unsupported surface, and point to the path that caused the stop.

## Evidence and redaction

- Ground findings in repo files and manifest-listed bundle references, not chat memory.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared state.
- README or other prose may provide context, but not capability truth.

## Handoff

If scan succeeds, tell the user the scan state is persisted and the next command is `/akita-plan`.
If scan stops with `needs-review`, do not suggest `/akita-plan` until the blocker is resolved.
