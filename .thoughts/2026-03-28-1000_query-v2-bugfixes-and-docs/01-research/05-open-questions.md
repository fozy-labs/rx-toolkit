---
title: "Open Questions: query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: Should `onQueryStarted` be wired into the production code or removed entirely?

**Context**: Codebase analysis confirmed `fireQueryStarted` and `resolveQueryFulfilled` are never called from production code. However, the hook is fully implemented in `LifecycleHooks`, documented in README and `optimistic-updates.md`, typed in `TResourceV2Options`, and tested in isolation (LH05). The `optimistic-updates.md` guide explicitly describes patterns that depend on `$queryFulfilled`.

**Options**:
1. **Wire it in** — Add `fireQueryStarted`/`resolveQueryFulfilled` calls into `ResourceV2CacheEntry._doFetch`. Pros: Fulfills documented API contract; enables optimistic update patterns described in docs; matches RTK Query semantics. Cons: Increases `_doFetch` complexity; needs careful handling of abort/retry flows; adds per-fetch overhead.
2. **Remove it** — Delete `fireQueryStarted`, `resolveQueryFulfilled`, `onQueryStarted` option, and related types. Update docs. Pros: Eliminates dead code; simplifies API surface. Cons: Breaking change for any user who configured `onQueryStarted` (even if it never fired); requires doc rewrite for optimistic updates.
3. **Defer** — Mark as `@experimental` or `@deprecated`, document that it's not yet functional. Pros: No code change needed now. Cons: Leaves broken API in place indefinitely; confusing for users.

**Risks**: Wiring it in changes the execution profile of every fetch. Removing it is a breaking change. Deferring leaves the docs lying about functionality.

**Researcher recommendation**: Option 1 (wire it in) — it's already documented, typed, and the patterns in `optimistic-updates.md` depend on it. The implementation in `LifecycleHooks` is complete; only the call sites are missing.

**User Answer**: Option 1 — Wire into `_doFetch`.

---

### Q2: What should the correct SWR semantics be when a cross-args refetch errors?

**Context**: Bug #3 analysis found two sub-issues in `ResourceV2Agent._deriveState$`: (a) `isError` is `false` while `error` is non-null, and (b) `previous$` is never cleared because the cleaning condition reads the overridden `status` instead of `currentMachine.status`. External research confirms all major libraries (RTK Query, TanStack Query, SWR) expose `isError: true` alongside stale data when a refetch fails.

**Options**:
1. **Error-transparent SWR** — Keep stale data from `previous$` but set `status = "error"`, `isError = true`, `error = <Error>`, `data = prevData`. The consumer sees the error and can decide to show stale data with an error banner. Pros: Matches industry convention; no information loss. Cons: Changes existing behavior for anyone relying on `status === "refreshing"` during errors.
2. **Refreshing-with-error** — Introduce a new compound state (e.g. add `isRefreshError` flag) while keeping `status = "refreshing"`. Pros: More granular; no breaking change to `status` enum. Cons: Adds API surface; diverges from established patterns; `isError` still being `false` is counterintuitive.
3. **Discard SWR on error** — When current entry errors, clear `previous$` and expose raw error state (no stale data). Pros: Simple; unambiguous error state. Cons: Loses SWR benefit; user sees flash of empty + error when switching args.

**Risks**: Option 1 could be a subtle breaking change if consumers pattern-match on `status === "refreshing"`. Option 2 complicates the state model. Option 3 degrades UX.

**Researcher recommendation**: Option 1 — it aligns with all major libraries and the fix is straightforward (derive `isError` from `currentMachine.status` before the override, and use `currentMachine.status` for the previous-clearing check).

**User Answer**: Option 1 — Error-transparent SWR + fix (b) `previous$` clearing bug.

---

### Q3: How should Bug #1 (snapshot fetch bypass) be fixed — lazy fetch or abort-on-set?

**Context**: `ResourceV2CacheEntry` constructor unconditionally calls `_doFetch()`. When hydrating a snapshot, the entry is created (triggering fetch) and then `set(machine)` is called. The fetch is already in flight. Two architectural approaches exist.

