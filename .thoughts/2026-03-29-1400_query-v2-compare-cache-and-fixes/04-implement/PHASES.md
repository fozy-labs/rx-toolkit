---
title: "Phases: 04-implement"
date: 2026-03-30
stage: 04-implement
---

# Phases: 04-implement

## Phase 1.1: Code — CacheMap + Factory + Consumer Migration + CacheMap Tests

- **Agent**: `rdpi-codder`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/01-cachemap-factory-consumers.md` fully.
Read design documents for reference: `../02-design/03-model.md` (§1–§2, §4–§5), `../02-design/04-decisions.md` (ADR-1 through ADR-6), `../02-design/01-architecture.md` (§4.1).

Implement Tasks 1.1 through 1.10 in order:

1. **Task 1.1** — `src/query-v2/types/cache.types.ts`: Remove `entries()` from `ICacheMap`, change `TCacheMapFactory` signature to `(args, argsKey) => TEntry`, add `devtoolsKey` to `ICacheMapOptions`.
2. **Task 1.2** — `src/query-v2/types/resource.types.ts`: Add `devtoolsKey` to `TResourceV2Options`, add `argsKey: string` to `IResourceV2CacheEntry`.
3. **Task 1.3** — `src/query-v2/core/CacheMap/CompareCacheMap.ts`: Full rewrite — replace Array with `Map<TArgs, TEntry>`, add `_counter`, `_devtoolsKey`, remove `_compareArg`/`_find`/`entries()`, implement O(1) get/getOrCreate/delete/has/clear/size/values.
4. **Task 1.4** — `src/query-v2/core/CacheMap/SerializeCacheMap.ts`: Pass pre-computed `key` as second arg to `this._factory(args, key)` in `getOrCreate`, remove `entries()` method.
5. **Task 1.5** — `src/query-v2/core/resource/ResourceV2.ts`: Change factory closure to passthrough `(args, argsKey) => this._entryFactory(args, argsKey)`, remove `serializeFn` intermediate, add `devtoolsKey` to createCacheMap options, rename `cacheEntries()` → `cacheValues()`.
6. **Task 1.6** — `src/query-v2/core/resource/ResourceV2CacheEntry.ts`: Add `readonly argsKey: string` field, set from `options.entryOptions?.keyParts?.[2] ?? ""`.
7. **Task 1.7** — `src/query-v2/core/Snapshot.ts`: Migrate from `cacheEntries()` to `cacheValues()` + `entry.argsKey`. Update or remove the compare-strategy guard (see plan Details for options).
8. **Task 1.8** — `src/query-v2/api/createApi.ts`: Change `cacheEntries()` to `cacheValues()` in stale check loop.
9. **Task 1.9** — Update existing tests for compilation: `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts` (factory signatures, remove compareArg tests), `src/query-v2/core/resource/__tests__/ResourceV2.test.ts` (`cacheEntries` → `cacheValues`), `src/query-v2/core/__tests__/Snapshot.test.ts` (mock entries with `argsKey`).
10. **Task 1.10** — `src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts`: Write new tests CM20–CM56 covering CompareCacheMap Map-internals, devtools key derivation (monotonic counter, custom function), SerializeCacheMap no-double-serialization, edge cases.

Constraints:
- Follow existing code patterns precisely (naming, indentation, barrel exports, `@/` alias).
- Update `index.ts` barrel exports if any new public symbols are created.
- Maintain TypeScript strict mode compatibility.
- Do NOT modify files outside Phase 1 scope (no lifecycle changes, no demo files, no doc files).
- After implementation, run `npm run ts-check`. If it fails, fix within scope (max 2 attempts).
- Grep for any remaining `cacheEntries` references in `src/query-v2/` and eliminate them.

---

## Phase 1.2: Verify — CacheMap + Factory + Consumer Migration + CacheMap Tests

- **Agent**: `rdpi-tester`
- **Depends on**: 1.1
- **Retry limit**: 1

### Prompt

Phase 1 code changes are complete. Verify them against the plan at `../03-plan/01-cachemap-factory-consumers.md`.

Run the verification checklist:
1. `npm run ts-check` — must pass with zero errors.
2. `npx vitest run src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts` — all CacheMap tests including new CM20–CM56.
3. `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — existing ResourceV2 tests pass.
4. `npx vitest run src/query-v2/core/__tests__/Snapshot.test.ts` — Snapshot tests pass with `cacheValues()` + `entry.argsKey`.
5. Grep `src/query-v2/` for any remaining `cacheEntries` references — must find zero.
6. Grep `src/query-v2/` for any remaining `entries()` usage on ICacheMap — must find zero.
7. Verify CM51 (SerializeCacheMap `serializeArgs` called exactly once per new entry) passes.
8. Verify CM40/CM41 (monotonic counter `"0"`, `"1"`, ...) pass.
9. `npx vitest run src/query-v2/` — full query-v2 test suite passes (regression check).

