---
title: "Appendix C — Lifecycle Sequence Diagrams"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## 1. Resource Fetch Lifecycle

The diagram shows the happy-path fetch triggered on entry creation (constructor auto-fetch), including lifecycle hooks and signal updates.

```mermaid
sequenceDiagram
    participant C as Consumer
    participant R as Resource
    participant A as ResourceAgent
    participant E as ResourceCacheEntry
    participant M as Machine (Signal)
    participant Q as queryFn

    C->>A: start(args)
    A->>R: _getEntry$(args)
    R->>R: _entryFactory(args, argsKey)
    R->>E: new ResourceCacheEntry(options)
    activate E
    E->>M: set(MachinePending)
    E->>E: _fireCacheEntryAdded()
    Note right of E: Creates $cacheDataLoaded<br/>& $cacheEntryRemoved promises.<br/>Calls onCacheEntryAdded(args, tools)
    E->>E: _doFetch()
    E->>E: abort previous (if any)
    E->>E: new AbortController()
    Note right of E: Rejects stale _queryFulfilled<br/>with "Query superseded"
    E->>E: fire onQueryStarted(args, tools)
    Note right of E: Provides $queryFulfilled<br/>& getCacheEntry()
    E->>Q: queryFn(args, {abortSignal})
    Q-->>E: Promise<TData> resolves
    E->>E: stale check (controller === _abortController)
    E->>M: set(MachineSuccess(data))
    Note right of M: Signal update triggers<br/>reactive consumers
    E->>E: resolve $cacheDataLoaded(data)
    E->>E: resolve $queryFulfilled({data})
    deactivate E
    M-->>A: machine$() changed
    A->>A: _deriveState$() recomputes
    A-->>C: state$ → {status:"success", data}
```

### Resource Invalidate / Refresh Sub-Flow

```mermaid
sequenceDiagram
    participant C as Consumer
    participant E as ResourceCacheEntry
    participant M as Machine (Signal)
    participant Q as queryFn

    C->>E: invalidate()
    E->>M: set(MachineRefreshing)
    E->>E: _doFetch()
    E->>Q: queryFn(args, {abortSignal})
    alt success
        Q-->>E: data
        E->>E: Patcher.resolvePatches(data, patches)
        E->>M: set(MachineSuccess(resolvedData))
        E->>E: resolve $queryFulfilled({data})
    else error (refreshing)
        Q-->>E: error
        Note right of E: Preserves stale data!
        E->>M: set(MachineSuccess(staleData, lastError))
        E->>E: reject $queryFulfilled(error)
    end
```

---

## 2. Command Execution Lifecycle

The diagram shows a trigger flow including linked Resource effects (optimistic updates, post-mutation patches, invalidation).

```mermaid
sequenceDiagram
    participant C as Consumer
    participant CA as CommandAgent
    participant Cmd as Command
    participant E as CommandCacheEntry
    participant M as Machine (Signal)
    participant LR as Linked Resources
    participant Q as queryFn

    C->>CA: trigger(args)
    CA->>Cmd: _getOrCreateEntry(symbol)
    Cmd->>E: new CommandCacheEntry(options)
    Note right of E: Initial state: CommandIdle.<br/>No auto-fetch.
    CA->>E: initiate(args)
    activate E
    E->>E: abort previous + reject old triggerResolver
    E->>E: new AbortController()
    E->>E: new PromiseResolver (triggerResolver)
    E->>M: set(CommandLoading(args))
    E->>LR: optimisticUpdate via ResourceRef.patch()
    Note right of LR: Patches linked Resource<br/>entries (Immer drafts)
    E->>E: fire onQueryStarted(args, tools)
    Note right of E: Provides $queryFulfilled
    E->>Q: queryFn(args, {abortSignal})
    Q-->>E: Promise<TResult> resolves
    E->>E: stale check (signal.aborted?)

    rect rgb(230, 245, 230)
        Note over E,LR: Batcher.run() — batched signal updates
        E->>M: set(CommandSuccess(data))
        E->>LR: commit optimistic patches
        E->>LR: apply update patches (linkDef.update)
        E->>LR: invalidate linked resources
    end

    E->>E: resolve $cacheDataLoaded(data)
    E->>E: resolve $queryFulfilled({data})
    E->>E: resolve triggerResolver(data)
    deactivate E
    M-->>CA: state$() changed
    CA-->>C: state$ → {status:"success", data}
```

### Command Error Sub-Flow

```mermaid
sequenceDiagram
    participant E as CommandCacheEntry
    participant M as Machine (Signal)
    participant LR as Linked Resources

    Note over E: queryFn rejects with error

    rect rgb(255, 235, 235)
        Note over E,LR: Batcher.run() — batched
        E->>M: set(CommandError(error))
        E->>LR: abort all optimistic patches
    end

    E->>E: reject $queryFulfilled(error)
    E->>E: reject triggerResolver(error)
```

