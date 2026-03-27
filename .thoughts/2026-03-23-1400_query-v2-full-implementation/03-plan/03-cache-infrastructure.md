---
title: "Phase 3: Core — Cache Infrastructure"
date: 2026-03-25
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the CacheEntry signal wrapper and the dual CacheMap strategy (SerializeCacheMap + CompareCacheMap) with factory. These provide the reactive caching primitives that ResourceV2 will build upon.

## Dependencies

- **Requires**: Phase 1 (types, lib — specifically `stableStringify` for SerializeCacheMap)
- **Blocks**: Phase 4

## Execution

Parallel with Phase 2 (no mutual dependencies). Within this phase: CacheEntry parallel with CacheMap implementations.

## Tasks

### Task 3.1: Create CacheEntry class

- **File**: `src/query-v2/core/CacheEntry.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `CacheEntry<TState>` — internal reactive container wrapping a `Signal.state<TState>`, implementing `ICacheEntry<TState>`.
- **Details**:
  - Constructor receives initial `TState` value (and optional `ICacheEntryOptions`)
  - Private `_signal$: SignalFn<TState>` — mutable signal holding state
  - Private `_isCompleted: boolean` — guards against writes after completion
  - `state$(): TState` — reactive read (registers signal dependency)
  - `peek(): TState` — non-reactive read
  - `set(state: TState): void` — update stored state (no-op if completed)
  - `complete(): void` — fires `onClean$`, sets `_isCompleted = true`; subsequent `set()` calls are no-ops
  - `readonly onClean$: Subject<void>` — cleanup observable, fires on `complete()`
  - `readonly obs: Observable<TState>` — RxJS Observable bridge wrapping `_signal$` for `share({resetOnRefCountZero})` GC integration (see 02-dataflow.md §1.7)
  - Generic over `TState` (not `TArgs, TData`); ResourceV2 instantiates as `CacheEntry<TMachineInstance<TArgs, TData>>`
  - Base class — ResourceV2CacheEntry will extend this in Phase 4
  - Import `SignalFn` from `@/signals`, `Subject`/`Observable` from `rxjs`
  - [ref: ../02-design/03-model.md#§5]

### Task 3.2: Create SerializeCacheMap

- **File**: `src/query-v2/core/CacheMap/SerializeCacheMap.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `SerializeCacheMap<TArgs, TEntry>` — cache keyed by serialized args string, implementing `ICacheMap<TArgs, TEntry>`.
- **Details**:
  - Constructor receives `ICacheMapOptions<TArgs, TEntry>` — stores `factory` and `serializeArgs` (default: `stableStringify`)
  - Internal storage: `Map<string, TEntry>`
  - `get(args)` → `TEntry | undefined`
  - `getOrCreate(args)` → `TEntry` — creates entry if missing via constructor-provided `factory(args)`
  - `delete(args)` → `boolean`
  - `has(args)` → `boolean`
  - `clear()` → clears all entries
  - `values()` → `IterableIterator<TEntry>`
  - `entries()` → `IterableIterator<[string, TEntry]>` (string keys)
  - `size` getter
  - Default strategy when `keyStrategy = "serialize"`
  - [ref: ../02-design/03-model.md#§6.3, ../02-design/04-decisions.md#ADR-19]

### Task 3.3: Create CompareCacheMap

- **File**: `src/query-v2/core/CacheMap/CompareCacheMap.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Implement `CompareCacheMap<TArgs, TEntry>` — cache using linear scan with custom comparison, implementing `ICacheMap<TArgs, TEntry>`.
- **Details**:
  - Constructor receives `ICacheMapOptions<TArgs, TEntry>` — stores `factory` and `compareArg` (default: `shallowEqual`)
  - Internal storage: `Array<{args: TArgs, entry: TEntry}>`
  - Uses `compareArg(a, b)` equality function for lookup
  - `get(args)` → linear scan, return first match or undefined
  - `getOrCreate(args)` → find or create via constructor-provided `factory(args)`
  - `delete(args)` → find and splice
  - `has(args)` → `boolean` (linear scan)
  - `clear()` → empties `_entries` array
  - `values()` → `IterableIterator<TEntry>`
  - `entries()` → `IterableIterator<[TArgs, TEntry]>` (original args as keys)
  - `size` getter
  - Used when `keyStrategy = "compare"` (e.g., for non-serializable args like class instances)
  - [ref: ../02-design/03-model.md#§6.3, ../02-design/04-decisions.md#ADR-19]

### Task 3.4: Create createCacheMap factory

- **File**: `src/query-v2/core/CacheMap/createCacheMap.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Implement `createCacheMap<TArgs, TEntry>` factory function that selects the appropriate CacheMap implementation based on `ICacheMapOptions`.
- **Details**:
  - Receives full `ICacheMapOptions<TArgs, TEntry>` (includes `factory`, `keyStrategy`, optional `serializeArgs`/`compareArg`)
  - If `keyStrategy === "compare"` → `CompareCacheMap`
  - Otherwise → `SerializeCacheMap` (default)
  - Returns `ICacheMap<TArgs, TEntry>`
  - [ref: ../02-design/03-model.md#§6.3, ../02-design/04-decisions.md#ADR-19]

### Task 3.5: Create CacheMap barrel export

- **File**: `src/query-v2/core/CacheMap/index.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Barrel re-export `SerializeCacheMap`, `CompareCacheMap`, `createCacheMap`.
- **Details**:
  - [ref: ../02-design/01-architecture.md#§2]

### Task 3.6: Create CacheEntry tests

- **File**: `src/query-v2/core/__tests__/CacheEntry.test.ts`
- **Action**: Create
- **Complexity**: Low
- **Description**: Test CacheEntry signal wrapping and accessor behavior.
- **Details**:
  - CE01: CacheEntry wraps Signal.state with initial value
  - CE02: `entry.set(newState)` updates signal value
  - CE03: `entry.peek()` returns value without registering signal dependency
  - CE04: `entry.state$()` registers signal dependency
  - CE05: `entry.complete()` fires onClean$ and marks completed
  - CE06: `entry.set()` is no-op after `complete()`
  - CE07: `onClean$` fires exactly once on complete
  - CE08: Multiple `complete()` calls — idempotent
  - CE09: DevTools keyParts pass through to Signal construction
  - CE10: `beforeDevtoolsPush` callback invoked before devtools state push
  - [ref: ../02-design/06-testcases.md#CE01–CE10]

### Task 3.7: Create CacheMap tests

- **File**: `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts`
- **Action**: Create
- **Complexity**: Medium
- **Description**: Test both CacheMap implementations and the factory.
- **Details**:
  Factory mechanism:
  - CM-F01: `getOrCreate(args)` calls factory when no entry exists
  - CM-F02: `getOrCreate(args)` does NOT call factory for existing entry
  - CM-F03: Factory receives correct args
  - CM-F04: `createCacheMap({ keyStrategy: "serialize" })` returns SerializeCacheMap
  - CM-F05: `createCacheMap({ keyStrategy: "compare" })` returns CompareCacheMap

  Serialize strategy (SerializeCacheMap):
  - CM01: `getOrCreate(args)` creates new entry for unknown args
  - CM02: `getOrCreate(args)` returns existing entry for same args
  - CM03: `get(args)` returns undefined when no entry
  - CM04: `delete(args)` removes entry
  - CM05: `clear()` removes all entries
  - CM06: `entries()` iterates all [string, entry] pairs
  - CM07: Custom `serializeArgs` is used for key generation
  - CM08: Object key ordering doesn't affect lookup
  - CM09: `doCacheArgs: true` memoizes args via WeakMap
  - CM19: `values()` iterates all entry values

  Compare strategy (CompareCacheMap):
  - CM10: `getOrCreate(args)` with compare strategy uses `compareArg` for lookup
  - CM11: Compare strategy linear scan — finds correct entry among multiple
  - CM12: Compare strategy — different args create separate entries
  - CM13: Compare strategy `get(args)` returns undefined when no match
  - CM14: Compare strategy `delete(args)` removes correct entry
  - CM15: Compare strategy `clear()` removes all entries
  - CM16: Compare strategy `entries()` iterates with original TArgs as keys
  - CM17: Compare strategy with non-serializable args (RegExp)
  - CM18: Compare strategy default compareArg uses shallowEqual
  - [ref: ../02-design/06-testcases.md#CM-F01–F05, CM01–CM19]

## Verification

- [ ] `npm run ts-check` passes
- [ ] `npx vitest run src/query-v2/core/__tests__/CacheEntry.test.ts` — CE01–CE10 pass
- [ ] `npx vitest run src/query-v2/core/CacheMap/` — CM-F01–F05, CM01–CM19 pass
- [ ] SerializeCacheMap uses stableStringify from lib (not its own implementation)
- [ ] No imports from layers above core
