---
title: "Phase 4: ResourceV2 Core + LifecycleHooks"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement `ResourceV2` — the central orchestration class that owns the CacheMap, manages query execution, controls AbortControllers, fires lifecycle hooks, and drives machine transitions. Also implement `LifecycleHooks` for `onCacheEntryAdded` and `onQueryStarted` promise-based lifecycle management. This is the most integration-heavy phase, connecting machines, cache, signals, and async query execution.

## Dependencies

- **Requires**: Phase 2 (Machine classes, Patcher), Phase 3 (CacheMap, CacheEntry)
- **Blocks**: Phase 5 (Agent subscribes to ResourceV2), Phase 6 (createApi creates ResourceV2)

## Execution

Sequential (depends on Phase 2 + 3).

## Tasks

### Task 4.1: Implement LifecycleHooks

- **File**: `src/query-v2/core/LifecycleHooks.ts`
- **Action**: Create
- **Description**: Implement the lifecycle hook manager that creates and manages `PromiseResolver` pairs for `onCacheEntryAdded` and `onQueryStarted` callbacks.
- **Details**:
  - Uses `PromiseResolver` from `@/common/utils/PromiseResolver`.
  - `fireCacheEntryAdded(args, tools)`: Creates `$cacheDataLoaded` + `$cacheEntryRemoved` promise resolvers, calls the user's `onCacheEntryAdded` callback with `(args, { $cacheDataLoaded, $cacheEntryRemoved, getCacheEntry })`. [ref: ../02-design/02-dataflow.md#7, ../02-design/03-model.md#1.13]
  - `fireCacheEntryRemoved(args)`: Resolves `$cacheEntryRemoved`. If `$cacheDataLoaded` hasn't resolved yet, rejects it with "Cache entry removed before data loaded". [ref: ../02-design/02-dataflow.md#7]
  - `fireQueryStarted(args, tools)`: Creates `$queryFulfilled` promise resolver, calls user's `onQueryStarted` callback. [ref: ../02-design/02-dataflow.md#1, ../02-design/03-model.md#1.13]
  - `resolveQueryFulfilled(data)` / `rejectQueryFulfilled(error)`: Resolve/reject `$queryFulfilled`.
  - `resolveCacheDataLoaded(data)`: Resolves `$cacheDataLoaded` on first `MachineSuccess` transition.
- **Complexity**: Medium

### Task 4.2: Implement ResourceV2

