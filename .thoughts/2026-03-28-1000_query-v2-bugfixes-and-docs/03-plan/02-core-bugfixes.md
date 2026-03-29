---
title: "Phase 2: Core Bug Fixes (#1, #2, #5)"
date: 2026-03-29
stage: 03-plan
role: rdpi-planner
---

## Goal

Fix Bug #1 (snapshot fetch bypass), Bug #2 (onQueryStarted dead code), and Bug #5 ($cacheDataLoaded hang). Bugs #1 and #2 share `ResourceV2CacheEntry` — they are grouped here with awareness of their overlapping file. Bug #5 is in `LifecycleHooks` (independent but grouped for phase efficiency).

## Dependencies

- **Requires**: Phase 1 (types: `initialMachine` option defined, `lastError` available for `resolveQueryFulfilled` error paths)
- **Blocks**: Phase 4 (Tests)

## Execution

Sequential

## Tasks

### Task 2.1: Bug #1 — Skip `_doFetch` when `initialMachine` is provided

- **Complexity**: Medium
- **File**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Action**: Modify
- **Description**: In the `ResourceV2CacheEntry` constructor, check if `options.initialMachine` is provided. If so, call `super(options.initialMachine, options.entryOptions)` (or however the base `CacheEntry` is initialized) and skip the `_doFetch()` call. If not provided, preserve existing behavior: `super(new MachinePending(args), options.entryOptions)` followed by `_doFetch()`.
- **Details**:
  - The constructor currently unconditionally calls `_doFetch()` after `super(new MachinePending(args), ...)`.
  - With `initialMachine`, the entry starts in the provided state (typically `MachineSuccess` from snapshot) and no fetch occurs.
  - `onDataLoaded` is NOT called for hydrated entries — this is correct per design.
  - [ref: ../02-design/01-architecture.md#Fix Area 1]
  - [ref: ../02-design/04-decisions.md#ADR-1]

### Task 2.2: Bug #1 — Wire `initialMachine` through `ResourceV2._entryFactory` and `hydrateEntry`

- **Complexity**: Medium
- **File**: `src/query-v2/core/resource/ResourceV2.ts`
- **Action**: Modify
- **Description**: Update `_entryFactory` to accept an optional `initialMachine` parameter and forward it to `ResourceV2CacheEntry` constructor options. Update `hydrateEntry` (the method called during snapshot hydration) to pass the snapshot machine as `initialMachine` to `_entryFactory`, eliminating the separate `entry.set(machine)` call that currently follows entry creation.
- **Details**:
  - Currently `hydrateEntry` creates an entry via `_entryFactory(args)` then calls `entry.set(machine)` — this triggers `_doFetch` first (Bug #1) then overwrites the state.
  - After fix: `_entryFactory(args, { initialMachine: machine })` — entry starts directly in the correct state.
  - The `entry.set(machine)` call after entry creation should be removed (it's now redundant).
  - Check if `_entryFactory` goes through `CacheMap.getOrCreate` — if so, the `getOrCreate` signature may need updating to forward `initialMachine`. Alternatively, `hydrateEntry` may bypass `getOrCreate` and create the entry directly.
  - [ref: ../02-design/01-architecture.md#6. Sequence Diagram — Snapshot Hydration]

### Task 2.3: Bug #2 — Wire `fireQueryStarted`/`resolveQueryFulfilled` into `_doFetch`

- **Complexity**: High
- **File**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Action**: Modify
- **Description**: In `_doFetch`, after abort handling and before `queryFn` invocation, call `this._lifecycleHooks.fireQueryStarted(args, this)` (or equivalent — check how `_lifecycleHooks` is accessed). After `queryFn` resolves or rejects, call `this._lifecycleHooks.resolveQueryFulfilled(args, result)` with appropriate success/error payloads. On abort (stale check — controller mismatch), do NOT call `resolveQueryFulfilled` — the newer `_doFetch` owns the lifecycle.
- **Details**:
  - On success: `resolveQueryFulfilled(args, { data, meta: "fulfilled" })` — after state transition to `MachineSuccess`.
  - On error (non-refreshing): `resolveQueryFulfilled(args, { error, meta: "rejected" })` — after state transition to `MachineError`.
  - On error (refreshing → MachineSuccess with lastError): `resolveQueryFulfilled(args, { error, meta: "rejected" })` — `$queryFulfilled` still rejects since the refetch failed.
  - On abort/stale: no lifecycle settlement. The stale check returns early before state transition.
  - Verify `_lifecycleHooks` reference exists on `ResourceV2CacheEntry` — check if it's passed through constructor or accessed via parent.
  - Check the actual `fireQueryStarted`/`resolveQueryFulfilled` signatures in `src/query-v2/core/LifecycleHooks.ts` before implementing.
  - [ref: ../02-design/01-architecture.md#5. Sequence Diagram — Fetch Lifecycle]
  - [ref: ../02-design/04-decisions.md#ADR-2]

### Task 2.4: Bug #5 — Reject pending `$cacheDataLoaded` in `fireCacheEntryRemoved`

- **Complexity**: Low
- **File**: `src/query-v2/core/LifecycleHooks.ts`
- **Action**: Modify
- **Description**: In `fireCacheEntryRemoved(args)`, before resolving `$cacheEntryRemoved` and before deleting the resolver map entry, call `resolvers.dataLoaded.reject(new Error("Promise never resolved before cacheEntryRemoved."))`. This is safe even if `dataLoaded` was already resolved — `reject()` on an already-settled `PromiseResolver` is a no-op.
- **Details**:
  - The order in `fireCacheEntryRemoved` should be: (1) reject dataLoaded, (2) resolve entryRemoved, (3) delete map entry.
  - This covers both `resetCache` path (entry.complete() → onClean$ → fireCacheEntryRemoved) and GC-triggered removal path (same flow).
  - Error message matches RTK Query's canonical pattern: `"Promise never resolved before cacheEntryRemoved."`
  - [ref: ../02-design/01-architecture.md#8. Sequence Diagram — Cache Reset]
  - [ref: ../02-design/04-decisions.md#ADR-5]

## Verification

- [ ] `npm run ts-check` passes
- [ ] All existing tests pass (`npx vitest run src/query-v2/`) — except test E07 which may now fail (expected: it documents the bug)
- [ ] Snapshot hydration path: `_doFetch` is NOT called when `initialMachine` is provided
- [ ] Normal entry creation: `_doFetch` IS called when no `initialMachine` (existing behavior preserved)
- [ ] `fireQueryStarted` is invoked in `_doFetch` before `queryFn`
- [ ] `resolveQueryFulfilled` is invoked on success and error outcomes
- [ ] `$cacheDataLoaded` rejects with descriptive error when `fireCacheEntryRemoved` fires before data loads
