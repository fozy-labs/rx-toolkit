# Документация и примеры

## 1. Обзор

Этот документ описывает, какая документация требует обновления в связи с планируемыми изменениями, и какие API-примеры должны быть верифицированы.

## 2. Файлы документации, требующие обновления

### 2.1 Обязательные обновления

| Файл | Изменение | Причина |
|------|----------|---------|
| `docs/query/README.md` | Исправить `ResourceRefInstanse` → `ResourceRefInstance` (строка 318) | Опечатка в документации (ADR-1) |
| `docs/usage/react/README.md` | Исправить `ResourceRefInstanse` → `ResourceRefInstance` (строка 226) | Опечатка в документации (ADR-1) |
| `docs/CHANGELOG.md` | Добавить запись для новой версии с описанием fixes | Release notes |

### 2.2 Рекомендуемые обновления

| Файл | Изменение | Причина |
|------|----------|---------|
| `docs/query/README.md` | Добавить раздел про экспортированные типы (import type examples) | ADR-2: типы теперь экспортируются |
| `docs/query/README.md` | Добавить документацию для `createResourceDuplicator` | Исследование выявило отсутствие (01-codebase-analysis.md, раздел 6.1) |
| `docs/usage/react/README.md` | Добавить пример `useResourceAgent` с `ResourceDuplicator` | Отсутствует (01-codebase-analysis.md, раздел 6.2) |
| `README.md` (корневой) | Проверить актуальность примеров и ссылок | Предрелизная проверка |

## 3. CHANGELOG запись

Для `docs/CHANGELOG.md` — добавить секцию:

```markdown
## [0.5.3] — YYYY-MM-DD

### Fixed
- Исправлена мемоизация `useResourceRef` для объектных аргументов — ref больше не пересоздаётся каждый рендер
- Исправлено поле `sideEffects` в package.json — `enablePatches()` корректно сохраняется при tree-shaking

### Changed
- `ResourceRefInstanse` переименован в `ResourceRefInstance` (deprecated alias сохранён)
- `FrowardInfo` переименован в `ForwardInfo` (deprecated alias сохранён)
- Директория `Opertation` переименована в `Operation` (внутреннее изменение)
- Заменены `any` типы на proper generic constraints в useResourceAgent и ResourceDuplicator
- Удалена пустая экспериментальная директория `src/query/experimental/resource_de_god/`

### Added
- Экспорт query-типов: `ResourceDefinition`, `CommandDefinition`, `ResourceQueryState`, `CommandQueryState`, `LinkOptions` и др. теперь доступны потребителям
- Unit-тесты для core query-модулей (IndirectMap, ReactiveCache, QueriesCache, Resource, ResourceRef, Command)
- Smoke-тесты для React hooks (useResourceAgent, useCommandAgent, useResourceRef)
- Интеграционные тесты query-экспортов в root-exports

### Deprecated
- `ResourceRefInstanse` — используйте `ResourceRefInstance`
- `FrowardInfo` — используйте `ForwardInfo`
```

## 4. API-примеры для верификации

Следующие примеры из документации должны быть проверены на компилируемость и работоспособность:

### 4.1 createResource

```typescript
// docs/query/README.md — пример создания ресурса
import { createResource } from '@fozy-labs/rx-toolkit';

const usersResource = createResource({
  queryFn: async (userId: string, { abortSignal }) => {
    const res = await fetch(`/api/users/${userId}`, { signal: abortSignal });
    return res.json();
  },
  cacheLifetime: 30_000,
});
```
**Статус**: должен компилироваться и работать ✅

### 4.2 createCommand с link

```typescript
// docs/query/README.md — пример команды с link
import { createCommand } from '@fozy-labs/rx-toolkit';

const updateUser = createCommand({
  queryFn: async (data: { id: string; name: string }) => {
    return fetch(`/api/users/${data.id}`, { method: 'PATCH', body: JSON.stringify(data) });
  },
  link: {
    resource: usersResource,
    getArgs: (data) => data.id,
    optimisticUpdate: (draft, data) => { draft.name = data.name; },
  },
});
```
**Статус**: должен компилироваться и работать ✅

### 4.3 Импорт типов (НОВОЕ)

```typescript
// Новый пример после фикса ADR-2
import type {
  ResourceDefinition,
  CommandDefinition,
  ResourceQueryState,
  CommandQueryState,
  ResourceRefInstance,  // исправленное имя
  LinkOptions,
} from '@fozy-labs/rx-toolkit';
```
**Статус**: не работает до фикса ❌ → должен работать после ✅

### 4.4 useResourceRef с объектным аргументом

```typescript
// Пример для верификации bugfix
import { useResourceRef } from '@fozy-labs/rx-toolkit';

function MyComponent({ filter }: { filter: { status: string; page: number } }) {
  const ref = useResourceRef(listResource, filter);
  // ref должен быть стабильным при shallow-equal filter
}
```
**Статус**: баг до фикса ❌ → должен работать после ✅

## 5. Документация, НЕ требующая изменений

| Файл | Причина |
|------|---------|
| `docs/signals/README.md` | Signals уже валидированы |
| `docs/devtools/README.md` | Devtools не затрагиваются |
| `docs/options/README.md` | Options не затрагиваются |
| `docs/migrations/0.5.0.md` | Историческая миграция, не меняем |
| `docs/release/README.md` | Процесс релиза не меняется |

## 6. Known Issues для release notes

Следующие проблемы **не исправляются** в текущей итерации, но должны быть документированы:

1. **`isLocked` семантика не определена** — TODO в `ResourceAgent.ts:31`. Поведение `isLocked` может измениться в будущих версиях.
2. **`args: undefined` в ResourceQueryState** — известный технический долг типизации.
3. **Render-phase side effects в useResourceAgent** — `agent.initiate(args)` вызывается в render-фазе. Может конфликтовать с React Strict Mode в dev-режиме.
4. **Promise return в optimisticUpdate** — `optimisticUpdate` поддерживает Promise return, хотя оптимистичные обновления семантически синхронны.
5. **`d_init()` deprecated но используется** — в ResourceDuplicator. Нет замены, deprecated-пометка может вводить в заблуждение.
