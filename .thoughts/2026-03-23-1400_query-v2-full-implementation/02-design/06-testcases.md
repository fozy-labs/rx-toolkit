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

- **Unit tests**: Each module tested in isolation. State machines, Patcher, CacheEntry, CacheMap, LifecycleHooks, Resource, Agent, Operation — mocked boundaries where needed.
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

Similarly for `createControllableOperation()`.

#### flushMicrotasks()

After `calls[n].resolve(data)` or `calls[n].reject(error)`, call `await flushMicrotasks()` to propagate through the signal/batcher chain. Existing helper: `@/__tests__/helpers/async-helpers.ts`.

#### `cacheLifetime: false`

All unit tests must disable GC timer to eliminate TTL interference. Timer-based GC behavior tested in dedicated GC test cases using `vi.useFakeTimers()`.

#### Test Isolation

- Each test gets independent resource/cache instances — no shared state between tests.
- Global `beforeEach` calls `resetSharedOptions()` (existing setup in `@/__tests__/setup.ts`).
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

- Mock plugin hooks (`install`, `augmentResource`, `augmentOperation`)
- Verify invocation order matches registration order
- Verify `Object.assign` merge of contributions
- Verify key collision detection throws
- Verify declaration merging types compile correctly (type-level tests)

### React Hook Testing Strategy

- `renderHook(() => useResourceV2(resource, args))` — verify initial state, data after resolve, cleanup after unmount
- `act()` boundaries around all state-changing operations
- `rerender` with new args → verify SWR behavior
- Unmount → verify agent cleanup, no memory leaks, no console warnings

---

## Test Cases — lib Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| L01 | Unit | `SKIP` is a unique symbol | `typeof SKIP` | `"symbol"` | P0 |
| L02 | Unit | `NO_VALUE` is a unique symbol, distinct from SKIP | `NO_VALUE === SKIP` | `false` | P0 |
| L03 | Unit | `stableStringify` — plain object with sorted keys | `{ b: 2, a: 1 }` | `'{"a":1,"b":2}'` | P0 |
| L04 | Unit | `stableStringify` — nested objects | `{ b: { d: 4, c: 3 }, a: 1 }` | `'{"a":1,"b":{"c":3,"d":4}}'` | P1 |
| L05 | Unit | `stableStringify` — arrays preserved in order | `[3, 1, 2]` | `'[3,1,2]'` | P1 |
| L06 | Unit | `stableStringify` — null and undefined handling | `{ a: null, b: undefined }` | `'{"a":null}'` (undefined omitted per JSON spec) | P1 |
| L07 | Unit | `stableStringify` — primitives (string, number, boolean) | `42`, `"hello"`, `true` | `'42'`, `'"hello"'`, `'true'` | P1 |
| L08 | Unit | `stableStringify` — empty object and empty array | `{}`, `[]` | `'{}'`, `'[]'` | P2 |
| L09 | Unit | `stableStringify` — determinism: same output for same input across calls | Two calls with `{ b: 2, a: 1 }` | Same string both times | P1 |
| L10 | Edge | `stableStringify` — Date/Map/Set fallback (no crash) | `new Date()` | Does not throw; produces some string output | P2 |

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
| SM06 | Unit | `pending.errorHappened(error)` → MachineError | `pending.errorHappened(new Error("fail"))` | `instanceof MachineError`, status="error", error is Error | P0 |
| SM07 | Unit | `pending.reset()` → MachineIdle | `pending.reset()` | `instanceof MachineIdle` | P1 |
| SM08 | Unit | Pending preserves args from start | `idle.start({ id: 5 })` | `pending.args === { id: 5 }` (via `.state.args`) | P1 |
| SM09 | Unit | Pending carries originalData (NO_VALUE when no prior data) | `idle.start(args)` | `pending.originalData === NO_VALUE` | P1 |

