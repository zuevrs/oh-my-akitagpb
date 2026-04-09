# oh-my-akitagpb

Native-first OpenCode bootstrap pack for Akita GPB workflows.

`oh-my-akitagpb` installs a managed pack-scoped runtime under
`.oma/packs/oh-my-akitagpb/` plus additive shared surfaces under `.opencode/`,
`AGENTS.md`, `opencode.json`, and `.gitignore`.

This package lives inside the umbrella repository at
`packages/oh-my-akitagpb`, but the published package name, CLI entrypoint, and
runtime behavior stay the same.

## Product worldview

The product worldview is system-behavior-first:

- scan discovers trigger surfaces, contract evidence, prior art, runtime shape,
  candidate flows, and assertion opportunities from repo evidence
- OpenAPI and AsyncAPI are first-class contract evidence sources when present,
  but not the center of all reasoning
- code-first contracts, DTOs, event schemas, tests, and feature files are normal
  evidence sources, not fallback accidents
- capability truth comes from manifest-listed bundles and their reviewed
  references, not from README prose

## What it ships

- CLI lifecycle commands: `install`, `update`, `doctor`
- OpenCode commands: `/akita-scan`, `/akita-plan`, `/akita-write`, `/akita-validate`, `/akita-promote`
- Curated capability bundles currently pinned in the manifest for:
  - `akita-gpb-core-module@c795936046e`
  - `akita-gpb-api-module@223b2561bbc`
  - `ccl-database-module@bb0d27eda3e`
  - `ccl-files-module@05e1cf4d5e7`
  - `akita-gpb-kafka-mq-module@ff56f175d8c`
  - `ccl-additional-steps-module@95eda279aa4`
- Pack-owned templates, rules, manifests, and runtime state scaffolding

The pack does not ship a fixed catalog of scenarios. `/akita-scan` and
`/akita-plan` are meant to derive candidate flows from repo evidence plus the
active capability bundle set.

## Requirements

- Node.js `>=20`
- An OpenCode-compatible target repository

## Install

```bash
npm install -D oh-my-akitagpb
npx oh-my-akitagpb install
```

After install, open the target repo in OpenCode and start with:

```text
/akita-scan
```

## Co-install support

Co-install with `oh-my-pactgpb` is supported.

Akita-owned runtime lives only under:

- `.oma/packs/oh-my-akitagpb/**`

Pact-owned runtime lives only under its sibling namespaced root:

- `.oma/packs/oh-my-pactgpb/**`

That means both packs can be installed into the same target repo in any order
without overwriting each other's runtime/state/template trees.

## CLI commands

### `install`

Bootstrap-only install. Materializes the managed Akita surface into the current
repository, records local install ownership in
`.oma/packs/oh-my-akitagpb/install-state.json`, and updates the pack-managed
shared surfaces safely.

### `update`

Explicit refresh path. Rewrites only Akita-owned artifacts recorded in the
Akita install-state ledger and refreshes shared managed surfaces additively.

### `doctor`

Diagnose-first command. Writes
`.oma/packs/oh-my-akitagpb/state/local/doctor/doctor-report.json`, evaluates
only Akita-owned runtime/state honestly, and does not treat sibling pack
presence as drift.

## Runtime surface

### Pack-owned runtime root

Akita owns only:

- `.oma/packs/oh-my-akitagpb/capability-manifest.json`
- `.oma/packs/oh-my-akitagpb/instructions/**`
- `.oma/packs/oh-my-akitagpb/templates/**`
- `.oma/packs/oh-my-akitagpb/runtime/**`
- `.oma/packs/oh-my-akitagpb/state/**`
- `.oma/packs/oh-my-akitagpb/generated/**`
- `.oma/packs/oh-my-akitagpb/install-state.json`

### Shared additive surfaces

These surfaces remain shared and additive across packs:

- `AGENTS.md`
- `opencode.json`
- `.gitignore`
- `.opencode/commands/akita-*.md`
- `.opencode/commands/pact-*.md`
- `.opencode/skills/akita-*/**`
- `.opencode/skills/pact-*/**`

Ownership is strict. Akita does not silently overwrite Pact-owned runtime,
user-owned `AGENTS.md`, unrelated `.opencode/*`, or user-owned `.gitignore`
rules outside its managed block.

## VCS policy for installed repos

After install, the pack-managed `.gitignore` block keeps this split explicit.

### Commit-worthy durable Akita surface

These files are meant to live in git and be shared across the team:

- `AGENTS.md`
- `opencode.json`
- `.opencode/commands/akita-*.md`
- `.opencode/skills/akita-*/**`
- `.oma/packs/oh-my-akitagpb/capability-manifest.json`
- `.oma/packs/oh-my-akitagpb/instructions/**`
- `.oma/packs/oh-my-akitagpb/templates/**`
- `.oma/packs/oh-my-akitagpb/runtime/shared/**`
- `.oma/packs/oh-my-akitagpb/state/shared/**`

This includes shared workflow state such as scan, plan, and write outputs.
Those files are the durable handoff surface between commands and between
teammates; they are not treated as local scratch state.

### Local-only Akita runtime surface

These files stay local and are ignored by the managed `.gitignore` block:

- `.oma/packs/oh-my-akitagpb/install-state.json`
- `.oma/packs/oh-my-akitagpb/runtime/local/**`
- `.oma/packs/oh-my-akitagpb/state/local/**`

The install-state ledger is intentionally local because it contains
machine-specific install bookkeeping such as the recorded project root and
install path. It is required for safe `update`, but it is not shareable repo
truth.

### Generated staging surface

These files are also ignored:

- `.oma/packs/oh-my-akitagpb/generated/features/**`
- `.oma/packs/oh-my-akitagpb/generated/payloads/**`
- `.oma/packs/oh-my-akitagpb/generated/fixtures/**`

`/akita-write` stages artifacts there on purpose. They are not final live repo
outputs. `/akita-promote` is the explicit publish step that copies accepted
artifacts into real repo paths chosen by the user.

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
npm run build --workspace oh-my-akitagpb
npm test --workspace oh-my-akitagpb
npm run smoke:pack-install --workspace oh-my-akitagpb
```

## Publishing

This repository includes:

- CI workflow: `.github/workflows/ci.yml`
- npm publish workflow: `.github/workflows/publish.yml`

The package metadata marks `packages/oh-my-akitagpb` as the package directory
inside the `zuevrs/oh-my-gpb` repository.

Trusted publishing setup on npmjs.com should point to:

- Repository: `zuevrs/oh-my-gpb`
- Workflow filename: `publish.yml`

Release flow:

1. Update `packages/oh-my-akitagpb/package.json` version.
2. Merge to `main`.
3. Tag the release as `vX.Y.Z`.
4. Push the tag.
5. GitHub Actions publishes the package from `packages/oh-my-akitagpb`.

## License

MIT
