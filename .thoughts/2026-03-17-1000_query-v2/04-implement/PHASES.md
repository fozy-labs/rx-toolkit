---
title: "Phases: 04-implement"
date: 2026-03-18
stage: 04-implement
---

# Phases: 04-implement

## Phase 1: Implement Plan Phase 1 — Foundation (Types, Tokens, Utilities)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/01-foundation.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 1 (Foundation) of the query-v2 module. Read the plan file fully before starting:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/01-foundation.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (type definitions §1.1–§1.16)
- **Design architecture**: `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` (folder structure §4, public API §7)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-1 plugin types)
- **RFC**: `docs/contributing/query-v2/README.md`

**Implement all 4 tasks in order:**

1. **Task 1.1** — Create all type definition files under `src/query-v2/types/`. Files: `index.ts`, `shared.types.ts`, `machine.types.ts`, `cache.types.ts`, `resource.types.ts`, `agent.types.ts`, `api.types.ts`, `plugin.types.ts`, `snapshot.types.ts`, `lifecycle.types.ts`. Each file defines the interfaces and type aliases from the design model. The barrel `index.ts` re-exports everything. For `TMachine` union type: define as union of state shape interfaces initially (machine classes don't exist yet). For `PluginAugmentations`: implement using `UnionToIntersection` + `Prettify` per ADR-1.

2. **Task 1.2** — Create sentinel tokens: `src/query-v2/lib/SKIP_TOKEN.ts` (`SKIP: unique symbol`, `SKIP_TOKEN` type) and `src/query-v2/lib/NO_VALUE.ts` (`NO_VALUE: unique symbol`, `NO_VALUE` type). Follow the pattern of `src/query/SKIP_TOKEN.ts`.

3. **Task 1.3** — Create `src/query-v2/lib/stableStringify.ts`: deterministic JSON.stringify with sorted object keys for cache key generation. First check if `src/common/utils/` has something suitable — if so, re-export; otherwise create from scratch. Must handle plain objects, arrays, primitives, null, nested structures.

4. **Task 1.4** — Create `src/query-v2/index.ts`: barrel export file. Export `SKIP`, `SKIP_TOKEN` from `./lib/SKIP_TOKEN`; `NO_VALUE` from `./lib/NO_VALUE`; all types from `./types`. Remaining runtime exports added in later phases.

**Constraints:**
- All code under `src/query-v2/` — zero imports from `src/query/`.
- Follow existing codebase patterns: naming, indentation, barrel exports, `@/` alias for `src/`.
- Maintain TypeScript strict mode compatibility.
- Do NOT modify files outside this phase's scope.
- Do NOT add `src/query-v2` to `src/index.ts` yet (that's Phase 7).

---

## Phase 2: Verify Plan Phase 1 — Foundation

- **Agent**: `rdpi-tester`
- **Output**: `verification-1.md`
- **Depends on**: Phase 1
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 1 (Foundation — Types, Tokens, Utilities).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/01-foundation.md`
**Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md`

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes with all new type files.
2. Spot-check `TMachine` union type — contains all 5 state shapes (Idle, Pending, Success, Error, Refreshing).
3. Spot-check `ICreateApiOptions` — has `plugins`, `keyStrategy`, `keyPrefix`, `cacheLifetime` fields.
4. Spot-check `IResourceV2` — has `query`, `query$`, `entry`, `entry$`, `invalidate` methods.
5. Spot-check `PluginAugmentations` — uses `UnionToIntersection` and `Prettify`.
6. `SKIP` and `NO_VALUE` are `unique symbol` types (check the declarations).
7. `stableStringify` exists and handles key-order independence: `stableStringify({ b: 2, a: 1 })` === `stableStringify({ a: 1, b: 2 })`.
8. `src/query-v2/index.ts` is importable without errors.
9. No imports from `src/query/` in any created file (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-1.md`

---

## Phase 3: Implement Plan Phase 2 — State Machines + Patcher

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/02-state-machines.md`
- **Depends on**: Phase 2
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 2 (State Machines + Patcher). Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/02-state-machines.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (§1.3 Machine classes, §1.4 MachineWithData, §1.8 Patcher/Patches)
- **Design dataflow**: `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md` (§4 optimistic update flow, §5 snapshot flow)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-2 refreshing error, ADR-4 hanging patches)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§1 Machine tests M1–M17, §3 Patcher tests P1–P12)

**Implement all 5 tasks in order:**

1. **Task 2.1** — Create 6 machine class files under `src/query-v2/core/machines/`:
   - `MachineIdle.ts`: state `idle`, methods `start(args)→MachinePending`, `reset()→MachineIdle`.
   - `MachinePending.ts`: state `pending`, methods `successHappened(data)→MachineSuccess`, `errorHappened(error)→MachineError`, `reset()→MachineIdle`.
   - `MachineWithData.ts` (abstract): base for Success/Refreshing. Methods `addPatch()`, `finishPatch()`, `createPatch()`, `abortAllPendingPatches()` — all delegate to Patcher statics and return NEW instances (immutable).
   - `MachineSuccess.ts` extends `MachineWithData`: state `success`, methods `invalidate()→MachineRefreshing`, `reset()→MachineIdle` (abort patches first). Static `create(data, args)`, `deploy(snapshotSlice)`.
   - `MachineError.ts`: state `error`, methods `retry()→MachinePending` (same args), `start(args)→MachinePending`, `reset()→MachineIdle`.
   - `MachineRefreshing.ts` extends `MachineWithData`: state `refreshing`, methods `successHappened(data)→MachineSuccess` (aborts patches), `errorHappened(error)→MachineSuccess` (preserves stale data per ADR-2), `reset()→MachineIdle`.
   - All machine instances are immutable — transitions return new instances. All `.state` properties are JSON-serializable plain objects.

2. **Task 2.2** — Resolve `MachineSuccess.start()` inconsistency. The plan recommends **Option A**: add `start(args): MachinePending` to `MachineSuccess` (calls `abortAllPendingPatches()` first). This aligns with the transition table row 6 and test M5.

3. **Task 2.3** — Create `src/query-v2/core/machines/Patcher.ts`: static utility with `createPatch(patchFn, data)` (uses Immer `produceWithPatches`), `resolvePatches(originalData, patches)` (implements the RFC patch resolution algorithm), `finishPatch(originalData, patches, type, patch)` (marks patch committed/aborted, runs resolve), and `abortAllPendingPatches()`. Call `enablePatches()` from Immer at module load.

4. **Task 2.4** — Create `src/query-v2/core/machines/Machine.ts`: namespace with `idle()→MachineIdle.create()`, `fromSnapshot(state)` — switch on status to reconstruct correct class, re-export all machine classes.

5. **Task 2.5** — Create unit test files (7 files) under `src/query-v2/core/machines/`:
   - `MachineIdle.test.ts`, `MachinePending.test.ts`, `MachineSuccess.test.ts`, `MachineError.test.ts`, `MachineRefreshing.test.ts`, `MachineWithData.test.ts`, `Patcher.test.ts`.
   - Implement test cases M1–M17 and P1–P12 from `02-design/06-testcases.md`.
   - M14 is a type-level test using `expectTypeOf`.
   - All tests are pure unit tests — no signals, no async. Use real Immer.

**Also**: Update `src/query-v2/types/machine.types.ts` to refine `TMachine` union to use the actual class types now (import type from the machine files). Update `src/query-v2/index.ts` to re-export machine classes if appropriate for this phase.

**Constraints:**
- Zero imports from `src/query/`.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Do NOT modify files outside `src/query-v2/`.

---

## Phase 4: Verify Plan Phase 2 — State Machines + Patcher

- **Agent**: `rdpi-tester`
- **Output**: `verification-2.md`
- **Depends on**: Phase 3
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 2 (State Machines + Patcher).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/02-state-machines.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§1, §3)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run machine tests: `npx vitest run src/query-v2/core/machines/` — all 17 machine test cases (M1–M17) pass.
3. Run patcher tests: `npx vitest run src/query-v2/core/machines/Patcher.test.ts` — all 12 patcher test cases (P1–P12) pass.
4. `MachineSuccess.start()` inconsistency resolved — verify `start(args)` method exists on `MachineSuccess` and test M5 passes.
5. Machine instances are immutable — spot-check: calling `idle.start(args)` returns a new `MachinePending`, original `idle` is unchanged.
6. All machine `.state` properties are JSON-serializable: `JSON.stringify(machine.state)` succeeds for all 5 types (check in test files or run a quick verification).
7. `MachineRefreshing.errorHappened()` returns `MachineSuccess` with stale data preserved (ADR-2) — check test M8.
8. `abortAllPendingPatches()` clears pending patches — check test P12.
9. No imports from `src/query/` (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-2.md`

---

## Phase 5: Implement Plan Phase 3 — Cache Layer

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/03-cache-layer.md`
- **Depends on**: Phase 4
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 3 (Cache Layer). Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/03-cache-layer.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (§1.5 ICacheEntry, §1.6 ICacheMap)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-3 dual strategy, ADR-4 hanging patches Layer 3, ADR-7 signal-based cache, ADR-8 devtools)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§2 Cache tests C1–C11, §10 Devtools D4, §11 Edge cases E3)
- **Existing code reference**: `src/common/utils/shallowEqual.ts` (default compare function), `src/signals/` (Signal.state, Signal.compute)

