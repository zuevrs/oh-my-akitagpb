---
name: pact-scan-workflow
description: Persist repo-backed Pact provider-verification scan findings for the installed /pact-scan command.
compatibility: opencode
metadata:
  audience: runtime
  phase: phase1
---

## Use this skill when

Use this skill only for the installed `/pact-scan` flow.

## Required reads

Read these before reasoning:
- `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json`
- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/runtime/shared/data-handling-policy.json`
- `.oma/packs/oh-my-pactgpb/instructions/rules/*.md`

## Required writes

Persist exactly these shared scan outputs:
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json`
- optional derived summary: `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-summary.md`

## Procedure

1. Read `.oma/packs/oh-my-pactgpb/templates/scan/state-contract.json` first and treat it as the canonical persistence contract.
2. Read `.oma/packs/oh-my-pactgpb/capability-manifest.json` and confirm which command and workflow surface is installed.
3. Read the shared data-handling policy and installed rule files before writing shared state.
4. Inspect the repository as a possible Pact **provider verification** target. Keep the worldview narrow: Java, Spring Boot, HTTP provider verification, broker-optional, provider-first.
5. Build a machine-readable evidence map in `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json` that answers at least:
   - which provider under contract is most likely
   - why Pact provider verification is relevant or irrelevant here
   - which Pact dependencies, tests, local pact files, broker hints, provider state hooks, Spring HTTP surfaces, DTOs, and prior-art tests were found
   - where Pact artifacts are expected from: local files, broker-related config, or unclear
   - which blockers/gaps prevent reliable verification today
6. Prefer repo evidence over README prose. Scan build files, test files, Spring controllers, request mappings, properties/yaml/env hints, pact directories, and existing verification annotations before concluding anything.
7. If the repo contains ordinary HTTP integration tests but no Pact-specific evidence, record them as prior art only; do not mislabel them as Pact verification.
8. If provider identity or artifact source is ambiguous, persist the ambiguity and explain the competing evidence instead of choosing a fake answer.
9. Keep machine state in JSON. Keep markdown summary derived and secondary.
10. Persist the exact shared outputs listed above.

## Stop with `needs-review` when

Stop instead of guessing if:
- the installed scan contract is missing or malformed
- the repo clearly requires non-HTTP or non-Java provider verification beyond this pack's MVP boundary
- the evidence is too contradictory to identify even a tentative provider candidate set

When you stop, say `needs-review`, name the exact blocker, and point to the file/path that caused it when possible.

## Evidence and redaction

- Ground findings in repo files, not chat memory.
- README or prose may provide context, but not truth.
- Never persist secrets, credentials, tokens, raw auth headers, or machine-local values in shared state.

## Handoff

If scan succeeds, tell the user the scan state is persisted and summarize the strongest evidence plus the main blockers.
If scan stops with `needs-review`, do not suggest unsupported downstream commands.
