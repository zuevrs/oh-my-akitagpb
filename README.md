# oh-my-gpb

Umbrella npm-workspaces repository for GPB-oriented tooling.

## Current status

This repository already contains one implemented product:

- `packages/oh-my-akitagpb` — the published `oh-my-akitagpb` package

Planned sibling products can be added later under `packages/*`, but they are not
implemented here yet. In particular, there is no `oh-my-pactgpb` package in this
repository today.

## Repository shape

```text
.
├── package.json                     # private workspace root
├── .github/workflows/               # CI and publish automation
└── packages/
    └── oh-my-akitagpb/              # current published product
```

The root package is orchestration-only:

- it is `private`
- it uses npm workspaces
- it is not publishable
- product-specific code, tests, assets, and docs live with the package

## Working with the current product

From the repo root:

```bash
npm install
npm run build --workspace oh-my-akitagpb
npm test --workspace oh-my-akitagpb
npm run smoke:pack-install --workspace oh-my-akitagpb
```

Or use the thin root wrappers:

```bash
npm install
npm run build
npm test
npm run smoke:pack-install
```

## Current package docs

For install, runtime behavior, and publishing details for the existing product,
see:

- [`packages/oh-my-akitagpb/README.md`](packages/oh-my-akitagpb/README.md)

## Publish topology

The package name remains `oh-my-akitagpb`.

GitHub Actions now reads package metadata from
`packages/oh-my-akitagpb/package.json` and publishes from that package
directory.

## Manual follow-up outside this repository

The repository move is now reflected in the local clone and package metadata.
Remaining external follow-up is limited to publishing configuration:

- update npm trusted publisher binding to `zuevrs/oh-my-gpb` while keeping the
  publish workflow filename stable
