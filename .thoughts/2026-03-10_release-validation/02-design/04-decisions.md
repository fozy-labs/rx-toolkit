# Архитектурные решения (ADR)

## ADR-1: Исправить опечатки в публичном API

### Статус
Принято

### Контекст
Исследование (`01-codebase-analysis.md`, раздел 7 — Опечатки/нейминг) выявило три опечатки в публичных идентификаторах:

| Текущее имя | Правильное имя | Расположение |
|-------------|---------------|-------------|
| `ResourceRefInstanse` | `ResourceRefInstance` | `src/query/types/Resource.types.ts:138` |
| `FrowardInfo` | `ForwardInfo` | `src/query/core/Resource/ResourceDuplicator.ts:15` |
| `Opertation` (директория) | `Operation` | `src/query/core/Opertation/` |

Дополнительно, `OperationAgentInstanse` содержит ту же опечатку `Instanse`, но это deprecated тип, запланированный к удалению в v0.6.0.

### Решение
Исправить все опечатки **сейчас**, пока версия 0.x (semver допускает breaking changes в минорных версиях).

Для типов `ResourceRefInstanse` и `FrowardInfo` — создать deprecated alias:

```typescript
// src/query/types/Resource.types.ts
export type ResourceRefInstance = { /* ... корректное определение ... */ };

/** @deprecated Используйте ResourceRefInstance. Будет удалено в v0.6.0 */
export type ResourceRefInstanse = ResourceRefInstance;
```

```typescript
// src/query/core/Resource/ResourceDuplicator.ts
export type ForwardInfo = { /* ... корректное определение ... */ };

/** @deprecated Используйте ForwardInfo. Будет удалено в v0.6.0 */
export type FrowardInfo = ForwardInfo;
```

Для директории `Opertation` → `Operation` — просто переименовать (внутренняя, не видна потребителям).

### Последствия
- **Позитивные**: чистый профессиональный API; потребители не наследуют опечатки
- **Негативные**: потребители, использующие `ResourceRefInstanse` по имени, получат deprecation warning (но код продолжит работать через alias)
- **Миграция**: alias позволяет постепенную миграцию

---

## ADR-2: Экспортировать query-типы из src/query/index.ts

### Статус
Принято

### Контекст
Исследование (`01-codebase-analysis.md`, раздел 2.1) показало, что `src/query/types/index.ts` корректно реэкспортирует все типы модуля, но `src/query/index.ts` не содержит `export * from './types'`. Это делает невозможным:

```typescript
import type { ResourceDefinition, CommandDefinition } from '@fozy-labs/rx-toolkit';
// ❌ Error: Module has no exported member 'ResourceDefinition'
```

Все аналоги (TanStack Query, RTK Query) экспортируют все публичные типы (`02-external-research.md`, раздел 2.1).

### Решение
Добавить строку в `src/query/index.ts`:

```typescript
// Types
export * from './types';
```

### Последствия
- **Позитивные**: потребители могут типизировать свой код; соответствие best practices TypeScript-библиотек
- **Негативные**: теоретическая возможность name collision если потребитель определил тип с совпадающим именем (крайне маловероятно)
- **Тип изменения**: additive (не breaking)

---

## ADR-3: Исправить useResourceRef для объектных args

### Статус
Принято

### Контекст
Исследование (`01-codebase-analysis.md`, раздел 2.5, баг B1) выявило:

```typescript
// src/query/react/useResourceRef.ts
React.useMemo(() => res.createRef(args), [args])
```

При каждом рендере `args` (если это объект) создаётся заново, `React.useMemo` получает новую ссылку в массиве зависимостей, и `createRef` вызывается повторно. Это критический баг — ref пересоздаётся каждый рендер.

### Варианты

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| A. `JSON.stringify(args)` как dep | Простой, предсказуемый | Не работает для non-serializable args; порядок ключей не гарантирован |
| B. `useRef` + `shallowEqual` | Совместим с текущим `compareArgs` паттерном | Больше кода, нужен ref tracking |
| C. Deep equal из existing utils | Уже есть `deepEqual` в проекте | Может быть избыточно для простых кейсов |

### Решение
**Вариант B**: использовать `useRef` + `shallowEqual` для стабилизации args, аналогично паттерну в `useResourceAgent.ts` (который уже использует `agent.compareArgs()` для сравнения args).

```typescript
// Концептуально:
const stableArgs = useRef(args);
if (!shallowEqual(stableArgs.current, args)) {
  stableArgs.current = args;
}
return React.useMemo(() => res.createRef(stableArgs.current), [stableArgs.current]);
```

### Последствия
- **Позитивные**: ref не пересоздаётся при shallow-equal args; совместимо с текущими паттернами проекта
- **Негативные**: при deep-nested объектах shallowEqual может не справиться (но это edge-case, и остальной проект тоже использует shallowEqual)

---

## ADR-4: Заменить `any` на proper типы

### Статус
Принято

### Контекст
Исследование выявило 4 случая `any` в публичном коде:

