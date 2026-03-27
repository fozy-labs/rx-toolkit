---
title: "Test Strategy & Test Cases — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-qa-designer
---

# Test Strategy & Test Cases — query-v2

## Approach

### Testing Pyramid

```
          ┌──────────────┐
          │  Integration  │  ~15% — full pipelines across layers
          │  (cross-layer)│
          ├──────────────┤
          │  Component    │  ~15% — React hooks via renderHook/act
          │  (react)      │
          ├──────────────┤
          │              │
          │   Unit        │  ~70% — per-module, per-class isolation
          │              │
          └──────────────┘
```

- **Unit tests**: Each module tested in isolation. State machines, Patcher, CacheEntry, CacheMap, LifecycleHooks, ResourceV2, ResourceV2Agent — mocked boundaries where needed.
- **Component tests (React)**: Hooks tested via `@testing-library/react` `renderHook()`, wrapped in `act()`. Verify subscription lifecycle, re-render triggers, cleanup on unmount.
- **Integration tests**: Full fetch→cache→snapshot→React render pipeline. Cross-resource invalidation. Plugin + cache + snapshot interaction. GC under real component lifecycle.

### Testing Tools

- **Vitest** — already configured in `vitest.config.ts` with `@` alias, coverage scoped to `src/query-v2/**`
- **@testing-library/react** — `renderHook()`, `act()` for hook component tests
- **vi.fn() / vi.spyOn()** — mocking queryFn, plugin hooks, timers
- **vi.useFakeTimers() / vi.advanceTimersByTime()** — GC lifetime testing, `maxSnapshotDataAge` expiry

### Key Testing Patterns

