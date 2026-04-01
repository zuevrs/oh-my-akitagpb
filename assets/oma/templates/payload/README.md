# Payload templates

These are pack-owned runtime templates for `/akita-write`.

Use them as output-shape scaffolds only.
Do not treat them as capability truth.

## Available templates

- `json-body.md` — JSON request or fixture body
- `property-file.md` — simple `.properties` payload or fixture file
- `minimal-fixture.md` — minimal fixture note for non-body support files

## Rules

- Choose the template that matches the approved canonical target path.
- Keep values grounded in approved inputs, prior art, and active capability support.
- Do not invent new transport semantics or unsupported payload behavior.
- If no shipped payload template matches the approved output honestly, stop with `needs-review`.
