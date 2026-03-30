---
title: "query-v2 CacheMap, Devtools Keys, LifecycleHooks, Demos — Codebase Analysis"
date: 2026-03-29
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

Analysis of five areas in `query-v2`: CacheMap internals (two strategies with different data structures and lookup algorithms), devtools key derivation (serialization calls for both strategies), LifecycleHooks ownership (resource-level, not entry-level), demo examples (`isError` behavior), and existing test coverage.

## Findings

---

### Area A — CacheMap Internals

#### Public interface — `ICacheMap<TArgs, TEntry>`

- **Location**: `@/query-v2/types/cache.types.ts:27-37`
- **Methods**: `get(args)`, `getOrCreate(args)`, `delete(args)`, `has(args)`, `clear()`, `size`, `values()`, `entries()`
- **`entries()` return type**: `IterableIterator<[string | TArgs, TEntry]>` — union because `SerializeCacheMap` yields `[string, TEntry]` and `CompareCacheMap` yields `[TArgs, TEntry]`

#### Configuration — `ICacheMapOptions<TArgs, TEntry>`

- **Location**: `@/query-v2/types/cache.types.ts:42-49`
- **Fields**:
  - `factory: TCacheMapFactory<TArgs, TEntry>` — creates new entries
  - `keyStrategy: "serialize" | "compare"` — selects implementation
  - `serializeArgs?: (args: TArgs) => string` — custom serializer (serialize strategy)
  - `compareArg?: (a: TArgs, b: TArgs) => boolean` — custom comparator (compare strategy)
  - `doCacheArgs?: boolean` — enables WeakMap memoization of serialized keys (serialize strategy only)

#### `CompareCacheMap<TArgs, TEntry>`

- **Location**: `@/query-v2/core/CacheMap/CompareCacheMap.ts:8-64`
- **Internal data structure**: `Array<{ args: TArgs; entry: TEntry }>` (line 10)
- **Comparison function**: stored as `_compareArg`, defaults to `shallowEqual` (line 16)
- **Lookup algorithm**:
  - `_find(args)`: calls `this._entries.find(e => this._compareArg(e.args, args))` — **O(n) linear scan** (line 20)
  - `get(args)`: calls `_find(args)?.entry` (line 23)
  - `getOrCreate(args)`: calls `_find(args)`, if not found calls `factory(args)` and pushes to array (lines 27-32)
  - `delete(args)`: calls `this._entries.findIndex(...)` + `splice(index, 1)` — **O(n) scan + O(n) splice** (lines 34-38)
  - `has(args)`: calls `_find(args) !== undefined` (line 40)
- **No secondary index**: no Map, WeakMap, or any O(1) lookup structure
- **No `doCacheArgs` support**: the `doCacheArgs` option from `ICacheMapOptions` is ignored; constructor only reads `factory` and `compareArg`

#### `SerializeCacheMap<TArgs, TEntry>`

- **Location**: `@/query-v2/core/CacheMap/SerializeCacheMap.ts:8-68`
- **Internal data structure**: `Map<string, TEntry>` (line 9)
- **Serialization function**: stored as `_serializeArgs`, defaults to `stableStringify` (line 12)
- **Args caching**: `WeakMap<object, string> | null` — created when `doCacheArgs: true` (line 13, line 18)
- **Lookup algorithm**:
  - `_getKey(args)`: if `_argsCache` is non-null and args is an object, checks WeakMap first; otherwise calls `_serializeArgs(args)` (lines 21-29)
  - `get(args)`: `this._map.get(this._getKey(args))` — **O(1) Map lookup** after serialization (line 31)
  - `getOrCreate(args)`: `_getKey(args)` → `_map.get(key)` → if miss: `factory(args)` + `_map.set(key, entry)` (lines 33-40)
  - `delete(args)`: `this._map.delete(this._getKey(args))` — **O(1)** (line 42)
- **`entries()` yields `[string, TEntry]`** — serialized key, not original args (line 64)

#### `createCacheMap(options)`