### MachineSuccess

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SM10 | Unit | `success.invalidate()` → MachineRefreshing | `success.invalidate()` | `instanceof MachineRefreshing`, status="refreshing", data preserved | P0 |
| SM11 | Unit | `success.start(newArgs)` → MachinePending | `success.start({ id: 2 })` | `instanceof MachinePending`, args={id:2} | P0 |
| SM12 | Unit | `success.reset()` → MachineIdle (aborts patches) | `successWithPatches.reset()` | `instanceof MachineIdle`, patches aborted | P0 |
| SM13 | Unit | Success has updatedAt timestamp | `pending.successHappened(data)` | `success.updatedAt` is a number > 0 | P1 |
| SM14 | Unit | Success carries data and originalData | `pending.successHappened(data)` | `success.data === data, success.originalData === NO_VALUE` | P1 |
| SM15 | Unit | Success .state serialization contains all fields | `success.state` | `{ status, args, data, error: null, updatedAt, originalData, patches }` | P1 |

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
| SM24 | Unit | Refreshing preserves patches from success state | `successWithPatches.invalidate()` | `refreshing.patches` same as success | P1 |

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
| PA02 | Unit | `resolvePatches` — single committed patch baked into base | `originalData, [committedPatch]` | `{ data: patchedData, patches: null, baseData: patchedData }` | P0 |
| PA03 | Unit | `resolvePatches` — single pending patch applied, kept in queue | `originalData, [pendingPatch]` | `{ data: patchedData, patches: [pendingPatch] }` | P0 |
| PA04 | Unit | `resolvePatches` — aborted patch (no pending after) dropped silently | `originalData, [abortedPatch]` | `{ data: originalData, patches: null }` | P1 |
| PA05 | Unit | `resolvePatches` — committed before pending: committed consumed, pending kept | `orig, [committed, pending]` | `{ data: both applied, patches: [pending] }` | P1 |
| PA06 | Unit | `resolvePatches` — aborted after pending: inverse applied, removed | `orig, [pending, aborted]` | Data reflects pending only; aborted inversed | P1 |
| PA07 | Unit | `finishPatch` — commit transitions patch from pending→committed | `orig, patches, "committed", targetPatch` | Target patch status="committed" in result | P1 |
| PA08 | Unit | `finishPatch` — abort transitions patch from pending→aborted | `orig, patches, "aborted", targetPatch` | Target patch status="aborted", inverse applied | P1 |
| PA09 | Unit | `abortAllPending` — marks all pending as aborted, resolves | `orig, [pending1, pending2]` | All patches aborted, data = originalData | P1 |
| PA10 | Unit | Consistency violation: out-of-order abort on multi-patch | `orig, [patch1, patch2]` → abort patch1 after committing patch2 | `{ isConsistencyViolation: true }`, data = last valid | P0 |
| PA11 | Unit | Consistency violation: `applyPatches` throws internally → caught | Patches referencing removed array indices | `isConsistencyViolation: true`, no unhandled exception | P0 |
| PA12 | Edge | Empty patch queue → no-op | `orig, []` | `{ data: orig, patches: null }` | P2 |
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

---

## Test Cases — core Layer: CacheMap

### Serialize Strategy

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM01 | Unit | `getOrCreate(args)` creates new entry for unknown args | `map.getOrCreate({ id: 1 })` | Returns CacheEntry; `map.size === 1` | P0 |
| CM02 | Unit | `getOrCreate(args)` returns existing entry for same args | Two calls with `{ id: 1 }` | Same CacheEntry instance | P0 |
| CM03 | Unit | `get(args)` returns undefined when no entry | `map.get({ id: 99 })` | `undefined` | P0 |
| CM04 | Unit | `delete(args)` removes entry | `map.delete({ id: 1 })` | `map.has({ id: 1 }) === false` | P1 |
| CM05 | Unit | `clear()` removes all entries | After 3 entries → `map.clear()` | `map.size === 0` | P1 |
| CM06 | Unit | `entries()` iterates all [key, entry] pairs | 2 entries created | Iterator yields 2 pairs with string keys | P1 |
| CM07 | Unit | Custom `serializeArgs` is used for key generation | Custom fn returning `"custom-${args.id}"` | Key matches custom serialization | P1 |
| CM08 | Unit | Object key ordering doesn't affect lookup | `{ a: 1, b: 2 }` then `{ b: 2, a: 1 }` | Same entry returned (via stableStringify) | P1 |
| CM09 | Unit | `doCacheArgs: true` memoizes args via WeakMap | Object args called twice | Second call returns same serialized key without re-serialization | P2 |

