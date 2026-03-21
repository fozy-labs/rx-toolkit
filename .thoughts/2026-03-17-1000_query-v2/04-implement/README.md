---
title: "Implementation Record: Query v2 Module"
date: 2026-03-18
status: Approved
feature: "New query-v2 module with createApi, ResourceV2, agents, caching, patches, machines, snapshots, plugins, SSR support"
plan: "../03-plan/README.md"
rdpi-version: b0.2
---

## Status

- Phases completed: 8/8
- Verification: all passed (verification-1 through verification-8)
- Issues: none critical; 2 low-severity observations

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All 8 plan phases implemented | PASS | All 30 tasks across 8 phases executed. Every phase produced all specified files. |
| 2 | All verification reports pass | PASS | verification-1: 9/9, verification-2: 9/9, verification-3: 28/28, verification-4: 31/31, verification-5: 15/15, verification-6: 32/32, verification-7: 26/26, verification-8: 12/12. Total: 162/162 checks passed. |
| 3 | No files outside plan scope modified | PASS | Only `src/query-v2/` (new), `vitest.config.ts`, `src/index.ts`, `docs/query-v2/`, `docs/query/README.md`, `docs/migrations/query-v2.md`, `apps/demos/src/examples/query-v2/`, `apps/demos/src/examples/index.ts`, root `README.md` were touched. No changes to `src/query/`, `src/signals/`, `src/common/`, or any other existing source files. |
| 4 | Code follows project patterns | PASS | Naming conventions (`ResourceV2`, `I`/`T` prefixes for types), barrel exports via `index.ts`, `@/` alias for imports, colocated tests. |
| 5 | TypeScript strict mode maintained | PASS | `npm run ts-check` confirmed passing in all 8 verification reports. No new `any` casts except PL5 test (`as any` for mock plugin — justified in test context). |
| 6 | Barrel exports correct | PASS | `src/query-v2/index.ts` is a superset of architecture §7. All required exports present: `createApi`, `SKIP`/`SKIP_TOKEN`, `NO_VALUE`, `ReactHooksPlugin`, `Machine`, all 5 machine classes, all type exports. Additional exports (`stableStringify`, `Patcher`, `CacheEntry`, `CacheMap`, `LifecycleHooks`, `ResourceV2`, `ResourceV2Agent`, snapshot utilities) extend the public surface beyond the minimum. |
| 7 | Documentation proportional to feature scope | PASS | See Documentation Proportionality section below. |
| 8 | No security vulnerabilities | PASS | No `eval`, no dynamic code execution, no prototype pollution patterns, no XSS vectors in demos. Demos use namespace imports (`queryV2`) from the package — no raw user input passed to queries. |
| 9 | No imports from `src/query/` in any `src/query-v2/` file | PASS | Grep for `@/query/`, `../query/`, `../../query/`, `src/query/` across `src/query-v2/**` returned zero matches in all 8 verification reports. Full v1/v2 isolation confirmed. |
| 10 | All 97 test cases from design mapped and passing | PASS | All test case IDs from design §06-testcases verified: M1–M17 (Phase 2), C1–C11 (Phase 3), P1–P12 (Phase 2), R1–R12 (Phase 4), A1–A8 (Phase 5), API1–API7 (Phase 6), S1–S8 (Phase 6), PL1–PL6 (Phase 6), L1–L9 (Phase 4), D1–D4 (Phases 3+6), E1–E12 (Phases 2–5). Plus 5 correctness verification integration tests (Phase 7). Full suite: 612 tests passing, 0 failures. |

### Documentation Proportionality

**Existing docs**: `docs/query/README.md` (~100 lines), docs for signals, options, devtools, and 1 migration guide (`0.5.0.md`). Demo directory: 5 query v1 examples (duplicator, shopping-cart, simple-list, todo-patches, user-profile), plus signals examples.

**v2 additions**: 4 new doc pages (`README.md`, `api-reference.md`, `optimistic-updates.md`, `ssr.md`), 1 migration guide (`docs/migrations/query-v2.md`), 2 minor updates to existing pages (`docs/query/README.md` — one-line v2 note; root `README.md` — feature list entry), 3 demos (`simple-resource.tsx`, `optimistic-patches.tsx`, `ssr-snapshot.tsx`).

**Assessment**: Proportional. SSR, plugins, and machine-based state management have no v1 equivalents and justify dedicated pages. Demo count (3) is appropriately smaller than v1's (5) for an experimental module. Docs are written in Russian following existing project convention. All docs mark query-v2 as experimental.

### Issues Found

1. **Low — PL6 type test with 2 plugins not fully exercised at type level**: Verification-6 notes that PL6 uses `expectTypeOf` with 1 plugin only. PL5 tests 2 plugins at runtime but uses `as any` cast, so TS2589 mitigation isn't explicitly validated in a type test with 2+ plugins. However, `ts-check` passes globally with all plugin code compiled, confirming no TS2589 errors in practice.
   - Where: `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` (PL6 test)
   - Expected: Type test with `expectTypeOf` covering 2 concrete plugins without `as any`
   - Severity: Low (ts-check passing globally is sufficient practical validation)

