---
title: "Phases: 04-implement"
date: 2026-03-29
stage: 04-implement
---

# Phases: 04-implement

## Phase 1.1: Code — Types & Machine Enhancement

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/01-types-and-machines.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/01-types-and-machines.md`. Read design documents at `../02-design/03-model.md` and `../02-design/04-decisions.md` (ADR-1, ADR-6) for context.

Implement Tasks 1.1–1.4 in order:

1. **Task 1.1** — `src/query-v2/core/machines/MachineSuccess.ts`: Add `readonly lastError?: unknown` field. Add `lastError?: unknown` as last optional constructor parameter. Set `this.lastError = lastError`. Update `cloneWith()` to propagate `lastError` — if `"lastError" in updates` use update value, otherwise carry `this.lastError`.

2. **Task 1.2** — `src/query-v2/core/machines/MachineRefreshing.ts`: Change `errorHappened(_error: unknown)` to `errorHappened(error: unknown)` (remove underscore). Pass `error` as `lastError` to `new MachineSuccess(this.args, this.data, this.patchState, this.updatedAt, error)`.

3. **Task 1.3** — `src/query-v2/types/machine.types.ts`: Add `readonly lastError?: unknown` to `TSuccessState`.

4. **Task 1.4** — `src/query-v2/core/resource/ResourceV2CacheEntry.ts`: Add `initialMachine?: TMachineInstance<TArgs, TData>` as optional field to `IResourceV2CacheEntryOptions`. Type-only change — verify correct machine type import is available.

Follow existing code patterns precisely (naming, indentation, barrel exports, `@/` alias). Do NOT modify files outside scope. Run `npm run ts-check` after implementation — fix within scope if errors (max 2 attempts).

---

## Phase 1.2: Verify — Types & Machine Enhancement

- **Agent**: `rdpi-tester`
- **Output**: `verification-1.md`
- **Depends on**: 1.1
- **Retry limit**: 1

### Prompt

Phase 1.1 implemented Types & Machine Enhancement (Tasks 1.1–1.4) per `../03-plan/01-types-and-machines.md`.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `npx vitest run src/query-v2/` — all existing tests pass
3. Verify `MachineSuccess` accepts optional 5th `lastError` parameter (check source)
4. Verify `MachineRefreshing.errorHappened` no longer has `_` prefix on parameter (check source)
5. Verify `TSuccessState` includes `lastError?: unknown` (check source)
6. Verify `IResourceV2CacheEntryOptions` includes `initialMachine?` field (check source)

Save report to `04-implement/verification-1.md` with pass/fail per check and error details if any. If tests fail, report `Next step: retry-coder` with failure details.

---

## Phase 2.1: Code — Core Bug Fixes (#1, #2, #5)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/02-core-bugfixes.md`
- **Depends on**: 1.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/02-core-bugfixes.md`. Read design documents at `../02-design/01-architecture.md` (Fix Area 1, sequence diagrams 5, 6, 8), `../02-design/03-model.md` (ResourceV2CacheEntry Constructor Changes), and `../02-design/04-decisions.md` (ADR-1, ADR-2, ADR-5).

Implement Tasks 2.1–2.4 in order:

1. **Task 2.1** — `src/query-v2/core/resource/ResourceV2CacheEntry.ts`: In constructor, if `options.initialMachine` is provided, use it as initial machine (skip `_doFetch()`). Otherwise preserve existing behavior (`MachinePending` + `_doFetch()`).

2. **Task 2.2** — `src/query-v2/core/resource/ResourceV2.ts`: Update `_entryFactory` to accept optional `initialMachine` and forward to `ResourceV2CacheEntry` options. Update `hydrateEntry` to pass snapshot machine as `initialMachine` to `_entryFactory`, remove redundant `entry.set(machine)` call. Check if `_entryFactory` goes through `CacheMap.getOrCreate` — update signature if needed.

3. **Task 2.3** — `src/query-v2/core/resource/ResourceV2CacheEntry.ts`: In `_doFetch`, call `fireQueryStarted(args, this)` before `queryFn`. After queryFn resolves/rejects, call `resolveQueryFulfilled` with appropriate payload. On abort/stale: no lifecycle settlement. Check actual signatures in `src/query-v2/core/LifecycleHooks.ts` before implementing.

4. **Task 2.4** — `src/query-v2/core/LifecycleHooks.ts`: In `fireCacheEntryRemoved(args)`, before resolving `$cacheEntryRemoved` and deleting map entry, call `resolvers.dataLoaded.reject(new Error("Promise never resolved before cacheEntryRemoved."))`. Safe even if already settled.

Follow existing code patterns. Do NOT modify files outside scope. Run `npm run ts-check` after — fix within scope if errors (max 2 attempts).

---

## Phase 3.1: Code — Agent & Patcher Fixes (#3, #4)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/03-agent-and-patcher.md`
- **Depends on**: 1.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/03-agent-and-patcher.md`. Read design documents at `../02-design/01-architecture.md` (Fix Area 3, sequence diagram 7), `../02-design/03-model.md`, and `../02-design/04-decisions.md` (ADR-3, ADR-4, ADR-6).

Implement Tasks 3.1–3.2:

1. **Task 3.1** — `src/query-v2/core/resource/ResourceV2Agent.ts`: In `_deriveState$`, before the SWR override block, capture `const originalStatus = currentMachine.status`. Derive `isError` from `originalStatus === "error"` (not overridden `status`). Use `originalStatus` for `previous$` clearing condition. Expose `lastError` from `currentMachine` in derived state when present.

2. **Task 3.2** — `src/query-v2/core/machines/Patcher.ts`: In `resolvePatches` catch block, change return from `{ data: currentData, patchState: null }` to include `patchState` with `isConsistencyViolation: true`. Return: `{ data: currentData, patchState: { patches: [], originalData: currentData, isConsistencyViolation: true } }`. Verify exact `TPatchState` shape first.

Follow existing code patterns. Do NOT modify files outside scope. Run `npm run ts-check` after — fix within scope if errors (max 2 attempts).

---

## Phase 2.2: Verify — Core Bug Fixes

- **Agent**: `rdpi-tester`
- **Output**: `verification-2.md`
- **Depends on**: 2.1
- **Retry limit**: 1

### Prompt

Phase 2.1 implemented Core Bug Fixes (Tasks 2.1–2.4) per `../03-plan/02-core-bugfixes.md`.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `npx vitest run src/query-v2/` — all existing tests pass (test E07 may now fail — this is expected, document it)
3. Verify snapshot hydration: read `ResourceV2CacheEntry` constructor — `_doFetch` is NOT called when `initialMachine` is provided
4. Verify normal entry: `_doFetch` IS called when no `initialMachine`
5. Verify `_doFetch` calls `fireQueryStarted` before `queryFn` (read source)
6. Verify `resolveQueryFulfilled` called on success/error outcomes (read source)
7. Verify `fireCacheEntryRemoved` rejects `$cacheDataLoaded` before `$cacheEntryRemoved` resolution (read source)

Save report to `04-implement/verification-2.md`. If tests fail (except expected E07), report `Next step: retry-coder`.

---

## Phase 3.2: Verify — Agent & Patcher Fixes

- **Agent**: `rdpi-tester`
- **Output**: `verification-3.md`
- **Depends on**: 3.1
- **Retry limit**: 1

### Prompt

Phase 3.1 implemented Agent & Patcher Fixes (Tasks 3.1–3.2) per `../03-plan/03-agent-and-patcher.md`.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `npx vitest run src/query-v2/` — all existing tests pass
3. Verify `_deriveState$` uses `originalStatus` for `isError` derivation (read `ResourceV2Agent.ts`)
4. Verify `previous$` clearing uses `originalStatus` (read source)
5. Verify `lastError` exposed in derived state (read source)
6. Verify `resolvePatches` catch returns `patchState` with `isConsistencyViolation: true` (read `Patcher.ts`)

Save report to `04-implement/verification-3.md`. If tests fail, report `Next step: retry-coder`.

---

## Phase 4.1: Code — Tests

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/04-tests.md`
- **Depends on**: 2.2, 3.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/04-tests.md`. Read design test cases at `../02-design/06-testcases.md` for expected behaviors and test IDs.

Implement Tasks 4.1–4.6 in order:

1. **Task 4.1** — `src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts` and `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`: Update E07 to assert `queryFn` NOT called on fresh hydration. Add T05 stale snapshot test. Add unit tests for `ResourceV2CacheEntry` with/without `initialMachine`.

2. **Task 4.2** — `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` and `src/query-v2/__tests__/integration/query-flow.test.ts`: Add unit tests T07–T10 for `fireQueryStarted`/`resolveQueryFulfilled` in `_doFetch`. Add integration test T11 for `onQueryStarted` lifecycle.

3. **Task 4.3** — `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` and `src/query-v2/__tests__/integration/query-flow.test.ts`: Add unit tests T13–T16 for SWR error transparency. Add integration T17 for full SWR cycle. Add T31 for `lastError` in agent state.

4. **Task 4.4** — `src/query-v2/core/machines/__tests__/Patcher.test.ts`, `src/query-v2/core/__tests__/LifecycleHooks.test.ts`, `src/query-v2/core/machines/__tests__/Machine.test.ts`: Add Patcher tests T18–T20, LifecycleHooks tests T22–T23, Machine tests T26–T29.

5. **Task 4.5** — `src/query-v2/__tests__/integration/optimistic-updates.test.ts`, `src/query-v2/__tests__/integration/reset-and-multi-agent.test.ts`, `src/query-v2/__tests__/integration/gc-lifecycle.test.ts`: Add integration tests T21, T24, T25, T30.

6. **Task 4.6** — `src/query-v2/types/__tests__/type-level.test.ts`: Add type-level test for `lastError` on `TSuccessState`.

Read existing test files to match patterns (imports, describe structure, helpers, assertions). Follow existing naming conventions. Run `npm run ts-check` after, then `npx vitest run src/query-v2/` — fix test failures within scope (max 2 attempts).

---

## Phase 4.2: Verify — Tests

- **Agent**: `rdpi-tester`
- **Output**: `verification-4.md`
- **Depends on**: 4.1
- **Retry limit**: 1

### Prompt

Phase 4.1 implemented all regression tests (Tasks 4.1–4.6) per `../03-plan/04-tests.md`.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `npx vitest run src/query-v2/` — ALL tests pass (including new ones)
3. Verify E07 updated to assert zero `queryFn` calls on fresh hydration (read test file)
4. Verify each bug has at least one unit and one integration test (scan test files for test IDs T01–T31)
5. Verify `lastError` has unit, integration, and type-level tests
6. Verify no regressions in existing tests (compare total test count before/after if visible in output)

Save report to `04-implement/verification-4.md`. If tests fail, report `Next step: retry-coder` with failure details.

---

## Phase 5.1: Code — Docs & Examples

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/05-docs-and-examples.md`
- **Depends on**: 4.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/05-docs-and-examples.md`. Read design docs spec at `../02-design/07-docs.md` and risk mitigations at `../02-design/08-risks.md` (R3, R5).

Implement Tasks 5.1–5.5 in order:

1. **Task 5.1** — Fix factual errors:
   - `docs/query-v2/README.md`: Remove `MachineIdle` from machine class list, fix idle row in states table, remove `MachineIdle` from API exports list. Verify line numbers before editing.
   - `docs/query-v2/devtools.md`: Remove `devtoolsDebug` references, fix `resources` config pattern, fix `idle` state references.
   - `docs/query-v2/optimistic-updates.md`: Add note that `onQueryStarted` is now functional.

2. **Task 5.2** — `docs/query-v2/README.md`: Add Error Handling section after Machine States — SWR error semantics, `lastError`, error recovery, migration guidance. ~½ page, Russian language, follow existing style.

3. **Task 5.3** — `docs/query-v2/README.md`: Expand Lifecycle Hooks section — `onQueryStarted`/`$queryFulfilled` pattern, `$cacheDataLoaded` rejection on reset with `try/catch`, deferred migration note.

4. **Task 5.4** — Create 4 interactive examples:
   - `apps/demos/src/examples/query-v2/basic-query.tsx`
   - `apps/demos/src/examples/query-v2/error-swr-states.tsx`
   - `apps/demos/src/examples/query-v2/skip-token.tsx`
   - `apps/demos/src/examples/query-v2/snapshot-hydration.tsx`
   - Optional: `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
   Follow existing example patterns (HeroUI Card, `fetches` utility, visual state indicators). Read existing examples in `apps/demos/src/examples/query-v2/` for reference. No commands/mutations — queries only.

