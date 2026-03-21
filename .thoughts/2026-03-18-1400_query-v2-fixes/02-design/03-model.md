---
title: "Domain Model — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Domain Model

## 1. Class/Interface Hierarchy

```mermaid
classDiagram
    class ResourceV2~TArgs, TData, TError~ {
        -_cacheMap: CacheMap
        -_lifecycleHooks: LifecycleHooks
        +key: string
        +createAgent(): ResourceV2Agent
        +query(args): Promise
        +query$(args): Observable
        +entry(args): CacheEntry
        +invalidate(args): void
        +hydrateEntry(args, machine): void
        +cacheEntries(): Iterable
        +resetCache(): void
    }

    class ResourceV2Agent~TArgs, TData, TError~ {
        -_resource: ResourceV2
        -_tracking$: SignalFn ❌devtools
        -_refreshError$: SignalFn ❌devtools
        -_state$: ComputeFn ❌devtools
        +state$: ComputeFn
        +start(args): Promise
    }

    class CacheEntry~TData, TError~ {
        -_signal: SignalFn ✅devtools
        +machine$(): TMachineInstance
        +peek(): TMachineInstance
        +set(machine): void
        +complete(): void
    }

    class CacheMap {
        +get(key): CacheEntry
        +set(key, entry): void
        +delete(key): void
        +entries(): Iterable
    }

    class LifecycleHooks {
        +onCacheEntryAdded()
        +onQueryStarted()
    }

    ResourceV2 *-- CacheMap : contains
    ResourceV2 *-- LifecycleHooks : contains
    ResourceV2 --> CacheEntry : creates/manages
    ResourceV2Agent --> ResourceV2 : references
    ResourceV2Agent --> CacheEntry : tracks current/previous
```

**Devtools markers**: ❌ = `isDisabled: true` (no devtools push), ✅ = `beforeDevtoolsPush` configured.

## 2. Machine State Hierarchy

```mermaid
classDiagram
    class TMachineInstance {
        <<union>>
        MachineIdle | MachinePending | MachineSuccess | MachineError | MachineRefreshing
    }

    class MachineIdle {
        +status: "idle"
        +start(args): MachinePending
    }

    class MachinePending {
        +status: "pending"
        +args: TArgs
        +successHappened(data): MachineSuccess
        +errorHappened(error): MachineError
    }

    class MachineWithData {
        <<abstract>>
        +data: TData
        +originalData: TData
        +patches: Patch[]
        +createPatch(fn): PatchHandle
        +finishPatch(id, mode): void
        +abortAllPendingPatches(): void
    }

    class MachineSuccess {
        +status: "success"
        +invalidate(): MachineRefreshing
    }

    class MachineError {
        +status: "error"
        +error: TError
    }

    class MachineRefreshing {
        +status: "refreshing"
        +successHappened(data): MachineSuccess
        +errorHappened(error): MachineSuccess
    }

    class Patcher {
        +apply(data, patchFn): PatchResult
    }

    MachineWithData <|-- MachineSuccess
    MachineWithData <|-- MachineRefreshing
    MachineWithData --> Patcher : uses

    TMachineInstance <.. MachineIdle
    TMachineInstance <.. MachinePending
    TMachineInstance <.. MachineSuccess
    TMachineInstance <.. MachineError
    TMachineInstance <.. MachineRefreshing
```