---

## 3. Side-by-Side Comparison

```mermaid
sequenceDiagram
    participant RS as Resource Flow
    participant CS as Command Flow

    Note over RS,CS: ── IDENTICAL STEPS ──

    rect rgb(220, 240, 255)
        Note over RS: abort previous _abortController
        Note over CS: abort previous _abortController
    end

    rect rgb(220, 240, 255)
        Note over RS: new AbortController()
        Note over CS: new AbortController()
    end

    rect rgb(220, 240, 255)
        Note over RS: _fireCacheEntryAdded()
        Note over CS: _fireCacheEntryAdded()
    end

    rect rgb(220, 240, 255)
        Note over RS: reject stale _queryFulfilled
        Note over CS: reject stale _queryFulfilled
    end

    rect rgb(220, 240, 255)
        Note over RS: fire onQueryStarted(args, tools)
        Note over CS: fire onQueryStarted(args, tools)
    end

    rect rgb(220, 240, 255)
        Note over RS: queryFn(args, {abortSignal})
        Note over CS: queryFn(args, {abortSignal})
    end

    rect rgb(220, 240, 255)
        Note over RS: stale check after async
        Note over CS: stale check after async
    end

    rect rgb(220, 240, 255)
        Note over RS: resolve $cacheDataLoaded
        Note over CS: resolve $cacheDataLoaded
    end

    rect rgb(220, 240, 255)
        Note over RS: resolve $queryFulfilled
        Note over CS: resolve $queryFulfilled
    end

    rect rgb(220, 240, 255)
        Note over RS: complete() → abort + 3× resolver cleanup + super
        Note over CS: complete() → abort + 3× resolver cleanup + super
    end

    Note over RS,CS: ── SIMILAR (same pattern, different details) ──

    rect rgb(255, 248, 220)
        Note over RS: Machine: Pending → Success/Error
        Note over CS: Machine: Idle → Loading → Success/Error
    end

    rect rgb(255, 248, 220)
        Note over RS: onCacheEntryAdded(args, tools)
        Note over CS: onCacheEntryAdded(tools) — no args
    end

    rect rgb(255, 248, 220)
        Note over RS: _inflightPromise for dedup
        Note over CS: _triggerResolver for caller promise
    end

    Note over RS,CS: ── DIFFERENT STEPS ──

    rect rgb(255, 230, 230)
        Note over RS: Auto-fetch in constructor
        Note over CS: Fire-on-demand via initiate()
    end

    rect rgb(255, 230, 230)
        Note over RS: Self-owned Patcher (resolvePatches)
        Note over CS: Delegates patches to linked Resources
    end

    rect rgb(255, 230, 230)
        Note over RS: Refreshing preserves stale data
        Note over CS: No refresh concept — re-trigger = new Loading
    end

    rect rgb(255, 230, 230)
        Note over RS: No linked-resource effects
        Note over CS: Batcher.run wraps commit + update + invalidate on links
    end

    rect rgb(255, 230, 230)
        Note over RS: SWR via ResourceAgent._previous$
        Note over CS: No SWR — CommandAgent is 1:1 with entry
    end

    rect rgb(255, 230, 230)
        Note over RS: Hydration support (SSR snapshot)
        Note over CS: No hydration
    end
```

---

## 4. Summary Table

| Step | Resource | Command | Classification |
|---|---|---|---|
| AbortController management | `_doFetch():195-209` | `initiate():50-65` | **Identical** |
| `_fireCacheEntryAdded()` | `:169-191` | `:253-268` | **Similar** (Resource passes `args`) |
| `onQueryStarted` fire | `_doFetch():218-230` | `initiate():98-113` | **Similar** (Resource has `getCacheEntry`) |
| `queryFn(args, {abortSignal})` | `_doFetch():236` | `initiate():115` | **Identical** |
| Stale check | `controller === _abortController` | `controller.signal.aborted` | **Similar** (same intent) |
| `$cacheDataLoaded` resolve | `_doFetch():272-275` | `initiate():189-192` | **Identical** |
| `$queryFulfilled` resolve | `_doFetch():278-281` | `initiate():195-198` | **Identical** |
| `complete()` cleanup | `:136-167` | `:233-258` | **Similar** (Resource clears `_patchState`, Command clears `_triggerResolver`) |
| Machine transition (success) | `set(MachineSuccess)` | `Batcher.run → set(CommandSuccess)` | **Different** (Command batches with link effects) |
| Optimistic update (own data) | `Patcher.resolvePatches` on self | N/A — patches linked Resources | **Different** |
| Linked resource effects | N/A | `commit + update + invalidate` in Batcher | **Command-only** |
| Refresh / SWR | `MachineRefreshing` + `_previous$` | Not supported | **Resource-only** |
| Constructor auto-fetch | Yes (unless hydrated) | No — `CommandIdle` at rest | **Different** |
