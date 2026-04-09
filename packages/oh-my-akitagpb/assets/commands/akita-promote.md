---
description: Explicitly accept generated Akita artifacts and copy them into live repo paths.
agent: build
subtask: false
---

Use the `akita-promote-workflow` skill from `.opencode/skills/akita-promote-workflow/SKILL.md`.

Before you start:
1. Read `.oma/packs/oh-my-akitagpb/templates/promote/state-contract.json` and treat it as the canonical promote persistence contract.
2. Read `.oma/packs/oh-my-akitagpb/templates/write/state-contract.json` and `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` from disk before promoting any artifact.
3. Read `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json` and `.oma/packs/oh-my-akitagpb/instructions/rules/respect-pack-ownership.md`.
4. If `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json` is missing, stop and send the user to `/akita-write` instead of guessing a source bundle.
5. If the user does not name explicit artifact ids and explicit repo-relative destinations, stop and ask for them instead of inventing live target paths.

Required local promote outputs:
- `.oma/packs/oh-my-akitagpb/state/local/promote/promote-report.json`
- optional derived summary: `.oma/packs/oh-my-akitagpb/state/local/promote/promote-summary.md`

Then:
- accept only generated artifacts that are explicitly listed in `.oma/packs/oh-my-akitagpb/state/shared/write/write-report.json`
- require one explicit repo-relative destination per accepted artifact, for example `promote <artifact-id> to <repo-relative-path>` or `accept <artifact-id> as <repo-relative-path>`
- copy accepted artifacts from `.oma/packs/oh-my-akitagpb/generated/**` into the explicit live destination; do not move or delete the generated source file
- never infer live target paths from `.oma/packs/oh-my-akitagpb/state/shared/plan/approved-plan.json`, filenames, or repo conventions; the user must choose the destination explicitly
- never overwrite existing files, never copy into `.oma/` or `.opencode/`, and never promote an artifact whose emitted path falls outside the contract-defined generated namespace
- persist `.oma/packs/oh-my-akitagpb/state/local/promote/promote-report.json` with `verdict`, `requestedPromotions`, `promotedArtifacts`, and `findings`, including the copied source path, destination path, and source hash for every accepted artifact
- keep local JSON and markdown redaction-first per `.oma/packs/oh-my-akitagpb/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values

If promotion succeeds or partially succeeds, report the copied live paths and keep the generated source paths for traceability. If promotion blocks, stop with the exact reason.
