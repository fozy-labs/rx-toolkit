---
title: "Data Flow: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Data Flow: Query v2 Module

## 1. Resource Query — Cache Miss (First Fetch)

User calls `resource.query(args)` when no cache entry exists.

```mermaid
---
title: "resource.query(args) — Cache Miss"
---
sequenceDiagram
    participant User
    participant Resource as ResourceV2
    participant CacheMap
    participant Entry as CacheEntry
    participant Machine
    participant Hooks as LifecycleHooks
    participant Signal as Signal.state
    participant QueryFn as queryFn

    User->>Resource: query(args, force=false)
    Resource->>CacheMap: get(args)
    CacheMap-->>Resource: null (miss)

    Resource->>Resource: Batcher.run(() => { ... })
    Resource->>Entry: new CacheEntry(MachineIdle)
    Resource->>CacheMap: set(args, entry)
    Resource->>Hooks: onCacheEntryAdded(args, tools)

    Resource->>Machine: idle.start(args)
    Machine-->>Resource: MachinePending
    Resource->>Entry: machine$.set(MachinePending)
    Resource->>Hooks: onQueryStarted(args, tools)

    Resource->>QueryFn: queryFn(args, { abortSignal })
    Note right of QueryFn: Async execution

    QueryFn-->>Resource: Promise<Data> resolves
    Resource->>Machine: pending.successHappened(data)
    Machine-->>Resource: MachineSuccess
    Resource->>Entry: machine$.set(MachineSuccess)
    Resource->>Hooks: fulfilledSuccess(data)
    Resource->>Hooks: cacheDataLoaded()

    Note over Entry,Signal: Signal.state emission triggers<br/>dependent Computed signals<br/>and React re-renders
```

## 2. Resource Query — Cache Hit (Stale-While-Revalidate via Agent)

Agent manages stale-while-revalidate when args change.

```mermaid
---
title: "agent.start(newArgs) — SWR with Cache Hit"
---
sequenceDiagram
    participant User
    participant Agent as ResourceV2Agent
    participant Resource as ResourceV2
    participant CacheMap
    participant Entry as CacheEntry (new)
    participant OldEntry as CacheEntry (old)
    participant React

    User->>Agent: start(newArgs)
    Agent->>Agent: previous$ = current$ (has MachineSuccess)
    Agent->>Resource: query(newArgs)
    Resource->>CacheMap: get(newArgs)
    CacheMap-->>Resource: null (new args, no cache)

    Resource->>Entry: new CacheEntry(MachinePending)
    Resource->>CacheMap: set(newArgs, entry)
    Agent->>Agent: current$ = new entry

    Note over Agent: state$ computed reads current$<br/>current is Pending → check previous$<br/>previous$ has Success → show stale data

    Agent-->>React: { data: staleData, isLoading: true,<br/>isInitialLoading: false }

    Note right of Resource: queryFn resolves...
    Resource->>Entry: machine$.set(MachineSuccess(freshData))
    Agent->>Agent: previous$ = null (no longer needed)
    Agent-->>React: { data: freshData, isLoading: false }
```

## 3. Resource Invalidation — MachineRefreshing Flow

`resource.invalidate(args)` transitions `MachineSuccess → MachineRefreshing`, re-fetches, and handles errors.