Save the verification report to `04-implement/verification-1.md` in the feature directory (`.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-1.md`).

Report format: pass/fail per check with error details if failed.
If tests fail, report failures — do not attempt fixes.

---

## Phase 2.1: Code — LifecycleHooks Elimination + Lifecycle Tests

- **Agent**: `rdpi-codder`
- **Depends on**: 1.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/02-lifecycle-hooks-elimination.md` fully.
Read design documents: `../02-design/03-model.md` (§3–§4), `../02-design/04-decisions.md` (ADR-5), `../02-design/02-dataflow.md` (§2.1–§2.2), `../02-design/09-corrections.md` (R9 hydration fix).

Implement Tasks 2.1 through 2.7 in order:

1. **Task 2.1** — `src/query-v2/core/resource/ResourceV2CacheEntry.ts`: Add per-entry lifecycle resolver state (`_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` as nullable `PromiseResolver`), replace old closure callbacks with `TOnCacheEntryAdded`/`TOnQueryStarted`, implement `_fireCacheEntryAdded()` (with hydration check per R9), update `_doFetch()` (supersede old `$queryFulfilled`, resolve/reject resolvers), update `complete()` (settle all resolvers).
2. **Task 2.2** — `src/query-v2/core/resource/ResourceV2.ts`: Remove `LifecycleHooks` import and `_lifecycleHooks` field. Store callbacks directly. Update `_entryFactory` to pass `onCacheEntryAdded`/`onQueryStarted` instead of closure wrappers. Remove `fireCacheEntryAdded`/`fireCacheEntryRemoved` calls. Remove `clearAll()` from `resetCache()`.
3. **Task 2.3** — Delete `src/query-v2/core/LifecycleHooks.ts`.
4. **Task 2.4** — `src/query-v2/core/index.ts`: Remove `LifecycleHooks` export line.
5. **Task 2.5** — Delete `src/query-v2/core/__tests__/LifecycleHooks.test.ts`.
6. **Task 2.6** — `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`: Write per-entry lifecycle tests LH10–LH33 plus edge cases (concurrent entries independence LH20, hydration LH30, refetch rejection LH18, complete() safety net LH24).
7. **Task 2.7** — `src/query-v2/core/resource/__tests__/ResourceV2.test.ts`: Update tests referencing `LifecycleHooks` to verify lifecycle through entry behavior.

Constraints:
- Phase 1 changes are already applied — `ResourceV2.ts` has `cacheValues()`, `ResourceV2CacheEntry.ts` has `argsKey`. Build on top of them.
- Follow existing code patterns precisely.
- Do NOT modify CacheMap files, Snapshot, createApi, demos, or docs.
- After implementation, run `npm run ts-check`. If it fails, fix within scope (max 2 attempts).
- Grep for remaining `LifecycleHooks` imports in `src/query-v2/` — must find zero.

---

## Phase 2.2: Verify — LifecycleHooks Elimination + Lifecycle Tests

- **Agent**: `rdpi-tester`
- **Depends on**: 2.1
- **Retry limit**: 1

### Prompt

Phase 2 code changes are complete. Verify them against the plan at `../03-plan/02-lifecycle-hooks-elimination.md`.

Run the verification checklist:
1. `npm run ts-check` — must pass with zero errors.
2. Grep `src/query-v2/` for `LifecycleHooks` — must find zero imports/references (only test descriptions/comments acceptable).
3. Grep `src/query-v2/core/resource/ResourceV2.ts` for `_lifecycleHooks` — must find zero.
4. Confirm `src/query-v2/core/LifecycleHooks.ts` does NOT exist.
5. Confirm `src/query-v2/core/__tests__/LifecycleHooks.test.ts` does NOT exist.
6. `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` — all lifecycle tests LH10–LH33 pass.
7. Verify LH20 passes (concurrent entries have independent `$queryFulfilled`).
8. Verify LH30 passes (hydrated entry `$cacheDataLoaded` resolves immediately).
9. Verify LH18 passes (refetch rejects old `$queryFulfilled`).
10. Verify LH24 passes (`complete()` settles all resolvers).
11. `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — existing ResourceV2 tests pass.
12. `npx vitest run src/query-v2/` — full query-v2 test suite passes (regression check).

