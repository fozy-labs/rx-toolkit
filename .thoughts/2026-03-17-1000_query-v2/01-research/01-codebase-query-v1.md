---
title: "Query v1 Module — Codebase Analysis"
date: 2026-03-17
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query v1 module (`src/query/`) implements a reactive data-fetching and caching system built on top of RxJS (`BehaviorSubject`, `share`, `timer`) and the internal signals layer (`Signal.state`, `Signal.compute`, `signalize`). The module exposes four top-level factory functions — `createResource`, `createCommand`, `createResourceDuplicator`, `resetAllQueriesCache` — and four React hooks. Internally, it uses `IndirectMap` (shallow-equal key comparison) for cache lookup and `ReactiveCache` (BehaviorSubject with configurable ref-count lifetime via RxJS `share`) as the reactive cache entry. The command system (formerly "Operation") supports linking to resources with optimistic updates via Immer patches and a commit/abort transaction model.

## Findings

---

### 1. Public API Surface

#### 1.1 `createResource`

- **Location**: `@/query/api/createResource.ts:1-9`
- **Signature**: `<ARGS, RESULT, SELECTED = never>(options: ResourceCreateOptions<ResourceDefinition<ARGS, RESULT, SELECTED>>) => Resource<...>`
- **What it does**: Instantiates a `Resource` class with the given options. Uses `satisfies ResourceCreateFn<any, any, any>` for type validation.
- **Key dependencies**: `Resource` from `@/query/core/Resource/Resource`, types from `@/query/types`.

#### 1.2 `createCommand`

- **Location**: `@/query/api/createCommand.ts:1-25`
- **Signature**: `<ARGS, RESULT, SELECTED = never>(options: CommandCreateOptions<CommandDefinition<ARGS, RESULT, SELECTED>>) => Command<...>`
- **What it does**: Instantiates a `Command` class. Supports `link` option for resource binding.
- **Key dependencies**: `Command` from `@/query/core/Command/Command`.

#### 1.3 `createOperation` (deprecated)

- **Location**: `@/query/api/createOperation.ts:1-7`
- **What it does**: Re-exports `createCommand` under the old name. Deprecated, scheduled for removal in v0.6.0.

#### 1.4 `createResourceDuplicator`

- **Location**: `@/query/api/createResourceDuplicator.ts:1-17`
- **Signature**: `<ARGS, RESULT, SELECTED = never>(options: DuplicatorOptions<DuplicatorDefinition<ResourceDefinition<ARGS, RESULT, SELECTED>>>) => ResourceDuplicator<...>`
- **What it does**: Creates a `ResourceDuplicator` that fans out individual items from a list resource into per-item caches.
- **Key dependencies**: `ResourceDuplicator`, `DuplicatorOptions`, `DuplicatorDefinition` from `@/query/core/Resource/ResourceDuplicator`.

#### 1.5 `resetAllQueriesCache`

- **Location**: `@/query/api/resetAllQueriesCache.ts:1-5`
- **What it does**: Calls `ResetAllQueriesSignal.clean()` which emits on a static RxJS `Subject`, causing all `Resource` and `Command` instances to reset their caches to initial state and abort in-flight requests.

#### 1.6 `SKIP_TOKEN`

- **Location**: `@/query/SKIP_TOKEN.ts:1`
- **Implementation**: `export const SKIP = Symbol('SKIP');`
- **Usage pattern**: Passed as args to `useResourceAgent` or `useResourceRef` to prevent query execution. The hooks compare `args === SKIP` to decide whether to call `agent.initiate()`.

#### 1.7 Public re-exports (`index.ts`)

- **Location**: `@/query/index.ts:1-20`
- **Exports**:
  - `createCommand`, `useCommandAgent` (Command API)
  - `createResource`, `createResourceDuplicator`, `resetAllQueriesCache`, `SKIP` (Resource API)
  - All types from `@/query/types`
  - `useResourceAgent`, `useResourceRef` (React hooks)
  - `createOperation`, `useOperationAgent` (deprecated backward-compat)

---

### 2. Core Internals

#### 2.1 `Resource` Class