**Implement all 3 tasks in order:**

1. **Task 3.1** — Create `src/query-v2/core/CacheMap.ts`: Implement `ICacheMap` with two concrete strategies selected at construction:
   - `SerializedCacheMap`: Wraps `Map<string, CacheEntry>`, uses `serializeArgs(args)` for keys. Default serializer is `stableStringify` from `../lib/stableStringify`.
   - `CompareCacheMap`: Wraps `Array<{ args, entry }>`, linear scan via `compareArg(a,b)`. Default comparator is `shallowEqual` from `@/common/utils/shallowEqual`.
   - `doCacheArgs: true` memoizes serialization via `WeakMap<object, string>` (only for object args).
   - Factory: `CacheMap.create(options)` returns appropriate implementation.
   - Methods: `get`, `set`, `delete`, `has`, `values`, `entries`, `clear`, `size`.

2. **Task 3.2** — Create `src/query-v2/core/CacheEntry.ts`: Reactive wrapper around `Signal.state<TMachine>()`.
   - Implements `ICacheEntry`: `machine$` (signal read), `peek()` (sync read), `set(machine)`, `complete()` (cleanup).
   - Signal created with `key` option: `'{keyPrefix}/{resourceKey}/{serializedArgs}'` for devtools.
   - `beforeDevtoolsPush`: default projects `machine→machine.state`. Compose with user-provided callback.
   - `complete()`: calls `abortAllPendingPatches()` on current machine if `MachineWithData` instance (ADR-4 Layer 3).
   - Import `Signal` from `@/signals/`.

