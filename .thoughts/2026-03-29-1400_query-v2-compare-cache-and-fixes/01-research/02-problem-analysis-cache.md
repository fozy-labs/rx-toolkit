---
title: "Problem Analysis: CompareCacheMap data structure and caching"
date: 2026-03-29
stage: 01-research
role: rdpi-problem-analyst
---

## Reported Problem

Two related issues in `CompareCacheMap`:

1. **Problem #1**: `CompareCacheMap` stores entries in an `Array` and uses `find`/`findIndex` for every lookup — O(n) linear scan instead of O(1) Map/WeakMap access.
2. **Problem #2**: `CompareCacheMap` does not support the `doCacheArgs` option (or any equivalent caching mechanism) for instant lookup of previously-seen args references.

## Expected vs Actual

### Problem #1 — Data structure

- **Expected**: Cache lookup is O(1) via `Map` or `WeakMap`, consistent with `SerializeCacheMap` which uses `Map<string, TEntry>` ([SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L9)).
- **Actual**: `CompareCacheMap` stores entries in `Array<{ args: TArgs; entry: TEntry }>` ([CompareCacheMap.ts](src/query-v2/core/CacheMap/CompareCacheMap.ts#L10)). Every `get`, `getOrCreate`, `has`, and `delete` call performs a linear scan:
  - `_find(args)` → `this._entries.find(e => this._compareArg(e.args, args))` — O(n) per lookup ([line 20-21](src/query-v2/core/CacheMap/CompareCacheMap.ts#L20)).
  - `delete(args)` → `this._entries.findIndex(...)` + `splice(index, 1)` — O(n) scan + O(n) shift ([lines 35-38](src/query-v2/core/CacheMap/CompareCacheMap.ts#L35)).

### Problem #2 — Missing caching option

- **Expected**: `CompareCacheMap` supports `doCacheArgs` (or an equivalent mechanism) to cache args→entry by reference identity, avoiding redundant comparison calls for repeated same-reference lookups.
- **Actual**: The constructor reads only `factory` and `compareArg` from options ([lines 14-16](src/query-v2/core/CacheMap/CompareCacheMap.ts#L14)). The `doCacheArgs` field from `ICacheMapOptions` is silently ignored.

Contrast with `SerializeCacheMap`:
  - When `doCacheArgs: true`, it creates a `WeakMap<object, string>` that caches `args → serialized key` by reference identity ([SerializeCacheMap.ts lines 13, 18](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L13)).
  - On repeated calls with the same `args` object reference, the serialization function is skipped entirely — the WeakMap yields the cached string key ([lines 22-28](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L22)).

`CompareCacheMap` has no analogous mechanism. Every call runs the full comparison against all entries, even if the exact same `args` reference was passed milliseconds earlier.

## Reproduction Status

- **Status**: Reproduced (static analysis — the behavior is deterministic from code inspection)
- **Environment / Inputs**: Source code at `src/query-v2/core/CacheMap/CompareCacheMap.ts` (64 lines)
- **Commands / Checks Run**: File reads and grep searches; no runtime execution needed — the data structure and algorithm are explicit.

## Failure Path

### Problem #1 — Every cache access is O(n)

1. `ResourceV2` creates a `CompareCacheMap` when the user supplies `compareArg` ([ResourceV2.ts line 46](src/query-v2/core/resource/ResourceV2.ts#L46): `keyStrategy = options.compareArg ? "compare" : "serialize"`).
2. `ResourceV2` calls `this._cache.getOrCreate(args)` on the following hot paths:
   - `query()` — every manual query call ([line 67](src/query-v2/core/resource/ResourceV2.ts#L67)).
   - `getEntry(..., true)` — initiating entry access ([line 76](src/query-v2/core/resource/ResourceV2.ts#L76)).
   - `_getEntry$(args, true)` — reactive entry access, called by `ResourceV2Agent.start()` and `useResourceV2Agent` on every React render cycle where args changed ([line 141](src/query-v2/core/resource/ResourceV2.ts#L141)).
   - `subscribe()` ([line 98](src/query-v2/core/resource/ResourceV2.ts#L98)).
   - `hydrateEntry()` ([line 123](src/query-v2/core/resource/ResourceV2.ts#L123)).
3. Additionally, `this._cache.get(args)` is called on:
   - `invalidate()` ([line 90](src/query-v2/core/resource/ResourceV2.ts#L90)).
   - `getEntry(args)` without `doInitiate` ([line 78](src/query-v2/core/resource/ResourceV2.ts#L78)).
   - `_getEntry$(args, false)` ([line 144](src/query-v2/core/resource/ResourceV2.ts#L144)).
4. On `entry.onClean$`, `this._cache.delete(args)` is called ([line 167](src/query-v2/core/resource/ResourceV2.ts#L167)) — O(n) findIndex + O(n) splice.
5. Each of these operations in `CompareCacheMap` calls `_find(args)` which iterates the full `_entries` array calling `_compareArg(e.args, args)` for each element.

**Performance impact assessment**:
- **Typical cache size**: One entry per unique `args` passed to a given resource. In a list/table UI this can be 10–100+ entries (e.g., one entry per item ID). In simpler use cases, 1–5 entries.
- **Lookup frequency**: `getOrCreate` is called on every React render where the hook is active. With 50 cached entries and a single `useResourceV2Agent` hook re-rendering, each render performs up to 50 comparisons. Multiple concurrent hooks or frequent re-renders multiply this linearly.
- **Comparison cost**: Default `shallowEqual` iterates all own-keys of both objects. With custom comparators the cost is user-defined.
- **Degradation**: O(n) per access × n entries × k concurrent hooks × r renders = O(n × k × r) comparisons per render cycle.

### Problem #2 — `doCacheArgs` silently ignored

1. User configures a resource via `createResource({ compareArg: ..., doCacheArgs: true, ... })`.
2. `ResourceV2` constructs cache options including `doCacheArgs: options.doCacheArgs` ([ResourceV2.ts line 55](src/query-v2/core/resource/ResourceV2.ts#L55)).
3. `createCacheMap` dispatches to `new CompareCacheMap(options)` because `keyStrategy === "compare"`.
4. `CompareCacheMap` constructor at [lines 14-16](src/query-v2/core/CacheMap/CompareCacheMap.ts#L14):
   ```
   this._factory = options.factory;
   this._compareArg = (options.compareArg as ...) ?? shallowEqual;
   ```
   — `options.doCacheArgs` is never read.
5. Result: the option is silently discarded. No WeakMap, no reference-identity caching, no user feedback that the option is unsupported.

**What "caching option" means in this context**: `SerializeCacheMap.doCacheArgs` creates a `WeakMap<object, string>` that maps object references to their serialized key, avoiding repeated serialization of the same reference. The analogous concept for `CompareCacheMap` would be a `WeakMap<object, TEntry>` (or `Map`-based index) mapping args references directly to their entries, bypassing the linear scan for repeated same-reference lookups. This is what the task refers to as "a caching option for instant lookup."

## Configuration Surface

From `ICacheMapOptions<TArgs, TEntry>` at [cache.types.ts lines 42-49](src/query-v2/types/cache.types.ts#L42):

| Option | SerializeCacheMap | CompareCacheMap |
|--------|------------------|-----------------|
| `factory` | Used (creates entries) | Used (creates entries) |
| `keyStrategy` | `"serialize"` | `"compare"` |
| `serializeArgs` | Used (custom serializer, default `stableStringify`) | **Ignored** |
| `compareArg` | **Ignored** | Used (custom comparator, default `shallowEqual`) |
| `doCacheArgs` | Used (enables `WeakMap` arg→key cache) | **Silently ignored** |

There is no `ICacheMapOptions` field specific to `CompareCacheMap` caching. The `doCacheArgs` field is the only caching-related option, and it was designed for `SerializeCacheMap` only.

## Test Evidence

### Relevant tests found

- [CacheMap.test.ts](src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts) — contains `CompareCacheMap` describe block (tests CM10–CM18).

### Test cases covering these problems

- **None**. No test verifies or benchmarks the O(n) behavior of `CompareCacheMap`.
- **None**. No test verifies that `doCacheArgs` is handled (or explicitly rejected) by `CompareCacheMap`.
- **CM09** tests `doCacheArgs` for `SerializeCacheMap` only — confirms the WeakMap caching works there ([line 171-185](src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts#L171)). No corresponding test for `CompareCacheMap`.

### Gaps

1. No test asserts that `CompareCacheMap` silently ignores `doCacheArgs`. A user passing `doCacheArgs: true` with `keyStrategy: "compare"` gets no error and no caching — this is an undetected configuration mistake.
2. No performance/scaling test for `CompareCacheMap` with large entry counts (e.g., 100+ entries).
3. No test verifies that repeated lookups with the same args reference call the comparator on every invocation (i.e., no reference-identity shortcut exists).

## Scope Boundaries

- **Analyzed**: `CompareCacheMap.ts`, `SerializeCacheMap.ts`, `cache.types.ts`, `createCacheMap.ts`, `ResourceV2.ts` (cache usage sites), `CacheMap.test.ts`.
- **Not analyzed**: Runtime performance profiling (no benchmarks executed). `query` v1 CacheMap (out of scope per task). React hook re-render frequency (depends on application usage patterns). Problems #3–#6 from the task (covered by separate analyses).
