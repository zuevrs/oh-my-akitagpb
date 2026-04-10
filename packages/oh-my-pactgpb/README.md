# oh-my-pactgpb

Native-first OpenCode bootstrap pack for **Pact provider verification** workflows.

`oh-my-pactgpb` installs a managed pack-scoped runtime under
`.oma/packs/oh-my-pactgpb/` plus additive shared surfaces under `.opencode/`,
`AGENTS.md`, `opencode.json`, and `.gitignore`.

This package lives inside the umbrella repository at
`packages/oh-my-pactgpb`, but the published package name, CLI entrypoint, and
runtime behavior stay the same.

## MVP scope right now

Slice 1 is intentionally narrow.

### What is implemented

- CLI lifecycle commands: `install`, `update`, `doctor`
- OpenCode command: `/pact-init`
- OpenCode command: `/pact-scan`
- OpenCode command: `/pact-plan`
- OpenCode command: `/pact-write`
- OpenCode command: `/pact-validate`
- OpenCode workflow skill: `.opencode/skills/pact-init-workflow/SKILL.md`
- OpenCode workflow skill: `.opencode/skills/pact-scan-workflow/SKILL.md`
- OpenCode workflow skill: `.opencode/skills/pact-plan-workflow/SKILL.md`
- OpenCode workflow skill: `.opencode/skills/pact-write-workflow/SKILL.md`
- OpenCode workflow skill: `.opencode/skills/pact-validate-workflow/SKILL.md`
- Pact init state contract and summary template under
  `.oma/packs/oh-my-pactgpb/templates/init/`
- Pact scan state contract and summary template under
  `.oma/packs/oh-my-pactgpb/templates/scan/`
- Pact plan state contract and summary template under
  `.oma/packs/oh-my-pactgpb/templates/plan/`
- Pact write state contract and summary template under
  `.oma/packs/oh-my-pactgpb/templates/write/`
- Pact validate state contract and summary template under
  `.oma/packs/oh-my-pactgpb/templates/validate/`
- Strict ownership/update safety for pack-owned runtime plus additive shared
  surfaces
- Package-local proof fixtures that verify grounded detection of:
  - Maven/Gradle Pact provider dependencies
  - provider verification tests
  - local pact files
  - broker-related config hints
  - provider state hooks
  - Spring HTTP controller surface
  - integration-test prior art

### What is intentionally not implemented yet

- consumer pact generation
- broker publish / can-i-deploy automation
- message pacts
- Kafka/Rabbit Pact flows
- multi-language provider support
- generic contract-testing platform abstractions

## Product worldview

The pack is **provider-first** and **repo-evidence-first**:

- it looks for evidence of Pact provider verification already present in the repo
- it treats Java/Spring HTTP providers as the MVP target
- it records when Pact is relevant, when it is irrelevant, and when blockers are
  real instead of inventing missing setup
- it allows small duplication instead of forcing a shared Akita/Pact core too early

## Requirements

- Node.js `>=20`
- An OpenCode-compatible target repository

## Install

```bash
npm install -D oh-my-pactgpb
npx oh-my-pactgpb install
```

After install, pick the entry that matches the repo state.

### Zero-Pact bootstrap entry

Use `/pact-init` when the repo does **not** already contain meaningful Pact
provider-verification evidence and you want to decide whether Pact should start
here at all.

```text
/pact-init
```

`/pact-init` is usually a one-time bootstrap step. If it completes, the result is
still only bootstrap-level proof: you must ground the pact artifact source before
entering the normal verification track.

### Verification track

Use the existing verification track when Pact already exists in the repo or is
already grounded by repo evidence:

```text
/pact-scan
```

Then turn persisted scan evidence into a provider-verification plan with:

```text
/pact-plan
```

Then materialize only the provider-verification scaffold the plan safely allows with:

```text
/pact-write
```

Then verify whether the recorded scan/plan/write outcome is actually ready, partial,
blocked, irrelevant, or inconsistent with:

```text
/pact-validate
```

## Co-install support

Co-install with `oh-my-akitagpb` is supported.

Pact-owned runtime lives only under:

- `.oma/packs/oh-my-pactgpb/**`

Akita-owned runtime lives under its sibling namespaced root:

- `.oma/packs/oh-my-akitagpb/**`

That means both packs can be installed into the same target repo in any order
without overwriting each other's runtime/state/template trees.

## CLI commands

### `install`

Bootstrap-only install. Materializes the managed Pact scan surface into the
current repository, records local install ownership in
`.oma/packs/oh-my-pactgpb/install-state.json`, and updates the pack-managed
shared surfaces safely.

### `update`

Explicit refresh path. Rewrites only Pact-owned artifacts recorded in the Pact
install-state ledger and refreshes shared managed surfaces additively.