**Options**:
1. **Lazy fetch** — Add an `initialMachine` option to `ResourceV2CacheEntry` constructor. If provided, skip `_doFetch()` and use the provided machine as initial state. `hydrateEntry` passes the snapshot machine directly. Pros: No wasted network request; clean semantics; entry starts in correct state. Cons: Changes constructor signature; all callers must be audited; `_entryFactory` needs modification.
2. **Abort-on-set** — Keep constructor as-is but have `set()` abort any inflight fetch when the new state is `MachineSuccess`. Pros: Minimal constructor change. Cons: `queryFn` is still called (wasted request); abort is a side-effect of `set()` which is surprising; doesn't prevent the network round-trip.
3. **Two-phase construction** — Separate entry creation from fetch initiation. Add a `start()` method; constructor doesn't auto-fetch. `hydrateEntry` creates entry, sets state, and never calls `start()`. Normal query path creates entry and calls `start()`. Pros: Most flexible; explicit lifecycle. Cons: Largest refactor; every existing `getOrCreate` call site must also call `start()`.

**Risks**: Option 2 doesn't actually prevent the unnecessary network request. Option 3 has the largest blast radius.

**Researcher recommendation**: Option 1 (lazy fetch with `initialMachine`) — minimal API change, prevents the wasted request, and is the most natural fit for the hydration use case.

**User Answer**: Option 1 — initialMachine (lazy fetch).

---

### Q4: Should the Patcher catch-path return `isConsistencyViolation: true` or should `_finishPatch` detect it differently?

**Context**: Bug #4 shows `Patcher.resolvePatches` catch block returns `{ data: currentData, patchState: null }` without propagating `isConsistencyViolation`. The caller `_finishPatch` only detects violations via `patchState?.isConsistencyViolation` or a heuristic `patchState === null && type === "aborted"`.

**Options**:
1. **Fix the return** — In `resolvePatches` catch block, return `{ data: currentData, patchState: { patches: [], isConsistencyViolation: true } }` instead of `patchState: null`. Pros: Direct fix; `_finishPatch` existing check `patchState?.isConsistencyViolation` works without changes. Cons: Semantics of returning an empty `patches` array with a violation flag — is that meaningful?
2. **Add a separate `isConsistencyViolation` field to the return** — Return `{ data, patchState: null, isConsistencyViolation: true }`. Update `_finishPatch` to check both. Pros: Explicit; doesn't overload `patchState` semantics. Cons: Changes return type of `resolvePatches`.
3. **Simplify detection** — In `_finishPatch`, treat `patchState === null` as always indicating potential violation (regardless of `type`). Pros: No change to `Patcher`. Cons: `patchState === null` can occur in non-violation scenarios (all patches resolved cleanly); false positives would cause unnecessary invalidations.

**Risks**: Option 3 risks false-positive invalidations. Options 1 and 2 are both safe but differ in where the change lives.

**Researcher recommendation**: Option 1 — it's the smallest fix and the existing detection code in `_finishPatch` will work unmodified for this path.

**User Answer**: Option 1 — Fix catch return.

---

### Q5: Bug #5 fix — reject `$cacheDataLoaded` in `fireCacheEntryRemoved` or reorder `resetCache`?

**Context**: `resetCache` calls `entry.complete()` (triggers `fireCacheEntryRemoved` which deletes resolvers) before `clearAll()` (which tries to reject them). By the time `clearAll` runs, the resolvers map is empty.

**Options**:
1. **Reject in `fireCacheEntryRemoved`** — Before deleting the resolver entry, check if `dataLoaded` is still pending and reject it. Pros: Fixes both `resetCache` and GC-triggered removal; single fix point. Cons: `fireCacheEntryRemoved` gains new responsibility.
2. **Reorder `resetCache`** — Call `clearAll()` before `entry.complete()`. Pros: Uses existing rejection logic. Cons: Only fixes `resetCache`, not GC-triggered entry removal; `clearAll` also resets other state that may interact badly with subsequent `complete()` calls.
3. **Both** — Reject in `fireCacheEntryRemoved` AND keep `clearAll` as defense-in-depth. Pros: Covers all removal paths; resilient. Cons: Duplicate logic; `clearAll` rejection becomes a no-op for already-settled promises (harmless but redundant).

**Risks**: Option 2 may introduce ordering issues (clearing hooks state before entries are fully completed). Option 1 is more surgical.

**Researcher recommendation**: Option 1 — fixes the root cause for all entry removal paths, not just `resetCache`.

**User Answer**: Option 1 — Reject in `fireCacheEntryRemoved`.

---

## Medium Priority

### Q6: Are any of the 5 bugs interconnected such that fixing one affects another?