- **Location**: `@/query-v2/core/CacheMap/createCacheMap.ts:10-12`
- **Selection logic**: `options.keyStrategy === "compare" ? new CompareCacheMap(options) : new SerializeCacheMap(options)`
- **Simple ternary** — no validation, no defaults beyond what each constructor handles

#### `stableStringify(value)`

- **Location**: `@/query-v2/lib/stableStringify.ts:13-23`
- **Algorithm**: `JSON.stringify` with a replacer that sorts object keys alphabetically. Handles plain objects, arrays, primitives, null, undefined. Does NOT handle Date, Map, Set, RegExp.

---

### Area B — Devtools Key Extraction

#### Key derivation flow in `ResourceV2`

- **Location**: `@/query-v2/core/resource/ResourceV2.ts:47-56` (constructor)
- **`serializeFn`**: `options.serializeArgs ?? stableStringify` — always defined, regardless of `keyStrategy` (line 47)
- **factory closure**: `(args) => this._entryFactory(args, serializeFn(args))` (line 51)
  - `serializeFn(args)` is called inside the factory closure to produce `argsKey`
  - This `argsKey` is passed to `_entryFactory` as the second parameter

#### `_entryFactory(args, argsKey)` — devtools key assembly

- **Location**: `@/query-v2/core/resource/ResourceV2.ts:147-175`
- **keyParts construction**: `this._key ? ["Resource/", \`${this._key}/\`, argsKey] : undefined` (line 156)
  - Example: for `key="users"` and `args={id:1}` → `["Resource/", "users/", '{"id":1}']`
- **Passed to**: `ResourceV2CacheEntry` constructor → `CacheEntry` constructor via `entryOptions.keyParts`

#### `CacheEntry` constructor — Signal creation with devtools key

- **Location**: `@/query-v2/core/CacheEntry.ts:17-26`
- **Signal key**: `options?.keyParts?.join(":")` — e.g. `"Resource/:users/:{"id":1}"` (line 22)
- **Signal.state** is created with this key, which is used by devtools for display

#### Redundancy in `SerializeCacheMap` (problem #4)

For **new entries** in `SerializeCacheMap.getOrCreate()`:
1. `_getKey(args)` calls `_serializeArgs(args)` → **serialization call #1** (for Map lookup) — `@/query-v2/core/CacheMap/SerializeCacheMap.ts:34`
2. `this._factory(args)` internally calls `serializeFn(args)` → **serialization call #2** (for devtools key) — `@/query-v2/core/resource/ResourceV2.ts:51`
3. Result: `stableStringify` (or custom serializer) is invoked **twice** for the same args on every new entry creation
4. For **existing entries**: only call #1 occurs (factory is not invoked)

#### Serialization in `CompareCacheMap` (problem #3)

For **new entries** in `CompareCacheMap.getOrCreate()`:
1. Lookup uses `_compareArg` — **no serialization** for lookup
2. `this._factory(args)` internally calls `serializeFn(args)` → **serialization call #1** (for devtools key only) — `@/query-v2/core/resource/ResourceV2.ts:51`
3. Result: serialization is used for devtools key derivation even though the cache strategy is comparison-based
4. If args are non-serializable (e.g. RegExp, functions), `stableStringify` may produce incorrect or indistinguishable keys

#### Devtools consumers

- **`DevtoolsLike` interface**: `@/common/devtools/types.ts:1-5` — defines `state(name, initState): DevtoolsStateLike<T>`
- **`reduxDevtools`**: `@/common/devtools/reduxDevtools.ts:107-135` — consumes `name` (the joined keyParts) to build a nested state tree
- **`combineDevtools`**: `@/common/devtools/combineDevtools.ts:3-11` — multiplexes to multiple devtools instances
- **Signal integration**: The Signal system itself is responsible for calling `devtools.state(key, initState)` during signal creation. The key comes from `keyParts.join(":")`.

#### No per-strategy devtools key customization