- **File**: `src/query-v2/core/ResourceV2.ts`
- **Action**: Create
- **Description**: Implement the `ResourceV2` class that orchestrates the full query lifecycle: cache lookup, entry creation, machine transitions, queryFn execution, AbortController management, lifecycle hook firing, and cache lifetime management.
- **Details**:
  - Constructor receives merged options (API defaults + resource overrides): `queryFn`, `key`, `cacheLifetime`, `serializeArgs`, `compareArg`, `beforeDevtoolsPush`, `keyStrategy`, `keyPrefix`, `onCacheEntryAdded`, `onQueryStarted`, `doCacheArgs`, `maxSnapshotDataAge`.
  - Owns a `CacheMap` instance (created via `CacheMap.create(options)`).
  - **`query(args, doForce?)`**: Main query flow per dataflow §1:
    1. Check `args === SKIP` → return/throw (SKIP not valid for direct query, only for Agent).
    2. `CacheMap.get(args)` → if hit and not force, return existing entry.
    3. If miss or force: create CacheEntry (with `MachineIdle` for miss), store in CacheMap.
    4. Transition: `idle.start(args)` → `MachinePending`, set on CacheEntry.
    5. Fire `onCacheEntryAdded` (if new entry), `onQueryStarted`.
    6. Call `queryFn(args, { abortSignal })` with a new AbortController.
    7. On resolve: `pending.successHappened(data)` → set on CacheEntry. Resolve lifecycle promises.
    8. On reject: `pending.errorHappened(error)` → set on CacheEntry. Reject lifecycle promises.
    9. Wrap transitions in `Batcher.run()` for atomic signal updates (E12). [ref: ../02-design/02-dataflow.md#1]
  - **`query$(args, doForce?)`**: Reactive signal read. Calls `query(args)` internally, returns `entry.machine$.get()` (registers signal dependency). [ref: ../02-design/02-dataflow.md#9]
  - **`entry(args, doInitiate?)`**: Returns existing CacheEntry or null. If `doInitiate=true`, creates and initiates. [ref: ../02-design/03-model.md#1.2]
  - **`entry$(args, doInitiate?)`**: Returns `entry.machine$.get()`.
  - **`invalidate(args)`**: If entry exists with MachineSuccess → `success.invalidate()` → `MachineRefreshing`, set on CacheEntry, re-execute queryFn. On success → new MachineSuccess. On error → back to MachineSuccess with stale data (ADR-2). [ref: ../02-design/02-dataflow.md#3]
  - **`compareArgs(a, b)`**: Delegates to the configured compareArg or serialized key comparison.
  - **AbortController management (ADR-4 Layer 1)**: One active AbortController per args. New query for same args aborts previous. `abort` listeners on the controller auto-abort pending patches.
  - **Query deduplication (R9)**: If a query is in-flight for the same args, return the same Promise (no duplicate fetch).
  - **Cache lifetime management (ADR-7)**: After all subscribers drop (detected via signal subscription tracking or explicit ref-counting) and `cacheLifetime` timer expires, evict the CacheEntry. `setTimeout`/`clearTimeout` based. Fire `onCacheEntryRemoved`. Re-subscription before timer fires cancels eviction. [ref: ../02-design/04-decisions.md#ADR-7]
  - Import `Signal`, `Batcher` from `@/signals/`.
  - Import `PromiseResolver` from `@/common/utils/PromiseResolver`.
- **Complexity**: High

### Task 4.3: ResourceV2 and LifecycleHooks tests

- **Files** (all Create):
  - `src/query-v2/core/ResourceV2.test.ts`
  - `src/query-v2/core/LifecycleHooks.test.ts`
- **Action**: Create
- **Description**: Integration tests for ResourceV2 query orchestration and unit tests for LifecycleHooks.
- **Details**:
  - **ResourceV2 tests** — implement: R1 (cache miss full flow), R2 (cache hit no refetch), R3 (force refetch), R4 (invalidate → MachineRefreshing), R5 (invalidate on idle — no-op), R6 (entry returns null), R7 (entry with doInitiate), R8 (SKIP_TOKEN prevents query), R9 (concurrent query deduplication), R10 (query error → MachineError), R11 (resetAll resets entries — tested via ResourceV2 reset method, full resetAll tested in Phase 6), R12 (AbortController: new query aborts previous). [ref: ../02-design/06-testcases.md#4]
  - **Edge case tests**: E6 (cache lifetime GC eviction — `vi.advanceTimersByTime(cacheLifetime)`), E7 (GC cancelled by re-subscription), E8 (query$ inside Signal.compute registers dependency), E9 (patcher auto-abort on reset), E10 (patcher auto-abort on CacheEntry eviction), E12 (Batcher.run atomicity). [ref: ../02-design/06-testcases.md#11]
  - **LifecycleHooks tests**: L1 (onCacheEntryAdded fires on new entry), L2 (not on cache hit), L3 ($cacheDataLoaded resolves on first MachineSuccess), L4 ($cacheEntryRemoved resolves on eviction), L5 ($cacheDataLoaded rejects if removed before data), L6 (onQueryStarted fires on every fetch), L7 ($queryFulfilled resolves on success), L8 ($queryFulfilled rejects on error), L9 ($queryFulfilled rejects on abort). [ref: ../02-design/06-testcases.md#9]
  - Use controllable queryFn promises (resolve/reject on demand).
  - Use `vi.useFakeTimers()` for cache lifetime tests.
  - Use real `Signal.state`, `Signal.compute`, `Batcher` — no mocking. [ref: ../02-design/06-testcases.md — Mock Strategy]
  - Also test E1 (NO_VALUE !== null/undefined) and E2 (NO_VALUE doesn't leak into public data type) if not already verified in Phase 1 tests.
- **Complexity**: High

## Verification

- [ ] `npm run ts-check` passes
- [ ] All 12 ResourceV2 test cases (R1–R12) pass
- [ ] All 9 LifecycleHooks test cases (L1–L9) pass
- [ ] Edge cases E6, E7, E8, E9, E10, E12 pass
- [ ] Query deduplication: concurrent same-args queries use one queryFn call
- [ ] AbortController: new query for same args aborts previous in-flight request
- [ ] Cache lifetime: entry evicted after timeout with no subscribers, eviction cancelled on re-subscribe
- [ ] Batcher atomicity: subscribers see atomic state transitions (no intermediate states visible)
- [ ] Invalidation: MachineRefreshing errorHappened preserves stale data (ADR-2)
- [ ] Patch auto-abort on reset() and CacheEntry eviction (ADR-4 Layers 2 + 3)
- [ ] No imports from `src/query/`