### Compare Strategy

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| CM10 | Unit | Compare strategy uses `compareArg` function for lookup | Custom compareFn returning true | Same entry for "matching" args | P1 |
| CM11 | Unit | Compare strategy linear scan — finds correct entry | 3 entries; lookup middle one | Correct entry returned | P1 |
| CM12 | Unit | Compare strategy — different args create separate entries | Two non-matching args | Two separate entries; `map.size === 2` | P1 |
| CM13 | Edge | Compare strategy entries() iterates with original args as keys | Create 2 entries | Iterator yields pairs with original TArgs (not strings) | P2 |

---

## Test Cases — core Layer: Resource

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RE01 | Unit | `resource.query(args)` — creates entry, fetches, returns data on success | `query({ id: 1 })` → resolve | Promise resolves with data; CacheEntry in success | P0 |
| RE02 | Unit | `resource.query(args)` — deduplicates in-flight requests (same args) | Two concurrent `query({ id: 1 })` calls | `queryFn` called once; both promises resolve same data | P0 |
| RE03 | Unit | `resource.query(args)` — force=true skips dedup | `query({ id: 1 })` then `query({ id: 1 }, true)` | `queryFn` called twice; first request aborted | P1 |
| RE04 | Unit | `resource.query(args)` — error state: retry on re-query | After error → `query(sameArgs)` | `queryFn` called again; MachinePending | P0 |
| RE05 | Unit | `resource.query(args)` — cached success: no re-fetch | After success → `query(sameArgs)` | `queryFn` NOT called again; returns cached data | P0 |
| RE06 | Unit | `resource.getEntry(args)` returns null when no entry | Fresh resource → `getEntry({ id: 1 })` | `null` | P1 |
| RE07 | Unit | `resource.getEntry(args, true)` creates entry if needed | `getEntry({ id: 1 }, true)` | Non-null `IResourceV2CacheEntry` | P1 |
| RE08 | Unit | `resource.getEntry$(args)` is reactive to resetAll | Create computed using `getEntry$()` → `resetCache()` | Computed returns `null` after reset | P0 |
| RE09 | Unit | `resource.invalidate(args)` — success → refreshing → refetch | Entry in success → `invalidate(args)` | Transitions to MachineRefreshing; queryFn called | P0 |
| RE10 | Unit | `resource.invalidate(args)` — non-success entry: no-op | Entry in pending → `invalidate(args)` | No transition; queryFn not called | P1 |
| RE11 | Unit | Abort: args change cancels inflight request | `query({id:1})` then `query({id:2})` before resolve | First request's AbortSignal aborted | P0 |
| RE12 | Unit | Refresh error (ADR-2): errorHappened on refreshing preserves stale data | Refreshing entry → queryFn rejects | Entry back to MachineSuccess with stale data | P0 |
| RE13 | Unit | Refresh error detected via agent `refreshError` field | Refresh fails → check `agent.state$().refreshError` | `refreshError` contains error value | P1 |
| RE14 | Unit | Resource internal `compareArgs(a, b)` uses configured strategy | Default (shallowEqual): `{ id: 1 }` vs `{ id: 1 }` | `true` | P1 |
| RE15 | Unit | Resource internal `resetCache()` — aborts all, clears GC, completes entries, clears map | Resource with 3 entries → `resetCache()` | All entries completed; cache empty; inflight aborted | P0 |
| RE16 | Unit | Resource internal `cacheEntries()` iterates all entries (for snapshot) | 3 entries → `cacheEntries()` | Iterator yields 3 pairs | P1 |
| RE17 | Unit | Resource internal `hydrateEntry(args, machine)` — creates entry from snapshot | `hydrateEntry({ id: 1 }, MachineSuccess(...))` | Entry exists with success data | P1 |
| RE18 | Unit | Resource internal `hydrateEntry` — skip if entry already exists | Existing entry → `hydrateEntry(sameArgs, ...)` | Existing entry not overwritten | P1 |
| RE19 | Unit | Resource internal `hasEntry(args)` checks existence | After query → `hasEntry(sameArgs)` | `true` | P2 |
| RE23 | Unit | Batcher.run wraps state transitions (batched updates) | Subscribe to signal → trigger query + resolve | Single notification, not intermediate states | P1 |

