---
name: akita-capability-ccl-files-module-05e1cf4d5e7
description: Capability-bound Phase 1 Akita ccl-files-module bundle for source-backed file, archive, document, spreadsheet, html, image, json, pdf, and xml steps.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this bundle only when `.oma/packs/oh-my-akitagpb/capability-manifest.json` activates `akita-capability-ccl-files-module-05e1cf4d5e7`.

## Scope

- Exact maintainer-reviewed source pin: `05e1cf4d5e7`
- Module id: `ccl-files-module`
- Evidence base: `gpb-manifest.json` and reviewed public annotated step classes under `src/main/java/**/steps/**`
- Contract rule: only public Cucumber step annotations count as shipped capability truth

## Supported capability areas

1. Load file content or file objects into scenario variables, create random files, derive file names, reconstruct a file from byte content, and unpack ZIP archives into reviewed file-list flows.
2. Check reviewed download-directory outcomes, optionally preserve the downloaded file as a scenario file or copy it to an explicit path.
3. Apply table-driven placeholder substitution to a DOCX template, compare DOCX text content, and save DOCX text content into a scenario variable.
4. Check Excel sheet presence, extract cells or matched rows, assert reviewed cell/range conditions, convert reviewed workbook content to JSON text, and check one cell fill color.
5. Extract one HTML element by XPath from an HTML string, then save its own text or one attribute value.
6. Load an image from disk into a scenario variable and compare two stored images with the reviewed diff semantics.
7. Read, assert, compare, transform, and extract JSON values through the reviewed JsonPath/GPath step families only.
8. Assert PDF text or text-slice presence, convert a PDF to an image, and assert reviewed table families by anchor text, by table index, or by page-specific table index.
9. Extract XML tag values, attribute values, node lists, attribute-filtered nodes, xmlpath arrays, and escaped XML text through the reviewed XML step families.

## Required references

- `references/capability-contract.json`
- `references/unsupported-cases.json`
- `references/examples.json`
- `references/provenance.json`

## Operating rules

- Treat only the supported operations in `capability-contract.json` as available.
- If a needed behavior appears only in helpers, parsers, converters, config classes, README prose, examples, or internal methods, treat it as `unsupported` or `needs-review`.
- Do not infer generic browser automation, attachment pipelines, filesystem orchestration, office-suite editing, document authoring, schema validation, or universal file-format support from this bundle.
- File-format semantics are limited to the reviewed annotated step families. `pdf`, `json`, `xml`, `html`, `docx`, `xlsx`, and image handling are not generic platforms here.
- Be especially conservative around steps that sound broad but have narrow source-backed behavior: reviewed download-directory checks, byte-array-to-file reconstruction, DOCX text equality, Excel JSON conversion, JSON path extraction/comparison, PDF table extraction, and XML tag/node extraction.
- README breadth does not expand runtime truth. If the contract does not list a specific reviewed step family, do not assume the bundle supports it.
