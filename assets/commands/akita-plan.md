---
description: Turn persisted scan state into a shortlist review for high-value Akita flows.
agent: plan
subtask: false
---

Use the `akita-plan-workflow` skill from `.opencode/skills/akita-plan-workflow/SKILL.md`.

Before you start:
1. Read `.oma/templates/plan/state-contract.json` and treat it as the canonical plan persistence contract.
2. Read `.oma/capability-manifest.json`.
3. Resolve every manifest-listed `activeCapabilityBundles[*].skillPath` and every required `references.*` file before reasoning.
4. Read `.oma/runtime/shared/data-handling-policy.json` and keep shared state redaction-first.
5. Read the persisted scan prerequisites from disk under `.oma/state/shared/scan/`.
6. If scan state is missing, stop and send the user to `/akita-scan` instead of inventing context.

Required scan prerequisites:
- `.oma/state/shared/scan/scan-state.json`

Required shared plan outputs:
- `.oma/state/shared/plan/plan-state.json`
- optional approved snapshot: `.oma/state/shared/plan/approved-plan.json`
- optional derived summary: `.oma/state/shared/plan/plan-summary.md`

Then:
- produce a reviewable shortlist of 3-7 high-value candidate flows when that many viable flows actually exist
- preserve overflow candidates in backlog state instead of expanding the shortlist past seven items
- build the shortlist from persisted scan evidence: target candidates, flow candidates, assertion opportunities, runtime profile, prior art, and contract evidence
- weigh each shortlisted flow against active capability bundles and reviewed references from the manifest instead of assuming REST/OpenAPI primacy
- if fewer than 3 viable flows exist, do **not** pad the shortlist; persist the honest candidate set in `.oma/state/shared/plan/plan-state.json`, record the shortage there, set the embedded approval state to `needs-review`, and stop with an explicit shortage verdict
- keep shared JSON and markdown redaction-first per `.oma/runtime/shared/data-handling-policy.json`; never persist secrets, credentials, tokens, raw auth headers, or machine-local values
- keep the plan grounded in persisted repo evidence and shipped capability truth, not chat memory or README-only claims
- do not turn plan into a catalog of pre-approved scenario patterns; shortlist only the highest-value meaningful proofs the evidence actually supports
- list these discuss actions verbatim for review: `approve all`, `approve <ids>`, `reject <ids>`, `adjust <id>: <instruction>`, `change target`, `regenerate shortlist`
- do not create `.oma/state/shared/plan/approved-plan.json` until the user explicitly chooses `approve all` or `approve <ids>`
- if scan state is missing, a manifest-listed bundle file is missing, or the needed capability is explicitly unsupported, stop with `needs-review` guidance instead of guessing

If the shortlist is honestly reviewable, wait for explicit user action. If the shortlist is short or blocked, do not hand off to `/akita-write`.
