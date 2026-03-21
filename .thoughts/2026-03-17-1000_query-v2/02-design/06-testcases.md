---
title: "Test Strategy: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
---

# Test Strategy: Query v2 Module

## Approach

### Testing Pyramid

**Unit tests** (~70% of test volume): Each component in isolation — machine classes, CacheMap, Patcher, SKIP_TOKEN, NO_VALUE, snapshot serialization, lifecycle hooks promise management. These are pure or near-pure and can be tested without reactive infrastructure.

**Integration tests** (~25%): Connected systems — `createApi` → `createResource` → `ResourceV2` query flow → `CacheEntry` → Machine transitions → `CacheMap` storage. Also: Agent stale-while-revalidate with real Signal.compute/Signal.state, `onCacheEntryAdded`/`onQueryStarted` full lifecycle with real `PromiseResolver`, plugin augmentation at runtime.

**React hooks tests** (~5%): `useResourceV2Agent` and `useResourceV2Ref` via `@testing-library/react` `renderHook` + `act`, following the existing patterns in `@/query/react/useResourceAgent.test.ts` and `@/signals/react/useSignal.test.ts`. Uses `vi.useFakeTimers()`, `flushMicrotasks()`, and controllable queryFn (resolve/reject on demand).

### Mock Strategy

**Mock these:**
- `queryFn` — always use controllable promises (`new Promise((resolve, reject) => { calls.push({ resolve, reject }) })`) per the existing pattern in `@/query/react/useResourceAgent.test.ts`.
- `vi.useFakeTimers()` — for `cacheLifetime` / `gcTime` / `maxSnapshotDataAge` / timeout-based tests.
- `Immer` — do NOT mock. Patcher tests must use real Immer (`produceWithPatches`, `applyPatches`) to verify actual patch mechanics.
- `AbortController` — use real implementation (available in jsdom).

**Real implementations:**
- `Signal.state`, `Signal.compute`, `Effect`, `Batcher` — use real signals for integration tests. Machine transitions and CacheEntry reactivity depend on real signal behavior.
- `shallowEqual`, `deepEqual`, `PromiseResolver` — use real `@/common/` utilities.
- `Devtools` — mock `Devtools.createState()` to capture pushed values without needing Redux DevTools extension.

### Coverage Targets

`vitest.config.ts` coverage must be extended to include `src/query-v2/**`:

| Metric | Target |
|--------|--------|
| Statements | 85% |
| Branches | 85% |
| Functions | 90% |
| Lines | 85% |

Priority: Machine transitions (100% branch coverage) > Patcher algorithm (100% branch coverage) > CacheMap > ResourceV2 query orchestration > Agent > SSR > Plugin > React hooks.

### Test File Organization

Tests are colocated with source files:

```
src/query-v2/
├── core/
│   ├── CacheMap.test.ts
│   ├── CacheEntry.test.ts
│   ├── ResourceV2.test.ts
│   ├── ResourceV2Agent.test.ts
│   ├── LifecycleHooks.test.ts
│   └── machines/
│       ├── MachineIdle.test.ts
│       ├── MachinePending.test.ts
│       ├── MachineSuccess.test.ts
│       ├── MachineError.test.ts
│       ├── MachineRefreshing.test.ts
│       ├── MachineWithData.test.ts
│       └── Patcher.test.ts
├── api/
│   └── createApi.test.ts
├── plugins/
│   └── ReactHooksPlugin.test.ts
├── snapshot/
│   └── Snapshot.test.ts
└── __tests__/
    └── integration/
        ├── query-flow.test.ts
        ├── ssr-hydration.test.ts
        └── plugin-augmentation.test.ts
```

---

## Test Cases

