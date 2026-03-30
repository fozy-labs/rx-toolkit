---
title: "Test Strategy: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-qa-designer
---

# Test Strategy

## Approach

Testing pyramid:

- **Unit tests** — bulk of coverage. Each redesigned component (`CompareCacheMap`, `SerializeCacheMap` factory change, `ResourceV2CacheEntry` lifecycle resolvers) is tested in isolation with mock/spy dependencies. Existing test files (`CacheMap.test.ts`, `LifecycleHooks.test.ts`, `CacheEntry.test.ts`) are updated or replaced to reflect new behavior. New test IDs continue from existing numbering (CM20+, LH10+).
- **Integration tests** — verify cross-component flows: resource creation → cache access → devtools key visible in Signal → lifecycle hooks firing → Snapshot consumer migration. Added to `src/query-v2/__tests__/integration/`.
- **Demo visual** — manual verification items (no automated tests for demo UI). Checklist format.

Existing tests that remain valid: CM01–CM09 (SerializeCacheMap CRUD), CM-F01–CM-F05 (factory dispatch), CE01–CE10 (CacheEntry basics), SN01–SN05 (Snapshot basics), AP01–AP05+ (createApi), E01–E04 (edge cases). These require minor updates for the `entries()` removal and factory signature change but test the same semantics.

Existing tests that are **replaced**: CM10–CM18 (CompareCacheMap with `compareArg` semantics → replaced by reference-identity semantics), LH01–LH09b (LifecycleHooks class → replaced by per-entry lifecycle tests).

---

## Test Cases

### CacheMap-unit: CompareCacheMap with Map internals

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM20 | CacheMap-unit | `getOrCreate` creates entry on cache miss (reference identity) | `args = {id: 1}`, first call | `factory(args, "0")` called, entry returned, `size === 1` | High |
| CM21 | CacheMap-unit | `getOrCreate` returns cached entry on same reference | Same `args` ref, second call | Same entry object returned, factory NOT called again, `size === 1` | High |
| CM22 | CacheMap-unit | `getOrCreate` creates separate entry for structurally-equal but referentially-distinct args | `args1 = {id:1}`, `args2 = {id:1}` (different refs) | Two entries, `size === 2`, `entry1 !== entry2` | High |
| CM23 | CacheMap-unit | `get` returns `undefined` for unknown args reference | `args = {id:1}` never stored | `undefined` | High |
| CM24 | CacheMap-unit | `get` returns entry for known args reference | `args` stored via `getOrCreate`, then `get(args)` | Same entry | High |
| CM25 | CacheMap-unit | `delete` removes entry by reference, returns `true` | `args` stored, then `delete(args)` | `true`, `size` decremented, `get(args) === undefined` | High |
| CM26 | CacheMap-unit | `delete` returns `false` for unknown reference | `delete({id:1})` on empty map | `false`, `size === 0` | Medium |
| CM27 | CacheMap-unit | `has` returns `true` for stored reference | `args` stored | `has(args) === true` | Medium |
| CM28 | CacheMap-unit | `has` returns `false` for unstored reference | New `{id:1}` ref | `has(args) === false` | Medium |
| CM29 | CacheMap-unit | `clear` removes all entries | 3 entries stored, `clear()` | `size === 0`, all `get()` return `undefined` | High |
| CM30 | CacheMap-unit | `values()` yields all stored entries | 3 entries via `getOrCreate` | Iterator yields 3 entries matching stored ones | Medium |
| CM31 | CacheMap-unit | `size` tracks entry count correctly across add/delete | Add 3, delete 1, add 1 | `size === 3` | Medium |
| CM32 | CacheMap-unit | Primitive args (`void`/`undefined`) — single entry for `undefined` | `getOrCreate(undefined)` twice | Same entry, factory called once | High |
| CM33 | CacheMap-unit | Primitive args (`string`) — reference identity holds for identical string literals | `getOrCreate("abc")` twice | Same entry (string interning), factory called once | Medium |
| CM34 | CacheMap-unit | Primitive args (`number`) — same number is same key | `getOrCreate(42)` twice | Same entry, factory called once | Medium |
| CM35 | CacheMap-unit | `entries()` method does not exist on `CompareCacheMap` | Access `map.entries` | Property is `undefined` or not callable | Low |
| CM36 | CacheMap-unit | `doCacheArgs` option is accepted but ignored by `CompareCacheMap` | `new CompareCacheMap({..., doCacheArgs: true})` | No error, Map lookup works normally | Low |

