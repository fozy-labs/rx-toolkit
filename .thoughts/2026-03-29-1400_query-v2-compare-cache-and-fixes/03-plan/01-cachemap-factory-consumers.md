---
title: "Phase 1: Area A — CacheMap + Factory + Consumer Migration + CacheMap Tests"
date: 2026-03-30
stage: 03-plan
role: rdpi-planner
---

## Goal

Replace `CompareCacheMap`'s O(n) Array with O(1) `Map<TArgs, TEntry>`, change `TCacheMapFactory` signature to `(args, argsKey) => TEntry`, add `devtoolsKey` option, remove `entries()` from `ICacheMap`, migrate all consumers (`Snapshot`, `createApi`, `ResourceV2`) to `values()` + `entry.argsKey`, add `argsKey` field to cache entries, and write all CacheMap-related tests. This phase delivers problems #1–#4 (data structure, caching, devtools keys, double serialization) and the `entries()` removal (ADR-6).

## Dependencies

- **Requires**: None (first phase)
- **Blocks**: Phase 2 (LifecycleHooks), Phase 3 (Integration Tests), Phase 4 (Demos + Docs)

## Execution

Sequential — must complete before Phase 2 (both modify `ResourceV2.ts` and `ResourceV2CacheEntry.ts`).

## Tasks

### Task 1.1: Update CacheMap type definitions

- **File**: `src/query-v2/types/cache.types.ts`
- **Action**: Modify
- **Description**: Three changes to the CacheMap type surface:
  1. Remove `entries(): IterableIterator<[string | TArgs, TEntry]>` from `ICacheMap` interface (line 35) [ref: ../02-design/03-model.md §1.1; ADR-6]
  2. Change `TCacheMapFactory` from `(args: TArgs) => TEntry` to `(args: TArgs, argsKey: string) => TEntry` (line 38) [ref: ../02-design/03-model.md §1.2; ADR-4]
  3. Add `devtoolsKey?: (args: TArgs) => string` to `ICacheMapOptions` interface (after `doCacheArgs`) [ref: ../02-design/03-model.md §1.3; ADR-3]
- **Details**:
  - `entries()` removal is the trigger for consumer migration (Tasks 1.7, 1.8). Both `CompareCacheMap` and `SerializeCacheMap` must also remove their `entries()` implementations (Tasks 1.3, 1.4).
  - `TCacheMapFactory` signature change affects all factory call sites: `CompareCacheMap.getOrCreate`, `SerializeCacheMap.getOrCreate`, and the `ResourceV2` constructor factory closure. All must be updated in this phase for compilation [ref: ../02-design/08-risks.md R2].
  - `devtoolsKey` is an optional field — non-breaking addition.

### Task 1.2: Update Resource type definitions

- **File**: `src/query-v2/types/resource.types.ts`
- **Action**: Modify
- **Description**: Two additions:
  1. Add `devtoolsKey?: (args: TArgs) => string` to `TResourceV2Options` (after `devtools` field, ~line 31) [ref: ../02-design/03-model.md §2.1; ADR-3]
  2. Add `readonly argsKey: string` to `IResourceV2CacheEntry` interface (after `machine$`, ~line 63) [ref: ../02-design/03-model.md §2.2; ADR-6]
- **Details**:
  - `devtoolsKey` flows from `TResourceV2Options` → `ICacheMapOptions` → `CompareCacheMap` constructor. Applies only to compare strategy; serialize strategy ignores it.
  - `argsKey` on entry is needed by `Snapshot.getSnapshot()` to obtain cache keys after `entries()` removal.

### Task 1.3: Rewrite CompareCacheMap

- **File**: `src/query-v2/core/CacheMap/CompareCacheMap.ts`
- **Action**: Modify (full rewrite of class body)
- **Description**: Replace the entire internal structure per ADR-1 [ref: ../02-design/03-model.md §1.4]:
  - Remove `_entries: Array<{args, entry}>` → add `_map = new Map<TArgs, TEntry>()`
  - Remove `_compareArg` field and `shallowEqual` import — no longer used for lookup
  - Remove `_find(args)` private helper
  - Add `_counter = 0` (monotonic counter for devtools keys)
  - Add `_devtoolsKey: ((args: TArgs) => string) | undefined` from `options.devtoolsKey`
  - Rewrite `get(args)`: return `this._map.get(args)`
  - Rewrite `getOrCreate(args)`: `Map.get` for hit; on miss derive `argsKey = this._devtoolsKey ? this._devtoolsKey(args) : String(this._counter++)`, call `this._factory(args, argsKey)`, `Map.set`
  - Rewrite `delete(args)`: return `this._map.delete(args)`
  - Rewrite `has(args)`: return `this._map.has(args)`
  - Rewrite `clear()`: `this._map.clear()` (counter does NOT reset — INV-CM1)
  - Rewrite `size`: return `this._map.size`
  - Rewrite `values()`: `yield* this._map.values()`
  - Remove `entries()` method entirely
