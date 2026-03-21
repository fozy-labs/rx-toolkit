---
title: "Phase 3: Cache Layer — CacheMap + CacheEntry"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement the dual-strategy cache infrastructure: `CacheMap` (with `SerializedCacheMap` and `CompareCacheMap` implementations) and `CacheEntry` (the Signal.state-based reactive cache unit). This phase bridges the machine classes from Phase 2 with the reactive signal system, establishing the storage layer that ResourceV2 will orchestrate.

## Dependencies

- **Requires**: Phase 1 (types, tokens), Phase 2 (machine classes — used as test fixtures in CacheEntry tests, and `TMachine` union used at runtime)
- **Blocks**: Phase 4 (ResourceV2 owns CacheMap, creates CacheEntry instances)

## Execution

Sequential (depends on Phase 2).

## Tasks

### Task 3.1: Implement CacheMap with dual strategies

- **File**: `src/query-v2/core/CacheMap.ts`
- **Action**: Create
- **Description**: Implement the `ICacheMap` interface with two concrete implementations selected at construction time: `SerializedCacheMap` (Map-based, O(1)) and `CompareCacheMap` (array-scan, O(n)).
- **Details**:
  - Implement as a single `CacheMap` class with internal strategy delegation, OR as an abstract `ICacheMap` with two concrete classes + factory. ADR-3 selects the abstract interface approach. [ref: ../02-design/04-decisions.md#ADR-3]
  - **SerializedCacheMap**: Wraps `Map<string, CacheEntry>`. Each `get`/`set`/`delete`/`has` call runs `serializeArgs(args)` to produce the string key. [ref: ../02-design/03-model.md#1.6]
  - **CompareCacheMap**: Wraps `Array<{ args: TArgs; entry: CacheEntry }>`. Each `get`/`has` does linear scan via `compareArg(a, b)`. [ref: ../02-design/03-model.md#1.6]
  - `doCacheArgs: true`: For `serialize` strategy, wraps a `WeakMap<object, string>` to memoize serialization results. Only works for object args (primitives bypass memoization). [ref: ../02-design/03-model.md#1.6]
  - Factory: `CacheMap.create(options: ICacheMapOptions)` returns the appropriate implementation.
  - Methods: `get`, `set`, `delete`, `has`, `values`, `entries`, `clear`, `size`.
  - Import `stableStringify` from `../lib/stableStringify` for default serialize function.
  - Import `shallowEqual` from `@/common/utils/shallowEqual` for default compare function.
- **Complexity**: Medium

### Task 3.2: Implement CacheEntry

- **File**: `src/query-v2/core/CacheEntry.ts`
- **Action**: Create
- **Description**: Implement `CacheEntry` as a reactive wrapper around `Signal.state<TMachine>()`. This is the fundamental reactive primitive that connects machine state to the signal graph.
- **Details**:
  - Holds a `Signal.state<TMachine<TData, TError>>()` internally.
  - Implements `ICacheEntry` interface: `machine$` (reactive signal read), `peek()` (synchronous read), `set(machine)` (update), `complete()` (cleanup/disposal).
  - `Signal.state()` is created with:
    - `key` option: formatted as `'{keyPrefix}/{resourceKey}/{serializedArgs}'` for devtools identification. Accept keyParts in constructor. [ref: ../02-design/04-decisions.md#ADR-8]
    - `beforeDevtoolsPush`: Default callback that projects `machine` → `machine.state` (plain object). Compose with user-provided `beforeDevtoolsPush` if available. [ref: ../02-design/04-decisions.md#ADR-8, ../02-design/05-usecases.md#UC-10]
  - `complete()`: Disposes the signal (allow GC). On cleanup, calls `abortAllPendingPatches()` on the current machine if it is a `MachineWithData` instance (Layer 3 of hanging patch defense per ADR-4). [ref: ../02-design/04-decisions.md#ADR-4]
  - Import `Signal` from `@/signals/`.
- **Complexity**: Medium

### Task 3.3: CacheMap and CacheEntry unit tests

- **Files** (all Create):
  - `src/query-v2/core/CacheMap.test.ts`
  - `src/query-v2/core/CacheEntry.test.ts`
- **Action**: Create
- **Description**: Unit tests for cache infrastructure.
- **Details**:
  - **CacheMap tests** — implement: C1 (serialize set+get), C2 (different key order same result), C3 (has returns false for missing), C4 (delete removes), C5 (compare set+get with shallowEqual), C6 (compare miss), C7 (compare values iteration), C8 (clear empties), C9 (entries), C10 (doCacheArgs memoization), C11 (doCacheArgs with primitives — no caching). Also E3 (empty cache values). [ref: ../02-design/06-testcases.md#2]
  - **CacheEntry tests**:
    - Create CacheEntry with `MachineIdle.create()`, verify `peek()` returns idle machine.
    - `set(MachineSuccess.create(...))` → verify `peek()` returns success.
    - Verify `machine$` is a reactive signal read — test by using Signal.compute that reads `machine$` and verifying it re-evaluates on `.set()`.
    - `complete()` — verify cleanup (no errors, subsequent operations are no-ops or throw).
    - D4 (machine.state is JSON-serializable for devtools) — verify `JSON.stringify(entry.peek().state)` succeeds for all 5 machine types.
  - CacheEntry tests use real `Signal.state` / `Signal.compute` from `@/signals/`.
  - CacheMap tests use mock CacheEntry objects (or real ones with MachineIdle — lightweight).
- **Complexity**: Medium

## Verification

- [ ] `npm run ts-check` passes
- [ ] All 11 CacheMap test cases (C1–C11) pass
- [ ] CacheEntry reactive tests pass (Signal.compute re-evaluates on machine change)
- [ ] `doCacheArgs` memoization confirmed via spy on `serializeArgs`
- [ ] `CacheEntry.complete()` calls `abortAllPendingPatches()` on MachineWithData instances
- [ ] D4 test passes — all 5 machine types produce JSON-serializable `.state`
- [ ] No imports from `src/query/`
