---
title: "CacheEntry & Machine Hierarchies — Deep Comparison"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

`CacheEntry` is a thin reactive wrapper (Signal + RxJS share/GC). Both `ResourceCacheEntry` and `CommandCacheEntry` extend it and independently re-implement abort management, lifecycle hooks (`_fireCacheEntryAdded`, `complete()` resolver cleanup), and `PromiseResolver`-based lifecycle promises. The two machine hierarchies are fully disjoint: Resource uses a `MachineWithData` abstract base (4 classes: Pending, Success, Error, Refreshing) with built-in patch support; Command uses 4 standalone classes (Idle, Loading, Success, Error) with no shared base and no built-in patching.

---

## 1. CacheEntry Base Class — Full API

**File**: `@/src/query/core/CacheEntry.ts:1-74` (74 lines total)

### Fields

| Field | Visibility | Type | Line | Purpose |
|---|---|---|---|---|
| `_state$` | private | `SignalFn<TState>` | :12 | Core signal holding the state value |
| `_isCompleted` | private | `boolean` | :13 | Prevents `set()` after `complete()` |
| `_cacheLifetime` | private | `number \| false` | :14 | GC timer delay (default `60_000`) |
| `onClean$` | readonly public | `Subject<void>` | :16 | Fires on `complete()` — GC hook |
| `obs` | readonly public | `Observable<TState>` | :17 | RxJS shared observable with GC timer |
| `state$` | readonly public | `ReadableSignalFnLike<TState>` | :18 | Signal derived from `obs` via `signalize()` |

### Methods

| Method | Visibility | Line | What it does |
|---|---|---|---|
| `constructor(initialState, options?)` | public | :20-46 | Creates `Signal.state`, pipes through `finalize→complete`, `share({ReplaySubject, resetOnRefCountZero})`, `signalize` |
| `peek()` | public | :49 | Non-reactive read via `_state$.peek()` |
| `set(state)` | public | :53-55 | Write to signal; no-op if `_isCompleted` |
| `complete()` | public | :58-62 | Fires `onClean$.next()` + `onClean$.complete()`, sets `_isCompleted=true` |
| `_getResetOnRefCountZero()` | private | :64-68 | Returns `false` / `true` / `() => timer(lifetime)` based on `_cacheLifetime` |

### What subclasses override

| Override point | ResourceCacheEntry | CommandCacheEntry |
|---|---|---|
| `complete()` | **Yes** — aborts inflight, clears patch state, resolves/rejects 3 PromiseResolvers, then calls `super.complete()` | **Yes** — aborts inflight, rejects trigger resolver, resolves/rejects 3 PromiseResolvers, then calls `super.complete()` |
| `peek()` | No | No |
| `set()` | No | No |

### What subclasses re-implement identically (duplication)

Both subclasses independently add:
- `_abortController: AbortController | null` — same pattern, same null init
- `_entryDataLoaded: PromiseResolver<T> | null` — same lifecycle promise
- `_entryRemoved: PromiseResolver<void> | null` — same lifecycle promise
- `_queryFulfilled: PromiseResolver<{data: T}> | null` — same lifecycle promise
- `_fireCacheEntryAdded()` — structurally identical (create resolvers, call callback, catch errors)
- `complete()` override cleanup sequence for the 3 PromiseResolvers — nearly identical code

---

## 2. ResourceCacheEntry vs CommandCacheEntry — Line-by-Line Comparison

### 2.1 Class Declaration & Generics

| Aspect | ResourceCacheEntry | CommandCacheEntry |
|---|---|---|
| **File** | `@/src/query/core/Resource/ResourceCacheEntry.ts` | `@/src/query/core/command/CommandCacheEntry.ts` |
| **Line count** | ~290 lines | ~280 lines |
| **Extends** | `CacheEntry<TMachineInstance<TArgs, TData>>` (:41) | `CacheEntry<TCommandMachineInstance<TArgs, TResult>>` (:27) |
| **Implements** | `IResourceCacheEntry<TArgs, TData>` (:42) | *(no interface)* |
| **Generics** | `<TArgs, TData>` | `<TArgs, TResult>` |