5. **Task 5.5** — `apps/demos/src/examples/query-v2/index.ts`: Register new examples using existing `?raw` import pattern.

Follow existing doc style (Russian language). Run `npm run ts-check` after — fix within scope if errors (max 2 attempts).

---

## Phase 5.2: Verify — Docs & Examples

- **Agent**: `rdpi-tester`
- **Output**: `verification-5.md`
- **Depends on**: 5.1
- **Retry limit**: 1

### Prompt

Phase 5.1 implemented Docs & Examples (Tasks 5.1–5.5) per `../03-plan/05-docs-and-examples.md`.

Run the verification checklist:
1. `npm run ts-check` — no type errors (including `apps/demos/`)
2. Grep check: `docs/query-v2/README.md` does NOT contain `MachineIdle`
3. Grep check: `docs/query-v2/devtools.md` does NOT contain `devtoolsDebug`
4. Verify `docs/query-v2/optimistic-updates.md` `onQueryStarted` section is accurate (read file)
5. Verify Error Handling section present in README (read file)
6. Verify Lifecycle Hooks section expanded in README (read file)
7. Verify all new example files exist and compile: `basic-query.tsx`, `error-swr-states.tsx`, `skip-token.tsx`, `snapshot-hydration.tsx`
8. Verify examples index exports new examples (read `index.ts`)
9. Demo app builds: `cd apps/demos && npm run build`

