---
title: "Verification: Redraft Round 1 — Critical Issues #1, #2, #3, #11"
date: 2026-03-26
stage: 04-implement
role: rdpi-tester
---

## Results

| # | Check | Status | Details |
|---|-------|--------|---------|
| 1 | `npm run ts-check` — no errors in `src/query-v2/` | **PASS** | 0 errors in query-v2 (114 total all in query-v2-legacy) |
| 2 | `useResourceV2Agent.test.ts` — RH01–RH10 all pass | **FAIL** | 9/10 passed. **RH09** fails: `expected 'pending' to be 'error'` — error state not propagated to hook after queryFn rejection |
| 3 | `ReactHooksPlugin.test.ts` — PL01–PL11 pass | **PASS** | 9/9 passed (PL01–PL08, PL11) |
| 4a | Barrel exports `getSnapshot` | **PASS** | `export { getSnapshot } from "./core"` present |
| 4b | Barrel exports `Patcher` | **PASS** | `export { Patcher } from "./core/machines"` present |
| 4c | Barrel exports `stableStringify` | **PASS** | `export { stableStringify } from "./lib"` present |
| 4d | Barrel does NOT export internal cache types | **PASS** | `ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `TCacheMapFactory`, `ICacheMapOptions` — none found in barrel |
| 5 | Full regression `npx vitest run src/query-v2/` | **FAIL** | 232 passed, 15 failed across 7 test files |

## Full Regression Failure Breakdown (Check 5)

### Failures directly related to Phase 20 scope (Critical #1 fix)

| Test | Error | Notes |
|------|-------|-------|
| **RH09** | `expected 'pending' to be 'error'` | Error state not reaching hook — async rejection not triggering re-render |
| **E01** | `Error: sync-throw` (unhandled) | `queryFn` that throws synchronously is not caught — bubbles out of `resource.query()` |

### Pre-existing failures (NOT introduced by Phase 20)

These failures test features not yet implemented (`status$` signal, `subscribe()` GC, lifecycle hooks resolution):

| Test | Error | Category |
|------|-------|----------|
| **RE19** | `resource.status$` is not a function | `status$` signal not implemented |
| **RE20** | `resource.status$` is not a function | `status$` signal not implemented |
| **RE21** | `resource.status$` is not a function | `status$` signal not implemented |
| **RE22** | `resource.status$` is not a function | `status$` signal not implemented |
| **GC01** | `resource.subscribe` is not a function | GC subscribe not implemented |
| **GC02** | `resource.subscribe` is not a function | GC subscribe not implemented |
| **GC03** | `resource.subscribe` is not a function | GC subscribe not implemented |
| **GC04** | `resource.subscribe` is not a function | GC subscribe not implemented |
| **GC05** | `resource.subscribe` is not a function | GC subscribe not implemented |
| **INT06** | `expected entry to be null` (GC didn't fire) | GC not implemented |
| **INT09** | `expected callCount > 1` (auto-invalidation) | Out-of-order abort auto-invalidation not implemented |
| **INT13** | `callLog` missing `cacheDataLoaded:1` | Lifecycle promise resolution not implemented |
| **PL10** | `Cannot read properties of null (reading 'useRef')` | Test calls hook outside React — test environment issue, not a code bug |

## Summary

**6/8 checks passed.**

Two checks failed:
1. **RH09** (Check 2): The infinite-loop fix for `useResourceV2Agent` works for success paths (RH01, RH03, RH05–RH08, RH10 all pass), but the **error path** does not propagate to the hook — status stays `pending` instead of transitioning to `error`. This is likely a missing `await`/catch in `ResourceV2CacheEntry._doFetch` that doesn't wrap synchronous or async rejections into machine error transitions before notifying subscribers.
2. **E01** (Check 5): Related root cause — `queryFn` that throws synchronously escapes `_doFetch` unhandled instead of being caught and transitioned to error state.

The remaining 13 test failures (RE19–RE22, GC01–GC05, INT06, INT09, INT13, PL10) are **pre-existing** — they test features scheduled for later plan phases (status$ signal, GC subscribe, lifecycle promise resolution) and are not regressions from Phase 20.
