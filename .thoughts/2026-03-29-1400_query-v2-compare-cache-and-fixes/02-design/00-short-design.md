---
title: "Short Design: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

## Direction

The design addresses six interconnected problems in `query-v2` across three change areas. The central insight from research is that problems #1–#4 share a root cause: the factory closure in `ResourceV2` constructor unconditionally calls `serializeFn(args)`, coupling all cache strategies to serialization for devtools key derivation [ref: ../01-research/README.md#Key Findings]. The fix restructures the `TCacheMapFactory` signature from `(args) => TEntry` to `(args, argsKey) => TEntry`, allowing each `CacheMap` implementation to pass its naturally-derived key to the factory — serialized string for `SerializeCacheMap`, monotonic counter for `CompareCacheMap`. This single interface change eliminates both the semantic mismatch (problem #3) and the double serialization (problem #4).

`CompareCacheMap` replaces its `Array<{args, entry}>` with `Map<TArgs, TEntry>`, gaining O(1) reference-identity lookup. Per user feedback, no comparison-based deduplication or caching option is needed — the `compareArg` function is removed from `CompareCacheMap`, and `doCacheArgs` remains relevant only to `SerializeCacheMap` [ref: ../01-research/05-open-questions.md#Q1, Q2]. A new optional `devtoolsKey` field on `TResourceV2Options` provides user-configurable key extraction for the compare strategy, defaulting to a monotonic counter.

LifecycleHooks ownership moves from resource level to entry level (problem #5). Each `ResourceV2CacheEntry` owns its own resolver state — no shared `Map<TArgs, Resolvers>`. The `onCacheEntryAdded` event is still fired from `ResourceV2._entryFactory` (the resource knows when entries are created), but `onQueryStarted`/`$queryFulfilled`/`$cacheDataLoaded`/`$cacheEntryRemoved` are scoped entirely within the entry [ref: ../01-research/05-open-questions.md#Q4]. Problem #6 (demo `isError`) is addressed by fixing misleading UI descriptions without changing queryFn logic [ref: ../01-research/05-open-questions.md#Q8].

## Key Decisions

- **D1**: `CompareCacheMap` uses `Map<TArgs, TEntry>` with reference-identity keys; `compareArg` is removed from the class [ref: ../01-research/05-open-questions.md#Q1]
- **D2**: No `doCacheArgs` equivalent for compare strategy — option is irrelevant with `Map` [ref: ../01-research/05-open-questions.md#Q2]
- **D3**: `TCacheMapFactory` signature changes to `(args, argsKey) => TEntry`, solving both devtools key derivation and double serialization [ref: ../01-research/03-problem-analysis-devtools.md#Problem #3, Problem #4]
- **D4**: New `devtoolsKey?: (args: TArgs) => string` on `TResourceV2Options`, compare-strategy only, default monotonic counter [ref: ../01-research/05-open-questions.md#Q3]
- **D5**: Each `ResourceV2CacheEntry` owns its lifecycle resolver state; `LifecycleHooks` class is eliminated [ref: ../01-research/05-open-questions.md#Q4]
- **D6**: `entries()` removed from `ICacheMap`; consumers (`Snapshot`, `createApi`) migrate to `values()` + strategy-specific key access [ref: ../01-research/05-open-questions.md#Q9]
- **D7**: Demo `isError` UI descriptions corrected to reflect SWR semantics; queryFn logic unchanged [ref: ../01-research/05-open-questions.md#Q8]

## Scope Boundaries

### In Scope
- `CompareCacheMap` data structure replacement (Array → Map)
- `SerializeCacheMap.getOrCreate` passes computed key to factory
- `TCacheMapFactory` signature change `(args, argsKey) => TEntry`
- `devtoolsKey` option on `TResourceV2Options`
- `entries()` removal from `ICacheMap` (with consumer migration)
- LifecycleHooks elimination — resolver state moves to `ResourceV2CacheEntry`
- Demo `isError` UI description and behavior fixes (2 files: `error-swr-states.tsx`, `lifecycle-hooks.tsx`)
- `basic-query.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx` — remove misleading `isError` display or correct description

### Out of Scope
- `query` v1 CacheMap changes
- Runtime performance benchmarking
- New demo examples for error states
- queryFn logic changes in any demo
- `doCacheArgs` for compare strategy
- Plugin system changes (confirmed orthogonal to LifecycleHooks)

## Research References

- [Research summary](../01-research/README.md) — factory closure as root cause for problems #1–#4; LifecycleHooks structural issue
- [Problem analysis: Cache](../01-research/02-problem-analysis-cache.md) — O(n) degradation evidence, `doCacheArgs` silent ignore
- [Problem analysis: Devtools](../01-research/03-problem-analysis-devtools.md) — double serialization code path, type system locations
- [Problem analysis: Lifecycle & Demos](../01-research/04-problem-analysis-lifecycle-demos.md) — shared resolver Map, per-example `isError` analysis
- [Open Questions](../01-research/05-open-questions.md) — user feedback on all 9 design decisions