Save report to `04-implement/verification-5.md`. If checks fail, report `Next step: retry-coder` with details.

---

## Phase Final: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Output**: Updates `README.md` (implementation record)
- **Depends on**: 1.2, 2.2, 3.2, 4.2, 5.2
- **Retry limit**: 2

### Prompt

All implementation phases are complete. Review the full implementation and create the implementation record.

Read these inputs:
- Plan phases: `../03-plan/01-types-and-machines.md`, `../03-plan/02-core-bugfixes.md`, `../03-plan/03-agent-and-patcher.md`, `../03-plan/04-tests.md`, `../03-plan/05-docs-and-examples.md`
- Research: `../01-research/README.md`
- Design: `../02-design/README.md`, `../02-design/01-architecture.md`, `../02-design/03-model.md`, `../02-design/04-decisions.md`
- Verification files: `04-implement/verification-1.md`, `04-implement/verification-2.md`, `04-implement/verification-3.md`, `04-implement/verification-4.md`, `04-implement/verification-5.md`

Replace the stage-creator's placeholder `04-implement/README.md` with a full implementation record containing:
- Implementation record: date, status, plan link
- Phase completion status (5/5 plan phases)
- Verification results summary (from all verification-*.md files)
- Quality review checklist: all plan phases implemented, verification passed, no out-of-scope files modified, code follows project patterns, barrel exports correct, TypeScript strict mode, docs proportional, no security vulnerabilities
- List of ALL changed files (source, test, docs, examples)
- Post-implementation recommendations (build, manual testing areas)
- Recommended commit message

