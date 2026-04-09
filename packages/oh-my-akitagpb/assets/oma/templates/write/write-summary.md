# Сводка записи

Этот файл нужен только для краткой сводки. Каноническое machine-readable состояние записи живёт в JSON-файлах под `.oma/packs/oh-my-akitagpb/state/shared/write/`.

## Канонические JSON-файлы

- `write-report.json`

## Напоминания про ownership

- Обновляйте только pack-managed write state под `.oma/packs/oh-my-akitagpb/state/shared/write/`.
- Создавайте новые generated артефакты только внутри `.oma/packs/oh-my-akitagpb/generated/{features,payloads,fixtures}/`.
- Не считайте generated путь live truth; для копирования в рабочие директории используйте явный `/akita-promote`.
- Не перезаписывайте файлы с неясным ownership.

## Напоминания по redaction

Не включайте секреты, credentials, токены, raw auth headers, raw env values или machine-local values.

## Сводка

### Generated artifacts
- 

### Approved plan reference
- Approved intent references:

### Capability bundles used
- 

### Provenance and lineage
- Capability bundles used:
- Notes:

### Write report
- Verdict:
- Omitted items:
- Ownership blocks:
- Stop conditions:
