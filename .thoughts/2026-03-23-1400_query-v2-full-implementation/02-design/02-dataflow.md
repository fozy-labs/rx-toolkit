---
title: "Data Flow — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-architect
---

# Data Flow — query-v2

## 1. ResourceV2 Scenarios

### 1.1 Initial Fetch

```mermaid
sequenceDiagram
    title ResourceV2 — Initial Fetch
    participant App as Application
    participant Agent as ResourceV2Agent
    participant RCE as ResourceV2CacheEntry
    participant QFn as queryFn
    
    App->>Agent: start(args: TArgs): void
    Agent->>Agent: entry: RCE<TArgs,TData> = _getEntry(args: TArgs)
    Note over Agent: _getEntry is a factory callback<br/>provided by ResourceV2 at agent creation.<br/>Internally calls CacheMap.getOrCreate(args: TArgs).
    Agent->>Agent: update _tracking$ (current ← entry)
    Agent->>RCE: query(): Promise<TData>
    RCE->>RCE: create AbortController
    RCE->>RCE: set(MachinePending<TArgs, TData>)
    Agent-->>App: state$: {status:"pending",<br/>data:null, isInitialLoading:true}
    RCE->>QFn: queryFn(args: TArgs, {abortSignal: AbortSignal}): Promise<TData>
    QFn-->>RCE: data: TData
    RCE->>RCE: set(MachineSuccess<TArgs, TData>)
    Note over RCE: Batcher.run() wraps multi-signal transitions<br/>(optional for single-signal changes — see §7.3)
    Agent-->>App: state$: {status:"success",<br/>data: TData, isLoading:false}
```

