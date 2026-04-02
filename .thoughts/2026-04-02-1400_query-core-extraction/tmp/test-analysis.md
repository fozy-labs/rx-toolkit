---
title: "Query Module Test Structure — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module has a well-organized, behavior-based test suite spread across `src/query/__tests__/` (Command-focused), `src/query/core/__tests__/` (CacheEntry base), and `src/query/core/resource/__tests__/` (Resource-focused). Tests directly instantiate internal classes (`CommandCacheEntry`, `ResourceCacheEntry`, `CacheEntry`) but verify observable behavior, not internal structure. Integration tests in `src/query/__tests__/integration/` cover cross-cutting concerns.

## Test File Inventory

### `src/query/__tests__/` — Command tests

| File | Tests | Focus |
|------|-------|-------|
| `command-machine.test.ts` | T01–T08b (11) | State machine transitions (idle→loading→success/error). Pure behavior. |
| `command-cache-entry.test.ts` | T30–T40 + extras (18) | Entry lifecycle: initiate, abort, settlement, hooks, link invalidation. Behavior. |
| `command-agent.test.ts` | T20–T26 + extras (10) | Agent interface: trigger/reset, state$, concurrent abort. Behavior. |
| `command-api.test.ts` | 10 tests | Factory API: `_createCommand`, `createApi().createCommand`, plugin augmentation, resetAll. |
| `command-integration.test.ts` | INT-C01–INT-C12, RH01–RH04+ (20+) | Cross-layer: Command+Resource invalidation, optimistic updates, plugins, React hooks. |
| `command-edge-cases.test.ts` | EC-1–EC-9 (18) | Stale settlement, link edge cases, unmount behavior, resetCache during inflight. |
| `resource-ref.test.ts` | T50–T53 (5) | `ResourceRef` delegation to resource/entry. |
| `edge-cases.test.ts` | E01–E10 (14) | General Resource edge cases: sync throw, null data, hydration, abort, patches. |

### `src/query/__tests__/integration/` — Integration tests

| File | Tests | Focus |
|------|-------|-------|
| `query-flow.test.ts` | INT01–INT02, INT12, T11, T17 | Full Resource pipeline, React hook lifecycle, SWR. |
| `cachemap-lifecycle-integration.test.ts` | IT01–IT08 (8) | CacheMap strategies, lifecycle hooks firing order, devtools key, snapshot. |
| `gc-lifecycle.test.ts` | INT05–INT06, T25 | GC timer, entry removal, $cacheDataLoaded rejection. |
| `memory-leaks.test.ts` | ML01–ML07 (7) | Subscription cleanup, mount/unmount cycles, SKIP handling. |
| `optimistic-updates.test.ts` | INT07–INT09, T21, T30 | Patch commit/abort, consistency violation, lastError. |
| `plugins-and-snapshot.test.ts` | INT03–INT04, INT13–INT14, T05 | React plugin, SSR snapshot, lifecycle hook ordering. |
| `reset-and-multi-agent.test.ts` | INT10–INT11, T24 | resetAll, shared cache across agents, $cacheDataLoaded rejection on reset. |

### `src/query/core/__tests__/` — Base CacheEntry

| File | Tests | Focus |
|------|-------|-------|
| `CacheEntry.test.ts` | CE01–CE10 (11) | Signal wrapping, set/peek, complete(), onClean$, idempotent complete, keyParts. Pure behavior on base class. |

### `src/query/core/resource/__tests__/` — Resource internals

| File | Tests | Focus |
|------|-------|-------|
| `ResourceCacheEntry.test.ts` | RCE01–RCE15, T01–T10, LH10–LH33 (57) | Machine state, patch, invalidate, query, dedup, lifecycle hooks (onCacheEntryAdded, onQueryStarted, $queryFulfilled, $cacheDataLoaded, $cacheEntryRemoved), hydration lifecycle. |
| `ResourceAgent.test.ts` | AG01–AG20 (20+) | Agent behavior: start, state$, SWR, isInitialLoading, same-args dedup, resetCache recovery. |
| `Resource.test.ts` | RE01–RE20 (20+) | Resource facade: query, dedup, getEntry, invalidate, resetCache, hydrate, _status$. |

### `src/__tests__/` — Root-level

| File | Focus |
|------|-------|
| `setup.ts` | Test environment setup. |
| `integration/root-exports.test.ts` | Public API export surface validation. |
| `integration/common-exports.test.ts` | Common module exports. |
| `helpers/async-helpers.ts` | `flushMicrotasks` utility. |
| `helpers/singleton-reset.ts` | Singleton reset helper. |

## Analysis by Question

### Q1: Command tests — behavior or class structure?

**Behavior-based.** All Command tests verify observable outcomes:
- `@/src/query/__tests__/command-machine.test.ts` — tests state transitions via `.start()`, `.successHappened()`, `.errorHappened()`, verifies returned state objects.
- `@/src/query/__tests__/command-cache-entry.test.ts` — instantiates `CommandCacheEntry` directly, but tests `peek().status`, `initiate()` behavior, abort signal lifecycle, hook callbacks. No assertions on internal fields.
- `@/src/query/__tests__/command-agent.test.ts` — tests `trigger()`, `reset()`, `state$` reactivity. Black-box agent interface.
- `@/src/query/__tests__/command-integration.test.ts` — end-to-end flows through public API (`createApi`, `createCommand`).

### Q2: Resource tests — behavior or class structure?

