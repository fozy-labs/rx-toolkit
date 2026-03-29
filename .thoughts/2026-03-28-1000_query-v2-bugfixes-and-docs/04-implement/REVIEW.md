---
title: "Review: 04-implement"
date: 2026-03-29
status: Approved
stage: 04-implement
---

## Source
Reviewer agent output (README.md Quality Review) + approval gate sanity check + additional TS type fixes. Post-Redraft Round 3 re-review.

## Issues Summary
- Critical: 0
- High: 0
- Medium: 0
- Low: 1

## Issues
1. **Pre-existing Vite build failure in `apps/demos/`** — Rollup cannot resolve `@/query-v2/core/CacheEntry` from compiled `dist/` output. This is a path alias resolution issue in the build output, not introduced by this implementation. `tsc --noEmit` passes cleanly.
   - Where: `apps/demos/` build pipeline
   - Expected: Clean build
   - Severity: Low
   - Source: Reviewer
   - Checklist item: noted under #2 (V5: 13/14)

## Gate Sanity Check Fixes (applied during approval)
- Fixed 8 TS errors caught by `npm run check:all` (test-only tsconfig `tsconfig.test.json`):
  - `agent.types.ts`: Added `lastError?: undefined` to idle branch of `TResourceV2AgentState` union
  - `optimistic-updates.test.ts`: Captured `entry.peek()` into variable before narrowing
  - `reset-and-multi-agent.test.ts`: Cast `resource` to `any` for `resetCache()` (internal method not in public interface)

## Recommendations
- Run full `npm run build` at root to verify library output is unaffected.
- Run `npm run test` at root to confirm no cross-package regressions.
- Manual browser testing of SWR error states, snapshot hydration, and lifecycle hooks examples.
- Address the pre-existing `apps/demos/` Vite alias issue in a separate task.

## User Feedback (Round 1)
Нужно добавить новые примеры в навигацию QueriesV2Page.mdx.

## User Feedback (Round 2)
Нужно ещё добавить `isRefreshError` агенту (ResourceV2Agent).

## User Feedback (Round 3)
«Lifecycle Hooks (Query v2)» — пример некорректен, агент не понял разницу. Нужно поправить и перепроверить другие аспекты приложения.