| Файл | Строка | Текущий код | Проблема |
|------|--------|-------------|---------|
| `src/query/react/useResourceAgent.ts` | 45 | `compare(args: any, prevArgs: any, agent: ResourceAgentInstance<any>)` | Потеря type-safety в helper |
| `src/query/core/Resource/ResourceDuplicator.ts` | 213 | `d: any[]` | Потеря типизации данных |
| `src/query/core/QueriesLifetimeHooks.ts` | 48 | `'$CLEANED' as any` | Обход типов для devtools |
| `src/query/types/Resource.types.ts` | generic defaults | `<A = any, R = any, S = any>` | Convention, допустимо |

### Решение
Заменить `any` на конкретные типы в первых трёх случаях:

1. **useResourceAgent.ts**: заменить на generic function:
   ```typescript
   function compare<D extends ResourceDefinition>(
     args: D["Args"], prevArgs: D["Args"], agent: ResourceAgentInstance<D>
   ): boolean
   ```

2. **ResourceDuplicator.ts**: типизировать `d` через generic parameter дупликатора.

3. **QueriesLifetimeHooks.ts**: определить union-тип для devtools states, включающий `'$CLEANED'`.

4. **Generic defaults** (`<A = any>`) — **оставить как есть**. Это convention для constraint-типов, и замена на `unknown` потребует изменений по всему codebase.

### Последствия
- **Позитивные**: улучшение type-safety; потребители получат лучший IntelliSense
- **Негативные**: минимальные — изменения внутренние, не затрагивают публичный API

---

## ADR-5: Стратегия обработки TODO/FIXME

### Статус
Принято

### Контекст
Исследование выявило TODO-комментарии:

| Файл | TODO | Суть |
|------|------|------|
| `src/query/core/Resource/ResourceAgent.ts:31` | "вообще нет точного представления, как блокировка должна работать" | Неопределённая семантика `isLocked` |
| `src/query/core/Resource/ResourceDuplicatorAgent.ts:35` | Тот же TODO | Дублирование нерешённого вопроса |
| `src/query/core/QueriesLifetimeHooks.ts:64` | "не нравится мне это, мб передавать $spy в аргументы?" | Архитектурное сомнение |
| `src/query/types/Resource.types.ts:120` | "undefined — костыль для сведения типов" | Технический долг типизации |

### Решение
**Не чинить TODO в рамках текущей валидации.** Причины:
1. Каждый TODO требует архитектурного решения, выходящего за scope
2. `isLocked` — неопределённая семантика, изменение поведения может сломать потребителей
3. `args: undefined` — изменение типов — breaking change

**Действия**:
- Задокументировать все TODO как known issues в CHANGELOG / release notes
- Создать GitHub issues для каждого TODO с label `tech-debt`
- В тестах — тестировать **текущее** поведение (включая `args: undefined`)

### Последствия
- **Позитивные**: не блокирует релиз; no risk of accidental breaking changes
- **Негативные**: технический долг остаётся; потребители могут столкнуться с неожиданным поведением `isLocked`

---

## ADR-6: Scope тестирования

### Статус
Принято

### Контекст
Исследование (`04-open-questions.md`, Q1) определило 3 варианта подхода к тестированию query-модуля.

Модуль содержит ~2500 LOC в 31 файле с нулевым покрытием. Полное покрытие потребует значительных усилий.

### Решение
**Комбинированный подход**: полноценные unit-тесты для core + smoke-тесты для React hooks.

#### Tier 1 — Unit-тесты core (без React-зависимостей)

| Компонент | Подход | Обоснование |
|-----------|--------|-------------|
| `IndirectMap` | Полные unit-тесты | Фундамент кэширования, чистая логика |
| `ReactiveCache` | Полные unit-тесты | Управление жизненным циклом кэша |
| `QueriesCache` | Unit-тесты с mock ReactiveCache | Оркестрация кэш-записей |
| `Resource` | Unit-тесты жизненного цикла | Самый сложный компонент, abort, state transitions |
| `ResourceRef` | Unit-тесты patch/commit/abort/reapply | Уникальная транзакционная логика, высокий риск |
| `Command` | Unit-тесты initiate/success/error | Вторая ключевая абстракция |
| `ResourceDuplicator` | Базовые тесты агрегации | Сложный, но менее критичный |
| `ResetAllQueriesSignal` | Простой smoke-тест | Простой singleton |
| `QueriesLifetimeHooks` | Тесты callback-вызовов | Lifecycle корректность |

#### Tier 2 — Smoke-тесты React hooks

| Хук | Подход | Обоснование |
|-----|--------|-------------|
| `useResourceAgent` | Smoke: рендер, initiate, SKIP | React-обёртка над уже протестированным core |
| `useCommandAgent` | Smoke: trigger, state transitions | React-обёртка |
| `useResourceRef` | Тест пересоздания ref (BUG) + smoke | Верификация bugfix |
| `useOperationAgent` | Не тестировать | Deprecated alias, убираем в v0.6.0 |

#### Tier 3 — Интеграционные тесты

| Тест | Подход |
|------|--------|
| Query экспорты в `root-exports.test.ts` | Расширить существующий файл |
| Типы компилируются при импорте | Type-level тест (`.test-d.ts` или inline) |
| SKIP_TOKEN | Простой unit-тест символа |

### Последствия
- **Позитивные**: покрытие критических путей; возможность отловить регрессии; разумный объём работы
- **Негативные**: React hooks покрыты только smoke-тестами; edge-кейсы concurrent-rendering не тестируются
- **Оценка**: ~50-60 тест-кейсов суммарно