[ref: ../01-research/01-codebase-query-v2.md#54-query-execution-private] — Query execution: calls queryFn, transitions to Success via Batcher.run().

> **Note on `state$` outputs in diagrams**: Each diagram shows only the fields relevant to the scenario (e.g., `isInitialLoading` for first fetch, `isRefreshing` for invalidation). The full agent state shape is `IResourceV2AgentState<TArgs, TData>` (model §8.1) which includes: `status`, `data`, `error`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `entry`. In particular, `isLoading` is `true` whenever `status` is `pending`, `refreshing`, or the agent is in SWR transition — it is omitted from some diagrams where a more specific indicator (`isInitialLoading`, `isRefreshing`) conveys the same information.

### 1.2 Stale-While-Revalidate (Args Change)

```mermaid
sequenceDiagram
    title ResourceV2 — SWR on Args Change
    participant App as Application
    participant Agent as ResourceV2Agent
    participant NewRCE as NewResourceV2CacheEntry
    participant QFn as queryFn
    
    Note over Agent: Current shows {id:"1"} success
    App->>Agent: start(args: {id: string}): void
    Agent->>Agent: previous ← current (old entry)
    Agent->>Agent: entry: RCE<TArgs,TData> = _getEntry(args: TArgs)
    Agent->>Agent: current ← entry
    Agent->>NewRCE: query(): Promise<TData>
    NewRCE->>NewRCE: create AbortController, set(MachinePending<TArgs, TData>)
    Agent-->>App: state$: {status:"pending",<br/>data: TData (previous), isLoading:true,<br/>isInitialLoading:false}
    Note over App: Shows stale data + loading indicator
    NewRCE->>QFn: queryFn(args: TArgs, {abortSignal: AbortSignal}): Promise<TData>
    QFn-->>NewRCE: newData: TData
    NewRCE->>NewRCE: set(MachineSuccess<TArgs, TData>)
    Agent->>Agent: previous ← null (current resolved)
    Agent-->>App: state$: {status:"success",<br/>data: TData, isLoading:false}
    Note over App: Shows fresh data
```

[ref: ../01-research/04-open-questions.md#q2-how-should-the-agent-swr-previouscurrent-swap-work] — SWR must keep `previous` until `current` resolves. V1's proven approach.
[ref: ../01-research/02-codebase-query-v1.md#22-resourceagent] — V1 keeps `previous$` alive and only swaps when new cache entry reaches `isDone`.

### 1.3 Cache Hit (Same Args)

```mermaid
sequenceDiagram
    title ResourceV2 — Cache Hit (No Refetch)
    participant App as Application
    participant Agent as ResourceV2Agent
    
    Note over Agent: Current entry in MachineSuccess<TArgs, TData> with fresh data
    App->>Agent: start(args: TArgs): void
    Agent->>Agent: compareArgs(a: TArgs, b: TArgs): boolean → true
    Note over Agent: a = _lastArgs (previous start() args),<br/>b = new args from current start() call
    Note over Agent: No action — args unchanged
    Agent-->>App: state$ unchanged (cached)
```

### 1.4 Refetch (Force / Invalidation)

```mermaid
sequenceDiagram
    title ResourceV2 — Invalidation & Refetch
    participant App as Application
    participant Agent as ResourceV2Agent
    participant Res as ResourceV2
    participant RCE as ResourceV2CacheEntry
    participant QFn as queryFn
    
    App->>Res: invalidate(args: TArgs): void
    Res->>RCE: invalidate(): void [via CacheMap.get(args: TArgs)]
    Note over RCE: Entry must be in Success state
    RCE->>RCE: set(MachineRefreshing<TArgs, TData>)
    Agent-->>App: state$: {status:"refreshing",<br/>data: TData (stale), isRefreshing:true}
    RCE->>RCE: abort existing + create new AbortController
    RCE->>QFn: queryFn(args: TArgs, {abortSignal: AbortSignal}): Promise<TData>
    
    alt Success
        QFn-->>RCE: freshData: TData
        RCE->>RCE: set(MachineSuccess<TArgs, TData>)
        Agent-->>App: state$: {status:"success",<br/>data: TData, isRefreshing:false}
    else Error
        QFn-->>RCE: error: unknown
        Note over RCE: ADR-2: Stay in Success,<br/>preserve stale data
        RCE->>RCE: set(MachineSuccess<TArgs, TData>)
        Agent-->>App: state$: {status:"success",<br/>data: TData (stale), isRefreshing:false}
    end
```

[ref: ../01-research/01-codebase-query-v2.md#22-state-machine-transitions] — ADR-2: `errorHappened()` on Refreshing returns MachineSuccess with stale data preserved.

### 1.5 Abort (Per-Entry Inflight Management)

Each `ResourceV2CacheEntry` manages its own `AbortController` and inflight promise. Abort occurs at the entry level — when a new `query()` call is made on the same entry (e.g., on invalidation or force re-fetch), the previous inflight request is aborted before starting a new one. [ref: 04-decisions.md#adr-17-abort-and-inflight-management-at-cacheentry-level]

```mermaid
sequenceDiagram
    title ResourceV2 — Abort (Per-Entry)
    participant RCE as ResourceV2CacheEntry
    participant AC1 as AbortController (old)
    participant AC2 as AbortController (new)
    participant QFn as queryFn
    
    Note over RCE: MachinePending<TArgs, TData>, inflight request active
    Note over RCE: invalidate() or query(doForce: true) called
    RCE->>AC1: abort(): void
    Note over QFn: Old queryFn catches AbortError,<br/>no state transition
    RCE->>RCE: create new AbortController (AC2)
    RCE->>RCE: set(MachinePending<TArgs, TData> | MachineRefreshing<TArgs, TData>)
    RCE->>QFn: queryFn(args: TArgs, {abortSignal: AbortSignal}): Promise<TData>
    QFn-->>RCE: data: TData
    RCE->>RCE: set(MachineSuccess<TArgs, TData>)
```

**Note on agent args changes**: When an agent switches from args1 to args2, it obtains a new entry for args2 and starts a query on it. The old entry's (args1) inflight request **continues independently** — it is not aborted by the agent. Other consumers (agents, hooks) still using the args1 entry will receive its data normally. Abort within an entry occurs only when a new `query()` call is made to the **same** entry (e.g., on invalidation or force re-fetch).

### 1.6 Error → Retry

```mermaid
sequenceDiagram
    title ResourceV2 — Error and Retry
    participant App as Application
    participant Agent as ResourceV2Agent
    participant RCE as ResourceV2CacheEntry
    participant QFn as queryFn
    
    Note over RCE: MachineError<TArgs, TData> state
    App->>Agent: start(args: TArgs): void
    Note over Agent: Same args, but error state → retry
    Agent->>Agent: entry: RCE<TArgs,TData> = _getEntry(args: TArgs)
    Agent->>RCE: query(): Promise<TData>
    RCE->>RCE: set(MachinePending<TArgs, TData> via retry())
    Agent-->>App: state$: {status:"pending",<br/>data:null, isLoading:true}
    RCE->>RCE: create AbortController
    RCE->>QFn: queryFn(args: TArgs, {abortSignal: AbortSignal}): Promise<TData>
    QFn-->>RCE: data: TData
    RCE->>RCE: set(MachineSuccess<TArgs, TData>)
    RCE-->>Agent: state$ signal fires<br/>(reactive subscription)
    Agent->>Agent: derive flat state from<br/>MachineSuccess<TArgs, TData>
    Agent-->>App: state$: {status:"success",<br/>data: TData, isLoading:false}
```

### 1.7 GC Lifecycle

GC uses the `share({resetOnRefCountZero})` pattern from v1's `ReactiveCache`. The RxJS `share()` operator tracks subscriber count automatically. When the last subscriber unsubscribes, `resetOnRefCountZero` fires; if `cacheLifetime > 0`, a timer starts. If a new subscriber appears before the timer fires, the reset is cancelled. When the timer completes with zero subscribers, `finalize()` triggers `complete()` on the CacheEntry.

```mermaid
sequenceDiagram
    title ResourceV2 — GC via share({resetOnRefCountZero})
    participant Hook as useResourceV2Agent
    participant Sig as CacheEntry.obs
    participant Share as share() operator
    participant Timer as timer(cacheLifetime)
    participant CE as CacheEntry
    participant Res as ResourceV2
    
    Note over Hook,Share: Phase 1 — Active subscription
    Hook->>Sig: subscribe (refcount=1)
    
    Note over Hook,Share: Phase 2 — Component unmounts
    Hook->>Sig: unsubscribe (refcount→0)
    Share->>Timer: resetOnRefCountZero fires
    Timer->>Timer: timer(cacheLifetime: number) starts
    
    alt Resubscribe before timeout
        Hook->>Sig: subscribe (refcount=1)
        Note over Share,Timer: share() cancels pending reset
        Note over CE: Entry preserved, data intact
    else Timeout expires, no subscribers
        Timer-->>Share: timer completes
        Share-->>Sig: finalize() fires
        Sig->>CE: complete(): void
        Note over CE: abort inflight fetch (if any)<br/>→ fire onClean$
        CE->>Res: onClean$ notification
        Res->>Res: _cache.delete(args: TArgs): boolean
    end
```

**GC timer behavior by `cacheLifetime` configuration:**

| `cacheLifetime` value | `resetOnRefCountZero` | Behavior |
|---|---|---|
| `false` | `false` | GC disabled — entry lives forever |
| `0` or negative | `true` | Immediate reset on last unsubscribe |
| `> 0` (e.g., `60_000`) | `() => timer(cacheLifetime)` | Timer starts on last unsubscribe; cancelled if new subscriber arrives |

[ref: src/query/lib/ReactiveCache.ts] — V1's proven `share({resetOnRefCountZero})` implementation.
[ref: 04-decisions.md#adr-5-gc-strategy] — ADR-5 specifies the share()-based GC approach.
[ref: ../01-research/03-external-research.md#25-cache-garbage-collection-approaches] — TanStack/RTK both use timer after zero subscribers (industry standard).

**GC cleanup decisions:**

- **Abort inflight fetch — YES**: When GC fires, refcount has been 0 for `cacheLifetime`, but a fetch may still be in-flight (scenario: component starts fetch → unmounts → GC timer fires before fetch resolves). Since `queryFn` runs as a Promise independent of the RxJS subscription chain, `share()` unsubscribing upstream does not cancel it. Calling `_abortController.abort()` prevents wasted network requests on an entry being destroyed. [ref: 04-decisions.md#adr-17-abort-and-inflight-management-at-cacheentry-level]
- **Abort patches — NO** (not needed in GC context): `complete()` does not explicitly abort pending patches. During GC, this is safe because refcount=0 means no consumers hold active `IPatchHandle` references — pending patches are impossible. For `resetAll()`, the machine is reset to idle before `complete()` fires, making any remaining patch state irrelevant (idle state has no data to patch). See model §12.1 for the full `resetAll()` sequence.

## 2. Snapshot Scenarios

### 2.1 Signal → Snapshot Bridge

**Capture** (server-side):

```mermaid
sequenceDiagram
    title Snapshot — Capture
    participant Server as Server App
    participant SRes as ResourceV2 (server)
    participant Snap as getSnapshot()
    participant HTML as HTML Transfer
    
    Server->>SRes: query(args: TArgs): Promise<TData>
    SRes-->>SRes: MachineSuccess<TArgs, TData>
    Server->>Snap: api.getSnapshot(): TApiSnapshot
    Note over Snap: Iterate _resources: Set~ResourceV2~,<br/>include only MachineSuccess entries
    Snap-->>Server: snapshot: TApiSnapshot
    Server->>HTML: JSON.stringify(snapshot: TApiSnapshot)
```

**Hydrate** (client-side — per-resource consumption):

The `initialSnapshot` lifecycle works in three phases:
1. `createApi({ initialSnapshot })` — the snapshot is **saved internally** (stored as `_savedSnapshot: TApiSnapshot | null`)
2. `api.createResourceV2()` — on resource creation, the snapshot slice for this resource's `key` is **consumed**: matching entries are hydrated into the resource cache, then the slice is **deleted** from `_savedSnapshot`. If entry data is stale (age > `maxSnapshotDataAge`), auto-invalidation is triggered.
3. `api.resetAll()` — the saved snapshot is **deleted entirely** (`_savedSnapshot = null`)

```mermaid
sequenceDiagram
    title Snapshot — Hydrate (per-resource consumption)
    participant App as Application
    participant API as createApi()
    participant Res as ResourceV2
    participant RCE as ResourceV2CacheEntry
    
    App->>API: createApi({initialSnapshot: TApiSnapshot | null})
    Note over API: Save snapshot internally:<br/>_savedSnapshot = initialSnapshot
    Note over API: Validate version + keyPrefix<br/>(throw on mismatch)
    
    App->>API: api.createResourceV2<TArgs, TData>(options)
    API->>API: Create ResourceV2 with merged options
    
    alt _savedSnapshot has slice for resource.key
        API->>Res: Consume snapshot slice for key
        loop Each entry in snapshot slice
            Res->>RCE: hydrateEntry(args: TArgs, Machine.fromSnapshot<TArgs, TData>(slice))
            Note over RCE: Create RCE with MachineSuccess<TArgs, TData>
            alt entry age > maxSnapshotDataAge
                Res->>RCE: invalidate(): void (trigger refresh)
            end
        end
        API->>API: Delete slice from _savedSnapshot
    end
    
    API-->>App: IResourceV2<TArgs, TData> & PluginAugmentations
    
    Note over App,API: Later...
    App->>API: api.resetAll(): void
    Note over API: _savedSnapshot = null<br/>(saved snapshot deleted entirely)
    API->>Res: resetCache(): void (for each resource)
```

[ref: ../01-research/01-codebase-query-v2.md#7-snapshot-system] — Only MachineSuccess entries are included. `hydrateSnapshot` throws on version/prefix mismatch.

### 2.2 Snapshot Subscription Lifecycle

The snapshot → React flow uses the same signal pipeline as normal data:

```
ResourceV2CacheEntry (extends CacheEntry — Signal.state)
    ↓ machine$() signal read inside Signal.compute
ResourceV2Agent.state$ (Signal.compute)
    ↓ .obs
useSignal → useSyncExternalStore
    ↓
React render
```

Hydrated data flows through the same pipeline — there's no separate snapshot subscription model.

## 3. Plugin Scenarios

### 3.1 Plugin Hook Invocation Order

```mermaid
sequenceDiagram
    title Plugin — Installation & Augmentation
    participant App as Application
    participant API as createApi()
    participant P1 as Plugin A
    participant P2 as Plugin B
    participant Res as ResourceV2
    
    App->>API: createApi<TPlugins>({plugins: [A, B]})
    API->>P1: install(context: IPluginContext): void
    API->>P2: install(context: IPluginContext): void
    
    App->>API: createResourceV2<TArgs, TData>(options: IResourceV2Options<TArgs, TData>)
    API->>API: new ResourceV2(mergedOptions)
    API->>P1: augmentResource<TArgs, TData>(resource: IResourceV2, options: IResourceV2Options)
    P1-->>API: {useResourceV2Agent: fn}
    API->>P2: augmentResource<TArgs, TData>(resource: IResourceV2, options: IResourceV2Options)
    P2-->>API: {customMethod: fn}
    API->>API: Object.assign(resource, all contributions)
    API-->>App: IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>
```

[ref: ../01-research/01-codebase-query-v2.md#82-type-level-augmentation] — Plugin contributions are merged via Object.assign.

### 3.2 Plugin Composition

Plugins are applied sequentially. Later plugins can see earlier plugins' contributions (they're already on the resource object). Contribution key collisions are a runtime error.

### 3.3 createApi Initialization Flow

```mermaid
sequenceDiagram
    title createApi — Initialization
    participant App as Application
    participant APIF as createApi()
    participant Cfg as MergedConfig
    participant PMgr as PluginManager
    participant P as ReactHooksPlugin
    
    App->>APIF: createApi<TPlugins>(options: ICreateApiOptions<TPlugins>)
    APIF->>Cfg: merge defaults + options
    APIF->>APIF: create _resources: Set~ResourceV2~
    APIF->>PMgr: install plugins in order
    PMgr->>P: install(context: IPluginContext): void
    
    alt initialSnapshot: TApiSnapshot provided
        APIF->>APIF: Validate version + keyPrefix (throw on mismatch)
        APIF->>APIF: _savedSnapshot = initialSnapshot (save internally)
        Note over APIF: Snapshot is saved, NOT hydrated yet.<br/>Per-resource consumption happens in createResourceV2.
    end
    
    APIF-->>App: IApi<TPlugins> instance<br/>(createResourceV2,<br/>resetAll, getSnapshot)
```

`createApi` is the primary entry point for the query-v2 module. It merges default configuration with user options, creates an internal `Set<ResourceV2>` for tracking all created resources, installs each plugin via `plugin.install(context)`, and **saves** the `initialSnapshot` internally (if provided). The snapshot is NOT hydrated globally at this point — each `createResourceV2()` call consumes its own slice from the saved snapshot. The returned `IApi` object provides bound factory methods that share the merged configuration and plugin set.

[ref: docs/query-v2/v0.1/README.md] — createApi parameters and initialization flow.
[ref: 04-decisions.md#adr-16-single-api-instance-as-entry-point] — ADR-16 covers the single-instance entry point pattern.

### 3.4 ReactHooksPlugin Lifecycle

```mermaid
sequenceDiagram
    title ReactHooksPlugin — Registration & Hook Contribution
    participant App as Application
    participant API as IApi
    participant RHP as ReactHooksPlugin
    participant Res as ResourceV2
    participant Hook as useResourceV2Agent()
    
    Note over App,RHP: Phase 1 — Plugin Registration
    App->>API: createApi<TPlugins>({plugins: [new ReactHooksPlugin()]})
    API->>RHP: install(context: IPluginContext): void
    
    Note over App,Res: Phase 2 — ResourceV2 Creation & Augmentation
    App->>API: api.createResourceV2<TArgs, TData>(options: IResourceV2Options<TArgs, TData>)
    API->>API: new ResourceV2(mergedOptions)
    API->>RHP: augmentResource<TArgs, TData>(resource: IResourceV2, options: IResourceV2Options)
    RHP-->>API: {useResourceV2Agent: boundHookFn}
    API->>API: Object.assign(resource, contributions)
    API-->>App: IResourceV2<TArgs, TData> & IReactHooksPluginContributions<TArgs, TData>
    
    Note over App,Hook: Phase 3 — Hook Usage in React Component
    App->>Hook: resource.useResourceV2Agent(...args: ArgsOrVoidOrSkip<TArgs>): IResourceV2AgentState<TArgs, TData>
    Note over Hook: Internally creates Agent,<br/>subscribes via useSignal
    Hook-->>App: IResourceV2AgentState<TArgs, TData>
```

`ReactHooksPlugin` contributes the `useResourceV2Agent()` method to each resource instance via `augmentResource()`. This method is a bound hook that internally creates a `ResourceV2Agent`, starts it with the given args, and subscribes to `agent.state$` via `useSignal` (backed by `useSyncExternalStore`). The same hook can also be used standalone as `useResourceV2Agent(resource, args)` without the plugin — the plugin simply provides the convenience of calling it as a method on the resource instance.

[ref: docs/query-v2/v0.1/README.md] — ReactHooksPlugin adds `useResourceV2Agent` to resources. Standalone usage also documented.

## 4. State Machine Specifications

### 4.1 ResourceV2 State Machine

Complete state machine for ResourceV2 cache entries. All transitions return new immutable machine instances.

```mermaid
stateDiagram-v2
    title ResourceV2 Machine States
    
    [*] --> Idle
    
    Idle --> Pending : start(args: TArgs) [user]
    
    Pending --> Success : successHappened(data: TData) [internal]
    Pending --> Error : errorHappened(error: unknown) [internal]
    
    Success --> Refreshing : invalidate() [user]
    Success --> Pending : start(args: TArgs) [user, machine-level]
    
    Refreshing --> Success : successHappened(data: TData) [internal]
    Refreshing --> Success : errorHappened(error: unknown) [internal, ADR-2]
    
    Error --> Pending : retry() / start(args: TArgs) [user]
    
    Idle --> Idle : reset() [user]
    Pending --> Idle : reset() [user]
    Success --> Idle : reset() [user]
    Error --> Idle : reset() [user]
    Refreshing --> Idle : reset() [user]
```

**Transition classification:**

| Transition | Trigger | Who invokes |
|-----------|---------|-------------|
| `start(args: TArgs)` | User triggers query | Agent, Application |
| `invalidate()` | User or cross-resource | Application |
| `retry()` | User retries after error | Agent, Application |
| `reset()` | User resets or resetAll() | Application, createApi.resetAll() |
| `successHappened(data: TData)` | queryFn resolves | ResourceV2CacheEntry (internal) |
| `errorHappened(error: unknown)` | queryFn rejects | ResourceV2CacheEntry (internal) |

**State data availability:**

| State | `data` | `error` | `args` | Patches possible |
|-------|--------|---------|--------|-----------------|
| idle | null | null | null | No |
| pending | null | null | TArgs | No |
| success | TData | null | TArgs | Yes |
| error | null | unknown | TArgs | No |
| refreshing | TData (stale) | null | TArgs | Yes |

[ref: ../01-research/01-codebase-query-v2.md#23-machine-state-shapes] — State shapes from v0.1 docs and existing machine classes.

**Entry-level vs agent-level transitions**: All transitions above are **machine-level** (entry-level) — they happen within a single `ResourceV2CacheEntry`. The `Success → Pending` via `start(args)` is a machine-level hard restart (resets data, re-fetches). It is **not** the SWR args-change scenario. SWR (Stale-While-Revalidate on args change) is an **agent-level** concept: the agent creates/switches to a _new_ entry (which starts in Idle → Pending) while keeping the _old_ entry in its current state (Success). The agent composes both entries into a single flat state showing stale data + loading. See §1.2 for the agent-level SWR flow.

## 5. Cache Data Flow

### 5.1 Write Path (Fetch → Store)

```mermaid
---
title: Write Path
---
flowchart LR
    A[queryFn(args: TArgs, tools) called] --> B{Success?}
    B -->|Yes| C[MachineSuccess<TArgs, TData><br/>created with data: TData + updatedAt]
    B -->|No| D[MachineError<TArgs><br/>created with error: unknown]
    C --> E[Batcher.run<br/>groups multiple writes]
    D --> E
    E --> F[CacheEntry.set(machine: TMachineInstance<TArgs, TData>)<br/>Signal.state update]
    F --> G[Signal notifies<br/>all subscribers]
    G --> H[ResourceV2Agent.state$<br/>recomputes]
    G --> I[LifecycleHooks<br/>resolve promises]
```

### 5.2 Read Path (Key → Snapshot)

```mermaid
---
title: Read Path
---
flowchart LR
    A[args: TArgs] --> B[CacheMap.get(args: TArgs):<br/>RCE | undefined]
    B --> C{Found?}
    C -->|Yes| D[ResourceV2CacheEntry<TArgs, TData>]
    C -->|No| E[null / create if doInitiate]
    E -->|"doInitiate=true"| D
    D --> F[state$(): TMachineInstance<TArgs, TData><br/>reactive read]
    F --> G[Signal notifies<br/>all subscribers]
    G --> H[ResourceV2Agent.state$<br/>derives flat state]
    G --> H2[useSignal<br/>React snapshot]
```

### 5.3 Invalidation Cascade

```mermaid
---
title: Invalidation Flow
---
flowchart TB
    A[ResourceV2.invalidate(args: TArgs)] --> A1[CacheMap.get(args: TArgs):<br/>RCE | undefined]
    A1 --> A2[Delegate to<br/>RCE.invalidate(): void]
    A2 --> B{Entry in<br/>Success?}
    B -->|No| C[No-op]
    B -->|Yes| D[MachineSuccess.invalidate():<br/>MachineRefreshing<TArgs, TData>]
    D --> E[RCE aborts existing<br/>inflight if any]
    E --> F[queryFn(args: TArgs, {abortSignal: AbortSignal}):<br/>Promise<TData>]
    F --> G{Result}
    G -->|Success| H[MachineSuccess<TArgs, TData><br/>with fresh data: TData]
    G -->|Error| I[MachineSuccess<TArgs, TData><br/>stale data preserved]
```

### 5.4 GC Trigger Flow

```mermaid
---
title: GC Trigger Flow
---
flowchart TB
    A[Signal subscriber<br/>unsubscribes] --> B[Refcount decrements]
    B --> C{refcount == 0?}
    C -->|No| D[No action]
    C -->|Yes| E[resetOnRefCountZero:<br/>timer(cacheLifetime: number)]
    E --> F{Timer fires}
    F --> G{refcount still 0?}
    G -->|No| H[Cancel: entry still active]
    G -->|Yes| I[abort inflight fetch if any]
    I --> J[CacheEntry.complete(): void<br/>fires onClean$, marks completed]
    J --> K[CacheMap.delete(args: TArgs): boolean]
    K --> L[LifecycleHooks.fireCacheEntryRemoved(args: TArgs): void]
```

[ref: ../01-research/04-open-questions.md#q5-how-should-cacheentrycomplete-behave] — On `complete()`: abort inflight fetch (if any), fire `onClean$`, mark entry as completed. Patch abort is unnecessary — see §1.7 GC cleanup decisions.
[ref: ../01-research/04-open-questions.md#q11-what-gc-strategy-should-v2-use] — Hybrid refcount+timer: industry standard from TanStack/RTK.

### 5.5 Optimistic Patch Flow

```mermaid
---
title: Optimistic Patch Lifecycle
---
flowchart TB
    A[entry.createPatch(patchFn:<br/>(draft: TData) => void):<br/>IPatchHandle | null] --> B{Entry has data?<br/>success/refreshing}
    B -->|No| C[return null]
    B -->|Yes| D[Patcher.createPatch(patchFn,<br/>data: TData):<br/>{patch: TPatch, data: TData}]
    D --> E[Patch added to queue<br/>status: pending]
    E --> F[Signal updates with<br/>patched data: TData]
    F --> G{User action}
    G -->|commit| H[Patch status: committed]
    G -->|abort| I[Patch status: aborted]
    H --> J[Patcher.resolvePatches(originalData: TData,<br/>patches: TPatch[]):<br/>IPatchResolution<TData>]
    I --> K{applyPatches<br/>inverse succeeds?}
    K -->|Yes| L[Patcher.resolvePatches:<br/>rollback applied]
    K -->|No| M[Consistency violation<br/>entry.invalidate(): void]
    J --> N[CacheEntry.set(machine:<br/>TMachineInstance<TArgs, TData>)]
    L --> N
    M --> O[Keep last valid data: TData<br/>until refetch completes]
```

[ref: ../01-research/01-codebase-query-v2.md#31-patcher] — Patcher uses `produceWithPatches` and `applyPatches` from Immer.
[ref: ../01-research/04-open-questions.md#q6-how-should-consistency-violation-detection-work-in-the-patcher] — Patcher returns `{data, isConsistencyViolation}` tuple; ResourceV2 checks and invalidates.

## 6. Reactive Chain Details

### 6.1 ResourceV2 → ResourceV2Agent → React Signal Chain

```
ResourceV2CacheEntry.query()
  → Batcher.run(() => {
      ResourceV2CacheEntry.set(newMachine)   // Signal.state<TState> write (inherited)
    })
  → Signal notification propagates
  → ResourceV2Agent.state$ (Signal.compute) recomputes:
      reads _tracking$()          // dependency registered
      reads current.machine$()    // signal read — machine$ property (reactive alias for inherited state$())
      reads previous?.machine$()  // if SWR active
      → derives {status, data, error, isLoading, ...}
  → useSignal(agent.state$)
      → useSyncExternalStore detects change
      → React re-render
```

### 6.2 getEntry$ Reactive Design

[ref: docs/query-v2/v0.1/Внутриянка.md] — Uses `Signal.compute` reading `_status$` and `_lastEntry$`.

```
ResourceV2._status$ : Signal.state<"idle" | "ready">
ResourceV2._lastEntry$ : Signal.state<ResourceV2CacheEntry<TArgs, TData> | null>

getEntry$(args):
  Signal.compute(() => {
    if (_status$() === "idle")  → return null  // reacts to resetAll
    if (binded)                 → return binded
    entry = _lastEntry$()       
    if (entry.isMyArgs(args))   → binded = entry; return entry
    return null
  })
```

When `resetAll()` fires:
1. `_status$.set("idle")` 
2. All `getEntry$` computeds re-evaluate
3. Condition `_status$() === "idle"` → all return null
4. Consumers see null → show appropriate UI

### 6.3 Batcher.run() Usage Semantics

`Batcher.run()` is an **optimization for grouping multiple signal writes** into a single notification pass. It is **not required for single state changes**.

- **Single signal change** (e.g., `cacheEntry.set(newMachine)`): The signal update propagates immediately to all subscribers without explicit batching.
- **Multiple signal changes** (e.g., machine transition + `_status$` update + `_lastEntry$` update): Wrap in `Batcher.run(() => { ... })` to ensure subscribers see a consistent snapshot rather than intermediate states.

In practice, `ResourceV2.query()` uses `Batcher.run()` because a fetch completion may update both the cache entry's machine state and internal tracking signals (`_status$`, `_lastEntry$`).

### 6.4 resetAll() Consolidated Sequence

The `resetAll()` sequence spans multiple subsystems. This diagram consolidates the full flow described across §2.1 (snapshot deletion), §5.4 (GC/complete), and §6.2 (reactive reset).

```mermaid
sequenceDiagram
    title resetAll() — Full Sequence
    participant App as Application
    participant API as IApi
    participant Res as ResourceV2
    participant RCE as ResourceV2CacheEntry
    participant CE as CacheEntry
    participant LH as LifecycleHooks

    App->>API: resetAll(): void
    API->>API: _savedSnapshot = null

    loop Each resource in _resources: Set~ResourceV2~
        API->>Res: resetCache(): void
        Res->>Res: _status$.set("idle")
        loop Each entry in CacheMap
            Res->>RCE: reset machine to MachineIdle<TArgs, TData>
            Note over RCE: Pending patch state becomes irrelevant<br/>(idle has no data to patch)
            Res->>CE: complete(): void
            Note over CE: Abort inflight fetch (if any),<br/>fire onClean$, mark completed
            CE->>LH: fireCacheEntryRemoved(args: TArgs): void
        end
        Res->>Res: CacheMap.clear()
    end

    Note over API: All getEntry$() computeds re-evaluate → return null
    Note over App: Consumers see null → show appropriate UI
```

[ref: §2.1] — `_savedSnapshot = null` on resetAll.
[ref: §5.4] — GC trigger / CacheEntry.complete() lifecycle.
[ref: §6.2] — `_status$` set to "idle" → getEntry$ returns null.