3. **Task 3.3** — Create test files:
   - `src/query-v2/core/CacheMap.test.ts`: Tests C1–C11 plus E3 (empty cache values).
   - `src/query-v2/core/CacheEntry.test.ts`: Test peek/set, reactive `machine$` via `Signal.compute`, `complete()` cleanup with `abortAllPendingPatches`, D4 (JSON-serializable machine.state for devtools).
   - CacheEntry tests use real `Signal.state`/`Signal.compute` from `@/signals/`.
   - CacheMap tests can use lightweight mock CacheEntry objects or real ones with MachineIdle.

**Constraints:**
- Zero imports from `src/query/`.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Do NOT modify files outside `src/query-v2/`.

---

## Phase 6: Verify Plan Phase 3 — Cache Layer

- **Agent**: `rdpi-tester`
- **Output**: `verification-3.md`
- **Depends on**: Phase 5
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 3 (Cache Layer).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/03-cache-layer.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§2, §10, §11)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run CacheMap tests: `npx vitest run src/query-v2/core/CacheMap.test.ts` — all 11 test cases (C1–C11) plus E3 pass.
3. Run CacheEntry tests: `npx vitest run src/query-v2/core/CacheEntry.test.ts` — reactive signal tests pass.
4. `doCacheArgs` memoization works — C10 test verifies serialization is called once per unique object arg.
5. `CacheEntry.complete()` calls `abortAllPendingPatches()` on MachineWithData instances — check test output.
6. D4 test passes — all 5 machine types produce JSON-serializable `.state` for devtools.
7. No imports from `src/query/` (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-3.md`

---

## Phase 7: Implement Plan Phase 4 — ResourceV2 Core + LifecycleHooks

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/04-resource-core.md`
- **Depends on**: Phase 6
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 4 (ResourceV2 Core + LifecycleHooks). This is one of the most complex phases. Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/04-resource-core.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (§1.2 IResourceV2, §1.13 lifecycle types)
- **Design dataflow**: `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md` (§1 query flow, §3 invalidation, §7 lifecycle hooks, §9 reactive query)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-2 refreshing error, ADR-4 hanging patches Layers 1-3, ADR-7 cache lifetime)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§4 Resource R1–R12, §9 Lifecycle L1–L9, §11 Edge cases E6–E10, E12)
- **Existing code reference**: `src/common/utils/PromiseResolver.ts`, `src/signals/` (Signal, Batcher)

**Implement all 3 tasks in order:**

1. **Task 4.1** — Create `src/query-v2/core/LifecycleHooks.ts`:
   - Uses `PromiseResolver` from `@/common/utils/PromiseResolver`.
   - `fireCacheEntryAdded(args, tools)`: Creates `$cacheDataLoaded` + `$cacheEntryRemoved` promise resolvers, calls user's `onCacheEntryAdded` callback.
   - `fireCacheEntryRemoved(args)`: Resolves `$cacheEntryRemoved`. Rejects `$cacheDataLoaded` if unresolved.
   - `fireQueryStarted(args, tools)`: Creates `$queryFulfilled` resolver, calls user's `onQueryStarted`.
   - `resolveQueryFulfilled(data)` / `rejectQueryFulfilled(error)` / `resolveCacheDataLoaded(data)`.

