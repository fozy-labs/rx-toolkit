---
title: "Risk Analysis: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-qa-designer
---

# Risk Analysis

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R1 | CompareCacheMap Map semantics: reference identity differs from comparison equality — structurally-equal but referentially-distinct args create duplicate cache entries | High | High | Mitigate | Reference stability patterns; agent-level dedup via `compareArgs`; documentation |
| R2 | Factory signature change `(args) → (args, argsKey)`: all CacheMap implementations, tests, and consumers must update simultaneously | Medium | High | Mitigate | Narrow change scope (2 CacheMap classes + 1 consumer); coordinated update; compile-time verification |
| R3 | LifecycleHooks elimination: `ResourceV2CacheEntry` gains resolver responsibility — potential for missed resolver settlement paths | Medium | High | Mitigate | Per-entry invariant tests (LH24); `complete()` as universal cleanup; INV-LH4 enforcement |
| R4 | Monotonic counter persistence across `resetCache` / `clear()`: counter continues vs resets | Low | Medium | Mitigate | Design specifies continue (INV-CM1); test CM43 verifies; document behavior |
| R5 | Demo `isError` → `isRefreshError` change: some demo may rely on specific `isError` state for conditional rendering | Low | Low | Accept | Static analysis shows no demo reaches `isError: true`; changes replace dead code with live SWR indicators |
| R6 | Snapshot guard logic change: `typeof key !== "string"` guard no longer distinguishes strategies since `argsKey` is always a string | Medium | Medium | Mitigate | Snapshot guard checks resource's `keyStrategy` or other mechanism; IT05 covers |
| R7 | `entries()` removal: unaudited consumers of `cacheEntries()` may break | Low | Medium | Mitigate | grep_search for all `cacheEntries` / `entries()` usages before implementation; IT06 verifies `createApi` path |
| R8 | Custom `devtoolsKey` returns non-unique values — multiple Signal states share same key | Low | Low | Accept | User responsibility (INV-F4); counter default avoids this; document uniqueness requirement |
| R9 | Hydration path with per-entry lifecycle: `$cacheDataLoaded` must resolve immediately for hydrated `MachineSuccess` entries | Medium | Medium | Mitigate | 09-corrections.md already identified this; LH30 verifies; `_fireCacheEntryAdded` checks `peek().status` |
| R10 | `LifecycleHooks.test.ts` replacement: existing LH01–LH09b tests cover class that is being deleted — requires full rewrite | Medium | Low | Accept | Tests are replaced by LH10–LH26 (per-entry lifecycle); old tests become invalid by design |

---

## Detailed Mitigation Plans

### R1: CompareCacheMap Map semantics — reference identity vs structural equality

**Risk description**: The redesigned `CompareCacheMap` uses `Map<TArgs, TEntry>` with reference identity (`===`). Users accustomed to `compareArg`-based structural deduplication (current behavior) may unknowingly create duplicate entries by passing structurally-equal but referentially-distinct args objects. In React components, each render can create a new args object literal `{id: userId}`, bypassing the cache.

**Probability justification**: High — this is a deliberate semantic change from current behavior. Any user with compare-strategy resources who creates args inline will see changed behavior [ref: ../01-research/02-problem-analysis-cache.md#Problem #1].

**Impact justification**: High — duplicate entries mean duplicate network requests, duplicate memory, and confusing devtools state. However, the `ResourceV2Agent` layer uses `compareArgs` (`shallowEqual`) to skip redundant `start()` calls [ref: 05-usecases.md#UC1], which limits the blast radius for React hook users.

**Mitigation steps**:

1. **Agent-level deduplication preserved**: `ResourceV2Agent.start()` uses `compareArgs` (kept on entry options) to detect logically-equivalent args and reuse the existing entry reference. React users primarily interact through `useResourceV2Agent`, which goes through the agent. This is the primary safety net. Verify with IT01.

2. **Documentation**: Update `docs/query-v2/README.md` Cache Strategies section to clearly state that compare strategy uses reference identity for cache keys. Warn against inline args objects outside of hooks. Recommend `useMemo` or stable reference patterns [ref: 07-docs.md].

3. **`cacheLifetime` eviction**: Duplicate entries created by reference mismatch are evicted by the existing `cacheLifetime` mechanism (default 60s). This bounds memory growth. Not a fix, but limits damage.

4. **Test verification**: CM22 directly tests that structurally-equal but referentially-distinct args produce separate entries — this is expected behavior, not a bug. The test documents the semantic change.

**Responsible**: Implementation phase (codder) for agent-level verification; documentation update (docs phase).

**Verification criteria**: CM20–CM22 pass; IT01 demonstrates agent reuse with compare strategy; documentation updated.

---

### R2: Factory signature change — coordinated update

**Risk description**: `TCacheMapFactory<TArgs, TEntry>` changes from `(args: TArgs) => TEntry` to `(args: TArgs, argsKey: string) => TEntry`. All call sites must update simultaneously. If any call site passes the old arity, it silently receives `undefined` as `argsKey` (JavaScript doesn't enforce arity).

**Probability justification**: Medium — the change scope is narrow (2 CacheMap implementations + ResourceV2 factory closure), but JavaScript's loose arity means a forgotten update produces runtime `undefined` instead of compile error. TypeScript catches this at compile time if types are correct.

**Impact justification**: High — if `argsKey` is `undefined`, Signal keys become `"Resource/:users/:undefined"`, devtools display is broken, and Snapshot may produce incorrect keys.

**Mitigation steps**:

1. **TypeScript compile-time enforcement**: The `TCacheMapFactory` type change guarantees that all factory functions must accept two parameters. Any mismatched call site produces a compile error `TS2554: Expected 2 arguments, but got 1`. Run `tsc --noEmit` after the change to catch all violations.

2. **Change scope audit**: Three call sites exist [ref: 03-model.md#10]:
   - `CompareCacheMap.getOrCreate` — passes `argsKey` derived from counter/devtoolsKey
   - `SerializeCacheMap.getOrCreate` — passes `key` from `_getKey(args)`
   - `ResourceV2` factory closure — now `(args, argsKey) => this._entryFactory(args, argsKey)` (passthrough)

3. **Test verification**: CM50 (SerializeCacheMap passes key), CM40 (CompareCacheMap passes counter), both verify factory receives correct `argsKey`. CM51 verifies serialization count.

**Responsible**: Implementation phase (codder) applies all three changes atomically.

**Verification criteria**: `tsc --noEmit` passes; CM40, CM50, CM51 pass; no `"undefined"` in any Signal key.

---

### R3: LifecycleHooks elimination — resolver settlement completeness

**Risk description**: Moving resolver state from a dedicated `LifecycleHooks` class to `ResourceV2CacheEntry` fields means every code path that terminates an entry must settle resolvers. If any path misses a settlement, promises leak (never resolve/reject). The key paths are: (a) successful fetch, (b) failed fetch, (c) `complete()` from GC/resetCache, (d) refetch (invalidate → new `_doFetch`).

**Probability justification**: Medium — there are 4 distinct paths that interact with 3 resolver types. The design (03-model.md §4.4–4.7) specifies each path explicitly, but implementation error is possible.

**Impact justification**: High — leaked promises prevent `onCacheEntryAdded` and `onQueryStarted` callbacks from completing. User code awaiting `$cacheDataLoaded` or `$queryFulfilled` hangs indefinitely. Memory leak from unresolved promise subscription chains.

**Mitigation steps**:

1. **`complete()` as universal safety net**: `complete()` settles ALL pending resolvers regardless of current state [ref: 03-model.md#4.5]. Even if a specific code path misses settlement, `complete()` from GC or `resetCache` catches it. INV-LH4 mandates this.

2. **Resolver state nullification**: Each resolver is set to `null` after settlement. This prevents double-resolution and makes state inspection trivial (non-null = pending).

3. **Refetch rejection before creation**: `_doFetch` explicitly rejects `_queryFulfilled` before creating a new one (INV-LH3). This handles the "invalidate during inflight" path [ref: 03-model.md#4.4].

4. **Test matrix**: LH10–LH26 cover all paths:
   - LH11/LH16: success path → resolvers settle
   - LH17: error path → `$queryFulfilled` rejects
   - LH14: `complete()` with unresolved `$cacheDataLoaded`
   - LH18: refetch → old resolver rejected
   - LH24: `complete()` with all resolvers pending → all settled
   - LH20: concurrent entries → isolation

5. **Edge case: `complete()` called during `_doFetch`**: The abort controller fires, queryFn receives abort signal, and `complete()` settles all resolvers. The `.catch()` handler in `_doFetch` finds `_queryFulfilled === null` and skips. No double settlement.

**Responsible**: Implementation phase (codder) implements `ResourceV2CacheEntry` lifecycle; tester runs LH10–LH26.

**Verification criteria**: All LH10–LH26 pass; IT04 (`resetCache` settles all) passes; no unhandled promise rejections in test output.

---

### R6: Snapshot guard logic — `argsKey` is always a string

**Risk description**: Current Snapshot guard checks `typeof key !== "string"` to detect compare-strategy entries (which yield `TArgs` objects as keys). After the change, `entry.argsKey` is always a string — counter string for compare, serialized string for serialize. The guard can no longer distinguish strategies this way.

**Probability justification**: Medium — the Snapshot code will compile and run, but the guard logic change needs explicit attention. Without it, compare-strategy snapshots silently produce counter-keyed entries (e.g., `{"0": {...}, "1": {...}}`) instead of throwing.

**Impact justification**: Medium — SSR with compare strategy produces meaningless snapshot keys. The existing behavior already throws for compare strategy, so the fix is to preserve the throw with a different guard mechanism.

**Mitigation steps**:

1. **Strategy-aware guard**: `Snapshot.getSnapshot` receives the resource and can check `resource.keyStrategy` (or a new method/field). Alternatively, the guard can check that `argsKey` looks like a valid JSON string (serialize strategy produces JSON; counter produces numeric strings).

2. **Architecture note**: 03-model.md §6.1 Note acknowledges this: "A refined guard may be needed during implementation." The implementation phase decides the specific mechanism.

3. **Test verification**: IT05 verifies Snapshot with serialize strategy works. A separate test should verify that compare strategy Snapshot still throws (or handles gracefully).

**Responsible**: Implementation phase (codder) updates Snapshot guard logic.

**Verification criteria**: IT05 passes; Snapshot with compare-strategy resource either throws or produces documented behavior.

---

### R9: Hydration path — `$cacheDataLoaded` immediate resolution

**Risk description**: When an entry is created via `hydrateEntry()` with `initialMachine: MachineSuccess`, `_doFetch()` is NOT called. If `_fireCacheEntryAdded` doesn't check the initial machine state, `$cacheDataLoaded` stays pending forever — user's `onCacheEntryAdded` callback hangs.

**Probability justification**: Medium — this edge case was identified during design (09-corrections.md: Correction Tier 5) and the fix was added to `_fireCacheEntryAdded` code sample. But implementors may miss this detail.

**Impact justification**: Medium — hydration is a specific SSR scenario. Users relying on `onCacheEntryAdded` + `$cacheDataLoaded` in SSR/hydration flows would experience silent hangs.

**Mitigation steps**:

1. **Design specifies the check**: 03-model.md §4.3 includes: `if (machine.status === "success" && this._entryDataLoaded) { this._entryDataLoaded.resolve(machine.data); }` — this runs at the end of `_fireCacheEntryAdded`, checking the initial machine state.

2. **Test verification**: LH30 is the direct test — hydrated entry with `MachineSuccess` → `$cacheDataLoaded` resolves immediately.

3. **Correction log reference**: 09-corrections.md documents this fix explicitly — implementation phase should cross-reference.

**Responsible**: Implementation phase (codder) implements `_fireCacheEntryAdded` with hydration check; tester runs LH30.

**Verification criteria**: LH30 passes; LH31 confirms no `_doFetch` on hydrated entries; LH33 confirms subsequent invalidation works.
