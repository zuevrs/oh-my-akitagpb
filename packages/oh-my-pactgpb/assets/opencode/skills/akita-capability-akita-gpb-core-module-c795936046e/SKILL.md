---
name: akita-capability-akita-gpb-core-module-c795936046e
description: Capability-bound Phase 1 Akita core-module bundle for source-backed scenario-variable and property-file steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/capability-manifest.json` activates `akita-capability-akita-gpb-core-module-c795936046e`.

## Scope

- Exact maintainer-reviewed source pin: `c795936046e`
- Module id: `akita-gpb-core-module`
- Evidence base: `gpb-manifest.json` and `src/main/java/**/steps/CommonSteps.java`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Store property or literal values in Akita scenario variables.
2. Wait for a fixed number of seconds.
3. Fill a text template from a Cucumber data table and store the result in a variable.
4. Compare scenario variables for equality or inequality.
5. Delete a named file from a directory.
6. Assert that a PDF-backed file variable contains text.
7. Compare a scenario variable with a property value.
8. Evaluate a boolean expression through the scenario evaluator.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, hooks, documentation prose, or cross-module mentions, treat it as `unsupported` or `needs-review`.
- Do not infer generic file assertions from the PDF-specific implementation.
- Do not infer UI, API, database, or plugin capabilities from this core bundle alone.