### Resource — _status$ and _lastEntry$ Signals (ADR-11)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RE24 | Unit | `_status$` starts as "idle" | Fresh resource | `_status$()` returns "idle" | P1 |
| RE25 | Unit | `_status$` transitions to "ready" on first query | `query(args)` | `_status$()` returns "ready" | P1 |
| RE26 | Unit | `_status$` reverts to "idle" on `resetCache()` | After queries → `resetCache()` | `_status$()` returns "idle" | P1 |
| RE27 | Unit | `getEntry$(args)` returns null when _status$ is "idle" | After `resetCache()` | `getEntry$(args)` returns null inside compute | P1 |

### Resource — GC Lifecycle

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| GC01 | Unit | GC timer starts when refcount drops to 0 | Subscribe → unsubscribe → advance timer | Entry deleted after `cacheLifetime` ms | P0 |
| GC02 | Unit | GC timer cancelled when new subscriber arrives | Unsub → timer started → re-subscribe before expiry | Entry preserved | P0 |
| GC03 | Unit | `cacheLifetime: false` disables GC entirely | Entry with zero subs → advance time | Entry not deleted | P1 |
| GC04 | Unit | GC fires: complete(), delete from cache, fire lifecycle hook | GC timer expires | `CacheEntry.complete()` called; `fireCacheEntryRemoved()` called; map does not have entry | P1 |
| GC05 | Edge | Rapid subscribe/unsubscribe — timer resets correctly | Sub → unsub → sub → unsub → advance | Only one GC timer; fires after last unsub + lifetime | P2 |

### Resource — IResourceV2CacheEntry (Consumer-Facing Wrapper)

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RCE01 | Unit | `entry.machine$()` delegates to underlying CacheEntry.state$() | Read machine state | Returns current machine instance | P0 |
| RCE02 | Unit | `entry.peek()` delegates to underlying CacheEntry.peek() | Non-reactive read | Returns machine without subscription | P1 |
| RCE03 | Unit | `entry.isMyArgs(args)` returns true for matching args | Entry for {id:1} → `isMyArgs({id:1})` | `true` | P1 |
| RCE04 | Unit | `entry.isMyArgs(args)` returns false for different args | Entry for {id:1} → `isMyArgs({id:2})` | `false` | P1 |
| RCE05 | Unit | `entry.createPatch(fn)` returns IPatchHandle when data exists | Entry in success → `createPatch(d => d.x = 1)` | Non-null `{ commit, abort }` | P0 |
| RCE06 | Unit | `entry.createPatch(fn)` returns null when no data | Entry in pending → `createPatch(...)` | `null` | P1 |
| RCE07 | Unit | Patch commit/abort lifecycle through entry handle | Create patch → commit | Data includes patch; handle signals committed | P0 |

---

