# Property file template

Use this template for simple `.properties` support files.

## Required structure

- one `key=value` pair per line
- UTF-8 text
- exactly one trailing newline

## Authoring rules

- Keep keys grounded in approved inputs or existing repo conventions.
- Use literal values only when they are approved and safe to persist.
- Do not emit secret, credential, token, or machine-local values.
- Do not add comments unless prior art requires them.