Save the verification report to `04-implement/verification-2.md` in the feature directory (`.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-2.md`).

Report format: pass/fail per check with error details if failed.
If tests fail, report failures — do not attempt fixes.

---

## Phase 3.1: Code — Integration Tests

- **Agent**: `rdpi-codder`
- **Depends on**: 2.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/03-integration-tests.md` fully.
Read design documents: `../02-design/06-testcases.md` (§Integration), `../02-design/05-usecases.md` (UC1–UC3).

Implement Task 3.1:

Create `src/query-v2/__tests__/integration/cachemap-lifecycle-integration.test.ts` with tests IT01–IT08:

- **IT01**: Compare-strategy resource → entry creation → monotonic devtools key → Signal key contains counter. Spy on `stableStringify` to confirm zero serialization calls.
- **IT02**: Serialize-strategy resource → entry creation → `entry.argsKey` matches serialized args. Spy on `serializeArgs`, confirm called exactly once per new entry.
- **IT08**: Custom `devtoolsKey` function flows from resource options → CompareCacheMap → Signal key uses custom value.
- **IT03**: Resource with `onCacheEntryAdded` + `onQueryStarted` → both callbacks fire, `$queryFulfilled` settles.
- **IT04**: Resource with 3 entries + lifecycle hooks → `resetCache()` → all `$cacheEntryRemoved` resolved, pending `$queryFulfilled` rejected, cache empty.
- **IT05**: Serialize-strategy resource with 2+ entries → `Snapshot.getSnapshot()` → entries keyed by serialized args via `cacheValues()` + `entry.argsKey`.
- **IT06**: `createApi` stale check path exercises `cacheValues()` without error.
- **IT07**: `entry.argsKey` is accessible and matches devtools key.

Use real `createCacheMap` — no mocks for CacheMap or lifecycle internals. Mock only `queryFn`.

Constraints:
- Phases 1 and 2 are already applied.
- Follow existing test patterns in `src/query-v2/__tests__/integration/`.
- Do NOT modify any production code files.
- After implementation, run `npm run ts-check`.

---

## Phase 3.2: Verify — Integration Tests

- **Agent**: `rdpi-tester`
- **Depends on**: 3.1
- **Retry limit**: 1

### Prompt

Phase 3 code changes are complete. Verify them against the plan at `../03-plan/03-integration-tests.md`.

Run the verification checklist:
1. `npm run ts-check` — must pass with zero errors.
2. `npx vitest run src/query-v2/__tests__/integration/cachemap-lifecycle-integration.test.ts` — all IT01–IT08 pass.
3. Verify IT01 confirms zero serialization calls for compare strategy.
4. Verify IT02 confirms single serialization call for serialize strategy.
5. Verify IT04 confirms `resetCache()` settles all lifecycle resolvers.
6. Verify IT05 confirms Snapshot works with `cacheValues()` + `entry.argsKey`.
7. `npx vitest run src/query-v2/` — full query-v2 test suite passes (regression check).

Save the verification report to `04-implement/verification-3.md` in the feature directory (`.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-3.md`).

Report format: pass/fail per check with error details if failed.
If tests fail, report failures — do not attempt fixes.

---

## Phase 4.1: Code — Demo Fixes + Documentation

- **Agent**: `rdpi-codder`
- **Depends on**: 1.2
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/04-demos-documentation.md` fully.
Read design documents: `../02-design/01-architecture.md` (§6.2), `../02-design/07-docs.md`, `../02-design/04-decisions.md` (ADR-7).

