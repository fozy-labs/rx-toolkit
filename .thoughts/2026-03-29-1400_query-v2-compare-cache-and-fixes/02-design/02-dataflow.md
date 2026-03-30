---
title: "Data Flow: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

# Data Flow

## 1. Area A — CacheMap Data Flow

### 1.1 CompareCacheMap: getOrCreate with Monotonic Counter

The proposed `CompareCacheMap` uses `Map<TArgs, TEntry>` with reference-identity keys. On a cache miss, it derives `argsKey` from a monotonic counter (or user-provided `devtoolsKey`), then passes `(args, argsKey)` to the factory. The factory creates a `ResourceV2CacheEntry` whose `CacheEntry` base class creates `Signal.state` with `keyParts.join(":")` as the devtools key [ref: ../01-research/01-codebase-analysis.md#Area B].

```mermaid
---
title: "CompareCacheMap.getOrCreate — Proposed Data Flow"
---
sequenceDiagram
    participant Caller as ResourceV2
    participant CM as CompareCacheMap
    participant Map as Map‹TArgs, TEntry›
    participant F as Factory (args, argsKey)
    participant Entry as ResourceV2CacheEntry
    participant CE as CacheEntry (base)
    participant Sig as Signal.state

    Caller->>CM: getOrCreate(args)
    CM->>Map: get(args) [reference identity ===]

    alt Cache hit
        Map-->>CM: entry
        CM-->>Caller: entry
    else Cache miss
        Map-->>CM: undefined
        CM->>CM: argsKey = devtoolsKey?.(args) ?? String(_counter++)
        Note over CM: _counter: 0 → 1 (monotonic, never reused)
        CM->>F: factory(args, "0")
        F->>Entry: new ResourceV2CacheEntry({args, entryOptions: {keyParts: ["Resource/", "users/", "0"]}})
        Entry->>CE: super(MachinePending, {keyParts})
        CE->>Sig: Signal.state(init, {key: "Resource/:users/:0"})
        Note over Sig: Devtools displays "Resource/:users/:0"
        F-->>CM: entry
        CM->>Map: set(args, entry)
        CM-->>Caller: entry
    end
```

Key properties:
- **Zero serialization calls** — the compare strategy never invokes `serializeFn` or `stableStringify` [ref: ../01-research/03-problem-analysis-devtools.md#Problem #3]
- **Counter is per-CompareCacheMap instance** — each resource's cache has its own counter starting at 0
- **Counter increments on miss only** — `get`, `has`, `delete` do not increment the counter
- **Deleted entries' counter values are not reused** — if entry "0" is deleted and a new entry created, it gets "1" (or the next counter value), ensuring unique devtools keys over the lifetime of the resource

### 1.2 SerializeCacheMap: getOrCreate — Single Serialization

The proposed `SerializeCacheMap` passes its already-computed serialized key to the factory as `argsKey`, eliminating the redundant second serialization call [ref: ../01-research/03-problem-analysis-devtools.md#Problem #4].

```mermaid
---
title: "SerializeCacheMap.getOrCreate — Proposed Data Flow (Single Serialization)"
---
sequenceDiagram
    participant Caller as ResourceV2
    participant SM as SerializeCacheMap
    participant GK as _getKey(args)
    participant WM as WeakMap (doCacheArgs)
    participant Map as Map‹string, TEntry›
    participant F as Factory (args, argsKey)
    participant Entry as ResourceV2CacheEntry
    participant CE as CacheEntry (base)
    participant Sig as Signal.state

    Caller->>SM: getOrCreate(args)
    SM->>GK: _getKey(args)

    alt doCacheArgs enabled + object args
        GK->>WM: get(args)
        alt WeakMap hit
            WM-->>GK: cachedKey
        else WeakMap miss
            GK->>GK: serializeArgs(args) [SINGLE serialization call]
            GK->>WM: set(args, key)
        end
    else no caching or primitive args
        GK->>GK: serializeArgs(args) [SINGLE serialization call]
    end

    GK-->>SM: key = '{"id":1}'
    SM->>Map: get(key)

    alt Cache hit
        Map-->>SM: entry
        SM-->>Caller: entry
    else Cache miss
        Map-->>SM: undefined
        SM->>F: factory(args, '{"id":1}')
        Note over F: argsKey received from CacheMap — no second serialization
        F->>Entry: new ResourceV2CacheEntry({args, entryOptions: {keyParts: ["Resource/", "users/", '{"id":1}']}})
        Entry->>CE: super(MachinePending, {keyParts})
        CE->>Sig: Signal.state(init, {key: 'Resource/:users/:{"id":1}'})
        F-->>SM: entry
        SM->>Map: set(key, entry)
        SM-->>Caller: entry
    end
```

**Comparison with current (problem #4)**:
- **Current**: `_getKey(args)` calls `serializeArgs(args)` (call #1), then factory closure calls `serializeFn(args)` again (call #2) — both produce the identical string [ref: ../01-research/03-problem-analysis-devtools.md#Exact Redundancy Locations]
- **Proposed**: `_getKey(args)` calls `serializeArgs(args)` (call #1), passes the result as `argsKey` to factory — factory uses `argsKey` directly, **zero additional serialization**

### 1.3 CompareCacheMap Entry Lifecycle — State Diagram

```mermaid
---
title: "CompareCacheMap Entry Lifecycle"
---
stateDiagram-v2
    [*] --> Empty: new CompareCacheMap()

    Empty --> HasEntry: getOrCreate(args) [cache miss]
    note right of HasEntry: Map.set(args, factory(args, argsKey))

    HasEntry --> HasEntry: getOrCreate(args) [cache hit]
    note right of HasEntry: Map.get(args) → entry [O(1)]

    HasEntry --> HasEntry: get(args) [hit]
    HasEntry --> HasEntry: has(args) [true]

    HasEntry --> MaybeEmpty: delete(args)
    note right of MaybeEmpty: Map.delete(args) → true [O(1)]

    MaybeEmpty --> Empty: size === 0
    MaybeEmpty --> HasEntry: size > 0

    HasEntry --> Empty: clear()
    note right of Empty: Map.clear()

    Empty --> Empty: get(args) → undefined
    Empty --> Empty: has(args) → false
    Empty --> Empty: delete(args) → false
```

All Map operations — `get`, `set`, `delete`, `has`, `clear` — are O(1) amortized. Contrast with current: `_find` is O(n), `delete` is O(n) findIndex + O(n) splice [ref: ../01-research/02-problem-analysis-cache.md#Problem #1].

### 1.4 doCacheArgs: SerializeCacheMap vs CompareCacheMap

```mermaid
---
title: "doCacheArgs Applicability by Strategy"
---
flowchart TB
    Start["getOrCreate(args) called"]

    Start --> CheckStrategy{keyStrategy?}

    CheckStrategy -->|"serialize"| SCM["SerializeCacheMap"]
    CheckStrategy -->|"compare"| CCM["CompareCacheMap"]

    SCM --> CheckDoCache{doCacheArgs?}
    CheckDoCache -->|true| WMPath["WeakMap‹object, string›<br/>caches args → serialized key"]
    CheckDoCache -->|false| DirectSerialize["serializeArgs(args)<br/>every call"]

    WMPath --> MapLookup1["Map.get(key) — O(1)"]
    DirectSerialize --> MapLookup1

    CCM --> MapLookup2["Map.get(args) — O(1)<br/>reference identity"]

    MapLookup1 --> Done["Entry returned or created"]
    MapLookup2 --> Done

    style CCM fill:#e8f5e9
    style WMPath fill:#e3f2fd
    style MapLookup2 fill:#e8f5e9
```

**SerializeCacheMap** (unchanged):
- `doCacheArgs: true` → `WeakMap<object, string>` memoizes `serializeArgs` result per args reference. Avoids re-serialization when the same object reference is passed repeatedly (common in React hooks) [ref: ../01-research/01-codebase-analysis.md#Area A]
- `doCacheArgs: false` (default) → `serializeArgs(args)` called on every `get`/`getOrCreate`/`has`/`delete`

**CompareCacheMap** (proposed):
- `doCacheArgs` is **not applicable** — `Map<TArgs, TEntry>` provides O(1) reference-identity lookup inherently. There is no serialization step to cache. The option is ignored if passed (same as current, but now deliberately so) [ref: ../01-research/05-open-questions.md#Q2]

---

## 2. Area B — LifecycleHooks Data Flow

### 2.1 Entry Creation → Hooks Setup → Query Lifecycle (Proposed)

Each `ResourceV2CacheEntry` owns its lifecycle resolver state. The entry constructor fires `onCacheEntryAdded` (creating `$cacheDataLoaded` and `$cacheEntryRemoved` resolvers), then `_doFetch` fires `onQueryStarted` (creating a `$queryFulfilled` resolver). All scoped to a single entry instance — no shared Map [ref: ../01-research/05-open-questions.md#Q4].

```mermaid
---
title: "Per-Entry Lifecycle Hooks — Full Query Lifecycle"
---
sequenceDiagram
    participant R as ResourceV2._entryFactory
    participant E as ResourceV2CacheEntry
    participant CB1 as onCacheEntryAdded callback
    participant Fetch as _doFetch()
    participant CB2 as onQueryStarted callback
    participant QFn as queryFn

    R->>E: new ResourceV2CacheEntry({onCacheEntryAdded, onQueryStarted, ...})

    Note over E: Constructor: (1) super() creates Signal with MachinePending

    alt onCacheEntryAdded defined
        E->>E: Create _entryDataLoaded = new PromiseResolver‹TData›()
        E->>E: Create _entryRemoved = new PromiseResolver‹void›()
        E->>CB1: onCacheEntryAdded(args, {$cacheDataLoaded, $cacheEntryRemoved})
        Note over CB1: User callback sets up async watchers
    end

    Note over E: Constructor: (2) if no initialMachine → _doFetch()

    E->>Fetch: _doFetch()
    Fetch->>Fetch: Abort previous (if any)

    alt onQueryStarted defined
        Fetch->>Fetch: Reject leftover _queryFulfilled (if pending)
        Fetch->>Fetch: Create _queryFulfilled = new PromiseResolver‹{data}›()
        Fetch->>CB2: onQueryStarted(args, {$queryFulfilled, getCacheEntry})
        Note over CB2: User callback awaits $queryFulfilled
    end

    Fetch->>QFn: queryFn(args, {abortSignal})

    alt Success
        QFn-->>Fetch: data
        Fetch->>E: set(MachineSuccess(args, data, null, now))
        Fetch->>E: _onDataLoaded → resolve _entryDataLoaded (first time only)
        Fetch->>E: resolve _queryFulfilled({data})
        Note over CB2: $queryFulfilled resolves with {data}
    else Error
        QFn-->>Fetch: error
        alt Machine was "refreshing"
            Fetch->>E: set(MachineSuccess(args, staleData, patchState, updatedAt, error))
        else Machine was "pending"
            Fetch->>E: set(MachineError(args, error))
        end
        Fetch->>E: reject _queryFulfilled(error)
        Note over CB2: $queryFulfilled rejects with error
    end
```

Compared to current architecture where callbacks are closures to a shared `LifecycleHooks` instance with `Map<TArgs, Resolvers>`, the proposed flow:
- **Eliminates args-keyed Map lookup** — resolvers are fields on the entry, not Map entries
- **Eliminates cross-entry interference** — `fireQueryStarted` on one entry cannot overwrite another entry's `$queryFulfilled`
- **Handles refetch correctly** — before creating a new `_queryFulfilled` resolver, the old one is explicitly rejected (prevents promise leak) [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5]

### 2.2 resetCache — Per-Entry Cleanup vs Shared clearAll

**Current flow** — shared `LifecycleHooks.clearAll()`:

```mermaid
---
title: "Current resetCache — Shared LifecycleHooks"
---
sequenceDiagram
    participant R as ResourceV2
    participant Cache as ICacheMap
    participant LH as LifecycleHooks (shared)
    participant E1 as Entry A
    participant E2 as Entry B

    R->>Cache: values() → [entryA, entryB]
    R->>Cache: clear()
    R->>E1: complete()
    Note over E1: Aborts inflight, fires onClean$
    E1->>LH: fireCacheEntryRemoved(argsA) [via onClean$ subscription]
    Note over LH: _entryResolvers.get(argsA) → resolve $cacheEntryRemoved, delete
    R->>E2: complete()
    E2->>LH: fireCacheEntryRemoved(argsB)
    R->>LH: clearAll()
    Note over LH: Iterates ALL remaining resolvers, rejects dataLoaded, resolves entryRemoved
    Note over LH: Also rejects ALL remaining queryFulfilled
    Note over LH: PROBLEM: clearAll may double-process already-handled entries
```

**Proposed flow** — per-entry cleanup:

```mermaid
---
title: "Proposed resetCache — Per-Entry Lifecycle Cleanup"
---
sequenceDiagram
    participant R as ResourceV2
    participant Cache as ICacheMap
    participant E1 as Entry A (owns resolvers)
    participant E2 as Entry B (owns resolvers)

    R->>Cache: values() → [entryA, entryB]
    R->>Cache: clear()

    R->>E1: complete()
    Note over E1: (1) Abort inflight fetch
    Note over E1: (2) Reject _entryDataLoaded (if unresolved)
    Note over E1: (3) Resolve _entryRemoved
    Note over E1: (4) Reject _queryFulfilled (if pending)
    Note over E1: (5) super.complete() → fires onClean$

    R->>E2: complete()
    Note over E2: Same cleanup sequence — fully self-contained

    Note over R: No shared LifecycleHooks.clearAll() needed
    Note over R: No _lifecycleHooks field exists on ResourceV2
```

Key simplification: Each entry's `complete()` handles all its own lifecycle cleanup. `ResourceV2.resetCache()` simply iterates entries and calls `complete()` on each — no separate `clearAll()` call needed. This also eliminates the risk of double-processing resolvers (current `clearAll` may process entries that `fireCacheEntryRemoved` already handled) [ref: ../01-research/01-codebase-analysis.md#Area C].

### 2.3 Entry-Level Hook State Machine

Each entry's lifecycle resolver state follows a simple lifecycle scoped entirely to the entry instance:

```mermaid
---
title: "Entry-Level Lifecycle Hook States"
---
stateDiagram-v2
    [*] --> Idle : Entry created (no onQueryStarted)
    [*] --> EntryAdded : Entry created (onCacheEntryAdded defined)

    EntryAdded --> QueryStarted : _doFetch() called, onQueryStarted defined
    Idle --> QueryStarted : _doFetch() called, onQueryStarted defined
    Idle --> Idle : _doFetch() called, no onQueryStarted

    note right of QueryStarted : _queryFulfilled resolver active

    QueryStarted --> Fulfilled : queryFn resolves
    QueryStarted --> Rejected : queryFn rejects

    note right of Fulfilled : _queryFulfilled resolved, _entryDataLoaded resolved (first time)
    note right of Rejected : _queryFulfilled rejected with error

    Fulfilled --> QueryStarted : invalidate() then _doFetch()
    Rejected --> QueryStarted : query(force) then _doFetch()

    note left of QueryStarted : On re-entry old _queryFulfilled is rejected first

    Fulfilled --> Cleaned : complete()
    Rejected --> Cleaned : complete()
    QueryStarted --> Cleaned : complete()
    Idle --> Cleaned : complete()
    EntryAdded --> Cleaned : complete()

    note right of Cleaned : All pending resolvers settled, _entryRemoved resolved

    Cleaned --> [*]
```

**Transition rules**:
- `QueryStarted → QueryStarted` (refetch): The old `_queryFulfilled` promise is explicitly rejected before creating a new resolver. This prevents the silent overwrite and promise leak present in the current shared `LifecycleHooks._queryResolvers.set()` [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5]
- `EntryAdded`: `_entryDataLoaded` resolver is created once (in constructor). It resolves on first successful fetch. If the entry is completed before any success, it is rejected.
- `Cleaned`: Terminal state. All promises are settled. `_entryRemoved.resolve()` fires to signal the `$cacheEntryRemoved` promise.

---

## 3. Area C — Demo Data Flow

### 3.1 SWR State Machine: Why isError Stays false

The machine state transitions explain why `isError` is never `true` in the current demos. The key is that `isError` derives from `originalStatus === "error"`, which requires `MachineError` — only reachable from `MachinePending` [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Root cause].

```mermaid
---
title: "SWR State Machine — isError Derivation"
---
stateDiagram-v2
    [*] --> MachinePending: Entry created

    MachinePending --> MachineSuccess: queryFn resolves
    note right of MachineSuccess: status="success", isError=false

    MachinePending --> MachineError: queryFn rejects
    note right of MachineError: status="error", isError=true

    MachineError --> MachinePending: query(force) or retry

    MachineSuccess --> MachineRefreshing: invalidate()
    note right of MachineRefreshing: status="refreshing", data preserved

    MachineRefreshing --> MachineSuccess_OK: queryFn resolves
    note right of MachineSuccess_OK: status="success", lastError=undefined

    MachineRefreshing --> MachineSuccess_SWR: queryFn rejects
    note right of MachineSuccess_SWR: status="success", lastError=error, isError=false

    state MachineSuccess_OK <<choice>>
    state MachineSuccess_SWR <<choice>>

    MachineSuccess_OK --> MachineRefreshing: invalidate()
    MachineSuccess_SWR --> MachineRefreshing: invalidate()
```

### 3.2 error-swr-states.tsx Trace

Tracing the actual queryFn logic in `error-swr-states.tsx` [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#1. error-swr-states.tsx]:

```mermaid
---
title: "error-swr-states.tsx — Fetch Count Trace"
---
sequenceDiagram
    participant User
    participant Hook as useResourceV2Agent
    participant Entry as CacheEntry
    participant QFn as queryFn (throws on even fetchCount)

    Note over QFn: fetchCount starts at 0

    User->>Hook: Component mounts
    Hook->>Entry: getOrCreate(void) → new entry (MachinePending)
    Entry->>QFn: fetchCount++ → fetchCount=1
    Note over QFn: 1 % 2 = 1 ≠ 0 → SUCCESS
    QFn-->>Entry: data
    Entry->>Entry: set(MachineSuccess) → isError=false

    User->>Hook: Click "Invalidate"
    Hook->>Entry: invalidate()
    Entry->>Entry: set(MachineRefreshing) [data preserved]
    Entry->>QFn: fetchCount++ → fetchCount=2
    Note over QFn: 2 % 2 = 0 → THROWS ERROR
    QFn-->>Entry: error
    Note over Entry: Machine is "refreshing" (not "pending")
    Entry->>Entry: set(MachineSuccess(data, patchState, updatedAt, error))
    Note over Entry: status="success", lastError=error, isError=false

    User->>Hook: Click "Invalidate" again
    Entry->>QFn: fetchCount++ → fetchCount=3
    Note over QFn: 3 % 2 = 1 ≠ 0 → SUCCESS
    QFn-->>Entry: newData
    Entry->>Entry: set(MachineSuccess(newData)) → lastError=undefined

    Note over Entry: Pattern repeats: odd→success, even→SWR error
    Note over Entry: isError is NEVER true because the first fetch always succeeds
```

**Why the UI is misleading**: The demo displays `isError: {String(state.isError)}` which always shows `isError: false`. The conditional error banner `{state.isError && (...)}` never renders. The demo should instead show `lastError` (accessible via `state.error` when `state.isRefreshError` is true) to demonstrate the SWR error-recovery behavior [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Summary].

**Fix approach** (per user feedback — description only, no queryFn changes) [ref: ../01-research/05-open-questions.md#Q8]:
- Replace `isError` display with `isRefreshError` and `lastError` display
- Update description text from "error state" to "SWR error recovery"
- Remove or relabel the conditional error banner that never renders
- Show `state.error` / `state.lastError` to demonstrate that error information IS available even when `isError` is `false`