2. **Task 4.2** — Create `src/query-v2/core/ResourceV2.ts`:
   - Constructor receives merged options (queryFn, key, cacheLifetime, serializeArgs, compareArg, beforeDevtoolsPush, keyStrategy, keyPrefix, onCacheEntryAdded, onQueryStarted, doCacheArgs, maxSnapshotDataAge).
   - Owns a `CacheMap` instance.
   - **`query(args, doForce?)`**: Full query flow — SKIP check, cache lookup, CacheEntry creation, machine transitions (idle→pending), lifecycle hook firing, `queryFn(args, { abortSignal })` execution, success/error transitions. Wrap transitions in `Batcher.run()`.
   - **`query$(args, doForce?)`**: Reactive signal read. Calls `query(args)`, returns `entry.machine$.get()`.
   - **`entry(args, doInitiate?)`**: Returns existing CacheEntry or null.
   - **`entry$(args, doInitiate?)`**: Reactive read from entry.
   - **`invalidate(args)`**: success→refreshing, re-execute queryFn. Error during refresh→MachineSuccess with stale data (ADR-2).
   - **AbortController management** (ADR-4 Layer 1): One active controller per args; new query aborts previous.
   - **Query deduplication** (R9): Same-args in-flight query returns same Promise.
   - **Cache lifetime management** (ADR-7): setTimeout-based eviction after all subscribers drop + cacheLifetime expires. Re-subscribe cancels eviction. Fire `onCacheEntryRemoved` on eviction.
   - Import `Signal`, `Batcher` from `@/signals/`.

3. **Task 4.3** — Create test files:
   - `src/query-v2/core/ResourceV2.test.ts`: Tests R1–R12 (cache miss flow, cache hit, force refetch, invalidate, entry methods, SKIP_TOKEN, deduplication, error, AbortController). Edge cases E6 (GC eviction), E7 (GC cancelled), E8 (query$ signal dependency), E9 (patch auto-abort on reset), E10 (patch auto-abort on eviction), E12 (Batcher atomicity).
   - `src/query-v2/core/LifecycleHooks.test.ts`: Tests L1–L9.
   - Use controllable queryFn promises (resolve/reject on demand).
   - Use `vi.useFakeTimers()` for cache lifetime tests.
   - Use real `Signal.state`, `Signal.compute`, `Batcher` — no mocking.

**Constraints:**
- Zero imports from `src/query/`.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Do NOT modify files outside `src/query-v2/`.

---

## Phase 8: Verify Plan Phase 4 — ResourceV2 Core + LifecycleHooks

- **Agent**: `rdpi-tester`
- **Output**: `verification-4.md`
- **Depends on**: Phase 7
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 4 (ResourceV2 Core + LifecycleHooks).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/04-resource-core.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§4, §9, §11)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run ResourceV2 tests: `npx vitest run src/query-v2/core/ResourceV2.test.ts` — all 12 tests (R1–R12) pass.
3. Run LifecycleHooks tests: `npx vitest run src/query-v2/core/LifecycleHooks.test.ts` — all 9 tests (L1–L9) pass.
4. Edge case tests: E6 (GC eviction), E7 (GC cancelled), E8 (query$ signal), E9 (patch abort on reset), E10 (patch abort on eviction), E12 (Batcher atomicity) — all pass.
5. Query deduplication: concurrent same-args queries share one queryFn call (R9).
6. AbortController: new query for same args aborts previous in-flight (R12).
7. Cache lifetime: entry evicted after timeout, eviction cancelled on re-subscribe (E6, E7).
8. Invalidation: `MachineRefreshing.errorHappened()` preserves stale data (ADR-2) (R4).
9. No imports from `src/query/` (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-4.md`

---

## Phase 9: Implement Plan Phase 5 — ResourceV2Agent

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/05-agent.md`
- **Depends on**: Phase 8
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 5 (ResourceV2Agent). Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/05-agent.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (§1.7 IResourceV2Agent, §1.16 IResourceV2Ref)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-2 refreshing error, ADR-5 latest-wins Agent)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§5 Agent A1–A8, §11 Edge cases E4–E5)

**Implement all 2 tasks in order:**

