# Default Gherkin feature template

Use this template when the approved flow does not require a `Предыстория` section.

## Required structure

1. `# language: ru`
2. `Функционал: <concise feature title>`
3. blank line
4. one or more `Сценарий:` blocks
5. each step line indented with four spaces
6. end the file with exactly one trailing newline

## Authoring rules

- Keep titles grounded in the approved flow contract.
- Use only supported steps from the active capability bundles.
- Prefer one feature file per approved flow unless the approved plan explicitly groups flows.
- Keep unsupported observations out of the feature file and record them in the write generation report.