- **Details**:
  - `shallowEqual` import can be removed (was the default `compareArg`).
  - Constructor reads `options.factory` and `options.devtoolsKey` only. Other option fields (`compareArg`, `serializeArgs`, `doCacheArgs`) are ignored per ADR-1 and ADR-2.
  - All Map operations are O(1) with reference identity (`===`). This is a semantic change — see R1 mitigation.

### Task 1.4: Update SerializeCacheMap

- **File**: `src/query-v2/core/CacheMap/SerializeCacheMap.ts`
- **Action**: Modify
- **Description**: Two changes:
  1. In `getOrCreate` method (~line 41): change `this._factory(args)` to `this._factory(args, key)` where `key` is the already-computed `const key = this._getKey(args)` [ref: ../02-design/03-model.md §1.5; ADR-4]. This eliminates the second serialization call (problem #4).
  2. Remove the `entries()` method (~lines 67-69) [ref: ../02-design/03-model.md §1.1; ADR-6].
- **Details**:
  - No other changes needed. `_getKey`, `_argsCache` (WeakMap for `doCacheArgs`), `_serializeArgs` all unchanged.
  - `devtoolsKey` option is ignored by `SerializeCacheMap` — the serialized key is always used as `argsKey`.

### Task 1.5: Update ResourceV2 factory and public API

- **File**: `src/query-v2/core/resource/ResourceV2.ts`
- **Action**: Modify
- **Description**: Three changes to the constructor and one method rename:
  1. Constructor (~line 51): Change factory closure from `(args) => this._entryFactory(args, serializeFn(args))` to `(args, argsKey) => this._entryFactory(args, argsKey)` — a passthrough [ref: ../02-design/03-model.md §5.1; ADR-4].
  2. Constructor (~line 49): Remove the `const serializeFn = options.serializeArgs ?? stableStringify` line (no longer needed for the factory closure; `serializeArgs` is still passed to `createCacheMap` options for `SerializeCacheMap`).
  3. Constructor: Add `devtoolsKey: options.devtoolsKey` to the `createCacheMap` options object (~line 55) [ref: ../02-design/03-model.md §5.1; ADR-3].
  4. Rename `cacheEntries()` method (~line 117) to `cacheValues()` returning `this._cache.values()` with return type `IterableIterator<ResourceV2CacheEntry<TArgs, TData>>` [ref: ../02-design/04-decisions.md ADR-6].
- **Details**:
  - `stableStringify` import may become unused after removing `serializeFn` from factory closure — check if it's used elsewhere in the file. If only used for `serializeFn`, remove the import. If also used as default for `serializeArgs` option in `createCacheMap`, it stays in the options: `serializeArgs: options.serializeArgs ?? stableStringify`.
  - Actually `stableStringify` is still used as default `serializeArgs` in the createCacheMap options, so the import stays.
  - `_lifecycleHooks` is NOT changed in this phase — it remains. Phase 2 handles lifecycle.
  - `resetCache()` still uses `this._cache.values()` (already did) and `this._lifecycleHooks.clearAll()` — unchanged in this phase.
  - `_entryFactory` signature and body are NOT changed in this phase (still uses lifecycle closures).

### Task 1.6: Add argsKey to ResourceV2CacheEntry

- **File**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Action**: Modify
- **Description**: Add the `argsKey` readonly field:
  1. Add `readonly argsKey: string;` field declaration after `readonly machine$` (~line 39) [ref: ../02-design/03-model.md §4.1; ADR-6].
  2. In constructor, set: `this.argsKey = options.entryOptions?.keyParts?.[2] ?? "";` (after `this.machine$ = this.state$`) [ref: ../02-design/03-model.md §4.2].
- **Details**:
  - `keyParts[2]` is the third element set by `ResourceV2._entryFactory`: `["Resource/", "${key}/", argsKey]`. For resources without a key, `keyParts` is `undefined` and `argsKey` defaults to empty string — acceptable since Snapshot requires keyed resources.
  - No other changes to `ResourceV2CacheEntry` in this phase. Lifecycle changes are Phase 2.

### Task 1.7: Migrate Snapshot to values() + argsKey

- **File**: `src/query-v2/core/Snapshot.ts`
- **Action**: Modify
- **Description**: Update `getSnapshot` function (~line 22):
  1. Change `for (const [key, entry] of resource.cacheEntries())` to `for (const entry of resource.cacheValues())` [ref: ../02-design/01-architecture.md §4.1; ADR-6].
  2. Replace `key` usage with `entry.argsKey` in the snapshot key assignment and in the strategy guard.
  3. Update the compare-strategy guard: `typeof key !== "string"` must change since `argsKey` is always a string. Replace with a check that detects compare strategy — e.g., check if `argsKey` is empty or use an alternative mechanism. One approach: try/catch or simply remove the guard if Snapshot is already documented as serialize-only (SSR requires serialize strategy) [ref: ../02-design/08-risks.md R6].
  4. Replace `entries[key] = { ... }` with `entries[entry.argsKey] = { ... }`.
- **Details**:
  - The guard currently throws for compare strategy. The simplest replacement is to keep a guard that throws for non-serializable scenarios. Since `argsKey` for compare strategy is a counter string like `"0"`, `"1"`, the guard could check resource's strategy directly. However, `getSnapshot` receives `ResourceV2` which has `_cache` as private. The simplest approach: leave the guard out (SSR docs state serialize-only) or add a resource-level `keyStrategy` accessor. The implementation phase should choose the simplest mechanism that preserves existing throw-on-compare behavior.
  - R6 from risk analysis tracks this concern. IT05 verifies the migration works.

### Task 1.8: Migrate createApi to values()

- **File**: `src/query-v2/api/createApi.ts`
- **Action**: Modify
- **Description**: Update the stale check loop (~line 112):
  - Change `for (const [, entry] of resource.cacheEntries())` to `for (const entry of resource.cacheValues())` [ref: ../02-design/01-architecture.md §4.1; ADR-6; R7].
- **Details**:
  - This consumer already ignores the key (destructured as `,`). Migration is trivial — just use `values()` directly.
  - R7 mitigation requires grepping for all `cacheEntries` usages before implementation — grep confirmed only 3 consumers (Snapshot, createApi, ResourceV2 itself). ResourceV2 internal usage becomes `cacheValues()` in Task 1.5.

### Task 1.9: Update existing tests for compilation

- **Files**:
  - `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts` — Modify
  - `src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — Modify
  - `src/query-v2/core/__tests__/Snapshot.test.ts` — Modify
- **Action**: Modify
- **Description**: Ensure existing tests compile and pass after Phase 1 code changes:
  1. **CacheMap.test.ts**: Update all factory mock/spy signatures from `(args) => mockEntry` to `(args, argsKey) => mockEntry`. Existing CompareCacheMap tests (CM10-CM18) that test `compareArg` lookup semantics need to be updated or replaced — the comparison-based lookup no longer exists. Existing SerializeCacheMap tests (CM01-CM09) need factory signature update only [ref: ../02-design/06-testcases.md "Correctness Verification" §1].
  2. **ResourceV2.test.ts**: Update `cacheEntries()` references to `cacheValues()` (found at ~line 232, test RE15). Update iteration patterns from `[key, entry]` destructuring to direct entry iteration [ref: ../02-design/06-testcases.md "Correctness Verification" §7].
  3. **Snapshot.test.ts**: Update for `cacheValues()` usage and `entry.argsKey` access. May need mock entries to include `argsKey` field.
- **Details**:
  - The goal is compilation + existing tests passing (those not directly testing deleted APIs). Tests for `compareArg`-based lookup behavior in CompareCacheMap become invalid by design and should be removed or rewritten.
  - This task is about updating existing tests for backward compatibility, NOT writing new tests (that's Task 1.10).

### Task 1.10: Write new CacheMap tests (CM20–CM56)

- **File**: `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts`
- **Action**: Modify (add new describe/it blocks)
- **Description**: Implement all CacheMap test cases from the test strategy [ref: ../02-design/06-testcases.md]:
  1. **CompareCacheMap Map-internals** (CM20–CM36): Reference identity semantics, CRUD operations, primitive args (`void`, `string`, `number`), `entries()` absence, `doCacheArgs` ignored.
  2. **Devtools key derivation** (CM40–CM48): Monotonic counter starts at `"0"`, increments on miss only, never reuses after delete (CM43), custom `devtoolsKey` function, counter not incremented with custom key, Signal key format verification, get/has/delete don't affect counter.
  3. **SerializeCacheMap no-double-serialization** (CM50–CM56): Factory receives pre-computed key as `argsKey` (CM50), `serializeArgs` called exactly once per new entry (CM51), existing entry lookup calls `serializeArgs` once but not factory (CM52), `doCacheArgs: true` WeakMap caching (CM53), custom serializer (CM54), `entries()` absence (CM55), `devtoolsKey` ignored (CM56).
  4. **Edge cases**: `NaN`, `null` vs `undefined`, `-0` vs `+0`, `clear()` then `getOrCreate` counter continuation.
- **Details**:
  - CM51 is the key verification for problem #4 fix — spy on `serializeArgs`, assert call count === 1 per new entry.
  - CM40/CM41/CM43 verify monotonic counter behavior (INV-CM1).
  - CM22 documents the semantic change from R1 (structurally-equal but referentially-distinct args → separate entries).

## Verification

- [ ] `npm run ts-check` passes (TypeScript compilation with no errors)
- [ ] All existing tests in `vitest` that don't test deleted APIs (`entries()`, `compareArg` lookup) pass
- [ ] New CacheMap tests (CM20–CM56) pass
- [ ] `SerializeCacheMap.getOrCreate` calls `serializeArgs` exactly once per new entry (CM51)
- [ ] `CompareCacheMap.getOrCreate` produces monotonic counter keys `"0"`, `"1"`, ... (CM40, CM41)
- [ ] `CompareCacheMap` uses reference identity — same ref → hit, different ref → miss (CM21, CM22)
- [ ] Snapshot `getSnapshot` works with `cacheValues()` + `entry.argsKey` (Snapshot.test.ts passes)
- [ ] No remaining references to `cacheEntries()` in `src/query-v2/` (grep verification per R7)
