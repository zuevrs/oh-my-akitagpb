# JSON body template

Use this template for JSON payload or fixture files.

## Required structure

- valid UTF-8 JSON
- stable key ordering when the repo already has a prior-art convention
- exactly one trailing newline when the repo convention uses newline-terminated JSON files

## Authoring rules

- Use only approved fields and values.
- Prefer repo prior art for naming and formatting.
- Do not introduce fields that are not grounded in the approved plan or existing repo conventions.
- If a value would expose a secret, token, credential, or machine-local value, redact it or stop.
