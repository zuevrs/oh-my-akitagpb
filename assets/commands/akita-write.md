---
description: Materialize only the approved, capability-supported Akita artifacts.
agent: build
subtask: false
---

Use the `akita-write-workflow` skill from `.opencode/skills/akita-write-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/write/state-contract.json` and treat it as the canonical write persistence contract.
2. Read the installed template assets under `.oma/templates/feature/` and `.oma/templates/payload/` before generating artifacts.
   - `.oma/templates/feature/default.feature.md`
   - `.oma/templates/feature/with-background.feature.md`
   - `.oma/templates/feature/with-omissions-note.feature.md`
   - `.oma/templates/payload/json-body.md`
   - `.oma/templates/payload/property-file.md`
   - `.oma/templates/payload/minimal-fixture.md`
3. Read `.oma/state/shared/plan/approved-plan.json` and `.oma/state/shared/plan/scenario-capability-matrix.json` from disk before choosing any output paths.
4. Read `.oma/capability-manifest.json`.
5. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before selecting implementation steps.
6. Read `.oma/runtime/shared/data-handling-policy.json`, `.oma/instructions/rules/respect-pack-ownership.md`, and `.oma/instructions/rules/never-invent-steps.md`.
7. If the approved plan, scenario capability matrix, manifest-listed bundle truth, template surface, or ownership boundary is missing or unclear, stop instead of guessing.

Required shared write outputs:
- `.oma/state/shared/write/generated-artifacts.json`
- `.oma/state/shared/write/provenance-bundle.json`
- `.oma/state/shared/write/generation-report.json`
- optional derived summary: `.oma/state/shared/write/write-summary.md`

Then:
- materialize only the supported subset grounded in `.oma/state/shared/plan/approved-plan.json`, `.oma/state/shared/plan/scenario-capability-matrix.json`, the installed feature/payload templates, and manifest-listed bundle truth
- create new repo artifacts only at canonical approved-plan target paths and update only the pack-managed write state files above
- do not overwrite non-pack-managed files; record ownership-uncertain or noncanonical targets in `.oma/state/shared/write/generation-report.json` instead
- if support is partial, still materialize the supported subset, keep unsupported outputs out of `.oma/state/shared/write/generated-artifacts.json`, and record omissions plus explicit reasons in `.oma/state/shared/write/generation-report.json`
- persist `.oma/state/shared/write/provenance-bundle.json` with inspectable lineage back to the approved plan snapshot, the manifest-listed bundle ids/module pins, and the generated artifact set
- keep shared JSON and markdown redaction-first per `.oma/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values
- stop with `needs-review` guidance if a manifest-listed bundle file is missing, a needed step is unsupported, no installed template matches the needed artifact shape honestly, or a target path falls outside canonical new or pack-managed locations

If write succeeds or partially succeeds, say the next command is `/akita-validate`.
