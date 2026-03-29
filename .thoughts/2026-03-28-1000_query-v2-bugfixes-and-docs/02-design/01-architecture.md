---
title: "System Architecture: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

# System Architecture

## 1. C4 Container Diagram — query-v2 Module Context

The query-v2 module sits within the `rx-toolkit` monorepo alongside `signals`, `common`, and `query` (v1). It depends on `signals` for reactive state and `common` for shared React utilities.

```mermaid
---
title: "C4 Level 1 — query-v2 System Context"
---
graph TB
    User["React Application"]
    QueryV2["query-v2 Module"]
    Signals["signals Module"]
    Common["common Module"]
    RxJS["RxJS"]
    Immer["Immer"]
    DemoApp["Demo App (apps/demos)"]
    Docs["Documentation (docs/query-v2)"]

    User -->|"useResourceV2Agent, createApi"| QueryV2
    QueryV2 -->|"Signal.state, Signal.computed"| Signals
    QueryV2 -->|"useConstant, useSignal"| Common
    QueryV2 -->|"Observable, ReplaySubject, share"| RxJS
    QueryV2 -->|"produceWithPatches, applyPatches"| Immer
    DemoApp -->|"imports"| QueryV2
    Docs -.->|"documents"| QueryV2
```

## 2. C4 Component Diagram — query-v2 Internal Architecture

Shows all internal modules of query-v2 with the components affected by bug fixes highlighted.

```mermaid
---
title: "C4 Level 2 — query-v2 Component Diagram (affected components marked with 🔧)"
---
graph TB
    subgraph api["api/"]
        createApi["createApi"]
        _createResourceV2["_createResourceV2"]
    end

    subgraph core["core/"]
        subgraph resource["resource/"]
            ResourceV2["ResourceV2"]
            ResourceV2Agent["🔧 ResourceV2Agent"]
            ResourceV2CacheEntry["🔧 ResourceV2CacheEntry"]
        end
        subgraph machines["machines/"]
            Machine["Machine"]
            MachinePending["MachinePending"]
            MachineSuccess["🔧 MachineSuccess"]
            MachineError["MachineError"]
            MachineRefreshing["🔧 MachineRefreshing"]
            MachineWithData["MachineWithData"]
            Patcher["🔧 Patcher"]
        end
        LifecycleHooks["🔧 LifecycleHooks"]
        CacheEntry["CacheEntry"]
        Snapshot["Snapshot"]
        CacheMap["CacheMap/"]
    end

    subgraph lib["lib/"]
        stableStringify["stableStringify"]
    end

    subgraph react["react/"]
        useResourceV2Agent["useResourceV2Agent"]
    end

    subgraph plugins["plugins/"]
        ReactHooksPlugin["ReactHooksPlugin"]
    end

    subgraph types["types/"]
        TResourceV2Options["TResourceV2Options"]
    end

    createApi --> ResourceV2
    createApi --> Snapshot
    ResourceV2 --> ResourceV2CacheEntry
    ResourceV2 --> ResourceV2Agent
    ResourceV2 --> LifecycleHooks
    ResourceV2 --> CacheMap
    ResourceV2CacheEntry --> CacheEntry
    ResourceV2CacheEntry --> Patcher
    ResourceV2CacheEntry --> MachineSuccess
    ResourceV2CacheEntry --> MachineError
    ResourceV2CacheEntry --> MachineRefreshing
    ResourceV2CacheEntry --> MachinePending
    MachineSuccess --> MachineWithData
    MachineRefreshing --> MachineWithData
    MachineRefreshing -.->|"errorHappened()"| MachineSuccess
    MachineWithData --> Patcher
    ReactHooksPlugin --> useResourceV2Agent
    useResourceV2Agent --> ResourceV2Agent
```

## 3. Module Responsibility Zones

