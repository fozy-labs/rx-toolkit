# Фаза 1: Типы + Devtools

## Цель

Создать типы `SignalLifecycleHook<T>`, `SignalOptions<T>`, `SignalOptionsOrKey<T>`, утилиту `normalizeSignalOptions()`, метод `Devtools.createSignalHooks()` (делегирует в `createState()`). Заменить `_skipValues` на `beforeDevtoolsPush` в `createState()`. Сохранить `StateDevtoolsOptions` как временный alias для обратной совместимости.

**Инвариант: `npx tsc --noEmit` проходит без ошибок после фазы.**

## Зависимости

Нет — это первая фаза.

## Задачи

### 1.1. Создать `src/signals/types/SignalOptions.ts`

```typescript
export interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}

export interface SignalOptions<T = any> {
    key?: string;
    /** @deprecated use key */
    name?: string;
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: (newValue: T, push: (v: T) => void) => void;
    hooks?: SignalLifecycleHook<T>[];
}

export type SignalOptionsOrKey<T = any> = SignalOptions<T> | string;
```

### 1.2. Создать `src/signals/types/normalizeSignalOptions.ts`

```typescript
import { SignalOptions, SignalOptionsOrKey } from './SignalOptions';

export function normalizeSignalOptions<T>(options?: SignalOptionsOrKey<T>): SignalOptions<T> {
    if (!options) return {};
    if (typeof options === 'string') return { key: options };
    if (options.name && !options.key) {
        return { ...options, key: options.name };
    }
    return options;
}
```

### 1.3. Обновить `src/signals/types/index.ts`

Добавить экспорты:
```typescript
export * from './SignalOptions';
export * from './normalizeSignalOptions';
```

### 1.4. Обновить `src/common/devtools/types.ts`

#### Было:
```typescript
export type StateDevtoolsOptions = {
    isDisabled?: boolean,
    name?: string,
    base?: string,
    _skipValues?: any[],
} | string
```

#### Стало:
Заменить `_skipValues` на `beforeDevtoolsPush`. **Сохранить тип как временный alias** — его импортируют `State.ts`, `Computed.ts`, `Signal.ts`, `LocalState.ts` (будут рефакторены в Фазе 2).

```typescript
import type { SignalOptions } from "@/signals/types";

export type StateDevtoolsOptions = SignalOptions | string;
```

`DevtoolsStateLike` и `DevtoolsLike` — без изменений.

### 1.5. Обновить `src/signals/base/Devtools.ts`

#### 1.5.1. Обновить импорты

Заменить:
```typescript
import { StateDevtoolsOptions } from "@/common/devtools";
```

На:
```typescript
import type { SignalOptions, SignalLifecycleHook } from "@/signals/types";
```

#### 1.5.2. Заменить `_skipValues` на `beforeDevtoolsPush` в `createState()`

Тип параметра `optionsDry` остаётся `string | объект` — но вместо `_skipValues` используем `beforeDevtoolsPush`. Логика та же самая: `beforeDevtoolsPush` решает, вызывать ли `push`.

```typescript
createState<T>(initialValue: T, optionsDry: SignalOptions<T> | string = {}) {
    const options = typeof optionsDry === 'string'
        ? { name: optionsDry }
        : optionsDry;

    if (options.isDisabled) return null;

    let createStateDevtools = SharedOptions.DEVTOOLS?.state;

    if (!createStateDevtools) return null;

    const key = createKey(options.key ?? options.name, options.base);

    let stateDevtools: ReturnType<typeof createStateDevtools<T>> | null = null;

    const push = (value: T) => {
        if (!stateDevtools) {
            stateDevtools = createStateDevtools!(key, value);
            return;
        }
        stateDevtools(value);
    };

    // Init
    if (options.beforeDevtoolsPush) {
        options.beforeDevtoolsPush(initialValue, push);
    } else {
        push(initialValue);
    }

    return (newState: T) => {
        if (options.beforeDevtoolsPush) {
            options.beforeDevtoolsPush(newState, push);
        } else {
            push(newState);
        }
    };
},
```

**Ключевое изменение**: `_skipValues?.includes(value)` → `beforeDevtoolsPush(value, push)`. Семантика идентична — `beforeDevtoolsPush` решает, вызывать `push` или нет.

#### 1.5.3. Обновить `createKey()`

Параметр `name` переименовать в `key` для консистентности:

```typescript
function createKey(key: string | undefined, base: string | undefined) {
```

Тело функции: заменить `name` на `key` внутри. Логика без изменений.

#### 1.5.4. Добавить метод `createSignalHooks()`

Добавить после `createState()`, перед `hasDevtools`. Делегирует в `createState()`:

```typescript
createSignalHooks<T>(initialValue: T, options: SignalOptions<T> = {}): SignalLifecycleHook<T> | null {
    const stateDevtools = this.createState(initialValue, {
        name: options.key,
        base: options.base,
        isDisabled: options.isDisabled,
        beforeDevtoolsPush: options.beforeDevtoolsPush,
    });
    if (!stateDevtools) return null;

    return {
        onChange(newValue: T) {
            stateDevtools(newValue);
        },
        onDispose() {
            stateDevtools('$COMPLETED' as any);
        },
    };
},
```

### 1.6. Обновить `src/common/devtools/index.ts`

Без изменений — `types.ts` экспортирует `StateDevtoolsOptions` (теперь alias), `DevtoolsStateLike`, `DevtoolsLike` как и раньше.

## Компиляция после фазы

```bash
npx tsc --noEmit
```

**Ожидание**: **чисто, без ошибок**. Сигналы (`State.ts`, `Computed.ts`, `Signal.ts`, `LocalState.ts`) продолжают импортировать `StateDevtoolsOptions` из `@/common/devtools` — alias совместим.

> Примечание: Computed.ts использует `_skipValues: [Computed._EMPTY]` — это будет тайп-ошибка, т.к. `_skipValues` удалён из `StateDevtoolsOptions`. Поэтому в `StateDevtoolsOptions` alias нужно оставить совместимость через `SignalOptions`, который НЕ содержит `_skipValues`. Computed передаёт объект `{ base, ..., _skipValues }` — лишнее поле `_skipValues` не вызовет тайп-ошибку (TypeScript допускает лишние поля при присваивании объектного литерала с spread). Проверим: Computed делает `const lsOptions: StateDevtoolsOptions = { base, ...options, _skipValues: [...] }` — тут **будет** ошибка, т.к. explicit тип-аннотация. Решение: **не аннотировать** `lsOptions` типом в Computed, либо оставить `_skipValues` в alias.
>
> **Решение**: alias включает `_skipValues` для полной совместимости:
> ```typescript
> export type StateDevtoolsOptions = (SignalOptions & { _skipValues?: any[] }) | string;
> ```
> Это гарантирует компиляцию Computed.ts без изменений. `_skipValues` больше не используется `createState()` — но тайп пока разрешает. Удалим в Фазе 2.

## Тесты

```bash
npx vitest run src/signals/base/Devtools.test.ts
```

**Ожидание**: существующие тесты `createState()` проходят (API сохранён, `_skipValues` заменён на `beforeDevtoolsPush` внутри, но тесты используют публичное поведение).

> Если тесты используют `_skipValues` напрямую — обновить их в этой же фазе.

## Коммит

```
refactor(signals): add SignalOptions types and Devtools.createSignalHooks()
```