Implement Tasks 4.1 through 4.7 in order:

1. **Task 4.1** — `apps/demos/src/examples/query-v2/error-swr-states.tsx`: Relabel as SWR error recovery demo. Replace `isError` badge with `isRefreshError` derivation. Remove unreachable error banner. Add `state.error` display. Update comments for SWR semantics. Update state log entry.
2. **Task 4.2** — `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`: Remove or relabel misleading `isError` display.
3. **Task 4.3** — `apps/demos/src/examples/query-v2/basic-query.tsx`: Remove `isError` badge/display or add comment explaining always-false.
4. **Task 4.4** — `apps/demos/src/examples/query-v2/optimistic-patches.tsx`: Remove unreachable `if (state.isError)` early return.
5. **Task 4.5** — `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`: Remove unreachable `{state.isError && (...)}` block.
6. **Task 4.6** — `docs/query-v2/README.md`: Add `devtoolsKey` parameter row, add compare-strategy counter explanation under Cache Strategies, clarify `doCacheArgs` applies only to serialize strategy.
7. **Task 4.7** — `docs/query-v2/devtools.md`: Add `devtoolsKey` option reference, add Signal key format paragraph (compare vs serialize strategy keys).

Constraints:
- Do NOT change queryFn logic in any demo file.
- Do NOT modify `src/` production code or test files.
- Follow existing demo styling patterns and Russian-language UI text conventions.
- Documentation additions must be proportional — one option row, short paragraphs, one clarification.

---

## Phase 4.2: Verify — Demo Fixes + Documentation

- **Agent**: `rdpi-tester`
- **Depends on**: 4.1
- **Retry limit**: 1

### Prompt

Phase 4 code changes are complete. Verify them against the plan at `../03-plan/04-demos-documentation.md`.

Run the verification checklist:
1. `npm run ts-check` — must pass with zero errors.
2. `cd apps/demos && npm run build` — demo app builds without errors.
3. Grep `apps/demos/src/examples/query-v2/error-swr-states.tsx` for `isRefreshError` — must find at least one occurrence.
4. Grep `apps/demos/src/examples/query-v2/` for misleading `isError` displays — verify each file per DV01–DV07 criteria.
5. Verify `docs/query-v2/README.md` contains `devtoolsKey` in a parameter table row.
6. Verify `docs/query-v2/README.md` contains `doCacheArgs` clarification about serialize strategy.
7. Verify `docs/query-v2/devtools.md` mentions `devtoolsKey` and Signal key format.
8. Grep all modified demo files for queryFn changes — must find zero (queryFn logic unchanged).

Save the verification report to `04-implement/verification-4.md` in the feature directory (`.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-4.md`).

Report format: pass/fail per check with error details if failed.
If tests fail, report failures — do not attempt fixes.

---

## Phase Final: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: 1.2, 2.2, 3.2, 4.2
- **Retry limit**: 2

