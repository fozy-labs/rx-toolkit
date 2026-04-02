---
title: "Duplication Analysis — ResourceCacheEntry vs CommandCacheEntry"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

57 lines of literally identical code exist across `ResourceCacheEntry` (296 LOC) and `CommandCacheEntry` (249 LOC). The duplication is **fragmented** — spread across 6 pattern categories with no contiguous block exceeding 13 lines. Most blocks are 3–5 line `PromiseResolver` guard-resolve/reject-null sequences.

## Duplication Inventory

| # | Pattern | Resource Location | Command Location | Lines | Class |
|---|---------|-------------------|------------------|------:|-------|
| 1 | `_abortController` field decl | `:48` | `:30` | 1 | IDENTICAL |
| 2 | `_entryRemoved` field decl | `:54` | `:34` | 1 | IDENTICAL |
| 3 | Abort teardown in `complete()` | `:146–149` | `:225–228` | 4 | IDENTICAL |
| 4 | `_entryDataLoaded` reject in `complete()` | `:154–157` | `:235–238` | 4 | IDENTICAL |
| 5 | `_entryRemoved` resolve in `complete()` | `:158–161` | `:239–242` | 4 | IDENTICAL |
| 6 | `_queryFulfilled` reject in `complete()` | `:162–165` | `:243–246` | 4 | IDENTICAL |
| 7 | `super.complete()` call | `:168` | `:248` | 1 | IDENTICAL |
| 8 | `_fireCacheEntryAdded` signature+guard+resolvers+tools+try/catch | `:171–186` | `:250–265` | 8 | IDENTICAL |
| 9 | `_queryFulfilled` reject "superseded" | `:203–206` | `:97–100` | 4 | IDENTICAL |
| 10 | `_onQueryStarted` guard+prop+try/catch | `:209–221` | `:103–115` | 5 | IDENTICAL |
| 11 | Abort prev controller | `:193–195` | `:56–58` | 3 | IDENTICAL |
| 12 | Create new AbortController | `:200–201` | `:67–68` | 2 | IDENTICAL |
| 13 | `_entryDataLoaded` resolve on success | `:272–275` | `:159–162` | 4 | IDENTICAL |
| 14 | `_queryFulfilled` resolve on success | `:278–281` | `:165–168` | 4 | IDENTICAL |
| 15 | `_queryFulfilled` reject on error | `:316–319` | `:186–189` | 4 | IDENTICAL |
| 16 | `_queryFulfilled` reject on sync error | `:231–234` | `:130–133` | 4 | IDENTICAL |
| | | | **Total IDENTICAL** | **57** | |
| 17 | 4 field decls (type param differs) | `:51–53,55` | `:31–33,35` | 4 | SIMILAR |
| 18 | `_entryDataLoaded` creation | `:174` | `:253` | 1 | SIMILAR |
| 19 | `_queryFulfilled` creation | `:210` | `:104` | 1 | SIMILAR |
| | | | **Total SIMILAR** | **6** | |

## What Is NOT Duplication

Code often miscounted as shared but exclusive to one side:

| Code | Owner | Lines | Why it's unique |
|------|-------|------:|-----------------|
| Hydration check in `_fireCacheEntryAdded` | Resource `:188–193` | 6 | Command has no SSR hydration; no counterpart exists |
| `_inflightPromise = null` in `complete()` | Resource `:150` | 1 | Command uses `_triggerResolver` instead |
| `_patchState = null` in `complete()` | Resource `:151` | 1 | Command patches linked Resources, not self |
| `_triggerResolver` reject in `complete()` | Command `:230–233` | 4 | Resource deduplicates via `_inflightPromise` |
| `getCacheEntry` in onQueryStarted tools | Resource `:214` | 1 | Command tools object has no equivalent property |
| Stale check mechanism | Both | — | DIFFERENT: identity (`!== controller`) vs signal (`.aborted`) |

## Extractability Assessment

