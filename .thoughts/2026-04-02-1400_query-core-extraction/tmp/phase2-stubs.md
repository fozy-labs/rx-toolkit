---
title: "Phase 2 Stubs in Command Machines — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

All four Command machine classes carry `/** Stub — full implementation in Phase 2 */` comments, yet they are already functionally complete for the current Command use case. The "stub" label means they lack parity with Resource machines (no `MachineWithData` inheritance, no `Patcher` integration, no `invalidate`/`retry`/`refreshing`/`fromSnapshot`/SSR hydration). No 3rd entity type is mentioned anywhere in source, docs, or changelog.

## Findings

### 1. Files with "Phase 2" comments

Exactly four files, all in `@/query/core/machines/`:

- **`CommandIdle.ts:5`** — `/** Stub — full implementation in Phase 2 */`
- **`CommandLoading.ts:6`** — same comment
- **`CommandSuccess.ts:6`** — same comment
- **`CommandError.ts:5`** — same comment

No other file in the entire `src/` tree contains "Phase 2", "stub", "TODO", "FIXME", "future", or "planned".

### 2. What the stubs ARE vs what's MISSING

**What exists (functional):**
- `CommandIdle` → `start(args)` → `CommandLoading`
- `CommandLoading` → `successHappened(data)` / `errorHappened(error)`
- `CommandSuccess` → `start(args)` (re-trigger); has `patchState` field
- `CommandError` → `start(args)` (retry)
- All expose `.state` getter returning typed state objects
- `CommandCacheEntry` uses these machines to drive full lifecycle: abort, optimistic updates, `commandLink` invalidation/update, `onCacheEntryAdded`, `onQueryStarted`

**What's missing vs Resource machines:**
- No `MachineWithData` base class — `CommandSuccess` does NOT support `createPatch()` / `finishPatch()` / `abortAllPendingPatches()` directly; patching is only done via `ResourceRef.patch()` on linked resources
- No `Refreshing` state — Commands are one-shot, no staleness / background refresh concept
- No `updatedAt` timestamp on any Command machine
- No `retry()` method on `CommandError` (only `start(args)`)
- No `invalidate()` on Command machines (invalidation goes through `ResourceRef` to linked resources)
- No `fromSnapshot()` / SSR hydration support (Resource has `Machine.fromSnapshot()` and `Resource.hydrateEntry()`)
- No `lastError` field on success (Resource's `MachineSuccess` preserves `lastError` from failed refreshes)
- No `cloneWith()` method (Resource machines use it for immutable patch transitions)

### 3. Is "Phase 2" done or pending?

- The code is **functionally complete** for the current Command semantics (trigger → loading → success/error)
- The comment likely refers to bringing Command machines to **structural parity** with Resource machines (shared base, patch support, SSR, etc.) — which has NOT happened
- `CommandSuccess.patchState` field exists but is set to `null` from constructor and never populated through machine transitions — only `ResourceRef.patch()` patches linked *Resource* entries, not the Command itself
- No follow-up commit, PR, or changelog entry mentions Phase 2 completion

### 4. Third entity type — no evidence

- **Source code**: No `InfiniteQuery`, `Subscription`, `StreamResource`, or similar entity class anywhere in `src/`
- **CHANGELOG.md**: Mentions only `Resource` and `Command` (formerly `Operation`). No roadmap section.
- **docs/**: No mention of "future", "planned", "roadmap", or "upcoming" features
- **Only references** to 3rd entity types are in `.thoughts/` research files (this extraction analysis itself), referencing RTK Query's `ENDPOINT_INFINITEQUERY` and hypothetical extensibility scenarios

### 5. Resource stubs / TODOs

- **Zero** TODO/FIXME/stub/Phase comments in `src/query/core/resource/`
- Resource implementation appears complete: full machine lifecycle, SSR hydration, Patcher integration, invalidation, retry, refreshing state, lifecycle hooks

## Code References

- `@/query/core/machines/CommandIdle.ts:5` — Phase 2 stub comment
- `@/query/core/machines/CommandLoading.ts:6` — Phase 2 stub comment
- `@/query/core/machines/CommandSuccess.ts:6` — Phase 2 stub comment; has `patchState` field at line 13
- `@/query/core/machines/CommandError.ts:5` — Phase 2 stub comment
- `@/query/core/machines/MachineWithData.ts:11-22` — abstract base that Command machines do NOT extend
- `@/query/core/machines/MachineSuccess.ts:13` — extends `MachineWithData`, has `cloneWith`, `invalidate`, `lastError`
- `@/query/core/machines/MachineRefreshing.ts:13` — extends `MachineWithData`, no Command equivalent
- `@/query/core/machines/Machine.ts:20` — `fromSnapshot()` factory, Command has no equivalent
- `@/query/core/command/CommandCacheEntry.ts:51-295` — full Command lifecycle, functional despite stub machines
- `@/query/core/command/ResourceRef.ts:1-26` — patches go to Resource entries, not Command
- `@/query/core/resource/Resource.ts:127` — `hydrateEntry()`, no Command equivalent
- `@/query/core/resource/ResourceCacheEntry.ts:109` — `invalidate()`, no Command equivalent
- `@/query/types/command-machine.types.ts:1-49` — Command machine types, no `refreshing` status

## Impact on Extraction Decision

- **Phase 2 is NOT completed** — Command machines are structurally simpler than Resource machines
- **Extracting shared infrastructure NOW means** either (a) the shared base must accommodate both current-simple and future-complex shapes, or (b) Phase 2 expansion will need to refactor the shared base
- **No 3rd entity is planned** — extraction justification based on "N entity types" is speculative
- **Current asymmetry is intentional** — Commands are one-shot mutations; many Resource features (refresh, staleness, SSR) are semantically irrelevant for Commands