### 2.2 Private Fields — Side-by-Side

| Field | Resource (line) | Command (line) | Shared? |
|---|---|---|---|
| `_args` | `TArgs` (:48) | *(none)* | **No** — Command gets args per-trigger |
| `_queryFn` | `TQueryFn<TArgs, TData>` (:49) | `TCommandQueryFn<TArgs, TResult>` (:28) | Same pattern, different type |
| `_compareArgs` | `TCompareArgsFn<TArgs>` (:50) | *(none)* | **No** — Command has no args comparison |
| `_abortController` | `AbortController \| null` (:51) | `AbortController \| null` (:30) | **IDENTICAL** |
| `_inflightPromise` | `Promise<TData> \| null` (:52) | *(none)* | **No** — Command uses `_triggerResolver` instead |
| `_patchState` | `TPatchState<TData> \| null` (:53) | *(none)* | **No** — Command patches Resource data, not its own |
| `_onCacheEntryAdded` | `TOnCacheEntryAdded<TArgs,TData>?` (:54) | `TOnCommandCacheEntryAdded<TResult>?` (:31) | Same pattern, different callback sig |
| `_onQueryStarted` | `TOnQueryStarted<TArgs,TData>?` (:55) | `TOnCommandQueryStarted<TArgs,TResult>?` (:32) | Same pattern, different callback sig |
| `_entryDataLoaded` | `PromiseResolver<TData> \| null` (:56) | `PromiseResolver<TResult> \| null` (:33) | **IDENTICAL pattern** |
| `_entryRemoved` | `PromiseResolver<void> \| null` (:57) | `PromiseResolver<void> \| null` (:34) | **IDENTICAL** |
| `_queryFulfilled` | `PromiseResolver<{data: TData}> \| null` (:58) | `PromiseResolver<{data: TResult}> \| null` (:35) | **IDENTICAL pattern** |
| `_triggerResolver` | *(none)* | `PromiseResolver<TResult> \| null` (:36) | **No** — Command-only, external promise |
| `_link` | *(none)* | `CommandLink<TArgs, TResult>[]` (:29) | **No** — Command-only, linked resources |

### 2.3 Public Fields

| Field | Resource (line) | Command (line) | Shared? |
|---|---|---|---|
| `machine$` | alias for `state$` (:43) | *(none — uses inherited `state$`)* | Semantic alias only |
| `argsKey` | `string` (:44) | *(none)* | Resource-only |

### 2.4 Constructor

| Aspect | Resource (:60-73) | Command (:38-49) |
|---|---|---|
| Initial state | `initialMachine ?? new MachinePending(args)` | `new CommandIdle()` |
| Options pass-through | `options.entryOptions` | Constructs `{cacheLifetime}` inline |
| Stores args | Yes (`this._args = args`) | No (args per-trigger) |
| Stores queryFn | Yes | Yes |
| Stores comparator | Yes | No |
| Stores lifecycle cbs | Yes (both) | Yes (both) |
| Calls `_fireCacheEntryAdded` | Yes | Yes |
| Auto-fetches | Yes — `_doFetch()` unless hydrated | No — fire-on-demand via `initiate()` |

### 2.5 Core Execution Method

