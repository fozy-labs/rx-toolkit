---
title: "Data Flow — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Data Flow

## 1. Standalone Hook Lifecycle

`useResourceV2Agent(resource, args)` — direct import from `react/`.

```mermaid
sequenceDiagram
    participant Component as React Component
    participant Hook as useResourceV2Agent
    participant Resource as ResourceV2
    participant Agent as ResourceV2Agent
    participant CacheEntry as CacheEntry
    participant Signal as Signal Layer

    Component->>Hook: useResourceV2Agent(resource, args)
    Hook->>Hook: useConstant(() => resource.createAgent())
    Hook->>Resource: resource.createAgent()
    Resource-->>Agent: new ResourceV2Agent(resource)
    Note over Agent: Creates _tracking$ (isDisabled)<br/>Creates _refreshError$ (isDisabled)<br/>Creates _state$ (isDisabled)

    Hook->>Agent: agent.start(args)
    Agent->>Resource: resource.query(args)
    Agent->>Resource: resource.entry(args)
    Resource-->>CacheEntry: get/create CacheEntry
    Agent->>Agent: _tracking$.set({prev, current: entry})

    Note over CacheEntry: query resolves...
    CacheEntry->>Signal: _signal.set(MachineSuccess)
    Signal->>Signal: beforeDevtoolsPush → Redux DevTools

    Agent->>Agent: _state$ recomputes (reads CacheEntry.machine$)
    Hook->>Signal: useSignal(agent.state$)
    Signal-->>Component: React re-render with new state
```