1. **Task 5.1** — Create `src/query-v2/core/ResourceV2Agent.ts`:
   - Internal state: `Signal.state<{ previous: ICacheEntry | null; current: ICacheEntry | null }>`.
   - **`state$`**: `Signal.compute` producing `IResourceV2AgentState` — reads `current.machine$.get()` for reactive subscription. Includes: `status`, `data` (current or previous SWR), `error`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isSuccess`, `isError`, `refreshError`.
   - **`start(args)`**: SKIP check, args comparison, call `resource.query(args)`, swap previous/current, clear previous after current resolves.
   - **`refreshError` tracking**: Capture error when `$queryFulfilled` rejects during MachineRefreshing. Clear on next successful fetch.
   - Import `Signal` from `@/signals/`, `SKIP` from `../lib/SKIP_TOKEN`.

2. **Task 5.2** — Create `src/query-v2/core/ResourceV2Agent.test.ts`:
   - Tests A1–A8: start triggers query (A1), SWR with previous data (A2), isInitialLoading (A3–A4), SKIP no-op (A5), rapid arg changes latest-wins (A6), refreshError (A7), previous cleared on resolve (A8).
   - Edge cases E4 (concurrent invalidations), E5 (rapid re-queries — 5 arg changes, only last completes).
   - Use controllable queryFn promises.
   - Use real `Signal.state`, `Signal.compute`.
   - Verify `state$` is reactive inside `Signal.compute`.

**Constraints:**
- Zero imports from `src/query/`.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Do NOT modify files outside `src/query-v2/`.

---

## Phase 10: Verify Plan Phase 5 — ResourceV2Agent

- **Agent**: `rdpi-tester`
- **Output**: `verification-5.md`
- **Depends on**: Phase 9
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 5 (ResourceV2Agent).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/05-agent.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§5, §11)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run Agent tests: `npx vitest run src/query-v2/core/ResourceV2Agent.test.ts` — all 8 tests (A1–A8) pass.
3. Edge cases E4, E5 pass.
4. SWR behavior: during loading, `state$()` returns `{ data: previousData, isLoading: true, isInitialLoading: false }`.
5. `isInitialLoading` correctly distinguishes first load from arg-change load.
6. `start(SKIP)` is a no-op — no fetch triggered.
7. Latest-wins: rapid arg changes → only last args' fetch completes.
8. `refreshError` populated on refresh failure, cleared on next success.
9. `state$` is reactive — `Signal.compute` depending on it re-evaluates.
10. No imports from `src/query/` (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-5.md`

---

## Phase 11: Implement Plan Phase 6 — createApi + Plugins + SSR Snapshots

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/06-api-plugins-ssr.md`
- **Depends on**: Phase 10
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 6 (createApi + Plugin System + SSR Snapshots). This is a high-complexity phase. Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/06-api-plugins-ssr.md`
- **Design model**: `.thoughts/2026-03-17-1000_query-v2/02-design/03-model.md` (§1.1 ICreateApiOptions/IApi, §1.9 IPlugin, §1.10 ReactHooksPlugin, §1.11 Snapshots)
- **Design dataflow**: `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md` (§5 SSR snapshot flow, §6 plugin flow)
- **Design decisions**: `.thoughts/2026-03-17-1000_query-v2/02-design/04-decisions.md` (ADR-1 plugin types, ADR-3 key strategy, ADR-6 forward-compat, ADR-9 React hooks)
- **Design architecture**: `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` (§7 public API)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§6 API, §7 SSR, §8 Plugin, §10 Devtools)
- **Design risks**: `.thoughts/2026-03-17-1000_query-v2/02-design/08-risks.md` (R1 TS2589, R2 instanceof SSR)
- **Existing code reference**: `src/query/react/useResourceAgent.ts` (pattern for hooks), `src/query/react/useResourceRef.ts`, `src/common/react/useConstant.ts`, `src/common/react/useEventHandler.ts`

**Implement all 5 tasks in order:**

1. **Task 6.1** — Create plugin runtime files:
   - `src/query-v2/plugins/types.ts`: Runtime `IPlugin` interface (name, install, augmentResource), `IPluginContext`.
   - `src/query-v2/plugins/ReactHooksPlugin.ts`: `install(context)` stores context. `augmentResource(resource, options)` returns object with `useResourceV2Agent(args)` and `useResourceV2Ref(args)`.
   - `useResourceV2Agent`: React hook using `useConstant(() => resource.createAgent())`, `agent.start(args)` in effect, return `agent.state$()`. Follow pattern of `src/query/react/useResourceAgent.ts`.
   - `useResourceV2Ref`: React hook returning imperative handle (has, lock, invalidate, createPatch, create). Follow `src/query/react/useResourceRef.ts`.
   - Wire `ExtractPluginContributions` type so `ReactHooksPlugin` → `IReactHooksPluginContributions`.

2. **Task 6.2** — Create `src/query-v2/snapshot/Snapshot.ts`:
   - `getSnapshot(resources)`: Iterates resources + CacheMap entries, captures only `MachineSuccess`. Produces `TApiSnapshot` with version, keyPrefix, resources map.
   - `hydrateSnapshot(snapshot, api, resources)`: Validates version (integer `CURRENT_SNAPSHOT_VERSION = 1`), validates keyPrefix match. Calls `Machine.fromSnapshot(state)` → populates CacheMap. Stale entries (`Date.now() - updatedAt > maxSnapshotDataAge`) trigger `resource.invalidate(args)`.
   - `serialize` strategy required — `compare` strategy throws descriptive error (S6).
   - Version mismatch: skip entirely (S4). KeyPrefix mismatch: silent skip (S5).