**Behavior-based.** Same pattern:
- `@/src/query/core/resource/__tests__/ResourceCacheEntry.test.ts` — instantiates `ResourceCacheEntry` directly, tests `query()`, `invalidate()`, `createPatch()`, lifecycle hooks. All via public methods.
- `@/src/query/core/resource/__tests__/ResourceAgent.test.ts` — tests `start()`, `state$`, SWR behavior.
- `@/src/query/core/resource/__tests__/Resource.test.ts` — tests facade: `query()`, `getEntry()`, `invalidate()`, `resetCache()`.

### Q3: CacheEntry base class tests?

**Yes.** `@/src/query/core/__tests__/CacheEntry.test.ts` has 11 tests (CE01–CE10) covering:
- Signal wrapping (`state$()`, `peek()`, `set()`)
- `complete()` + `onClean$` firing
- Idempotent complete
- `keyParts` passthrough
- `beforeDevtoolsPush` callback

These test the base class in isolation. Extraction of `CacheEntry` would need these tests to remain valid.

### Q4: Test coverage of duplicated code areas

| Duplicated area | Command test coverage | Resource test coverage |
|---|---|---|
| **Abort (AbortController)** | T34 (re-initiate aborts prev), T40 (stale settlement ignored), EC-1/EC-2 (stale settle), EC-4 (unmount doesn't abort), EC-5 (resetCache aborts) | RCE15 (complete aborts), T10 (refetch rejects old), LH18/LH18b (refetch abort chain) |
| **Lifecycle hooks: onQueryStarted** | T35/T35b ($queryFulfilled resolve/reject), INT-C lifecycle hooks | T07, T08/T09, LH15–LH18 ($queryFulfilled), LH19 (getCacheEntry), LH23 (error caught) |
| **Lifecycle hooks: onCacheEntryAdded** | T36/T36b ($cacheDataLoaded, $cacheEntryRemoved) | LH10–LH14 ($cacheDataLoaded, $cacheEntryRemoved), LH22 (error caught), LH25 (absent hook) |
| **_fireCacheEntryAdded** | Tested implicitly through T36 family (command-cache-entry.test.ts) | Tested through LH10–LH14, LH22, LH25 (ResourceCacheEntry.test.ts) |

All duplicated areas have independent test coverage in both Command and Resource test suites.

### Q5: Would extraction break existing tests?

**Low risk.** Tests are behavior-based and call public methods. Specific risks:

1. **Import paths change** — Tests import directly from internal paths (`@/query/core/command/CommandCacheEntry`, `@/query/core/resource/ResourceCacheEntry`, `@/query/core/CacheEntry`). If classes move, import paths must be updated. This is mechanical.

2. **Constructor signatures** — `CommandCacheEntry` and `ResourceCacheEntry` tests instantiate directly with option objects. If extraction changes constructor API (e.g., requiring base-class config objects), these test constructors need updating.

3. **No tests rely on class hierarchy** — No `instanceof` checks in tests. No tests assert inheritance chain. Extraction from duplication to shared base or composition would not break behavior assertions.

4. **CacheEntry base tests remain independent** — CE01–CE10 test `CacheEntry` directly and are unaffected by Command/Resource refactoring.

5. **Integration tests use only public API** — `createApi`, `createResource`, `createCommand`. These are insulated from internal restructuring.

## Code References

- `@/src/query/__tests__/command-machine.test.ts:9` — Command Machine describe block
- `@/src/query/__tests__/command-cache-entry.test.ts:62` — CommandCacheEntry describe block
- `@/src/query/__tests__/command-cache-entry.test.ts:4` — imports `CommandCacheEntry` directly
- `@/src/query/__tests__/command-cache-entry.test.ts:122` — T34: abort coverage
- `@/src/query/__tests__/command-cache-entry.test.ts:136` — T35: onQueryStarted coverage
- `@/src/query/__tests__/command-cache-entry.test.ts:158` — T36: onCacheEntryAdded coverage
- `@/src/query/__tests__/command-agent.test.ts:41` — CommandAgent describe block
- `@/src/query/__tests__/command-api.test.ts:16` — _createCommand factory tests
- `@/src/query/__tests__/command-integration.test.ts:58` — Command+Resource integration
- `@/src/query/__tests__/command-integration.test.ts:409` — Command lifecycle hooks integration
- `@/src/query/__tests__/command-edge-cases.test.ts:62` — Edge case: stale settlement
- `@/src/query/__tests__/resource-ref.test.ts:30` — ResourceRef delegation
- `@/src/query/__tests__/edge-cases.test.ts:20` — General edge cases
- `@/src/query/core/__tests__/CacheEntry.test.ts:6` — CacheEntry base class tests
- `@/src/query/core/resource/__tests__/ResourceCacheEntry.test.ts:23` — ResourceCacheEntry describe
- `@/src/query/core/resource/__tests__/ResourceCacheEntry.test.ts:534` — Per-entry lifecycle describe
- `@/src/query/core/resource/__tests__/ResourceCacheEntry.test.ts:1063` — Hydration lifecycle describe
- `@/src/query/core/resource/__tests__/ResourceAgent.test.ts:22` — ResourceAgent describe
- `@/src/query/core/resource/__tests__/Resource.test.ts:23` — Resource facade describe
- `@/src/query/__tests__/integration/cachemap-lifecycle-integration.test.ts:103` — IT03: lifecycle hook ordering
- `@/src/query/__tests__/integration/gc-lifecycle.test.ts:12` — GC lifecycle
- `@/src/query/__tests__/integration/memory-leaks.test.ts:12` — Memory leak suite
- `@/src/query/__tests__/integration/optimistic-updates.test.ts:19` — Optimistic updates integration
