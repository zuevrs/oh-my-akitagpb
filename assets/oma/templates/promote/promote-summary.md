# Сводка promote

`/akita-promote` это legacy alias.

Канонический publish gate теперь живёт в `/akita-accept`, который:

- валидирует выбранные generated artifacts
- проверяет lineage и capability truth
- потом копирует артефакт в live repo path

Если вы всё ещё видите этот файл, используйте `/akita-accept`.
