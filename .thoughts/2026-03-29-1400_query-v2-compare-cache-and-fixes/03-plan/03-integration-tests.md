---
title: "Phase 3: Integration Tests"
date: 2026-03-30
stage: 03-plan
role: rdpi-planner
---

## Goal

Verify cross-component flows end-to-end: resource creation → cache access → devtools key in Signal → lifecycle hooks firing → Snapshot consumer migration → createApi stale check. These tests exercise the full stack after both Area A and Area B changes are applied and confirm that all components integrate correctly.

## Dependencies

- **Requires**: Phase 1 (CacheMap + Factory + Consumer Migration), Phase 2 (LifecycleHooks → Per-Entry)
- **Blocks**: None

## Execution

Sequential after Phase 2. Parallel with Phase 4.

## Tasks

### Task 3.1: Write integration tests (IT01–IT08)

- **File**: `src/query-v2/__tests__/integration/cachemap-lifecycle-integration.test.ts`
- **Action**: Create
- **Description**: Implement all integration test cases from the test strategy [ref: ../02-design/06-testcases.md §Integration]:

  **CacheMap + Devtools key integration**:
  - IT01: Compare-strategy resource → entry creation → monotonic devtools key → Signal key contains `"Resource/:users/:0"`. Verify `entry.argsKey === "0"`. Confirm zero `stableStringify` calls (spy) during compare strategy flow [ref: ../02-design/05-usecases.md UC1; R1 mitigation].
  - IT02: Serialize-strategy resource → entry creation → serialized devtools key → Signal key contains `'Resource/:items/:{"id":1}'`. Verify `entry.argsKey === '{"id":1}'` and `serializeArgs` called exactly once [ref: ../02-design/05-usecases.md UC3].
  - IT08: Custom `devtoolsKey` function flows from resource options → `CompareCacheMap` → Signal key uses custom value [ref: ../02-design/05-usecases.md UC2].

  **Lifecycle integration**:
  - IT03: Resource with `onCacheEntryAdded` + `onQueryStarted` → `getEntry(args, true)` → both callbacks invoked, `$queryFulfilled` settles after queryFn [ref: ../02-design/02-dataflow.md §2.1].
  - IT04: Resource with 3 entries + lifecycle hooks → `resetCache()` → all `$cacheEntryRemoved` resolved, all pending `$queryFulfilled` rejected, cache empty [ref: ../02-design/02-dataflow.md §2.2; R3 mitigation].

  **Consumer migration**:
  - IT05: Serialize-strategy resource with 2+ entries → `Snapshot.getSnapshot(resources)` → snapshot entries keyed by serialized args strings, accessed via `cacheValues()` + `entry.argsKey` [ref: ../02-design/04-decisions.md ADR-6; R6 mitigation].
  - IT06: `createApi` with resources → exercise stale check path → no error, entries iterated via `cacheValues()` [ref: ../02-design/04-decisions.md ADR-6; R7 mitigation].
  - IT07: `entry.argsKey` is accessible on `IResourceV2CacheEntry` typed interface → string value matches devtools key [ref: ../02-design/03-model.md §2.2].

- **Details**:
  - Tests use `_createResourceV2` (or `createApi` + `api.createResourceV2`) with real `createCacheMap` — no mocks for CacheMap or lifecycle internals. Mock only `queryFn`.
  - IT01 should spy on `stableStringify` to confirm zero calls for compare strategy (problem #3 fix verification).
  - IT02 should spy on the `serializeArgs` function to confirm exactly 1 call per new entry (problem #4 fix verification).
  - IT04 is the key `resetCache` integration test — creates entries with lifecycle hooks, calls `resetCache()`, verifies all promises are settled and cache is empty.
  - IT05 may need to verify that compare-strategy Snapshot handling (throw or guard) still works correctly after the guard logic change in Phase 1 Task 1.7.

## Verification

- [ ] `npm run ts-check` passes
- [ ] All IT01–IT08 tests pass
- [ ] IT01 confirms zero serialization calls for compare strategy (problem #3)
- [ ] IT02 confirms single serialization call for serialize strategy (problem #4)
- [ ] IT04 confirms `resetCache()` settles all lifecycle resolvers
- [ ] IT05 confirms Snapshot works with `cacheValues()` + `entry.argsKey`
- [ ] Full `vitest` suite passes (regression check)