- **Location**: `@/query/core/Resource/Resource.ts:1-271`
- **Generic parameter**: `D extends ResourceDefinition` (where `ResourceDefinition` has `Args`, `Result`, `Selected`, `Data`)
- **Implements**: `ResourceInstance<D>`

**Internal state management** (`ResourceQueryState` static helper class at lines 39-137):
- `create(args)` — initial default state (all flags false, data/error null)
- `load(state, args)` — sets `isLoading=!isDone`, `isReloading=isDone`, `isInitiated=true`, creates new `AbortController`
- `success(state, data)` — sets `isDone=true`, `isSuccess=true`, clears transactions/savedData/abortController
- `error(state, error)` — sets `isDone=true`, `isError=true`
- `incrementLock/decrementLock` — manages `lockCount` and derived `isLocked`
- `update(state, data, savedData, transactions)` — replaces data and transaction fields
- `createWithData(data, args)` — creates a "pre-loaded" success state without `isInitiated=true`

**CoreResourceQueryState shape** (lines 18-33):
```
transactions, abortController, args, savedData, data, error,
isError, isLoading, isReloading, isDone, isSuccess, isLocked, isInitiated, lockCount
```

**Constructor** (lines 152-172):
- Creates `QueriesLifetimeHooks` with `onCacheEntryAdded`, `onQueryStarted`, `devtoolsName` options
- Creates `QueriesCache<D['Args'], CoreResourceQueryState<D>>` with configurable `cacheLifetime` (default `60_000`)
- Subscribes to `ResetAllQueriesSignal.clean$` to abort and reset all cache entries

**Key methods**:
- `createAgent()` → `new ResourceAgent<D>(this)` (line 174)
- `createRef(args)` → `new ResourceRef<D>(this, args)` (line 178)
- `getQueryCache(args)` → delegates to `QueriesCache` (line 182)
- `createQueryCache(args, state?)` → creates cache entry, wires up lifetime hooks (`onCacheEntryAdded`, `spy$` subscription, `onClean$`) (lines 186-201)
- `incrementLock(args)` / `decrementLock(args)` — manages lock count on cache entries (lines 203-218)
- `update(args, updateFn)` — applies an update function to cache data if `isDone` (lines 220-243)
- `createWithData(args, data)` — pre-populates cache, does NOT overwrite if `isInitiated` is true (lines 245-262)
- `initiate(args)` — the main query execution method (lines 264-299):
  1. Gets or creates cache entry
  2. Aborts previous `AbortController`
  3. Calls `queryFn(args, { abortSignal })`
  4. On resolve: applies `select` transform if present, transitions to success
  5. On reject: transitions to error (if not aborted)
  6. Returns the cache entry
- `compareArgs(args1, args2)` — uses `options.compareArgsFn` or `SharedOptions.defaultCompareArgs` (which is `shallowEqual`)

#### 2.2 `ResourceAgent` Class

- **Location**: `@/query/core/Resource/ResourceAgent.ts:1-107`
- **Implements**: `ResourceAgentInstance<D>`
- **Pattern**: Stale-while-revalidate via `previous$` / `current$` cache tracking

**State management**:
- `_resources$` — `Signal.state({ previous$, current$ })` holding two `CoreResourceQueryCache<D>` references
- `state$` — `Computed.create(() => ...)` that reads `current$.value$.get()` and optionally `previous$.value`

**Stale-while-revalidate logic** (lines 12-72):
1. If `currState && !currState.isInitiated` → auto-triggers `resource.initiate(args)` (handles `resetAllQueriesCache` scenario)
2. If `currState.isLoading && prevState?.isSuccess` → shows `prevState.data` (stale data) while fresh query loads
3. Adds `isInitialLoading` flag: `isLoading && !isDone && !prevState?.isDone`

**`initiate(args, force?)`** method (lines 79-95):
1. Checks existing cache via `resource.getQueryCache(args)`
2. If no cache → calls `resource.initiate(args)` and updates `_next()`
3. If cache exists but not done/loading, or `force=true` → re-initiates
4. Updates `_next()` if current cache reference changed

**`_next(newCache)`** (lines 100-118):
- Manages the `previous$`/`current$` swapping logic
- Preserves `previous$` when current is still loading but previous was done (for stale-while-revalidate)

