---
description: Validate selected generated Akita artifacts and copy accepted ones into live repo paths.
agent: build
subtask: false
---

Use the `akita-accept-workflow` skill from `.opencode/skills/akita-accept-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/accept/state-contract.json` and treat it as the canonical accept persistence contract.
2. Read `.oma/templates/write/state-contract.json` and `.oma/state/shared/write/write-report.json` from disk before evaluating any artifact.
3. Read `.oma/capability-manifest.json`.
4. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before validating support coverage.
5. Read `.oma/runtime/shared/data-handling-policy.json`, `.oma/instructions/rules/explicit-unsupported.md`, and `.oma/instructions/rules/respect-pack-ownership.md`.
6. If `.oma/state/shared/write/write-report.json` is missing, stop and send the user to `/akita-write` instead of guessing a source bundle.
7. If the user does not name explicit artifact ids and explicit repo-relative destinations, stop and ask for them instead of inventing live target paths.

Required local accept outputs:
- `.oma/state/local/accept/accept-report.json`
- optional derived summary: `.oma/state/local/accept/accept-summary.md`

Then:
- accept only generated artifacts that are explicitly listed in `.oma/state/shared/write/write-report.json`
- require one explicit repo-relative destination per accepted artifact in the shape `accept <artifact-id> as <repo-relative-path>`
- validate the selected artifact set against manifest-listed capability truth and the lineage recorded in `.oma/state/shared/write/write-report.json` before copying anything
- reject `unsupported-step`, `unsupported-assertion`, `bundle-unknown-construct`, and `lineage-drift` explicitly instead of silently passing partial coverage
- never infer live target paths from `.oma/state/shared/plan/approved-plan.json`, filenames, or repo conventions; the user must choose the destination explicitly
- copy accepted artifacts from `.oma/generated/**` into the explicit live destination only after the selected artifact passes the accept checks; do not move or delete the generated source file
- never overwrite existing files, never copy into `.oma/` or `.opencode/`, and never accept an artifact whose emitted path falls outside the contract-defined generated namespace
- persist `.oma/state/local/accept/accept-report.json` with `verdict`, `requestedAccepts`, `acceptedArtifacts`, and `findings`, including the copied source path, destination path, source hash, and validation verdict for every accepted artifact
- keep local JSON and markdown redaction-first per `.oma/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values

If accept succeeds or partially succeeds, report the copied live paths and keep the generated source paths for traceability. If accept blocks, stop with the exact reason.