Key points:
- Agent signals have `isDisabled: true` — no devtools push from agent layer [ref: ../01-research/02-open-questions.md#q5]
- `CacheEntry._signal` pushes to devtools via `beforeDevtoolsPush` [ref: ../01-research/01-codebase-analysis.md#4-devtools-agent-state-logging]
- `useSignal` subscribes to `agent.state$` (computed), which transitively reads `CacheEntry.machine$` (state)

## 2. Plugin Hook Lifecycle (Delegation)

`resource.useResourceV2Agent(args)` — accessed via plugin augmentation.

```mermaid
sequenceDiagram
    participant Component as React Component
    participant PluginHook as resource.useResourceV2Agent
    participant Standalone as useResourceV2Agent (react/)
    participant Resource as ResourceV2
    participant Agent as ResourceV2Agent

    Note over PluginHook: Closure from augmentResource<br/>captures `resource` reference

    Component->>PluginHook: resource.useResourceV2Agent(args)
    PluginHook->>Standalone: useResourceV2Agent(resource, args)
    Note over Standalone: Identical path from here on
    Standalone->>Resource: resource.createAgent()
    Resource-->>Agent: new ResourceV2Agent(resource)
    Standalone->>Agent: agent.start(args)
    Agent-->>Standalone: state$ updates
    Standalone-->>Component: React re-render
```

The plugin closure is a single-line delegation:
```typescript
augmentResource(res) {
    return {
        useResourceV2Agent: (args) => useResourceV2Agent(res, args),
        useResourceV2Ref: (args) => useResourceV2Ref(res, args),
    };
}
```

[ref: ../01-research/01-codebase-analysis.md#1-react-hooks--plugin-dependency] — current `augmentResource` already returns a closure that calls the hook functions; the only change is the functions now live in `react/`.

## 3. Snapshot Hydration with Error Handling

```mermaid
sequenceDiagram
    participant Caller as createApi / consumer
    participant Hydrate as hydrateSnapshot
    participant Resource as ResourceV2
    participant Machine as Machine.fromSnapshot

    Caller->>Hydrate: hydrateSnapshot(snapshot, registry, prefix, maxAge)

    alt Version mismatch
        Hydrate->>Hydrate: snapshot.version ≠ CURRENT_VERSION
        Hydrate--xCaller: throw SnapshotVersionMismatchError
    end

    alt Key prefix mismatch
        Hydrate->>Hydrate: snapshot.keyPrefix ≠ apiKeyPrefix
        Hydrate--xCaller: throw SnapshotPrefixMismatchError
    end

    loop Each resource in snapshot.resources
        alt Unknown resource key
            Hydrate->>Hydrate: registry.get(key) → undefined
            Hydrate->>Hydrate: console.warn("Unknown resource key: ...")
            Note over Hydrate: continue (skip this resource)
        end

        loop Each entry in resource.entries
            Hydrate->>Machine: Machine.fromSnapshot(slice)

            alt Corrupt status
                Machine--xHydrate: throw Error("Unknown machine status")
                Note over Hydrate: Error propagates to caller
            end

            Machine-->>Hydrate: TMachineInstance (success)
            Hydrate->>Resource: resource.hydrateEntry(args, machine)

            alt Entry already exists
                Resource-->>Hydrate: no-op (silent skip)
            end

            alt Stale entry (now - updatedAt > maxAge)
                Hydrate->>Resource: resource.invalidate(args)
            end
        end
    end

    Hydrate-->>Caller: void (success)
```

Error semantics per user decision [ref: ../01-research/02-open-questions.md#q4]:
- **Version mismatch** → `throw` (fatal — snapshot format incompatibility)
- **Key prefix mismatch** → `throw` (fatal — wrong API instance)
- **Unknown resource key** → `console.warn` + skip (non-fatal — resource may have been removed)
- **Corrupt machine status** → `throw` from `Machine.fromSnapshot` (propagates — data corruption)

## 4. DevTools Flow: Current vs. Fixed

### Current State (Agent Leaks)

```mermaid
graph LR
    subgraph "ResourceV2Agent"
        T["_tracking$<br/>Signal.state"]
        R["_refreshError$<br/>Signal.state"]
        S["_state$<br/>Signal.compute"]
    end

    subgraph "CacheEntry"
        C["_signal<br/>Signal.state"]
    end

    DT["Redux DevTools"]

    T -->|"State/#i=N"| DT
    R -->|"State/#i=N"| DT
    S -->|"Computed/#i=N"| DT
    C -->|"keyPrefix/key/args"| DT
```

All signals register with devtools because none pass `isDisabled: true`. The agent signals create noise entries with auto-generated keys (`State/#i=N`, `Computed/#i=N`).

[ref: ../01-research/02-open-questions.md#q5] — User confirmed agent signals leak to devtools.

### Fixed State (Agent Isolated)

```mermaid
graph LR
    subgraph "ResourceV2Agent (isDisabled)"
        T["_tracking$<br/>🚫 devtools"]
        R["_refreshError$<br/>🚫 devtools"]
        S["_state$<br/>🚫 devtools"]
    end

    subgraph "CacheEntry"
        C["_signal<br/>Signal.state"]
    end

    DT["Redux DevTools"]

    C -->|"keyPrefix/key/args"| DT
```

Only `CacheEntry` signals push to devtools. Agent signals are internal derived state that exists solely for React hook consumption. Devtools shows the canonical cache machine state, not computed agent projections.

## 5. Args Change Flow in useResourceV2Agent

```mermaid
stateDiagram-v2
    [*] --> Initial: mount(args₁)
    Initial --> AgentCreated: useConstant → createAgent()
    AgentCreated --> Querying: agent.start(args₁)
    Querying --> Subscribed: useSignal(state$)

    Subscribed --> ArgsChanged: re-render(args₂)
    ArgsChanged --> CompareArgs: compareArgs(args₂, prevRef)

    CompareArgs --> Subscribed: same → no-op
    CompareArgs --> NewQuery: different
    NewQuery --> Querying: agent.start(args₂)

    Subscribed --> Skipped: re-render(SKIP)
    Skipped --> Subscribed: re-render(args₃)
```

The agent is created once per component mount. Subsequent renders trigger arg comparison — if args differ, `agent.start(newArgs)` is called, which internally swaps the tracked `CacheEntry` and triggers a reactive chain through `_state$` → `useSignal` → re-render.

[ref: ../01-research/01-codebase-analysis.md#1-react-hooks--plugin-dependency] — `compareArgs` uses `React.useRef` for arg stability.
