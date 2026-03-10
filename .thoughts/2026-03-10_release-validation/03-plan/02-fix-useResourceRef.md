# Фаза 2: Исправление бага useResourceRef

## Цель

Исправить критический баг в `useResourceRef`: при передаче объектных аргументов `React.useMemo` пересоздаёт ref каждый рендер, потому что `[args]` — всегда новая ссылка для объектов.

## Зависимости

- **Requires**: Phase 1 (типы исправлены, `ResourceRefInstance` переименован)
- **Blocks**: Phase 6 (smoke-тесты hooks)

## Тип выполнения

Последовательная.

---

## Задачи

### Задача 2.1: Исправить мемоизацию args в `useResourceRef`

**Файл**: `src/query/react/useResourceRef.ts`

**Текущее состояние** (полный файл):
```typescript
import React from "react";
import { SKIP } from "@/query/SKIP_TOKEN";
import type { Prettify, ResourceDefinition, ResourceInstance, ResourceRefInstanse } from "@/query/types";

type Result<D extends ResourceDefinition> = Prettify<ResourceRefInstanse<D>>;

export function useResourceRef<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D> {
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    return React.useMemo(() => {
        return res.createRef(args);
    }, [args]);
}
```

**Проблема**: `[args]` — React useMemo сравнивает зависимости через `Object.is`. Для объектов `{ id: 1 }` !== `{ id: 1 }` (разные ссылки). Поэтому `createRef` вызывается каждый рендер.

**Изменение**: использовать `useRef` + `shallowEqual` для стабилизации args (паттерн из ADR-3):

```typescript
import React from "react";
import { SKIP } from "@/query/SKIP_TOKEN";
import { shallowEqual } from "@/common/utils/shallowEqual";
import type { Prettify, ResourceDefinition, ResourceInstance, ResourceRefInstance } from "@/query/types";

type Result<D extends ResourceDefinition> = Prettify<ResourceRefInstance<D>>;

export function useResourceRef<D extends ResourceDefinition>(
    res: ResourceInstance<D>,
    ...argss: D['Args'] extends void ? [] | [typeof SKIP] : [D['Args'] | typeof SKIP]
): Result<D> {
    const args = (argss[0] === SKIP ? SKIP : argss[0]) as D['Args'] | typeof SKIP;

    const stableArgsRef = React.useRef(args);
    if (!shallowEqual(stableArgsRef.current, args)) {
        stableArgsRef.current = args;
    }

    return React.useMemo(() => {
        return res.createRef(stableArgsRef.current);
    }, [stableArgsRef.current]);
}
```

**Ключевые изменения**:
1. Импорт `shallowEqual` из `@/common/utils/shallowEqual`
2. `useRef` хранит стабильную ссылку на args
3. Обновляется только при `!shallowEqual(prev, next)`
4. `useMemo` зависит от `stableArgsRef.current` — стабильная ссылка
5. Импорт типа обновлён: `ResourceRefInstanse` → `ResourceRefInstance` (из Phase 1)

**Граничные случаи**:
- Примитивные args (`string`, `number`) — `shallowEqual` корректно сравнивает через `===`
- `SKIP` — symbol, сравнивается через `===`, стабилен
- `undefined`/`void` args — `shallowEqual` обрабатывает через `===`

---

### Задача 2.2: Верифицировать отсутствие регрессии для примитивных args

Ручная верификация: для примитивных args (`useResourceRef(res, 'id1')`) поведение не должно измениться. `shallowEqual('id1', 'id1')` → `true` (через `===` shortcut).

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Существующие тесты проходят
npx vitest run

# 3. Ручная проверка (при наличии demo app):
# - useResourceRef с объектным аргументом — ref стабилен
# - useResourceRef с примитивным аргументом — ref стабилен
# - useResourceRef с SKIP — ref не создаётся
```

## Conventional commit

```
fix(query): stabilize useResourceRef memoization for object args

Use useRef + shallowEqual to stabilize args reference before passing
to useMemo. Previously, object args caused ref recreation every render
because React.useMemo uses Object.is for dependency comparison.

Fixes: useResourceRef creates new ResourceRef every render for object args
```
