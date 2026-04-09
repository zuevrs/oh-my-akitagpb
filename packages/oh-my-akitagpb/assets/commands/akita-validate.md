---
description: Validate generated Akita artifacts against structural and capability rules.
agent: build
subtask: false
---

Use the `akita-validate-workflow` skill from `.opencode/skills/akita-validate-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-akitagpb/templates/validate/state-contract.json` and treat it as the canonical validate persistence contract.
2. Read `.oma/packs/oh-my-akitagpb/templates/write/state-contract.json` and `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` from disk before evaluating any artifact.
3. Read `.oma/packs/oh-my-akitagpb/capability-manifest.json`.
4. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before validating support coverage.
5. Read `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json` and `.oma/packs/oh-my-akitagpb/instructions/rules/explicit-unsupported.md`.
6. If the generated artifact bundle, provenance bundle, manifest-listed bundle truth, or required capability bundle file is missing, stop explicitly instead of guessing or downgrading the validation rules.

Required local validate outputs:
- `.oma/packs/oh-my-akitagpb/state/local/validate/validation-report.json`
- optional derived summary: `.oma/packs/oh-my-akitagpb/state/local/validate/validate-summary.md`

Then:
- validate only the reviewed artifact set recorded in `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` against manifest-listed bundle truth
- persist `.oma/packs/oh-my-akitagpb/state/local/validate/validation-report.json` with `verdict`, `reviewedArtifacts`, and `findings`; each finding must keep a clear per-artifact reason
- reject `unsupported-step`, `unsupported-assertion`, `bundle-unknown-construct`, and `lineage-drift` explicitly instead of silently passing partial coverage
- if the generated artifact set diverges from the lineage recorded in `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json`, fail validation with a clear `lineage-drift` finding instead of treating it as a warning
- if a manifest-listed capability bundle file or required write-state input is missing, stop with `blocked` guidance and record `missing-input-state` or `missing-capability-bundle-file` in `.oma/packs/oh-my-akitagpb/state/local/validate/validation-report.json`
- keep local JSON and markdown redaction-first per `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local credentials

If validation passes, report the validated artifact bundle, name the runtime proof command if one exists, and say the explicit publish step is `/akita-promote`. If validation fails or blocks, stop with the exact reason.
