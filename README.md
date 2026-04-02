# oh-my-akitagpb

Native-first OpenCode bootstrap pack for Akita GPB workflows.

`oh-my-akitagpb` installs a managed `.oma/` and `.opencode/` surface into a Java
service repository so an OpenCode agent can scan the repo, plan high-value
integration flows, write Akita-grounded artifacts into a safe generated
namespace, and explicitly accept selected artifacts into live repo paths.

## What it ships

- CLI lifecycle commands: `install`, `update`, `doctor`
- Primary OpenCode commands: `/akita-scan`, `/akita-plan`, `/akita-write`, `/akita-accept`
- Compatibility aliases during the transition: `/akita-validate`, `/akita-promote`
- Curated capability bundles for:
  - `akita-gpb-core-module-trunk@c795936046e`
  - `akita-gpb-api-module-trunk@223b2561bbc`
- Pack-owned templates, rules, manifests, and runtime state scaffolding

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

Primary daily flow:

```text
/akita-scan -> /akita-plan -> /akita-write -> /akita-accept
```

## CLI commands

### `install`

Bootstrap-only install. Materializes the managed pack surface into the current
repository and records ownership in `.oma/install-state.json`.

### `update`

Explicit refresh path. Rewrites only pack-owned artifacts recorded in
`install-state`.

### `doctor`

Diagnose-first command. Writes `.oma/state/local/doctor/doctor-report.json` and
returns one safe next step.

## Runtime surface

The package materializes these top-level surfaces in a target repository:

- `.oma/` as the source of truth for state, templates, manifests, and runtime metadata
- `.opencode/commands/akita-*.md`
- `.opencode/skills/akita-*-workflow/**`
- `.opencode/skills/akita-capability-*/**`

Generated artifacts stay under `.oma/generated/**` until an explicit
`/akita-accept` copies selected files into live repo-relative paths.

Ownership is strict. The pack does not silently overwrite user-owned `AGENTS.md`,
`opencode.json`, or unrelated `.opencode/*`.

## Development

```bash
npm ci
npm test
npm run smoke:pack-install
```

## Publishing

This repository includes:

- CI workflow: `.github/workflows/ci.yml`
- npm publish workflow: `.github/workflows/publish.yml`

Trusted publishing setup on npmjs.com must point to:

- Repository: `zuevrs/oh-my-akitagpb`
- Workflow filename: `publish.yml`

Release flow:

1. Update `package.json` version.
2. Merge to `main`.
3. Tag the release as `vX.Y.Z`.
4. Push the tag.
5. GitHub Actions publishes the package through npm trusted publishing.

## License

MIT