### 1. Machine Transitions

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| M1 | Unit | MachineIdle → MachinePending via `start(args)` | `MachineIdle.create().start({ id: 1 })` | `MachinePending` with `state.status === 'pending'`, `state.args === { id: 1 }` | High |
| M2 | Unit | MachinePending → MachineSuccess via `successHappened(data)` | `pending.successHappened({ name: 'Alice' })` | `MachineSuccess` with `state.data === { name: 'Alice' }`, `state.updatedAt` set | High |
| M3 | Unit | MachinePending → MachineError via `errorHappened(error)` | `pending.errorHappened(new Error('404'))` | `MachineError` with `state.error.message === '404'` | High |
| M4 | Unit | MachineSuccess → MachineRefreshing via `invalidate()` | `success.invalidate()` | `MachineRefreshing` with `state.data` preserved (stale), `state.status === 'refreshing'` | High |
| M5 | Unit | MachineSuccess → MachinePending via `start(newArgs)` | `success.start({ id: 2 })` | `MachinePending` with `state.args === { id: 2 }` | High |
| M6 | Unit | MachineSuccess → MachineIdle via `reset()` | `success.reset()` | `MachineIdle` with `state.status === 'idle'`, all fields null | High |
| M7 | Unit | MachineRefreshing → MachineSuccess on success | `refreshing.successHappened(freshData)` | `MachineSuccess` with `state.data === freshData`, `updatedAt` updated | High |
| M8 | Unit | MachineRefreshing → MachineSuccess on error (stale data preserved) | `refreshing.errorHappened(new Error('500'))` | `MachineSuccess` with `state.data` === stale data, `updatedAt` unchanged | High |
| M9 | Unit | MachineRefreshing → MachineIdle via `reset()` | `refreshing.reset()` | `MachineIdle` | Medium |
| M10 | Unit | MachineError → MachinePending via `retry()` | `error.retry()` | `MachinePending` with same args as error | High |
| M11 | Unit | MachineError → MachinePending via `start(args)` | `error.start({ id: 3 })` | `MachinePending` with new args | Medium |
| M12 | Unit | MachineError → MachineIdle via `reset()` | `error.reset()` | `MachineIdle` | Medium |
| M13 | Unit | MachineIdle.reset() returns same idle state (identity) | `idle.reset()` | `MachineIdle` (same or equivalent instance) | Low |
| M14 | Unit | Invalid transition: MachineIdle has no `successHappened` | Attempt to call `idle.successHappened(data)` | TypeScript compile error (method doesn't exist) — verified in type test | High |
| M15 | Unit | Machine.fromSnapshot restores MachineSuccess | `Machine.fromSnapshot({ status: 'success', data: {...}, args: 42, updatedAt: 123 })` | `MachineSuccess` instance with correct data | High |
| M16 | Unit | Machine.fromSnapshot handles unknown status | `Machine.fromSnapshot({ status: 'unknown' })` | Error thrown (or fallback to MachineIdle) | Medium |
| M17 | Unit | Machine `.state` property returns plain JSON-serializable object | `machineSuccess.state` | Object with `{ status, data, args, error, updatedAt }`, no class instances, JSON.stringify-safe | High |

### 2. CacheMap

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| C1 | Unit | Serialize strategy: `set` + `get` with same args | `set({ id: 1 }, entry)`, `get({ id: 1 })` | Returns same `entry` | High |
| C2 | Unit | Serialize strategy: `get` with different key order | `set({ a: 1, b: 2 }, entry)`, `get({ b: 2, a: 1 })` | Returns same `entry` (stableStringify sorts keys) | High |
| C3 | Unit | Serialize strategy: `has` returns false for missing args | `has({ id: 999 })` | `false` | Medium |
| C4 | Unit | Serialize strategy: `delete` removes entry | `set(args, e)`, `delete(args)`, `get(args)` | `undefined` | Medium |
| C5 | Unit | Compare strategy: `set` + `get` with shallowEqual | `set({ id: 1 }, entry)`, `get({ id: 1 })` (new object) | Returns same `entry` (shallowEqual match) | High |
| C6 | Unit | Compare strategy: `get` misses with deep-different args | `set({ id: 1 }, entry)`, `get({ id: 2 })` | `undefined` | Medium |
| C7 | Unit | Compare strategy: iterates correctly via `values()` | `set(a, e1)`, `set(b, e2)`, `[...values()]` | `[e1, e2]` | Medium |
| C8 | Unit | Serialize strategy: `clear()` empties cache | `set(a, e)`, `clear()`, `size` | `size === 0` | Medium |
| C9 | Unit | Serialize strategy: `entries()` returns key-entry pairs | `set(a, e1)`, `[...entries()]` | `[['serialized_a', e1]]` | Low |
| C10 | Unit | `doCacheArgs: true` memoizes serialization (WeakMap) | Two calls to `get(sameObjectRef)` with spy on serializeArgs | `serializeArgs` called only once | Medium |
| C11 | Unit | `doCacheArgs: true` with primitive args — no caching | `get(42)` twice | `serializeArgs` called twice (primitives can't be WeakMap keys) | Low |

### 3. Patcher

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| P1 | Unit | `createPatch` produces patch and inverse | `Patcher.createPatch(d => { d.name = 'new' }, { name: 'old' })` | `{ patches: [...], inversePatches: [...], status: 'pending' }` | High |
| P2 | Unit | `resolvePatches` — single committed patch | `resolvePatches(original, [committedPatch])` | Data with committed changes applied, patch removed from queue | High |
| P3 | Unit | `resolvePatches` — single pending patch | `resolvePatches(original, [pendingPatch])` | Data with pending changes applied, patch remains in queue | High |
| P4 | Unit | `resolvePatches` — committed then pending | `resolvePatches(orig, [committed, pending])` | Committed applied and removed; pending applied and kept | High |
| P5 | Unit | `resolvePatches` — aborted patch (no pending before) | `resolvePatches(orig, [aborted])` | Aborted patch removed from queue, data = original | High |
| P6 | Unit | `resolvePatches` — pending → aborted | `resolvePatches(orig, [pending, aborted])` | Pending applied and kept; aborted stays in queue (after pending) | High |
| P7 | Unit | `resolvePatches` — committed after pending stays in queue | `resolvePatches(orig, [pending, committed])` | Both applied and both stay in queue | Medium |
| P8 | Unit | `finishPatch` commit — clears originalData when no pending remain | `finishPatch(orig, [onlyPatch], 'commit', onlyPatch)` | `{ originalData: NO_VALUE, patches: null }` | High |
| P9 | Unit | `finishPatch` abort — reverts to original | `finishPatch(orig, [onlyPatch], 'abort', onlyPatch)` | Data reverted; `originalData: NO_VALUE`, `patches: null` | High |
| P10 | Unit | `finishPatch` commit — keeps originalData when pending patches remain | `finishPatch(orig, [patchA_pending, patchB_pending], 'commit', patchA)` | `{ originalData: orig, patches: [patchB] }`, patchA removed | High |
| P11 | Unit | Multiple patches: create, add, commit first, abort second | Sequence: create 2 patches, commit first, abort second | Final data equals original (both resolved, queue empty) | High |
| P12 | Unit | `abortAllPendingPatches` cleans up all pending | Machine with 3 pending patches → `abortAllPendingPatches()` | All patches aborted, data reverted to original, `originalData = NO_VALUE` | High |

### 4. ResourceV2

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| R1 | Integration | `query(args)` on cache miss — full flow | `resource.query({ id: 1 })`, resolve queryFn | CacheEntry created, Machine transitions Idle → Pending → Success | High |
| R2 | Integration | `query(args)` on cache hit — no refetch | `query(1)` × 2 (first resolves) | Second returns same CacheEntry, `queryFn` called once | High |
| R3 | Integration | `query(args, force=true)` re-fetches | `query(1)` (resolved), then `query(1, true)` | `queryFn` called twice, entry refreshed | High |
| R4 | Integration | `invalidate(args)` triggers MachineRefreshing | `query(1)` resolves, then `invalidate(1)` | Machine: Success → Refreshing, stale data available | High |
| R5 | Integration | `invalidate(args)` on Idle — no-op | `invalidate(1)` on unqueried resource | No state change, no fetch | Medium |
| R6 | Unit | `entry(args)` returns null when no cache entry | `entry({ id: 1 })` without prior query | `null` | Medium |
| R7 | Unit | `entry(args, true)` creates entry and initiates | `entry({ id: 1 }, true)` | CacheEntry created, query initiated | Medium |
| R8 | Integration | SKIP_TOKEN prevents query execution | `resource.query$(SKIP)` inside Signal.compute | No queryFn called, returns idle/previous state | High |
| R9 | Integration | Concurrent `query(same args)` deduplicates | Two `query(1)` before first resolves | `queryFn` called once, both get same Promise/CacheEntry | High |
| R10 | Integration | Query error → MachineError | `query(1)`, reject queryFn | Machine: Pending → Error with error | High |
| R11 | Integration | `resetCache()` via `api.resetAll()` resets all entries | Query 2 resources, then `api.resetAll()` | All machines → Idle, caches cleared, in-flight aborted | High |
| R12 | Integration | AbortController: new query aborts previous for same entry | `query(1)`, immediately `invalidate(1)` while pending | First fetch aborted via signal, second fetch starts | Medium |

### 5. Agent (ResourceV2Agent)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| A1 | Integration | `start(args)` triggers query, `state$` reactive | `agent.start(1)`, resolve queryFn | `state$()` returns `{ status: 'success', data, isLoading: false }` | High |
| A2 | Integration | SWR: `start(newArgs)` shows previous data while loading | `start(1)` (resolves), `start(2)` (pending) | `state$()` returns `{ data: prevData, isLoading: true, isInitialLoading: false }` | High |
| A3 | Integration | `isInitialLoading` — true only on first load (no previous) | `start(1)` before resolve | `state$().isInitialLoading === true` | High |
| A4 | Integration | `isInitialLoading` — false when switching args | `start(1)` resolved, `start(2)` pending | `state$().isInitialLoading === false` | High |
| A5 | Integration | `start(SKIP)` — no fetch, state preserved | `start(1)` resolved, `start(SKIP)` | `state$()` keeps previous success data, no new fetch | High |
| A6 | Integration | Rapid arg changes: latest wins | `start(1)`, `start(2)`, `start(3)` quickly | Only args=3 fetch completes, previous aborted | High |
| A7 | Integration | `refreshError` set when refresh fails | `start(1)` resolved, `invalidate(1)`, queryFn rejects | `state$().refreshError` is the error, `data` preserved | Medium |
| A8 | Integration | `previous` cleared after current resolves | `start(1)` resolved, `start(2)` resolved | `previous` is null (no stale data held) | Medium |

### 6. createApi

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| API1 | Unit | Creates API with default options | `createApi({})` | API instance with `createResource`, `resetAll`, `getSnapshot` | High |
| API2 | Unit | `createResource` enforces unique `key` | Two resources with same `key` | Error thrown on second registration | High |
| API3 | Integration | `resetAll()` resets all registered resources | Create 2 resources, query both, `resetAll()` | All caches cleared, machines → Idle | High |
| API4 | Unit | `keyPrefix` prepended to devtools keys | `createApi({ keyPrefix: 'main' })` | Devtools state names include prefix | Low |
| API5 | Unit | Default `keyStrategy` is `'serialize'` | `createApi({})` | Resources use SerializedCacheMap | Medium |
| API6 | Unit | `keyStrategy: 'compare'` selects CompareCacheMap | `createApi({ keyStrategy: 'compare' })` | Resources use CompareCacheMap | Medium |
| API7 | Unit | Per-resource options override API defaults | `createApi({ cacheLifetime: 100 })`, `createResource({ cacheLifetime: 50 })` | Resource uses 50 | Medium |

### 7. SSR (Snapshot)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| S1 | Integration | `getSnapshot()` captures only MachineSuccess entries | 3 entries: Success, Pending, Error | Snapshot contains only the Success entry | High |
| S2 | Integration | `initialSnapshot` hydrates entries to MachineSuccess | Valid snapshot with 2 entries | Both entries available as MachineSuccess, no fetch | High |
| S3 | Integration | `maxSnapshotDataAge` triggers invalidation for stale entries | Entry `updatedAt` > `maxSnapshotDataAge` ago | MachineSuccess → MachineRefreshing after hydration | High |
| S4 | Unit | `version` mismatch — snapshot ignored | `initialSnapshot.version !== CURRENT_VERSION` | Hydration skipped, no entries populated | High |
| S5 | Unit | `keyPrefix` mismatch — snapshot ignored | Snapshot `keyPrefix: 'other'`, API `keyPrefix: 'main'` | Hydration silently skipped | Medium |
| S6 | Unit | `getSnapshot()` throws for `compare` strategy | API with `keyStrategy: 'compare'` calling `getSnapshot()` | Error thrown with descriptive message | Medium |
| S7 | Unit | Snapshot round-trip: `getSnapshot()` → `initialSnapshot` | Dehydrate then rehydrate | Data matches, machines are valid `MachineSuccess` instances | High |
| S8 | Unit | `Machine.fromSnapshot()` reconstructs correct class | `{ status: 'success', data: 'x', args: 1, updatedAt: 100 }` | `instanceof MachineSuccess === true` | High |

### 8. Plugin System

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| PL1 | Integration | ReactHooksPlugin adds `useResourceV2Agent` to resource | `createApi({ plugins: [new ReactHooksPlugin()] }).createResource(...)` | `resource.useResourceV2Agent` is a function | High |
| PL2 | Integration | Without ReactHooksPlugin, hooks not present | `createApi({}).createResource(...)` | `resource.useResourceV2Agent` is `undefined` | High |
| PL3 | Unit | `plugin.install()` called once during `createApi` | `createApi({ plugins: [plugin] })` with spy on `install` | `install` called once with `IPluginContext` | Medium |
| PL4 | Unit | `plugin.augmentResource()` called per `createResource` | `api.createResource()` × 3 | `augmentResource` called 3 times | Medium |
| PL5 | Integration | Multiple plugins compose contributions | `createApi({ plugins: [pluginA, pluginB] })`, createResource | Resource has methods from both plugins | Medium |
| PL6 | Unit | Type test: plugin contributions appear in return type | TypeScript `expectType` or `satisfies` | `IResourceV2 & IReactHooksPluginContributions` | High |

### 9. Lifecycle Hooks

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| L1 | Integration | `onCacheEntryAdded` fires on new cache entry | `query(1)` first time | Callback invoked with `(args, tools)` | High |
| L2 | Integration | `onCacheEntryAdded` does NOT fire on cache hit | `query(1)` twice | Callback invoked once | High |
| L3 | Integration | `$cacheDataLoaded` resolves on first MachineSuccess | Query → resolve queryFn | `$cacheDataLoaded` resolves with data | High |
| L4 | Integration | `$cacheEntryRemoved` resolves on eviction | Query, unsubscribe, wait cacheLifetime | `$cacheEntryRemoved` resolves | High |
| L5 | Integration | `$cacheDataLoaded` rejects if entry removed before data | Create entry, remove before resolve | `$cacheDataLoaded` rejects | High |
| L6 | Integration | `onQueryStarted` fires on every fetch (including refetch) | Query, then invalidate | `onQueryStarted` called twice | High |
| L7 | Integration | `$queryFulfilled` resolves with `{ data }` on success | Query → resolve queryFn | `$queryFulfilled` resolves with `{ data, isError: false }` | High |
| L8 | Integration | `$queryFulfilled` rejects on error | Query → reject queryFn | `$queryFulfilled` rejects with error | High |
| L9 | Integration | `$queryFulfilled` rejects on abort | Query, then abort | `$queryFulfilled` rejects | Medium |

### 10. Devtools

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| D1 | Unit | Default: `machine.state` pushed to devtools via Signal.state() `beforeDevtoolsPush` | MachineSuccess transition on CacheEntry's Signal.state | Devtools receives plain `{ status: 'success', data, ... }` | Medium |
| D2 | Unit | `beforeDevtoolsPush` intercepts and transforms | Custom `beforeDevtoolsPush` that redacts `data.password` | Devtools receives object without `password` field | Medium |
| D3 | Unit | `beforeDevtoolsPush` on Signal.state() can suppress push | Resource created with `beforeDevtoolsPush` callback that does NOT call `push()` | Nothing pushed to devtools for that CacheEntry | Low |
| D4 | Unit | Machine state is JSON-serializable for devtools | All 5 machine types `.state` | `JSON.stringify(state)` succeeds, no circular refs | Medium |

### 11. Edge Cases

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| E1 | Unit | NO_VALUE is not equal to null, undefined, or any value | `NO_VALUE === null`, `NO_VALUE === undefined` | Both `false` | High |
| E2 | Unit | NO_VALUE does not leak into public `data` type | CacheEntry with MachinePending | `data` typed as `TData | null`, not `TData | typeof NO_VALUE` | High |
| E3 | Integration | Empty cache: `values()` returns empty iterable | New CacheMap `.values()` | Empty iterable | Low |
| E4 | Integration | Concurrent invalidations on same args | `invalidate(1)` × 2 while first refresh is in-flight | First refresh aborted, second takes over | Medium |
| E5 | Integration | Rapid re-queries: args change 5 times quickly | `start(1)`, `start(2)`, `start(3)`, `start(4)`, `start(5)` via agent | Only `queryFn(5)` completes, others aborted | High |
| E6 | Integration | Cache lifetime GC: entry evicted after timeout | Query, unsubscribe, advance timers by cacheLifetime | CacheEntry evicted, `get(args)` returns undefined | High |
| E7 | Integration | Cache lifetime GC cancelled by re-subscription | Query, unsubscribe, advance partial, re-subscribe | Entry NOT evicted | Medium |
| E8 | Unit | `query$(args)` inside Signal.compute registers dependency | `Signal.compute(() => resource.query$(args))` | Compute re-evaluates when machine changes | High |
| E9 | Integration | Patcher: hanging patch auto-aborted on `reset()` | Create patch (pending), then `api.resetAll()` | Pending patch aborted, machine → Idle, originalData cleared | High |
| E10 | Integration | Patcher: hanging patch auto-aborted on CacheEntry eviction | Create patch (pending), wait for eviction | Pending patch aborted during cleanup | Medium |
| E11 | Integration | `MachineRefreshing.successHappened()` aborts pending patches | Create patch on Success, invalidate, refresh succeeds | Pending patches from pre-refresh aborted, fresh data used | Medium |
| E12 | Integration | Batcher.run atomicity: multiple signal updates in one batch | Transition Machine + fire lifecycle hooks inside Batcher.run | Subscribers see atomic update (no intermediate states) | High |

## Performance Criteria

| Metric | Threshold | Context |
|--------|-----------|---------|
| CacheMap `serialize` lookup | <0.1ms for 1000 entries | O(1) via native Map [ref: ../01-research/03-external-research.md#5.2] |
| CacheMap `compare` lookup | <5ms for 50 entries | O(n) linear scan — acceptable for intended scale [ref: ../01-research/03-external-research.md#Performance] |
| Patcher `resolvePatches` | <1ms for 10 patches | Immer apply is fast; queue iteration is O(n) |
| Snapshot `getSnapshot()` | <10ms for 100 cache entries | Single iteration over entries, JSON-safe state projection |
| Snapshot `initialSnapshot` hydration | <20ms for 100 entries | Factory construction + optional invalidation queue |

Performance tests are NOT required in the test suite (no benchmarking in CI). These thresholds serve as design sanity checks — if integration tests take significantly longer, investigate.

## Correctness Verification

End-to-end validation approach:

1. **Full query lifecycle test**: `createApi` → `createResource` → `query(args)` → resolve → verify `MachineSuccess` data → `invalidate(args)` → verify `MachineRefreshing` with stale data → resolve refresh → verify `MachineSuccess` with fresh data. This single test validates the core data flow. [ref: ./02-dataflow.md#1, ./02-dataflow.md#3]

2. **SSR round-trip test**: Server-side `createApi` → `query(args)` → `getSnapshot()` → JSON.stringify → JSON.parse → client-side `createApi({ initialSnapshot })` → verify data available immediately → verify stale entries invalidated → verify `Machine.fromSnapshot()` produces correct instances. [ref: ./02-dataflow.md#5]

3. **Optimistic update with rollback test**: `query(args)` → `createPatch(draft => ...)` → verify UI sees optimistic data → abort patch → verify data reverted to original. Then same flow but commit → verify data persists. [ref: ./02-dataflow.md#4]

4. **Plugin type-level verification**: A TypeScript compilation test (or `vitest` type test via `expectTypeOf`) that creates an API with `ReactHooksPlugin` and verifies `useResourceV2Agent` exists on the resource type, AND that creating without the plugin does NOT have the method. [ref: ./04-decisions.md#ADR-1]

5. **Machine transition completeness**: Every valid transition in the state diagram [ref: ./01-architecture.md#5] is exercised. Every invalid transition (method not on class) is verified via TypeScript type test.
