---
title: "Implementation: Query v2 Fixes"
date: 2026-03-18
status: Approved
feature: "7 targeted fixes to the query-v2 module: core split, standalone hooks, devtools isolation, snapshot errors, JSDoc, and documentation"
plan: "../03-plan/README.md"
rdpi-version: b0.2
---

## Status

- Phases completed: 6/6
- Verification: all passed (Phase 1 had 1 failure on initial pass — stale `Snapshot.test.ts` import — fixed before Phase 2; all subsequent phases clean)
- Issues: none

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All plan phases implemented | PASS | 6/6 phases: Core Split (8 tasks), Standalone Hooks (7 tasks), DevTools Isolation (2 tasks), Snapshot Errors (3 tasks), JSDoc (7 tasks), Documentation (2 tasks) — all tasks executed |
| 2 | Verification passed for each phase | PASS | Phase 1: 6/7 initially (stale `Snapshot.test.ts` import, plan omission — fixed on retry; full suite green by Phase 2). Phase 2: 6/6. Phase 3A+3B: 14/14. Phase 4A+4B: 24/24. Final regression: 196/196 tests green. |
| 3 | No files outside plan scope modified | PASS | All changed files are within `src/query-v2/`, `docs/query-v2/`, and the planned scope. `react/__tests__/helpers.ts` is a test utility created as part of Task 2.6 (hook test creation) — within scope. |
| 4 | Code follows project patterns | PASS | `@/` aliases used consistently for cross-module imports. Relative imports for intra-module. Barrel re-exports via `index.ts`. Class naming, file naming, and indentation match existing codebase. |
| 5 | Barrel exports updated correctly | PASS | `core/index.ts` → re-exports from `./common`, `./machines`, `./resource`. `core/common/index.ts`, `core/resource/index.ts`, `react/index.ts` — all correctly export their modules. `query-v2/index.ts` re-exports standalone hooks from `./react`. Public API surface unchanged. |
| 6 | TypeScript strict mode maintained | PASS | `tsc --noEmit` passes in all 4 coder phases. No new `any` introduced (existing `any` in lifecycle hooks and snapshot deserialization is pre-existing). |
| 7 | Documentation proportional to existing docs/demos | PASS | 20 lines added across 2 existing files: 14 lines in `ssr.md` (optimistic snapshot + hydration errors), 6 lines in `api-reference.md` (standalone import note). No new doc files. No demo changes. Proportional to existing `docs/query-v2/` (4 files). |
| 8 | No security vulnerabilities | PASS | Error messages use string interpolation with internal values (snapshot version, keyPrefix). No user-controlled input in error construction. No network, auth, or injection vectors introduced. |

### Documentation Proportionality

Existing `docs/query-v2/` has 4 files: `README.md`, `api-reference.md`, `optimistic-updates.md`, `ssr.md`. `apps/demos/src/examples/query-v2/` has interactive demos.

Additions:
- `ssr.md`: "Оптимистичные обновления и snapshot" subsection (4 bullets) + "Ошибки гидрации" subsection (4 bullets) = 14 lines
- `api-reference.md`: "Standalone-импорт" note with import path and usage example = 6 lines

Total: 20 lines across 2 existing files. No new files, no demo changes. Style matches existing Russian-language section headers and bullet format. Proportional to the feature scope.

### Issues Found

No issues found.

## Change Summary

### New Files

- `src/query-v2/core/common/index.ts` — barrel re-exporting CacheEntry, CacheMap, LifecycleHooks
- `src/query-v2/core/resource/index.ts` — barrel re-exporting ResourceV2, ResourceV2Agent
- `src/query-v2/react/index.ts` — barrel re-exporting standalone hooks
- `src/query-v2/react/useResourceV2Agent.ts` — standalone React hook for agent state (SWR)
- `src/query-v2/react/useResourceV2Ref.ts` — standalone React hook for imperative ref handle
- `src/query-v2/react/__tests__/helpers.ts` — test utilities (controllableQueryFn, createTestResource)
- `src/query-v2/react/__tests__/useResourceV2Agent.test.ts` — 5 tests (T1–T5)
- `src/query-v2/react/__tests__/useResourceV2Ref.test.ts` — 2 tests (T6–T7)

