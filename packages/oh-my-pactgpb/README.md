# oh-my-pactgpb

Native-first OpenCode bootstrap pack for **Pact provider verification** workflows.

`oh-my-pactgpb` installs a managed `.oma/` and `.opencode/` surface into a target
repository so an OpenCode agent can inspect a Java/Spring provider repo, detect
whether Pact provider verification is actually grounded in repo evidence, and
persist a Pact-specific scan state plus summary.

This package lives inside the umbrella repository at
`packages/oh-my-pactgpb`, but the published package name, CLI entrypoint, and
runtime behavior stay the same.

## MVP scope right now

Slice 1 is intentionally narrow.

### What is implemented

- CLI lifecycle commands: `install`, `update`, `doctor`
- OpenCode command: `/pact-scan`
- OpenCode workflow skill: `.opencode/skills/pact-scan-workflow/SKILL.md`
- Pact scan state contract and summary template under `.oma/templates/scan/`
- Strict ownership/update safety for pack-managed `.oma/`, `.opencode/`,
  `AGENTS.md`, `opencode.json`, and the managed `.gitignore` block
- Package-local proof fixtures that verify grounded detection of:
  - Maven/Gradle Pact provider dependencies
  - provider verification tests
  - local pact files
  - broker-related config hints
  - provider state hooks
  - Spring HTTP controller surface
  - integration-test prior art

### What is intentionally not implemented yet

- `/pact-plan`
- `/pact-write`
- `/pact-validate`
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

After install, open the target repo in OpenCode and start with:

```text
/pact-scan
```

## CLI commands

### `install`

Bootstrap-only install. Materializes the managed Pact scan surface into the
current repository, records local install ownership in `.oma/install-state.json`,
and updates a pack-managed `.gitignore` block for local/runtime/generated
surfaces.

### `update`

Explicit refresh path. Rewrites only pack-owned artifacts recorded in
`install-state` and refreshes the pack-managed `.gitignore` block without
claiming user-owned ignore rules outside that block.

### `doctor`

Diagnose-first command. Writes `.oma/state/local/doctor/doctor-report.json` and
returns one safe next step.

## Runtime surface

The package materializes these top-level surfaces in a target repository:

- `.oma/` as the source of truth for scan templates, instructions, manifests, and runtime metadata
- `.opencode/commands/pact-scan.md`
- `.opencode/skills/pact-scan-workflow/SKILL.md`
- `.oma/templates/scan/state-contract.json`
- `.oma/templates/scan/scan-summary.md`

Ownership is strict. The pack does not silently overwrite user-owned `AGENTS.md`,
`opencode.json`, unrelated `.opencode/*`, or user-owned `.gitignore` rules
outside the pack-managed block.

## VCS policy for installed repos

After install, the pack-managed `.gitignore` block keeps this split explicit.

### Commit-worthy durable pack surface

These files are meant to live in git and be shared across the team:

- `AGENTS.md`
- `opencode.json`
- `.opencode/commands/pact-scan.md`
- `.opencode/skills/pact-scan-workflow/**`
- `.oma/capability-manifest.json`
- `.oma/instructions/**`
- `.oma/templates/**`
- `.oma/runtime/shared/**`
- `.oma/state/shared/**`

This includes shared scan state such as `.oma/state/shared/scan/scan-state.json`
and `.oma/state/shared/scan/scan-summary.md`.

### Local-only runtime surface

These files stay local and are ignored by the managed `.gitignore` block:

- `.oma/install-state.json`
- `.oma/runtime/local/**`
- `.oma/state/local/**`

`install-state.json` is intentionally local because it contains machine-specific
install bookkeeping such as the recorded project root and install path.

### Generated staging surface

These files are also ignored:

- `.oma/generated/**`

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

This repository includes:

- CI workflow: `.github/workflows/ci.yml`
- npm publish workflow: `.github/workflows/publish.yml`

The package metadata marks `packages/oh-my-pactgpb` as the package directory
inside the `zuevrs/oh-my-gpb` repository.

Trusted publishing setup on npmjs.com should point to:

- Repository: `zuevrs/oh-my-gpb`
- Workflow filename: `publish.yml`

Release flow:

1. Update `packages/oh-my-pactgpb/package.json` version.
2. Merge to `main`.
3. Tag the release as `vX.Y.Z`.
4. Push the tag.
5. GitHub Actions publishes the package from `packages/oh-my-pactgpb`.

## License

MIT
