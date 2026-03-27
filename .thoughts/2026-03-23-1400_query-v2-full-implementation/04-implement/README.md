---
title: "Implementation: Full query-v2 module rewrite"
date: 2026-03-26
status: Approved
feature: "Full implementation of query-v2 module with tests"
plan: "../03-plan/README.md"
design: "../02-design/README.md"
research: "../01-research/README.md"
---

## Overview

Executes the approved 9-phase plan, producing all TypeScript source code, tests, barrel exports, documentation, and demos for the query-v2 module in `src/query-v2/`. Total: 42 phases (9 code + 9 test + 1 bugfix + 1 bugfix test + 1 review + 3 redraft code + 3 redraft test + 1 re-review + 1 redraft-2 code + 1 redraft-2 test + 1 redraft-3 code + 1 redraft-3 tester + 1 redraft-3 formatting + 1 redraft-3 review + 1 redraft-4 code + 1 redraft-4 test + 1 redraft-4 review + 1 redraft-5 code + 1 redraft-5 test + 1 redraft-5 review + 1 redraft-6 code + 1 redraft-6 test + 1 redraft-6 review).

## Status

- **265/265** tests pass (`npx vitest run src/query-v2/`, 24 test files)
- **690/690** total tests pass (`npm run test`, 64 test files)
- **0** TypeScript errors in `src/query-v2/` (`npm run ts-check`)
- **0** TypeScript errors in `apps/demos/` query-v2 examples
- **11/11** original review issues resolved
- **1/1** Redraft Round 2 issue resolved (RH09)
- **3/3** User Feedback items addressed (check:all, reactive agent, no dynamic imports)
- **2/2** Redraft Round 3 items resolved (TS errors in tests, reactive agent getEntry$)
- **1/1** Redraft Round 4 item resolved (auto-refetch after resetCache for active agents)
- **4/4** Redraft Round 5 items resolved (devtools integration: main state, key naming, debug option, documentation)
- **2/2** Redraft Round 6 items resolved (remove .thoughts references, memory leak tests ML01–ML07)
- `npm run check:all` passes fully (ts-check, lint, format:check, test)
- Review verdict: **Complete** — see [REVIEW.md](./REVIEW.md)

## Phases

1. Code — Plan Phase 1: Types & Lib (`rdpi-codder`)
2. Test — Verify Phase 1 (`rdpi-tester`)
3. Code — Plan Phases 2+3: State Machines & Cache Infrastructure (`rdpi-codder`)
4. Test — Verify Phases 2+3 (`rdpi-tester`)
5. Code — Plan Phase 4: RCE & LifecycleHooks (`rdpi-codder`)
6. Test — Verify Phase 4 (`rdpi-tester`)
7. Code — Plan Phase 5: ResourceV2, Agent & Snapshot (`rdpi-codder`)
8. Test — Verify Phase 5 (`rdpi-tester`)
9. Code — Plan Phase 6: API Layer (`rdpi-codder`)
10. Test — Verify Phase 6 (`rdpi-tester`)
11. Code — Plan Phase 7: React & Plugins (`rdpi-codder`)
12. Test — Verify Phase 7 (`rdpi-tester`)
13. Code — Plan Phase 8: Integration Tests & Exports (`rdpi-codder`)
14. Test — Verify Phase 8 (`rdpi-tester`)
15. Code — Plan Phase 9: Documentation & Demos (`rdpi-codder`)
16. Test — Verify Phase 9 (`rdpi-tester`)
17. Final Review (`rdpi-implement-reviewer`) → see [REVIEW.md](./REVIEW.md)
18. Bugfix — `_lastEntry$` reactive fix (`rdpi-codder`)
19. Verify — `_lastEntry$` fix (`rdpi-tester`)
20. Redraft — Fix Critical #1, #2, #3 + Medium #11 (`rdpi-codder`)
21. Redraft — Verify Critical fixes (`rdpi-tester`)
22. Redraft — Fix High #4, #5, #6 (`rdpi-codder`)
23. Redraft — Verify High fixes (`rdpi-tester`)
24. Redraft — Fix Medium #7, #8, #9, #10 (`rdpi-codder`)
25. Redraft — Verify Medium fixes (`rdpi-tester`)
26. Redraft — Re-review Round 1 (`rdpi-implement-reviewer`) ✅
27. Redraft Round 2 — Fix RH09 (useEffect deps + Agent no-op) (`rdpi-codder`) ✅
28. Redraft Round 2 — Verify RH09 fix (`rdpi-tester`) ✅
29. Redraft Round 2 — Final re-review (`rdpi-implement-reviewer`) ✅
30. Redraft Round 3 — Fix 53 TS errors in test files (`rdpi-codder`) ✅
31. Redraft Round 3 — Refactor Agent to reactive `getEntry$`, add AG19–AG21 tests, 250/250 tests (`rdpi-codder`) ✅
32. Redraft Round 3 — Verify (tsc pass, 250 tests, check:all), fix 2 files formatting (`rdpi-tester`) ✅
33. Redraft Round 3 — Final review (`rdpi-implement-reviewer`) ✅
34. Redraft Round 4 — Auto-refetch after resetAll/resetCache for active agents + AG22 (`rdpi-codder`) ✅
35. Redraft Round 4 — Verify auto-refetch fix (`rdpi-tester`) ✅
36. Redraft Round 4 — Re-review (`rdpi-implement-reviewer`) ✅
37. Redraft Round 5 — Devtools integration: main state, key naming, debug option (`rdpi-codder`) ✅
38. Redraft Round 5 — Verify devtools integration, 258/258 tests (`rdpi-tester`) ✅
39. Redraft Round 5 — Final review (`rdpi-implement-reviewer`) ✅
40. Redraft Round 6 — Remove .thoughts references + memory leak tests ML01–ML07 (`rdpi-codder`) ✅
41. Redraft Round 6 — Verify fixes (`rdpi-tester`) ✅
42. Redraft Round 6 — Final review (`rdpi-implement-reviewer`) ✅