| Metric | Value |
|--------|-------|
| Total identical lines | 57 |
| Largest contiguous block | **13 lines** — resolver chain in `complete()` (patterns #4–7) |
| Blocks ≤ 5 lines | 12 of 16 patterns |
| Blocks of exactly 4 lines | 9 patterns (all `PromiseResolver` guard-action-null) |
| Percentage of combined LOC (545) | 10.5% |

**Fragmentation profile**: the 57 lines break into **16 discrete blocks** averaging 3.6 lines each. Only `complete()` cleanup offers a coherent 13-line extraction target. The remaining 44 lines are scattered across `_fireCacheEntryAdded`, `_onQueryStarted`, abort setup, and 4 separate success/error handlers.

**Practical implication**: a shared base class or mixin must expose ~6 small protected helpers to cover these fragments. The per-helper savings is 3–5 lines, making the abstraction cost (new class/mixin + wiring) comparable to the duplication cost.

## Parallel Lifecycle Visualization

```
ResourceCacheEntry._doFetch()              CommandCacheEntry.initiate()
═══════════════════════════                ═══════════════════════════
│                                          │
├─ abort prev controller ──────────────── ├─ abort prev controller        [3 lines identical]
├─ _inflightPromise?.catch ← UNIQUE       ├─ reject _triggerResolver ← UNIQUE
├─ create new AbortController ─────────── ├─ create new AbortController   [2 lines identical]
│                                          │
├─ reject _queryFulfilled "superseded" ── ├─ reject _queryFulfilled       [4 lines identical]
├─ fire _onQueryStarted ─────────────────  ├─ fire _onQueryStarted        [5 lines identical]
│  └─ tools: {$queryFulfilled,             │  └─ tools: {$queryFulfilled}
│             getCacheEntry} ← UNIQUE      │
│                                          ├─ machine → Loading ← UNIQUE (inline)
│                                          ├─ apply optimistic patches ← UNIQUE (linked Resources)
│                                          │
├─ await queryFn(args, {abortSignal}) ──── ├─ await queryFn(args, {abortSignal})
│                                          │
│  ┌─ ON SUCCESS ─────────────────────┐    │  ┌─ ON SUCCESS ─────────────────────┐
│  │ stale check: ctrl !== this._ac   │    │  │ stale check: signal.aborted      │  ← DIFFERENT
│  │ resolve _entryDataLoaded ───────────── │ resolve _entryDataLoaded           │  [4 lines identical]
│  │ resolve _queryFulfilled ───────────── │ resolve _queryFulfilled            │  [4 lines identical]
│  │ machine → Success                │    │  │ machine → CommandSuccess          │
│  │ _updateMachineData ← UNIQUE      │    │  │ update linked Resources ← UNIQUE │
│  └──────────────────────────────────┘    │  └──────────────────────────────────┘
│                                          │
│  ┌─ ON ERROR ───────────────────────┐    │  ┌─ ON ERROR ───────────────────────┐
│  │ stale check: ctrl !== this._ac   │    │  │ stale check: signal.aborted      │  ← DIFFERENT
│  │ reject _queryFulfilled ─────────────── │ reject _queryFulfilled            │  [4 lines identical]
│  │ machine → Error / Success+err    │    │  │ machine → CommandError            │
│  └──────────────────────────────────┘    │  │ revert optimistic patches ← UNIQUE│
                                           │  └──────────────────────────────────┘

complete() — called on cache eviction
═══════════════════════════════════════
├─ abort controller ──────────────────── ├─ abort controller               [4 lines identical]
├─ _inflightPromise = null ← UNIQUE      ├─ reject _triggerResolver ← UNIQUE
├─ _patchState = null      ← UNIQUE      │
├─ reject _entryDataLoaded ────────────── ├─ reject _entryDataLoaded       [4 lines identical]
├─ resolve _entryRemoved ─────────────── ├─ resolve _entryRemoved         [4 lines identical]
├─ reject _queryFulfilled ────────────── ├─ reject _queryFulfilled        [4 lines identical]
├─ super.complete() ──────────────────── ├─ super.complete()              [1 line  identical]
```

**Legend**: `────────` = identical code on both sides; `← UNIQUE` = exists only on that side.