| Aspect | Resource `_doFetch()` (:193-274) | Command `initiate()` (:53-218) |
|---|---|---|
| **Trigger** | Internal (called from constructor, `query()`, `invalidate()`) | External (called from `CommandAgent.trigger()`) |
| **Returns** | `Promise<TData>` (shared inflightPromise for dedup) | `Promise<TResult>` (per-trigger via `_triggerResolver`) |
| **Abort previous** | `_abortController.abort()` (:195-196) | `_abortController.abort()` (:55-56) |
| **Stale check** | `this._abortController !== controller` (:234) | `controller.signal.aborted` (:150) |
| **Machine transition pre-fetch** | Done in `query()` caller, not in `_doFetch()` | Done inline in `initiate()` (:75-82) |
| **Optimistic updates** | Self-managed via `_patchState` and `Patcher.resolvePatches` | Delegates to linked Resources via `ResourceRef.patch()` (:86-95) |
| **Update patches post-success** | N/A (self-contained) | Applies `linkDef.update` patches on linked Resources (:159-168) |
| **Invalidation post-success** | N/A | Calls `ref.invalidate()` on linked Resources (:171-176) |
| **Batching** | No `Batcher.run` in `_doFetch` | Wraps state transitions + link effects in `Batcher.run()` (:148, :194) |
| **Error on refreshing** | Preserves stale data → `MachineSuccess(data, lastError)` (:254-262) | Transitions to `CommandError` (no data preservation) |
| **Sync error handling** | Sets `MachineError`, rejects `_queryFulfilled` (:226-232) | Sets error state, aborts optimistic patches, rejects trigger (:118-133) |

### 2.6 `_fireCacheEntryAdded()` — Structural Comparison

```
Resource (_fireCacheEntryAdded, :169-191)        | Command (_fireCacheEntryAdded, :253-268)
─────────────────────────────────────────────────────────────────────────────────────────
if (!this._onCacheEntryAdded) return;            | if (!this._onCacheEntryAdded) return;
this._entryDataLoaded = new PromiseResolver();   | this._entryDataLoaded = new PromiseResolver();
this._entryRemoved = new PromiseResolver();      | this._entryRemoved = new PromiseResolver();
const tools = {                                  | const tools = {
  $cacheDataLoaded: resolver.promise,            |   $cacheDataLoaded: resolver.promise,
  $cacheEntryRemoved: resolver.promise,          |   $cacheEntryRemoved: resolver.promise,
};                                               | };
try {                                            | try {
  this._onCacheEntryAdded(this._args, tools);    |   this._onCacheEntryAdded(tools);  ← NO args param
} catch {} // caught                             | } catch {} // caught
                                                 |
// Hydration: resolve immediately if has data    | (no hydration check)
if (success && _entryDataLoaded) { ... }         |
```

**Differences**:
1. Resource passes `args` as first argument to callback; Command does not
2. Resource has a post-call hydration check (resolves `_entryDataLoaded` if snapshot-hydrated); Command skips this (no hydration support)

### 2.7 `complete()` Override — Structural Comparison

```
Resource complete() (:136-167)                   | Command complete() (:233-258)
─────────────────────────────────────────────────────────────────────────────────
// Abort inflight                                | // Abort inflight
if (this._abortController) {                     | if (this._abortController) {
  this._abortController.abort();                 |   this._abortController.abort();
  this._abortController = null;                  |   this._abortController = null;
}                                                | }
this._inflightPromise = null;                    |
this._patchState = null;                         | // Reject trigger resolver
                                                 | if (this._triggerResolver) {
                                                 |   reject("Cache entry removed"); null;
                                                 | }
                                                 |
// Lifecycle cleanup                             | // Lifecycle cleanup (IDENTICAL block)
if (this._entryDataLoaded) {                     | if (this._entryDataLoaded) {
  reject("before data loaded"); null;            |   reject("before data loaded"); null;
}                                                | }
if (this._entryRemoved) {                        | if (this._entryRemoved) {
  resolve(); null;                               |   resolve(); null;
}                                                | }
if (this._queryFulfilled) {                      | if (this._queryFulfilled) {
  reject("removed"); null;                       |   reject("removed"); null;
}                                                | }
super.complete();                                | super.complete();
```

**Identical parts**: Abort controller teardown, 3× PromiseResolver cleanup sequence, `super.complete()` call.
**Differences**: Resource clears `_inflightPromise` and `_patchState`; Command clears `_triggerResolver`.

### 2.8 Methods Unique to Each