---

# Redraft Round 1

## Phase 6: Fix user feedback — add new examples to QueriesV2Page.mdx

- **Agent**: `rdpi-codder`
- **Output**: Code changes to `apps/demos/src/pages/QueriesV2Page.mdx`
- **Depends on**: Final
- **Retry limit**: 2
- **Review issues**: User Feedback

### Prompt

Read REVIEW.md at `c:\Area\projects\fozy-labs\rx-toolkit\.thoughts\2026-03-28-1000_query-v2-bugfixes-and-docs\04-implement\REVIEW.md`.

User feedback: the 5 new interactive examples (basic-query, error-swr-states, skip-token, snapshot-hydration, lifecycle-hooks) were created as `.tsx` files and registered in `apps/demos/src/examples/query-v2/index.ts`, but they are NOT displayed in the demo app UI because `apps/demos/src/pages/QueriesV2Page.mdx` was never updated to include `<Tab>` entries for them.

Fix: add 5 new `<Tab>` + `<LiveExample>` entries to `apps/demos/src/pages/QueriesV2Page.mdx` for the new examples.

Reference the existing pattern in `QueriesV2Page.mdx` — each example is a `<Tab>` inside `<QueryTabs>` with a `<LiveExample>` using `QueryV2.examples.<key>`. The keys are: `basicQuery`, `errorSwrStates`, `skipToken`, `snapshotHydration`, `lifecycleHooks` (as exported in `apps/demos/src/examples/query-v2/index.ts`).

