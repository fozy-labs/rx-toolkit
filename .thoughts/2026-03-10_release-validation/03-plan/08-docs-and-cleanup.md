# Фаза 8: Документация и cleanup

## Цель

Обновить документацию, CHANGELOG, исправить опечатки в docs-файлах, удалить мёрвый код, задокументировать known issues.

## Зависимости

- **Requires**: Phase 7 (все тесты проходят, экспорты верифицированы)
- **Blocks**: —

## Тип выполнения

Последовательная.

---

## Задачи

### Задача 8.1: Исправить опечатки в документации

**Файл 1**: `docs/query/README.md`
- Строка 318: `ResourceRefInstanse` → `ResourceRefInstance`

**Файл 2**: `docs/usage/react/README.md`
- Строка 226: `ResourceRefInstanse` → `ResourceRefInstance`

**Действие**: найти все вхождения `ResourceRefInstanse` в docs/ и заменить на `ResourceRefInstance`.

---

### Задача 8.2: Обновить CHANGELOG

**Файл**: `docs/CHANGELOG.md`

**Добавить секцию** (перед существующими записями):

```markdown
## [0.5.4] — 2026-03-10

### Fixed
- Исправлена мемоизация `useResourceRef` для объектных аргументов — ref больше не пересоздаётся каждый рендер
- Исправлено поле `sideEffects` в package.json — `enablePatches()` корректно сохраняется при tree-shaking

### Changed
- `ResourceRefInstanse` переименован в `ResourceRefInstance` (deprecated alias сохранён)
- `FrowardInfo` переименован в `ForwardInfo` (внутренний тип)
- Директория `Opertation` переименована в `Operation` (внутреннее изменение)
- Заменены `any` типы на типизированные варианты в useResourceAgent и ResourceDuplicator

### Added
- Экспорт query-типов: `ResourceDefinition`, `CommandDefinition`, `ResourceQueryState`, `CommandQueryState`, `LinkOptions` и др.
- Unit-тесты для core query-модулей
- Smoke-тесты для React hooks query-модуля
- Интеграционные тесты query-экспортов

### Deprecated
- `ResourceRefInstanse` — используйте `ResourceRefInstance` (будет удалено в v0.6.0)
```

**Примечание**: точный номер версии (`0.5.4` или `0.6.0`) определяется мейнтейнером. В дизайне указано что semver 0.x допускает breaking changes в minor.

---

### Задача 8.3: Удалить мёртвый код

**Директория**: `src/query/experimental/resource_de_god/`

**Действие**: удалить пустую директорию. Проверить что ни один файл не импортирует из неё.

**Верификация**: 
```bash
# Поиск ссылок на experimental/resource_de_god
grep -r "resource_de_god" src/
# Ожидаемый результат: ничего не найдено
```

---

### Задача 8.4: Обновить `package.json` — `sideEffects`

**Файл**: `package.json`

**Текущее состояние** (строка 65):
```json
"sideEffects": false,
```

**Изменение**:
```json
"sideEffects": ["./dist/query/core/Resource/ResourceRef.js"],
```

**Обоснование**: `ResourceRef.ts` вызывает `enablePatches()` из immer — глобальный side-effect при импорте. При `sideEffects: false` bundler может удалить этот вызов при tree-shaking, что сломает patch-транзакции.

**Риск** (R3 + R9 из [05-risks.md](../02-design/05-risks.md)): если путь в dist не совпадает точно, фикс не сработает. Верифицировать после `npm run build`.

---

### Задача 8.5: Задокументировать known issues

**Файл**: `docs/CHANGELOG.md` (секция Known Issues) или отдельный файл.

**Known issues для документации** (из [08-docs.md](../02-design/08-docs.md)):

1. **`isLocked` семантика не определена** — TODO в `src/query/core/Resource/ResourceAgent.ts:31`. Поведение может измениться.
2. **`args: undefined` в ResourceQueryState** — технический долг типизации (`src/query/types/Resource.types.ts:120`).
3. **Render-phase side effects в useResourceAgent** — `agent.initiate(args)` вызывается в render-фазе. Может конфликтовать с React Strict Mode.
4. **Promise return в `optimisticUpdate`** — логическое противоречие (оптимистичные обновления семантически синхронны).
5. **`d_init()` deprecated но используется** — в `ResourceDuplicator`. Нет замены.

**Формат**: добавить в CHANGELOG секцию `### Known Issues` или создать `docs/query/KNOWN_ISSUES.md`.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Все тесты проходят
npx vitest run

# 3. Build проходит (проверка sideEffects пути)
npm run build

# 4. Проверка содержимого dist
# enablePatches() должен присутствовать в dist/query/core/Resource/ResourceRef.js
```

## Conventional commit

```
docs(query): update documentation, changelog and cleanup dead code

- Fix ResourceRefInstanse typo in docs/query/README.md and docs/usage/react/README.md
- Add CHANGELOG entry for 0.5.4
- Remove empty experimental/resource_de_god/ directory
- Fix sideEffects field in package.json for enablePatches()
- Document known issues
```