3. **Task 6.3** — Create `src/query-v2/api/createApi.ts`:
   - Accepts `ICreateApiOptions<TPlugins>`, returns `IApi<TPlugins>`.
   - Plugin initialization: iterate plugins, call `plugin.install({ api, keyStrategy })`.
   - `createResource(options)`: Merge options (resource overrides API defaults), validate unique key (throw on duplicate), create ResourceV2, iterate plugins `augmentResource`, register in internal registry, hydrate from `initialSnapshot`, return typed `IResourceV2 & PluginAugmentations<TPlugins>`.
   - `resetAll()`: Iterate all resources, reset each.
   - `getSnapshot()`: Delegate to Snapshot layer.
   - ADR-6: Internal registry uses generic Map for forward-compat.

4. **Task 6.4** — Create test files:
   - `src/query-v2/api/createApi.test.ts`: API1–API7 tests.
   - `src/query-v2/plugins/ReactHooksPlugin.test.ts`: PL1–PL5 runtime tests. PL6 type test with `expectTypeOf` using ReactHooksPlugin + mock plugin (validates ADR-1, mitigates R1 TS2589). Hook tests with `@testing-library/react` `renderHook` + `act`.
   - `src/query-v2/snapshot/Snapshot.test.ts`: S1–S8 SSR tests.
   - Devtools tests D1–D3.

5. **Task 6.5** — Update `src/query-v2/index.ts` barrel:
   - Add `createApi` from `./api/createApi`.
   - Add `ReactHooksPlugin` from `./plugins/ReactHooksPlugin`.
   - Add machine classes + `Machine` namespace from `./core/machines/Machine`.
   - Verify all exports match architecture §7.
   - Do NOT add to `src/index.ts` yet.

**Constraints:**
- Zero imports from `src/query/`.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Do NOT modify files outside `src/query-v2/`.

---

## Phase 12: Verify Plan Phase 6 — createApi + Plugins + SSR Snapshots

- **Agent**: `rdpi-tester`
- **Output**: `verification-6.md`
- **Depends on**: Phase 11
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 6 (createApi + Plugin System + SSR Snapshots).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/06-api-plugins-ssr.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (§6, §7, §8, §10)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run createApi tests: `npx vitest run src/query-v2/api/createApi.test.ts` — all 7 tests (API1–API7) pass.
3. Run plugin tests: `npx vitest run src/query-v2/plugins/ReactHooksPlugin.test.ts` — all 6 tests (PL1–PL6) pass. PL6 type test with 2 plugins validates no TS2589.
4. Run SSR tests: `npx vitest run src/query-v2/snapshot/Snapshot.test.ts` — all 8 tests (S1–S8) pass.
5. Devtools tests D1–D3 pass.
6. ReactHooksPlugin `useResourceV2Agent` hook renders correctly via `renderHook`.
7. `useResourceV2Ref` provides imperative handle (has, lock, invalidate, createPatch, create).
8. Plugin type system: resource with ReactHooksPlugin has hook methods, without does not.
9. SSR round-trip: `getSnapshot()` → `initialSnapshot` produces identical data.
10. `compare` strategy + `getSnapshot()` throws descriptive error (S6).
11. No TS2589 errors.
12. No imports from `src/query/` (grep check).
13. `src/query-v2/index.ts` exports match architecture §7 — read `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` §7 to verify.

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-6.md`

---

## Phase 13: Implement Plan Phase 7 — Integration Tests + Barrel Export + Config

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/07-integration-exports.md`
- **Depends on**: Phase 12
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 7 (Integration Tests + Barrel Export + Config). Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/07-integration-exports.md`
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (Correctness Verifications #1–#5)
- **Design dataflow**: `.thoughts/2026-03-17-1000_query-v2/02-design/02-dataflow.md` (all flows for integration validation)
- **Design architecture**: `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` (§7 public API surface)
- **Existing config**: `vitest.config.ts`, `src/index.ts`

**Implement all 4 tasks in order:**

1. **Task 7.1** — Create `src/query-v2/__tests__/integration/query-flow.test.ts`:
   - Test 1: Full lifecycle — `createApi` → `createResource` → `query(args)` → resolve → `MachineSuccess` → `invalidate` → `MachineRefreshing` → resolve → fresh `MachineSuccess`.
   - Test 2: Optimistic update — query → `createPatch` → verify optimistic data → abort → verify reverted. Repeat with commit → verify persisted.
   - Test 3: Machine transition completeness — exercise every valid transition, verify invalid transitions prevented at type level.
   - Use real signals, Batcher, Immer, controllable queryFn promises, fake timers.

2. **Task 7.2** — Create `src/query-v2/__tests__/integration/ssr-hydration.test.ts`:
   - Server-side createApi → query → getSnapshot → JSON stringify/parse → client-side createApi with initialSnapshot → verify immediate data → verify stale entry invalidation → verify `Machine.fromSnapshot()` instanceof.
   - Test version mismatch → skip hydration.
   - Test keyPrefix mismatch → skip.
   - Test `maxSnapshotDataAge` triggers refresh.

3. **Task 7.3** — Create `src/query-v2/__tests__/integration/plugin-augmentation.test.ts`:
   - Type test: API with ReactHooksPlugin has `useResourceV2Agent`, without does not.
   - Runtime test: API with ReactHooksPlugin + mock plugin — both plugins' contributions available.

4. **Task 7.4** — Finalize infrastructure:
   - `src/query-v2/index.ts`: Final review against architecture §7 exports.
   - `vitest.config.ts`: Add `'src/query-v2/**'` to `coverage.include`.
   - `src/index.ts`: Add `export * from './query-v2';`.

**Constraints:**
- Zero imports from `src/query/` in query-v2 files.
- Follow existing codebase patterns.
- TypeScript strict mode.
- Only modify `vitest.config.ts` and `src/index.ts` outside `src/query-v2/` — no other external files.

---

## Phase 14: Verify Plan Phase 7 — Integration Tests + Exports

- **Agent**: `rdpi-tester`
- **Output**: `verification-7.md`
- **Depends on**: Phase 13
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 7 (Integration Tests + Barrel Export + Config).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/07-integration-exports.md`
**Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (Correctness Verifications)

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes.
2. Run integration tests: `npx vitest run src/query-v2/__tests__/integration/` — all tests pass:
   - `query-flow.test.ts`: full lifecycle, optimistic update, transitions.
   - `ssr-hydration.test.ts`: SSR round-trip, version/prefix mismatch, stale invalidation.
   - `plugin-augmentation.test.ts`: type test, runtime plugin composition.