### CacheMap-devtools: Devtools key derivation

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM40 | CacheMap-devtools | Default monotonic counter — first entry gets `"0"` | `getOrCreate(args1)` | `factory` called with `argsKey === "0"` | High |
| CM41 | CacheMap-devtools | Second entry gets `"1"` | `getOrCreate(args1)`, `getOrCreate(args2)` | Second factory call receives `argsKey === "1"` | High |
| CM42 | CacheMap-devtools | Counter does not increment on cache hit | `getOrCreate(args)` twice with same ref | Factory called once with `"0"`, second call returns cached entry | High |
| CM43 | CacheMap-devtools | Counter does not reuse values after deletion | `getOrCreate(a1)` → `"0"`, `delete(a1)`, `getOrCreate(a2)` | Second factory call receives `argsKey === "1"`, NOT `"0"` | High |
| CM44 | CacheMap-devtools | Custom `devtoolsKey` function called instead of counter | `devtoolsKey: (args) => args.name`, `getOrCreate({name:"alice"})` | `factory` called with `argsKey === "alice"` | High |
| CM45 | CacheMap-devtools | Custom `devtoolsKey` — counter is NOT incremented | `devtoolsKey` provided, create 2 entries | `_counter` stays at 0 (verify via factory args: custom strings, not numbers) | Medium |
| CM46 | CacheMap-devtools | Devtools key format in Signal — counter-based | Resource with `key="users"`, compare strategy | Signal key `"Resource/:users/:0"` (verify via `CacheEntry` keyParts) | High |
| CM47 | CacheMap-devtools | Devtools key format in Signal — custom devtoolsKey | Resource with `key="users"`, `devtoolsKey: (a) => String(a.id)` | Signal key `"Resource/:users/:42"` | Medium |
| CM48 | CacheMap-devtools | `get`, `has`, `delete` do NOT affect counter | Interleave get/has/delete between getOrCreate calls | Counter strictly reflects number of factory invocations | Medium |

### CacheMap-serialize: SerializeCacheMap — no double serialization

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM50 | CacheMap-serialize | `getOrCreate` passes pre-computed key to factory as `argsKey` | `getOrCreate({id:1})` — spy on factory | `factory` called with `(args, '{"id":1}')` | High |
| CM51 | CacheMap-serialize | No double serialization — `serializeArgs` called exactly once per new entry | Spy/mock on `serializeArgs`, call `getOrCreate({id:1})` | `serializeArgs` call count === 1 | High |
| CM52 | CacheMap-serialize | Existing entry — `serializeArgs` called once (for lookup), factory NOT called | Store entry, call `getOrCreate` again | `serializeArgs` count === 1 (for this call), factory count === 0 | High |
| CM53 | CacheMap-serialize | `doCacheArgs: true` — WeakMap caches key, `serializeArgs` called once across repeated lookups | Same object ref, `getOrCreate` 3 times | `serializeArgs` count === 1 total (WeakMap caches), factory count === 1 | Medium |
| CM54 | CacheMap-serialize | Custom `serializeArgs` — used for both Map key and `argsKey` passed to factory | Custom serializer, `getOrCreate` | `factory` receives custom serializer output as `argsKey` | Medium |
| CM55 | CacheMap-serialize | `entries()` method does not exist on `SerializeCacheMap` | Access `map.entries` | Property is `undefined` or not callable | Low |
| CM56 | CacheMap-serialize | `devtoolsKey` option is ignored by `SerializeCacheMap` | `new SerializeCacheMap({..., devtoolsKey: fn})` | `devtoolsKey` function never called; `argsKey` is the serialized string | Medium |