| Method | Entity | Line | Purpose |
|---|---|---|---|
| `isMyArgs(args)` | Resource | :75-77 | Args comparison delegation |
| `createPatch(patchFn)` | Resource | :79-103 | Self-owned optimistic update via Patcher |
| `invalidate()` | Resource | :105-112 | success→refreshing + re-fetch |
| `query(doForce?)` | Resource | :114-134 | Dedup-aware fetch initiation |
| `_updateMachineData(data, patchState)` | Resource | :276-284 | Preserves state status while changing data |
| `_finishPatch(type, patch)` | Resource | :286-303 | Commits/aborts optimistic patch + consistency check |
| `initiate(args)` | Command | :53-218 | One-shot trigger with linked resource effects |
| `resetToIdle()` | Command | :220-231 | Aborts + resets machine to `CommandIdle` |

---

## 3. Machine Hierarchy Comparison

### 3.1 Architecture

| Aspect | Resource Machines | Command Machines |
|---|---|---|
| **Base class** | `MachineWithData` (abstract, 100 LOC) extends down to Success + Refreshing | **None** — all 4 are standalone classes |
| **States** | pending, success, error, refreshing | idle, loading, success, error |
| **Patch support** | Built into `MachineWithData` via `createPatch()`, `finishPatch()`, `abortAllPendingPatches()` | `CommandSuccess` stores `patchState` field but has **no patch methods** |
| **Immutability** | All transitions return new instances | All transitions return new instances |
| **`state` getter** | All 4 have a `get state()` returning typed plain objects | All 4 have a `get state()` returning typed plain objects |
| **`cloneWith()`** | `MachineSuccess` (:51-59) and `MachineRefreshing` (:55-62) implement abstract `cloneWith()` | *(none)* |
| **File count** | 5 files (4 states + MachineWithData) + Patcher + Machine factory | 4 files (4 states, no shared base) |

### 3.2 State-by-State Comparison

| Resource State | Command State | Structural Similarity |
|---|---|---|
| `MachinePending` | `CommandIdle` + `CommandLoading` | Pending ≈ Loading (both "in-flight"). Idle has no Resource equivalent. |
| `MachineSuccess` | `CommandSuccess` | Both carry `data` and `patchState`. Resource also has `updatedAt`, `lastError`, `invalidate()`, `start()`, `cloneWith()`, patch methods from base. Command has only `start()`. |
| `MachineError` | `CommandError` | Both carry `args` + `error`. Resource has `retry()` + `start()`. Command has only `start()`. |
| `MachineRefreshing` | *(none)* | Command has no refresh concept — re-trigger creates new `CommandLoading`. |
| *(none)* | `CommandIdle` | Resource starts in `MachinePending` (auto-fetch); Command starts in `CommandIdle` (no auto-fetch). |

### 3.3 Field Comparison per State

| Field | MachinePending | CommandIdle | Difference |
|---|---|---|---|
| `status` | `"pending"` | `"idle"` | Different names |
| `args` | `TArgs` (constructor param) | `null` | Idle has no args |
| `data` | `null` | `null` | Same |
| `error` | `null` | `null` | Same |
| `updatedAt` | `null` | *(none)* | Resource-only |

| Field | MachineSuccess | CommandSuccess | Difference |
|---|---|---|---|
| `status` | `"success"` | `"success"` | Same |
| `args` | `TArgs` | `TArgs` | Same |
| `data` | `TData` | `TData` | Same |
| `error` | `null` | `null` | Same |
| `patchState` | `TPatchState \| null` (from MachineWithData) | `TPatchState \| null` (direct field) | Same type, different source |
| `updatedAt` | `number` | *(none)* | Resource-only |
| `lastError` | `unknown?` | *(none)* | Resource-only (SWR error) |

| Field | MachineError | CommandError | Difference |
|---|---|---|---|
| `status` | `"error"` | `"error"` | Same |
| `args` | `TArgs` | `TArgs` | Same |
| `data` | `null` | `null` | Same |
| `error` | `unknown` | `unknown` | Same |
| `updatedAt` | `null` | *(none)* | Resource-only |

