---
title: "Appendix A — Approach D Code Snippets"
date: 2026-04-02
stage: 01-research
type: appendix
---

# Appendix A: Approach D — Utility Functions Code Snippets

## 1. Duplicated Code: `complete()` Resolver Cleanup

Both classes contain identical resolver cleanup blocks in `complete()`:

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

**13 lines, character-for-character identical.**

## 2. Duplicated Code: `_fireCacheEntryAdded()` Setup

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

**6 lines structurally identical** (differs only in generic parameter).

## 3. Proposed Utility Functions

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

## 4. Before/After: `ResourceCacheEntry.complete()`

**Before** (20 lines):
```ts
override complete(): void {
    if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
    }
    this._inflightPromise = null;
    this._patchState = null;

    if (this._entryDataLoaded) { /* ... 13 lines ... */ }

    super.complete();
}
```

**After** (12 lines):
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

**Net: −10 lines per class, −20 total. Utility file: +15 lines. Overall: −5 LOC.**
