---
title: "Fix: Incomplete sequence diagram in architecture.md"
date: 2026-04-05
stage: analysis
role: rdpi-codebase-researcher
---

## Problem

The "Поток данных" sequence diagram in `docs/query/concepts/architecture.md` only shows the happy path: `useResource → Agent → Resource → CacheMap → CacheEntry → Server → success → UI`. Missing cases:

1. **SKIP path** — Agent receives `SKIP` token → clears tracking → idle, no fetch
2. **Cache hit** — CacheEntry already exists with `success` status → no fetch, immediate data
3. **Error path** — Server returns error → `MachinePending → MachineError`
4. **Refresh/SWR** — `invalidate()` on success entry → `MachineRefreshing` → re-fetch with stale data preserved on error

## Source analysis

### SKIP path (ResourceAgent.ts:49-83)
- `Agent.start(SKIP)` → clears `_tracking$` entirely → derived state = `{ status: "idle" }`
- No entry created, no fetch triggered

### Cache hit (Resource.ts / ResourceCacheEntry.ts:107-131)
- `CacheMap.getOrCreate(args)` returns existing entry
- If entry is in `success` state → `query()` returns `Promise.resolve(data)` without fetch
- Agent's `state$` immediately reflects `{ status: "success", data }`

### Cache miss (ResourceCacheEntry.ts:58-73)
- New `ResourceCacheEntry` created with `MachinePending`
- Constructor auto-calls `_doFetch()` → `queryFn(args, { abortSignal })`
- On success: `successHappened(data)` → `MachineSuccess`
- On error: `errorHappened(error)` → `MachineError`

### Refresh / SWR (ResourceCacheEntry.ts:100-106, MachineRefreshing.ts)
- `invalidate()` works only in `"success"` state → transitions to `MachineRefreshing` → `_doFetch()`
- **Refresh success**: `MachineRefreshing.successHappened(data)` → `MachineSuccess(newData)`
- **Refresh error**: `MachineRefreshing.errorHappened(error)` → `MachineSuccess(staleData, lastError)` — stale data preserved (SWR guarantee)

### Agent SWR fallback (ResourceAgent.ts:100-147)
- When args change, Agent moves current entry to `_previous$` (if it has success/refreshing data)
- While new entry is pending, Agent derives state from previous data as fallback
- Once new entry resolves → `_previous$` cleared

## Diagram design

**Participants** (reduced from 8 to 5 for readability):
- React-компонент, Agent, Resource, CacheEntry, Сервер

**Structure**:
1. Top-level `alt` for SKIP vs new args
2. Nested `alt` for cache hit vs cache miss
3. Nested `alt` for success vs error inside cache miss
4. Separate `rect` block for refresh (invalidation) flow with its own success/error alt
5. `Note` for SWR fallback behavior

**Arrow count**: 23 (within 20–25 limit)