**Context**: Bug #1 (snapshot fetch) and Bug #2 (onQueryStarted dead code) both touch `ResourceV2CacheEntry._doFetch`. If Bug #2 is fixed by wiring `fireQueryStarted` into `_doFetch`, and Bug #1 is fixed by adding `initialMachine` to skip `_doFetch` on hydration, the interactions are minimal (hydrated entries skip `_doFetch` entirely, so `onQueryStarted` wouldn't fire for them — which is correct). Bug #3 (SWR masking) is isolated in `ResourceV2Agent`. Bug #4 (Patcher) is isolated in `Patcher.resolvePatches`. Bug #5 (resetCache) is isolated in `LifecycleHooks`.

**Options**:
1. **Fix independently** — Each bug has a distinct root location. Fix in isolation with separate test suites. Pros: Clear scope; easier review. Cons: Must verify no unexpected interactions after all fixes are combined.
2. **Fix #1 and #2 together** — Both touch entry creation and fetch lifecycle. Pros: Single refactor of `ResourceV2CacheEntry` constructor and `_doFetch`. Cons: Larger PR scope.

**Risks**: Low risk of interaction. The only coupling is between #1 and #2 in the `_doFetch` / constructor area. An integration test that covers snapshot hydration + lifecycle hooks would verify no interaction.

**Researcher recommendation**: Fix independently but run the full integration test suite after each fix is applied. Consider fixing #1 and #2 in the same PR since they touch overlapping code.

**User Answer**: На усмотрение stage-creator в соответствующих этапах. Фиксим все, не задумываясь про PR.

---

### Q7: What should the documentation update scope be — incremental fix or structural rewrite?

**Context**: Current docs have specific inaccuracies: `MachineIdle` referenced but doesn't exist; `devtools.md` references options not in the type system; `onQueryStarted` documented but non-functional. The structure (README + 3 guides) covers most API surface. External research shows TanStack Query's gold-standard doc structure has ~25 guides + per-export API docs.

