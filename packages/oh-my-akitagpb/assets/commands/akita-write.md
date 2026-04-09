---
description: Materialize only the approved, capability-supported Akita artifacts.
agent: build
subtask: false
---

Use the `akita-write-workflow` skill from `.opencode/skills/akita-write-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-akitagpb/templates/write/state-contract.json` and treat it as the canonical write persistence contract.
2. Read the installed template assets under `.oma/packs/oh-my-akitagpb/templates/feature/` and `.oma/packs/oh-my-akitagpb/templates/payload/` before generating artifacts.
   - `.oma/packs/oh-my-akitagpb/templates/feature/default.feature.md`
   - `.oma/packs/oh-my-akitagpb/templates/feature/with-background.feature.md`
   - `.oma/packs/oh-my-akitagpb/templates/feature/with-omissions-note.feature.md`
   - `.oma/packs/oh-my-akitagpb/templates/payload/json-body.md`
   - `.oma/packs/oh-my-akitagpb/templates/payload/property-file.md`
   - `.oma/packs/oh-my-akitagpb/templates/payload/minimal-fixture.md`
3. Read `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json` from disk before materializing any artifact intent.
4. Read `.oma/packs/oh-my-akitagpb/capability-manifest.json`.
5. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before selecting implementation steps.
6. Read `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json`, `.oma/packs/oh-my-akitagpb/instructions/rules/respect-pack-ownership.md`, and `.oma/packs/oh-my-akitagpb/instructions/rules/never-invent-steps.md`.
7. If the approved plan, scenario capability matrix, manifest-listed bundle truth, template surface, or ownership boundary is missing or unclear, stop instead of guessing.

Required shared write outputs:
- `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json`
- optional derived summary: `.oma/packs/oh-my-akitagpb/state/shared/write/write-summary.md`

Then:
- materialize only the supported subset grounded in `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json`, the installed feature/payload templates, and manifest-listed bundle truth
- update only the pack-managed write state files above and create new repo artifacts only inside the contract-defined generated namespace under `.oma/packs/oh-my-akitagpb/generated/`
- treat `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json` as artifact intent, not as final live target paths for new files
- do not overwrite non-pack-managed files; record ownership-uncertain or noncanonical targets in `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` instead
- if support is partial, still materialize the supported subset, keep unsupported outputs out of `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json`, and record omissions plus explicit reasons there
- persist `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` with inspectable lineage from approved artifact intent to each emitted repo-relative path in the generated namespace
- keep shared JSON and markdown redaction-first per `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values
- stop with `needs-review` guidance if a manifest-listed bundle file is missing, a needed step is unsupported, no installed template matches the needed artifact shape honestly, or an emitted path falls outside the contract-defined generated namespace or pack-managed locations

If write succeeds or partially succeeds, say the next command is `/akita-validate` and generated artifacts stay under `.oma/packs/oh-my-akitagpb/generated/**` until an explicit `/akita-promote` copies them into live repo paths.