### Prompt

All implementation phases are complete. Review the full implementation.

Read:
- Task file: `../TASK.md`
- Plan phases: `../03-plan/01-cachemap-factory-consumers.md`, `../03-plan/02-lifecycle-hooks-elimination.md`, `../03-plan/03-integration-tests.md`, `../03-plan/04-demos-documentation.md`
- Research: `../01-research/README.md`
- Design: `../02-design/README.md`, `../02-design/03-model.md`, `../02-design/04-decisions.md`
- Verification reports: `verification-1.md`, `verification-2.md`, `verification-3.md`, `verification-4.md`

Write `README.md` in the `04-implement/` directory (replace the placeholder) with:
- Implementation record: date, status, plan link
- Phase completion status (4/4 plan phases)
- Verification results summary from all verification-*.md files
- Quality review checklist: all plan phases implemented, verification passed, no out-of-scope files modified, code follows project patterns, barrel exports correct, TypeScript strict mode, docs proportional, no security vulnerabilities
- List of all changed files (grouped by plan phase)
- Post-implementation recommendations (build, manual testing areas — especially demo visual checks DV01–DV07)
- Recommended commit message

---

# Redraft Round 1

## Phase R1.1: Fix issues #1, #2

- **Agent**: `rdpi-codder`
- **Output**: Code fixes in `src/`, `apps/demos/src/examples/query-v2/`
- **Depends on**: Final
- **Retry limit**: 2
- **Review issues**: #1, #2

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/REVIEW.md`.
Your assigned issues: #1, #2.

**Issue #1** — `check:all` fails.
Run `npm run check:all` at the project root. Read the output, identify every error, and fix them all. Iterate until `check:all` passes cleanly (max 2 attempts).

**Issue #2** — Demo files incorrectly removed `isError` instead of using `isRefreshError`.
Affected files:
- `apps/demos/src/examples/query-v2/error-swr-states.tsx`
- `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
- `apps/demos/src/examples/query-v2/basic-query.tsx`
- `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
- `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`

For each file: where `isError` displays were removed, restore error display UI but use `isRefreshError` (derived from the query state) instead of the removed `isError`. Adjust labels/text to reflect SWR refresh-error semantics. Do NOT re-introduce `isError` — the field no longer exists. Follow existing demo styling patterns and Russian-language UI text conventions.

Constraints:
- Do NOT change `queryFn` logic in any demo file.
- Do NOT modify files outside the scope of these two issues.
- After fixes, run `npm run check:all` to confirm it passes.

---

## Phase R1.2: Verify fixes for issues #1, #2

- **Agent**: `rdpi-tester`
- **Output**: `verification-redraft-1.md`
- **Depends on**: R1.1
- **Retry limit**: 1
- **Review issues**: #1, #2

### Prompt

Redraft Round 1 code fixes are complete. Verify them.

Run the verification checklist:
1. `npm run check:all` at the project root — must pass with zero errors.
2. `npm run ts-check` — must pass with zero errors.
3. `npx vitest run src/query-v2/` — full query-v2 test suite passes (regression check).
4. `cd apps/demos && npm run build` — demo app builds without errors.
5. Grep `apps/demos/src/examples/query-v2/error-swr-states.tsx` for `isRefreshError` — must find at least one occurrence.
6. Grep `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx` for `isRefreshError` — must find at least one occurrence (if error display was restored).
7. Grep `apps/demos/src/examples/query-v2/` for `isError` usage that is NOT inside a comment — must find zero (field no longer exists).
8. Grep all modified demo files for queryFn changes — must find zero (queryFn logic unchanged).

Save the verification report to `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-redraft-1.md`.

Report format: pass/fail per check with error details if failed.
If tests fail, report failures — do not attempt fixes.

---

# Redraft Round 2

## Phase R2.1: Fix issues #1, #2 — replace manual isRefreshError derivations with direct field access

- **Agent**: `rdpi-codder`
- **Output**: Code fixes in `apps/demos/src/examples/query-v2/`
- **Depends on**: R1.2
- **Retry limit**: 2
- **Review issues**: #1, #2

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/REVIEW.md`.
Your assigned issues: #1, #2.

