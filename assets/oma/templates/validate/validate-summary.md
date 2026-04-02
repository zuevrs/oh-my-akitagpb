# Сводка validate

Этот файл нужен только для краткой сводки. Каноническое machine-readable состояние validate живёт в JSON-файлах под `.oma/state/local/validate/`.

## Канонические JSON-файлы

- `validation-report.json`

## Напоминания по validation

- Проверяйте только generated artifact bundle, записанный в `write-report.json`.
- Явно отклоняйте unsupported и bundle-unknown constructs.
- Сохраняйте явные lineage-drift findings вместо молчаливого partial pass.

## Напоминания по redaction

Не включайте секреты, credentials, токены, raw auth headers, raw env values или machine-local credentials.

## Сводка

### Validation report
- Verdict:
- Reviewed artifacts:
- Rejection reasons:
- Lineage notes:
- Follow-up: после успешной ручной проверки используйте явный `/akita-promote`.