- `ICacheMapOptions` has no option for devtools key extraction
- `TResourceV2Options` has no option for custom devtools key derivation (`@/query-v2/types/resource.types.ts:20-32`)
- The serialization function is always used for devtools keys, even for the compare strategy

---

### Area C — LifecycleHooks Ownership

#### `LifecycleHooks` class

- **Location**: `@/query-v2/core/LifecycleHooks.ts:24-113`
- **Constructor**: receives `onCacheEntryAdded?` and `onQueryStarted?` callbacks (line 32)
- **Internal state**: two `Map<TArgs, Resolvers>` — `_entryResolvers` and `_queryResolvers` (lines 29-30)
  - Keyed by `TArgs` (reference identity for Map keys)

#### Instantiation — **resource-level, single instance**

- **Location**: `@/query-v2/core/resource/ResourceV2.ts:44`
- **Created in**: `ResourceV2` constructor
- **Code**: `this._lifecycleHooks = new LifecycleHooks<TArgs, TData>(options.onCacheEntryAdded, options.onQueryStarted)`
- **Ownership**: the single `LifecycleHooks` instance is owned by the `ResourceV2` and shared across all entries of that resource

#### Dependency chain

1. **`ResourceV2`** creates `LifecycleHooks` (constructor, line 44)
2. **`ResourceV2._entryFactory()`** calls:
   - `this._lifecycleHooks.fireCacheEntryAdded(args, entry)` (line 167)
   - Passes callback closures to `ResourceV2CacheEntry`:
     - `onDataLoaded: (a, data) => this._lifecycleHooks.resolveDataLoaded(a, data)` (line 159)
     - `onQueryStarted: (a, entry) => this._lifecycleHooks.fireQueryStarted(a, entry)` (line 160)
     - `onQueryFulfilled: (a, result) => this._lifecycleHooks.resolveQueryFulfilled(a, result)` (line 161)
3. **`ResourceV2CacheEntry._doFetch()`** calls the callbacks:
   - `this._onQueryStarted?.(this._args, this)` — at fetch start (`@/query-v2/core/resource/ResourceV2CacheEntry.ts:128`)
   - `this._onDataLoaded?.(this._args, data)` — on first success (line 153)
   - `this._onQueryFulfilled?.(this._args, { data })` or `{ error }` — on completion (lines 154, 166)
4. **`ResourceV2.resetCache()`** calls `this._lifecycleHooks.clearAll()` (line 113)
5. **Entry `onClean$`** subscription calls `this._lifecycleHooks.fireCacheEntryRemoved(args)` (line 170)

#### Hooks are NOT owned by entries

- `ResourceV2CacheEntry` does not instantiate or hold a `LifecycleHooks` instance
- `ResourceV2CacheEntry` receives individual callback functions via its options (`onDataLoaded`, `onQueryStarted`, `onQueryFulfilled`)
- These callbacks are closures that call methods on the resource-level `LifecycleHooks`
- The `LifecycleHooks` internal Maps use `TArgs` as keys with reference identity — this means if different args objects with the same logical identity are used, lookups will fail (Map uses `===`)

#### Plugin directory audit — LifecycleHooks dependencies

**Directory**: `@/query-v2/plugins/` — contains 3 files:

| File | Description |
|------|-------------|
| `index.ts` (1 line) | Re-exports `ReactHooksPlugin` |
| `ReactHooksPlugin.ts` (22 lines) | Only plugin implementation |
| `__tests__/ReactHooksPlugin.test.ts` | Runtime tests (PL01–PL11) |
| `__tests__/ReactHooksPlugin.type.test.ts` | Type-level tests (PL09–PL10) |

**`ReactHooksPlugin` imports**:
- `useResourceV2Agent` from `@/query-v2/react` — `@/query-v2/plugins/ReactHooksPlugin.ts:1`
- `ArgsOrVoidOrSkip`, `IPlugin`, `IPluginContext`, `IResourceV2`, `TResourceV2Options` from `@/query-v2/types` — `@/query-v2/plugins/ReactHooksPlugin.ts:2`