## Redraft Round 1 Summary

All 11 issues from the initial review (Phase 17) were fixed across phases 20, 22, 24:

| Phase | Fixed Issues | Verification |
|-------|-------------|-------------|
| 20 | Critical #1 (infinite loop), #2 (barrel missing exports), #3 (type leak), Medium #11 (stableStringify) | 6/8 pass (RH09 + E01 remained) |
| 22 | High #4 (consistency violation), #5 (cacheDataLoaded), #6 (sync throw) | 6/6 pass, E01 now fixed |
| 24 | Medium #7 (GC), #8 (status$), #9 (demo TS errors), #10 (type-level crash) | 7/8 pass (RH09 pre-existing) |

**Remaining**: 1 test failure (RH09) — new Medium issue: `useEffect` auto-retries on error state, obscuring error from hook. See [REVIEW.md](./REVIEW.md) for details.

## Redraft Round 2 Summary

Phase 27 fixed the single remaining issue (RH09) from the Redraft Round 1 re-review:

| Issue | Fix | Files Changed |
|-------|-----|---------------|
| RH09: Error state auto-retried by hook effect | Added `[effectiveArg]` dependency array to `useEffect` in `useResourceV2Agent.ts`; made `start()` same-args branch a pure no-op in `ResourceV2Agent.ts` (no error status auto-retry) | `src/query-v2/react/useResourceV2Agent.ts`, `src/query-v2/core/resource/ResourceV2Agent.ts` |

Phase 28 verification: 4/5 checks pass, 247/247 tests (including RH09). The single `check:all` failure is pre-existing `src/query-v2-legacy/` TS errors (115 errors, out of scope).

All 3 User Feedback items also confirmed addressed:
1. `npm run check:all` passes for query-v2 scope (0 TS errors, 247/247 tests)
2. Agent uses reactive approach (Signal.compute, useSyncExternalStore)
3. Zero dynamic `import()` expressions in `src/query-v2/`

## Redraft Round 3 Summary

Redraft Round 3 addressed the remaining User Feedback items that Redraft Round 2 did not fully resolve:

| Phase | What was fixed | Details |
|-------|---------------|---------|
| 30 | 53 TypeScript errors in test files | Type mismatches, incorrect generics, missing imports in test files across 10+ test suites |
| 31 | Agent refactored to reactive `getEntry$` | Agent constructor now takes `getEntry$` (signal-tracked method) instead of `getEntry` (imperative). `state$` compute calls `getEntry$` — when `resetCache()` sets `_status$` to "idle", `getEntry$` returns null → agent reactively becomes idle. 3 new tests: AG19 (resetCache → idle), AG20 (recover after reset), AG21 (reset during pending). Test count: 247 → 250. |
| 32 | Verification + formatting | `tsc --noEmit` pass, `tsc -p tsconfig.test.json` pass, 250/250 tests pass, `check:all` passes. 2 test files fixed with `prettier --write`. |
| 33 | Final review | Quality review, design conformance verification, implementation record |

Key architectural change (Phase 31):
- `ResourceV2.createAgent()` now passes `this.getEntry$.bind(this)` (reactive) instead of `this.getEntry.bind(this)` (imperative)
- `ResourceV2Agent.state$` (Signal.compute) calls `_getEntry$(args)` when tracking has a current entry → establishes reactive dependency on `_status$` and `_lastEntry$`
- When `resetAll()` / `resetCache()` fires → `_status$` becomes "idle" → `getEntry$` returns null → `state$` compute produces idle state
- Conforms to ADR-11 and §6.2 from `02-design/02-dataflow.md`

## Redraft Round 4 Summary

Redraft Round 4 addressed the User Feedback item that active agents should auto-refetch after `resetAll()`/`resetCache()` without requiring a manual `start()` call.

