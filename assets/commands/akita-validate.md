---
description: Compatibility alias that redirects legacy validate users to /akita-accept.
agent: build
subtask: false
---

Use the `akita-validate-workflow` skill from `.opencode/skills/akita-validate-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/validate/state-contract.json` and `.oma/templates/accept/state-contract.json`.
2. Treat `/akita-validate` as a deprecated compatibility alias.
3. Explain that `/akita-accept` now performs the final capability/lineage check and live-path copy in one step.
4. If the user already supplied explicit artifact ids and explicit repo-relative destinations, tell them to rerun the same request with `/akita-accept`.
5. If the user did not supply explicit artifact ids and explicit repo-relative destinations, stop and tell them `/akita-accept` requires both.

Do not create a separate validation report or invent an audit-only path here. The canonical command is `/akita-accept`.
