---
title: "Phase 4A: JSDoc"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Add JSDoc comments to the public API surface (classes, exported functions, key methods) and inline comments at "magic" code locations where behavior is non-obvious. No machine classes or private helpers receive JSDoc. [ref: ../02-design/04-decisions.md ADR-5]

## Dependencies

- **Requires**: Phase 3A (DevTools Isolation) + Phase 3B (Snapshot Errors) — JSDoc references `isDisabled: true` and error semantics that are implemented in Phase 3
- **Blocks**: None

## Execution

Parallel with Phase 4B (Documentation).

## Tasks

### Task 4A.1: JSDoc for `createApi` function

- **File**: `src/query-v2/api/createApi.ts`
- **Action**: Modify
- **Description**: Add JSDoc to the `createApi` function (line ~11). Include:
  - Brief description of what `createApi` does
  - `@param options` — configuration for the API instance
  - `@returns` — API instance with `createResource`, `resetAll`, `getSnapshot`
  - `@see` link to `docs/query-v2/README.md`
- **Design reference**: [ref: ../02-design/05-usecases.md UC-5.2 — example JSDoc], [ref: ../02-design/04-decisions.md ADR-5 §JSDoc targets]
- **Complexity**: Low

### Task 4A.2: JSDoc for `ResourceV2` class and undocumented methods

- **File**: `src/query-v2/core/resource/ResourceV2.ts`
- **Action**: Modify
- **Description**: Add JSDoc to the following (5 methods currently lack JSDoc, plus class-level):
  - **Class-level** (line ~46): Brief description of ResourceV2 as the cache-backed resource manager
  - **`createAgent()`** (line ~88): Description, `@returns` agent for tracking cache entry state
  - **`query()`** (line ~90): Description, `@param args`, `@param doForce`, `@returns` cache entry after query
  - **`query$()`** (line ~168): Description, `@param args`, `@returns` observable of machine state
  - **`entry()`** (line ~191): Description, `@param args`, `@returns` cache entry
  - **`resetCache()`** (line ~393): Description of cache reset behavior
  - Existing JSDoc on other methods (`key`, `keyStrategy`, `getSerializedKey`, `cacheEntries`, `hydrateEntry`, `hasEntry`, `populateEntry`, `createEntryPatch`, `lockEntry`, `onRefreshError`, `scheduleGc`, `cancelGc`) — do NOT modify
- **Design reference**: [ref: ../02-design/05-usecases.md UC-5.3, UC-5.4 — example JSDoc], [ref: ../02-design/04-decisions.md ADR-5 §JSDoc targets]
- **Complexity**: Medium

### Task 4A.3: JSDoc + inline comments for `ResourceV2Agent`

- **File**: `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Action**: Modify
- **Description**: Add:
  - **Class-level JSDoc** (line ~18): Agent that tracks a single cache entry with reactive state, designed for React hook consumption
  - **`state$`** (line ~97): JSDoc describing the computed reactive state signal
  - **`start()`** (line ~101): JSDoc with `@param args` and description of arg-change behavior
  - **Inline comment** on each of the 3 `isDisabled: true` signal constructors: explain that agent signals are internal derived state for React hooks and intentionally excluded from devtools (only `CacheEntry` signals represent canonical cache state)
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-5 §inline-comments], [ref: ../02-design/01-architecture.md §fix-4]
- **Complexity**: Low

### Task 4A.4: JSDoc + inline comment for `CacheEntry`

- **File**: `src/query-v2/core/common/CacheEntry.ts`
- **Action**: Modify
- **Description**: Add:
  - **Class-level JSDoc** (line ~17): Cache entry wrapping a reactive signal over a state machine instance
  - **`machine$()`** (line ~42): JSDoc — reactive accessor for current machine state
  - **`peek()`** (line ~46): JSDoc — non-reactive read of current machine
  - **`set()`** (line ~50): JSDoc — transition to new machine state
  - **`complete()`** (line ~66): JSDoc — complete the entry's RxJS subject
  - **Inline comment** on the `beforeDevtoolsPush` callback (line ~27): explain the intentional type mismatch — the callback pushes `machine.state` (plain object) instead of the machine instance, because devtools displays the state record
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-5 §inline-comments]
- **Complexity**: Low

### Task 4A.5: JSDoc + inline comment for `ReactHooksPlugin`

- **File**: `src/query-v2/plugins/ReactHooksPlugin.ts`
- **Action**: Modify
- **Description**: Add:
  - **Class-level JSDoc** (line ~28): Plugin that attaches `useResourceV2Agent` and `useResourceV2Ref` as methods on resources via `augmentResource`. Note that standalone imports from `@/query-v2/react/` are available as an alternative.
  - **Inline comment** on the declaration merging block: explain that `PluginContributionMap` declaration merging is TypeScript type-level wiring that adds hook method types to resources when `ReactHooksPlugin` is included in the plugins tuple
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-5 §inline-comments], [ref: ../02-design/03-model.md §6-plugin-system-type-wiring]
- **Complexity**: Low

### Task 4A.6: JSDoc for standalone hooks

- **Files**:
  - `src/query-v2/react/useResourceV2Agent.ts`
  - `src/query-v2/react/useResourceV2Ref.ts`
- **Action**: Modify
- **Description**: Add function-level JSDoc to both standalone hooks:
  - **`useResourceV2Agent`**: Description, `@param resource`, `@param args`, `@returns IResourceV2AgentState`, `@see docs/query-v2/README.md`
  - **`useResourceV2Ref`**: Description, `@param resource`, `@param args`, `@returns IResourceV2Ref`, `@see docs/query-v2/optimistic-updates.md`
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-5 §JSDoc targets]
- **Complexity**: Low

### Task 4A.7: Inline comment for `hydrateSnapshot` error logic

- **File**: `src/query-v2/snapshot/Snapshot.ts`
- **Action**: Modify
- **Description**: Add inline comments documenting the error semantics at each branch in `hydrateSnapshot`:
  - Before the version mismatch throw: comment explaining this is fatal — snapshot format incompatibility
  - Before the keyPrefix mismatch throw: comment explaining this is fatal — wrong API instance
  - Before the `console.warn` for unknown resource: comment explaining this is non-fatal — resource may have been removed between versions
  - These comments complement the existing function-level JSDoc on `hydrateSnapshot`
- **Design reference**: [ref: ../02-design/04-decisions.md ADR-5 §inline-comments]
- **Complexity**: Low

## Verification

- [ ] `npm run ts-check` passes — JSDoc does not affect compilation
- [ ] All JSDoc uses correct `@param`, `@returns`, `@see` syntax
- [ ] No JSDoc added to machine classes (`MachineIdle`, `MachinePending`, etc.) or private helpers
- [ ] Inline comments are present at: `CacheEntry.beforeDevtoolsPush`, `ResourceV2Agent` signal constructors, `hydrateSnapshot` error branches, `ReactHooksPlugin` declaration merging