## Test Cases — core Layer: ResourceAgent

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| AG01 | Unit | `agent.start(args)` triggers `resource.query(args)` | `agent.start({ id: 1 })` | `queryFn` called; `agent.state$()` starts pending | P0 |
| AG02 | Unit | `agent.state$` derives flat state from machine | After success | `{ status: "success", data, error: null, args, isLoading: false, isSuccess: true, ... }` | P0 |
| AG03 | Unit | SWR: previous data shown while loading new args | Success for {id:1} → `start({id:2})` | `state$.data === data1` while {id:2} is pending | P0 |
| AG04 | Unit | SWR: previous cleared when current resolves | Success for {id:1} → `start({id:2})` → resolve {id:2} | `state$.data === data2`; no previousData | P0 |
| AG05 | Unit | `isInitialLoading` — true only with no previous data | `start(args)` first time | `isInitialLoading === true` | P0 |
| AG06 | Unit | `isInitialLoading` — false when SWR data exists | Success {id:1} → `start({id:2})` | `isInitialLoading === false` (has previous data) | P1 |
| AG07 | Unit | `start(SKIP)` — agent stays idle | `agent.start(SKIP)` | `state$.status === "idle"`, no fetch | P0 |
| AG08 | Unit | Same args: no re-fetch when already in success/pending | Success → `start(sameArgs)` | `queryFn` not called again | P1 |
| AG09 | Unit | Same args in error state: triggers retry | Error → `start(sameArgs)` | `queryFn` called; transitions to pending | P1 |
| AG10 | Unit | `refreshError` field set on refresh failure | Refresh fails → check `state$.refreshError` | `refreshError` contains error value | P1 |
| AG11 | Unit | `refreshError` cleared on next successful fetch | Refresh fails → then succeeds | `refreshError === null` after success | P1 |
| AG12 | Unit | Rapid arg changes: only latest args tracked | `start(1)` → `start(2)` → `start(3)` quickly | Agent tracks args=3; previous = first settled entry | P1 |
| AG13 | Edge | SWR chain protection: rapid change doesn't accumulate previous entries | `start(1) → start(2) → start(3)` (none resolved) | One `previous`, one `current` — no chain | P2 |
| AG14 | Unit | `agent.state$` is a ComputeFn — reactive to signal changes | Subscribe to `state$.obs` → resolve query | Subscriber receives state transitions | P0 |
| AG15 | Unit | `agent.compareArgs(a, b)` delegates to resource | `agent.compareArgs({ id: 1 }, { id: 1 })` | `true` | P2 |
| AG16 | Unit | `entry` field on agent state provides consumer entry handle | After success | `state$.entry` is `IResourceV2CacheEntry`, non-null | P1 |

---

## Test Cases — core Layer: Operation

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| OP01 | Unit | `operation.execute(args)` — transitions to pending, calls queryFn | `execute({ text: "new" })` | Machine=pending; queryFn called with args | P0 |
| OP02 | Unit | `operation.execute(args)` — success resolves returned promise | Resolve queryFn → data | Promise resolves with data; machine=success | P0 |
| OP03 | Unit | `operation.execute(args)` — error rejects returned promise | Reject queryFn → error | Promise rejects with error; machine=error | P0 |
| OP04 | Unit | `operation.state$` reactive to transitions | Subscribe → execute → resolve | State transitions: idle → pending → success | P0 |
| OP05 | Unit | `operation.reset()` returns to idle | After success → `reset()` | Machine=idle | P1 |
| OP06 | Unit | Concurrent execution: latest-wins (ADR-14) | `execute(args1)` → `execute(args2)` → resolve both | Only args2 result reflected; args1 ignored | P0 |
| OP07 | Edge | Stale response from earlier execution ignored | Resolve args1 after args2 started | State reflects args2's pending, not args1 success | P1 |

### OperationAgent

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| OA01 | Unit | `agent.execute(args)` delegates to operation | `agent.execute({ text: "x" })` | Operation.execute called | P0 |
| OA02 | Unit | `agent.state$` derives from operation state | After execute + resolve | Flat state with status, data, error, isLoading | P0 |

---

## Test Cases — core Layer: LifecycleHooks

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| LH01 | Unit | `fireCacheEntryAdded(args, getCacheEntry)` invokes callback | Callback registered → fire | Callback called with `(args, { cacheEntry, $cacheDataLoaded, $cacheEntryRemoved })` | P0 |
| LH02 | Unit | `$cacheDataLoaded` resolves on first success | Fire → resolve data loaded | Promise resolves with data | P0 |
| LH03 | Unit | `$cacheEntryRemoved` resolves on GC/complete | Fire → complete entry | Promise resolves | P1 |
| LH04 | Unit | `$cacheDataLoaded` rejects if entry removed before any success | Fire → remove without loading | Promise rejects | P1 |
| LH05 | Unit | `fireQueryStarted(args, getCacheEntry)` invokes callback | Callback registered → fire | Callback called with `(args, { cacheEntry, $queryFulfilled })` | P0 |
| LH06 | Unit | `$queryFulfilled` resolves on query success | Fire → resolve query | Promise resolves with data | P0 |
| LH07 | Unit | `$queryFulfilled` rejects on query error | Fire → reject query | Promise rejects with error | P1 |
| LH08 | Unit | `clearAll()` cleans up all pending resolvers | Multiple pending → `clearAll()` | All `$cacheDataLoaded` rejected; all `$cacheEntryRemoved` resolved | P1 |
| LH09 | Unit | Multiple callbacks — all invoked in order | 2 `onCacheEntryAdded` callbacks | Both called in registration order | P2 |