| Field | MachinePending | CommandLoading | Difference |
|---|---|---|---|
| `status` | `"pending"` | `"loading"` | Different names |
| `args` | `TArgs` | `TArgs` | Same |
| `data` | `null` | `null` | Same |
| `error` | `null` | `null` | Same |

### 3.4 Transition Methods per State

| State | Resource Transition | Command Transition |
|---|---|---|
| Pending/Idle | `successHappened(data) → MachineSuccess` | `start(args) → CommandLoading` (Idle) |
| | `errorHappened(err) → MachineError` | |
| Loading | *(Loading not a Resource state)* | `successHappened(data) → CommandSuccess` |
| | | `errorHappened(err) → CommandError` |
| Success | `invalidate() → MachineRefreshing` | `start(args) → CommandLoading` |
| | `start(args) → MachinePending` | |
| Error | `retry() → MachinePending` | `start(args) → CommandLoading` |
| | `start(args) → MachinePending` | |
| Refreshing | `successHappened(data) → MachineSuccess` | *(no equivalent)* |
| | `errorHappened(err) → MachineSuccess (with lastError)` | |

### 3.5 Machine Factory

| Aspect | Resource | Command |
|---|---|---|
| **Factory class** | `Machine` (`@/src/query/core/machines/Machine.ts:1-31`) — `pending()`, `fromSnapshot()` | *(none)* — inline `new CommandIdle()` |
| **Snapshot support** | Yes — `Machine.fromSnapshot(state)` reconstructs from serialized state | No |

---

## 4. Abort Management — Duplication Analysis

### 4.1 Pattern Summary

Both entry classes follow the **same abort pattern**:

1. Store `_abortController: AbortController | null = null`
2. On new fetch/trigger: abort previous → `_abortController.abort()`
3. Create new `AbortController`
4. Pass `controller.signal` to `queryFn` as `{ abortSignal }`
5. Stale-check after async result to discard obsolete responses
6. On `complete()`: abort + null

### 4.2 Line-by-Line Abort Code Comparison

| Step | ResourceCacheEntry | CommandCacheEntry |
|---|---|---|
| **Abort previous** | `_doFetch():195-196` — `if (_abortController) _abortController.abort()` | `initiate():55-56` — `if (_abortController) _abortController.abort()` |
| **Create new** | `_doFetch():201` — `const controller = new AbortController(); this._abortController = controller` | `initiate():64-65` — same |
| **Pass to queryFn** | `_doFetch():222` — `this._queryFn(this._args, { abortSignal: controller.signal })` | `initiate():107` — `this._queryFn(args, { abortSignal: controller.signal })` |
| **Stale check (success)** | `_doFetch():234` — `if (this._abortController !== controller) return data` | `initiate():150` — `if (controller.signal.aborted) return` |
| **Stale check (error)** | `_doFetch():257` — `if (this._abortController !== controller) throw error` | `initiate():188` — `if (controller.signal.aborted) return` |
| **Cleanup on complete** | `complete():140-143` — `abort(); null; _inflightPromise = null` | `complete():234-237` — `abort(); null` |

### 4.3 Stale Check Divergence

