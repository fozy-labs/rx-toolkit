# Фаза 1: Исправление типов и экспортов публичного API

## Цель

Привести публичный API `src/query/` в корректное состояние: исправить опечатки в типах, добавить недостающие реэкспорты, заменить `any` на типизированные варианты. Это фундаментальная фаза, от которой зависят все последующие.

## Зависимости

- **Requires**: —
- **Blocks**: Phase 2, Phase 3, Phase 7

## Тип выполнения

Последовательная — задачи внутри фазы выполняются в указанном порядке.

---

## Задачи

### Задача 1.1: Исправить опечатку `ResourceRefInstanse` → `ResourceRefInstance`

**Файл**: `src/query/types/Resource.types.ts`

**Текущее состояние** (строка 138):
```typescript
export type ResourceRefInstanse<D extends ResourceDefinition> = {
```

**Также** (строка 80):
```typescript
    createRef(args: D["Args"]): ResourceRefInstanse<D>;
```

**Изменения**:
1. Переименовать тип `ResourceRefInstanse` → `ResourceRefInstance` (строка 138)
2. Обновить ссылку в `ResourceInstance.createRef` (строка 80)
3. Добавить deprecated alias после определения `ResourceRefInstance`:
```typescript
/** @deprecated Используйте ResourceRefInstance. Будет удалено в v0.6.0 */
export type ResourceRefInstanse<D extends ResourceDefinition> = ResourceRefInstance<D>;
```

**Файлы с внутренними ссылками для обновления**:
- `src/query/react/useResourceRef.ts` (строка 3) — import `ResourceRefInstanse` → `ResourceRefInstance`

**Обоснование**: ADR-1 из [04-decisions.md](../02-design/04-decisions.md)

---

### Задача 1.2: Исправить опечатку `FrowardInfo` → `ForwardInfo`

**Файл**: `src/query/core/Resource/ResourceDuplicator.ts`

**Текущее состояние** (строка 15):
```typescript
type FrowardInfo<D extends ResourceDefinition> = {
```

**Также** (строка 35):
```typescript
    private _fis = new Map<string | number, FrowardInfo<D['RESOURCE_DEFINITION']>>();
```

**Изменения**:
1. Переименовать тип `FrowardInfo` → `ForwardInfo` (строка 15)
2. Обновить все внутренние ссылки на `FrowardInfo` в файле (строка 35)
3. Тип `FrowardInfo` — internal (не экспортируется), поэтому deprecated alias **не нужен**

**Обоснование**: ADR-1. Тип internal — потребители его не видят.

---

### Задача 1.3: Переименовать директорию `Opertation` → `Operation`

**Текущий путь**: `src/query/core/Opertation/`
**Новый путь**: `src/query/core/Operation/`

**Файлы в директории**:
- `Operation.ts` — deprecated re-export `Command as Operation`
- `OperationAgent.ts` — deprecated re-export `CommandAgent as OperationAgent`

**Импорты для обновления**:
Проверено: ни один файл в `src/` не импортирует из `Opertation/` по имени (файлы внутри директории используют относительные пути `../Command/`). Переименование директории безопасно.

**Обоснование**: ADR-1. Внутренняя директория, не видна потребителям.

---

### Задача 1.4: Добавить экспорт типов в `src/query/index.ts`

**Файл**: `src/query/index.ts`

**Текущее состояние**: файл не содержит `export * from './types'`

**Изменение**: добавить строку в конец файла:
```typescript
// Types
export * from './types';
```

**Результат**: потребители смогут импортировать:
- `ResourceDefinition`, `ResourceInstance`, `ResourceRefInstance`, `ResourceAgentInstance`
- `ResourceQueryState`, `ResourceCreateOptions`, `ResourceQueryFnTools`
- `CommandDefinition`, `CommandInstance`, `CommandAgentInstance`, `CommandQueryState`
- `LinkOptions`, `OnCacheEntryAdded`, `OnQueryStarted`
- Deprecated: `OperationDefinition`, `OperationInstance` и т.д.

**Обоснование**: ADR-2 из [04-decisions.md](../02-design/04-decisions.md)

---

### Задача 1.5: Заменить `any` в `compare()` в `useResourceAgent.ts`

**Файл**: `src/query/react/useResourceAgent.ts`

**Текущее состояние** (строка 45):
```typescript
function compare(args: any, prevArgs: any, agent: ResourceAgentInstance<any>): boolean {
```

**Изменение**: типизировать через generic:
```typescript
function compare<D extends ResourceDefinition>(
    args: D["Args"] | typeof SKIP,
    prevArgs: D["Args"] | typeof SKIP,
    agent: ResourceAgentInstance<D>
): boolean {
```

**Примечание**: может потребоваться обновить вызов `compare(args, prevArgsRef.current, agent)` для передачи generic контекста. Если TypeScript не может вывести generic — использовать `compare<D>(...)`.

**Обоснование**: ADR-4 из [04-decisions.md](../02-design/04-decisions.md)

---

### Задача 1.6: Заменить `any[]` в `ResourceDuplicator.ts`

**Файл**: `src/query/core/Resource/ResourceDuplicator.ts`

**Текущее состояние** (строка 213):
```typescript
item.data?.forEach((d: any[]) => {
```

**Изменение**: типизировать `d` через generic parameter дупликатора:
```typescript
item.data?.forEach((d: D['DATA_ITEM']) => {
```

**Примечание**: `D['DATA_ITEM']` уже определён в `DuplicatorDefinition` — это тип элемента массива данных. Нужно верифицировать, что `item.data` имеет тип `D['DATA_ITEM'][]`.

**Обоснование**: ADR-4

---

## Верификация

```bash
# 1. TypeScript компилирует без ошибок
npx tsc --noEmit

# 2. Все существующие тесты проходят
npx vitest run

# 3. Проверить что deprecated aliases работают
# (при наличии тестов — проверится автоматически)
```

## Conventional commit

```
fix(query): fix public API typos and add type exports

- Rename ResourceRefInstanse → ResourceRefInstance (+ deprecated alias)
- Rename FrowardInfo → ForwardInfo (internal type)
- Rename Opertation/ → Operation/ directory
- Add `export * from './types'` to src/query/index.ts
- Replace `any` with proper types in useResourceAgent and ResourceDuplicator

BREAKING CHANGE: ResourceRefInstanse renamed to ResourceRefInstance.
Deprecated alias provided for backward compatibility.
```