### Moved Files

- `src/query-v2/core/CacheEntry.ts` → `src/query-v2/core/common/CacheEntry.ts`
- `src/query-v2/core/CacheMap.ts` → `src/query-v2/core/common/CacheMap.ts`
- `src/query-v2/core/LifecycleHooks.ts` → `src/query-v2/core/common/LifecycleHooks.ts`
- `src/query-v2/core/ResourceV2.ts` → `src/query-v2/core/resource/ResourceV2.ts`
- `src/query-v2/core/ResourceV2Agent.ts` → `src/query-v2/core/resource/ResourceV2Agent.ts`
- `src/query-v2/core/CacheEntry.test.ts` → `src/query-v2/core/common/CacheEntry.test.ts`
- `src/query-v2/core/CacheMap.test.ts` → `src/query-v2/core/common/CacheMap.test.ts`

### Modified Files

- `src/query-v2/core/index.ts` — replaced 6 individual exports with 3 sub-folder barrel re-exports
- `src/query-v2/index.ts` — added `export { useResourceV2Agent, useResourceV2Ref } from "./react"`
- `src/query-v2/api/createApi.ts` — import path updated to `core/resource/ResourceV2` + JSDoc added
- `src/query-v2/plugins/ReactHooksPlugin.ts` — refactored to thin delegation wrapper + JSDoc + inline comments
- `src/query-v2/snapshot/Snapshot.ts` — import path updated + throw on version/prefix mismatch + console.warn on unknown resource + inline comments + JSDoc
- `src/query-v2/core/common/CacheEntry.ts` — JSDoc on class + 4 methods + inline comment on beforeDevtoolsPush
- `src/query-v2/core/resource/ResourceV2.ts` — JSDoc on class + 5 methods (createAgent, query, query$, entry, resetCache)
- `src/query-v2/core/resource/ResourceV2Agent.ts` — `{ isDisabled: true }` on 3 signals + JSDoc on class + state$ + start() + inline comments
- `src/query-v2/core/__tests__/ResourceV2.test.ts` — import path updated
- `src/query-v2/core/__tests__/ResourceV2Agent.test.ts` — import path updated
- `src/query-v2/core/__tests__/LifecycleHooks.test.ts` — import path updated
- `src/query-v2/snapshot/__tests__/Snapshot.test.ts` — import path updated + S4/S5 expect throws + T31/T32 added
- `src/query-v2/__tests__/integration/ssr-hydration.test.ts` — version/prefix mismatch tests expect throws
- `docs/query-v2/ssr.md` — "Оптимистичные обновления и snapshot" + "Ошибки гидрации" subsections
- `docs/query-v2/api-reference.md` — "Standalone-импорт" note

## Post-Implementation Recommendations

- [ ] Full build: `npm run build`
- [ ] Full test run: `npm run test`
- [ ] Manual testing: React hook rendering — verify `useResourceV2Agent` and `useResourceV2Ref` work both as standalone imports and via `ReactHooksPlugin` augmentation
- [ ] Manual testing: SSR hydration error handling — verify version/prefix mismatch throws are catchable in SSR bootstrap code
- [ ] Manual testing: DevTools inspection — verify Redux DevTools only shows CacheEntry signals, not agent signals

## Recommended Commit Message

```
fix(query-v2): standalone hooks, core split, devtools isolation, snapshot errors, JSDoc, docs

- Extract React hooks into standalone functions in react/ folder,
  accessible without ReactHooksPlugin (fixes #1, #2)
- Split core/ into common/, machines/, resource/ sub-folders
  with barrel re-exports, zero public API change (fix #3)
- Add { isDisabled: true } to ResourceV2Agent signal constructors
  to exclude agent state from Redux DevTools (fix #4)
- Make hydrateSnapshot throw on version/prefix mismatch instead
  of silently returning; log console.warn for unknown resources (fix #5)
- Add JSDoc to public API surface (createApi, ResourceV2, CacheEntry,
  ResourceV2Agent, ReactHooksPlugin, standalone hooks) and inline
  comments at non-obvious code locations (fix #6)
- Document optimistic update snapshot behavior and hydration error
  semantics in docs/query-v2/ssr.md and api-reference.md (fix #7)
```
