---
title: "Verification: Phase 5"
date: 2026-03-25
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check (src/query-v2/) | PASS | `npm run ts-check` exits with code 1, but all 90+ errors are in `src/query-v2-legacy/` only. Zero errors in `src/query-v2/`. |
| ResourceV2 tests (RE01–RE16, RE18–RE23) | PASS | 27 tests passed. All expected test IDs present and passing. |
| GC lifecycle tests (GC01–GC05) | PASS | Included in the 27 ResourceV2 tests above. All 5 GC tests pass. |
| ResourceV2Agent tests (AG01–AG18) | PASS | 18 tests passed. All expected test IDs present and passing. |
| Snapshot tests (SN01–SN12) | PASS | 12 tests passed. All expected test IDs present and passing. SN05, SN08, SN11, SN12 are documented as API-layer concerns with placeholder assertions. |
| Core barrel exports (no hydrateSnapshot) | FAIL | `src/query-v2/core/index.ts` line 27 exports `hydrateSnapshot`: `export { getSnapshot, hydrateSnapshot } from "./Snapshot";`. Plan requires hydrateSnapshot to NOT be exported from core barrel (it is internal, takes `Map<string, ResourceV2>` — the public version taking `IApi` will be added in Phase 6 at the api layer). |
| No upward imports (core/ → api/react/plugins/) | PASS | grep for `from.*(?:api/\|react/\|plugins/)` in `src/query-v2/core/**` returned zero matches. |

## Summary

6/7 checks passed.

**Failure**: Core barrel `src/query-v2/core/index.ts` exports `hydrateSnapshot` which should be internal-only per the plan (Task 5.5 / Task 5.9: "Do NOT export core-layer `hydrateSnapshot`"). The fix is to remove `hydrateSnapshot` from line 27 of `src/query-v2/core/index.ts`.
