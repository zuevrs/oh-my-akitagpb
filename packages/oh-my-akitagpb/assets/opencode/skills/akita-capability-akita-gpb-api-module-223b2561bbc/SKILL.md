---
name: akita-capability-akita-gpb-api-module-223b2561bbc
description: Capability-bound Phase 1 Akita api-module bundle for source-backed HTTP request, extraction, and schema-validation steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/packs/oh-my-akitagpb/capability-manifest.json` activates `akita-capability-akita-gpb-api-module-223b2561bbc`.

## Scope

- Exact maintainer-reviewed source pin: `223b2561bbc`
- Module id: `akita-gpb-api-module`
- Evidence base: `gpb-manifest.json` and `src/main/java/**/steps/ApiSteps.java`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Send generic HTTP requests and save the response object in an Akita scenario variable.
2. Send table-driven HTTP requests with reviewed request parameter types from the API module and either save the response or assert the status code.
3. Capture the first line of a GET(SSE) response into a scenario variable, with explicit streaming limits.
4. Save response cookies, headers, full bodies, or JsonPath-selected body values into scenario variables.
5. Assert JSON existence, absence, and value equality through JsonPath for stored JSON text, files, or response bodies.
6. Save JSON values selected by JsonPath into scenario variables.
7. Assert XML values and existence through XmlPath and save selected XML values into scenario variables.
8. Validate stored response payloads against reviewed JSON schema or XSD file inputs.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, hooks, enum names, documentation prose, or example payloads, treat it as `unsupported` or `needs-review`.
- Do not infer business-specific endpoints, authentication issuance flows, or domain response schemas from the generic HTTP helpers.
- Do not treat the SSE step as full stream processing; it captures only the first returned line.
