# Feature template with omissions note

Use this template when the approved flow is only partially supported and the generated feature needs an explicit human-readable note about what was omitted.

## Required structure

1. `# language: ru`
2. `Функционал: <concise feature title>`
3. optional `Предыстория:` if the setup is shared and supported
4. one or more supported `Сценарий:` blocks
5. a trailing markdown note section after the final scenario:
   - `# Ограничения генерации`
   - one bullet per omitted unsupported observation or assertion
6. end the file with exactly one trailing newline

## Authoring rules

- The omissions note must describe only unsupported or intentionally omitted checks.
- Do not use the omissions note to smuggle in unsupported steps.
- Every omission listed here must also appear in `.oma/state/shared/write/generation-report.json`.