3. Run ALL query-v2 tests: `npx vitest run src/query-v2/` — all pass (unit + integration).
4. Run ALL project tests: `npx vitest run` — all existing tests + all new tests pass.
5. `vitest.config.ts` coverage includes `src/query-v2/**`.
6. `src/index.ts` exports query-v2 module.
7. Coverage check: `npx vitest run --coverage src/query-v2/` — verify 85%+ statements/branches/lines, 90%+ functions.
8. No imports from `src/query/` in any `src/query-v2/` file (grep check).

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-7.md`

---

## Phase 15: Implement Plan Phase 8 — Documentation + Demos

- **Agent**: `rdpi-codder`
- **Output**: Code changes per `../03-plan/08-docs-demos.md`
- **Depends on**: Phase 14
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 8 (Documentation + Demos). Read the plan file fully:

- **Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/08-docs-demos.md`
- **Design docs impact**: `.thoughts/2026-03-17-1000_query-v2/02-design/07-docs.md`
- **Existing docs reference**: `docs/query/README.md` (v1 style reference), `docs/migrations/0.5.0.md` (migration guide format)
- **Existing demos reference**: `apps/demos/src/examples/query/simple-list.tsx`, `apps/demos/src/examples/query/todo-patches.tsx`, `apps/demos/src/examples/index.ts`

**Implement all 4 tasks in order:**

1. **Task 8.1** — Create documentation pages:
   - `docs/query-v2/README.md`: Main concepts (createApi, ResourceV2, Agents, Machine states, cache strategies, SKIP_TOKEN, lifecycle hooks, plugins). Mark as **experimental**. Follow style of `docs/query/README.md`.
   - `docs/query-v2/api-reference.md`: Option/return type tables for createApi, createResource, IResourceV2, IResourceV2Agent, machines.
   - `docs/query-v2/optimistic-updates.md`: Patcher usage guide (createPatch, finishPatch, commit/abort).
   - `docs/query-v2/ssr.md`: SSR guide (getSnapshot, initialSnapshot, maxSnapshotDataAge).

2. **Task 8.2** — Create migration guide: `docs/migrations/query-v2.md`. Concept mapping from v1→v2. Note v1/v2 coexistence. Follow format of `docs/migrations/0.5.0.md`.

3. **Task 8.3** — Update existing docs:
   - `docs/query/README.md`: Add note at top linking to query-v2 experimental. Example: "**Note:** Экспериментальная версия Query v2 доступна — см. [Query v2](../query-v2/README.md)."
   - Root `README.md`: Add query-v2 to feature list, marked experimental.

4. **Task 8.4** — Create demo applications:
   - `apps/demos/src/examples/query-v2/index.ts`: Barrel export.
   - `apps/demos/src/examples/query-v2/simple-resource.tsx`: Basic resource query demo. Follow `simple-list.tsx` pattern.
   - `apps/demos/src/examples/query-v2/optimistic-patches.tsx`: Optimistic update demo. Follow `todo-patches.tsx` pattern.
   - `apps/demos/src/examples/query-v2/ssr-snapshot.tsx` (optional — simulated if no SSR infra).
   - Update `apps/demos/src/examples/index.ts` to include v2 demos.

**Constraints:**
- Docs pages follow project language conventions.
- Existing v1 demos unchanged.
- Zero imports from `src/query/` in v2 demos.
- Do NOT modify v1 query code or tests.

---

## Phase 16: Verify Plan Phase 8 — Documentation + Demos