### `doctor`

Diagnose-first command. Writes
`.oma/packs/oh-my-pactgpb/state/local/doctor/doctor-report.json`, evaluates
only Pact-owned runtime/state honestly, and does not treat sibling pack
presence as drift.

## Runtime surface

### Pack-owned runtime root

Pact owns only:

- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/instructions/**`
- `.oma/packs/oh-my-pactgpb/templates/**`
- `.oma/packs/oh-my-pactgpb/runtime/**`
- `.oma/packs/oh-my-pactgpb/state/**`
- `.oma/packs/oh-my-pactgpb/generated/**`
- `.oma/packs/oh-my-pactgpb/install-state.json`

### Shared additive surfaces

These surfaces remain shared and additive across packs:

- `AGENTS.md`
- `opencode.json`
- `.gitignore`
- `.opencode/commands/akita-*.md`
- `.opencode/commands/pact-*.md`
- `.opencode/skills/akita-*/**`
- `.opencode/skills/pact-*/**`

Ownership is strict. Pact does not silently overwrite Akita-owned runtime,
user-owned `AGENTS.md`, unrelated `.opencode/*`, or user-owned `.gitignore`
rules outside its managed block.

## VCS policy for installed repos

After install, the pack-managed `.gitignore` block keeps this split explicit.

### Commit-worthy durable Pact surface

These files are meant to live in git and be shared across the team:

- `AGENTS.md`
- `opencode.json`
- `.opencode/commands/pact-*.md`
- `.opencode/skills/pact-*/**`
- `.oma/packs/oh-my-pactgpb/capability-manifest.json`
- `.oma/packs/oh-my-pactgpb/instructions/**`
- `.oma/packs/oh-my-pactgpb/templates/**`
- `.oma/packs/oh-my-pactgpb/runtime/shared/**`
- `.oma/packs/oh-my-pactgpb/state/shared/**`

This includes durable init, scan, plan, and write state such as:

- `.oma/packs/oh-my-pactgpb/state/shared/init/init-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/init/init-summary.md`
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/scan/scan-summary.md`
- `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/plan/plan-summary.md`
- `.oma/packs/oh-my-pactgpb/state/shared/write/write-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/write/write-summary.md`
- `.oma/packs/oh-my-pactgpb/state/shared/validate/validate-state.json`
- `.oma/packs/oh-my-pactgpb/state/shared/validate/validate-summary.md`

### Local-only Pact runtime surface

These files stay local and are ignored by the managed `.gitignore` block:

- `.oma/packs/oh-my-pactgpb/install-state.json`
- `.oma/packs/oh-my-pactgpb/runtime/local/**`
- `.oma/packs/oh-my-pactgpb/state/local/**`

The install-state ledger is intentionally local because it contains
machine-specific install bookkeeping such as the recorded project root and
install path.

### Generated staging surface

These files are also ignored:

- `.oma/packs/oh-my-pactgpb/generated/**`

Slice 1 does not yet materialize any write/promote workflow that uses this
staging area, but the ignore policy keeps the local/generated split explicit.

## Development

From the package directory:

```bash
npm ci
npm run build
npm test
npm run smoke:pack-install
```

From the workspace root:

```bash
npm install
npm run build --workspace oh-my-pactgpb
npm test --workspace oh-my-pactgpb
npm run smoke:pack-install --workspace oh-my-pactgpb
```

## Publishing

Pact publishes independently from Akita.

This repository includes:

- CI workflow: `.github/workflows/ci.yml`
- Pact publish workflow: `.github/workflows/publish-pact.yml`

The package metadata marks `packages/oh-my-pactgpb` as the package directory
inside the `zuevrs/oh-my-gpb` repository.

### Release tag

Use Pact-only tags:

- `pact-vX.Y.Z`

`publish-pact.yml` reads `packages/oh-my-pactgpb/package.json`, derives the
expected tag from the package version, and fails if the pushed tag does not
exactly match that version.

### Trusted publishing setup

Trusted publishing on npmjs.com should point to:

- npm package: `oh-my-pactgpb`
- Repository: `zuevrs/oh-my-gpb`
- Workflow filename: `publish-pact.yml`
- Expected tag prefix: `pact-v`

This binding must be created manually before the first real Pact publish.

### Release flow

1. Update `packages/oh-my-pactgpb/package.json` version.
2. Merge to `main`.
3. Tag the release as `pact-vX.Y.Z`.
4. Push the tag.
5. GitHub Actions runs `publish-pact.yml`, executes Pact `release:check`, and
   publishes only from `packages/oh-my-pactgpb`.
6. If `oh-my-pactgpb@X.Y.Z` already exists on npm, the workflow skips
   `npm publish` and only handles the matching GitHub Release state.

## License

MIT
