# Фаза 2: Рефакторинг сигналов

## Цель

Перевести все сигналы на `SignalOptionsOrKey<T>` и массив хуков: State — hooks вместо прямых devtools, Computed — `beforeDevtoolsPush` вместо `_skipValues`, Signal и LocalState — обновление типов. Удалить временный alias `StateDevtoolsOptions`.

**Инвариант: `npx tsc --noEmit` проходит без ошибок после фазы.**

## Зависимости

- **Фаза 1** — типы, `normalizeSignalOptions()`, `Devtools.createSignalHooks()`

## Задачи

### 2.1. Рефакторинг `src/signals/signals/State.ts`

#### 2.1.1. Обновить импорты

Заменить:
```typescript
import { DevtoolsStateLike, StateDevtoolsOptions } from "@/common/devtools";
import { SignalFn } from "@/signals/types";
```

На:
```typescript
import { SignalFn, SignalOptionsOrKey, SignalOptions, SignalLifecycleHook, normalizeSignalOptions } from "@/signals/types";
```

#### 2.1.2. Заменить `_stateDevtools` на `_hooks`

```typescript
// было
private readonly _stateDevtools;
// стало
private readonly _hooks: SignalLifecycleHook<T>[] | null;
```

#### 2.1.3. Рефакторинг конструктора

Параметр: `options?: SignalOptionsOrKey<T>` вместо `StateDevtoolsOptions`.

```typescript
constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
    this.bs$ = new BehaviorSubject<T>(initialValue);
    this.obs = this.bs$.asObservable();

    const opts = normalizeSignalOptions(options);

    const hooks: SignalLifecycleHook<T>[] = [];

    const devtoolsHook = Devtools.createSignalHooks<T>(initialValue, {
        ...opts,
        base: opts.base ?? State.name,
    });
    if (devtoolsHook) hooks.push(devtoolsHook);
    if (opts.hooks) hooks.push(...opts.hooks);

    this._hooks = hooks.length > 0 ? hooks : null;

    if (this._hooks) {
        State._finalizationRegistry.register(this, this._hooks);
    }
}
```

> Примечание: `onInit` не вызываем — `createSignalHooks` уже вызывает `createState(initialValue, ...)`, который при init сам отправляет значение в devtools.

#### 2.1.4. Обновить `set()`

```typescript
set(value: T) {
    if (value === this.bs$.value) return;
    Batcher.run(() => {
        if (this._hooks) {
            for (const hook of this._hooks) {
                hook.onChange?.(value);
            }
        }
        this.bs$.next(value);
    });
}
```

#### 2.1.5. Обновить `FinalizationRegistry`

```typescript
private static _finalizationRegistry = new FinalizationRegistry((hooks: SignalLifecycleHook<any>[]) => {
    for (const hook of hooks) {
        hook.onDispose?.();
    }
});
```

#### 2.1.6. Обновить `State.create()` — тип параметра

`options?: SignalOptionsOrKey<T>` вместо `StateDevtoolsOptions`.

### 2.2. Рефакторинг `src/signals/signals/Computed.ts`

#### 2.2.1. Обновить импорты

Заменить `StateDevtoolsOptions`:
```typescript
import { ComputeFn, SignalOptionsOrKey, SignalOptions, normalizeSignalOptions } from "@/signals/types";
```

#### 2.2.2. Обновить конструктор

```typescript
constructor(private _computeFn: () => T, options?: SignalOptionsOrKey<T>) {
    const opts = normalizeSignalOptions(options);
    const stateOptions: SignalOptionsOrKey<symbol | T> = {
        ...opts,
        base: opts.base ?? Computed.name,
        beforeDevtoolsPush: (value: symbol | T, push: (v: symbol | T) => void) => {
            if (value !== Computed._EMPTY) {
                push(value);
            }
        },
    };

    this._state$ = State.create<symbol | T>(Computed._EMPTY, stateOptions);
    // ...остальное без изменений
}
```

`_skipValues: [Computed._EMPTY]` → `beforeDevtoolsPush` с фильтрацией `_EMPTY`. Семантически идентично.

#### 2.2.3. Обновить `Computed.create()` — тип параметра

`options?: SignalOptionsOrKey<T>` вместо `StateDevtoolsOptions`.

### 2.3. Обновить `src/signals/signals/Signal.ts`

Заменить импорт `StateDevtoolsOptions` → `SignalOptionsOrKey` из `@/signals/types`.

Обновить типы в 4 местах:
- `constructor(initialValue: T, options?: SignalOptionsOrKey<T>)`
- `static create<T>(initialValue: T, options?: SignalOptionsOrKey<T>)`
- `static state<T>(initialValue: T, options?: SignalOptionsOrKey<T>)`
- `static compute<T>(computeFn: () => T, options?: SignalOptionsOrKey<T>)`

### 2.4. Обновить `src/signals/signals/LocalState.ts`

Заменить импорт `StateDevtoolsOptions` → `SignalOptionsOrKey` из `@/signals/types`.

В типе `Options<T>`: `devtoolsOptions?: SignalOptionsOrKey` вместо `StateDevtoolsOptions`.

### 2.5. Удалить alias `StateDevtoolsOptions` из `src/common/devtools/types.ts`

После рефакторинга сигналов ни один файл в `src/` не импортирует `StateDevtoolsOptions`:
- `State.ts`, `Computed.ts`, `Signal.ts`, `LocalState.ts` → `SignalOptionsOrKey`
- `Devtools.ts` → `SignalOptions` (с Фазы 1)
- `QueriesLifetimeHooks.ts` → не импортирует `StateDevtoolsOptions` (использует `DevtoolsStateLike`)

Удалить alias и импорт `SignalOptions`. Файл возвращается к:

```typescript
export interface DevtoolsStateLike<T = any> {
    (newState: T): void;
}
export interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}
```

## Верификация

```bash
npx tsc --noEmit
```

**Ожидание**: компиляция без ошибок.

```bash
npx vitest run
```

**Ожидание**: все существующие тесты проходят.

## Коммит

```
refactor(signals): integrate lifecycle hooks into signals
```