Use descriptive Russian tab titles consistent with the existing page style. For reference, see `apps/demos/src/pages/QueriesPage.mdx` for tab naming conventions.

Run `npm run ts-check` after — fix if errors (max 2 attempts). Also run `cd apps/demos && npx tsc --noEmit` to verify MDX imports.

---

## Phase 7: Verify — QueriesV2Page.mdx fix

- **Agent**: `rdpi-tester`
- **Output**: `verification-6.md`
- **Depends on**: 6
- **Retry limit**: 1

### Prompt

Phase 6 added new Tab entries to `apps/demos/src/pages/QueriesV2Page.mdx` per user feedback in REVIEW.md.

Run the verification checklist:
1. `cd apps/demos && npx tsc --noEmit` — no type errors
2. Read `apps/demos/src/pages/QueriesV2Page.mdx` — verify it contains Tab entries for all 5 new examples: `basicQuery`, `errorSwrStates`, `skipToken`, `snapshotHydration`, `lifecycleHooks`
3. Verify each Tab uses `QueryV2.examples.<key>` to reference the correct example
4. Verify Tab titles are in Russian and descriptive
5. Verify no existing tabs were removed (simpleResource, optimisticPatches, ssrSnapshot must still be present)

Save report to `04-implement/verification-6.md`. If checks fail, report `Next step: retry-coder` with details.

---

## Phase 8: Re-review after Redraft Round 1

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: 7
- **Retry limit**: 2

### Prompt

Re-review the implementation after Redraft Round 1. Read:
- `04-implement/REVIEW.md` — the original review issues and user feedback
- `04-implement/verification-6.md` — verification of the redraft fix
- `apps/demos/src/pages/QueriesV2Page.mdx` — the modified file

Verify that:
1. All 5 new examples now appear as tabs in QueriesV2Page.mdx
2. No existing content was removed or broken
3. The original REVIEW.md issue #1 (pre-existing Vite build) is unchanged (low, pre-existing — not in scope)

Update `04-implement/README.md`: set status to reflect the redraft outcome, add a Redraft Round 1 section documenting the fix and verification result.

---

# Redraft Round 2