[ref: ../01-research/02-codebase-query-v1.md#6.3 — v1 controllable promise pattern]
[ref: ../01-research/04-open-questions.md#q15 — testing approach question]

#### Controllable-Promise Pattern

Every test that involves `queryFn` must use externally resolvable promises — no real network, no artificial delays:

```typescript
function createControllableResource<TArgs = { id: number }, TData = { name: string }>() {
    const calls: Array<{ resolve: (v: TData) => void; reject: (e: unknown) => void }> = [];
    const queryFn = vi.fn(
        (_args: TArgs, _tools?: { abortSignal: AbortSignal }) =>
            new Promise<TData>((resolve, reject) => {
                calls.push({ resolve, reject });
            }),
    );
    const resource = createResourceV2<TArgs, TData>({
        queryFn,
        cacheLifetime: false,     // disable GC interference
        // devtoolsName: false,   // disable DevTools hooks
    });
    return { resource, queryFn, calls };
}
```

#### flushMicrotasks()

After `calls[n].resolve(data)` or `calls[n].reject(error)`, call `await flushMicrotasks()` to propagate through the signal/batcher chain. Existing helper: `@/__tests__/helpers/async-helpers.ts`.

#### `cacheLifetime: false`

All unit tests must disable GC timer to eliminate TTL interference. Timer-based GC behavior tested in dedicated GC test cases using `vi.useFakeTimers()`.

#### Test Isolation

- Each test gets independent resource/cache instances — no shared state between tests.
- Each test creates its own `createApi()` / `createResourceV2()` instances — query-v2 has no global singletons like `SharedOptions`. Global `beforeEach` in `@/__tests__/setup.ts` remains for signals-level cleanup.
- Fake timers scoped per `describe` block where GC/timer testing is needed.

### State Machine Testing Strategy

Machines are immutable class instances — test each transition as:
1. Create initial machine state
2. Call transition method → get new instance
3. Assert new `.status`, `.data`, `.error`, `.args`, `.updatedAt`, `.patches`, `.originalData`
4. Assert original instance is **not** mutated (immutability)
5. Assert invalid transitions are type-level impossible (compile-time) or produce expected behavior

### Snapshot Testing Strategy

- Verify `getSnapshot()` produces correct `TApiSnapshot` structure from populated resources
- Verify `hydrateSnapshot()` reconstructs machine instances via `Machine.fromSnapshot()`
- Verify round-trip: capture → serialize → deserialize → hydrate → verify data matches
- Verify immutability: snapshot data is a new copy, not a reference to cache data

### Plugin Testing Strategy

- Mock plugin hooks (`install`, `augmentResource`)
- Verify invocation order matches registration order
- Verify `Object.assign` merge of contributions
- Verify key collision detection throws
- Verify PluginAugmentations types compile correctly (type-level tests)

### React Hook Testing Strategy

- `renderHook(() => useResourceV2Agent(resource, args))` — verify initial state, data after resolve, cleanup after unmount
- `act()` boundaries around all state-changing operations
- `rerender` with new args → verify SWR behavior
- Unmount → verify agent cleanup, no memory leaks, no console warnings

---

## Test Cases — lib Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| L01 | Unit | `SKIP` is a unique symbol | `typeof SKIP` | `"symbol"` | P0 |
| L02 | Unit | `stableStringify` — plain object with sorted keys | `{ b: 2, a: 1 }` | `'{"a":1,"b":2}'` | P0 |
| L03 | Unit | `stableStringify` — nested objects | `{ b: { d: 4, c: 3 }, a: 1 }` | `'{"a":1,"b":{"c":3,"d":4}}'` | P1 |
| L04 | Unit | `stableStringify` — arrays preserved in order | `[3, 1, 2]` | `'[3,1,2]'` | P1 |
| L05 | Unit | `stableStringify` — null and undefined handling | `{ a: null, b: undefined }` | `'{"a":null}'` (undefined omitted per JSON spec) | P1 |
| L06 | Unit | `stableStringify` — primitives (string, number, boolean) | `42`, `"hello"`, `true` | `'42'`, `'"hello"'`, `'true'` | P1 |
| L07 | Unit | `stableStringify` — empty object and empty array | `{}`, `[]` | `'{}'`, `'[]'` | P2 |
| L08 | Unit | `stableStringify` — determinism: same output for same input across calls | Two calls with `{ b: 2, a: 1 }` | Same string both times | P1 |
| L09 | Edge | `stableStringify` — Date/Map/Set fallback (no crash) | `new Date()` | Does not throw; produces some string output | P2 |

---

## Test Cases — core Layer: State Machines

### MachineIdle

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM01 | Unit | `Machine.idle()` creates MachineIdle | `Machine.idle()` | `instanceof MachineIdle`, status="idle", args=null, data=null, error=null | P0 |
| SM02 | Unit | `idle.start(args)` → MachinePending | `Machine.idle().start({ id: 1 })` | `instanceof MachinePending`, status="pending", args={id:1}, data=null | P0 |
| SM03 | Unit | `idle.reset()` → MachineIdle | `Machine.idle().reset()` | `instanceof MachineIdle` | P1 |
| SM04 | Unit | Idle is immutable — start returns new instance | `const a = idle; const b = a.start(x)` | `a !== b`, `a.status === "idle"` | P1 |

### MachinePending

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM05 | Unit | `pending.successHappened(data)` → MachineSuccess | `pending.successHappened({ name: "test" })` | `instanceof MachineSuccess`, status="success", data={name:"test"}, updatedAt is number | P0 |
| SM06 | Unit | `pending.errorHappened(error)` → MachineError | `pending.errorHappened(new Error("fail"))` | `instanceof MachineError`, status="error", error is Error, data=null | P0 |
| SM07 | Unit | `pending.reset()` → MachineIdle | `pending.reset()` | `instanceof MachineIdle` | P1 |
| SM08 | Unit | Pending preserves args from start | `idle.start({ id: 5 })` | `pending.args === { id: 5 }` (via `.state.args`) | P1 |
| SM09 | Unit | Pending has no patchState | `idle.start(args)` | `pending` state has no `patchState` field | P1 |

### MachineSuccess

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM10 | Unit | `success.invalidate()` → MachineRefreshing | `success.invalidate()` | `instanceof MachineRefreshing`, status="refreshing", data preserved | P0 |
| SM11 | Unit | `success.start(newArgs)` → MachinePending | `success.start({ id: 2 })` | `instanceof MachinePending`, args={id:2} | P0 |
| SM12 | Unit | `success.reset()` → MachineIdle (aborts patches) | `successWithPatches.reset()` | `instanceof MachineIdle`, patches aborted | P0 |
| SM13 | Unit | Success has updatedAt timestamp | `pending.successHappened(data)` | `success.updatedAt` is a number > 0 | P1 |
| SM14 | Unit | Success carries data and patchState=null initially | `pending.successHappened(data)` | `success.data === data, success.patchState === null` | P1 |
| SM15 | Unit | Success .state serialization contains all fields | `success.state` | `{ status, args, data, error: null, updatedAt, patchState }` | P1 |

### MachineError

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM16 | Unit | `error.retry()` → MachinePending | `error.retry()` | `instanceof MachinePending`, same args as error | P0 |
| SM17 | Unit | `error.start(args)` → MachinePending | `error.start({ id: 3 })` | `instanceof MachinePending`, args={id:3} | P1 |
| SM18 | Unit | `error.reset()` → MachineIdle | `error.reset()` | `instanceof MachineIdle` | P1 |
| SM19 | Unit | Error preserves error value | `pending.errorHappened(err)` | `error.error === err` | P1 |

### MachineRefreshing

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM20 | Unit | `refreshing.successHappened(freshData)` → MachineSuccess | `refreshing.successHappened(newData)` | `instanceof MachineSuccess`, data=newData | P0 |
| SM21 | Unit | `refreshing.errorHappened(err)` → MachineSuccess (ADR-2: stale preserved) | `refreshing.errorHappened(err)` | `instanceof MachineSuccess`, data=staleData (not error state) | P0 |
| SM22 | Unit | `refreshing.reset()` → MachineIdle | `refreshing.reset()` | `instanceof MachineIdle` | P1 |
| SM23 | Unit | Refreshing preserves stale data during background refetch | `success.invalidate()` | `refreshing.data === success.data` | P1 |
| SM24 | Unit | Refreshing preserves patches from success state | `successWithPatches.invalidate()` | `refreshing.patchState.patches` same as success | P1 |

### Machine Static Factory

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM25 | Unit | `Machine.fromSnapshot(idleState)` → MachineIdle | `{ status: "idle", ... }` | `instanceof MachineIdle` | P0 |
| SM26 | Unit | `Machine.fromSnapshot(successState)` → MachineSuccess with data | `{ status: "success", data: {...}, ... }` | `instanceof MachineSuccess`, data matches | P0 |
| SM27 | Unit | `Machine.fromSnapshot(pendingState)` → MachinePending | `{ status: "pending", ... }` | `instanceof MachinePending` | P1 |
| SM28 | Unit | `Machine.fromSnapshot(errorState)` → MachineError | `{ status: "error", error: e, ... }` | `instanceof MachineError`, error matches | P1 |
| SM29 | Unit | `Machine.fromSnapshot(refreshingState)` → MachineRefreshing | `{ status: "refreshing", data: {...}, ... }` | `instanceof MachineRefreshing`, data matches | P1 |
| SM30 | Unit | Round-trip: instance → `.state` → `fromSnapshot()` → identical logic | `Machine.idle() → .state → fromSnapshot()` | Equivalent machine | P1 |

### MachineWithData (abstract, tested via Success/Refreshing)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM31 | Unit | `createPatch(patchFn)` returns `{ machine, patchHandle }` | `success.createPatch(d => { d.x = 1 })` | New MachineSuccess with patched data; patchHandle has `commit()`, `abort()` | P0 |
| SM32 | Unit | `createPatch` returns null if no data (edge: called on wrong state) | N/A — only possible on MachineWithData | Not applicable (type-level guard) | P2 |
| SM33 | Unit | `finishPatch("committed", patch)` applies patch permanently | `machine.finishPatch("committed", patchRef)` | Data includes patch; patch removed from queue | P1 |
| SM34 | Unit | `finishPatch("aborted", patch)` rolls back patch | `machine.finishPatch("aborted", patchRef)` | Data reverts; inverse patches applied | P1 |
| SM35 | Unit | `abortAllPendingPatches()` reverts all pending patches | Machine with 3 pending patches | All aborted; data = originalData | P1 |
| SM36 | Unit | Immutability: createPatch returns new instance | `const a = success; const { machine: b } = a.createPatch(...)` | `a !== b`, `a.data !== b.data` | P1 |

---

## Test Cases — core Layer: Patcher

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| PA01 | Unit | `Patcher.createPatch(fn, data)` creates pending patch with patches/inversePatches | `(d => { d.x = 1 }, { x: 0 })` | `{ patch: { patches, inversePatches, status: "pending" }, data: { x: 1 } }` | P0 |
| PA02 | Unit | `resolvePatches` — single committed patch baked into base | `originalData, [committedPatch]` | `{ data: patchedData, patchState: null }` (all committed → no active patches) | P0 |
| PA03 | Unit | `resolvePatches` — single pending patch applied, kept in queue | `originalData, [pendingPatch]` | `{ data: patchedData, patchState: { originalData, patches: [pendingPatch], isConsistencyViolation: false } }` | P0 |
| PA04 | Unit | `resolvePatches` — aborted patch (no pending after) dropped silently | `originalData, [abortedPatch]` | `{ data: originalData, patchState: null }` | P1 |
| PA05 | Unit | `resolvePatches` — committed before pending: committed consumed, pending kept | `orig, [committed, pending]` | `{ data: both applied, patchState: { originalData: commitApplied, patches: [pending], isConsistencyViolation: false } }` | P1 |
| PA06 | Unit | `resolvePatches` — aborted after pending: inverse applied, removed | `orig, [pending, aborted]` | Data reflects pending only; aborted inversed; patchState reflects remaining | P1 |
| PA07 | Unit | `finishPatch` — commit transitions patch from pending→committed | `orig, patches, "committed", targetPatch` | Target patch status="committed" in result patchState | P1 |
| PA08 | Unit | `finishPatch` — abort transitions patch from pending→aborted | `orig, patches, "aborted", targetPatch` | Target patch status="aborted", inverse applied | P1 |
| PA09 | Unit | `abortAllPending` — marks all pending as aborted, resolves | `orig, [pending1, pending2]` | All patches aborted, data = originalData, patchState = null | P1 |
| PA10 | Unit | Consistency violation: out-of-order abort on multi-patch | `orig, [patch1, patch2]` → abort patch1 after committing patch2 | `patchState.isConsistencyViolation === true`, data = last valid | P0 |
| PA11 | Unit | Consistency violation: `applyPatches` throws internally → caught | Patches referencing removed array indices | `patchState.isConsistencyViolation === true`, no unhandled exception | P0 |
| PA12 | Edge | Empty patch queue → no-op | `orig, []` | `{ data: orig, patchState: null }` | P2 |
| PA13 | Edge | Patch on complex nested data (Immer deep draft) | Deeply nested object mutation | Correct patches/inversePatches produced | P2 |

---

## Test Cases — core Layer: CacheEntry

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CE01 | Unit | CacheEntry wraps Signal.state with initial value | `new CacheEntry()` | `entry.state$()` returns initial state | P0 |
| CE02 | Unit | `entry.set(newState)` updates signal value | `entry.set(MachinePending)` | `entry.state$()` returns MachinePending | P0 |
| CE03 | Unit | `entry.peek()` returns value without registering signal dependency | `entry.peek()` inside non-tracked context | Returns current state, no subscription | P0 |
| CE04 | Unit | `entry.state$()` registers signal dependency | `Signal.compute(() => entry.state$())` | Computed re-evaluates when entry changes | P0 |
| CE05 | Unit | `entry.complete()` fires onClean$ and marks completed | Entry → `complete()` | onClean$ emitted; subsequent set() is no-op | P0 |
| CE06 | Unit | `entry.set()` is no-op after `complete()` | `entry.complete(); entry.set(newState)` | State stays unchanged from before set() call | P1 |
| CE07 | Unit | `onClean$` fires exactly once on complete | Subscribe to `onClean$` before `complete()` | Subscriber called once | P1 |
| CE08 | Unit | Multiple `complete()` calls — idempotent | `entry.complete(); entry.complete()` | No error, onClean$ fires only once | P2 |
| CE09 | Unit | DevTools keyParts pass through to Signal construction | `new CacheEntry({ keyParts: ["res", "1"] })` | Signal created with devtools name info | P3 |
| CE10 | Unit | `beforeDevtoolsPush` callback invoked before devtools state push | `new CacheEntry({ beforeDevtoolsPush: vi.fn() })` → `set(newState)` | Callback called with state before devtools push | P2 |

---

## Test Cases — core Layer: CacheMap

### Factory Mechanism (both strategies)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM-F01 | Unit | `getOrCreate(args)` calls factory when no entry exists | `map.getOrCreate({ id: 1 })` | Factory called once with `{ id: 1 }`; returns factory result | P0 |
| CM-F02 | Unit | `getOrCreate(args)` does NOT call factory for existing entry | Two calls with `{ id: 1 }` | Factory called once total; same instance returned both times | P0 |
| CM-F03 | Unit | Factory receives correct args | `map.getOrCreate({ id: 42 })` | Factory called with `{ id: 42 }` exactly | P1 |
| CM-F04 | Unit | `createCacheMap({ keyStrategy: "serialize" })` returns SerializeCacheMap | Options with serialize | Instance behaves as serialize (string keys in entries()) | P1 |
| CM-F05 | Unit | `createCacheMap({ keyStrategy: "compare" })` returns CompareCacheMap | Options with compare + comparator | Instance behaves as compare (TArgs keys in entries()) | P1 |

### Serialize Strategy (SerializeCacheMap)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM01 | Unit | `getOrCreate(args)` creates new entry for unknown args | `map.getOrCreate({ id: 1 })` | Returns entry; `map.size === 1` | P0 |
| CM02 | Unit | `getOrCreate(args)` returns existing entry for same args | Two calls with `{ id: 1 }` | Same entry instance | P0 |
| CM03 | Unit | `get(args)` returns undefined when no entry | `map.get({ id: 99 })` | `undefined` | P0 |
| CM04 | Unit | `delete(args)` removes entry | `map.delete({ id: 1 })` | `map.has({ id: 1 }) === false` | P1 |
| CM05 | Unit | `clear()` removes all entries | After 3 entries → `map.clear()` | `map.size === 0` | P1 |
| CM06 | Unit | `entries()` iterates all [string, entry] pairs | 2 entries created | Iterator yields 2 pairs with string keys | P1 |
| CM07 | Unit | Custom `serializeArgs` is used for key generation | Custom fn returning `"custom-${args.id}"` | Key matches custom serialization | P1 |
| CM08 | Unit | Object key ordering doesn't affect lookup | `{ a: 1, b: 2 }` then `{ b: 2, a: 1 }` | Same entry returned (via stableStringify) | P1 |
| CM09 | Unit | `doCacheArgs: true` memoizes args via WeakMap | Object args called twice | Second call returns same serialized key without re-serialization | P2 |
| CM19 | Unit | `values()` iterates all entry values | 3 entries → `[...map.values()]` | Array of 3 entries (order matches insertion) | P2 |

### Compare Strategy (CompareCacheMap)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM10 | Unit | `getOrCreate(args)` with compare strategy uses `compareArg` for lookup | Custom compareFn + two equal args | Same entry for "matching" args; factory called once | P0 |
| CM11 | Unit | Compare strategy linear scan — finds correct entry among multiple | 3 entries; getOrCreate middle one's args | Correct entry returned; factory not called | P1 |
| CM12 | Unit | Compare strategy — different args create separate entries | Two non-matching args | Two separate entries; `map.size === 2`; factory called twice | P1 |
| CM13 | Unit | Compare strategy `get(args)` returns undefined when no match | `get` with unmatched args | `undefined` | P1 |
| CM14 | Unit | Compare strategy `delete(args)` removes correct entry | 3 entries → delete middle | `map.size === 2`; deleted entry not findable | P1 |
| CM15 | Unit | Compare strategy `clear()` removes all entries | After 3 entries → `clear()` | `map.size === 0` | P1 |
| CM16 | Unit | Compare strategy `entries()` iterates with original TArgs as keys | Create 2 entries | Iterator yields pairs with original TArgs (not strings) | P1 |
| CM17 | Unit | Compare strategy with non-serializable args (RegExp) | `getOrCreate(/foo/i)` then `getOrCreate(/foo/i)` with source+flags comparator | Same entry returned | P1 |
| CM18 | Edge | Compare strategy default compareArg uses shallowEqual | No custom compareArg | `{ a: 1 }` and `{ a: 1 }` match | P2 |

---

## Test Cases — core Layer: ResourceV2

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RE01 | Unit | `resource.query(args)` — creates entry, fetches, returns data on success | `query({ id: 1 })` → resolve | Promise resolves with data; CacheEntry in success | P0 |
| RE02 | Unit | `resource.query(args)` — deduplicates in-flight requests (same args) | Two concurrent `query({ id: 1 })` calls | `queryFn` called once; both promises resolve same data | P0 |
| RE03 | Unit | `resource.query(args)` — force=true skips dedup | `query({ id: 1 })` then `query({ id: 1 }, true)` | `queryFn` called twice; first request aborted | P1 |
| RE04 | Unit | `resource.query(args)` — error state: retry on re-query | After error → `query(sameArgs)` | `queryFn` called again; MachinePending | P0 |
| RE05 | Unit | `resource.query(args)` — cached success: no re-fetch | After success → `query(sameArgs)` | `queryFn` NOT called again; returns cached data | P0 |
| RE06 | Unit | `resource.getEntry(args)` returns null when no entry | Fresh resource → `getEntry({ id: 1 })` | `null` | P1 |
| RE07 | Unit | `resource.getEntry(args, true)` creates entry if needed | `getEntry({ id: 1 }, true)` | Non-null `IResourceV2CacheEntry` | P1 |
| RE08 | Unit | `resource.getEntry$(args)` is reactive to resetAll | Create computed using `getEntry$()` → `api.resetAll()` | Computed returns `null` after reset | P0 |
| RE09 | Unit | `resource.invalidate(args)` — success → refreshing → refetch | Entry in success → `invalidate(args)` | Transitions to MachineRefreshing; queryFn called | P0 |
| RE10 | Unit | `resource.invalidate(args)` — non-success entry: no-op | Entry in pending → `invalidate(args)` | No transition; queryFn not called | P1 |
| RE11 | Unit | Args change: old entry's request continues independently | `query({id:1})` then `query({id:2})` before resolve | First request continues (not aborted); second entry starts its own fetch | P0 |
| RE12 | Unit | Refresh error (ADR-2): errorHappened on refreshing preserves stale data | Refreshing entry → queryFn rejects | Entry back to MachineSuccess with stale data | P0 |
| RE13 | Unit | ResourceV2 internal `compareArgs(a, b)` uses configured strategy | Default (shallowEqual): `{ id: 1 }` vs `{ id: 1 }` | `true` | P1 |
| RE14 | Unit | ResourceV2 internal `resetCache()` — aborts all, clears GC, completes entries, clears map | ResourceV2 with 3 entries → `resetCache()` | All entries completed; cache empty; inflight aborted | P0 |
| RE15 | Unit | ResourceV2 internal `cacheEntries()` iterates all entries (for snapshot) | 3 entries → `cacheEntries()` | Iterator yields 3 pairs | P1 |
| RE16 | Unit | ResourceV2 internal `hydrateEntry(args, machine)` — creates entry from snapshot into empty cache | `hydrateEntry({ id: 1 }, MachineSuccess(...))` | Entry exists with success data; CacheMap.size === 1 | P1 |
| RE18 | Unit | ResourceV2 internal `hasEntry(args)` checks existence | After query → `hasEntry(sameArgs)` | `true` | P2 |

> **ID gaps**: RE17 and AP07 are reserved IDs (removed during prior design iterations). Remaining IDs are intentionally not renumbered to preserve cross-document reference stability.
| RE19 | Unit | Batcher.run wraps state transitions (batched updates) | Subscribe to signal → trigger query + resolve | Single notification, not intermediate states | P1 |

### ResourceV2 — _status$ Signal (ADR-11)

> **Note**: `_lastEntry$` is tested indirectly via RE08 (`getEntry$` reactive behavior) and RE23 (`getEntry$` returns null after reset). Dedicated `_lastEntry$` tests are not needed since it is an internal implementation detail of `getEntry$`.

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RE20 | Unit | `_status$` starts as "idle" | Fresh resource | `_status$()` returns "idle" | P1 |
| RE21 | Unit | `_status$` transitions to "ready" on first query | `query(args)` | `_status$()` returns "ready" | P1 |
| RE22 | Unit | `_status$` reverts to "idle" on `resetCache()` | After queries → `resetCache()` | `_status$()` returns "idle" | P1 |
| RE23 | Unit | `getEntry$(args)` returns null when _status$ is "idle" | After `resetCache()` | `getEntry$(args)` returns null inside compute | P1 |

> **Note on `getEntry$` binding optimization** (dataflow §6.2): `getEntry$` internally caches a binding to the entry once `isMyArgs` confirms a match, avoiding repeated `_lastEntry$` lookups. This is a performance implementation detail — observable behavior is fully covered by RE08 and RE23 without a dedicated binding-memo test.

### ResourceV2 — GC Lifecycle

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| GC01 | Unit | GC timer starts when refcount drops to 0 | Subscribe → unsubscribe → advance timer | Entry deleted after `cacheLifetime` ms | P0 |
| GC02 | Unit | GC timer cancelled when new subscriber arrives | Unsub → timer started → re-subscribe before expiry | Entry preserved | P0 |
| GC03 | Unit | `cacheLifetime: false` disables GC entirely | Entry with zero subs → advance time | Entry not deleted | P1 |
| GC04 | Unit | GC fires: complete(), delete from cache, fire lifecycle hook | GC timer expires | `CacheEntry.complete()` called; `fireCacheEntryRemoved()` called; map does not have entry | P1 |
| GC05 | Edge | Rapid subscribe/unsubscribe — timer resets correctly | Sub → unsub → sub → unsub → advance | Only one GC timer; fires after last unsub + lifetime | P2 |

### ResourceV2 — ResourceV2CacheEntry (Consumer-Facing)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RCE01 | Unit | `entry.machine$` is a signal property aliasing CacheEntry.state$(); `entry.machine$()` reads current state | Read machine state | Returns current machine instance | P0 |
| RCE02 | Unit | `entry.peek()` delegates to underlying CacheEntry.peek() | Non-reactive read | Returns machine without subscription | P1 |
| RCE03 | Unit | `entry.isMyArgs(args)` returns true for matching args | Entry for {id:1} → `isMyArgs({id:1})` | `true` | P1 |
| RCE04 | Unit | `entry.isMyArgs(args)` returns false for different args | Entry for {id:1} → `isMyArgs({id:2})` | `false` | P1 |
| RCE05 | Unit | `entry.createPatch(fn)` returns IPatchHandle when data exists | Entry in success → `createPatch(d => d.x = 1)` | Non-null `{ commit, abort }` | P0 |
| RCE06 | Unit | `entry.createPatch(fn)` returns null when no data | Entry in pending → `createPatch(...)` | `null` | P1 |
| RCE07 | Unit | Patch commit/abort lifecycle through entry handle | Create patch → commit | Data includes patch; handle signals committed | P0 |
| RCE08 | Unit | `entry.invalidate()` transitions success → refreshing and triggers refetch | Entry in success → `entry.invalidate()` | Machine transitions to refreshing; queryFn called | P0 |
| RCE09 | Unit | `entry.invalidate()` on non-success entry: no-op | Entry in pending → `entry.invalidate()` | No transition; queryFn not called | P1 |
| RCE10 | Unit | `entry.query()` initiates fetch for this entry's args | Entry in idle → `entry.query()` | queryFn called; machine transitions to pending | P0 |
| RCE11 | Unit | `entry.query()` deduplicates with in-flight requests | Entry already pending → `entry.query()` | queryFn NOT called again; returns existing promise | P1 |
| RCE12 | Unit | `entry.query(true)` forces re-fetch | Entry in success → `entry.query(true)` | queryFn called; machine transitions to refreshing | P1 |
| RCE13 | Unit | `entry.createPatch()` sets `_patchState` with originalData and isConsistencyViolation=false | Entry in success → `createPatch(fn)` | `_patchState` is `{ originalData, patches: [...], isConsistencyViolation: false }` | P1 |
| RCE14 | Unit | Consistency violation sets `_patchState.isConsistencyViolation = true` then auto-invalidates | Multi-patch → out-of-order abort | `patchState.isConsistencyViolation === true`; entry triggers invalidate | P0 |
| RCE15 | Unit | `entry.complete()` is terminal: aborts patches → idle → onClean$ → completed (ADR-14) | Entry in success with active patches → `entry.complete()` | Pending patches aborted; machine transitions to idle; `onClean$` fires; `_isCompleted = true`; subsequent `set()` is no-op | P0 |

---

## Test Cases — core Layer: ResourceV2Agent

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| AG01 | Unit | `agent.start(args)` obtains entry via `_getEntry` callback and calls `entry.query()` | `agent.start({ id: 1 })` | `queryFn` called; `agent.state$()` starts pending | P0 |
| AG02 | Unit | `agent.state$` derives flat state from machine | After success | `{ status: "success", data, error: null, args, isLoading: false, isSuccess: true, ... }` | P0 |
| AG03 | Unit | SWR: previous data shown while loading new args | Success for {id:1} → `start({id:2})` | `state$.data === data1` while {id:2} is pending | P0 |
| AG04 | Unit | SWR: previous cleared when current resolves | Success for {id:1} → `start({id:2})` → resolve {id:2} | `state$.data === data2`; no previousData | P0 |
| AG05 | Unit | `isInitialLoading` — true only with no previous data | `start(args)` first time | `isInitialLoading === true` | P0 |
| AG06 | Unit | `isInitialLoading` — false when SWR data exists | Success {id:1} → `start({id:2})` | `isInitialLoading === false` (has previous data) | P1 |
| AG07 | Unit | `start(SKIP)` — agent stays idle | `agent.start(SKIP)` | `state$.status === "idle"`, no fetch | P0 |
| AG08 | Unit | Same args: no re-fetch when already in success/pending | Success → `start(sameArgs)` | `queryFn` not called again | P1 |
| AG09 | Unit | Same args in error state: triggers retry | Error → `start(sameArgs)` | `queryFn` called; transitions to pending | P1 |
| AG10 | Unit | Rapid arg changes: only latest args tracked | `start(1)` → `start(2)` → `start(3)` quickly | Agent tracks args=3; previous = first settled entry | P1 |
| AG11 | Edge | SWR chain protection: rapid change doesn't accumulate previous entries | `start(1) → start(2) → start(3)` (none resolved) | One `previous`, one `current` — no chain | P2 |
| AG12 | Unit | `agent.state$` is a ComputeFn — reactive to signal changes | `effect(() => state$())` → resolve query | Effect re-runs on state transitions | P0 |
| AG13 | Unit | `agent.compareArgs(a, b)` delegates to resource | `agent.compareArgs({ id: 1 }, { id: 1 })` | `true` | P2 |
| AG14 | Unit | `entry` field on agent state provides consumer entry handle | After success | `state$.entry` is `IResourceV2CacheEntry`, non-null | P1 |
| AG15 | Unit | `isRefreshing` true during refreshing state | Success → `invalidate()` → read agent state | `state$.isRefreshing === true`, `state$.isLoading === true` | P1 |
| AG16 | Unit | `isError` true on error, `error` carries the thrown value | Pending → queryFn rejects | `state$.isError === true`, `state$.error` is the rejection value | P1 |
| AG17 | Unit | `args` field reflects current agent args | `agent.start({ id: 42 })` | `state$.args === { id: 42 }` | P1 |
| AG18 | Unit | `args` is null when agent is idle/SKIP | `agent.start(SKIP)` | `state$.args === null` | P2 |

---

## Test Cases — core Layer: LifecycleHooks

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| LH01 | Unit | `fireCacheEntryAdded(args, getCacheEntry)` invokes callback | Callback registered → fire | Callback called with `(args, { $cacheDataLoaded, $cacheEntryRemoved })` | P0 |
| LH02 | Unit | `$cacheDataLoaded` resolves on first success | Fire → resolve data loaded | Promise resolves with data | P0 |
| LH03 | Unit | `$cacheEntryRemoved` resolves on GC/complete | Fire → complete entry | Promise resolves | P1 |
| LH04 | Unit | `$cacheDataLoaded` rejects if entry removed before any success | Fire → remove without loading | Promise rejects | P1 |
| LH05 | Unit | `fireQueryStarted(args, getCacheEntry)` invokes callback | Callback registered → fire | Callback called with `(args, { getCacheEntry, $queryFulfilled })` | P0 |
| LH06 | Unit | `$queryFulfilled` resolves on query success | Fire → resolve query | Promise resolves with `{ data: TData }` | P0 |
| LH07 | Unit | `$queryFulfilled` rejects on query error | Fire → reject query | Promise rejects with error | P1 |
| LH08 | Unit | `clearAll()` cleans up all pending resolvers | Multiple pending → `clearAll()` | All `$cacheDataLoaded` rejected; all `$cacheEntryRemoved` resolved | P1 |
| LH09 | Unit | Multiple callbacks — all invoked in order | 2 `onCacheEntryAdded` callbacks | Both called in registration order | P2 |

---

## Test Cases — plugins Layer: ReactHooksPlugin

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| PL01 | Unit | `plugin.install(context)` called during `createApi()` | Plugin with install spy → `createApi({ plugins: [p] })` | `install` called with context | P0 |
| PL02 | Unit | `plugin.augmentResource(resource, options)` called per `createResourceV2()` | Plugin with augment spy → `api.createResourceV2(...)` | `augmentResource` called | P0 |
| PL03 | Unit | Contributions merged via Object.assign onto resource | Plugin returns `{ useHook: fn }` | `resource.useHook` is `fn` | P0 |
| PL04 | Unit | Plugin install called in registration order | `[pluginA, pluginB]` | A.install before B.install | P1 |
| PL05 | Unit | Key collision detection: throws on duplicate contribution keys | Two plugins both returning `{ foo: ... }` | Throws `Error("Plugin key collision: foo")` | P1 |
| PL06 | Unit | ReactHooksPlugin contributes `useResourceV2Agent` method to resource instances via `augmentResource()` | `ReactHooksPlugin` installed → `api.createResourceV2(...)` | ResourceV2 instance has `.useResourceV2Agent()` method | P1 |
| PL07 | Edge | Plugin error in `install` propagates | Plugin install throws | `createApi()` throws | P2 |
| PL08 | Edge | Plugin error in `augmentResource` propagates | Plugin augment throws | `api.createResourceV2()` throws | P2 |
| PL09 | Unit | `PluginAugmentations` resolves correct contribution types at compile time | `.test-d.ts`: `expectTypeOf(resource.useResourceV2Agent).toBeFunction()` after `createApi({ plugins: [new ReactHooksPlugin()] as const })` | Type-level: compiles without error; `useResourceV2Agent` is typed as `(args) => IResourceV2AgentState` | P1 |
| PL10 | Unit | `PluginAugmentations` rejects invalid plugin access at compile time | `.test-d.ts`: `// @ts-expect-error` on `resource.nonExistentMethod()` | Type-level: accessing undeclared contribution is a compile error | P1 |
| PL11 | Unit | Later plugin's `augmentResource` can access earlier plugin's contributions on the resource object | `[pluginA, pluginB]` where B reads A's contribution key on resource | B's `augmentResource` sees A's contribution via `resource.someKey` | P2 |

---

## Test Cases — api Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| AP01 | Unit | `createApi(options)` returns API with createResourceV2, resetAll, getSnapshot | Options with keyPrefix | API object with all methods | P0 |
| AP02 | Unit | `api.createResourceV2(options)` validates unique key | Two resources with same key | Throws on duplicate | P0 |
| AP03 | Unit | `api.createResourceV2` merges API defaults with resource options | API `cacheLifetime: 60000` + resource `cacheLifetime: 30000` | ResourceV2 uses 30000 (override) | P1 |
| AP04 | Unit | `api.createResourceV2` — resource inherits API-level options | API `keyPrefix: "app"`, resource has no keyPrefix | ResourceV2 uses "app" | P1 |
| AP05 | Unit | `api.resetAll()` calls `resetCache()` on all registered resources and deletes `_savedSnapshot` | 3 resources → `resetAll()` | All 3 reset; `_savedSnapshot = null` | P0 |
| AP06 | Unit | `api.getSnapshot(): TApiSnapshot` delegates to snapshot module | 2 resources with success entries → `getSnapshot()` | Returns `TApiSnapshot` with 2 resource entries | P1 |
| AP08 | Unit | `createApi` saves `initialSnapshot`; `createResourceV2` consumes its slice | Snapshot with data for "users" → `createApi({initialSnapshot})` → `createResourceV2({key: "users"})` | ResourceV2 has pre-populated entry; snapshot slice for "users" deleted from `_savedSnapshot` | P1 |
| AP08a | Unit | `createResourceV2` without matching snapshot key — no hydration | Snapshot with "users" → `createResourceV2({key: "orders"})` | ResourceV2 has no pre-populated entries; "users" slice still in `_savedSnapshot` | P1 |
| AP08b | Unit | `api.resetAll()` deletes `_savedSnapshot` — subsequent `createResourceV2` sees no snapshot | `createApi({initialSnapshot})` → `resetAll()` → `createResourceV2({key: "users"})` | ResourceV2 has no pre-populated entries (snapshot deleted) | P1 |
| AP08c | Unit | Snapshot data older than `maxSnapshotDataAge` triggers auto-invalidation on `createResourceV2` | Snapshot with old `updatedAt` → `createResourceV2({maxSnapshotDataAge: 1000})` | Entry hydrated then `entry.invalidate()` called (stale data triggers refresh) | P1 |
| AP09 | Edge | `createApi` with empty options uses defaults | `createApi({})` | Default cacheLifetime=60000, keyStrategy="serialize", etc. | P2 |
| AP10 | Edge | `createResourceV2` without key — still works (snapshot limited) | `api.createResourceV2({ queryFn })` (no key) | ResourceV2 created; snapshot excludes it | P2 |
| AP11 | Unit | Standalone `createResourceV2` accepts standalone-level options (`keyStrategy`, `keyPrefix`) | `createResourceV2({ queryFn, keyStrategy: "compare", keyPrefix: "standalone" })` | ResourceV2 created with compare strategy; devtools name includes keyPrefix | P2 |

---

## Test Cases — react Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RH01 | Component | `useResourceV2Agent(resource, args)` — renders with pending, then success | Render → resolve | Initial: isLoading=true → rerender: data=resolved data | P0 |
| RH02 | Component | `useResourceV2Agent(resource, SKIP)` — idle state, no fetch | Render with SKIP | status="idle", data=null, isLoading=false; queryFn not called | P0 |
| RH03 | Component | `useResourceV2Agent` — args change triggers new fetch + SWR | Render {id:1} → resolve → rerender {id:2} | Shows data1 while loading data2; then shows data2 | P0 |
| RH04 | Component | `useResourceV2Agent` — unmount cleans up agent/subscription | Render → unmount | No memory leak warnings; refcount decremented | P0 |
| RH05 | Component | `useResourceV2Agent` — same args on rerender: no re-fetch | Render {id:1} → rerender {id:1} | queryFn called once | P1 |
| RH06 | Component | `useResourceV2Agent` void args — no second argument | `useResourceV2Agent(voidResource)` | Works without args; fetch triggered | P1 |
| RH07 | Component | Multiple components sharing same resource/args — single fetch | Two renderHook with same resource+args | queryFn called once; both hooks receive same data | P1 |
| RH08 | Component | `useSyncExternalStore` tearing protection | Concurrent-mode scenario: signal updates mid-render | No tearing: both components see consistent state | P1 |
| RH09 | Component | Error boundary: hook does not throw on error state | queryFn rejects | status="error", isError=true; no throw | P1 |
| RH10 | Edge | Rapid unmount/remount — no stale callbacks | Mount → unmount → mount quickly | No stale subscriptions; clean state | P2 |

---

## Test Cases — core Layer: Snapshot

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SN01 | Unit | `getSnapshot()` captures only success entries | 1 success + 1 pending entry | Snapshot includes 1 entry | P0 |
| SN02 | Unit | `getSnapshot()` includes version and keyPrefix | API with keyPrefix="app" | `{ version: 1, keyPrefix: "app", resources: {...} }` | P0 |
| SN03 | Unit | `hydrateSnapshot(api: IApi, snapshot: TApiSnapshot): void` reconstructs machine instances via `Machine.fromSnapshot<TArgs, TData>()` | Valid snapshot → hydrate | Entries hydrated as `MachineSuccess<TArgs, TData>` with correct data | P0 |
| SN04 | Unit | `createApi({initialSnapshot})` throws on version mismatch at save time | Snapshot with version=99 | Throws error at `createApi()` call | P0 |
| SN05 | Unit | `createApi({initialSnapshot})` throws on keyPrefix mismatch at save time | API prefix="a", snapshot prefix="b" | Throws error at `createApi()` call | P1 |
| SN06 | Unit | `createResourceV2()` with no matching snapshot slice — no hydration, no warning | Snapshot has "users"; createResourceV2 key="orders" | No hydration; no warning; resource starts empty | P1 |
| SN07 | Unit | Per-resource hydration populates empty cache from snapshot slice | `createApi({initialSnapshot})` → `createResourceV2({key: "users"})` | Resource cache populated with snapshot entries; CacheMap starts empty, ends with hydrated entries | P1 |
| SN08 | Unit | `maxSnapshotDataAge`: expired entry auto-invalidated at `createResourceV2` time | Entry hydrated with old updatedAt; maxAge=1000 | `entry.invalidate(): void` called for that entry | P1 |
| SN09 | Unit | Full round-trip: getSnapshot → JSON.stringify → JSON.parse → createApi({initialSnapshot}) → createResourceV2 | Capture → serialize → deserialize → save → consume | Hydrated data matches original data | P0 |
| SN10 | Unit | `getSnapshot()` throws for compare strategy resources | ResourceV2 with keyStrategy="compare" | Throws error about non-serializable keys | P1 |
| SN11 | Unit | Snapshot slice is deleted from `_savedSnapshot` after `createResourceV2` consumes it | createApi({initialSnapshot}) → createResourceV2({key: "users"}) → createResourceV2({key: "users"}) | Second createResourceV2 with same key throws (duplicate key), but snapshot slice already consumed after first call | P1 |
| SN12 | Unit | `resetAll()` deletes `_savedSnapshot` | createApi({initialSnapshot}) → resetAll() | `_savedSnapshot` is null; subsequent createResourceV2 sees no snapshot data | P0 |

---

## Test Cases — Integration

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| INT01 | Integration | Full pipeline: createResourceV2 → query → cache → agent.state$ → data | Create resource → agent.start → resolve → read state | Agent state has correct data; cache entry in success | P0 |
| INT02 | Integration | Full pipeline: React hook → fetch → render → rerender with new args | `renderHook(useResourceV2Agent)` → resolve → rerender new args | SWR shows old data; then new data after resolve | P0 |
| INT03 | Integration | Plugin + cache + hook: ReactHooksPlugin contributes working hooks | `createApi({ plugins: [new ReactHooksPlugin()] })` → `resource.useResourceV2Agent(args)` in renderHook | Hook works, data flows through | P1 |
| INT04 | Integration | Snapshot SSR round-trip: server capture → client save → per-resource consume → React render | Server: query → getSnapshot; Client: createApi({initialSnapshot}) → createResourceV2 (consumes slice) → renderHook | Client renders hydrated data without fetch; snapshot slice consumed | P0 |
| INT05 | Integration | GC under component lifecycle: mount→data→unmount→timer→remount | Mount → get data → unmount → wait half lifetime → remount | Data still cached (timer not expired) | P1 |
| INT06 | Integration | GC under component lifecycle: mount→data→unmount→timer expires | Mount → get data → unmount → wait full lifetime | Entry GC'd; remount triggers new fetch | P1 |
| INT07 | Integration | Optimistic update + rollback via entry.createPatch | ResourceV2 with data → createPatch → abort → check data rolled back | Data returns to original after abort | P1 |
| INT08 | Integration | Optimistic update + commit | ResourceV2 with data → createPatch → commit → check data includes patch | Data includes committed patch | P1 |
| INT09 | Integration | Consistency violation → auto-invalidation → fresh data | Multi-patch → out-of-order abort → violation → refetch | ResourceV2 auto-invalidates; fresh data replaces patched | P1 |
| INT10 | Integration | resetAll → all agents see idle, all entries cleared | 3 resources with data → `api.resetAll()` | All agents: status="idle"; all caches empty | P0 |
| INT11 | Integration | Multiple agents on same resource — shared cache, independent SWR | 2 agents for same resource, different args | Shared cache entries; each agent has own previous/current | P1 |
| INT12 | Integration | Args change: old entry's request is not aborted | Agent.start(args1) → agent.start(args2) before resolve | args1 queryFn continues independently; agent tracks args2 entry; args1 data available to other consumers | P1 |
| INT13 | Integration | Lifecycle hooks fired in correct order during full lifecycle | `onCacheEntryAdded` + `onQueryStarted` callbacks | Added fires first; queryStarted fires on query; promises resolve in order | P2 |
| INT14 | Integration | Plugin augmentResource called with all api-level defaults merged | Plugin inspects options in augmentResource | options contain merged defaults | P2 |

---

## Edge Cases

| ID | Category | Description | Test Strategy | Priority |
|----|----------|-------------|---------------|----------|
| E01 | Edge | queryFn throws synchronously (not async rejection) | Wrap in try/catch; verify transitions to error | P1 |
| E02 | Edge | queryFn returns rejected promise immediately | Resolve in same microtask; verify state transitions | P1 |
| E03 | Edge | `null` / `undefined` as valid TData | Query resolves with null → verify success state with data=null | P2 |
| E04 | Edge | Very large args object — serialization performance | Profile stableStringify with 1000-key object | P3 |
| E05 | Edge | ResourceV2 created but never queried — no leaks | Create resource → dispose | No timers, no signal subscriptions leaked | P2 |
| E06 | Edge | resetCache() during inflight query | `query(args)` → `resetCache()` before resolve | Inflight aborted; entry cleared; no error propagation | P1 |
| E07 | Edge | Hydrate entry then query same args — uses hydrated data | hydrate → agent.start → check | No fetch; returns hydrated data | P1 |
| E08 | Edge | AbortError from queryFn — no state transition | AbortController.abort() during fetch | Entry stays in current state, no error transition | P1 |
| E09 | Edge | Double-commit or double-abort on patch handle | `patch.commit(); patch.commit()` | Idempotent: second call is no-op | P2 |
| E10 | Edge | `entry.createPatch` during refreshing state | Entry in refreshing with data → createPatch | Patch applies to stale data | P2 |

---

## Performance Criteria

| Metric | Threshold | How to Verify |
|--------|-----------|---------------|
| Signal update → React re-render | < 1 frame (16ms) | Profiling in integration test with `performance.now()` |
| stableStringify for typical args (< 10 keys) | < 0.1ms | Benchmark in unit test |
| Cache lookup for serialize strategy | O(1) per lookup | Verify same-args returns in < 0.1ms |
| Cache lookup for compare strategy | O(n) per lookup | Verify linear with entry count |
| GC cleanup completes synchronously | No async leaks | Verify `complete()` is sync; no pending timers after |
| No memory leaks from signal subscriptions | Zero leaked subscriptions after unmount | Check signal subscriber count in test teardown |

---

## Correctness Verification

End-to-end correctness is verified by running the full integration test suite (`INT01`–`INT14`) which covers the complete data flow from API creation through React rendering. Key correctness invariants:

1. **State machine consistency**: Every CacheEntry always contains a valid `TMachineInstance`; no intermediate/invalid states observable from outside `Batcher.run()`.
2. **Cache correctness**: Same args → same entry (serialize) or same entry (compare); different args → different entries. No cross-contamination.
3. **SWR correctness**: Previous data always available during loading when a previous success existed; previous data cleared only after current resolves.
4. **Snapshot fidelity**: Data survives round-trip through `JSON.stringify`/`JSON.parse` without loss or mutation.
5. **GC safety**: No entry is GC'd while any subscriber or lock holds a reference; all entries are GC'd when no references and timer expires.
6. **Patch integrity**: Committed patches are permanent; aborted patches are fully reversed; consistency violations detected and trigger invalidation.
7. **React consistency**: `useSyncExternalStore` prevents tearing; hooks clean up subscriptions on unmount.