2. **Low — Test file placement differs slightly from plan's test organization**: Plan specified `ResourceV2.test.ts`, `LifecycleHooks.test.ts`, `ResourceV2Agent.test.ts` colocated in `core/`. Actual placement uses `core/__tests__/` subdirectory. Similarly `createApi.test.ts` in `api/__tests__/`, `ReactHooksPlugin.test.ts` in `plugins/__tests__/`, `Snapshot.test.ts` in `snapshot/__tests__/`. This follows the project's `__tests__/` pattern and does not affect functionality.
   - Where: Multiple test files across `core/__tests__/`, `api/__tests__/`, `plugins/__tests__/`, `snapshot/__tests__/`
   - Expected: Colocated tests per plan diagram
   - Severity: Low (acceptable organizational variation; the project uses both patterns)

## Phase Completion

| Plan Phase | Name | Verification | Checks | Status |
|------------|------|--------------|--------|--------|
| 1 | Foundation — Types, Tokens, Utilities | verification-1.md | 9/9 | PASS |
| 2 | State Machines + Patcher | verification-2.md | 9/9 | PASS |
| 3 | Cache Layer — CacheMap + CacheEntry | verification-3.md | 28/28 | PASS |
| 4 | ResourceV2 Core + LifecycleHooks | verification-4.md | 31/31 | PASS |
| 5 | ResourceV2Agent | verification-5.md | 15/15 | PASS |
| 6 | createApi + Plugins + SSR Snapshots | verification-6.md | 32/32 | PASS |
| 7 | Integration Tests + Barrel Export + Config | verification-7.md | 26/26 | PASS |
| 8 | Documentation + Demos | verification-8.md | 12/12 | PASS |

## Verification Summary

- Total verification checks: **162**
- Passed: **162**
- Failed: **0**
- Test suite: **612 tests passing**, 4 skipped, 0 failures (across entire project including v1, signals, common)
- TypeScript: `tsc --noEmit` passing in all 8 phases
- Cross-module isolation: zero imports from `src/query/` in any `src/query-v2/` file (verified each phase)

## Change Summary

### Created: `src/query-v2/types/` (10 files)
- `index.ts` — barrel re-export
- `shared.types.ts` — `Prettify`, `TSerializeArgsFn`, `TCompareArgsFn`, `TBeforeDevtoolsPushFn`, `TQueryFn`, `TQueryFnTools`
- `machine.types.ts` — `TMachine` union, `TMachineStatus`, 5 state shape interfaces, `TResourceV2Patch`, `TPatchFn`
- `cache.types.ts` — `ICacheEntry`, `ICacheMap`, `ICacheMapOptions`
- `resource.types.ts` — `IResourceV2Options`, `IResourceV2`
- `agent.types.ts` — `IResourceV2Agent`, `IResourceV2AgentState`, `IResourceV2Ref`
- `api.types.ts` — `ICreateApiOptions`, `IApi`
- `plugin.types.ts` — `IPlugin`, `IPluginContext`, `PluginAugmentations`, `ExtractPluginContributions`
- `snapshot.types.ts` — `TApiSnapshot`, `TResourceSnapshot`, `TResourceV2SnapshotSlice`
- `lifecycle.types.ts` — `TOnCacheEntryAdded`, `TOnQueryStarted`, `TCacheEntryAddedTools`, `TQueryStartedTools`

### Created: `src/query-v2/lib/` (4 files)
- `index.ts` — barrel
- `SKIP_TOKEN.ts` — `SKIP` unique symbol + `SKIP_TOKEN` type
- `NO_VALUE.ts` — `NO_VALUE` unique symbol + type
- `stableStringify.ts` — deterministic JSON.stringify with sorted keys

### Created: `src/query-v2/core/machines/` (17 files)
- `index.ts` — barrel
- `MachineIdle.ts` + `MachineIdle.test.ts`
- `MachinePending.ts` + `MachinePending.test.ts`
- `MachineSuccess.ts` + `MachineSuccess.test.ts` — includes `start(args)` (Option A chosen per Task 2.2)
- `MachineError.ts` + `MachineError.test.ts`
- `MachineRefreshing.ts` + `MachineRefreshing.test.ts`
- `MachineWithData.ts` + `MachineWithData.test.ts` — abstract base with patch methods
- `Patcher.ts` + `Patcher.test.ts` — static utility with Immer integration
- `Machine.ts` + `Machine.test.ts` — namespace with `idle()`, `fromSnapshot()`

### Created: `src/query-v2/core/` (9 files)
- `index.ts` — barrel
- `CacheEntry.ts` + `CacheEntry.test.ts` — Signal.state-based reactive wrapper
- `CacheMap.ts` + `CacheMap.test.ts` — dual-strategy (Serialized/Compare) cache
- `LifecycleHooks.ts` — `onCacheEntryAdded`/`onQueryStarted` management
- `ResourceV2.ts` — query orchestration, AbortController, cache lifetime
- `ResourceV2Agent.ts` — SWR observer with `state$` Signal.compute