### LifecycleHooks-unit: Per-entry lifecycle resolvers

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| LH10 | LifecycleHooks-unit | `onCacheEntryAdded` fires in entry constructor with `$cacheDataLoaded` and `$cacheEntryRemoved` | Entry created with `onCacheEntryAdded` callback | Callback invoked with `(args, { $cacheDataLoaded: Promise, $cacheEntryRemoved: Promise })` | High |
| LH11 | LifecycleHooks-unit | `$cacheDataLoaded` resolves on first successful fetch | Entry created, queryFn resolves with `data` | `await $cacheDataLoaded` yields `data` | High |
| LH12 | LifecycleHooks-unit | `$cacheDataLoaded` resolves only once — subsequent refetches do not re-resolve | Second fetch success after first | `$cacheDataLoaded` already settled, no re-resolution | High |
| LH13 | LifecycleHooks-unit | `$cacheEntryRemoved` resolves on `complete()` | Entry created, then `entry.complete()` | `await $cacheEntryRemoved` resolves | High |
| LH14 | LifecycleHooks-unit | `$cacheDataLoaded` rejects on `complete()` if still unresolved (queryFn never succeeded) | Entry created, queryFn rejects, then `complete()` | `$cacheDataLoaded` rejects with "Cache entry removed before data loaded" | High |
| LH15 | LifecycleHooks-unit | `onQueryStarted` fires in `_doFetch` with `$queryFulfilled` and `getCacheEntry` | Entry causes fetch, `onQueryStarted` defined | Callback invoked with `(args, { $queryFulfilled: Promise, getCacheEntry: () => entry })` | High |
| LH16 | LifecycleHooks-unit | `$queryFulfilled` resolves with `{data}` on queryFn success | queryFn resolves | `await $queryFulfilled` yields `{data}` | High |
| LH17 | LifecycleHooks-unit | `$queryFulfilled` rejects on queryFn error | queryFn rejects with Error | `$queryFulfilled` rejects with same error | High |
| LH18 | LifecycleHooks-unit | Refetch (invalidate) rejects old `$queryFulfilled` before creating new one | Entry fetched, then `invalidate()` triggers refetch | Old `$queryFulfilled` rejects with "Query superseded"; new `$queryFulfilled` created | High |
| LH19 | LifecycleHooks-unit | `getCacheEntry()` returns the entry itself | Inside `onQueryStarted` callback | `getCacheEntry() === entry` | Medium |
| LH20 | LifecycleHooks-unit | Concurrent entries — independent `$queryFulfilled` | Two entries (different args refs), both fetching | Each has own `$queryFulfilled`; resolving one does not affect the other | High |
| LH21 | LifecycleHooks-unit | `void`-args resource — lifecycle works without Map key collision | `createResourceV2<void, T>`, entry created | `onCacheEntryAdded` and `onQueryStarted` fire correctly; no resolver overwrite | High |
| LH22 | LifecycleHooks-unit | Callback error in `onCacheEntryAdded` is caught, entry still created | `onCacheEntryAdded` throws synchronously | Entry constructor completes normally; no error propagated | Medium |
| LH23 | LifecycleHooks-unit | Callback error in `onQueryStarted` is caught, fetch still proceeds | `onQueryStarted` throws synchronously | `_doFetch` continues; queryFn is called | Medium |
| LH24 | LifecycleHooks-unit | `complete()` settles all resolvers: `_entryDataLoaded` rejected, `_entryRemoved` resolved, `_queryFulfilled` rejected | Entry with all hooks, mid-flight fetch, then `complete()` | All three promises settled; no pending promises | High |
| LH25 | LifecycleHooks-unit | No `onCacheEntryAdded` defined — no resolvers created, no error | Entry without lifecycle callbacks | No `_entryDataLoaded`/`_entryRemoved` fields; `complete()` works normally | Medium |
| LH26 | LifecycleHooks-unit | No `onQueryStarted` defined — no `$queryFulfilled` created | Entry without `onQueryStarted` | `_doFetch` does not create `_queryFulfilled`; fetch proceeds normally | Medium |

### LifecycleHooks-hydration: Hooks with hydrated entries from Snapshot

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| LH30 | LifecycleHooks-hydration | Hydrated entry (initialMachine: MachineSuccess) — `$cacheDataLoaded` resolves immediately | `hydrateEntry({id:1}, machineSuccess)` with `onCacheEntryAdded` | `$cacheDataLoaded` resolves with hydrated data immediately (no fetch needed) | High |
| LH31 | LifecycleHooks-hydration | Hydrated entry — `_doFetch` is NOT called (initialMachine provided) | Entry with `initialMachine: MachineSuccess` | `onQueryStarted` NOT invoked during construction; no `$queryFulfilled` created | High |
| LH32 | LifecycleHooks-hydration | Hydrated entry — `$cacheEntryRemoved` still works on `complete()` | Hydrated entry, later `complete()` | `$cacheEntryRemoved` resolves | Medium |
| LH33 | LifecycleHooks-hydration | Hydrated entry invalidated — lifecycle hooks fire on subsequent fetch | Hydrated entry, then `invalidate()` | `onQueryStarted` fires, `$queryFulfilled` created | Medium |

