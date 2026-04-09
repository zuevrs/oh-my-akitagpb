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
- `.oma/state/shared/scan/scan-state.json`
- optional derived summary: `.oma/state/shared/scan/scan-summary.md`

## Procedure

1. Read `.oma/templates/scan/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/capability-manifest.json` and resolve every manifest-listed capability bundle plus every manifest-listed `activeCapabilityBundles[*].skillPath` and `references.*` file from disk before reasoning.
3. Read the shared data-handling policy and the installed rule files before writing shared state.
4. Inspect the repo as a system under test. Discover repo-backed trigger surfaces, contract evidence, prior art, runtime profile, flow candidates, and assertion opportunities.
5. Build a machine-readable evidence map in `.oma/state/shared/scan/scan-state.json` that lets later planning reason honestly about what the system can trigger, what evidence exists, and what side effects can be asserted.
6. Treat OpenAPI and AsyncAPI as first-class contract evidence when present. Also record code-first contracts, DTO or event schemas, feature files, tests, and other repo-backed contract evidence when those are the honest sources.
7. Do not treat missing OpenAPI or missing AsyncAPI as a special failure mode. When they are absent, continue from repo and code evidence and record the actual contract evidence that exists.
8. Record target candidates, flow candidates, and assertion opportunities as conclusions drawn from repo evidence plus manifest-listed capability truth. Do not invent a catalog of allowed flow patterns.
9. Capture side-effect and evidence surfaces wherever the repo exposes them: DB state, broker traffic, files, documents, exports, response payloads, async state transitions, and similar observable effects.
10. Persist the exact shared scan outputs listed above.
11. Keep machine state in JSON. Keep markdown summary output derived and secondary.

## Stop with `needs-review` when

Stop instead of guessing if:
- any manifest-listed bundle file is missing
- capability truth cannot be resolved from the manifest-listed bundle set
- the target repo requires behavior the active bundles explicitly mark unsupported
- target binding is ambiguous enough that scan cannot produce an honest candidate set

When you stop, say `needs-review`, name the exact missing or unsupported surface, and point to the path that caused the stop.

## Evidence and redaction

- Ground findings in repo files and manifest-listed bundle references, not chat memory.
- README or other prose may provide context, but not capability truth.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared state.

## Handoff

If scan succeeds, tell the user the scan state is persisted and the next command is `/akita-plan`.
If scan stops with `needs-review`, do not suggest `/akita-plan` until the blocker is resolved.