**LifecycleHooks usage**: **None**. `ReactHooksPlugin` does not import, reference, or invoke `LifecycleHooks`, `lifecycle.types.ts`, `onCacheEntryAdded`, `onQueryStarted`, `fireCacheEntryAdded`, `fireQueryStarted`, or any lifecycle-related symbol.

**Plugin interface** (`IPlugin`): defined at `@/query-v2/types/plugin.types.ts:11-20`
- `install(context: IPluginContext): void` — `IPluginContext` contains only `keyStrategy: "serialize" | "compare"` (`@/query-v2/types/plugin.types.ts:6-8`)
- `augmentResource?(resource, options): Record<string, unknown>` — receives `IResourceV2` and `TResourceV2Options`, no lifecycle hooks exposed

**`ReactHooksPlugin.augmentResource()`**: returns `{ useResourceV2Agent(...args) }` — a thin wrapper calling the `useResourceV2Agent` React hook. No interaction with lifecycle state.

**Plugin integration path** (`createApi`): `@/query-v2/api/` contains no imports of `LifecycleHooks` or `lifecycle.types`.

**Test coverage**: PL01–PL11 test plugin installation, augmentation ordering, key collision detection, error propagation, and `useResourceV2Agent` contribution. No tests reference lifecycle hooks.

**Conclusion**: The plugin system is entirely orthogonal to `LifecycleHooks`. Plugins receive resources post-construction and contribute methods via `augmentResource`; they have no access to lifecycle internals.

---

### Area D — Demo Examples and `isError`

#### `isError` derivation in `ResourceV2Agent`

- **Location**: `@/query-v2/core/resource/ResourceV2Agent.ts:123`
- **Code**: `isError: originalStatus === "error"`
- **`originalStatus`** is `currentMachine.status` — the raw status of the current entry's machine

#### Machine state transitions affecting `isError`

- **From pending**: fetch error → `MachineError` → `status: "error"` → `isError: true` (`@/query-v2/core/resource/ResourceV2CacheEntry.ts:163`)
- **From success/refreshing**: `invalidate()` transitions to `refreshing` → fetch error → **stays `MachineSuccess` with `lastError`** (not `MachineError`) (`@/query-v2/core/resource/ResourceV2CacheEntry.ts:159-164`) → `status: "success"` → `isError: false`
- **Key fact**: `isError` is only `true` when `originalStatus` is `"error"`, which only happens when an error occurs on a `pending` state. Once data has been successfully loaded, subsequent errors via invalidate/refetch produce `MachineSuccess` with `lastError` (SWR semantics), and `isError` remains `false`.

#### Example-by-example analysis

**`error-swr-states.tsx`** (`@/apps/demos/src/examples/query-v2/error-swr-states.tsx`):
- **queryFn**: `fetchCount++`; throws on even fetchCount values (line 22: `if (fetchCount % 2 === 0)`)
- **First query (mount)**: fetchCount=1, 1%2≠0 → **success** → `isError: false`
- **After invalidate**: fetchCount=2, 2%2=0 → error, but entry was in `success` → transitions to `refreshing` → error handler produces `MachineSuccess` with `lastError` → `isError: false`
- **Result**: `isError` is **always `false`** in this example. The UI code at line 77-85 renders the error banner conditionally on `state.isError`, which never fires.
- **The example displays `isError: false` at all times**, despite being labeled as an error/SWR demo.

**`basic-query.tsx`** (`@/apps/demos/src/examples/query-v2/basic-query.tsx`):
- Uses `fetches.getItems` — always resolves (`@/apps/demos/src/utils/fetches.ts:3-12`)
- `isError` is **always `false`**. No error scenario.

**`simple-resource.tsx`** (`@/apps/demos/src/examples/query-v2/simple-resource.tsx`):
- Uses `fetches.getItems` — always resolves
- `isError` is **always `false`**. No error scenario.