#### 2.3 `ResourceRef` Class

- **Location**: `@/query/core/Resource/ResourceRef.ts:1-163`
- **Implements**: `ResourceRefInstance<D>`
- **Dependencies**: `immer` (`enablePatches`, `produceWithPatches`, `applyPatches`)
- **Purpose**: Provides an abstraction for working with a specific cache entry by args, enabling optimistic updates (patches), lock/unlock, create, and invalidate.

**Transaction/Patch model** (lines 42-131):
- `patch(patchFn)` — uses Immer `produceWithPatches` to create patches+inversePatches
- Creates a `ResourceTransaction` object with `status: 'pending'`, `abort()`, `commit()` methods
- `reapplyFn` implements the patch resolution algorithm:
  - **Before first pending**: committed → apply & remove; aborted → apply & remove
  - **Pending**: apply & keep in queue
  - **After pending, committed**: apply & keep
  - **After pending, aborted**: if more pending after it → revert & keep; otherwise → skip & remove
  - Queue always starts from first pending transaction

**Other methods**:
- `has` — checks if cache entry exists (lazy lookup)
- `lock()` → calls `resource.incrementLock()`, returns `{ unlock }` handle
- `unlockOne()` → calls `resource.decrementLock()`
- `create(data)` → calls `resource.createWithData()`
- `invalidate()` → calls `resource.initiate()` (forces re-fetch)

#### 2.4 `ResourceDuplicator` Class

- **Location**: `@/query/core/Resource/ResourceDuplicator.ts:1-315`
- **Purpose**: Given a resource that fetches a list by list of IDs, deduplicates requests and maps individual item caches. Tracks per-arg-key reference counts (`_fis` map).
- **Options**: `resource`, `getArgKey`, `getDataKey`, `cacheLifetime`
- **Internal types**: `DuplicatorDefinition` constraints enforce `Args extends Array` and `Data extends Array`.
- **Uses `ComputedReactiveCache`** (defined in same file, lines 253-315) — wraps a computed signal as a reactive cache with RxJS-based lifetime management.
- **`d_init(args)`** — creates a computed signal that merges states from all individual per-arg caches and the batch query cache. Aggregates `isLoading`, `isError`, `isDone`, data array.
- **Also contains `ResourceDuplicatorAgent`** in separate file (`@/query/core/Resource/ResourceDuplicatorAgent.ts:1-100`) — follows same stale-while-revalidate pattern as `ResourceAgent`.

#### 2.5 `QueriesCache` Class

- **Location**: `@/query/core/QueriesCache.ts:1-38`
- **Generic**: `<KEY, VALUE>`
- **What it does**: Wraps `IndirectMap<KEY, ReactiveCache<VALUE>>`. On `createQueryCache`, also subscribes to `cache.onClean$` to auto-remove from map.
- **Constructor params**: `cacheLifeTime` (default 60_000), `compareArgsFn` (default `shallowEqual`)
- **Methods**: `getQueryCache(args)`, `createQueryCache(args, initialState)`, `values()`

#### 2.6 `QueriesLifetimeHooks` Class

- **Location**: `@/query/core/QueriesLifetimeHooks.ts:1-116`
- **Purpose**: Manages `onCacheEntryAdded` and `onQueryStarted` lifecycle listeners.
- **Constructor behavior**:
  - Registers user-provided listeners
  - If devtools enabled (`Devtools.hasDevtools`), adds a listener that creates devtools state tracking
  - If `SharedOptions.onQueryError` set, adds a listener that forwards query errors
- **`onCacheEntryAdded(args)`** returns resolvers:
  - `cacheDataLoaded()` — resolves `$cacheDataLoaded` promise
  - `cacheEntryRemoved()` — resolves `$cacheEntryRemoved` promise
  - `dataChanged$` — RxJS `Subject<DATA>` that emits on state changes
- **`onQueryStarted(args)`** returns resolvers:
  - `fulfilledSuccess(data)` — resolves `$queryFulfilled` with `{ data, isError: false }`
  - `fulfilledError(error)` — resolves `$queryFulfilled` with `{ error, isError: true }`
- **Key dependency**: `PromiseResolver` from `@/common/utils`

