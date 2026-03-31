---
title: "Command v1 — Codebase Analysis"
date: 2026-03-30
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

Command v1 is a mutation primitive in `src/query/` that wraps an async `queryFn`, manages loading/success/error state through a `CommandQueryState` state machine, and links to Resource caches for invalidation, optimistic updates, locking, and creation. It exposes a factory (`createCommand`), a core class (`Command`), an agent pattern (`CommandAgent`), and a React hook (`useCommandAgent`).

## Findings

### 1. Core State Machine — `CommandQueryState`

- **Location**: `@/src/query/core/Command/Command.ts:20-85`
- **States**: `create → load → success | error`
  - `create()` → all flags false, nulls
  - `load(state, args)` → `isLoading=true`, `isRepeating=state.isDone`, `isInitiated=true`
  - `success(state, data)` → `isLoading=false`, `isDone=true`, `isSuccess=true`, `isError=false`, `error=null`
  - `error(state, error)` → `isLoading=false`, `isDone=true`, `isSuccess=false`, `isError=true`
- **Shape** (`CoreCommandQueryState<D>`):
  ```ts
  { arg, data, error, isError, isLoading, isRepeating, isDone, isSuccess, isInitiated }
  ```
- `isRepeating` is set when re-initiating after `isDone=true` (previous execution completed)

### 2. Command Class

- **Location**: `@/src/query/core/Command/Command.ts:87-230`
- **Constructor**: receives `CommandCreateOptions<D>`, creates `QueriesCache` (default lifetime 1s), `QueriesLifetimeHooks`, parses link definitions, subscribes to `ResetAllQueriesSignal`
- **Key methods**:
  - `createAgent()` → returns `new CommandAgent<D>(this)` — `@/src/query/core/Command/Command.ts:114`
  - `getQueryCache(args)` → lookup from `QueriesCache` — `@/src/query/core/Command/Command.ts:118`
  - `createQueryCache(args, state?)` → creates reactive cache, wires up lifecycle hooks — `@/src/query/core/Command/Command.ts:122-143`
  - `initiate(args, options?)` → wraps `_initiate` in `Batcher.run()` — `@/src/query/core/Command/Command.ts:145-149`
  - `mutate(args)` → deprecated Promise-based wrapper over `initiate` — `@/src/query/core/Command/Command.ts:207-230`

### 3. Initiation Flow — `_initiate()`

- **Location**: `@/src/query/core/Command/Command.ts:151-205`
- **Flow**:
  1. Get or create cache, set state to `load`
  2. For each link: compute `forwardArgs`, create `ResourceRef`
  3. Call `queryFn(args)` → get Promise
  4. For each link (pre-flight): `lock()` if configured, `optimisticUpdate` via `ref.patch()` if configured
  5. On `.then(result)` inside `Batcher.run()`:
     - Set state to `success`
     - For each link: `update` (patch+commit), `create` (if not exists), `invalidate`
     - Commit optimistic patches, fire `fulfilledSuccess` hook, unlock
  6. On `.catch(error)` inside `Batcher.run()`:
     - Set state to `error`
     - Abort optimistic patches, fire `fulfilledError` hook, unlock

### 4. CommandAgent

- **Location**: `@/src/query/core/Command/CommandAgent.ts:1-68`
- **Implements**: `CommandAgentInstance<D>`
- **State**: holds `_commands$` Signal containing `current$: ReactiveCache | null`
- **`state$`**: Computed signal that derives a flattened view (`isLoading, isDone, isSuccess, isError, error, data, args`) from the current cache's `value$`
- **`initiate(args)`**: always re-initiates (commands are not cached like resources), calls `_command.initiate(args, { cache })` and updates `_commands$`
- **`createAgent()`**: factory for new agent sharing same `Command`

### 5. Public API — `createCommand`

- **Location**: `@/src/query/api/createCommand.ts:1-24`
- **Signature**: `createCommand<ARGS, RESULT, SELECTED>(options) => CommandInstance<D>`
- **Implementation**: simply `new Command(options)` cast via `satisfies CommandCreateFn`
- **Exported from**: `@/src/query/index.ts:2`

### 6. React Hook — `useCommandAgent`

- **Location**: `@/src/query/react/useCommandAgent.ts:1-53`
- **Signature**: `useCommandAgent<D>(op: WithAgent<D>) => [TriggerFn<D>, CommandQueryState<D>]`
- **Behavior**:
  - Creates agent once via `useConstant(() => op.createAgent())`
  - Reads `agent.state$` via `useSignal`
  - Returns `[trigger, state]` tuple
  - `trigger(args)` calls `agent.initiate(args)`, then returns a Promise that subscribes to `agent.state$` and resolves/rejects when `isDone && !isLoading`
- **Exported from**: `@/src/query/index.ts:3`

