# Сводка promote

Этот файл нужен только для краткой сводки. Каноническое machine-readable состояние promote живёт в JSON-файлах под `.oma/state/local/promote/`.

## Канонические JSON-файлы

- `promote-report.json`

## Напоминания по promotion

- Продвигайте только generated артефакты, перечисленные в `write-report.json`.
- Для каждого артефакта указывайте явный `repo-relative` destination.
- Копируйте, а не перемещайте: source в `.oma/generated/**` остаётся для traceability.
- Не публикуйте в `.oma/`, `.opencode/` и не перезаписывайте существующие файлы.

## Напоминания по redaction

Не включайте секреты, credentials, токены, raw auth headers, raw env values или machine-local values.

## Сводка

### Requested promotions
- 

### Promoted artifacts
- 

### Findings
- Verdict:
- Blockers:
- Follow-up:
