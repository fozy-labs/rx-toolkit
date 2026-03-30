---
title: "Problem Analysis: LifecycleHooks Ownership & Demo isError"
date: 2026-03-29
stage: 01-research
role: rdpi-problem-analyst
---

## Problem #5 — LifecycleHooks belongs to Resource, not ResourceEntry

### Reported Problem

`LifecycleHooks` should belong to `ResourceEntry`, not the resource. Currently a single `LifecycleHooks` instance is shared across all cache entries of a resource.

### Expected vs Actual

- **Expected**: Each `ResourceV2CacheEntry` owns its own lifecycle hook state, scoping promise-based tools (`$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`) to their specific entry.
- **Actual**: A single `LifecycleHooks` instance is created at the `ResourceV2` level ([ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L44)) and shared by all entries. Hook resolver Maps use `TArgs` as keys with `===` identity, meaning all lifecycle state is keyed by args reference — not by entry.

### Reproduction Status

- **Status**: Reproduced (structural analysis — no runtime reproduction needed)
- **Environment / Inputs**: Source analysis of `src/query-v2/core/`
- **Commands / Checks Run**: File reads and grep of call sites

### Failure Path

1. **Instantiation**: `ResourceV2` constructor creates one `LifecycleHooks<TArgs, TData>` instance:
   - [ResourceV2.ts#L44](src/query-v2/core/resource/ResourceV2.ts#L44): `this._lifecycleHooks = new LifecycleHooks<TArgs, TData>(options.onCacheEntryAdded, options.onQueryStarted)`

2. **Internal state in LifecycleHooks uses `Map<TArgs, Resolvers>`**:
   - [LifecycleHooks.ts#L27](src/query-v2/core/LifecycleHooks.ts#L27): `private _entryResolvers = new Map<TArgs, EntryResolvers<TData>>()`
   - [LifecycleHooks.ts#L28](src/query-v2/core/LifecycleHooks.ts#L28): `private _queryResolvers = new Map<TArgs, QueryResolvers<TData>>()`
   - `Map` uses `===` for key identity. For object args, two structurally-equal but referentially-distinct args objects produce different Map keys.

3. **Factory wires entry callbacks to the shared LifecycleHooks via closures**:
   - [ResourceV2.ts#L159-L161](src/query-v2/core/resource/ResourceV2.ts#L159-L161):
     ```
     onDataLoaded: (a, data) => this._lifecycleHooks.resolveDataLoaded(a, data)
     onQueryStarted: (a, entry) => this._lifecycleHooks.fireQueryStarted(a, entry)
     onQueryFulfilled: (a, result) => this._lifecycleHooks.resolveQueryFulfilled(a, result)
     ```
   - [ResourceV2.ts#L167](src/query-v2/core/resource/ResourceV2.ts#L167): `this._lifecycleHooks.fireCacheEntryAdded(args, entry)`
   - [ResourceV2.ts#L170](src/query-v2/core/resource/ResourceV2.ts#L170): `entry.onClean$.subscribe(() => { ... this._lifecycleHooks.fireCacheEntryRemoved(args); })`

4. **ResourceV2CacheEntry does NOT own or reference LifecycleHooks**:
   - [ResourceV2CacheEntry.ts#L48-L50](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L48-L50): stores only individual callback functions (`_onDataLoaded`, `_onQueryStarted`, `_onQueryFulfilled`), not the hooks class
   - The entry invokes these callbacks in `_doFetch()`, passing `this._args` as the key:
     - [ResourceV2CacheEntry.ts#L162](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L162): `this._onQueryStarted?.(this._args, this)`
     - [ResourceV2CacheEntry.ts#L200-L201](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L200-L201): `this._onDataLoaded?.(this._args, data)` and `this._onQueryFulfilled?.(this._args, { data })`

5. **Why this is problematic — shared state leads to cross-entry interference**:
   - **`_entryResolvers` keyed by args**: When `fireCacheEntryAdded(args, entry)` is called for a new entry, it does `this._entryResolvers.set(args, ...)` ([LifecycleHooks.ts#L41](src/query-v2/core/LifecycleHooks.ts#L41)). If the same args reference is used later in `resolveDataLoaded(args, data)` ([LifecycleHooks.ts#L76](src/query-v2/core/LifecycleHooks.ts#L76)), the resolver is found.
   - **`_queryResolvers` keyed by args**: `fireQueryStarted` creates a new resolver Map entry per query ([LifecycleHooks.ts#L60](src/query-v2/core/LifecycleHooks.ts#L60)). On the next `fireQueryStarted` call with the same args (e.g., invalidate → refetch), the old Map entry is **silently overwritten** — the previous `$queryFulfilled` promise is never resolved or rejected, leaking a pending promise.
   - **For `void` args resources** (e.g., `createResourceV2<void, TData>`): args is always `undefined`, so all operations collapse to a single Map key. This works incidentally for single-entry resources but is semantically wrong — the class uses args as a proxy for entry identity.
   - **If entry is deleted then re-created with structurally equal but referentially different args**: `fireCacheEntryRemoved(oldArgs)` cleans up the old resolver, but `fireCacheEntryAdded(newArgs)` creates a separate entry under the new reference. This can lead to stale resolvers if the reference coincidentally matches (e.g., interned strings, primitives).
   - **resetCache**: `clearAll()` cleans up all resolvers at once ([ResourceV2.ts#L113](src/query-v2/core/resource/ResourceV2.ts#L113), [LifecycleHooks.ts#L106-L117](src/query-v2/core/LifecycleHooks.ts#L106-L117)), which is correct for a resource-level clear, but the per-entry semantics are still broken for concurrent entries with different args.

6. **Type-level ownership signals**:
   - [lifecycle.types.ts](src/query-v2/types/lifecycle.types.ts): `TOnCacheEntryAdded` and `TOnQueryStarted` are scoped by `(args, tools)` — the callback signature implicitly ties to an entry via args.
   - [resource.types.ts#L24-L25](src/query-v2/types/resource.types.ts#L24-L25): `onCacheEntryAdded` and `onQueryStarted` are declared on `TResourceV2Options` (resource-level), not on any entry-level options type.
   - `IResourceV2CacheEntry` interface ([resource.types.ts#L61-L73](src/query-v2/types/resource.types.ts#L61-L73)) has no lifecycle hooks property.

### Test Evidence

- **Relevant tests found**: [src/query-v2/core/__tests__/LifecycleHooks.test.ts](src/query-v2/core/__tests__/LifecycleHooks.test.ts)
- **Failing test cases**: None. LH01–LH09b test the LifecycleHooks class in isolation with a single args reference — they never test multiple concurrent entries.
- **Gap**: No test verifies:
  - Multiple entries sharing one LifecycleHooks instance
  - `fireQueryStarted` overwriting a prior unresolved `$queryFulfilled` for the same args (stale promise leak)
  - LifecycleHooks behavior when entry ownership differs from args key identity

### Scope Boundaries

- Analyzed: `LifecycleHooks.ts`, `ResourceV2.ts` (constructor + `_entryFactory`), `ResourceV2CacheEntry.ts` (callback invocations), type definitions in `lifecycle.types.ts` and `resource.types.ts`.
- Audited: Plugin system (`@/query-v2/plugins/`). `ReactHooksPlugin` is the only plugin. It does not import, reference, or invoke any `LifecycleHooks` symbol, lifecycle types, or hook callbacks. The `IPlugin` interface (`install` + `augmentResource`) exposes no lifecycle surface. The plugin system is orthogonal to `LifecycleHooks`. See `01-codebase-analysis.md` §Area C "Plugin directory audit" for full evidence.
- Not analyzed: DevtoolsPlugin interaction with lifecycle hooks, Snapshot hydration interaction with lifecycle.

---

## Problem #6 — Demo examples: `isError` is always `false`

### Reported Problem

In query-v2 interactive examples, the agent incorrectly implemented cases with `isError: false` — `isError` will always be false in these examples.

### Expected vs Actual

- **Expected**: Demo examples labeled as "error/SWR state" demonstrations should show `isError: true` at some point during user interaction, so users can observe error state behavior.
- **Actual**: In all demo examples, `isError` is always `false` (or effectively unreachable). The demos display `isError: {String(state.isError)}` but the value never becomes `true` during normal interaction.

### Reproduction Status

- **Status**: Reproduced (static analysis of code paths; confirmed by tracing machine state transitions)
- **Environment / Inputs**: Source analysis of `apps/demos/src/examples/query-v2/*.tsx` and `src/query-v2/core/resource/`
- **Commands / Checks Run**: Read all 8 demo files, traced `isError` derivation in `ResourceV2Agent._deriveState$()`

### Failure Path

**Root cause — `isError` derivation**:

`isError` is `true` **only when** `originalStatus === "error"` ([ResourceV2Agent.ts#L153](src/query-v2/core/resource/ResourceV2Agent.ts#L153)). `originalStatus` becomes `"error"` **only when** the machine transitions to `MachineError`, which only happens when:
1. The queryFn throws/rejects **on a pending entry** (first fetch, or after `MachineError` → retry) — [ResourceV2CacheEntry.ts#L225](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L225): `this.set(new MachineError(...))`
2. If the entry is in `refreshing` state (was previously successful) and the query errors, it transitions to `MachineSuccess` with `lastError`, NOT `MachineError` — [ResourceV2CacheEntry.ts#L215-L221](src/query-v2/core/resource/ResourceV2CacheEntry.ts#L215-L221): `this.set(new MachineSuccess(this._args, machine.data, machine.patchState, machine.updatedAt, error))`. This means `originalStatus` is `"success"`, so `isError: false`.

**Per-example analysis**:

#### 1. `error-swr-states.tsx` — the primary error demo

- **queryFn**: `fetchCount++`; throws when `fetchCount % 2 === 0` ([error-swr-states.tsx#L22-L26](apps/demos/src/examples/query-v2/error-swr-states.tsx#L22-L26))
- **On mount**: `fetchCount` goes from 0 → 1. `1 % 2 === 0` is `false` → **succeeds** → `MachineSuccess` → `isError: false`
- **First invalidate**: `fetchCount` → 2. `2 % 2 === 0` is `true` → throws. But the entry is in `success` state → transitions to `refreshing` → error handler creates `MachineSuccess(…, error)` → `originalStatus: "success"` → **`isError: false`**
- **Second invalidate**: `fetchCount` → 3. `3 % 2 === 0` is `false` → succeeds → **`isError: false`**
- **Pattern repeats**: Every odd fetch succeeds, every even fetch errors during refreshing. `isError` is **never `true`**.
- **`isError` display**: Line 66-67 always shows `isError: false`. Error banner at line 75 (`{state.isError && (...)}`) never renders.
- **`isError` in log**: Line 42 logs `isError=${state.isError}` — always `false`.

#### 2. `lifecycle-hooks.tsx`

- **queryFn**: `queryCount++`; throws when `num % 3 === 0` ([lifecycle-hooks.tsx#L65-L68](apps/demos/src/examples/query-v2/lifecycle-hooks.tsx#L65-L68))
- **On mount**: `queryCount` → 1. `1 % 3 === 0` is `false` → **succeeds**.
- **Invalidate clicks**: Errors on query #3, #6, #9, etc. — but entry is already in `success` → refreshing → `MachineSuccess` with `lastError` → `isError: false`.
- **Exception**: After `api.resetAll()`, cache is cleared. The next mount creates a new entry with `pending` status. If `queryCount` at that moment is a multiple of 3, the first fetch errors on a `pending` entry → `MachineError` → `isError: true`. But this is **unreliable** and depends on how many invalidations the user performed before reset.
- **`isError` display**: Lines 145-146 and error banner at line 160.
- **Verdict**: `isError` is `false` in all normal interaction. Technically reachable via very specific `resetAll` + queryCount alignment, but this is incidental, not designed.

#### 3. `basic-query.tsx`

- **queryFn**: Uses `fetches.getItems` which always resolves.
- **`isError` display**: Lines 32-33 — always `false`.
- **Verdict**: **Never `true`**.

#### 4. `simple-resource.tsx`

- **queryFn**: Uses `fetches.getItems` which always resolves.
- **Verdict**: **Never `true`** (no `isError` display found in grep results).

#### 5. `skip-token.tsx`

- **queryFn**: Uses `fetches.getUser` which always resolves.
- **Verdict**: **Never `true`** (no `isError` display found in grep results).

#### 6. `optimistic-patches.tsx`

- **queryFn**: `JSON.parse(JSON.stringify(mockTodoList))` — always resolves ([optimistic-patches.tsx#L35-L37](apps/demos/src/examples/query-v2/optimistic-patches.tsx#L35-L37)).
- **`isError` display**: Line 106 — early return showing error card that never appears.
- **Verdict**: **Never `true`**.

#### 7. `ssr-snapshot.tsx`

- **queryFn**: Always resolves after 2s delay ([ssr-snapshot.tsx#L62-L67](apps/demos/src/examples/query-v2/ssr-snapshot.tsx#L62-L67)).
- **`isError` display**: Line 85 — never renders.
- **Verdict**: **Never `true`**.

#### 8. `snapshot-hydration.tsx`

- Not analyzed in detail; codebase analysis confirms queryFn always resolves.
- **Verdict**: **Never `true`**.

### Summary

| Example | queryFn can throw? | First fetch errors? | `isError` reachable? | `isError` display lines |
|---|---|---|---|---|
| error-swr-states | Yes (even fetchCount) | No (fetchCount=1) | **No** — errors only on refreshing | L42, L66-67, L75, L101 |
| lifecycle-hooks | Yes (every 3rd) | No (queryCount=1) | Unreliable (only after resetAll + alignment) | L145-146, L160 |
| basic-query | No | N/A | **No** | L32-33 |
| simple-resource | No | N/A | **No** | — |
| skip-token | No | N/A | **No** | — |
| optimistic-patches | No | N/A | **No** | L106 |
| ssr-snapshot | No | N/A | **No** | L85 |
| snapshot-hydration | No | N/A | **No** | — |

The core issue in the two "error" demos (`error-swr-states`, `lifecycle-hooks`): the queryFn is designed to succeed on the first call and error on subsequent calls. Because the first call succeeds, the entry reaches `MachineSuccess`. All subsequent errors occur during `refreshing`, which yields `MachineSuccess` with `lastError` (SWR semantics), keeping `originalStatus === "success"` and `isError: false`.

For `isError` to become `true`, the **first** fetch for a cache entry must fail (producing `MachineError` from `MachinePending`).

### Test Evidence

- **Relevant tests found**: No automated tests exist for the demo examples in `apps/demos/`.
- **Failing test cases**: None.
- **Gap**: Demo behavior is only observable through manual browser interaction. No integration test validates that `isError` becomes `true` in any demo scenario.

### Scope Boundaries

- Analyzed: All 8 files in `apps/demos/src/examples/query-v2/`, `ResourceV2Agent._deriveState$()`, `ResourceV2CacheEntry._doFetch()` error handling paths, machine state transition logic.
- Not analyzed: `apps/demos/src/utils/fetches.ts` was referenced from codebase analysis but not directly read (codebase analysis confirms always-resolving behavior). Demos outside `query-v2/` folder were not checked.
