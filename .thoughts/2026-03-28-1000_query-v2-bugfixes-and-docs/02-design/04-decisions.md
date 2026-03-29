---
title: "Architecture Decisions: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

# Architecture Decisions

This document formalizes all design decisions made across the prior design documents (`00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`) into ADR format. Each ADR traces back to a specific open question (Q1–Q12) and supporting research findings.

---

## ADR-1: Snapshot Hydration Strategy — Lazy Fetch with `initialMachine`

### Status
Proposed

### Context
`ResourceV2CacheEntry` constructor unconditionally calls `_doFetch()` on construction (line 57). When `createApi` hydrates entries from `initialSnapshot`, the entry factory creates a new `ResourceV2CacheEntry` — triggering a fetch — before `entry.set(machine)` applies the snapshot data. This wastes a network request for every hydrated entry, even when the data is within `maxSnapshotDataAge`. Test E07 explicitly documents this as expected behavior: `expect(queryFn).toHaveBeenCalledTimes(1)` with comment "Entry auto-fetches on construction." [ref: ../01-research/03-problem-analysis-part1.md#Bug #1]

TanStack Query is the only surveyed library with explicit age-aware initial data semantics (`initialData` + `initialDataUpdatedAt`), where data within `staleTime` does not trigger a refetch. SWR always revalidates fallback data by default. [ref: ../01-research/02-external-research.md#1. Initial/Seed Data with Age Checking]

### Options Considered

1. **Lazy fetch with `initialMachine`** — Add an optional `initialMachine` parameter to `ResourceV2CacheEntry` constructor. If provided, use it as initial state and skip `_doFetch()`. `hydrateEntry` passes the snapshot machine through `_entryFactory`. Pros: No wasted network request; clean semantics; entry starts in correct state. Cons: Changes constructor signature; `_entryFactory` signature changes; `CacheMap.getOrCreate` needs to forward the parameter.

2. **Abort-on-set** — Keep constructor as-is but have `set()` abort any inflight fetch when the new state is `MachineSuccess`. Pros: Minimal constructor change. Cons: `queryFn` is still called (wasted request); abort is a side-effect of `set()` which is surprising; doesn't prevent the network round-trip. [ref: ../01-research/05-open-questions.md#Q3]

3. **Two-phase construction** — Separate entry creation from fetch initiation with a `start()` method. Pros: Most flexible; explicit lifecycle. Cons: Largest refactor; every existing `getOrCreate` call site must also call `start()`.

### Decision
**Option 1 — Lazy fetch with `initialMachine`**. User answered Q3: "Option 1 — initialMachine (lazy fetch)."

The constructor accepts an optional `initialMachine` in `IResourceV2CacheEntryOptions`. When provided, `super(initialMachine, options)` is called and `_doFetch()` is skipped. When absent, the existing behavior (`super(new MachinePending(args), options)` + `_doFetch()`) is preserved. `ResourceV2._entryFactory` gains an optional `initialMachine` parameter forwarded to the constructor. `hydrateEntry` passes the snapshot machine through this chain, eliminating both the wasted fetch and the now-redundant `entry.set(machine)` call. [ref: 03-model.md#2. ResourceV2CacheEntry Constructor Changes]

### Consequences
- **Positive**: Zero wasted network requests on snapshot hydration. Entries start directly in `MachineSuccess` state from snapshot data. Stale entries are subsequently invalidated via `maxSnapshotDataAge` check, which triggers `_doFetch` through the normal `invalidate()` path.
- **Positive**: `onDataLoaded` is correctly NOT called for hydrated entries (no network fetch occurred), so `$cacheDataLoaded` remains pending until the first actual fetch — or is rejected on entry removal per ADR-5.
- **Negative**: `_entryFactory` signature changes. `CacheMap.getOrCreate` may need modification to forward the parameter, or `hydrateEntry` bypasses `getOrCreate`. Implementation detail deferred to Plan stage.
- **Risk**: Existing test E07 must be updated to assert `queryFn` is NOT called for fresh hydrated entries. The test currently documents the bug as expected behavior.

---

## ADR-2: `onQueryStarted` Lifecycle Wiring into `_doFetch`

### Status
Proposed

### Context
`LifecycleHooks.fireQueryStarted()` and `resolveQueryFulfilled()` are fully implemented, typed, documented in README and `optimistic-updates.md`, and unit-tested in isolation (LH05). However, no production code calls either method — they are dead code. `ResourceV2CacheEntry._doFetch()` proceeds from abort handling to `queryFn` invocation to result handling without invoking the lifecycle hooks. The `optimistic-updates.md` guide describes patterns (`$queryFulfilled` for pessimistic updates) that depend on this non-functional hook. [ref: ../01-research/03-problem-analysis-part1.md#Bug #2]

RTK Query's `onQueryStarted` fires on every query/mutation dispatch, providing `queryFulfilled` promise, `dispatch`, and `updateCachedData`. It is the canonical pattern for both optimistic and pessimistic update workflows. [ref: ../01-research/02-external-research.md#2. Lifecycle Hooks]

### Options Considered

1. **Wire it in** — Add `fireQueryStarted`/`resolveQueryFulfilled` calls into `ResourceV2CacheEntry._doFetch`. Pros: Fulfills documented API contract; enables optimistic update patterns; matches RTK Query semantics. Cons: Increases `_doFetch` complexity; needs handling of abort/retry flows; adds per-fetch overhead.

2. **Remove it** — Delete `fireQueryStarted`, `resolveQueryFulfilled`, `onQueryStarted` option, and related types. Update docs. Pros: Eliminates dead code; simplifies API. Cons: Breaking change; doc rewrite needed.

3. **Defer** — Mark as `@experimental` or `@deprecated`. Pros: No code change now. Cons: Leaves broken API; confusing docs. [ref: ../01-research/05-open-questions.md#Q1]

### Decision
**Option 1 — Wire into `_doFetch`**. User answered Q1: "Option 1 — Wire into `_doFetch`."

`_doFetch` calls `fireQueryStarted(args, entry)` after abort handling and before `queryFn` invocation. On success, `resolveQueryFulfilled(args, { data })` resolves the `$queryFulfilled` promise. On error, `resolveQueryFulfilled(args, { error })` rejects it. On abort (stale check shows controller mismatch), no settlement occurs — the newer `_doFetch` owns the lifecycle and will create its own `fireQueryStarted` → resolver. [ref: 01-architecture.md#5. Sequence Diagram — Fetch Lifecycle]

### Consequences
- **Positive**: Documented `onQueryStarted` API becomes functional. `optimistic-updates.md` patterns work as described.
- **Positive**: `$queryFulfilled` promise enables pessimistic update patterns (await server confirmation before updating cache).
- **Negative**: Each `_doFetch` invocation gains two additional method calls (`fireQueryStarted`, `resolveQueryFulfilled`). Overhead is minimal (promise creation + callback invocation).
- **Risk**: Multiple rapid `_doFetch` calls (invalidate → refetch cycles) each call `fireQueryStarted`, creating overlapping `$queryFulfilled` resolvers keyed by args. `_queryResolvers` map is overwritten per args, orphaning the previous resolver. `clearAll()` rejects orphaned resolvers on cache reset. This matches RTK Query behavior where each dispatch creates a new `onQueryStarted` invocation. [ref: 02-dataflow.md#$queryFulfilled Promise Timing]
- **Risk**: Hydrated entries (ADR-1) skip `_doFetch` entirely, so `onQueryStarted` does not fire for them. This is correct — hydrated entries have no associated query.

---

## ADR-3: Error-Transparent SWR Semantics with `previous$` Clearing Fix

### Status
Proposed

### Context
Bug #3 has two sub-issues in `ResourceV2Agent._deriveState$`: (a) `isError` is `false` while `error` is non-null when cross-args SWR applies, and (b) `previous$` is never cleared because the clearing condition reads the already-overridden `status` variable instead of `currentMachine.status`. External research unanimously confirms that all major libraries (RTK Query, TanStack Query, SWR, Apollo Client) expose `isError: true` alongside stale data when a refetch fails. No library masks errors when stale data exists. [ref: ../01-research/02-external-research.md#3. SWR Error State Management]

The failure path: agent starts args2 while args1 is successful → `previous$` = args1 entry → args2 fails → `status` overridden from `"error"` to `"refreshing"` → `isError = (status === "error")` = `false` → `previous$` clearing checks overridden `status` which is `"refreshing"`, not `"error"`, so `previous$` persists indefinitely. [ref: ../01-research/03-problem-analysis-part1.md#Bug #3]

### Options Considered

1. **Error-transparent SWR** — Keep stale data from `previous$` but derive `isError` from `currentMachine.status` (before override). Clear `previous$` using `currentMachine.status` as well. Pros: Matches industry convention; no information loss; consumer decides how to render. Cons: Changes behavior for anyone relying on `status === "refreshing"` during errors.

2. **Refreshing-with-error compound state** — Introduce `isRefreshError` flag while keeping `status = "refreshing"` and `isError: false`. Pros: More granular; no breaking change to `status`. Cons: Adds API surface; diverges from all established patterns; `isError: false` with non-null `error` remains counterintuitive.

3. **Discard SWR on error** — Clear `previous$` on error, expose raw error state. Pros: Simple. Cons: Loses SWR benefit; user sees flash of empty + error. [ref: ../01-research/05-open-questions.md#Q2]

### Decision
**Option 1 — Error-transparent SWR**. User answered Q2: "Option 1 — Error-transparent SWR + fix (b) `previous$` clearing bug."

The fix captures `originalStatus = currentMachine.status` before the SWR override block. `isError` is derived as `originalStatus === "error"`. The `previous$` clearing condition uses `originalStatus` instead of the (potentially overridden) `status`. The display-level `status` remains `"refreshing"` when SWR data is provided, as a hint that stale data is being shown. [ref: 02-dataflow.md#3. SWR Error State Derivation]

### Consequences
- **Positive**: `isError: true` when `error` is non-null — matches universal pattern across RTK Query, TanStack Query, SWR, Apollo Client.
- **Positive**: `previous$` is properly cleared on error, preventing indefinite stale override persistence.
- **Positive**: Consumers can now pattern-match on `isError` to decide whether to show error banners alongside stale data.
- **Negative**: Consumers who relied on `isError: false` during cross-args SWR error will see a behavior change. This is considered a bugfix, not a breaking change.
- **State combination now possible**: `{ status: "refreshing", isError: true, data: staleData, error: Error }` — previously impossible. [ref: 03-model.md#5. SWR State Derivation Types]

---

## ADR-4: Patcher Catch-Block Return with `isConsistencyViolation`

### Status
Proposed

### Context
`Patcher.resolvePatches` catch block (lines 86–91) sets `isConsistencyViolation = true` locally but returns `{ data: currentData, patchState: null }` — the flag never reaches the caller. In `_finishPatch`, the violation detection checks `patchState?.isConsistencyViolation === true` (fails when `patchState` is `null`) and a heuristic `patchState === null && type === "aborted"` (fails when `type === "committed"`). Result: commit-path `applyPatches` failures are silently swallowed, leaving entries with stale/incorrect data and no auto-invalidation. [ref: ../01-research/04-problem-analysis-part2.md#Bug #4]

RTK Query uses Immer-based patches similarly but recommends tag invalidation for concurrent cases, acknowledging that positional patches can produce incorrect results when underlying data structure changes. Apollo Client avoids this entirely via layered optimistic storage. [ref: ../01-research/02-external-research.md#4. Optimistic Update Rollback]

### Options Considered

1. **Fix the return** — Catch block returns `{ data: currentData, patchState: { patches: [], originalData: currentData, isConsistencyViolation: true } }`. Existing `_finishPatch` detection via `patchState?.isConsistencyViolation` works without changes. Pros: Smallest fix; single change point. Cons: Semantics of empty `patches` array with a violation flag.

2. **Separate `isConsistencyViolation` field on return** — Add field to `IPatchResolution`. Update `_finishPatch` to check both. Pros: Explicit; doesn't overload `patchState`. Cons: Changes return type.

3. **Treat `patchState === null` as always violation** — No `Patcher` change; simplify detection. Pros: No `Patcher` change. Cons: `patchState === null` occurs in non-violation scenarios (all patches resolved cleanly); false positives cause unnecessary invalidations. [ref: ../01-research/05-open-questions.md#Q4]

### Decision
**Option 1 — Fix catch return**. User answered Q4: "Option 1 — Fix catch return."

The catch block returns a valid `TPatchState` with `isConsistencyViolation: true`, empty `patches`, and `currentData` as `originalData`. `TPatchState` already contains the `isConsistencyViolation` field in its type definition — no type changes needed. The existing `_finishPatch` check `resolution.patchState?.isConsistencyViolation === true` now correctly detects the violation and calls `invalidate()`. [ref: 03-model.md#4. Patcher.resolvePatches Return Type]

### Consequences
- **Positive**: Commit-path `applyPatches` failures now trigger auto-invalidation via `_finishPatch`, causing a refetch with fresh server data.
- **Positive**: No changes to `_finishPatch` detection logic, `IPatchResolution` interface, or `TPatchState` type.
- **Positive**: The abort-path heuristic (`patchState === null && type === "aborted"`) remains as a secondary detection for non-throw abort scenarios.
- **Negative**: `_doFetch` success handler (line 170–180) also calls `resolvePatches` but has no violation check. With the fix, the machine will carry a `patchState` with `isConsistencyViolation: true`, but the violation is not acted upon immediately. The next `_finishPatch` call will detect and invalidate. This is acceptable for this scope. [ref: 02-dataflow.md#Note on the secondary call site]
- **Risk**: Empty `patches` array in the returned `TPatchState` is semantically unusual but harmless — it correctly indicates "all patches cleared due to violation."

---

## ADR-5: `$cacheDataLoaded` Rejection in `fireCacheEntryRemoved`

### Status
Proposed

### Context
When `resetCache` is called, `entry.complete()` synchronously triggers `fireCacheEntryRemoved` which deletes the resolver from `_entryResolvers` before `clearAll()` can reject `$cacheDataLoaded`. For entries where data was never loaded (still pending/error), the promise hangs indefinitely. RTK Query explicitly rejects `cacheDataLoaded` with `Error("Promise never resolved before cacheEntryRemoved.")` when cache entries are removed before data loads — this is the canonical pattern. [ref: ../01-research/04-problem-analysis-part2.md#Bug #5]

GC-triggered entry removal follows the same `onClean$` → `fireCacheEntryRemoved` path and has the same hanging promise issue. [ref: ../01-research/05-open-questions.md#Q12]

### Options Considered

1. **Reject in `fireCacheEntryRemoved`** — Before deleting the resolver entry, reject `dataLoaded`. Covers both `resetCache` and GC-triggered removal. Pros: Single fix point; covers all removal paths. Cons: `fireCacheEntryRemoved` gains rejection responsibility.

2. **Reorder `resetCache`** — Call `clearAll()` before `entry.complete()`. Pros: Uses existing logic. Cons: Only fixes `resetCache`, not GC; may introduce ordering issues with subsequent `complete()` calls.

3. **Both** — Reject in `fireCacheEntryRemoved` AND keep `clearAll` as defense-in-depth. Pros: Resilient. Cons: Duplicate logic; `clearAll` rejection becomes redundant no-op for already-settled promises. [ref: ../01-research/05-open-questions.md#Q5]

### Decision
**Option 1 — Reject in `fireCacheEntryRemoved`**. User answered Q5: "Option 1 — Reject in `fireCacheEntryRemoved`." User answered Q12: "Auto-covered by Q5 (Option 1)."

`fireCacheEntryRemoved` unconditionally calls `resolvers.dataLoaded.reject(new Error("Promise never resolved before cacheEntryRemoved."))` before resolving `$cacheEntryRemoved` and deleting the map entry. `PromiseResolver` does not track settlement state — calling `reject()` on an already-resolved promise is a no-op at the JavaScript level, so no `isPending` check is needed. [ref: 03-model.md#3. LifecycleHooks Resolver Lifecycle]

### Consequences
- **Positive**: Both `resetCache` and GC-triggered removal paths reject pending `$cacheDataLoaded` promises, preventing memory leaks and hanging consumers.
- **Positive**: Error message matches RTK Query's canonical pattern, making behavior predictable for developers familiar with RTK Query.
- **Positive**: `clearAll()` becomes a safe no-op for entry resolvers (map is already empty after `fireCacheEntryRemoved` deletions). It still serves its purpose for `_queryResolvers`.
- **Negative**: `fireCacheEntryRemoved` now has dual responsibility (reject `dataLoaded` + resolve `entryRemoved` + delete). The method is still simple (3 operations in sequence).
- **Risk**: User code in `onCacheEntryAdded` must handle `$cacheDataLoaded` rejection gracefully (try/catch around `await $cacheDataLoaded`). This matches RTK Query's documented usage pattern. [ref: ../01-research/02-external-research.md#5. Cache Reset and Pending Promises]

---

## ADR-6: `lastError` Field on `MachineSuccess` for Same-Args Refetch Errors

### Status
Proposed

### Context
When a same-args refetch fails, `MachineRefreshing.errorHappened()` returns `MachineSuccess` with stale data, discarding the error entirely at the machine level. The consumer has no way to know that the data is stale due to a refetch failure. External research shows RTK Query and TanStack Query both expose refetch errors alongside stale data. TanStack Query provides `isRefetchError` distinctly from `isLoadingError`. [ref: ../01-research/02-external-research.md#3. SWR Error State Management]

This is not one of the 5 reported bugs but was raised as Q10. The user decided to include it in scope. [ref: ../01-research/05-open-questions.md#Q10]

### Options Considered

1. **Leave as-is** — Machine-level SWR silently discards refetch errors. Pros: Simpler machine model. Cons: Same-args refetch errors invisible to consumer.

2. **Add `lastError` to `MachineSuccess`** — Optional `lastError?: unknown` field set by `errorHappened()`, cleared by `successHappened()` and initial fetch. Pros: Preserves SWR data while exposing error info; additive change; no breaking changes to existing consumers who don't use the field. Cons: Changes machine type; `MachineSuccess` can now carry error-adjacent information.

3. **Out of scope** — Address in a separate task. Pros: Keeps scope bounded. Cons: Known issue left unaddressed. [ref: ../01-research/05-open-questions.md#Q10]

### Decision
**Option 2 — Add `lastError` to `MachineSuccess`**. User answered Q10: "Option 2 — Add `lastError` to `MachineSuccess` (in scope)."

`MachineSuccess` gains `readonly lastError?: unknown` (defaults to `undefined`). `MachineRefreshing.errorHappened(error)` passes `error` as the `lastError` parameter. `MachineRefreshing.successHappened(data)` constructs `MachineSuccess` without `lastError` (cleared). `MachineSuccess.cloneWith()` propagates `lastError` unless overridden. `TResourceV2AgentState` gains `lastError?: unknown` exposed from the current machine. [ref: 03-model.md#1. MachineSuccess Type Extension]

### Consequences
- **Positive**: Consumers can detect stale data from refetch errors via `state.lastError !== undefined` and show appropriate UI (e.g., "Data may be outdated — last refresh failed").
- **Positive**: Fully additive — existing consumers who don't read `lastError` are unaffected.
- **Positive**: `MachineSuccess.error` remains `null` (formal error field), preserving the invariant that `MachineSuccess` always has `error === null`. `lastError` is supplementary.
- **Negative**: `MachineSuccess` constructor gains one parameter. `TSuccessState` type gains one optional field.
- **Negative**: `_deriveState$` must expose `lastError` from the current machine, adding one field read to the derived state computation.
- **Risk**: `lastError` persists through `cloneWith()` (patch operations). A patch commit on stale data will carry `lastError` until the next successful fetch. This is intentional — the error is still relevant until fresh data arrives. [ref: 03-model.md#State Transitions Populating/Clearing lastError]

---

## ADR-7: Documentation Scope — Incremental Fixes + Targeted Additions

### Status
Proposed

### Context
Documentation has 3 factual errors: `MachineIdle` referenced in API docs but doesn't exist (machines are `pending`, `success`, `error`, `refreshing`), `devtools.md` references options absent from the type system, and `onQueryStarted` is documented as functional but never fires. The structure (README + 3 guides) covers most of the API surface. [ref: ../01-research/01-codebase-analysis.md#Documentation Structure]

External research shows TanStack Query's documentation has ~25 guides + per-export API docs — a full structural rewrite would be disproportionate for a bugfix-focused task. Migration guide from v1 to v2 is deferred per user decision. [ref: ../01-research/05-open-questions.md#Q7] [ref: ../01-research/05-open-questions.md#Q8]

### Options Considered

1. **Incremental fix** — Correct factual errors only. Leave structure intact. Pros: Minimal effort. Cons: Doesn't address structural gaps.

2. **Structural rewrite** — TanStack-style reorganization. Pros: Professional. Cons: Significant effort; scope creep; premature for a bugfix task.

3. **Incremental fix + targeted additions** — Fix errors, add 2–3 missing guides, expand API reference for changed APIs. Pros: Balanced; addresses critical gaps. Cons: Partially reorganized docs can feel inconsistent. [ref: ../01-research/05-open-questions.md#Q7]

### Decision
**Option 3 — Incremental fix + targeted additions**. User answered Q7: "Option 3." User answered Q8: "Defer — brief note in README."

Fix 3 factual errors: `MachineIdle` → `MachinePending` reference, add note about outdated `devtools.md` options, update `onQueryStarted` docs after Bug #2 fix. Add targeted guides for error handling (covering Bug #3 fix, `lastError`, cross-args SWR semantics) and lifecycle hooks (covering `onCacheEntryAdded`, `onQueryStarted` after Bug #2 wiring). Update `optimistic-updates.md` to reflect functional `$queryFulfilled`. Add brief note about v1→v2 migration being deferred. [ref: 01-architecture.md#Fix Area 6]

### Consequences
- **Positive**: Documented API accurately reflects implementation after all bug fixes.
- **Positive**: Error handling guide helps users understand the new SWR semantics and `lastError` field.
- **Positive**: Lifecycle hooks guide validates the `onQueryStarted` wiring with working examples.
- **Negative**: Partial additions alongside existing structure may feel inconsistent. Acceptable for bugfix scope.
- **Risk**: Docs for `devtools.md` are noted as outdated but not fully fixed (devtools integration itself is out of scope). A note is added instead.

---

## ADR-8: Interactive Examples — Minimal Set of 4–5

### Status
Proposed

### Context
Existing demos cover `simple-resource`, `optimistic-patches`, `ssr-snapshot`. Missing: error states, SKIP token, cache strategies, GC, lifecycle hooks. TASK.md specifies "visual, without commands/mutations." [ref: ../01-research/01-codebase-analysis.md#Demo app]

### Options Considered

1. **Minimal set (4–5 examples)** — Basic query, error handling, SWR behavior, SKIP token, snapshot hydration. Pros: Quick to build; covers core use cases; doubles as visual regression for bug fixes. Cons: Doesn't showcase advanced features.

2. **Comprehensive set (6–8 examples)** — Add cache strategies, GC visualization, multi-agent. Pros: Thorough. Cons: Significant effort; may duplicate existing demos.

3. **Bug-driven examples** — Specifically demonstrate fixed behaviors. Pros: Tied to task. Cons: Not general-purpose educational examples. [ref: ../01-research/05-open-questions.md#Q9]

### Decision
**Option 1 — Minimal set (4–5 examples)**. User answered Q9: "Option 1 — Minimal (4–5 примеров)."

Build: (1) basic query — simple resource fetch with loading/success states; (2) error/SWR states — showcases Bug #3 fix with cross-args error + stale data; (3) SKIP token — conditional fetching with `SKIP`; (4) snapshot hydration — showcases Bug #1 fix with `initialSnapshot`. Optional 5th: lifecycle hooks (`onQueryStarted`, `onCacheEntryAdded`). [ref: 01-architecture.md#Fix Area 6]

### Consequences
- **Positive**: 4–5 focused examples covering the most impactful behaviors.
- **Positive**: Error/SWR and snapshot examples double as visual regression tests for Bugs #1 and #3.
- **Negative**: Advanced features (cache strategies, GC, multi-agent) remain without interactive demos.
- **Risk**: Examples must be kept in sync with API changes. Minimal set reduces maintenance burden.

---

## ADR-9: Mandatory Regression Tests for Each Bug Fix

### Status
Proposed

### Context
All 5 bugs lack tests covering the specific failure scenarios. Test E07 for Bug #1 explicitly accepts the buggy behavior. Bug #2 has no integration test verifying `onQueryStarted` fires during actual query lifecycle. Bug #3 has no test for error + previous data SWR scenario. Bug #4 has no test for commit-path `applyPatches` throw. Bug #5 has no test for `$cacheDataLoaded` behavior on `resetCache`. [ref: ../01-research/03-problem-analysis-part1.md] [ref: ../01-research/04-problem-analysis-part2.md]

### Options Considered

1. **Mandatory** — Each bug fix includes a regression test that fails before the fix and passes after. Pros: Prevents regressions; documents expected behavior; research already identified exact scenarios and test gaps. Cons: Minor additional effort.

2. **Best-effort** — Write tests where practical. Pros: Flexibility. Cons: Some fixes may regress. [ref: ../01-research/05-open-questions.md#Q11]

### Decision
**Option 1 — Mandatory**. User answered Q11: "Option 1 — Mandatory."

Each bug fix must include:
- At least one unit or integration test that validates the corrected behavior for the specific failure scenario identified in research.
- For Bug #1: Update test E07 to assert `queryFn` is NOT called on fresh snapshot hydration; add test for stale entries triggering fetch.
- For Bug #2: Integration test verifying `onQueryStarted` callback fires during `_doFetch` and `$queryFulfilled` settles on success/error.
- For Bug #3: Test verifying `isError: true` when cross-args SWR applies with error + previous data; test verifying `previous$` is cleared.
- For Bug #4: Test verifying `isConsistencyViolation` is detected and `invalidate()` is called when commit-path `applyPatches` throws.
- For Bug #5: Test verifying `$cacheDataLoaded` is rejected when `resetCache` is called before data loads; test for GC-triggered removal.
- For `lastError`: Test verifying `lastError` is set on same-args refetch failure and cleared on next success.

### Consequences
- **Positive**: Each bug is documented as a test case, preventing regressions.
- **Positive**: Test scenarios are already precisely defined in research documents — test writing is straightforward.
- **Negative**: Minor additional implementation effort per fix. Proportional to the value of regression prevention.

---

## ADR-10: Independent Fix Strategy with Integration Test Verification

### Status
Proposed

### Context
Bugs #1 and #2 share overlapping code in `ResourceV2CacheEntry` (constructor and `_doFetch`). Bugs #3, #4, #5 are isolated in separate components (`ResourceV2Agent`, `Patcher`, `LifecycleHooks`) with no cross-dependencies. Bug #1 modifies the constructor path; Bug #2 modifies `_doFetch` — complementary, non-overlapping changes within the same class. [ref: ../01-research/05-open-questions.md#Q6]

### Options Considered

1. **Fix independently** — Each bug has a distinct root location. Fix in isolation with separate test suites. Run full integration test suite after each fix. Pros: Clear scope; easier review; independent verification. Cons: Must verify no unexpected interactions after all fixes combined.

2. **Fix #1 and #2 together** — Both touch entry creation and fetch lifecycle. Pros: Single refactor of `ResourceV2CacheEntry`. Cons: Larger atomic scope. [ref: ../01-research/05-open-questions.md#Q6]

### Decision
**Independent fixes with integration test verification**. User answered Q6: "На усмотрение stage-creator в соответствующих этапах. Фиксим все, не задумываясь про PR."

Each bug is fixed independently at its identified root location. While Bugs #1 and #2 touch the same file, they modify non-overlapping areas (constructor vs `_doFetch` body). The full integration test suite (`query-flow.test.ts`, `plugins-and-snapshot.test.ts`, `optimistic-updates.test.ts`, `reset-and-multi-agent.test.ts`, `gc-lifecycle.test.ts`, `edge-cases.test.ts`) is run after each fix to verify no interactions. The `lastError` enhancement is an independent additive change to `MachineSuccess`/`MachineRefreshing`. [ref: 01-architecture.md#4. Component Boundaries per Fix Area]

### Consequences
- **Positive**: Each fix has a clear, reviewable scope tied to one root location and one test suite.
- **Positive**: Integration test suite catches cross-fix interactions.
- **Positive**: Fix ordering is flexible — any bug can be fixed first, though Bugs #1 and #2 may benefit from sequential implementation within the same file.
- **Negative**: Developer context-switches between different areas of the codebase for each fix. Mitigated by clear component boundaries documented in `01-architecture.md`.
- **Risk**: Low risk of interaction. The only coupling is between #1 and #2 in `ResourceV2CacheEntry`, which is mitigated by non-overlapping modification areas.
