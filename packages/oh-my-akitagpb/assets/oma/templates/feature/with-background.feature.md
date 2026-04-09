# Feature template with background

Use this template when multiple scenarios share the same reusable setup.

## Required structure

1. `# language: ru`
2. `Функционал: <concise feature title>`
3. blank line
4. `Предыстория:` with shared setup steps
5. blank line
6. one or more `Сценарий:` blocks
7. each step line indented with four spaces
8. end the file with exactly one trailing newline

## Authoring rules

- Put only genuinely shared setup into `Предыстория:`.
- Do not move assertions into background.
- Keep background steps inside the active capability boundary.
- If the approved flow does not clearly need a background, use `default.feature.md` instead.