## Phase 9: Add `isRefreshError` to ResourceV2Agent

- **Agent**: `rdpi-codder`
- **Output**: Code changes to `src/query-v2/types/agent.types.ts`, `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Depends on**: 8
- **Retry limit**: 2
- **Review issues**: User Feedback

### Prompt

Read REVIEW.md at `c:\Area\projects\fozy-labs\rx-toolkit\.thoughts\2026-03-28-1000_query-v2-bugfixes-and-docs\04-implement\REVIEW.md`.

User feedback: add `isRefreshError` boolean field to the ResourceV2Agent derived state.

`isRefreshError` should be `true` when the underlying fetch errored (`originalStatus === "error"`) but the agent is showing stale data from the previous entry (SWR override makes `status === "refreshing"`). In all other cases it should be `false`.

Changes required:

1. **`src/query-v2/types/agent.types.ts`**: Add `isRefreshError: boolean` to the non-idle branch of `TResourceV2AgentState`. Add `isRefreshError: false` to the idle branch.

2. **`src/query-v2/core/resource/ResourceV2Agent.ts`**:
   - In `_idleState()`: add `isRefreshError: false`.
   - In `_deriveState$()`: compute `const isRefreshError = originalStatus === "error" && status === "refreshing"` (after the SWR override block, alongside existing `isRefreshing`/`isError` derivations). Include `isRefreshError` in the returned object.

Follow existing code patterns precisely. Run `npm run ts-check` after — fix within scope if errors (max 2 attempts).

---

## Phase 10: Verify — `isRefreshError` addition

- **Agent**: `rdpi-tester`
- **Output**: `verification-7.md`
- **Depends on**: 9
- **Retry limit**: 1

### Prompt

Phase 9 added `isRefreshError` to `ResourceV2Agent` per user feedback in REVIEW.md.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `npx vitest run src/query-v2/` — all existing tests pass
3. Read `src/query-v2/types/agent.types.ts` — verify `isRefreshError: boolean` in non-idle branch and `isRefreshError: false` in idle branch of `TResourceV2AgentState`
4. Read `src/query-v2/core/resource/ResourceV2Agent.ts` — verify `isRefreshError` computed as `originalStatus === "error" && status === "refreshing"` and returned in both `_idleState()` and `_deriveState$()`
5. Verify existing tests that snapshot agent state still pass (no missing fields in assertions)

Save report to `04-implement/verification-7.md`. If tests fail, report `Next step: retry-coder` with failure details.

---

## Phase 11: Re-review after Redraft Round 2

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: 10
- **Retry limit**: 2

### Prompt

Re-review the implementation after Redraft Round 2. Read:
- `04-implement/REVIEW.md` — the original review issues and user feedback
- `04-implement/verification-7.md` — verification of the redraft fix
- `src/query-v2/types/agent.types.ts` — modified type file
- `src/query-v2/core/resource/ResourceV2Agent.ts` — modified source file

Verify that:
1. `isRefreshError` field is correctly typed and computed
2. Idle state includes `isRefreshError: false`
3. No existing fields were removed or broken
4. All tests pass per verification-7.md

Update `04-implement/README.md`: set status to `Inprogress`, add a Redraft Round 2 section documenting the `isRefreshError` addition and verification result. Add `src/query-v2/types/agent.types.ts` and `src/query-v2/core/resource/ResourceV2Agent.ts` to the Change Summary if not already listed.

---

# Redraft Round 3

## Phase 12: Fix lifecycle-hooks example and recheck demo app

- **Agent**: `rdpi-codder`
- **Output**: Code changes to `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`, potentially other example files
- **Depends on**: 11
- **Retry limit**: 2
- **Review issues**: User Feedback (Round 3)

### Prompt

Read REVIEW.md at `c:\Area\projects\fozy-labs\rx-toolkit\.thoughts\2026-03-28-1000_query-v2-bugfixes-and-docs\04-implement\REVIEW.md`.

User feedback (Round 3): «Lifecycle Hooks (Query v2)» example is incorrect — the agent did not understand the difference between lifecycle hook APIs. Fix the example and recheck other demo aspects.

Steps:

1. **Understand the actual API**: Read the lifecycle hooks source implementation at `src/query-v2/core/LifecycleHooks.ts` and the type definitions at `src/query-v2/types/resource.types.ts` (look for `onQueryStarted`, `onCacheEntryAdded`, `$queryFulfilled`, `$cacheDataLoaded`, `$cacheEntryRemoved`). Read existing usage in `src/query-v2/core/resource/ResourceV2CacheEntry.ts` to understand how hooks are fired. Also read the Lifecycle Hooks section in `docs/query-v2/README.md` for the documented API.

2. **Fix `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`**: Rewrite the example so it correctly demonstrates the lifecycle hooks API as actually implemented. The example must show real `onQueryStarted` and `onCacheEntryAdded` usage with correct callback signatures and correct usage of `$queryFulfilled`, `$cacheDataLoaded`, `$cacheEntryRemoved`. Follow the same HeroUI Card + `fetches` utility pattern used by other query-v2 examples.

3. **Recheck other examples**: Read all 5 example files in `apps/demos/src/examples/query-v2/` (basic-query, error-swr-states, skip-token, snapshot-hydration, lifecycle-hooks). For each, verify the API usage matches the actual source code. If any other example has incorrect API usage, fix it.

4. **Verify the demo page**: Read `apps/demos/src/pages/QueriesV2Page.mdx` and confirm all tabs are correctly wired to their examples.

Run `npm run ts-check` after all changes. Also run `cd apps/demos && npx tsc --noEmit` to verify example compilation. Fix within scope if errors (max 2 attempts).

---

## Phase 13: Verify — lifecycle-hooks fix and demo recheck

- **Agent**: `rdpi-tester`
- **Output**: `verification-8.md`
- **Depends on**: 12
- **Retry limit**: 1

### Prompt

Phase 12 fixed the lifecycle-hooks example and rechecked other demo examples per user feedback (Round 3) in REVIEW.md.

Run the verification checklist:
1. `npm run ts-check` — no type errors
2. `cd apps/demos && npx tsc --noEmit` — no type errors in demo app
3. Read `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx` — verify `onQueryStarted` and `onCacheEntryAdded` usage matches the actual API in `src/query-v2/core/LifecycleHooks.ts` and `src/query-v2/types/resource.types.ts` (correct callback signatures, correct deferred promise usage)
4. Read all other example files (`basic-query.tsx`, `error-swr-states.tsx`, `skip-token.tsx`, `snapshot-hydration.tsx`) — verify their API usage is correct against source
5. Read `apps/demos/src/pages/QueriesV2Page.mdx` — verify all example tabs still present and correctly wired
6. `npx vitest run src/query-v2/` — all tests still pass

Save report to `04-implement/verification-8.md`. If checks fail, report `Next step: retry-coder` with details.

---

## Phase 14: Re-review after Redraft Round 3

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: 13
- **Retry limit**: 2

### Prompt

Re-review the implementation after Redraft Round 3. Read:
- `04-implement/REVIEW.md` — review issues and all user feedback (Rounds 1–3)
- `04-implement/verification-8.md` — verification of the Round 3 fix
- `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx` — the primary fixed file
- All other example files in `apps/demos/src/examples/query-v2/` — rechecked files

Verify that:
1. The lifecycle-hooks example now correctly demonstrates the actual lifecycle hooks API
2. All other examples use correct API patterns
3. No existing functionality was removed or broken
4. Demo page tabs remain intact

Update `04-implement/README.md`: set status to `Inprogress`, add a Redraft Round 3 section documenting the lifecycle-hooks fix and any other example corrections, with verification result. Update Change Summary if new files were modified.

---