---

## Test Cases — core Layer: Plugins

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| PL01 | Unit | `plugin.install(context)` called during `createApi()` | Plugin with install spy → `createApi({ plugins: [p] })` | `install` called with context | P0 |
| PL02 | Unit | `plugin.augmentResource(resource, options)` called per `createResourceV2()` | Plugin with augment spy → `api.createResourceV2(...)` | `augmentResource` called | P0 |
| PL03 | Unit | Contributions merged via Object.assign onto resource | Plugin returns `{ useHook: fn }` | `resource.useHook` is `fn` | P0 |
| PL04 | Unit | Plugin install called in registration order | `[pluginA, pluginB]` | A.install before B.install | P1 |
| PL05 | Unit | Key collision detection: throws on duplicate contribution keys | Two plugins both returning `{ foo: ... }` | Throws `Error("Plugin key collision: foo")` | P1 |
| PL06 | Unit | ReactHooksPlugin contributes `useResourceV2Agent` method to resource instances via `augmentResource()` | `ReactHooksPlugin` installed → `api.createResourceV2(...)` | Resource instance has `.useResourceV2Agent()` method; operation instances are not augmented by this plugin | P1 |
| PL07 | Edge | Plugin error in `install` propagates | Plugin install throws | `createApi()` throws | P2 |
| PL08 | Edge | Plugin error in `augmentResource` propagates | Plugin augment throws | `api.createResourceV2()` throws | P2 |

---

## Test Cases — api Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| AP01 | Unit | `createApi(options)` returns API with createResourceV2, createOperationV2, resetAll, getSnapshot | Options with keyPrefix | API object with all methods | P0 |
| AP02 | Unit | `api.createResourceV2(options)` validates unique key | Two resources with same key | Throws on duplicate | P0 |
| AP03 | Unit | `api.createResourceV2` merges API defaults with resource options | API `cacheLifetime: 60000` + resource `cacheLifetime: 30000` | Resource uses 30000 (override) | P1 |
| AP04 | Unit | `api.createResourceV2` — resource inherits API-level options | API `keyPrefix: "app"`, resource has no keyPrefix | Resource uses "app" | P1 |
| AP05 | Unit | `api.resetAll()` calls `resetCache()` on all registered resources | 3 resources → `resetAll()` | All 3 reset | P0 |
| AP06 | Unit | `api.getSnapshot()` delegates to snapshot module | 2 resources with success entries → `getSnapshot()` | Returns `TApiSnapshot` with 2 resource entries | P1 |
| AP07 | Unit | `api.createOperationV2(options)` creates Operation instance | Valid options → `createOperationV2(...)` | Operation with execute/state$/reset | P0 |
| AP08 | Unit | `createApi` with `initialSnapshot` hydrates resources on creation | Snapshot with data → `createApi({initialSnapshot})` → `createResourceV2` | Resource has pre-populated entry | P1 |
| AP09 | Edge | `createApi` with empty options uses defaults | `createApi({})` | Default cacheLifetime=60000, keyStrategy="serialize", etc. | P2 |
| AP10 | Edge | `createResourceV2` without key — still works (snapshot limited) | `api.createResourceV2({ queryFn })` (no key) | Resource created; snapshot excludes it | P2 |

---