**Step 1 — Confirm `isRefreshError` exists as a state field.**
Read the query-v2 machine state types (look in `src/query-v2/types/` for the resource/operation state interface that defines the fields available on `state`). Confirm that `isRefreshError` is a direct boolean field on the state object — not something that needs to be derived.

**Step 2 — Fix ALL demo files.**
Affected files (check every one):
- `apps/demos/src/examples/query-v2/error-swr-states.tsx`
- `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
- `apps/demos/src/examples/query-v2/basic-query.tsx`
- `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
- `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`

For each file: find any manual derivation of `isRefreshError` (e.g. `state.status === 'success' && state.error != null`, or any expression that computes the same thing), and replace it with direct `state.isRefreshError` field access. Do NOT derive the value — use the field directly.

If a file already uses `state.isRefreshError` directly (not derived), leave it as-is.

Constraints:
- Do NOT change `queryFn` logic in any demo file.
- Do NOT modify `src/` production code or test files.
- After fixes, run `npm run check:all` to confirm it passes.

---

## Phase R2.2: Verify isRefreshError direct field usage + check:all

- **Agent**: `rdpi-tester`
- **Output**: `verification-redraft-2.md`
- **Depends on**: R2.1
- **Retry limit**: 1
- **Review issues**: #1, #2

### Prompt

Redraft Round 2 code fixes are complete. Verify them by reading actual source code, not just grepping for keywords.

Run the verification checklist:

1. `npm run check:all` at the project root — must pass with zero errors.
2. For EACH demo file listed below, read the FULL file content and verify that `isRefreshError` is used as a **direct field access** (`state.isRefreshError`), NOT as a manual derivation (e.g. `state.status === 'success' && state.error != null` or any equivalent boolean expression):
   - `apps/demos/src/examples/query-v2/error-swr-states.tsx`
   - `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
   - `apps/demos/src/examples/query-v2/basic-query.tsx`
   - `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
   - `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`
3. For each file, report the exact line(s) where `isRefreshError` appears and confirm it is `state.isRefreshError` (direct property access).
4. Grep all demo files for any remaining manual derivation pattern: `state.status === 'success' && state.error` — must find zero occurrences.
5. `cd apps/demos && npm run build` — demo app builds without errors.
6. `npx vitest run src/query-v2/` — full query-v2 test suite passes (regression check).

Save the verification report to `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-redraft-2.md`.

Report format: pass/fail per check. For check #3, list each file with the exact line number and code snippet showing `state.isRefreshError` usage.
If any check fails, report failures — do not attempt fixes.

---

## Phase R2.3: Re-review after Redraft Round 2

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: R2.2
- **Retry limit**: 2

### Prompt

Re-review the demo files modified in Redraft Round 2 and the verification report.

Read:
- REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/REVIEW.md` (issues #1, #2)
- Verification report: `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/04-implement/verification-redraft-2.md`
- All demo files:
  - `apps/demos/src/examples/query-v2/error-swr-states.tsx`
  - `apps/demos/src/examples/query-v2/lifecycle-hooks.tsx`
  - `apps/demos/src/examples/query-v2/basic-query.tsx`
  - `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
  - `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`

Verify:
1. Issue #1 is resolved: every demo file uses `state.isRefreshError` as direct field access, with zero manual derivations.
2. Issue #2 is resolved: verification-redraft-2.md shows actual code reading (line numbers and snippets), not just keyword grep counts.
3. `check:all` passed.
4. No regressions: demo build passes, query-v2 tests pass.

Update `04-implement/README.md` status and add Redraft Round 2 results to the verification summary.

---
