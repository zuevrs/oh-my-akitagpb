# Feature templates

These are pack-owned runtime templates for `/akita-write`.

Use them as output-shape scaffolds only.
Do not treat them as capability truth.

## Available templates

- `default.feature.md` — one or more scenarios without background
- `with-background.feature.md` — background plus scenarios
- `with-omissions-note.feature.md` — feature with an explicit omissions/unsupported note

## Rules

- Read the approved plan and scenario capability matrix before choosing a template.
- Materialize only steps supported by the active capability bundles.
- If a needed behavior is unsupported, omit it from the generated feature and record the omission in write state.
- Do not invent steps, assertions, tags, or payload behavior that are not grounded in the approved plan and bundle references.
