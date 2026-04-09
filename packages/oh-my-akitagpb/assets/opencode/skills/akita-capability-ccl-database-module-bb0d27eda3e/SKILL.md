---
name: akita-capability-ccl-database-module-bb0d27eda3e
description: Capability-bound Phase 1 Akita ccl-database-module bundle for source-backed SQL query, result assertion, extraction, and update steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/capability-manifest.json` activates `akita-capability-ccl-database-module-bb0d27eda3e`.

## Scope

- Exact maintainer-reviewed source pin: `bb0d27eda3e`
- Module id: `ccl-database-module`
- Evidence base: `gpb-manifest.json` and `src/main/java/**/steps/CCLDataBaseSteps.java`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Execute SQL queries against a configured DB using scenario variables or table-provided parameters.
2. Save DB query results into scenario variables as row lists or JSON strings.
3. Assert empty query results or poll for a non-empty result with the reviewed timeout and polling behavior.
4. Assert DB result fields for a single row, ordered rows, or unordered rows.
5. Extract a column value from the first result row as text or object, or extract a column across rows into a formatted string.
6. Execute update/delete/insert-style SQL operations, with optional table-provided parameters.
7. Assert that update/delete/insert steps affected more than zero rows when using the reviewed check-response steps.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, config parsing, README prose, or internal methods, treat it as `unsupported` or `needs-review`.
- Do not infer vendor-neutral DB administration, schema discovery, migration, transaction, or bulk orchestration capabilities from this bundle.
- Do not treat the polling step as generic wait-until semantics; it is a reviewed 60-second, 1-second-interval wait for a non-empty query result only.
- Do not expand result extraction semantics beyond the reviewed first-row column extraction, reviewed text/object conversion, reviewed formatted string list generation, and reviewed JSON-string serialization.