- **Agent**: `rdpi-tester`
- **Output**: `verification-8.md`
- **Depends on**: Phase 15
- **Retry limit**: 1

### Prompt

Verify the implementation of Plan Phase 8 (Documentation + Demos).

**Plan file**: `.thoughts/2026-03-17-1000_query-v2/03-plan/08-docs-demos.md`

**Run these verification checks and report pass/fail for each:**

1. `npm run ts-check` passes (including demo app).
2. Doc files exist and are non-empty:
   - `docs/query-v2/README.md`
   - `docs/query-v2/api-reference.md`
   - `docs/query-v2/optimistic-updates.md`
   - `docs/query-v2/ssr.md`
   - `docs/migrations/query-v2.md`
3. `docs/query-v2/README.md` marks query-v2 as experimental.
4. `docs/query/README.md` contains v2 link note.
5. Root `README.md` lists query-v2 feature.
6. Demo files exist and compile:
   - `apps/demos/src/examples/query-v2/index.ts`
   - `apps/demos/src/examples/query-v2/simple-resource.tsx`
   - `apps/demos/src/examples/query-v2/optimistic-patches.tsx`
7. `apps/demos/src/examples/index.ts` includes query-v2 demos.
8. Existing v1 demos unchanged (no modifications to `apps/demos/src/examples/query/`).
9. No imports from `src/query/` in any query-v2 demo.
10. Run all project tests to confirm nothing broken: `npx vitest run`.

**Save the verification report to**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-8.md`

---

## Phase 17: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: Phase 1–16
- **Retry limit**: 2

### Prompt

You are the implementation reviewer for the query-v2 module. Review all changes and produce the final implementation record.

**Read these files for context:**

- **Task**: `.thoughts/2026-03-17-1000_query-v2/TASK.md`
- **Research summary**: `.thoughts/2026-03-17-1000_query-v2/01-research/README.md`
- **Design summary**: `.thoughts/2026-03-17-1000_query-v2/02-design/README.md`
- **Plan summary**: `.thoughts/2026-03-17-1000_query-v2/03-plan/README.md`
- **All plan phases**: `.thoughts/2026-03-17-1000_query-v2/03-plan/01-foundation.md` through `08-docs-demos.md`
- **Verification reports**: `.thoughts/2026-03-17-1000_query-v2/04-implement/verification-1.md` through `verification-8.md`
- **Design architecture**: `.thoughts/2026-03-17-1000_query-v2/02-design/01-architecture.md` (§7 public API surface for export verification)
- **Design test cases**: `.thoughts/2026-03-17-1000_query-v2/02-design/06-testcases.md` (for coverage mapping)

**Write `README.md` in `.thoughts/2026-03-17-1000_query-v2/04-implement/`** (replacing the current placeholder), with these sections:

### Required README.md structure:

```yaml
---
title: "Implementation Record: Query v2 Module"
date: <today>
status: <Approved or Not Approved>
feature: "New query-v2 module with createApi, ResourceV2, agents, caching, patches, machines, snapshots, plugins, SSR support"
plan: "../03-plan/README.md"
rdpi-version: b0.2
---
```

1. **Status** — Overall pass/fail based on verification reports.

2. **Quality Review**:
   - **Checklist** (table with pass/fail):
     1. All 8 plan phases implemented
     2. All verification reports pass (verification-1.md through verification-8.md)
     3. No out-of-scope files modified (only `src/query-v2/`, `vitest.config.ts`, `src/index.ts`, `docs/`, `apps/demos/`, root `README.md`)
     4. Code follows project patterns (naming, indentation, barrel exports, `@/` alias)
     5. TypeScript strict mode — `npm run ts-check` passes
     6. Barrel exports correct — `src/query-v2/index.ts` matches architecture §7
     7. Documentation proportional to feature scope
     8. No security vulnerabilities (no user input passed to eval, no prototype pollution, no XSS in demos)
     9. No imports from `src/query/` in any `src/query-v2/` file
     10. All 97 test cases from design mapped and passing
   - **Documentation Proportionality**: Compare created docs/demos to existing.
   - **Issues Found**: Any problems discovered during review.

3. **Phase Completion** — Table mapping each plan phase to its verification status.

4. **Verification Summary** — Aggregate pass/fail counts from all verification reports.

5. **Change Summary** — List all files created and modified, grouped by directory.

6. **Post-Implementation Recommendations** — Build validation, manual testing areas, known limitations.

7. **Recommended Commit Message** — Conventional commits format, e.g.:
   ```
   feat(query-v2): implement experimental query-v2 module

   - createApi factory with plugin system
   - ResourceV2 with dual-strategy cache
   - Machine-based state management
   - SSR snapshot support
   - ReactHooksPlugin for React integration
   - Comprehensive test suite (97 test cases)
   - Documentation and demo applications

   BREAKING CHANGE: none (new module, experimental)
   ```

---
