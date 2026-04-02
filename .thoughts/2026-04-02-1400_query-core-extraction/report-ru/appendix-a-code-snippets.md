---
title: "Приложение А — Фрагменты кода подхода D"
date: 2026-04-02
stage: 01-research
type: appendix
---

# Приложение А: Подход D — Фрагменты кода утилитных функций (Utility Functions)

## 1. Дублированный код: очистка резолверов (Resolver Cleanup) в `complete()`

Оба класса содержат идентичные блоки очистки резолверов в методе `complete()`:

**ResourceCacheEntry** (`@/src/query/core/resource/ResourceCacheEntry.ts:151-162`):
```ts
if (this._entryDataLoaded) {
    this._entryDataLoaded.reject(new Error("Cache entry removed before data loaded"));
    this._entryDataLoaded = null;
}
if (this._entryRemoved) {
    this._entryRemoved.resolve();
    this._entryRemoved = null;
}
if (this._queryFulfilled) {
    this._queryFulfilled.reject(new Error("Cache entry removed"));
    this._queryFulfilled = null;
}
```

**CommandCacheEntry** (`@/src/query/core/command/CommandCacheEntry.ts:236-247`):
```ts
if (this._entryDataLoaded) {
    this._entryDataLoaded.reject(new Error("Cache entry removed before data loaded"));
    this._entryDataLoaded = null;
}
if (this._entryRemoved) {
    this._entryRemoved.resolve();
    this._entryRemoved = null;
}
if (this._queryFulfilled) {
    this._queryFulfilled.reject(new Error("Cache entry removed"));
    this._queryFulfilled = null;
}
```

**13 строк, посимвольно идентичных.**

## 2. Дублированный код: инициализация в `_fireCacheEntryAdded()`

**ResourceCacheEntry** (`@/src/query/core/resource/ResourceCacheEntry.ts:166-170`):
```ts
this._entryDataLoaded = new PromiseResolver<TData>();
this._entryRemoved = new PromiseResolver<void>();

const tools = {
    $cacheDataLoaded: this._entryDataLoaded.promise,
    $cacheEntryRemoved: this._entryRemoved.promise,
};
```

**CommandCacheEntry** (`@/src/query/core/command/CommandCacheEntry.ts:256-260`):
```ts
this._entryDataLoaded = new PromiseResolver<TResult>();
this._entryRemoved = new PromiseResolver<void>();

const tools = {
    $cacheDataLoaded: this._entryDataLoaded.promise,
    $cacheEntryRemoved: this._entryRemoved.promise,
};
```

**6 строк структурно идентичны** (отличие только в обобщённом параметре (generic parameter)).

## 3. Предлагаемые утилитные функции (Utility Functions)

```ts
// @/src/query/core/lifecycleUtils.ts

import { PromiseResolver } from "@/common/utils/PromiseResolver";

interface ILifecycleResolvers {
    _entryDataLoaded: PromiseResolver<unknown> | null;
    _entryRemoved: PromiseResolver<void> | null;
    _queryFulfilled: PromiseResolver<unknown> | null;
}

export function cleanupLifecycleResolvers(self: ILifecycleResolvers): void {
    if (self._entryDataLoaded) {
        self._entryDataLoaded.reject(new Error("Cache entry removed before data loaded"));
        self._entryDataLoaded = null;
    }
    if (self._entryRemoved) {
        self._entryRemoved.resolve();
        self._entryRemoved = null;
    }
    if (self._queryFulfilled) {
        self._queryFulfilled.reject(new Error("Cache entry removed"));
        self._queryFulfilled = null;
    }
}

export function createLifecycleTools<T>(): {
    entryDataLoaded: PromiseResolver<T>;
    entryRemoved: PromiseResolver<void>;
    tools: { $cacheDataLoaded: Promise<T>; $cacheEntryRemoved: Promise<void> };
} {
    const entryDataLoaded = new PromiseResolver<T>();
    const entryRemoved = new PromiseResolver<void>();
    return {
        entryDataLoaded,
        entryRemoved,
        tools: {
            $cacheDataLoaded: entryDataLoaded.promise,
            $cacheEntryRemoved: entryRemoved.promise,
        },
    };
}
```

## 4. До/После: `ResourceCacheEntry.complete()`

**До** (20 строк):
```ts
override complete(): void {
    if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
    }
    this._inflightPromise = null;
    this._patchState = null;

    if (this._entryDataLoaded) { /* ... 13 строк ... */ }

    super.complete();
}
```

**После** (12 строк):
```ts
override complete(): void {
    if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
    }
    this._inflightPromise = null;
    this._patchState = null;

    cleanupLifecycleResolvers(this);
    super.complete();
}
```

**Итог: −10 строк на класс, −20 суммарно. Файл утилит: +15 строк. В целом: −5 строк кода.**