| Module | Responsibility | Files Affected by This Task |
|--------|---------------|----------------------------|
| `api/` | Public factories (`createApi`, `_createResourceV2`), snapshot hydration orchestration | None directly (hydration flows through `ResourceV2.hydrateEntry`) |
| `core/resource/` | Core query lifecycle: entry management, SWR agent, cache orchestration | `ResourceV2CacheEntry.ts` (Bugs #1, #2), `ResourceV2Agent.ts` (Bug #3) |
| `core/machines/` | Immutable state machines, Immer-based patching | `MachineSuccess.ts` (Enhancement: `lastError`), `MachineRefreshing.ts` (feeds `lastError`), `Patcher.ts` (Bug #4) |
| `core/` (root) | Lifecycle hooks, cache entry base, snapshot logic | `LifecycleHooks.ts` (Bug #5) |
| `lib/` | Utilities (stableStringify, SKIP_TOKEN) | None |
| `react/` | React hooks (`useResourceV2Agent`) | None (consumes agent state — benefits from Bug #3 fix transparently) |
| `plugins/` | Plugin system (`ReactHooksPlugin`) | None |
| `types/` | TypeScript type definitions | `TResourceV2Options` may need `initialMachine` addition for Bug #1 |

## 4. Component Boundaries per Fix Area

### Fix Area 1: Snapshot Fetch Bypass (Bug #1) + onQueryStarted Wiring (Bug #2)

Both bugs share `ResourceV2CacheEntry` as the primary modification target. They are designed together because Bug #1 modifies the constructor path and Bug #2 modifies `_doFetch` — complementary, non-overlapping changes within the same class.

[ref: ../01-research/05-open-questions.md#Q6]

**Files modified:**

| File | Change | Bug |
|------|--------|-----|
| `@/query-v2/core/resource/ResourceV2CacheEntry.ts` | Add `initialMachine?` constructor option; skip `_doFetch` when provided | #1 |
| `@/query-v2/core/resource/ResourceV2CacheEntry.ts` | Wire `fireQueryStarted`/`resolveQueryFulfilled` into `_doFetch` | #2 |
| `@/query-v2/core/resource/ResourceV2.ts` | Update `_entryFactory` to accept and pass `initialMachine`; update `hydrateEntry` to pass snapshot machine | #1 |
| `@/query-v2/core/LifecycleHooks.ts` | No structural change — `fireQueryStarted`/`resolveQueryFulfilled` already implemented | #2 |

**Component interaction:**

```mermaid
---
title: "Fix Area 1 — Component Boundaries"
---
graph LR
    Snapshot["Snapshot.hydrateSnapshot"]
    ResourceV2["ResourceV2.hydrateEntry"]
    EntryFactory["ResourceV2._entryFactory"]
    CacheEntry["ResourceV2CacheEntry"]
    DoFetch["ResourceV2CacheEntry._doFetch"]
    LCHooks["LifecycleHooks"]

    Snapshot -->|"hydrateEntry(args, machine)"| ResourceV2
    ResourceV2 -->|"_entryFactory(args, initialMachine)"| EntryFactory
    EntryFactory -->|"new ResourceV2CacheEntry(..., initialMachine)"| CacheEntry
    CacheEntry -->|"if no initialMachine"| DoFetch
    DoFetch -->|"fireQueryStarted(args, entry)"| LCHooks
    DoFetch -->|"resolveQueryFulfilled(args, result)"| LCHooks
```

### Fix Area 2: SWR Error Masking (Bug #3)

Isolated in `ResourceV2Agent._deriveState$`. No other components are modified.

[ref: ../01-research/03-problem-analysis-part1.md#Bug #3]

**Files modified:**

| File | Change |
|------|--------|
| `@/query-v2/core/resource/ResourceV2Agent.ts` | Derive `isError` from `currentMachine.status` before SWR override; use `currentMachine.status` for `previous$` clearing condition |

### Fix Area 3: Patcher Consistency Violation (Bug #4)

Isolated in `Patcher.resolvePatches` catch block. No caller changes needed — existing `_finishPatch` detection via `patchState?.isConsistencyViolation` will work unmodified.

[ref: ../01-research/04-problem-analysis-part2.md#Bug #4]

**Files modified:**

| File | Change |
|------|--------|
| `@/query-v2/core/machines/Patcher.ts` | Catch block returns `{ data: currentData, patchState: { patches: [], isConsistencyViolation: true } }` instead of `{ data: currentData, patchState: null }` |

### Fix Area 4: $cacheDataLoaded Hang (Bug #5)

Isolated in `LifecycleHooks.fireCacheEntryRemoved`. Covers both `resetCache` and GC-triggered removal paths.

[ref: ../01-research/04-problem-analysis-part2.md#Bug #5]
[ref: ../01-research/05-open-questions.md#Q12]

**Files modified:**

| File | Change |
|------|--------|
| `@/query-v2/core/LifecycleHooks.ts` | In `fireCacheEntryRemoved`, before deleting resolver entry: check if `dataLoaded` is pending, reject with `Error("Promise never resolved before cacheEntryRemoved.")` |

### Fix Area 5: MachineSuccess lastError (Enhancement)

Extends the machine type system. `MachineRefreshing.errorHappened()` passes the error to `MachineSuccess` instead of discarding it.

[ref: ../01-research/05-open-questions.md#Q10]

**Files modified:**

| File | Change |
|------|--------|
| `@/query-v2/core/machines/MachineSuccess.ts` | Add optional `lastError?: unknown` field (defaults to `undefined`) |
| `@/query-v2/core/machines/MachineRefreshing.ts` | `errorHappened(error)` passes `error` to new `MachineSuccess({ ..., lastError: error })` |
| `@/query-v2/types/` | Update relevant type definitions if `TMachineInstance` union is explicitly typed |

### Fix Area 6: Docs & Examples

[ref: ../01-research/05-open-questions.md#Q7]
[ref: ../01-research/05-open-questions.md#Q9]

**Files modified:**

| File | Change |
|------|--------|
| `@/docs/query-v2/README.md` | Fix MachineIdle → MachinePending reference; update onQueryStarted docs after Bug #2 fix |
| `@/docs/query-v2/optimistic-updates.md` | Update onQueryStarted examples to reflect wired-in behavior |
| `@/docs/query-v2/devtools.md` | Add note about outdated options references |
| `@/apps/demos/src/examples/query-v2/` | Add 4–5 new examples: basic-query, error-swr-states, skip-token, snapshot-hydration |

## 5. Sequence Diagram — Fetch Lifecycle with onQueryStarted (Bug #2 Fix)

Shows the complete `_doFetch` lifecycle after wiring in `fireQueryStarted` and `resolveQueryFulfilled`.

```mermaid
---
title: "Fetch Lifecycle with onQueryStarted (after Bug #2 fix)"
---
sequenceDiagram
    participant Entry as ResourceV2CacheEntry
    participant QFn as queryFn
    participant LH as LifecycleHooks
    participant User as User Callback (onQueryStarted)
    participant PR as PromiseResolver ($queryFulfilled)

    Entry->>Entry: abort previous inflight
    Entry->>Entry: create AbortController
    Entry->>LH: fireQueryStarted(args, entry)
    LH->>LH: create $queryFulfilled resolver
    LH->>User: onQueryStarted(args, { $queryFulfilled, entry })
    Note over User: User may set up optimistic patches here

    Entry->>QFn: queryFn(args, { abortSignal })

    alt Success
        QFn-->>Entry: data
        Entry->>Entry: set(MachineSuccess(data))
        Entry->>Entry: _onDataLoaded(args)
        Entry->>LH: resolveQueryFulfilled(args, { data, meta: "fulfilled" })
        LH->>PR: resolve({ data })
        PR-->>User: $queryFulfilled resolves
    else Error (non-refreshing)
        QFn-->>Entry: error
        Entry->>Entry: set(MachineError(error))
        Entry->>LH: resolveQueryFulfilled(args, { error, meta: "rejected" })
        LH->>PR: reject(error)
        PR-->>User: $queryFulfilled rejects
    else Error (refreshing → MachineSuccess with lastError)
        QFn-->>Entry: error
        Entry->>Entry: set(MachineSuccess({ data: staleData, lastError: error }))
        Entry->>LH: resolveQueryFulfilled(args, { error, meta: "rejected" })
        LH->>PR: reject(error)
        PR-->>User: $queryFulfilled rejects
    else Aborted (stale — superseded by newer _doFetch)
        QFn-->>Entry: AbortError
        Entry->>Entry: stale check fails (controller mismatch) → return
        Note over Entry: No state change, no resolveQueryFulfilled.<br/>The newer _doFetch owns the lifecycle<br/>and will settle its own $queryFulfilled.
    end
```

## 6. Sequence Diagram — Snapshot Hydration (Bug #1 Fix)

Shows how `initialMachine` prevents the spurious fetch during snapshot hydration.

```mermaid
---
title: "Snapshot Hydration with initialMachine (after Bug #1 fix)"
---
sequenceDiagram
    participant API as createApi
    participant Snap as hydrateSnapshot
    participant Res as ResourceV2
    participant Factory as _entryFactory
    participant CE as ResourceV2CacheEntry

    API->>Snap: hydrateSnapshot(resources, snapshot)
    loop each entry in snapshot
        Snap->>Res: hydrateEntry(args, machine)
        Res->>Factory: _entryFactory(args, { initialMachine: machine })
        Factory->>CE: new ResourceV2CacheEntry(..., { initialMachine })
        Note over CE: initialMachine provided →<br/>super(initialMachine, options)<br/>skip _doFetch()
        CE-->>Factory: entry (state = MachineSuccess)
        Factory-->>Res: entry
    end
    API->>API: maxSnapshotDataAge check
    Note over API: Stale entries → entry.invalidate()<br/>which triggers _doFetch() normally
```

## 7. Sequence Diagram — SWR State Derivation (Bug #3 Fix)

Shows the corrected `_deriveState$` flow where `isError` reflects the true error state and `previous$` is properly cleared.

```mermaid
---
title: "SWR State Derivation — Error-Transparent (after Bug #3 fix)"
---
sequenceDiagram
    participant Agent as ResourceV2Agent
    participant Curr as Current Entry (MachineError)
    participant Prev as Previous Entry (MachineSuccess)
    participant State as Derived State

    Agent->>Curr: read currentMachine
    Note over Agent: currentMachine.status = "error"

    Agent->>Agent: save originalStatus = currentMachine.status

    alt previous$ exists with success/refreshing data
        Agent->>Prev: read prevMachine
        Agent->>Agent: data = prevMachine.data (SWR)
        Agent->>Agent: status = "refreshing" (override for display)
    end

    Agent->>State: Derive flags using originalStatus:
    Note over State: isError = originalStatus === "error" → TRUE ✓<br/>error = currentMachine.error → non-null ✓<br/>data = prevMachine.data → stale data ✓<br/>status = "refreshing" (display hint)

    Agent->>Agent: Clear previous$ check using originalStatus:
    Note over Agent: originalStatus === "error" → true<br/>previous$ is cleared ✓
```

## 8. Sequence Diagram — Cache Reset with Promise Rejection (Bug #5 Fix)

Shows the corrected flow where `$cacheDataLoaded` is rejected in `fireCacheEntryRemoved` before deleting the resolver.

```mermaid
---
title: "Cache Reset — $cacheDataLoaded Rejection (after Bug #5 fix)"
---
sequenceDiagram
    participant Res as ResourceV2.resetCache
    participant Entry as ResourceV2CacheEntry
    participant LH as LifecycleHooks
    participant Map as _entryResolvers Map
    participant DL as $cacheDataLoaded Promise

    Res->>Res: collect entries, cache.clear()

    loop each entry
        Res->>Entry: entry.complete()
        Entry->>Entry: abort inflight, fire onClean$
        Entry->>LH: fireCacheEntryRemoved(args)

        alt dataLoaded is still pending
            LH->>DL: reject(Error("Promise never resolved before cacheEntryRemoved."))
            Note over DL: Promise settled → no hang
        end

        LH->>Map: resolve $cacheEntryRemoved
        LH->>Map: delete(args)
    end

    Res->>LH: clearAll()
    Note over LH: _entryResolvers is empty<br/>clearAll is a no-op (safe)
```

## 9. State Diagram — Machine States with lastError Extension

Shows the complete machine state model including the new `lastError` field on `MachineSuccess`.

```mermaid
---
title: "Machine States — with lastError Extension"
---
stateDiagram-v2
    [*] --> MachinePending: new entry created

    MachinePending --> MachineSuccess: queryFn resolves
    MachinePending --> MachineError: queryFn rejects

    MachineSuccess --> MachineRefreshing: invalidate() / refetch
    MachineSuccess --> [*]: entry.complete()

    MachineRefreshing --> MachineSuccess: queryFn resolves\n(lastError = undefined)
    MachineRefreshing --> MachineSuccess_WithLastError: queryFn rejects\n(lastError = error) ✨ NEW
    MachineRefreshing --> [*]: entry.complete() / abort

    MachineSuccess_WithLastError --> MachineRefreshing: invalidate() / refetch
    MachineSuccess_WithLastError --> [*]: entry.complete()

    MachineError --> MachinePending: retry / refetch
    MachineError --> [*]: entry.complete()

    state MachineSuccess {
        data: TData
        error: null
        updatedAt: number
        lastError?: unknown
        ---
        status = "success"
    }

    state MachineSuccess_WithLastError {
        data: TData (stale)
        error: null
        updatedAt: number (original)
        lastError: unknown ✨
        ---
        status = "success"
    }

    state MachineRefreshing {
        data: TData
        error: null
        updatedAt: number
        ---
        status = "refreshing"
    }
```

**Key design notes for `lastError`:**

- `MachineSuccess.lastError` is `unknown | undefined`. `undefined` means no refetch error occurred; non-undefined means the last same-args refetch failed but stale data is preserved. [ref: ../01-research/05-open-questions.md#Q10]
- `MachineSuccess.error` remains `null` (the formal `error` field). `lastError` is a supplementary field, not a replacement. This preserves the invariant that `MachineSuccess` always has `error === null`.
- `MachineRefreshing.errorHappened(error)` currently returns `new MachineSuccess({ data: this.data, updatedAt: this.updatedAt })`. After the fix, it returns `new MachineSuccess({ data: this.data, updatedAt: this.updatedAt, lastError: error })`. [ref: ../01-research/01-codebase-analysis.md#6. Machine States]
- A successful refetch clears `lastError` by constructing `MachineSuccess` without it (defaults to `undefined`).
- At the agent level, `_deriveState$` can expose `lastError` from the current machine to the derived state, enabling consumers to show "data is stale due to refetch error" banners.

## 10. State Diagram — Agent-Level SWR with Error Transparency

Shows how the agent-level state derivation handles cross-args SWR after Bug #3 fix.

```mermaid
---
title: "Agent-Level SWR State Derivation"
---
stateDiagram-v2
    [*] --> NoPrevious: agent.start(args1)

    NoPrevious --> WithPrevious: agent.start(args2)\nprevious$ = args1 entry

    state NoPrevious {
        state "Pass-Through" as PT
        note right of PT: status, data, error from current entry
    }

    state WithPrevious {
        state "Current Pending" as CP
        note right of CP: data = previous$.data\nstatus = "refreshing"\nisError = false

        state "Current Success" as CS
        note right of CS: data = current.data\nstatus = "success"\nprevious$ cleared

        state "Current Error" as CE
        note right of CE: data = previous$.data (SWR)\nstatus = "refreshing" (display)\nisError = TRUE ✨ (from originalStatus)\nerror = current.error\nprevious$ cleared ✨ (via originalStatus)
    }
```

## 11. Module Dependency Diagram

Shows the dependency graph focused on the modified components.

```mermaid
---
title: "Module Dependencies — Modified Components"
---
graph TB
    subgraph "Public API"
        createApi
    end

    subgraph "core/resource/"
        ResourceV2
        ResourceV2Agent["🔧 ResourceV2Agent\n(Bug #3: SWR fix)"]
        ResourceV2CacheEntry["🔧 ResourceV2CacheEntry\n(Bug #1: initialMachine)\n(Bug #2: wire onQueryStarted)"]
    end

    subgraph "core/machines/"
        MachineSuccess["🔧 MachineSuccess\n(lastError field)"]
        MachineRefreshing["🔧 MachineRefreshing\n(pass error to lastError)"]
        Patcher["🔧 Patcher\n(Bug #4: fix catch return)"]
        MachinePending
        MachineError
    end

    subgraph "core/"
        LifecycleHooks["🔧 LifecycleHooks\n(Bug #5: reject $cacheDataLoaded)"]
        Snapshot
        CacheEntry
    end

    subgraph "react/"
        useResourceV2Agent["useResourceV2Agent\n(no changes — benefits from fixes)"]
    end

    createApi --> ResourceV2
    createApi --> Snapshot
    Snapshot --> ResourceV2
    ResourceV2 --> ResourceV2CacheEntry
    ResourceV2 --> ResourceV2Agent
    ResourceV2 --> LifecycleHooks
    ResourceV2CacheEntry --> CacheEntry
    ResourceV2CacheEntry --> Patcher
    ResourceV2CacheEntry --> LifecycleHooks
    ResourceV2CacheEntry --> MachineSuccess
    ResourceV2CacheEntry --> MachineRefreshing
    ResourceV2CacheEntry --> MachinePending
    ResourceV2CacheEntry --> MachineError
    MachineRefreshing --> MachineSuccess
    useResourceV2Agent --> ResourceV2Agent
```

## 12. Interface Design — Key Modified Interfaces

### ResourceV2CacheEntry Constructor Extension (Bug #1)

```typescript
// Before:
constructor(args: TArgs, options: TResourceV2CacheEntryOptions<TData, TArgs>)
// After:
constructor(args: TArgs, options: TResourceV2CacheEntryOptions<TData, TArgs> & {
  initialMachine?: TMachineInstance<TData, TArgs>;
})
```

When `initialMachine` is provided:
- `super(initialMachine, options)` instead of `super(new MachinePending(args), options)`
- Skip `this._doFetch().catch(() => {})`

[ref: ../01-research/03-problem-analysis-part1.md#Bug #1]

### _doFetch Lifecycle Extension (Bug #2)

```typescript
// Conceptual — calls added to _doFetch:
async _doFetch(): Promise<void> {
  // ... abort handling ...
  this._lifecycleHooks.fireQueryStarted(this._args, this);  // NEW
  try {
    const data = await this._queryFn(args, { abortSignal });
    // ... success handling ...
    this._lifecycleHooks.resolveQueryFulfilled(this._args, { data, meta: "fulfilled" }); // NEW
  } catch (error) {
    // ... error handling ...
    this._lifecycleHooks.resolveQueryFulfilled(this._args, { error, meta: "rejected" }); // NEW
  }
}
```

Note: `_doFetch` needs access to `_lifecycleHooks`. Currently `ResourceV2CacheEntry` does not hold a reference to `LifecycleHooks` — it is held by `ResourceV2`. The design must either:
- (a) Pass `lifecycleHooks` (or callback wrappers) into `ResourceV2CacheEntry` constructor options, or
- (b) Have `ResourceV2` wrap `_doFetch` externally.

Option (a) is preferred — pass `fireQueryStarted` and `resolveQueryFulfilled` as callback options, mirroring the existing `onDataLoaded` pattern already used in `ResourceV2CacheEntry`.

[ref: ../01-research/01-codebase-analysis.md#5. ResourceV2CacheEntry]

### MachineSuccess.lastError (Enhancement)

```typescript
// MachineSuccess — extended
class MachineSuccess<TData, TArgs> extends MachineWithData<TData, TArgs> {
  readonly status = "success" as const;
  readonly error = null;
  readonly lastError?: unknown;  // NEW — undefined = no refetch error
  readonly updatedAt: number;
}
```

[ref: ../01-research/05-open-questions.md#Q10]

### Patcher.resolvePatches Catch Return (Bug #4)

```typescript
// Before (catch block):
return { data: currentData, patchState: null };

// After (catch block):
return {
  data: currentData,
  patchState: { patches: [], isConsistencyViolation: true }
};
```

[ref: ../01-research/04-problem-analysis-part2.md#Bug #4]

### LifecycleHooks.fireCacheEntryRemoved Extension (Bug #5)

```typescript
// Before:
fireCacheEntryRemoved(args: TArgs): void {
  const resolvers = this._entryResolvers.get(args);
  if (resolvers) {
    resolvers.entryRemoved.resolve();
    this._entryResolvers.delete(args);
  }
}

// After:
fireCacheEntryRemoved(args: TArgs): void {
  const resolvers = this._entryResolvers.get(args);
  if (resolvers) {
    if (!resolvers.dataLoaded.isSettled) {  // NEW
      resolvers.dataLoaded.reject(
        new Error("Promise never resolved before cacheEntryRemoved.")
      );
    }
    resolvers.entryRemoved.resolve();
    this._entryResolvers.delete(args);
  }
}
```

Note: `PromiseResolver` must expose an `isSettled` property (or the check can use a try/catch pattern). Verify `@/common/utils/PromiseResolver.ts` — if it doesn't have settlement tracking, a minimal addition is needed.

[ref: ../01-research/02-external-research.md#5. Cache Reset and Pending Promises]
[ref: ../01-research/04-problem-analysis-part2.md#Bug #5]

## 13. Integration Points Summary

| Fix | Primary Component | Integration Points | Downstream Effect |
|-----|-------------------|-------------------|-------------------|
| Bug #1 | `ResourceV2CacheEntry` constructor | `ResourceV2._entryFactory`, `ResourceV2.hydrateEntry` | Hydrated entries skip fetch; age-based invalidation still triggers fetch normally |
| Bug #2 | `ResourceV2CacheEntry._doFetch` | `LifecycleHooks.fireQueryStarted`, `LifecycleHooks.resolveQueryFulfilled` | `onQueryStarted` callbacks receive `$queryFulfilled`; optimistic update docs become functional |
| Bug #3 | `ResourceV2Agent._deriveState$` | None (isolated) | `useResourceV2Agent` consumers see correct `isError: true` with stale data |
| Bug #4 | `Patcher.resolvePatches` | `ResourceV2CacheEntry._finishPatch` (no change needed) | Commit-path violations detected → `invalidate()` triggers refetch |
| Bug #5 | `LifecycleHooks.fireCacheEntryRemoved` | Possibly `PromiseResolver` (add `isSettled`) | `$cacheDataLoaded` rejects on both `resetCache` and GC removal |
| Enhancement | `MachineSuccess`, `MachineRefreshing` | `ResourceV2Agent._deriveState$` (expose `lastError`) | Consumers see refetch errors on same-args SWR |

## 14. Open Research Questions Addressed

All 12 open questions from research are addressed in this design:

| Question | Resolution | Design Impact |
|----------|-----------|---------------|
| Q1 | Wire in `_doFetch` | §5, §12 — `_doFetch` sequence + interface |
| Q2 | Error-transparent SWR | §7, §10 — `_deriveState$` fix |
| Q3 | `initialMachine` lazy fetch | §6, §12 — constructor extension |
| Q4 | Fix catch return | §12 — Patcher catch block |
| Q5 | Reject in `fireCacheEntryRemoved` | §8, §12 — LifecycleHooks extension |
| Q6 | Fix independently, #1+#2 together | §4 — Fix Area 1 groups both |
| Q7 | Incremental + targeted additions | §4 Fix Area 6 |
| Q8 | Defer (brief README note) | Out of scope per `00-short-design.md` |
| Q9 | Minimal 4–5 examples | §4 Fix Area 6 |
| Q10 | Add `lastError` to `MachineSuccess` | §9, §12 — machine extension |
| Q11 | Mandatory regression tests | §4 — each fix area has test scope |
| Q12 | Auto-covered by Q5 fix | §8 — GC path uses same `fireCacheEntryRemoved` |

[ref: ../01-research/05-open-questions.md]
