---
name: akita-capability-ccl-additional-steps-module-95eda279aa4
description: Capability-bound Phase 1 Akita ccl-additional-steps-module bundle for source-backed utility, assertion, byte-array, multipart, array, and bounded polling steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/packs/oh-my-akitagpb/capability-manifest.json` activates `akita-capability-ccl-additional-steps-module-95eda279aa4`.

## Scope

- Exact maintainer-reviewed source pin: `95eda279aa4`
- Module id: `ccl-additional-steps-module`
- Evidence base: `gpb-manifest.json` and reviewed public annotated step classes under `src/main/java/**/ccl/additional/steps/**`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Store literal values, generated values, regex matches, expression results, and selected string/date/number outputs in scenario variables.
2. Append processed string values to a scenario list and compare reviewed array variables as string, number, or date collections.
3. Calculate reviewed date transformations and assert reviewed date or string conditions from table-driven inputs.
4. Format numbers, spell out numbers or amounts, decode Base64 text to bytes, and extract a response body as bytes.
5. Sleep for a fixed number of seconds resolved from a literal or scenario value.
6. Build one reviewed multipart request body as a byte array plus generated boundary from a file/text parts table.
7. Repeat one reviewed HTTP request until a JsonPath-extracted value equals the expected JSON-stringified value under the built-in polling limits.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, dependency modules, config assumptions, README prose, or internal methods, treat it as `unsupported` or `needs-review`.
- Do not infer a generic scripting language, workflow engine, orchestration DSL, or broad utility framework from this module.
- Wait and polling behavior are narrow: one step is a fixed sleep, and the request-loop step is a fixed-timeout/fixed-interval equality check over one JsonPath result.
- Multipart support is limited to the reviewed byte-array body assembly flow; it is not a universal request-construction platform.
- Expression, date, string-assertion, and generated-value behavior are limited to the reviewed step families and their helper-backed semantics.
- README breadth does not expand runtime truth. If the contract does not list a reviewed step family, do not assume the bundle supports it.
