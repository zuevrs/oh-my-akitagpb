---
description: Compatibility alias that redirects legacy promote users to /akita-accept.
agent: build
subtask: false
---

Use the `akita-promote-workflow` skill from `.opencode/skills/akita-promote-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/promote/state-contract.json` and `.oma/templates/accept/state-contract.json`.
2. Treat `/akita-promote` as a deprecated compatibility alias.
3. Explain that `/akita-accept` now owns the final validation and live-path copy.
4. If the user already supplied explicit artifact ids and explicit repo-relative destinations, tell them to rerun the same request with `/akita-accept`.
5. If the user did not supply explicit artifact ids and explicit repo-relative destinations, stop and tell them `/akita-accept` requires both.

Do not create a separate promote report here. The canonical command is `/akita-accept`.