## Test Cases — react Layer

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| RH01 | Component | `useResourceV2(resource, args)` — renders with pending, then success | Render → resolve | Initial: isLoading=true → rerender: data=resolved data | P0 |
| RH02 | Component | `useResourceV2(resource, SKIP)` — idle state, no fetch | Render with SKIP | status="idle", data=null, isLoading=false; queryFn not called | P0 |
| RH03 | Component | `useResourceV2` — args change triggers new fetch + SWR | Render {id:1} → resolve → rerender {id:2} | Shows data1 while loading data2; then shows data2 | P0 |
| RH04 | Component | `useResourceV2` — unmount cleans up agent/subscription | Render → unmount | No memory leak warnings; refcount decremented | P0 |
| RH05 | Component | `useResourceV2` — same args on rerender: no re-fetch | Render {id:1} → rerender {id:1} | queryFn called once | P1 |
| RH06 | Component | `useResourceV2` void args — no second argument | `useResourceV2(voidResource)` | Works without args; fetch triggered | P1 |
| RH07 | Component | `useOperationV2(operation)` — returns trigger + state | `renderHook(() => useOperationV2(op))` | Returns `[trigger, state]`; trigger is callable | P0 |
| RH08 | Component | `useOperationV2` — trigger executes and state updates | Call trigger → resolve | State: idle → pending → success | P0 |
| RH09 | Component | Multiple components sharing same resource/args — single fetch | Two renderHook with same resource+args | queryFn called once; both hooks receive same data | P1 |
| RH10 | Component | `useSyncExternalStore` tearing protection | Concurrent-mode scenario: signal updates mid-render | No tearing: both components see consistent state | P1 |
| RH11 | Component | Error boundary: hook does not throw on error state | queryFn rejects | status="error", isError=true; no throw | P1 |
| RH12 | Edge | Rapid unmount/remount — no stale callbacks | Mount → unmount → mount quickly | No stale subscriptions; clean state | P2 |

---

## Test Cases — Snapshot

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| SN01 | Unit | `getSnapshot()` captures only success entries | 1 success + 1 pending entry | Snapshot includes 1 entry | P0 |
| SN02 | Unit | `getSnapshot()` includes version and keyPrefix | API with keyPrefix="app" | `{ version: 1, keyPrefix: "app", resources: {...} }` | P0 |
| SN03 | Unit | `hydrateSnapshot()` reconstructs machine instances | Valid snapshot → hydrate | Entries hydrated as MachineSuccess with correct data | P0 |
| SN04 | Unit | `hydrateSnapshot()` throws on version mismatch | Snapshot with version=99 | Throws error | P0 |
| SN05 | Unit | `hydrateSnapshot()` throws on keyPrefix mismatch | API prefix="a", snapshot prefix="b" | Throws error | P1 |
| SN06 | Unit | `hydrateSnapshot()` warns on unknown resource key | Snapshot with key not in registry | `console.warn` called; continues without error | P1 |
| SN07 | Unit | `hydrateSnapshot()` skips existing entries | Entry already cached → hydrate same args | Existing entry not overwritten | P1 |
| SN08 | Unit | `maxSnapshotDataAge`: expired entry auto-invalidated | Entry hydrated with old updatedAt; maxAge=1000 | `resource.invalidate()` called for that entry | P1 |
| SN09 | Unit | Full round-trip: getSnapshot → JSON.stringify → JSON.parse → hydrateSnapshot | Capture → serialize → deserialize → hydrate | Hydrated data matches original data | P0 |
| SN10 | Unit | `getSnapshot()` throws for compare strategy resources | Resource with keyStrategy="compare" | Throws error about non-serializable keys | P1 |

---