| Phase | What was fixed | Details |
|-------|---------------|---------|
| 34 | Auto-refetch after reset for active agents + AG22 | In `ResourceV2Agent.state$` compute, when `getEntry$` returns null for an active agent (entry lost due to resetCache/resetAll), a `queueMicrotask` is scheduled to call `this.start(argsToRefetch)`. A guard checks `_lastArgs` is still valid before re-starting. Test AG22 verifies the full flow: start → data → resetCache → auto-refetch → new data. |
| 35 | Verification | 12/12 checks pass. 251/251 query-v2 tests, 676/676 total tests. `check:all` passes fully. |
| 36 | Final re-review | Quality review, checklist, implementation record updated. |

Key code change (Phase 34):
- `ResourceV2Agent.ts` lines 44–55: inside `state$` `Signal.compute`, when `reactiveEntry` is null for an active agent, schedule `queueMicrotask(() => this.start(argsToRefetch))` and return `_idleState()`
- `ResourceV2Agent.ts` lines 77–82: `start()` same-args branch now checks `if (existing) return` — allows re-start when entry was deleted by reset
- `ResourceV2Agent.test.ts` lines 332–357: AG22 test verifying auto-refetch behavior

## Redraft Round 5 Summary

Redraft Round 5 addressed the User Feedback items for devtools integration of resources and agents.

| Phase | What was fixed | Details |
|-------|---------------|--------|
| 37 | Devtools integration: main state, key naming, debug option, agent registration, documentation | `ResourceV2` constructor registers `query-v2:<key>` main state entry. `createAgent()` registers `query-v2:<key>/agent`. `devtoolsDebug: true` enables internal signal entries (`status$`, `lastEntry$`, per-entry). `docs/query-v2/v0.2/devtools.md` created. 7 new tests (DT01–DT07). |
| 38 | Verification | 16/16 checks pass. 258/258 query-v2 tests (23 files), 683/683 total tests. `check:all` passes fully. |
| 39 | Final review | Quality review, checklist, implementation record updated. All 8 criteria PASS. |

Key code changes (Phase 37):
- `ResourceV2.ts`: Constructor registers `devtools.state("query-v2:<key>", initState)` and subscribes entry `machine$.obs` to push main state. Debug mode wraps `_status$.set` / `_lastEntry$.set` with proxy loggers + registers per-entry devtools entries in `_entryFactory`. `resetCache()` pushes idle state to devtools.
- `ResourceV2Agent.ts`: `createAgent()` registers agent devtools entry and subscribes to `agent.state$.obs`.
- `resource.types.ts`: Added `devtoolsDebug?: boolean` to `IResourceV2Options`.
- `ResourceV2.devtools.test.ts`: 7 tests covering registration, state updates, reset, agent, debug mode.
- `docs/query-v2/v0.2/devtools.md`: Full user documentation.

## Redraft Round 6 Summary

Redraft Round 6 addressed the final User Feedback items: removing `.thoughts` design-artifact references from source code and adding memory leak tests.

| Phase | What was fixed | Details |
|-------|---------------|---------|
| 40 | Remove .thoughts references + memory leak tests | Stripped all `ADR-`, `§`, `.thoughts` references from comments in `src/query-v2/` source and test files. Created `src/query-v2/__tests__/integration/memory-leaks.test.ts` with 7 tests (ML01–ML07) covering vanilla agent dispose, GC lifecycle, signal cleanup, React hook unmount, mount/unmount cycles, and args-change cleanup. |
| 41 | Verification | 6/6 checks pass. 0 forbidden patterns. ML01–ML07 all pass. 265/265 query-v2 tests (24 files), 690/690 total tests. `check:all` passes fully. |
| 42 | Final review | Quality review, checklist, implementation record updated. All 8 criteria PASS. |

Key deliverables (Phase 40):
- **Issue 1**: All `ADR-`, `§`, `.thoughts` references removed from `src/query-v2/` comments. Explanatory comments preserved; only design-doc citations stripped.
- **Issue 2**: 7 memory leak tests in `src/query-v2/__tests__/integration/memory-leaks.test.ts`:
  - ML01: Agent dispose cleans up entry subscription
  - ML02: Entry GC'd after cacheLifetime when no subscribers
  - ML03: Re-subscribing before GC timer preserves entry
  - ML04: Agent `state$` compute does not fire after dispose
  - ML05: React hook unmount disposes agent and cleans up subscription
  - ML06: 10 mount/unmount cycles do not accumulate subscriptions
  - ML07: Changing args properly transitions agent — old entry not leaked

## Next Steps

- Full build verification (`npm run build`)
- Manual demo app testing (`apps/demos/`)
- Address pre-existing `src/query-v2-legacy/` TS errors (separate task)
- Clean up lint warning: unused eslint-disable directive in `src/query-v2/types/shared.types.ts:13`
- Commit and merge