**Options**:
1. **Incremental fix** — Correct factual errors (MachineIdle → MachinePending, remove devtools references, fix onQueryStarted docs after bug #2 resolution). Leave structure intact. Pros: Minimal effort; no reorganization risk; focused on accuracy. Cons: Doesn't address structural gaps (no dedicated error-handling guide, no cache strategy guide).
2. **Structural rewrite** — Reorganize into TanStack-style structure (Getting Started, Guides, API Reference, Examples). Pros: Professional; comprehensive; scalable. Cons: Significant effort; risk of scope creep; may be premature for a library still fixing bugs.
3. **Incremental fix + targeted additions** — Fix errors, add 2-3 missing guides (error handling, cache strategies), expand API reference for new/changed APIs. Pros: Balanced; addresses critical gaps without full rewrite. Cons: Partially reorganized docs can feel inconsistent.

**Risks**: Full rewrite could delay the release. Incremental-only leaves gaps that cause user confusion.

**Researcher recommendation**: Option 3 — fix inaccuracies first (blocking), then add targeted guides for areas most affected by the bug fixes (error handling, lifecycle hooks).

**User Answer**: Option 3 — Incremental + targeted additions.

---

### Q8: Is a migration guide from query v1 to query v2 needed?

**Context**: The workspace contains both `src/query/` (v1) and `src/query-v2/`. The `docs/migrations/` directory has a `0.5.0.md` but no v1→v2 migration guide. It's unclear whether query v1 and v2 are meant to coexist or if v2 replaces v1.

**Options**:
1. **Write a migration guide** — Document API differences, renamed types, changed behavior, and a step-by-step migration path. Pros: Essential if users are expected to upgrade; reduces support burden. Cons: Effort; requires understanding all v1↔v2 differences.
2. **Skip** — If v2 is a new module (not a replacement) or if no external users exist on v1, a migration guide is unnecessary. Pros: No effort. Cons: Confusion if users encounter both.
3. **Defer** — Add a brief note in README ("v2 is a rewrite of query; migration guide coming") and address later. Pros: Acknowledges the gap. Cons: Doesn't solve it.

**Risks**: Without a guide, users on v1 may struggle to adopt v2 or may mix both accidentally.

**Researcher recommendation**: Clarify with the user whether query v1 has external consumers. If yes, write the guide. If v2 is standalone (no upgrade path), skip.

**User Answer**: Отложить — краткая заметка в README.

---

### Q9: What scenarios should the interactive examples demonstrate?

**Context**: TASK.md item #7 specifies "visual, without commands/mutations." Existing demos cover `simple-resource`, `optimistic-patches`, `ssr-snapshot`. Missing: error states, SKIP token, cache strategies, GC, multi-agent, lifecycle hooks.

**Options**:
1. **Minimal set** (3-4 examples) — Basic query, error handling, SWR behavior, SKIP token. Pros: Quick to build; covers core use cases. Cons: Doesn't showcase advanced features.
2. **Comprehensive set** (6-8 examples) — Add: cache strategies (serialize vs compare), GC/cache lifetime visualization, multi-agent (same resource, different args), loading/refreshing states. Pros: Thorough; helps users understand nuanced behavior. Cons: Significant effort; may duplicate existing demos.
3. **Bug-driven examples** — Build examples that specifically demonstrate the fixed behaviors (correct snapshot hydration, proper error states in SWR, etc.). Pros: Doubles as regression visualization; directly tied to the task. Cons: Not general-purpose educational examples.

**Risks**: Too many examples increases maintenance burden. Too few leaves users guessing.

**Researcher recommendation**: Option 1 + cherry-pick from Option 3 — basic query, error/SWR states (showcases Bug #3 fix), SKIP token, and snapshot hydration (showcases Bug #1 fix). Total: 4-5 focused examples.

**User Answer**: Option 1 — Minimal (4-5 примеров).

---

## Low Priority

### Q10: Should the same-args refetch error behavior (machine-level) be changed?

**Context**: Problem analysis for Bug #3 noted a secondary concern: when a same-args refetch fails, `MachineRefreshing.errorHappened()` returns `MachineSuccess` — the error is completely discarded at the machine level. This is separate from the agent-level Bug #3 (cross-args). The external research shows RTK Query and TanStack Query both expose refetch errors even with SWR data.

**Options**:
1. **Leave as-is** — Machine-level SWR silently discards refetch errors. The agent deals with errors only for cross-args. Pros: Simpler machine model; no breaking change. Cons: Same-args refetch errors are invisible to the consumer.
2. **Add error to MachineSuccess** — Allow `MachineSuccess` to carry an optional `lastError` field for refetch failures. Pros: Preserves SWR data while exposing error info. Cons: Changes machine type; broader impact.
3. **Out of scope** — This is not one of the 5 bugs in TASK.md. Address separately if desired. Pros: Keeps scope bounded. Cons: Known issue left unaddressed.

**Risks**: Changing machine-level error semantics has broad implications across the entire state derivation pipeline.

**Researcher recommendation**: Option 3 (out of scope) — this is a design decision that warrants its own task, not a bugfix.

**User Answer**: Option 2 — Add `lastError` to `MachineSuccess` (in scope).

---

### Q11: Should regression tests be mandatory for each bug fix?

**Context**: All 5 bugs lack tests covering the specific failure scenarios. Existing tests either accept the buggy behavior (E07 for Bug #1) or don't cover the failing path.

**Options**:
1. **Mandatory** — Each bug fix must include a regression test that fails before the fix and passes after. Pros: Prevents regressions; documents expected behavior. Cons: Minor additional effort per fix.
2. **Best-effort** — Write tests where practical but don't block the fix. Pros: Flexibility. Cons: Some fixes may regress later.

**Risks**: Without regression tests, future refactors could reintroduce the same bugs.

**Researcher recommendation**: Option 1 — the research already identified the exact scenarios and test gaps. Writing the tests is straightforward.

**User Answer**: Option 1 — Mandatory.

---

### Q12: Should GC-triggered entry removal also reject `$cacheDataLoaded`?

**Context**: Bug #5 analysis noted that GC-triggered removal follows the same `onClean$` → `fireCacheEntryRemoved` path as `resetCache`. If Bug #5 is fixed via Option 1 (reject in `fireCacheEntryRemoved`), GC removal is automatically covered. If fixed via Option 2 (reorder `resetCache`), GC removal is not covered.

**Options**:
1. **Fix in `fireCacheEntryRemoved`** — Automatically covers both paths. (Same as Q5 Option 1.)
2. **Fix only `resetCache`** — GC path remains affected but is arguably less critical.

**Risks**: GC-triggered hanging promise causes memory leak in long-running apps.

**Researcher recommendation**: This is resolved by the answer to Q5. If Q5 selects Option 1, this is automatically covered.

**User Answer**: Auto-covered by Q5 (Option 1).