## Test Cases — Integration

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| INT01 | Integration | Full pipeline: createResourceV2 → query → cache → agent.state$ → data | Create resource → agent.start → resolve → read state | Agent state has correct data; cache entry in success | P0 |
| INT02 | Integration | Full pipeline: React hook → fetch → render → rerender with new args | `renderHook(useResourceV2)` → resolve → rerender new args | SWR shows old data; then new data after resolve | P0 |
| INT03 | Integration | Cross-resource invalidation: operation success → invalidate resource | Create operation + resource → execute op → invalidate resource | Resource re-fetches after op succeeds | P1 |
| INT04 | Integration | Plugin + cache + hook: ReactHooksPlugin contributes working hooks | `createApi({ plugins: [new ReactHooksPlugin()] })` → `resource.useResourceV2Agent(args)` in renderHook | Hook works, data flows through | P1 |
| INT05 | Integration | Snapshot SSR round-trip: server capture → client hydrate → React render | Server: query → getSnapshot; Client: hydrateSnapshot → renderHook | Client renders hydrated data without fetch | P0 |
| INT06 | Integration | GC under component lifecycle: mount→data→unmount→timer→remount | Mount → get data → unmount → wait half lifetime → remount | Data still cached (timer not expired) | P1 |
| INT07 | Integration | GC under component lifecycle: mount→data→unmount→timer expires | Mount → get data → unmount → wait full lifetime | Entry GC'd; remount triggers new fetch | P1 |
| INT08 | Integration | Optimistic update + rollback via entry.createPatch | Resource with data → createPatch → abort → check data rolled back | Data returns to original after abort | P1 |
| INT09 | Integration | Optimistic update + commit | Resource with data → createPatch → commit → check data includes patch | Data includes committed patch | P1 |
| INT10 | Integration | Consistency violation → auto-invalidation → fresh data | Multi-patch → out-of-order abort → violation → refetch | Resource auto-invalidates; fresh data replaces patched | P1 |
| INT11 | Integration | resetAll → all agents see idle, all entries cleared | 3 resources with data → `api.resetAll()` | All agents: status="idle"; all caches empty | P0 |
| INT12 | Integration | Multiple agents on same resource — shared cache, independent SWR | 2 agents for same resource, different args | Shared cache entries; each agent has own previous/current | P1 |
| INT13 | Integration | Abort signal propagated to queryFn on args change | Agent.start(args1) → agent.start(args2) before resolve | args1 queryFn receives aborted signal | P1 |
| INT14 | Integration | Lifecycle hooks fired in correct order during full lifecycle | `onCacheEntryAdded` + `onQueryStarted` callbacks | Added fires first; queryStarted fires on query; promises resolve in order | P2 |
| INT15 | Integration | Plugin augmentResource called with all api-level defaults merged | Plugin inspects options in augmentResource | options contain merged defaults | P2 |

---

## Edge Cases

| ID | Category | Description | Test Strategy | Priority |
|----|----------|-------------|---------------|----------|
| E01 | Edge | queryFn throws synchronously (not async rejection) | Wrap in try/catch; verify transitions to error | P1 |
| E02 | Edge | queryFn returns rejected promise immediately | Resolve in same microtask; verify state transitions | P1 |
| E03 | Edge | `null` / `undefined` as valid TData | Query resolves with null → verify success state with data=null | P2 |
| E04 | Edge | Very large args object — serialization performance | Profile stableStringify with 1000-key object | P3 |
| E05 | Edge | Resource created but never queried — no leaks | Create resource → dispose | No timers, no signal subscriptions leaked | P2 |
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

End-to-end correctness is verified by running the full integration test suite (`INT01`–`INT15`) which covers the complete data flow from API creation through React rendering. Key correctness invariants:

1. **State machine consistency**: Every CacheEntry always contains a valid `TMachineInstance`; no intermediate/invalid states observable from outside `Batcher.run()`.
2. **Cache correctness**: Same args → same entry (serialize) or same entry (compare); different args → different entries. No cross-contamination.
3. **SWR correctness**: Previous data always available during loading when a previous success existed; previous data cleared only after current resolves.
4. **Snapshot fidelity**: Data survives round-trip through `JSON.stringify`/`JSON.parse` without loss or mutation.
5. **GC safety**: No entry is GC'd while any subscriber or lock holds a reference; all entries are GC'd when no references and timer expires.
6. **Patch integrity**: Committed patches are permanent; aborted patches are fully reversed; consistency violations detected and trigger invalidation.
7. **React consistency**: `useSyncExternalStore` prevents tearing; hooks clean up subscriptions on unmount.
