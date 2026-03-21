# Ограничения и требования

## 1. TypeScript strict mode

### Текущее состояние

`tsconfig.json` содержит `"strict": true` — все строгие проверки включены:
- `strictNullChecks` ✅
- `strictFunctionTypes` ✅
- `strictBindCallApply` ✅
- `strictPropertyInitialization` ✅
- `noImplicitAny` ✅
- `noImplicitThis` ✅
- `alwaysStrict` ✅

**`tsc --noEmit` проходит без ошибок** — кодовая база полностью корректна с точки зрения TypeScript.

### Замечания

- Несмотря на strict mode, в коде есть осознанные `as any` cast-ы (3 штуки) и `any` в default generic parameters (convention для constraint-типов `<A = any, R = any, S = any>`).
- Опция `noUncheckedIndexedAccess` **не включена**. Её включение может выявить потенциальные null-safety проблемы в Map/Array доступах.

---

## 2. Обратная совместимость

### Deprecated API

Все deprecated элементы задокументированы и имеют timeline удаления (v0.6.0):

| Deprecated | Замена | Файл |
|-----------|--------|------|
| `createOperation()` | `createCommand()` | `src/query/api/createOperation.ts` |
| `useOperationAgent()` | `useCommandAgent()` | `src/query/react/useOperationAgent.ts` |
| `Operation` class | `Command` class | `src/query/core/Opertation/Operation.ts` |
| `OperationAgent` class | `CommandAgent` class | `src/query/core/Opertation/OperationAgent.ts` |
| `OperationDefinition` type | `CommandDefinition` | `src/query/types/Operation.types.ts` |
| `OperationCreateOptions` type | `CommandCreateOptions` | `src/query/types/Operation.types.ts` |
| `OperationCreateFn` type | `CommandCreateFn` | `src/query/types/Operation.types.ts` |
| `OperationInstance` type | `CommandInstance` | `src/query/types/Operation.types.ts` |
| `OperationAgentInstanse` type | `CommandAgentInstance` | `src/query/types/Operation.types.ts` |
| `OperationQueryState` type | `CommandQueryState` | `src/query/types/Operation.types.ts` |
| `Command.mutate()` method | `useCommandAgent` trigger | `src/query/types/Command.types.ts` |
| `ResourceDuplicator.d_init()` | — (нет замены) | `src/query/core/Resource/ResourceDuplicator.ts` |

### Потенциальные breaking changes при исправлении

1. **Переименование `ResourceRefInstanse` → `ResourceRefInstance`** — breaking для потребителей, использующих этот тип. Можно сохранить deprecated alias.
2. **Добавление `export * from './types'` в query/index.ts** — может создать name collisions если потребители уже определили свои типы с такими же именами. Маловероятно, но возможно.
3. **Исправление `args: undefined` в ResourceQueryState** — может сломать потребителей, проверяющих `state.args !== undefined`.

---

## 3. Bundle size

### Текущие зависимости по размеру (оценка minified + gzip)

| Зависимость | Примерный размер (min+gzip) | Обязательна? |
|-------------|---------------------------|-------------|
| `rxjs` (peer) | ~15-30KB (tree-shakeable) | Да — основа реактивности |
| `immer` | ~6KB | Только для patch-транзакций |
| `observable-hooks` | ~2KB | Для bridge RxJS→React |
| `react` (peer) | ~40KB | Peer |
| `zod` (peer) | ~13KB | Только для LocalState validation |

### Проблемы

1. **Нет sub-path exports** — потребители, использующие только signals, всё равно получают query-модуль в бандле (если bundler не tree-shakes эффективно).
2. **`sideEffects: false` некорректно** — `enablePatches()` в ResourceRef создаёт глобальный side-effect. При агрессивном tree-shaking bundler может удалить этот вызов.
3. **immer загружается целиком** если используется `createCommand` с `link.update/optimisticUpdate` → `ResourceRef.patch()`.

### Рекомендации

- Рассмотреть sub-path exports для `./signals` и `./query`.
- Пометить `src/query/core/Resource/ResourceRef.ts` как side-effectful (или вынести `enablePatches()` в explicit init).
- Документировать, что immer — transitive dependency query-модуля.

---

## 4. React version support

### Текущее ограничение

```json
"peerDependencies": {
  "react": "^19.0.0"
}
```

### Анализ использования React API

| API | Используется в | React 18 поддержка |
|-----|---------------|-------------------|
| `React.useRef` | useResourceAgent, useResourceRef | ✅ |
| `React.useMemo` | useResourceRef | ✅ |
| `useConstant` (custom) | useResourceAgent, useCommandAgent | ✅ (использует useRef) |
| `useEventHandler` (custom) | useCommandAgent | ✅ (использует useRef + useCallback) |
| `useSignal` (custom) | useResourceAgent, useCommandAgent | Зависит от реализации |
| `jsx: "react-jsx"` | tsconfig | React 17+ ✅ |

**Вывод**: ни один файл в src/query/ не использует React 19-specific API. Ограничение `^19.0.0` является излишне строгим.

### Контр-аргумент

Возможно, ограничение на React 19 связано с:
- `useSignal` реализацией (на signals, может использовать `useSyncExternalStore` specific behavior)
- Желанием не поддерживать legacy-проекты
- React 19 concurrent features, на которые полагается batching

**Нужно проверить**: зависит ли `useSignal` или `observable-hooks` от React 19-specific API.

---

## 5. Окружение и инструменты

### Build pipeline

```
src/ → tsc → dist/*.js + dist/*.d.ts → tsc-alias (resolve path aliases)
```

- Path aliases (`@/*`) резолвятся через `tsc-alias` post-compile.
- **Риск**: если `tsc-alias` не обработает какой-то import, потребители получат broken imports.

### Test pipeline

```
vitest run → jsdom environment → forks pool
```

- Forks pool обеспечивает изоляцию singleton state между тест-файлами.
- Setup: `resetSharedOptions()` в beforeEach.
- **Нет `afterEach` cleanup** для query state (ResetAllQueriesSignal, QueriesCache instances). Если query-тесты появятся, потребуется дополнительный reset.

---

## 6. Ограничения от RxJS

- `rxjs` ^7.0.0 — стабильная мажорная версия. RxJS 8 пока нет.
- Используемые операторы: `share`, `takeUntil`, `finalize`, `timer`, `ReplaySubject`, `BehaviorSubject`, `Subject`.
- **Нет использования deprecated RxJS API** — хорошо.
- Потребители должны иметь rxjs ^7 в проекте (peer dependency).