### 7. Type System

- **Location**: `@/src/query/types/Command.types.ts:1-155`
- **Key types**:
  - `CommandDefinition<A, R, S>` — `{ Args, Result, Selected, Data: FallbackOnNever<S, R> }`
  - `CommandCreateOptions<D>` — `{ select?, queryFn, link?, cacheLifetime?, onCacheEntryAdded?, onQueryStarted?, devtoolsName? }`
  - `CommandInstance<D>` — `{ createAgent(), mutate(args) }`
  - `CommandAgentInstance<D>` — `{ state$, initiate(args), createAgent() }`
  - `CommandQueryState<D>` — public state shape (differs from `CoreCommandQueryState` — uses `undefined` instead of `null`)
  - `LinkOptions<D, RD>` — `{ resource, forwardArgs, invalidate?, lock?, update?, optimisticUpdate?, create? }`

### 8. Link / Cache Invalidation Mechanism

- **Location**: `@/src/query/types/Command.types.ts:42-110` (types), `@/src/query/core/Command/Command.ts:151-205` (implementation)
- **Link options**:
  - `resource` — target `ResourceInstance`
  - `forwardArgs(args)` — maps command args → resource args
  - `invalidate` — boolean, triggers `ref.invalidate()` on success
  - `lock` — boolean, calls `ref.lock()` before queryFn, `unlock()` after
  - `update({ draft, args, data })` — Immer-based resource cache update on success
  - `optimisticUpdate({ draft, args })` — Immer-based pre-flight update, committed on success, aborted on error
  - `create({ args, data })` — creates resource cache entry if it doesn't exist
- **ResourceRef** (the link target): `@/src/query/core/Resource/ResourceRef.ts:9-150`
  - `lock()` → increments lock counter, returns `{ unlock }` that decrements
  - `patch(fn)` → uses Immer `produceWithPatches`, returns `ResourceTransaction` with `commit()`/`abort()`
  - `invalidate()` → marks resource for re-fetch
  - `create(data)` → inserts new cache entry

### 9. Supporting Infrastructure

- **QueriesCache**: `@/src/query/core/QueriesCache.ts:1-39` — `IndirectMap` wrapper with `ReactiveCache` per key, auto-cleanup via `cacheLifeTime`
- **QueriesLifetimeHooks**: `@/src/query/core/QueriesLifetimeHooks.ts:1-120` — manages `onCacheEntryAdded` and `onQueryStarted` listener chains, integrates with devtools
- **ReactiveCache**: `@/src/query/lib/ReactiveCache.ts:1-110` — BehaviorSubject-based cache with `share()`/`timer()` lifetime, `value$` as signal, `spy$` for devtools
- **ResetAllQueriesSignal**: subscribed in constructor, resets all command caches to initial state
- **Batcher**: `@/signals` — groups synchronous state updates to prevent cascading re-renders

### 10. Test Coverage

- **Command unit tests**: `@/src/query/core/Command/Command.test.ts:1-200` — covers initiate transitions, success/error, isRepeating, createAgent, mutate, select, link+invalidate
- **useCommandAgent tests**: `@/src/query/react/useCommandAgent.test.ts:1-85` — covers render, trigger invocation, state updates

## Code References

- `@/src/query/core/Command/Command.ts:20-30` — `CoreCommandQueryState<D>` type
- `@/src/query/core/Command/Command.ts:32-85` — `CommandQueryState` static class (state machine transitions)
- `@/src/query/core/Command/Command.ts:87-230` — `Command<D>` class (full implementation)
- `@/src/query/core/Command/Command.ts:145-205` — `initiate()` / `_initiate()` with link processing
- `@/src/query/core/Command/CommandAgent.ts:8-68` — `CommandAgent<D>` class
- `@/src/query/core/Command/index.ts:1-2` — barrel exports
- `@/src/query/api/createCommand.ts:18-24` — `createCommand` factory
- `@/src/query/react/useCommandAgent.ts:25-53` — `useCommandAgent` hook
- `@/src/query/types/Command.types.ts:1-155` — all Command-related types
- `@/src/query/types/shared.types.ts:1-37` — `OnCacheEntryAdded`, `OnQueryStarted`, `FallbackOnNever`
- `@/src/query/types/Resource.types.ts:121-138` — `ResourceRefInstance`, `ResourceTransaction`
- `@/src/query/core/Resource/ResourceRef.ts:9-150` — `ResourceRef` implementation (lock, patch, invalidate, create)
- `@/src/query/core/QueriesCache.ts:1-39` — `QueriesCache` class
- `@/src/query/core/QueriesLifetimeHooks.ts:1-120` — lifecycle hooks
- `@/src/query/lib/ReactiveCache.ts:1-110` — reactive cache with TTL
- `@/src/query/index.ts:1-20` — public exports