[ref: ../01-research/01-codebase-analysis.md#3-core-module-organization] — Machine hierarchy already isolated in `machines/`.

## 3. Standalone Hooks Relationship

```mermaid
classDiagram
    class useResourceV2Agent {
        <<function>>
        +resource: ResourceV2~TArgs, TData, TError~
        +args: TArgs | SKIP_TOKEN
        returns IResourceV2AgentState
    }

    class useResourceV2Ref {
        <<function>>
        +resource: ResourceV2~TArgs, TData, TError~
        +args: TArgs | SKIP_TOKEN
        returns IResourceV2Ref
    }

    class ReactHooksPlugin {
        +name: "ReactHooksPlugin"
        +install(context): void
        +augmentResource(res, opts): Record
    }

    class IResourceV2AgentState~TArgs, TData, TError~ {
        +status: TMachineStatus
        +data: TData | null
        +error: TError | null
        +args: TArgs | null
        +isLoading: boolean
        +isInitialLoading: boolean
        +isRefreshing: boolean
        +isSuccess: boolean
        +isError: boolean
        +refreshError: TError | null
    }

    class IResourceV2Ref~TArgs, TData, TError~ {
        +has: boolean
        +lock(): object
        +invalidate(): void
        +createPatch(fn): PatchHandle | null
        +create(data): void
    }

    useResourceV2Agent --> ResourceV2 : receives as parameter
    useResourceV2Agent --> IResourceV2AgentState : returns
    useResourceV2Ref --> ResourceV2 : receives as parameter
    useResourceV2Ref --> IResourceV2Ref : returns
    ReactHooksPlugin --> useResourceV2Agent : delegates to
    ReactHooksPlugin --> useResourceV2Ref : delegates to
```

Hooks receive `ResourceV2` as an explicit parameter. The plugin captures `resource` in its `augmentResource` closure and passes it through. Both paths produce the same return types.

[ref: ../01-research/01-codebase-analysis.md#1-react-hooks--plugin-dependency] — `augmentResource` already calls internal functions with `resource` argument; refactoring to explicit parameters is straightforward.

## 4. Snapshot Domain Model

```mermaid
classDiagram
    class TApiSnapshot {
        +version: number
        +keyPrefix: string | null
        +resources: Record~string, TResourceSnapshot~
    }

    class TResourceSnapshot {
        +entries: Record~string, TResourceV2SnapshotSlice~
    }

    class TResourceV2SnapshotSlice {
        +status: "success"
        +args: unknown
        +data: unknown
        +updatedAt: number
    }

    TApiSnapshot *-- TResourceSnapshot
    TResourceSnapshot *-- TResourceV2SnapshotSlice
```

**Invariants:**
- Only `MachineSuccess` entries are captured in snapshots [ref: ../01-research/01-codebase-analysis.md#7-optimistic-update-snapshot-content]
- `data` may contain optimistic (patched) data if a snapshot is taken during active patches
- `originalData` and `patches` are **not** included — hydration installs optimistic data as canonical

**Hydration error semantics:**
- `version ≠ CURRENT_SNAPSHOT_VERSION` → throw (fatal)
- `keyPrefix ≠ apiKeyPrefix` → throw (fatal)
- Unknown resource key → warn + skip
- Corrupt machine status → throw from `Machine.fromSnapshot`

[ref: ../01-research/02-open-questions.md#q4] — User decision on error semantics.

## 5. Module Organization After Restructuring

```
query-v2/
├── index.ts                    # Public barrel (unchanged exports + new react/ exports)
├── api/
│   └── createApi.ts            # API factory (unchanged)
├── core/
│   ├── index.ts                # Re-exports from common/, machines/, resource/
│   ├── common/
│   │   ├── index.ts            # CacheEntry, CacheMap, LifecycleHooks
│   │   ├── CacheEntry.ts
│   │   ├── CacheMap.ts
│   │   └── LifecycleHooks.ts
│   ├── machines/               # (unchanged location)
│   │   ├── index.ts
│   │   ├── Machine.ts
│   │   ├── MachineIdle.ts
│   │   ├── MachinePending.ts
│   │   ├── MachineSuccess.ts
│   │   ├── MachineError.ts
│   │   ├── MachineRefreshing.ts
│   │   ├── MachineWithData.ts
│   │   └── Patcher.ts
│   └── resource/
│       ├── index.ts            # ResourceV2, ResourceV2Agent
│       ├── ResourceV2.ts
│       └── ResourceV2Agent.ts
├── lib/
│   ├── SKIP_TOKEN.ts
│   ├── NO_VALUE.ts
│   └── stableStringify.ts
├── plugins/
│   ├── ReactHooksPlugin.ts     # Thin wrapper → delegates to react/
│   └── types.ts
├── react/                      # NEW
│   ├── index.ts                # Barrel: useResourceV2Agent, useResourceV2Ref
│   ├── useResourceV2Agent.ts   # Standalone hook
│   └── useResourceV2Ref.ts     # Standalone hook
├── snapshot/
│   └── Snapshot.ts             # getSnapshot + hydrateSnapshot (with error handling)
└── types/
    ├── agent.types.ts
    ├── api.types.ts
    ├── cache.types.ts
    ├── lifecycle.types.ts
    ├── machine.types.ts
    ├── plugin.types.ts
    ├── resource.types.ts
    ├── shared.types.ts
    └── snapshot.types.ts
```

[ref: ../01-research/01-codebase-analysis.md#3-core-module-organization] — File-to-category mapping confirmed.

## 6. Plugin System Type Wiring (Unchanged)

The plugin type system remains as-is per user decision [ref: ../01-research/02-open-questions.md#q2].

```typescript
// In ReactHooksPlugin.ts — declaration merging stays:
declare module "@/query-v2/types/plugin.types" {
    interface PluginContributionMap<TArgs, TData, TError> {
        ReactHooksPlugin: IReactHooksPluginContributions<TArgs, TData, TError>;
    }
}

// PluginAugmentations type utility extracts contributions from plugin tuple.
// When ReactHooksPlugin is in TPlugins, resource gets .useResourceV2Agent() and .useResourceV2Ref().
// When no plugins: PluginAugmentations<[]> = object (no additional methods).
```

This type machinery is unchanged. The only behavioral change is that `augmentResource` now delegates to imported functions instead of defining them inline.