**`skip-token.tsx`** (`@/apps/demos/src/examples/query-v2/skip-token.tsx`):
- Uses `fetches.getUser` — always resolves (`@/apps/demos/src/utils/fetches.ts:31-41`)
- `isError` is **always `false`**. No error scenario.

**`lifecycle-hooks.tsx`** (`@/apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`):
- **queryFn**: `queryCount++`; throws when `num % 3 === 0`
- **First query (mount)**: queryCount=1, 1%3≠0 → **success**
- **Subsequent invalidations**: errors on 3rd, 6th, etc. → but entry is already in success → SWR preserves data → `isError: false`
- **After `api.resetAll()`**: cache cleared, new entry created. If queryCount happens to be a multiple of 3 at that point, the first fetch after reset would fail → `MachineError` → `isError: true`. But this depends on the exact number of prior clicks.
- **In practice**: `isError` is `false` in the vast majority of interactions. Only through a specific combination of invalidations + resetAll can `isError` become `true`.

**`optimistic-patches.tsx`** (`@/apps/demos/src/examples/query-v2/optimistic-patches.tsx`):
- Always resolves (returns mock data) → `isError` **always `false`**

**`snapshot-hydration.tsx`**, **`ssr-snapshot.tsx`**:
- Both use always-resolving queryFns → `isError` **always `false`**

#### Summary of demo `isError` behavior

| Example              | Can `isError` become `true`? | Mechanism |
|---------------------|------------------------------|-----------|
| error-swr-states    | No                           | First query always succeeds; subsequent errors hit SWR path |
| basic-query         | No                           | queryFn never throws |
| simple-resource     | No                           | queryFn never throws |
| skip-token          | No                           | queryFn never throws |
| lifecycle-hooks     | Conditionally (after resetAll + specific queryCount) | Indirect, unreliable |
| optimistic-patches  | No                           | queryFn never throws |
| snapshot-hydration  | No                           | queryFn never throws |
| ssr-snapshot        | No                           | queryFn never throws |

---

### Area E — Tests

#### `@/query-v2/core/CacheMap/__tests__/CacheMap.test.ts`

- **Location**: `@/query-v2/core/CacheMap/__tests__/CacheMap.test.ts:1-244`
- **Coverage**:
  - **Factory mechanism**: CM-F01 to CM-F05 — tests factory invocation, `createCacheMap` dispatch to correct implementation
  - **SerializeCacheMap**: CM01–CM09, CM19 — getOrCreate, get, delete, clear, entries, custom serializeArgs, key ordering, doCacheArgs WeakMap caching, values
  - **CompareCacheMap**: CM10–CM18 — getOrCreate with compareArg, linear scan, different args, delete, clear, entries with TArgs keys, non-serializable args (RegExp), default shallowEqual
- **NOT covered**:
  - No tests for devtools key derivation or keyParts
  - No performance/benchmark tests for linear scan vs Map
  - No tests verifying `doCacheArgs` is ignored by `CompareCacheMap`
  - No tests for the double-serialization issue in SerializeCacheMap

#### `@/query-v2/core/__tests__/LifecycleHooks.test.ts`

- **Location**: `@/query-v2/core/__tests__/LifecycleHooks.test.ts:1-224`
- **Coverage**:
  - LH01–LH09b: fireCacheEntryAdded, $cacheDataLoaded, $cacheEntryRemoved, fireCacheEntryRemoved, fireQueryStarted, $queryFulfilled (resolve/reject), clearAll, no-ops when no callbacks, getCacheEntry
  - T22–T23: fireCacheEntryRemoved rejects pending $cacheDataLoaded; no-op on already-resolved
  - Error handling: callback errors caught and not propagated
- **NOT covered**:
  - No tests for ownership model (who instantiates, who passes hooks)
  - No tests for `Map<TArgs, Resolvers>` reference identity issues

#### `@/query-v2/core/__tests__/CacheEntry.test.ts`