```mermaid
---
title: "resource.invalidate(args) — Refreshing Flow"
---
sequenceDiagram
    participant User
    participant Resource as ResourceV2
    participant Entry as CacheEntry
    participant Machine
    participant QueryFn as queryFn
    participant Hooks as LifecycleHooks

    User->>Resource: invalidate(args)
    Resource->>Entry: peek() → MachineSuccess
    Resource->>Machine: success.invalidate()
    Machine-->>Resource: MachineRefreshing(staleData)
    Resource->>Entry: machine$.set(MachineRefreshing)
    Note over Entry: Subscribers see status='refreshing'<br/>with stale data still available

    Resource->>QueryFn: queryFn(args, { abortSignal })

    alt Success
        QueryFn-->>Resource: data
        Resource->>Machine: refreshing.successHappened(data)
        Machine-->>Resource: MachineSuccess(freshData)
        Resource->>Entry: machine$.set(MachineSuccess)
        Resource->>Hooks: fulfilledSuccess(data)
    else Error
        QueryFn-->>Resource: error
        Note over Resource: Error during refresh:<br/>KEEP stale data,<br/>transition back to MachineSuccess<br/>with error metadata
        Resource->>Machine: refreshing.errorHappened(error)
        Machine-->>Resource: MachineSuccess(staleData)<br/>Note: stale data preserved
        Resource->>Entry: machine$.set(MachineSuccess)
        Resource->>Hooks: fulfilledError(error)
        Note over Entry: Agent can expose<br/>refreshError to UI if needed
    end
```

