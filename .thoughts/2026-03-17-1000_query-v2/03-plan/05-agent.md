---
title: "Phase 5: ResourceV2Agent"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Implement `ResourceV2Agent` — the observer that provides stale-while-revalidate behavior, latest-wins concurrency, and a `Signal.compute`-based reactive state. The Agent is the primary consumption API for both framework-agnostic and React-based usage.

## Dependencies

- **Requires**: Phase 4 (ResourceV2 — Agent calls `resource.query()` and subscribes to CacheEntry)
- **Blocks**: Phase 6 (ReactHooksPlugin wraps Agent, createApi creates Agents)

## Execution

Sequential (depends on Phase 4).

## Tasks

### Task 5.1: Implement ResourceV2Agent

- **File**: `src/query-v2/core/ResourceV2Agent.ts`
- **Action**: Create
- **Description**: Implement the Agent class following the latest-wins with previous/current tracking pattern (ADR-5).
- **Details**:
  - Internal state: `Signal.state<{ previous: ICacheEntry | null; current: ICacheEntry | null }>`.
  - **`state$`**: `Signal.compute(() => { ... })` — reads `current.machine$.get()` for reactive subscription. Produces `IResourceV2AgentState`:
    - `status`: current machine's status
    - `data`: current data, or previous data if current is loading (SWR)
    - `error`: current error from MachineError
    - `args`: current args
    - `isLoading`: true if current is pending or refreshing
    - `isInitialLoading`: `isLoading && !hasPreviousData` (no stale data available)
    - `isRefreshing`: current machine is MachineRefreshing
    - `isSuccess`: data is available (current success, or SWR from previous)
    - `isError`: current machine is MachineError
    - `refreshError`: error from a failed background refresh (populated by intercepting lifecycle hook errors from ResourceV2)
  - **`start(args)`**: [ref: ../02-design/04-decisions.md#ADR-5]
    1. If `args === SKIP`: no-op, return.
    2. If args same as current (via `resource.compareArgs`): no-op (unless force).
    3. Call `resource.query(args)` → get CacheEntry.
    4. Swap: `previous = current`, `current = newEntry`.
    5. When current resolves (transitions to success/error): `previous = null`.
  - **`compareArgs(a, b)`**: Delegates to `resource.compareArgs`.
  - **`refreshError` tracking**: When the underlying resource's `onQueryStarted.$queryFulfilled` rejects during a refresh (MachineRefreshing), capture the error and expose it on the agent state. Clear `refreshError` when a new successful fetch completes. [ref: ../02-design/04-decisions.md#ADR-2]
  - Import `Signal` from `@/signals/`.
  - Import `SKIP` from `../lib/SKIP_TOKEN`.
- **Complexity**: Medium

### Task 5.2: Agent unit and integration tests

- **File**: `src/query-v2/core/ResourceV2Agent.test.ts`
- **Action**: Create
- **Description**: Integration tests for Agent stale-while-revalidate behavior, SKIP handling, and rapid arg changes.
- **Details**:
  - Implement test cases: A1 (start triggers query, state$ reactive), A2 (SWR: start(newArgs) shows previous data while loading), A3 (isInitialLoading true on first load), A4 (isInitialLoading false when switching args with stale data), A5 (start(SKIP) no fetch, state preserved), A6 (rapid arg changes — latest wins, previous aborted), A7 (refreshError set when refresh fails), A8 (previous cleared after current resolves). [ref: ../02-design/06-testcases.md#5]
  - Edge case tests: E4 (concurrent invalidations on same args), E5 (rapid re-queries — 5 arg changes, only last completes). [ref: ../02-design/06-testcases.md#11]
  - Use controllable queryFn promises.
  - Use real `Signal.state`, `Signal.compute` — verify `state$` reactive subscription works (reading `state$()` inside another `Signal.compute` triggers re-evaluation).
  - Test SWR: verify that during loading, `state$()` returns `{ data: previousData, isLoading: true, isInitialLoading: false }`.
- **Complexity**: Medium

## Verification

- [ ] `npm run ts-check` passes
- [ ] All 8 Agent test cases (A1–A8) pass
- [ ] Edge cases E4, E5 pass
- [ ] SWR behavior: previous data shown while current is loading
- [ ] `isInitialLoading` correctly distinguishes first load from arg-change load
- [ ] `start(SKIP)` is a no-op — no fetch triggered, state preserved
- [ ] Latest-wins: rapid arg changes result in only the last args' fetch completing
- [ ] `refreshError` populated on background refresh failure, cleared on next success
- [ ] `state$` is reactive — `Signal.compute` depending on it re-evaluates on machine changes
- [ ] No imports from `src/query/`