### Integration: Resource → Entry → Hooks → Devtools

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| IT01 | Integration | Compare-strategy resource: entry creation → monotonic devtools key → Signal key | `createResourceV2({key: "users", compareArg: shallowEqual})`, `getEntry(args, true)` | Entry's `argsKey === "0"`, Signal key contains `"Resource/:users/:0"` | High |
| IT02 | Integration | Serialize-strategy resource: entry creation → serialized devtools key → Signal key | `createResourceV2({key: "items"})`, `getEntry({id:1}, true)` | Entry's `argsKey === '{"id":1}'`, Signal key contains `'Resource/:items/:{"id":1}'` | High |
| IT03 | Integration | Lifecycle hooks fire on entry creation and query fulfillment | Resource with `onCacheEntryAdded` + `onQueryStarted`, `getEntry(args, true)` | Both callbacks invoked; `$queryFulfilled` settled after queryFn completes | High |
| IT04 | Integration | `resetCache()` — all entries complete, lifecycle resolvers settled | Resource with 3 entries + lifecycle hooks, `resetCache()` | All `$cacheEntryRemoved` resolved, all pending `$queryFulfilled` rejected, cache empty | High |
| IT05 | Integration | Snapshot uses `cacheValues()` + `entry.argsKey` (serialize strategy) | Serialize-strategy resource with 2 entries, `Snapshot.getSnapshot(api)` | Snapshot contains entries keyed by serialized args strings | Medium |
| IT06 | Integration | `createApi` stale check iterates `cacheValues()` (no `entries()`) | `createApi` with resources, access stale check path | No error, entries iterated via `values()` | Medium |
| IT07 | Integration | `entry.argsKey` is accessible on `IResourceV2CacheEntry` interface | Access `entry.argsKey` via typed interface | String value returned matching devtools key | Medium |
| IT08 | Integration | Custom `devtoolsKey` function flows from resource options to Signal key | `createResourceV2({devtoolsKey: (a) => a.name, compareArg: ...})`, create entry | Signal key uses custom devtools key value | Medium |

### Demo-visual: Manual verification items

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| DV01 | Demo-visual | `error-swr-states.tsx` — title says "SWR-восстановление" | Open demo page | Title is `⚠️ SWR-восстановление после ошибки (Query v2)` | Medium |
| DV02 | Demo-visual | `error-swr-states.tsx` — shows `isRefreshError` instead of `isError` | Open demo, trigger invalidation | Badge displays `isRefreshError: true` after even-numbered fetch | Medium |
| DV03 | Demo-visual | `error-swr-states.tsx` — error banner uses warning styling, mentions SWR | Trigger error during refresh | Warning banner with "Данные сохранены благодаря SWR-семантике" | Medium |
| DV04 | Demo-visual | `lifecycle-hooks.tsx` — `isError` badge replaced with `isRefreshError` or removed | Open demo | No misleading `isError: false` badge | Low |
| DV05 | Demo-visual | `basic-query.tsx` — `isError` badge removed | Open demo | No `isError` display in status indicators | Low |
| DV06 | Demo-visual | `optimistic-patches.tsx` — unreachable `isError` early return removed | Inspect component code / open demo | No dead-code error card path | Low |
| DV07 | Demo-visual | `ssr-snapshot.tsx` — unreachable `isError` block removed | Inspect component code / open demo | No dead-code error block | Low |

---

## Edge Cases

### CompareCacheMap edge cases

| Edge Case | Test Strategy | Related Test IDs |
|-----------|---------------|-----------------|
| **`NaN` as args** — `Map` treats `NaN === NaN` as `true` (unlike `===`) | Unit test: `getOrCreate(NaN)` twice → same entry (Map spec behavior) | New edge case test |
| **`null` vs `undefined` args** — distinct Map keys | Unit test: `getOrCreate(null)` and `getOrCreate(undefined)` → two entries | New edge case test |
| **`-0` vs `+0` args** — `Map` treats them as same key | Unit test: `getOrCreate(-0)` then `get(+0)` → same entry (Map spec behavior) | New edge case test |
| **Large cache (1000+ entries)** — O(1) confirmation | Unit test: insert 1000 entries, measure lookup doesn't degrade (no timeout, all O(1)) | CM36 can cover |
| **Concurrent `getOrCreate` with same ref** — no duplicate entries | Synchronous: two `getOrCreate` calls with same ref → factory called once | Covered by CM21 |
| **`clear()` then `getOrCreate`** — counter continues from last value | `clear()` after 3 entries, then new `getOrCreate` | Counter produces `"3"`, not `"0"` (INV-CM1) |

### SerializeCacheMap edge cases