**Error semantics during refresh** (see [ADR-2 in 04-decisions.md](./04-decisions.md#adr-2)):

On error during `MachineRefreshing`:
- Transition **back to `MachineSuccess`** preserving the stale data.
- The error is passed to `onQueryStarted` → `$queryFulfilled` rejection so consumers can react.
- The Agent exposes a `refreshError` field on its state for UI display.
- Rationale: Losing stale data on a transient error degrades UX. [ref: [03-external-research.md](../01-research/03-external-research.md)#2.2 — TanStack Query preserves stale data on background refetch failure]

### Patch interaction during refresh

When `MachineRefreshing` has active patches:
1. `addPatch()` works on `MachineRefreshing` (inherits from `MachineWithData`) — patches are applied on top of stale data.
2. On `successHappened(freshData)`: all pending patches are **aborted** (fresh data supersedes optimistic changes). Committed patches have already been applied server-side.
3. On `errorHappened(error)`: patches remain attached to the stale data in the returned `MachineSuccess`.

## 4. Optimistic Update via Patcher

```mermaid
---
title: "Optimistic Update — onQueryStarted + Patcher"
---
sequenceDiagram
    participant Consumer
    participant Resource as ResourceV2
    participant Entry as CacheEntry
    participant Machine as MachineSuccess
    participant Patcher
    participant QueryFn as External API

    Consumer->>Resource: onQueryStarted callback fires
    Note over Consumer: Within onQueryStarted lifecycle

    Consumer->>Entry: peek() → MachineSuccess(currentData)
    Consumer->>Machine: createPatch(draft => { draft.name = 'new' })
    Machine->>Patcher: Patcher.createPatch(patchFn, data)
    Patcher->>Patcher: produceWithPatches(data, patchFn)
    Patcher-->>Machine: { patch, inversePatch, patchedData }
    Machine-->>Consumer: { machine: MachineSuccess(patchedData), patch }
    Consumer->>Entry: machine$.set(patchedMachine)
    Note over Entry: UI sees optimistic data immediately

    alt API Success
        QueryFn-->>Consumer: server data
        Consumer->>Machine: finishPatch('commit', patch)
        Machine->>Patcher: Patcher.finishPatch(originalData, patches, 'commit', patch)
        Note over Patcher: Mark patch as committed,<br/>resolve queue, if no pending left<br/>→ clear originalData
        Machine-->>Consumer: MachineSuccess(resolvedData)
        Consumer->>Entry: machine$.set(resolved)
    else API Error
        QueryFn-->>Consumer: error
        Consumer->>Machine: finishPatch('abort', patch)
        Machine->>Patcher: Patcher.finishPatch(originalData, patches, 'abort', patch)
        Note over Patcher: Mark patch as aborted,<br/>apply inverse patches,<br/>resolve queue
        Machine-->>Consumer: MachineSuccess(rolledBackData)
        Consumer->>Entry: machine$.set(rolledBack)
    end
```

**Hanging patch fix**: When a Machine transitions to `MachineIdle` (via `reset()`) or when the `CacheEntry` is cleaned up, all pending patches are automatically aborted. This prevents the v1 bug where orphaned pending patches block `originalData` cleanup. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#2.3, [04-open-questions.md](../01-research/04-open-questions.md)#Q12]

## 5. SSR — Snapshot Lifecycle

```mermaid
---
title: "SSR — Server dehydration + Client rehydration"
---
sequenceDiagram
    participant Server
    participant ServerApi as createApi (server)
    participant Client
    participant ClientApi as createApi (client)
    participant Resource as ResourceV2
    participant Machine

    Note over Server: Server-side rendering

    Server->>ServerApi: createApi({ keyPrefix: 'main' })
    Server->>Resource: resource.query(args)
    Resource-->>Server: MachineSuccess(data)

    Server->>ServerApi: api.getSnapshot()
    ServerApi->>ServerApi: Iterate resources:<br/>collect MachineSuccess entries only
    ServerApi->>ServerApi: For each entry:<br/>{ key, args, data, updatedAt }
    ServerApi-->>Server: TApiSnapshot { version: 1,<br/>keyPrefix: 'main',<br/>resources: { ... } }

    Server->>Server: Embed snapshot in HTML<br/>(JSON.stringify → script tag)

    Note over Client: Client-side hydration

    Client->>ClientApi: createApi({ initialSnapshot: parsed })
    ClientApi->>ClientApi: Verify snapshot.version === CURRENT
    ClientApi->>ClientApi: Verify snapshot.keyPrefix matches

    loop For each resource entry in snapshot
        ClientApi->>Machine: Machine.fromSnapshot(entryState)
        Machine->>Machine: switch(status) →<br/>new MachineSuccess(state)
        ClientApi->>Resource: hydrate(args, machine)

        alt Date.now() - updatedAt > maxSnapshotDataAge
            ClientApi->>Resource: invalidate(args)
            Note over Resource: MachineSuccess → MachineRefreshing<br/>(stale data shown, fresh fetch started)
        end
    end
```

**Key design choices:**
- Only `MachineSuccess` entries are serialized in snapshots. Other states (Pending, Error, Idle) are transient and don't survive SSR transfer.
- `Machine.fromSnapshot(state)` uses `switch(state.status)` to reconstruct the correct class instance. [ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q2]
- Snapshot version is an integer counter for simplicity. [ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q17]

## 6. Plugin Initialization

```mermaid
---
title: "Plugin lifecycle — createApi + createResource"
---
sequenceDiagram
    participant User
    participant CreateApi as createApi()
    participant Plugin as ReactHooksPlugin
    participant Resource as ResourceV2

    User->>CreateApi: createApi({ plugins: [reactPlugin] })
    CreateApi->>Plugin: plugin.install(context)
    Note over Plugin: Plugin registers hooks,<br/>stores reference to api context

    User->>CreateApi: api.createResource(options)
    CreateApi->>Resource: new ResourceV2(mergedOptions)
    CreateApi->>Plugin: plugin.augmentResource(resource)
    Plugin->>Resource: Attach useResourceV2Agent method
    Plugin->>Resource: Attach useResourceV2Ref method
    CreateApi-->>User: resource (augmented with hooks)

    Note over User: resource.useResourceV2Agent(args)<br/>is now available if ReactHooksPlugin<br/>was installed
```

**Type-level flow**: The `plugins` array type in `createApi` options flows through to the return type of `createResource`, which uses conditional type mapping to add plugin-contributed methods. See [ADR-1 in 04-decisions.md](./04-decisions.md#adr-1).

## 7. `onCacheEntryAdded` Lifecycle

```mermaid
---
title: "onCacheEntryAdded — Full lifecycle"
---
sequenceDiagram
    participant Resource as ResourceV2
    participant Hooks as LifecycleHooks
    participant Consumer as onCacheEntryAdded callback
    participant Entry as CacheEntry

    Resource->>Entry: Create new CacheEntry
    Resource->>Hooks: fireCacheEntryAdded(args)
    Hooks->>Consumer: callback(args, tools)
    Note over Consumer: tools = {<br/>  $cacheDataLoaded: Promise,<br/>  $cacheEntryRemoved: Promise,<br/>  getCacheEntry: () => Machine<br/>}

    Consumer->>Consumer: await tools.$cacheDataLoaded
    Note over Consumer: Resolves when first<br/>MachineSuccess is set

    Consumer->>Consumer: Set up WebSocket / subscription
    Consumer->>Consumer: Push updates via resource.update(args, data)

    Note over Entry: Time passes...<br/>All subscribers unsubscribe<br/>cacheLifetime timer expires

    Resource->>Hooks: fireCacheEntryRemoved(args)
    Hooks->>Consumer: $cacheEntryRemoved resolves

    Consumer->>Consumer: Clean up WebSocket

    Note over Consumer: If entry removed before data loads:<br/>$cacheDataLoaded REJECTS with<br/>'Cache entry removed before data loaded'<br/>→ consumer lands in catch → cleans up
```

**Firing rules:**
- `onCacheEntryAdded` fires when a **new** CacheEntry is created in the CacheMap (not on cache hit).
- `$cacheDataLoaded` resolves on the first transition to `MachineSuccess` (including from snapshot hydration).
- `$cacheEntryRemoved` resolves when the CacheEntry is evicted from CacheMap (after ref-count drops to 0 and `cacheLifetime` timer expires).
- If the entry is removed before data loads, `$cacheDataLoaded` rejects to prevent resource leaks. [ref: [03-external-research.md](../01-research/03-external-research.md)#1.3 — RTK Query cacheDataLoaded rejection pattern]

## 8. SKIP_TOKEN Data Flow

```mermaid
---
title: "SKIP_TOKEN — Preventing query execution"
---
sequenceDiagram
    participant React as React Component
    participant Hook as useResourceV2Agent
    participant Agent as ResourceV2Agent
    participant Resource as ResourceV2

    React->>Hook: useResourceV2Agent(userId ?? SKIP)

    alt args === SKIP
        Hook->>Agent: (do not call start/query)
        Note over Agent: Agent maintains previous state<br/>(idle if first render,<br/>stale data if args changed to SKIP)
        Agent-->>React: current state (no fetch triggered)
    else args is valid
        Hook->>Agent: start(args)
        Agent->>Resource: query(args)
        Note over Resource: Normal query flow
        Resource-->>Agent: CacheEntry
        Agent-->>React: { data, isLoading, ... }
    end
```

**Type safety**: `SKIP_TOKEN` is typed as `typeof SKIP`. Resource methods accept `Args | SKIP_TOKEN`. Agent's `start()` method checks at runtime: `if (args === SKIP) return`. The type system ensures `SKIP` can only be used where args are expected. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#1.6 — v1 SKIP pattern]

## 9. Reactive Query — `query$` Signal Flow

```mermaid
---
title: "resource.query$(args) — Reactive signal access"
---
sequenceDiagram
    participant Computed as Signal.compute
    participant Resource as ResourceV2
    participant CacheMap
    participant Entry as CacheEntry
    participant Machine

    Note over Computed: Inside a computed/effect context

    Computed->>Resource: resource.query$(args)
    Resource->>CacheMap: get(args)

    alt Cache miss
        Resource->>Entry: create(args) + initiate
        Resource->>CacheMap: set(args, entry)
    else Cache hit, not initiated
        Resource->>Entry: initiate if needed
    end

    Resource->>Entry: machine$.get()
    Note over Entry: .get() registers dependency<br/>via DependencyTracker
    Entry-->>Computed: TMachine (current state)

    Note over Computed: When Machine changes,<br/>this computed re-evaluates
```

`query$(args)` returns a signal read — calling it inside a `Signal.compute` or `Signal.effect` automatically subscribes to changes. The `doForce` parameter (second arg) controls whether a fresh fetch is always triggered. Unlike `query(args)` which returns a Promise of the CacheEntry, `query$(args)` returns the current machine state synchronously (as a signal read).
