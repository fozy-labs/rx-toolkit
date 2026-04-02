---
title: "Recommendation"
date: 2026-04-02
stage: 01-research
role: rdpi-researcher
---

# Recommendation

## Primary: Approach D — Utility Functions (Immediate)

Extract two standalone functions: `cleanupLifecycleResolvers()` and `createLifecycleTools()`. This eliminates ~19 of the 44 literally identical lines — the densest, most clearly duplicated blocks — with ~15 lines of new code and **zero structural changes**.

**Why this is the right call:**

- The verified duplication is 44 identical + 16 structurally similar lines across 646 combined lines (~9%). Approaches A–C introduce class hierarchies, protected-field coupling, or composition wiring that rivals or exceeds the duplication they remove.
- Utility functions are the pattern used by TanStack Query (standalone helpers, no shared observer base) and RTK Query (shared `handleNewKey` function for `onCacheEntryAdded`). No library in the comparison matrix solves this with a middle class.
- Zero risk: pure functions, independently testable, no change to `CacheEntry`'s role as a generic reactive container.
- Backward compatibility: guaranteed. No public API changes, no type signature changes, no hierarchy changes.

**Estimated effort:** Minimal — one file, two functions, update two call sites, add unit tests.

## Secondary: Re-evaluate After Phase 2 Completion

All four Command machine classes carry "Phase 2 stub" comments. They are functionally complete for one-shot mutation semantics but structurally diverge from Resource machines (no `MachineWithData`, no refreshing state, no SSR). Extracting shared infrastructure against an unstable target means re-extracting when stubs mature.

**When to revisit:**
- After Command Phase 2 lands and machine structure stabilizes.
- If a concrete 3rd entity type (InfiniteQuery, Subscription) is planned, Approach A (enrich `CacheEntry` with abort + resolver fields) becomes justified.
- If Command machines gain heavy Resource similarity post-Phase 2, re-evaluate Approach B — but only then.

## What NOT to Do

| Anti-pattern | Reason |
|---|---|
| `FetchableCacheEntry` middle class (B) | 3-level hierarchy for 2 consumers of ~44 shared lines. Bug vector: `_abortInflight()` nulls controller, breaking Resource's identity-based stale check. Claims 65 lines saved — impossible given 44 actual identical lines without smuggling non-duplicated code into the base. |
| `FetchEngine` composition (C) | Wiring boilerplate replaces duplication 1:1. Net LOC increases. `resolveDataLoaded(data)` is no simpler than `this._entryDataLoaded.resolve(data)` — indirection without simplification. |
| Unify state machines | Zero libraries do this. The asymmetry is intentional: queries have staleness/refresh/SSR; mutations are one-shot. |

## Decision Matrix

| If... | Then... |
|---|---|
| Goal is DRY only | Approach D now — permanent solution |
| 3rd entity type is planned | Approach D now, Approach A after Phase 2 |
| Command machines mature with heavy Resource similarity | Approach D now, re-evaluate B post-Phase 2 |
| Never a 3rd entity type | Approach D is the permanent solution |

## RTK Query Lesson

RTK Query proves deeper sharing IS viable — a single `executeEndpoint` handles queries, mutations, and infinite queries with ~90% shared code. Its `onQueryStarted` and `onCacheEntryAdded` handlers are fully shared at runtime with type-level divergence only. rx-toolkit's lifecycle API was modelled after RTK Query's.

However, RTK Query has Redux as infrastructure — a single middleware pipeline dispatching through one store. rx-toolkit uses signals and per-instance RxJS streams. The architectural substrate is fundamentally different. **Adopt RTK's lifecycle helper pattern** (shared `handleNewKey`, shared promise setup), **not its monolithic middleware approach**.

## Open Questions for Project Owner

1. **Is a 3rd entity type planned?** (InfiniteQuery, Subscription, StreamResource) — this is the only scenario where Approach A's structural cost is justified.
2. **Should Command Phase 2 bring machine structure closer to Resource?** (`MachineWithData` base, `cloneWith`, refreshing state) — determines whether future extraction surface grows.
3. **Is DRY the primary goal or extensibility?** If DRY: Approach D is sufficient. If extensibility: wait for Phase 2 to reveal stable shared patterns.