- **Location**: `@/query-v2/core/__tests__/CacheEntry.test.ts:1-110`
- **Coverage**: CE01–CE10 — Signal wrapping, set/peek, dependency tracking, complete/onClean$, idempotent complete, keyParts passthrough, beforeDevtoolsPush callback
- **NOT covered**: No tests for devtools key format or correctness

#### `@/query-v2/core/__tests__/Snapshot.test.ts`

- **Coverage**: SN01–SN05 — getSnapshot captures success entries, version/keyPrefix, hydration, version mismatch

#### `@/query-v2/api/__tests__/createApi.test.ts`

- **Coverage**: AP01–AP05+ — createApi shape, duplicate key validation, option merging, resetAll, snapshot
- **NOT covered**: No tests for keyStrategy selection, devtools integration, CacheMap-specific behavior

#### `@/query-v2/__tests__/edge-cases.test.ts`

- **Coverage**: E01–E04 — sync throw, immediate reject, null data, large args serialization

#### `@/query-v2/__tests__/integration/`

- Files: `gc-lifecycle.test.ts`, `memory-leaks.test.ts`, `optimistic-updates.test.ts`, `plugins-and-snapshot.test.ts`, `query-flow.test.ts`, `reset-and-multi-agent.test.ts`
- **No matches** for CompareCacheMap, SerializeCacheMap, devtools, keyParts, or LifecycleHooks in integration tests

---

## Code References

- `@/query-v2/core/CacheMap/CompareCacheMap.ts:10` — `_entries: Array<{ args: TArgs; entry: TEntry }>`
- `@/query-v2/core/CacheMap/CompareCacheMap.ts:20` — `_find()` uses `Array.find()` — O(n) linear scan
- `@/query-v2/core/CacheMap/CompareCacheMap.ts:34` — `delete()` uses `findIndex()` + `splice()` — O(n)
- `@/query-v2/core/CacheMap/CompareCacheMap.ts:14-16` — constructor ignores `doCacheArgs`
- `@/query-v2/core/CacheMap/SerializeCacheMap.ts:9` — `_map = new Map<string, TEntry>()` — O(1) lookup
- `@/query-v2/core/CacheMap/SerializeCacheMap.ts:13` — `_argsCache: WeakMap<object, string> | null` for doCacheArgs
- `@/query-v2/core/CacheMap/SerializeCacheMap.ts:34` — `getOrCreate` calls `_getKey(args)` (serialization #1)
- `@/query-v2/core/resource/ResourceV2.ts:44` — `LifecycleHooks` instantiated at resource level
- `@/query-v2/core/resource/ResourceV2.ts:47` — `serializeFn` always defined, even for compare strategy
- `@/query-v2/core/resource/ResourceV2.ts:51` — factory calls `serializeFn(args)` (serialization #2 for serialize strategy, #1 for compare strategy)
- `@/query-v2/core/resource/ResourceV2.ts:156` — `keyParts` assembled from `_key` and `argsKey`
- `@/query-v2/core/CacheEntry.ts:22` — `keyParts.join(":")` becomes Signal key for devtools
- `@/query-v2/core/resource/ResourceV2Agent.ts:123` — `isError: originalStatus === "error"`
- `@/query-v2/core/resource/ResourceV2CacheEntry.ts:159-164` — refreshing + error → MachineSuccess with lastError (not MachineError)
- `@/apps/demos/src/examples/query-v2/error-swr-states.tsx:22` — `fetchCount % 2 === 0` throws, but first query (fetchCount=1) always succeeds
- `@/query-v2/core/LifecycleHooks.ts:29-30` — `Map<TArgs, Resolvers>` uses reference identity for TArgs keys
- `@/query-v2/plugins/ReactHooksPlugin.ts:1-2` — imports only `useResourceV2Agent` and type-only symbols; no lifecycle imports
- `@/query-v2/types/plugin.types.ts:6-8` — `IPluginContext` contains only `keyStrategy`; no lifecycle surface
- `@/query-v2/types/plugin.types.ts:11-20` — `IPlugin` interface: `install()` + optional `augmentResource()`; no lifecycle hooks API
