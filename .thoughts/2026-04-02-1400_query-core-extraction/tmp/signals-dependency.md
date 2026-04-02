---
title: "Query ↔ Signals Dependency — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module has a tight, structural dependency on the signals module. Every core class (`CacheEntry`, `Resource`, `ResourceAgent`, `Command`, `CommandAgent`, `CommandCacheEntry`) uses signal primitives or the `Batcher` utility. The subscription mechanism is RxJS-first, with signals as a reactive read/tracking layer on top.

## Findings

### 1. Signal primitives used by Resource

- **`Signal.state`** — writable reactive state
  - `@/query/core/resource/Resource.ts:32` — `_lastEntry$` tracks last active `ResourceCacheEntry`
  - `@/query/core/resource/Resource.ts:36` — `status$` tracks resource lifecycle (`"idle" | "ready"`)
  - Both created with `{ isDisabled: true }` (devtools suppressed)
- **`Batcher` (from `@/signals/base/Batcher`)** — transaction batching
  - `@/query/core/resource/Resource.ts:15` — import
  - `@/query/core/resource/Resource.ts:118` — `Batcher.run()` wraps `resetCache()` for atomic cache clearing

### 2. Signal primitives used by ResourceAgent

- **`Signal.state`** — `@/query/core/resource/ResourceAgent.ts:22` — `_tracking$` holds current tracking info
- **`Signal.compute`** — derived reactive value
  - `@/query/core/resource/ResourceAgent.ts:36` — `state$` derives `TResourceAgentState` from tracking + machine
  - `@/query/core/resource/ResourceAgent.ts:72` — `current$` computes current entry from `_getEntry$`
- **`ReadableSignalFnLike` type** — `@/query/core/resource/ResourceAgent.ts:3` — typed field for `_previous$`

### 3. Signal primitives used by CacheEntry (base for all entries)

- **`Signal.state`** — `@/query/core/CacheEntry.ts:28` — creates `_state$` holding the TState
- **`signalize`** — `@/query/core/CacheEntry.ts:46` — wraps RxJS observable back into a `ReadableSignalFnLike`
- **Types imported**: `SignalFn`, `SignalOptions` from `@/signals/types` — `@/query/core/CacheEntry.ts:5`

### 4. Signal primitives used by Command

- **`Batcher`** — `@/query/core/command/Command.ts:2` — import; `@/query/core/command/Command.ts:27` — wraps `resetCache()`

### 5. Signal primitives used by CommandAgent

- **`Signal.state`** — `@/query/core/command/CommandAgent.ts:69` — `_entry$` holds current `CommandCacheEntry`
- **`Signal.compute`** — `@/query/core/command/CommandAgent.ts:73` — `state$` derives `TCommandAgentState`
- **`ComputeFn` type** — `@/query/core/command/CommandAgent.ts:3`

### 6. Signal primitives used by CommandCacheEntry

- **`Batcher`** — `@/query/core/command/CommandCacheEntry.ts:12` — import; used in lifecycle transitions
- Inherits from `CacheEntry` (which uses `Signal.state` + `signalize`)

### 7. Signal primitives used by ResourceCacheEntry

- **Inherits `CacheEntry`** — gets `Signal.state` + `signalize` transitively
- **`ReadableSignalFnLike` type** — `@/query/core/resource/ResourceCacheEntry.ts:18` — `machine$` field typed as signal-like
- `@/query/core/resource/ResourceCacheEntry.ts:67` — `this.machine$ = this.state$` (assigns signalized observable)

### 8. Type-level coupling in query/types

- `@/query/types/agent.types.ts:1` — `ComputeFn` from `@/signals/types`
- `@/query/types/command.types.ts:1` — `ComputeFn` from `@/signals/types`
- `@/query/types/resource.types.ts:2` — `ReadableSignalFnLike`, `TBeforeDevtoolsPushFn` from `@/signals/types`

### 9. React layer coupling

- `@/query/react/useResourceAgent.ts:5` — imports `useSignal` from `@/signals`
- `@/query/react/useCommandAgent.ts:2` — imports `useSignal` from `@/signals`

## Subscription Mechanism

**RxJS is the primary subscription backbone.** Signals are a reactive-read layer built on top:

- `State` internally uses `BehaviorSubject` — `@/signals/signals/State.ts:10-11`
- `Computed` internally wraps `State` + `Effect` + RxJS `share()` — `@/signals/signals/Computed.ts:37-55`
- `signalize()` converts RxJS `Observable` → `ReadableSignalFnLike` via `ReadonlySignal` — `@/signals/operators/signalize.ts:7-10`
- `ReadonlySignal` wraps `SyncObservable` (custom RxJS subclass) — `@/signals/base/ReadonlySignal.ts:12`
- `useSignal` subscribes via `signal$.obs` (RxJS observable) + `useSyncExternalStore` — `@/signals/react/useSignal.ts:18-28`
- `CacheEntry.obs` is an RxJS shared observable with `ReplaySubject` — `@/query/core/CacheEntry.ts:34-44`
- Cache lifetime is controlled by RxJS `resetOnRefCountZero` with `timer()` — `@/query/core/CacheEntry.ts:70`

**Conclusion: Subscriptions are 100% RxJS. Signals provide synchronous `.peek()` reads and auto-tracking via `DependencyTracker`.**

## What signals/ provides

- **Primitives**: `State`, `Computed`, `Effect`, `LocalState`, `Signal` (facade) — `@/signals/signals/index.ts:1-5`
- **Base infra**: `Batcher`, `ComputeCache`, `DependencyTracker`, `Devtools`, `Indexer`, `ReadonlySignal`, `SyncObservable` — `@/signals/base/`
- **Operators**: `signalize` (Observable → signal) — `@/signals/operators/signalize.ts`
- **React**: `useSignal` — `@/signals/react/useSignal.ts`
- **Types**: `SignalFn`, `ComputeFn`, `ReadableSignalFnLike`, `ReadableSignalLike`, `WriteableSignalLike`, `StatefulSignalFn` — `@/signals/types/signals.types.ts`

## Could query core be signal-agnostic?

**Coupling points that block signal-agnosticism:**

| Usage | Files | Abstraction difficulty |
|---|---|---|
| `Signal.state()` for reactive state | CacheEntry, Resource, ResourceAgent, CommandAgent | Medium — replaceable with interface `{ peek, set, get, obs }` |
| `Signal.compute()` for derived state | ResourceAgent, CommandAgent | Medium — replaceable with interface `{ peek, get, obs }` |
| `signalize()` — Observable→Signal | CacheEntry | Low — only wraps for `.state$` accessor |
| `Batcher.run()` — transaction batching | Resource, Command, CommandCacheEntry | High — deeply affects update ordering semantics |
| Signal types in public API (`ComputeFn`, `ReadableSignalFnLike`) | agent.types, command.types, resource.types | High — public contract leaks signal types |

**Assessment**: Core is moderately coupled. `Batcher` and public type exports are the hardest to abstract. The pattern is consistent: `Signal.state` for writable cells, `Signal.compute` for derived cells, `Batcher.run` for atomic updates. An abstraction layer would need ~4 interfaces (`WritableCell`, `ComputedCell`, `signalize`, `batch`) plus type aliases.

## Code References

- `@/query/core/CacheEntry.ts:4` — imports `Signal`, `signalize`
- `@/query/core/CacheEntry.ts:5` — imports `SignalFn`, `SignalOptions`
- `@/query/core/CacheEntry.ts:28` — `Signal.state()` call
- `@/query/core/CacheEntry.ts:46` — `signalize()` call
- `@/query/core/resource/Resource.ts:14-15` — imports `Signal`, `Batcher`
- `@/query/core/resource/Resource.ts:32-36` — `Signal.state()` calls
- `@/query/core/resource/Resource.ts:118` — `Batcher.run()`
- `@/query/core/resource/ResourceAgent.ts:3-4` — imports `Signal`, `ReadableSignalFnLike`, `ComputeFn`
- `@/query/core/resource/ResourceAgent.ts:22` — `Signal.state()` for tracking
- `@/query/core/resource/ResourceAgent.ts:36` — `Signal.compute()` for state$
- `@/query/core/resource/ResourceAgent.ts:72` — `Signal.compute()` for current$
- `@/query/core/resource/ResourceCacheEntry.ts:18` — imports `ReadableSignalFnLike`
- `@/query/core/resource/ResourceCacheEntry.ts:67` — assigns `this.machine$ = this.state$`
- `@/query/core/command/Command.ts:2` — imports `Batcher`
- `@/query/core/command/Command.ts:27` — `Batcher.run()`
- `@/query/core/command/CommandAgent.ts:2-3` — imports `Signal`, `ComputeFn`
- `@/query/core/command/CommandAgent.ts:69` — `Signal.state()`
- `@/query/core/command/CommandAgent.ts:73` — `Signal.compute()`
- `@/query/core/command/CommandCacheEntry.ts:12` — imports `Batcher`
- `@/query/types/agent.types.ts:1` — `ComputeFn` in public types
- `@/query/types/command.types.ts:1` — `ComputeFn` in public types
- `@/query/types/resource.types.ts:2` — `ReadableSignalFnLike`, `TBeforeDevtoolsPushFn` in public types
- `@/query/react/useResourceAgent.ts:5` — `useSignal` import
- `@/query/react/useCommandAgent.ts:2` — `useSignal` import
