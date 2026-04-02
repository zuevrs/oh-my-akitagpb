# Сводка accept

Этот файл нужен только для краткой сводки. Каноническое machine-readable состояние accept живёт в JSON-файлах под `.oma/state/local/accept/`.

## Канонические JSON-файлы

- `accept-report.json`

## Напоминания по accept

- Принимайте только generated артефакты, перечисленные в `write-report.json`.
- Для каждого артефакта указывайте явный `repo-relative` destination.
- Перед копированием явно проверяйте lineage и capability truth.
- Копируйте, а не перемещайте: source в `.oma/generated/**` остаётся для traceability.
- Не публикуйте в `.oma/`, `.opencode/` и не перезаписывайте существующие файлы.

## Напоминания по redaction

Не включайте секреты, credentials, токены, raw auth headers, raw env values или machine-local values.

## Сводка

### Requested accepts
- 

### Accepted artifacts
- 

### Findings
- Verdict:
- Validation blockers:
- Copy blockers:
- Follow-up:
