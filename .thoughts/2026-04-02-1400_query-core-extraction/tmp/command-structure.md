---
title: "Command Entity Structure — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

Command is the mutation primitive of the query module — a fire-on-demand counterpart to the SWR-driven Resource. It manages an imperative `trigger → loading → success|error` lifecycle, caches entries by a per-agent `symbol` key, and supports linking to Resource entities for optimistic updates, cache invalidation, and post-mutation patching. The `createOperation` API was the v1 predecessor to Command and has been fully removed as of v0.6.0.

## Findings

### 1. File Inventory — `src/query/core/command/`

| File | Lines | Purpose |
|---|---|---|
| `Command.ts` | ~50 | Top-level entity: holds options, manages `Map<symbol, CommandCacheEntry>` |
| `CommandAgent.ts` | ~95 | Per-consumer observer: wraps a single cache entry behind a reactive `state$` signal |
| `CommandCacheEntry.ts` | ~300 | Extends `CacheEntry`: owns fetch lifecycle, abort, optimistic patching via linked Resources, lifecycle hooks |
| `ResourceRef.ts` | ~25 | Thin adapter calling `IResource.invalidate` / `entry.createPatch` for linked resources |
| `index.ts` | 4 | Re-exports all four above |

### 2. File Inventory — API Layer

| File | Purpose |
|---|---|
| `src/query/api/_createCommand.ts` | Standalone factory: `new Command(options)`, returns `ICommand` |
| `src/query/api/createApi.ts:164-195` | `apiCreateCommand`: merges `cacheLifetime: 0`, creates `Command`, runs plugin `augmentCommand` |
| `src/query/api/commandLink.ts` | Type-safe helper producing `CommandLink<any,any>` from `ICommandLinkOptions` |

### 3. Type Files

| File | Key Exports |
|---|---|
| `command.types.ts` | `TCommandQueryFn`, `ICommandLinkOptions`, `CommandLink`, `TCommandOptions`, `ICommand`, `IResourceRef`, `TCommandAgentState` (4-branch DU: idle/loading/success/error), `ICommandAgent` |
| `command-machine.types.ts` | `TCommandMachineStatus`, `TCommandIdleState`, `TCommandLoadingState`, `TCommandSuccessState`, `TCommandErrorState`, `TCommandMachineState`, `TCommandMachineInstance` |
| `command-lifecycle.types.ts` | `ICommandCacheEntryAddedTools`, `ICommandQueryStartedTools`, `TOnCommandCacheEntryAdded`, `TOnCommandQueryStarted` |

### 4. State Machine — Command vs Resource

#### Command machine classes (`src/query/core/machines/`)

| Class | File | Transitions |
|---|---|---|
| `CommandIdle` | `CommandIdle.ts:6-19` | `.start(args) → CommandLoading` |
| `CommandLoading` | `CommandLoading.ts:7-28` | `.successHappened(data) → CommandSuccess`, `.errorHappened(err) → CommandError` |
| `CommandSuccess` | `CommandSuccess.ts:7-32` | `.start(args) → CommandLoading` |
| `CommandError` | `CommandError.ts:6-22` | `.start(args) → CommandLoading` |

- **4 statuses**: `idle | loading | success | error`
- Each is a standalone class, **not** extending any shared base
- Comments say "Stub — full implementation in Phase 2"
- `CommandSuccess` stores `patchState: TPatchState<TData> | null` (same type as Resource machines)

#### Resource machine classes (for comparison)

| Class | Transitions |
|---|---|
| `MachinePending` | `.successHappened → MachineSuccess`, `.errorHappened → MachineError` |
| `MachineSuccess` | `.invalidate → MachineRefreshing`, `.start → MachinePending` |
| `MachineRefreshing` | (inherits from `MachineWithData`) |
| `MachineError` | `.start → MachinePending` |

- **4 statuses**: `pending | success | error | refreshing`
- `MachineSuccess` and `MachineRefreshing` extend abstract `MachineWithData` — which owns `patchState` + `createPatch` / `finishPatch` logic
- Command machines have **no shared base class** — patch creation is done externally in `CommandCacheEntry`

### 5. State Managed by Command

- **`Command`** (`Command.ts:9`): `Map<symbol, CommandCacheEntry>` — one entry per agent symbol key
- **`CommandCacheEntry`** (`CommandCacheEntry.ts:28-39`):
  - Inherits `CacheEntry<TCommandMachineInstance>` which wraps `Signal.state`
  - `_queryFn` — the user-provided async function
  - `_link` — array of `CommandLink` definitions for post-mutation Resource effects
  - `_abortController` — abort inflight on re-trigger or reset
  - `_triggerResolver` — `PromiseResolver<TResult>` for the returned trigger promise
  - `_queryFulfilled` — lifecycle hook promise
  - `_entryDataLoaded` / `_entryRemoved` — lifecycle hook promises for `onCacheEntryAdded`
- **`CommandAgent`** (`CommandAgent.ts:70-73`):
  - `_entry$` = `Signal.state<CommandCacheEntry | null>(null)` — tracks which entry this agent watches
  - `state$` = `Signal.compute` — derives `TCommandAgentState` from entry's machine state

### 6. Command Lifecycle

1. **Creation**: `Command(options)` stores options; no entries created yet
2. **Agent creation**: `command.createAgent()` → `new CommandAgent(command, uniqueSymbol)` — allocates a symbol key but no entry
3. **Trigger** (`CommandAgent.trigger`):
   - Calls `command._getOrCreateEntry(key)` — lazy entry creation with options from Command
   - Sets `_entry$.set(entry)` so `state$` tracks it
   - Delegates to `entry.initiate(args)` which returns `Promise<TResult>`
4. **Initiate** (`CommandCacheEntry.initiate`, line 55):
   - Aborts previous inflight + rejects previous trigger promise
   - Transitions machine: `idle/success/error → loading` (via `.start(args)`) or re-creates `CommandLoading` if already loading
   - Applies `optimisticUpdate` on all linked Resources via `ResourceRef.patch`
   - Fires `onQueryStarted` lifecycle hook
   - Calls `queryFn(args, { abortSignal })`
   - On **success**: transitions to `CommandSuccess`, commits optimistic patches, applies `update` patches, fires `invalidate` on linked resources, resolves lifecycle promises
   - On **error**: transitions to `CommandError`, aborts optimistic patches, rejects lifecycle promises
5. **Reset** (`CommandAgent.reset`): calls `entry.resetToIdle()` → aborts inflight, transitions to `CommandIdle`
6. **Cache reset** (`Command.resetCache`): clears entire `_entries` map, calls `complete()` on each entry

### 7. What Command Shares with Resource Currently

| Aspect | Shared? | Details |
|---|---|---|
| `CacheEntry<T>` base class | **Yes** | Both `CommandCacheEntry` and `ResourceCacheEntry` extend `CacheEntry` (`src/query/core/CacheEntry.ts`) |
| Signal-based state | **Yes** | Both use `Signal.state` for machine state (via `CacheEntry`) |
| RxJS `share()` + `resetOnRefCountZero` GC | **Yes** | Inherited from `CacheEntry` |
| `Patcher` utility | **Partial** | Resource uses it via `MachineWithData.createPatch`; Command uses `ResourceRef.patch` which delegates to `ResourceCacheEntry.createPatch` — Command itself does NOT patch its own data |
| `PromiseResolver` utility | **Yes** | Both use it for lifecycle hooks (`_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled`) |
| `AbortController` pattern | **Yes** | Both have `_abortController` + stale-check-via-signal pattern |
| Machine classes | **No** | Completely separate: `CommandIdle/Loading/Success/Error` vs `MachinePending/Success/Error/Refreshing` — no shared base |
| Lifecycle hook types | **No** | Separate interfaces: `TOnCommandCacheEntryAdded` vs `TOnCacheEntryAdded`, `TOnCommandQueryStarted` vs `TOnQueryStarted` |
| Agent class | **No** | `CommandAgent` and `ResourceAgent` have different shapes — Command has `trigger/reset`, Resource has `start(args)` with SWR tracking + previous-entry logic |
| Plugin system | **Yes** | Both use `IPlugin.augmentResource` / `augmentCommand` |
| Type-level `ArgsOrVoid` | **Yes** | Shared via `shared.types.ts` |
| `ArgsOrVoidOrSkip` / `SKIP_TOKEN` | **No** | Resource only — Command doesn't support skip |

### 8. What Command Could Share with Resource (Potential Extraction)

- **Fetch lifecycle in CacheEntry**: Both `CommandCacheEntry` and `ResourceCacheEntry` duplicate: abort management, lifecycle hook resolution (`_fireCacheEntryAdded`, `complete()`), `PromiseResolver` cleanup. A shared `FetchableCacheEntry` or mixin could unify ~40-60 lines.
- **Machine base class**: Command machines are trivial standalone classes. The `start()` transition on `CommandIdle/Success/Error` mirrors `MachinePending`. A shared "startable" interface is possible but questionable given the simplicity.
- **Lifecycle types**: `ICommandCacheEntryAddedTools` ≈ `ICacheEntryAddedTools` (both have `$cacheDataLoaded` + `$cacheEntryRemoved`). `ICommandQueryStartedTools` ≈ `IQueryStartedTools` (both have `$queryFulfilled`, Resource also has `getCacheEntry`).

### 9. Operation (createOperation) — Status

- `createOperation` was the v1 predecessor to `createCommand`
- Fully **removed** in v0.6.0 per `docs/migrations/0.6.0.md:123` and `docs/CHANGELOG.md:7`
- No `src/query/core/Operation/` directory exists — it has been deleted
- No `createOperation.ts` exists in current `src/query/api/`
- The coverage directory still has old `query/` entries referencing `createOperation`, `createResource`, `createResourceDuplicator` — these are stale v1 coverage artifacts

### 10. React Integration

- **`src/query/react/useCommandAgent.ts:5-16`**: Hook consuming `ICommand` → calls `command.createAgent()`, subscribes to `agent.state$` via `useSignal`, returns `[trigger, state]` tuple
- **Plugin**: `ReactHooksPlugin` adds `.useCommandAgent()` directly on the command object via `augmentCommand` (`plugin.types.ts:57-62`)

### 11. Test Files

| File | Focus |
|---|---|
| `command.test.ts` | Command class unit tests |
| `command-machine.test.ts` | Machine state transition tests |
| `command-integration.test.ts` | End-to-end with linked Resources |
| `command-edge-cases.test.ts` | Abort, re-trigger, error scenarios |
| `command-cache-entry.test.ts` | CacheEntry lifecycle tests |
| `command-api.test.ts` | `createApi.createCommand` integration |
| `command-agent.test.ts` | CommandAgent trigger/reset/state tests |

## Code References

- `@/src/query/core/command/Command.ts:7-50` — `Command` class: options storage, `_entries` Map, `createAgent()`, `resetCache()`, `_getOrCreateEntry()`
- `@/src/query/core/command/CommandAgent.ts:70-94` — `CommandAgent` class: `_entry$` signal, `state$` compute, `trigger()`, `reset()`
- `@/src/query/core/command/CommandAgent.ts:7-64` — `deriveAgentState()` — 4-branch switch mapping machine to `TCommandAgentState`
- `@/src/query/core/command/CommandCacheEntry.ts:27-47` — `CommandCacheEntry` class header: extends `CacheEntry`, private fields
- `@/src/query/core/command/CommandCacheEntry.ts:55-200` — `initiate()` — full trigger lifecycle: abort, transitions, optimistic patches, queryFn call, success/error handling
- `@/src/query/core/command/CommandCacheEntry.ts:237-248` — `resetToIdle()` — abort + idle transition
- `@/src/query/core/command/CommandCacheEntry.ts:250-278` — `complete()` — cleanup all resolvers + super.complete()
- `@/src/query/core/command/CommandCacheEntry.ts:280-297` — `_fireCacheEntryAdded()` — lifecycle tool construction
- `@/src/query/core/command/ResourceRef.ts:3-24` — `ResourceRef` class: wraps `IResource` + args for invalidate/patch
- `@/src/query/core/CacheEntry.ts:11-69` — `CacheEntry` base class: Signal.state, RxJS share()+GC, peek/set/complete
- `@/src/query/core/machines/CommandIdle.ts:6-19` — `CommandIdle`: idle → loading via `.start()`
- `@/src/query/core/machines/CommandLoading.ts:7-28` — `CommandLoading`: loading → success/error
- `@/src/query/core/machines/CommandSuccess.ts:7-32` — `CommandSuccess`: success → loading, stores patchState
- `@/src/query/core/machines/CommandError.ts:6-22` — `CommandError`: error → loading via `.start()`
- `@/src/query/api/_createCommand.ts:4-8` — standalone factory
- `@/src/query/api/createApi.ts:164-195` — `apiCreateCommand()` with plugin augmentation
- `@/src/query/api/commandLink.ts:22-26` — type-safe link helper
- `@/src/query/react/useCommandAgent.ts:5-16` — React hook
- `@/src/query/types/command.types.ts:1-95` — all Command-level types
- `@/src/query/types/command-machine.types.ts:1-51` — machine state types + instance union
- `@/src/query/types/command-lifecycle.types.ts:1-17` — lifecycle hook types
- `@/src/query/types/plugin.types.ts:25-28` — `augmentCommand` on IPlugin
- `@/src/query/types/plugin.types.ts:57-62` — `IReactHooksPluginCommandContributions`
- `@/docs/CHANGELOG.md:49` — `createCommand` replaces `createOperation`
- `@/docs/migrations/0.6.0.md:123` — `createOperation` removed