| Aspect | Resource | Command | Impact |
|---|---|---|---|
| **Mechanism** | `this._abortController !== controller` | `controller.signal.aborted` | Functionally equivalent BUT semantically different: Resource checks identity of the *current* controller; Command checks the signal of the *captured* controller |
| **On stale success** | `return data` (value still resolves the promise) | `return` (void — trigger promise resolved by new trigger's flow) | Different return semantics |
| **On stale error** | `throw error` (re-throws to caller) | `return` (swallowed — trigger promise rejected by new trigger's flow) | Resource propagates; Command swallows |

### 4.4 Additional Abort in Command Only

`resetToIdle()` (`CommandCacheEntry:220-231`):
- Aborts controller + rejects `_triggerResolver` with `DOMException("AbortError")`
- No Resource equivalent — Resource has no "reset to initial state" method

---

## 5. Lifecycle Hook Duplication

### 5.1 `_fireCacheEntryAdded()` Tools Comparison

| Tool | Resource `ICacheEntryAddedTools<TData>` | Command `ICommandCacheEntryAddedTools<TResult>` |
|---|---|---|
| `$cacheDataLoaded` | `Promise<TData>` | `Promise<TResult>` | 
| `$cacheEntryRemoved` | `Promise<void>` | `Promise<void>` |

**Difference**: Resource's `TOnCacheEntryAdded` receives `(args, tools)` — Command's `TOnCommandCacheEntryAdded` receives `(tools)` only (no args, because Command entries don't have fixed args).

### 5.2 `onQueryStarted` Tools Comparison

| Tool | Resource `IQueryStartedTools<TArgs, TData>` | Command `ICommandQueryStartedTools<TResult>` |
|---|---|---|
| `$queryFulfilled` | `Promise<{ data: TData }>` | `Promise<{ data: TResult }>` |
| `getCacheEntry` | `() => IResourceCacheEntry<TArgs, TData>` | *(none)* |

**Difference**: Resource provides `getCacheEntry()` for the callback to access the entry directly. Command does not.

### 5.3 PromiseResolver Cleanup in `complete()`

Both have **structurally identical** cleanup for `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` — reject-with-message / resolve / reject-with-message pattern. This is ~15 lines of duplicated logic.

---

## 6. Summary Duplication Matrix

| Code Pattern | Resource Location | Command Location | Lines Duplicated | Extractable? |
|---|---|---|---|---|
| `_abortController` field + abort/create/null cycle | `:51`, `_doFetch:195-202`, `complete:140-143` | `:30`, `initiate:55-65`, `complete:234-237` | ~12 | Yes — mixin or base method |
| `_entryDataLoaded` PromiseResolver | `:56`, `_fireCacheEntryAdded:171-172`, `complete:148-151`, `_doFetch:246-249` | `:33`, `_fireCacheEntryAdded:256-257`, `complete:244-247`, `initiate:179-182` | ~10 | Yes — into CacheEntry base |
| `_entryRemoved` PromiseResolver | `:57`, `_fireCacheEntryAdded:172`, `complete:152-155` | `:34`, `_fireCacheEntryAdded:257`, `complete:248-251` | ~6 | Yes — into CacheEntry base |
| `_queryFulfilled` PromiseResolver | `:58`, `_doFetch:205-210,248,264`, `complete:156-159` | `:35`, `initiate:97-106,183,198`, `complete:252-255` | ~12 | Yes — into CacheEntry base |
| `_fireCacheEntryAdded()` body | `:169-191` (23 lines) | `:253-268` (16 lines) | ~16 core | Partial — args param diverges |
| `complete()` resolver cleanup | `:148-159` (12 lines) | `:244-255` (12 lines) | ~12 | Yes — into CacheEntry base |
| `_onQueryStarted` fire pattern | `_doFetch:211-221` | `initiate:97-110` | ~10 | Partial — tools shape diverges |
| **Total estimated duplication** | | | **~78 lines** | |

---

## Code References

- `@/src/query/core/CacheEntry.ts:1-74` — base class, 74 lines
- `@/src/query/core/CacheEntry.ts:12` — `_state$` Signal.state field
- `@/src/query/core/CacheEntry.ts:14` — `_cacheLifetime` default 60_000
- `@/src/query/core/CacheEntry.ts:34-45` — `obs` with share + ReplaySubject GC
- `@/src/query/core/CacheEntry.ts:58-62` — `complete()`
- `@/src/query/core/Resource/ResourceCacheEntry.ts:41-42` — class extends CacheEntry
- `@/src/query/core/Resource/ResourceCacheEntry.ts:48-58` — private fields (args, queryFn, abort, lifecycle resolvers)
- `@/src/query/core/Resource/ResourceCacheEntry.ts:60-73` — constructor (auto-fetch on creation)
- `@/src/query/core/Resource/ResourceCacheEntry.ts:79-103` — `createPatch()` self-owned optimistic update
- `@/src/query/core/Resource/ResourceCacheEntry.ts:105-112` — `invalidate()` success→refreshing
- `@/src/query/core/Resource/ResourceCacheEntry.ts:114-134` — `query()` with dedup
- `@/src/query/core/Resource/ResourceCacheEntry.ts:136-167` — `complete()` override
- `@/src/query/core/Resource/ResourceCacheEntry.ts:169-191` — `_fireCacheEntryAdded()`
- `@/src/query/core/Resource/ResourceCacheEntry.ts:193-274` — `_doFetch()` core fetch
- `@/src/query/core/Resource/ResourceCacheEntry.ts:234` — stale check via controller identity
- `@/src/query/core/Resource/ResourceCacheEntry.ts:276-284` — `_updateMachineData()`
- `@/src/query/core/Resource/ResourceCacheEntry.ts:286-303` — `_finishPatch()` + consistency violation
- `@/src/query/core/command/CommandCacheEntry.ts:27` — class extends CacheEntry
- `@/src/query/core/command/CommandCacheEntry.ts:28-36` — private fields (queryFn, link, abort, lifecycle resolvers, triggerResolver)
- `@/src/query/core/command/CommandCacheEntry.ts:38-49` — constructor (idle, no auto-fetch)
- `@/src/query/core/command/CommandCacheEntry.ts:53-218` — `initiate()` full trigger lifecycle
- `@/src/query/core/command/CommandCacheEntry.ts:55-56` — abort previous
- `@/src/query/core/command/CommandCacheEntry.ts:64-65` — create new AbortController
- `@/src/query/core/command/CommandCacheEntry.ts:86-95` — optimistic updates on linked Resources
- `@/src/query/core/command/CommandCacheEntry.ts:107` — queryFn call with abortSignal
- `@/src/query/core/command/CommandCacheEntry.ts:148-176` — Batcher.run success path (commit, update patches, invalidate links)
- `@/src/query/core/command/CommandCacheEntry.ts:150` — stale check via `controller.signal.aborted`
- `@/src/query/core/command/CommandCacheEntry.ts:194` — Batcher.run error path
- `@/src/query/core/command/CommandCacheEntry.ts:220-231` — `resetToIdle()` with abort
- `@/src/query/core/command/CommandCacheEntry.ts:233-258` — `complete()` override
- `@/src/query/core/command/CommandCacheEntry.ts:253-268` — `_fireCacheEntryAdded()`
- `@/src/query/core/command/ResourceRef.ts:3-24` — linked resource adapter
- `@/src/query/core/machines/MachinePending.ts:10-40` — 4 fields + 2 transitions
- `@/src/query/core/machines/MachineSuccess.ts:13-64` — extends MachineWithData, 5+ fields, 3 transitions
- `@/src/query/core/machines/MachineError.ts:9-40` — 4 fields + 2 transitions
- `@/src/query/core/machines/MachineRefreshing.ts:13-62` — extends MachineWithData, 4 fields, 2 transitions
- `@/src/query/core/machines/MachineWithData.ts:11-100` — abstract base, `createPatch()`, `finishPatch()`, `abortAllPendingPatches()`
- `@/src/query/core/machines/CommandIdle.ts:6-19` — 4 fields + `start()` transition
- `@/src/query/core/machines/CommandLoading.ts:7-28` — 4 fields + 2 transitions
- `@/src/query/core/machines/CommandSuccess.ts:7-30` — 5 fields + `start()` transition, stores patchState
- `@/src/query/core/machines/CommandError.ts:6-22` — 4 fields + `start()` transition
- `@/src/query/core/machines/Patcher.ts:1-139` — Immer-based patch engine (used by Resource only, indirectly by Command via ResourceRef)
- `@/src/query/types/lifecycle.types.ts:1-31` — Resource lifecycle types (args in callback sig)
- `@/src/query/types/command-lifecycle.types.ts:1-17` — Command lifecycle types (no args in cacheEntryAdded, no getCacheEntry)