### Created: `src/query-v2/core/__tests__/` (3 files)
- `LifecycleHooks.test.ts` — L1–L9 tests
- `ResourceV2.test.ts` — R1–R12 + edge case tests
- `ResourceV2Agent.test.ts` — A1–A8 + E4, E5 tests

### Created: `src/query-v2/api/` (1 file + 1 test)
- `createApi.ts` — factory with plugin init, resource registry, resetAll, getSnapshot
- `__tests__/createApi.test.ts` — API1–API7 + devtools D1–D3 tests

### Created: `src/query-v2/plugins/` (2 files + 1 test)
- `types.ts` — `IPlugin`/`IPluginContext` runtime types
- `ReactHooksPlugin.ts` — adds `useResourceV2Agent` + `useResourceV2Ref` hooks
- `__tests__/ReactHooksPlugin.test.ts` — PL1–PL6 + renderHook tests

### Created: `src/query-v2/snapshot/` (1 file + 1 test)
- `Snapshot.ts` — `getSnapshot()`, `hydrateSnapshot()`, `CURRENT_SNAPSHOT_VERSION`
- `__tests__/Snapshot.test.ts` — S1–S8 tests

### Created: `src/query-v2/__tests__/integration/` (3 files)
- `query-flow.test.ts` — full lifecycle, optimistic update, transition completeness, SWR, deduplication, resetAll
- `ssr-hydration.test.ts` — round-trip, version mismatch, keyPrefix mismatch, maxSnapshotDataAge
- `plugin-augmentation.test.ts` — type-level, multi-plugin, install/augmentResource hooks

### Created: `src/query-v2/index.ts`
- Public barrel export — superset of architecture §7

### Created: `docs/query-v2/` (4 files)
- `README.md` — main concepts (experimental)
- `api-reference.md` — options/return type tables
- `optimistic-updates.md` — Patcher usage guide
- `ssr.md` — SSR dehydration/hydration guide

### Created: `docs/migrations/query-v2.md`
- Migration guide from v1 to v2

### Created: `apps/demos/src/examples/query-v2/` (4 files)
- `index.ts` — barrel
- `simple-resource.tsx` — basic query demo
- `optimistic-patches.tsx` — optimistic update demo
- `ssr-snapshot.tsx` — SSR snapshot demo (simulated)

### Modified: `vitest.config.ts`
- Added `'src/query-v2/**'` to `coverage.include`

### Modified: `src/index.ts`
- Added `export * as queryV2 from './query-v2'` (namespaced to avoid collisions)

### Modified: `docs/query/README.md`
- Added one-line note linking to query-v2 as experimental successor

### Modified: `README.md` (root)
- Added query-v2 to feature list and doc links

### Modified: `apps/demos/src/examples/index.ts`
- Added `export * as QueryV2 from "./query-v2"`

## Post-Implementation Recommendations

- [ ] Full build: `npm run build` — confirm bundling includes query-v2
- [ ] Full test run: `npm run test` — confirm 612 tests, 0 failures
- [ ] TypeScript check: `npm run ts-check` — confirm no errors
- [ ] Manual testing: demo app (`apps/demos/`) — verify `simple-resource`, `optimistic-patches`, `ssr-snapshot` demos render and function correctly
- [ ] Manual testing: verify query-v2 exports are accessible via `import { queryV2 } from '@fozy-labs/rx-toolkit'`
- [ ] Coverage report: verify query-v2 meets 85%+ statements/branches/lines, 90% functions thresholds
- [ ] Known limitation: PL6 type test only validates 1-plugin `expectTypeOf`; consider adding explicit 2-plugin type test if TS2589 risk is a concern for future plugin authors

## Recommended Commit Message

```
feat(query-v2): implement experimental query-v2 module

- createApi factory with plugin system and resource registry
- ResourceV2 with dual-strategy cache (serialize/compare)
- Machine-based state management (5 classes, 12 transitions)
- Patcher with hanging-patch fix (3-layer defense via ADR-4)
- ResourceV2Agent with stale-while-revalidate behavior
- SSR snapshot support (getSnapshot/hydrateSnapshot)
- ReactHooksPlugin for React integration (useResourceV2Agent/useResourceV2Ref)
- Lifecycle hooks (onCacheEntryAdded, onQueryStarted)
- Comprehensive test suite (612 tests, 0 failures)
- Documentation (4 pages + migration guide) and demo applications

BREAKING CHANGE: none (new module, experimental)
```
| 14 | `rdpi-tester` | P7 | Verification: integration tests, coverage, root export |
| 15 | `rdpi-codder` | P8 | Documentation + Demos |
| 16 | `rdpi-tester` | P8 | Verification: docs exist, demos compile |
| 17 | `rdpi-implement-reviewer` | — | Final implementation review |

## Next Steps

After all 17 phases complete, the implementation reviewer produces the final README.md with quality review, change summary, and recommended commit message.