| Edge Case | Test Strategy | Related Test IDs |
|-----------|---------------|-----------------|
| **Custom serializer returns empty string** — valid Map key | Unit test: serializer returns `""`, `getOrCreate` works | New edge case test |
| **Custom serializer returns non-unique keys for different args** — entries overwrite | Unit test: serializer returns constant string → second getOrCreate returns first entry | Existing behavior, may need documentation |

### LifecycleHooks edge cases

| Edge Case | Test Strategy | Related Test IDs |
|-----------|---------------|-----------------|
| **`complete()` called twice (idempotent)** — resolvers already null | Unit test: `complete()` twice → no error, no double resolution | Extend LH24 |
| **`onQueryStarted` callback throws — `$queryFulfilled` still created** | Unit test: callback throws, verify `_queryFulfilled` resolver exists and settles | LH23 |
| **Refetch 3 times rapidly** — each old `$queryFulfilled` rejected before new one | Unit test: 3 `_doFetch` calls → 2 rejections + 1 live resolver | Extend LH18 |
| **`onCacheEntryAdded` returns non-thenable (sync callback)** — no error | Unit test: sync callback, verify resolvers created | LH10 covers |
| **Entry completes during queryFn execution (race condition)** — abort + resolve cleanup | Unit test: start fetch, call `complete()` before queryFn resolves → abort signal fired, resolvers settled | LH24 covers with timing |

---

## Performance Criteria

### CacheMap lookup performance

| Criterion | Metric | Threshold | Verification |
|-----------|--------|-----------|-------------|
| `CompareCacheMap.get` — O(1) | Time for `get` on 1000-entry cache | < 1ms (same order as 10-entry cache) | Unit test: insert 1000 entries, measure `get` time, compare with 10-entry baseline. Ratio should be < 2x [ref: ../01-research/02-problem-analysis-cache.md#Problem #1] |
| `CompareCacheMap.delete` — O(1) | Time for `delete` on 1000-entry cache | < 1ms | Unit test: delete from 1000-entry cache, compare with 10-entry baseline |
| `CompareCacheMap.getOrCreate` cache hit — O(1) | No degradation with cache size | Consistent < 1ms | Same as `get` — `getOrCreate` delegates to `Map.get` on hit |
| Serialization call count (serialize strategy) | `serializeArgs` invocations per `getOrCreate` | Exactly 1 for new entry, exactly 1 for existing entry | Spy-based verification in CM51, CM52 |
| Serialization call count (compare strategy) | `serializeArgs` invocations per `getOrCreate` | Exactly 0 | Spy on `stableStringify`, verify never called in compare flow |

> **Note**: Performance tests are verification tests, not benchmarks. They confirm algorithmic complexity (O(1) vs O(n)) by comparing operations on different-sized caches. They do not measure absolute performance — that is out of scope [ref: ../01-research/README.md#Contradictions and Gaps].

---

## Correctness Verification

### End-to-end validation approach

1. **CacheMap correctness**: Verify that all existing CM01–CM09 tests (SerializeCacheMap) pass with the factory signature change (`(args, argsKey)` instead of `(args)`). All new CM20–CM48 tests pass for CompareCacheMap Map semantics.

2. **No double serialization**: CM51 is the key verification test — spy on `serializeArgs`, count === 1 per new entry in `SerializeCacheMap.getOrCreate`. This directly validates the fix for Problem #4 [ref: ../01-research/03-problem-analysis-devtools.md#Problem #4].

3. **No serialization in compare strategy**: IT01 combined with a spy on `stableStringify` — verify zero calls when using compare strategy. This directly validates the fix for Problem #3 [ref: ../01-research/03-problem-analysis-devtools.md#Problem #3].

4. **Lifecycle isolation**: LH20 is the critical test — two concurrent entries with independent `$queryFulfilled` resolvers. Resolving one does not affect the other. This directly validates the fix for Problem #5 [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5].

5. **Lifecycle refetch safety**: LH18 verifies that invalidation properly rejects the old `$queryFulfilled` before creating a new one — no silent promise leak.

6. **Snapshot migration**: IT05 verifies that `Snapshot.getSnapshot` works with `cacheValues()` + `entry.argsKey` for serialize strategy. Compare strategy continues to throw (or guard appropriately).

7. **Existing test regression**: Run full `vitest` suite. All tests not directly testing removed APIs (`entries()`, `LifecycleHooks` class, `compareArg` lookup in CompareCacheMap) should pass without changes.

8. **Demo verification**: Manual checklist DV01–DV07 confirms UI text and behavior corrections.
