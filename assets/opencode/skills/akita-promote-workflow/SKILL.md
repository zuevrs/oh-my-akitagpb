---
name: akita-promote-workflow
description: Compatibility alias that redirects legacy /akita-promote usage to /akita-accept.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only as a compatibility bridge for the installed `/akita-promote` flow.

## Required reads

Read these before reasoning:
- `.oma/templates/promote/state-contract.json`
- `.oma/templates/accept/state-contract.json`

## Procedure

1. Read `.oma/templates/promote/state-contract.json` first and treat it as a legacy alias marker, not as canonical runtime truth.
2. Read `.oma/templates/accept/state-contract.json` and explain that `/akita-accept` now owns the final validation plus live-path copy.
3. If the user already supplied explicit artifact ids and explicit repo-relative destinations, tell them to rerun the same request with `/akita-accept`.
4. If the user did not supply explicit artifact ids and explicit repo-relative destinations, stop and tell them `/akita-accept` requires both.
5. Do not invent a separate promotion path here and do not write new legacy promote state.

## Stop with `needs-review` when

Stop instead of guessing if the user has not provided the explicit artifact ids and repo-relative destinations that `/akita-accept` requires.

## Evidence and redaction

- The canonical trust boundary now lives in `/akita-accept`.
- Do not persist secrets, credentials, tokens, raw auth headers, raw env values, or machine-local values while handling this alias.

## Handoff

- Tell the user the canonical command is `/akita-accept`.