#### 2.7 `ResetAllQueriesSignal`

- **Location**: `@/query/core/ResetAllQueriesSignal.ts:1-12`
- **Implementation**: Static RxJS `Subject<void>`. `clean()` calls `Batcher.run(() => subject$.next())`.
- **Usage**: Every `Resource` and `Command` constructor subscribes to `ResetAllQueriesSignal.clean$`.

#### 2.8 `Command` Class

- **Location**: `@/query/core/Command/Command.ts:1-268`
- **Implements**: `CommandInstance<D>`
- **State shape** (`CoreCommandQueryState`, lines 16-27): `arg, data, error, isError, isLoading, isRepeating, isDone, isSuccess, isInitiated`
- **Constructor** (lines 89-113):
  - Creates `QueriesCache` (default lifetime `1_000` — much shorter than Resource's 60s)
  - Creates `QueriesLifetimeHooks`
  - Calls `_createLinks()` to parse `link` option
  - Subscribes to `ResetAllQueriesSignal.clean$`
- **`initiate(args)`** (lines 134-252):
  - Wrapped in `Batcher.run()` for atomic signal updates
  - Creates link metadata: `forwardArgs`, creates `ResourceRef` per link
  - Calls `queryFn(args)` (no abortSignal — unlike Resource)
  - On success: applies `select`, then per-link: `update` via `ref.patch().commit()`, `create` via `ref.create()`, `invalidate` via `ref.invalidate()`, commits optimistic patches
  - On error: aborts all optimistic patches, unlocks all links
- **`mutate(args)` (deprecated)** — returns a Promise wrapper around `initiate` + observable subscription
- **`_createLinks()`** — invokes user's `link` callback to collect `LinkOptions` array

**LinkOptions** (from `@/query/types/Command.types.ts:58-116`):
- `resource` — target `ResourceInstance`
- `forwardArgs(args)` — maps command args to resource args
- `invalidate` — re-fetch resource after success
- `lock` — lock resource during execution
- `update({ draft, args, data })` — Immer mutation on resource cache after success
- `optimisticUpdate({ draft, args })` — Immer mutation before execution
- `create({ args, data })` — create new cache entry if none exists

#### 2.9 `CommandAgent` Class

- **Location**: `@/query/core/Command/CommandAgent.ts:1-69`
- **Implements**: `CommandAgentInstance<D>`
- **Pattern**: Simpler than ResourceAgent — only tracks `current$` (no stale-while-revalidate for commands)
- **`state$`**: Computed signal mapping `current$.value$.get()` to flat state with `isLoading, isDone, isSuccess, isError, error, data, args`
- **`initiate(args)`**: Always re-initiates (commands aren't cached like resources)
- **`createAgent()`**: Returns a new `CommandAgent` instance

#### 2.10 `Operation` / `OperationAgent` (deprecated)

- **Location**: `@/query/core/Operation/Operation.ts:1-6`, `@/query/core/Operation/OperationAgent.ts:1-4`
- **What they do**: Simply re-export `Command` as `Operation` and `CommandAgent` as `OperationAgent`. Deprecated.

---

### 3. Library Utilities

#### 3.1 `ReactiveCache`

- **Location**: `@/query/lib/ReactiveCache.ts:1-109`
- **Generic**: `<VALUE>`
- **Internal store**: `BehaviorSubject<VALUE>`
- **`value$`**: `ReadableSignalLike<VALUE>` — created via `signalize()` wrapping the BehaviorSubject piped through `share({ connector: ReplaySubject(1), resetOnRefCountZero })`. This bridges RxJS to the signals system.
- **`spy$`**: Raw observable for devtools (not triggering ref-count / lifecycle)
- **`onClean$`**: `Subject<VALUE>` that emits when cache is completed
- **Cache lifetime** via `resetOnRefCountZero`:
  - `false` → never auto-clean
  - `<= 0` → immediate clean on ref-count zero
  - `> 0` → `timer(cacheLifeTime)` before clean
- **`next(value)`**: Updates `BehaviorSubject`
- **`complete()`**: Idempotent — completes BehaviorSubject, emits on `onClean$`
- **`value` getter**: Returns `BehaviorSubject.getValue()`

#### 3.2 `IndirectMap`

- **Location**: `@/query/lib/IndirectMap.ts:1-116`
- **Generic**: `<KEY, VALUE>`
- **Purpose**: A `Map` that supports object keys matched by a comparison function (default `shallowEqual`) rather than identity.
- **Performance optimization**: `WeakMap<object, KEY>` comparison cache to avoid O(n) scan on repeated lookups.
- **Methods**: `get(key)`, `set(key, value)`, `delete(key)`, `has(key)`, `values()`
- **Key behavior**: Primitive keys use direct `Map.get/set`. Object keys first check `_compareCache` (WeakMap), then iterate map keys with `_compareObjectsFn`.

---

### 4. React Integration

#### 4.1 `useResourceAgent`

- **Location**: `@/query/react/useResourceAgent.ts:1-53`
- **Signature**: `<D>(res: ResourceInstance<D> | ResourceDuplicator<...>, ...args: [D['Args'] | SKIP]) => ResourceQueryState<D>`
- **Pattern**:
  1. Creates agent once via `useConstant(() => res.createAgent())`
  2. Tracks previous args via `React.useRef`
  3. On each render, compares args via `agent.compareArgs()` — if different, calls `agent.initiate(args)`
  4. If args is `SKIP`, does not initiate
  5. Returns `useSignal(agent.state$)` — subscribes React to the computed signal
- **Dependencies**: `useConstant` (from `@/common/react`), `useSignal` (from `@/signals/react`), `SKIP` token

#### 4.2 `useCommandAgent`

- **Location**: `@/query/react/useCommandAgent.ts:1-55`
- **Signature**: `<D>(op: { createAgent: () => CommandAgentInstance<D> }) => [TriggerFn<D>, CommandQueryState<D>]`
- **Pattern**: Returns tuple `[trigger, state]`
  - `trigger(args)` — calls `agent.initiate(args)`, returns a Promise that resolves/rejects when `agent.state$` indicates completion
  - `state` — via `useSignal(agent.state$)`
- **Uses**: `useConstant` for agent creation, `useEventHandler` for stable trigger reference

#### 4.3 `useOperationAgent` (deprecated)

- **Location**: `@/query/react/useOperationAgent.ts:1-7`
- **What it does**: Re-exports `useCommandAgent`. Deprecated.

#### 4.4 `useResourceRef`

- **Location**: `@/query/react/useResourceRef.ts:1-24`
- **Signature**: `<D>(res: ResourceInstance<D>, ...args: [D['Args'] | SKIP]) => ResourceRefInstance<D>`
- **Pattern**: Creates a ref via `res.createRef(args)`, memoized with `React.useMemo`. Args stability via `React.useRef` + `shallowEqual`.
- **Does NOT subscribe to reactive state** — just returns the ref object for imperative usage (lock, patch, create, invalidate).

---

### 5. Types

#### 5.1 `Resource.types.ts`

- **Location**: `@/query/types/Resource.types.ts:1-152`
- **Key types**:
  - `ResourceDefinition<A, R, S>` — shape: `{ Args: A; Result: R; Selected: S; Data: FallbackOnNever<S, R> }`
  - `ResourceCreateOptions<D>` — `{ queryFn, select?, cacheLifetime?, onCacheEntryAdded?, onQueryStarted?, devtoolsName?, compareArgsFn? }`
  - `ResourceCreateFn<ARGS, RESULT, SELECTED>` — factory function type
  - `ResourceQueryFnTools` — `{ abortSignal?: AbortSignal }`
  - `ResourceInstance<D>` — `{ createAgent(), createRef(args) }`
  - `ResourceAgentInstance<D>` — `{ state$, initiate(args, force?), compareArgs() }`
  - `ResourceQueryState<D>` — 11 flags + `error`, `data`, `args` (the UI-facing state)
  - `ResourceTransaction` — `{ patches, inversePatches, status, abort(), commit() }`
  - `ResourceRefInstance<D>` — `{ has, lock(), unlockOne(), patch(), invalidate(), create() }`

#### 5.2 `shared.types.ts`

- **Location**: `@/query/types/shared.types.ts:1-31`
- **Key types**:
  - `Prettify<T>` — mapped type for cleaner IntelliSense display
  - `FallbackOnNever<T, F>` — conditional type: if T is `never`, use F instead (used for `Selected` fallback to `Result`)
  - `CacheEntryAddedTools<DATA>` — `{ $cacheDataLoaded, $cacheEntryRemoved, dataChanged$ }`
  - `QueryStartedTools<DATA>` — `{ $queryFulfilled }`
  - `OnCacheEntryAdded<ARGS, DATA>` — callback type
  - `OnQueryStarted<ARGS, DATA>` — callback type

#### 5.3 `Command.types.ts`

- **Location**: `@/query/types/Command.types.ts:1-170`
- **Key types**:
  - `CommandDefinition<A, R, S>` — same shape as `ResourceDefinition`
  - `CommandCreateOptions<D>` — `{ queryFn, select?, link?, cacheLifetime?, onCacheEntryAdded?, onQueryStarted?, devtoolsName? }`
  - `LinkOptions<D, RD>` — `{ resource, forwardArgs, invalidate?, lock?, update?, optimisticUpdate?, create? }`
  - `CommandInstance<D>` — `{ createAgent(), mutate(args) }`
  - `CommandAgentInstance<D>` — `{ state$, initiate(args), createAgent() }`
  - `CommandQueryState<D>` — `{ isLoading, isDone, isSuccess, isError, error, data, args }`

#### 5.4 `Operation.types.ts` (deprecated)

- **Location**: `@/query/types/Operation.types.ts:1-29`
- **What it does**: Type aliases mapping old `Operation*` names to `Command*` types.

#### 5.5 `types/index.ts`

- **Location**: `@/query/types/index.ts:1-7`
- **Re-exports**: All from `Command.types`, `Resource.types`, `shared.types`, `Operation.types`.

---

### 6. Tests

#### 6.1 `Resource.test.ts`

- **Location**: `@/query/core/Resource/Resource.test.ts:1-231`
- **Scenarios covered**: Loading/success/error state transitions, abort on re-initiate, cache reuse for same args, separate caches for different args, `createWithData` pre-population and non-overwrite, `createRef`/`createAgent` creation, `select` transform, `isReloading` on re-initiate after success, `compareArgs` default and custom.
- **Pattern**: Uses `createControllableResource()` helper with `vi.fn()` queryFn returning manually-resolved promises. `flushMicrotasks()` helper for async resolution. `cacheLifetime: false`, `devtoolsName: false` to isolate tests.

#### 6.2 `ResourceRef.test.ts`

- **Location**: `@/query/core/Resource/ResourceRef.test.ts:1-215`
- **Scenarios covered**: `has` before/after create, `patch` returns null when no cache, `patch` creates pending transaction, commit/abort idempotency, multiple independent transactions, lock/unlock, invalidate triggers new query.

#### 6.3 `ResourceDuplicator.test.ts`

- **Location**: `@/query/core/Resource/ResourceDuplicator.test.ts:1-155`
- **Scenarios covered**: serialize to pipe-separated keys, compareArgs, initiate triggers queryFn, state transitions (success/error/loading), getQueryCache before/after initiate, createAgent.

#### 6.4 `Command.test.ts`

- **Location**: `@/query/core/Command/Command.test.ts:1-250`
- **Scenarios covered**: Loading/success/error state transitions, isRepeating on re-initiate, arg stored in state, createAgent, mutate(deprecated) resolves/rejects, select transform, link with invalidate.

#### 6.5 `QueriesCache.test.ts`

- **Location**: `@/query/core/QueriesCache.test.ts:1-80`
- **Scenarios covered**: Create/get/missing cache entries, shallow-equal object keys, different args create different entries, values(), auto-removal on complete, custom compare function.

#### 6.6 `QueriesLifetimeHooks.test.ts`

- **Location**: `@/query/core/QueriesLifetimeHooks.test.ts:1-177`
- **Scenarios covered**: onQueryStarted listener called with args+tools, $queryFulfilled resolves on success/error, onCacheEntryAdded with $cacheDataLoaded/$cacheEntryRemoved promises, dataChanged$ emission and completion, no-listener scenario.

#### 6.7 `ResetAllQueriesSignal.test.ts`

- **Location**: `@/query/core/ResetAllQueriesSignal.test.ts:1-50`
- **Scenarios covered**: clean() triggers subscribers, multiple subscribers, unsubscribed not notified, multiple triggers.

#### 6.8 `ReactiveCache.test.ts`

- **Location**: `@/query/lib/ReactiveCache.test.ts:1-111`
- **Scenarios covered**: Initial value, next() updates, value$ observable emissions, spy$ emissions, complete() idempotency, onClean$ emission, cacheLifeTime default (60s) re-subscribe behavior, cacheLifeTime: false no auto-reset.

#### 6.9 `IndirectMap.test.ts`

- **Location**: `@/query/lib/IndirectMap.test.ts:1-128`
- **Scenarios covered**: Primitive keys (string, number), object keys with shallow-equal lookup, overwrite with shallow-equal key, WeakMap cache for repeated lookups, delete by reference and by shallow-equal, has() for primitives and objects, values(), custom compare, edge cases (null, undefined keys).

#### 6.10 `useResourceAgent.test.ts`

- **Location**: `@/query/react/useResourceAgent.test.ts:1-83`
- **Scenarios covered**: Renders without error, SKIP prevents queryFn call, changing args triggers re-initiate.
- **Pattern**: Uses `renderHook` from `@testing-library/react`, `act` for async, `flushMicrotasks` helper.

#### 6.11 `useCommandAgent.test.ts`

- **Location**: `@/query/react/useCommandAgent.test.ts:1-91`
- **Scenarios covered**: Renders without error, trigger calls queryFn, state updates after resolve.

#### 6.12 `useResourceRef.test.ts`

- **Location**: `@/query/react/useResourceRef.test.ts:1-50`
- **Scenarios covered**: Renders without error, returns ref-like object with expected methods.

#### 6.13 `SKIP_TOKEN.test.ts`

- **Location**: `@/query/SKIP_TOKEN.test.ts:1-20`
- **Scenarios covered**: SKIP is a symbol, unique, has description "SKIP", same reference.

---

### 7. Data Flow Summary

**Resource query lifecycle** (invocation → cache → UI):

1. **User calls** `useResourceAgent(resource, args)` or `agent.initiate(args)`
2. **ResourceAgent.initiate** checks for existing `QueriesCache` entry via `resource.getQueryCache(args)` (compared via `IndirectMap` using `shallowEqual`)
3. If no cache: **Resource.initiate(args)** is called
4. **Resource.initiate** creates/updates a `ReactiveCache` entry, sets loading state, aborts previous `AbortController`, calls `queryFn(args, { abortSignal })`
5. **QueriesLifetimeHooks.onQueryStarted** fires, giving listeners a `$queryFulfilled` promise
6. On promise resolution: applies `select` transform, sets success state via `cache.next()`
7. `ReactiveCache.next()` pushes to internal `BehaviorSubject`, which flows through RxJS `share()` to `signalize()` → `ReadableSignalLike`
8. **ResourceAgent.state$** (a `Computed` signal) reads `current$.value$.get()`, merges with `previous$` for stale-while-revalidate
9. **useSignal** in React subscribes to `agent.state$`, triggering re-render with new state

**Command flow** (mutation → link → resource update):

1. User calls `trigger(args)` from `useCommandAgent` → `CommandAgent.initiate(args)` → `Command.initiate(args)`
2. Command creates `ResourceRef` per link, calls `lock()` and `optimisticUpdate()` if configured
3. Calls `queryFn(args)` (no abort support)
4. On success: applies `update`, `create`, `invalidate` per link via `ResourceRef` methods, commits optimistic patches
5. On error: aborts all optimistic patches, unlocks all links

---

### 8. Configuration / Options Handling

- **SharedOptions** (`@/common/options/SharedOptions.ts:1-14`): Static class with `DEVTOOLS`, `onQueryError`, `getScopeName`, `defaultCompareArgs` (used as fallback by Resource.compareArgs).
- **Resource options**: `queryFn` (required), `select`, `cacheLifetime` (default 60_000), `onCacheEntryAdded`, `onQueryStarted`, `devtoolsName`, `compareArgsFn`
- **Command options**: `queryFn` (required), `select`, `link`, `cacheLifetime` (default 1_000), `onCacheEntryAdded`, `onQueryStarted`, `devtoolsName`
- **No grouping/isolation mechanism** — each createResource/createCommand is independent. ResetAllQueriesSignal is global across all instances. This is one of the motivations for v2's `createApi` grouping.
- **No SSR support** — no snapshot/hydration mechanism.
- **Key strategy**: Only `compare` mode (via `IndirectMap` + `shallowEqual`). No `serialize` strategy.

---

## Code References

- `@/query/index.ts:1-20` — public re-exports
- `@/query/SKIP_TOKEN.ts:1` — SKIP symbol definition
- `@/query/api/createResource.ts:4-8` — createResource factory
- `@/query/api/createCommand.ts:20-25` — createCommand factory
- `@/query/api/createOperation.ts:3-7` — deprecated alias
- `@/query/api/createResourceDuplicator.ts:7-12` — duplicator factory
- `@/query/api/resetAllQueriesCache.ts:3-5` — global reset function
- `@/query/core/Resource/Resource.ts:18-33` — CoreResourceQueryState shape
- `@/query/core/Resource/Resource.ts:39-137` — ResourceQueryState static helpers
- `@/query/core/Resource/Resource.ts:139-271` — Resource class
- `@/query/core/Resource/Resource.ts:174` — createAgent method
- `@/query/core/Resource/Resource.ts:264-299` — initiate (main query execution)
- `@/query/core/Resource/ResourceAgent.ts:11-72` — state$ computed with stale-while-revalidate
- `@/query/core/Resource/ResourceAgent.ts:79-95` — initiate method
- `@/query/core/Resource/ResourceAgent.ts:100-118` — _next (previous/current swap)
- `@/query/core/Resource/ResourceRef.ts:6-7` — Immer enablePatches
- `@/query/core/Resource/ResourceRef.ts:42-131` — patch + reapply algorithm
- `@/query/core/Resource/ResourceDuplicator.ts:38-46` — DuplicatorOptions
- `@/query/core/Resource/ResourceDuplicator.ts:65-190` — ResourceDuplicator class
- `@/query/core/Resource/ResourceDuplicator.ts:253-315` — ComputedReactiveCache class
- `@/query/core/Resource/ResourceDuplicatorAgent.ts:10-100` — DuplicatorAgent
- `@/query/core/QueriesCache.ts:5-38` — QueriesCache wrapping IndirectMap+ReactiveCache
- `@/query/core/QueriesLifetimeHooks.ts:16-116` — lifecycle hooks with PromiseResolver
- `@/query/core/ResetAllQueriesSignal.ts:4-12` — static Subject + Batcher.run
- `@/query/core/Command/Command.ts:16-27` — CoreCommandQueryState shape
- `@/query/core/Command/Command.ts:87-113` — Command constructor
- `@/query/core/Command/Command.ts:134-252` — Command.initiate with link processing
- `@/query/core/Command/Command.ts:257-268` — deprecated mutate method
- `@/query/core/Command/CommandAgent.ts:6-69` — CommandAgent (simpler, no stale data)
- `@/query/lib/ReactiveCache.ts:27-109` — ReactiveCache (BehaviorSubject → signalize)
- `@/query/lib/IndirectMap.ts:5-116` — IndirectMap (WeakMap cache + compare function)
- `@/query/react/useResourceAgent.ts:17-49` — hook with SKIP, compareArgs, useSignal
- `@/query/react/useCommandAgent.ts:32-55` — hook returning [trigger, state] tuple
- `@/query/react/useResourceRef.ts:8-24` — hook returning ResourceRefInstance
- `@/query/react/useOperationAgent.ts:6-7` — deprecated alias
- `@/query/types/Resource.types.ts:13-152` — all Resource-related types
- `@/query/types/Command.types.ts:1-170` — all Command-related types + LinkOptions
- `@/query/types/shared.types.ts:1-31` — Prettify, FallbackOnNever, hook tool types
- `@/query/types/Operation.types.ts:1-29` — deprecated type aliases
- `@/common/options/SharedOptions.ts:1-14` — global shared options (defaultCompareArgs, onQueryError)
