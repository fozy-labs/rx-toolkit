---
title: "Phases: 04-implement"
date: 2026-03-25
stage: 04-implement
---

# Phases: 04-implement

## Phase 1: Code — Plan Phase 1 (Types & Lib)

- **Agent**: `rdpi-codder`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/01-types-and-lib.md` fully — it contains Tasks 1.1 through 1.15 with exact file paths, type signatures, and implementation details.

Implement every task in order. All new files go into `src/query-v2/`. Key deliverables:
- 9 type definition files in `src/query-v2/types/` (machine.types.ts, cache.types.ts, resource.types.ts, agent.types.ts, lifecycle.types.ts, snapshot.types.ts, plugin.types.ts, common.types.ts, types barrel)
- `src/query-v2/lib/SKIP_TOKEN.ts` and `src/query-v2/lib/stableStringify.ts`
- Barrel exports: `src/query-v2/types/index.ts`, `src/query-v2/lib/index.ts`, `src/query-v2/index.ts`
- 2 test files: `src/query-v2/lib/__tests__/SKIP_TOKEN.test.ts`, `src/query-v2/lib/__tests__/stableStringify.test.ts`

Reference design docs for type details:
- `../02-design/03-model.md` — canonical type definitions (§1–§16)
- `../02-design/01-architecture.md` — layer hierarchy rules
- `../02-design/06-testcases.md` — test case IDs L01–L09

Follow existing code patterns in the repo (naming, indentation, `@/` alias for imports within `src/`). Read neighboring files in `src/` for style reference. Maintain TypeScript strict mode compatibility. Update barrel `index.ts` files when adding new modules. Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 2: Verify Plan Phase 1

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 1
- **Retry limit**: 1

### Prompt

Phase 1 implemented the types and lib layer for query-v2. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/lib/__tests__/SKIP_TOKEN.test.ts` — Tests L01–L04.
3. Run `npx vitest run src/query-v2/lib/__tests__/stableStringify.test.ts` — Tests L05–L09.
4. Check that all barrel exports exist: `src/query-v2/types/index.ts`, `src/query-v2/lib/index.ts`, `src/query-v2/index.ts`.
5. Verify no upward imports (types/ and lib/ must not import from core/, api/, react/, plugins/).

Read the verification criteria from `../03-plan/01-types-and-lib.md` (section "Verification").

Save the report to `04-implement/verification-1.md`.

---

## Phase 3: Code — Plan Phases 2+3 (State Machines & Cache Infrastructure)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 2
- **Retry limit**: 2

### Prompt

Read BOTH plan phase files fully:
- `../03-plan/02-state-machines.md` — Tasks 2.1 through 2.11 (Patcher, MachineWithData, 5 machine classes, Machine factory, barrel, tests)
- `../03-plan/03-cache-infrastructure.md` — Tasks 3.1 through 3.7 (CacheEntry, SerializeCacheMap, CompareCacheMap, createCacheMap factory, barrel, tests)

These two plan phases are independent of each other (both depend only on Phase 1's types/lib). Implement all tasks from both phases.

**Phase 2 deliverables** (core/machines/):
- `src/query-v2/core/machines/Patcher.ts` — static patch management methods using Immer
- `src/query-v2/core/machines/MachineWithData.ts` — abstract base for data-bearing states
- 5 concrete machine classes: `MachineIdle.ts`, `MachinePending.ts`, `MachineSuccess.ts`, `MachineError.ts`, `MachineRefreshing.ts`
- `src/query-v2/core/machines/Machine.ts` — static factory (`Machine.idle()`, `Machine.fromSnapshot()`)
- Barrel: `src/query-v2/core/machines/index.ts`
- Tests: `src/query-v2/core/machines/__tests__/Patcher.test.ts` (~13 cases PA01–PA13), `src/query-v2/core/machines/__tests__/Machine.test.ts` (~36 cases SM01–SM36)

**Phase 3 deliverables** (core/):
- `src/query-v2/core/CacheEntry.ts` — reactive signal wrapper
- `src/query-v2/core/CacheMap/SerializeCacheMap.ts`, `CompareCacheMap.ts`, `createCacheMap.ts`
- Barrel: `src/query-v2/core/CacheMap/index.ts`
- Tests: `src/query-v2/core/__tests__/CacheEntry.test.ts` (~10 cases CE01–CE10), `src/query-v2/core/__tests__/CacheMap.test.ts` (~24 cases CM-F01–F05, CM01–CM19)

Reference design docs:
- `../02-design/03-model.md` — §2–§6 (machines, Patcher, CacheEntry, CacheMap)
- `../02-design/04-decisions.md` — ADR-2 (immutable machines), ADR-6 (consistency violation), ADR-7 (cache key serialization), ADR-19 (CacheMap dual impl)
- `../02-design/02-dataflow.md` — §4 (state machine spec), §5 (cache flows)
- `../02-design/06-testcases.md` — test case specs SM01–SM36, PA01–PA13, CE01–CE10, CM-F01–F05, CM01–CM19

Follow existing code patterns. Use `@/` alias for imports within `src/`. All machine classes must be immutable (transitions return new instances). Enable Immer patches at module level. Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 4: Verify Plan Phases 2+3

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 3
- **Retry limit**: 1

### Prompt

Phase 3 implemented state machines (Plan Phase 2) and cache infrastructure (Plan Phase 3). Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/machines/__tests__/Patcher.test.ts` — Tests PA01–PA13.
3. Run `npx vitest run src/query-v2/core/machines/__tests__/Machine.test.ts` — Tests SM01–SM36.
4. Run `npx vitest run src/query-v2/core/__tests__/CacheEntry.test.ts` — Tests CE01–CE10.
5. Run `npx vitest run src/query-v2/core/__tests__/CacheMap.test.ts` — Tests CM-F01–F05, CM01–CM19.
6. Verify barrel exports: `src/query-v2/core/machines/index.ts`, `src/query-v2/core/CacheMap/index.ts`.
7. Verify no upward imports (core/ must not import from api/, react/, plugins/).

Read the verification criteria from both:
- `../03-plan/02-state-machines.md` (section "Verification")
- `../03-plan/03-cache-infrastructure.md` (section "Verification")

Save the report to `04-implement/verification-2-3.md`.

---

## Phase 5: Code — Plan Phase 4 (RCE & LifecycleHooks)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 4
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/04-rce-and-lifecycle.md` fully — Tasks 4.1 through 4.5.

Implement every task in order. Key deliverables:
- `src/query-v2/__tests__/helpers/controllable-promise.ts` and barrel — shared test utilities
- `src/query-v2/core/Resource/ResourceV2CacheEntry.ts` — extends CacheEntry with query lifecycle, abort, patches, consistency violations
- `src/query-v2/core/LifecycleHooks.ts` — lifecycle hook management (onCacheEntryAdded, onQueryStarted callbacks)
- Tests: `src/query-v2/core/__tests__/ResourceV2CacheEntry.test.ts` (~15 cases RCE01–RCE15), `src/query-v2/core/__tests__/LifecycleHooks.test.ts` (~9 cases LH01–LH09)

Reference design docs:
- `../02-design/03-model.md` — §5 (CacheEntry), §7 (ResourceV2 RCE parts), §9, §9.1 (LifecycleHooks)
- `../02-design/04-decisions.md` — ADR-4 (CacheEntry inheritance), ADR-14 (CacheEntry.complete), ADR-17 (abort at entry)
- `../02-design/02-dataflow.md` — §1 (resource scenarios: fetch, SWR, abort, error→retry)
- `../02-design/06-testcases.md` — test case specs RCE01–RCE15, LH01–LH09

ResourceV2CacheEntry extends `CacheEntry<TMachineInstance<TArgs, TData>>` (class inheritance per ADR-4). It adds: `query()`, `invalidate()`, `createPatch()`, abort controller management, machine state transitions, lifecycle hook integration. Use `cacheLifetime: false` in all unit tests to prevent GC timer interference.

Use the controllable-promise pattern for all async tests — no real network calls, no artificial delays. Follow existing code patterns. Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 6: Verify Plan Phase 4

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 5
- **Retry limit**: 1

### Prompt

Phase 5 implemented ResourceV2CacheEntry and LifecycleHooks (Plan Phase 4). Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/__tests__/ResourceV2CacheEntry.test.ts` — Tests RCE01–RCE15.
3. Run `npx vitest run src/query-v2/core/__tests__/LifecycleHooks.test.ts` — Tests LH01–LH09.
4. Verify that controllable-promise test helpers work (they are used by the above tests).
5. Verify no upward imports (core/ must not import from api/, react/, plugins/).

Read the verification criteria from `../03-plan/04-rce-and-lifecycle.md` (section "Verification").

Save the report to `04-implement/verification-4.md`.

---

## Phase 7: Code — Plan Phase 5 (ResourceV2, Agent & Snapshot)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 6
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/05-resource-agent-snapshot.md` fully — Tasks 5.1 through 5.9.

Implement every task in order. Key deliverables:
- `src/query-v2/core/Resource/ResourceV2.ts` — main resource orchestrator (CacheMap management, GC lifecycle, SWR, getEntry/getEntry$, resetCache)
- `src/query-v2/core/Resource/ResourceV2Agent.ts` — per-consumer stateful observer (start, state$, compareArgs, SKIP support)
- `src/query-v2/core/Resource/index.ts` — Resource barrel
- `src/query-v2/core/Snapshot.ts` — snapshot capture/hydration (core-level, Map<string, ResourceV2> param)
- `src/query-v2/core/index.ts` — core barrel (finalize with all core exports)
- Tests: `src/query-v2/core/__tests__/ResourceV2.test.ts` (~28 cases RE01–RE16, RE18–RE23, GC01–GC05), `src/query-v2/core/__tests__/ResourceV2Agent.test.ts` (~18 cases AG01–AG18), `src/query-v2/core/__tests__/Snapshot.test.ts` (~12 cases SN01–SN12)

Reference design docs:
- `../02-design/03-model.md` — §7 (ResourceV2), §8 (Agent, ArgsOrVoid), §10 (Snapshot)
- `../02-design/04-decisions.md` — ADR-3 (SWR), ADR-5 (GC refcount+timer), ADR-10 (agent start), ADR-11 (getEntry$ reactive), ADR-13 (compare no snapshot), ADR-18 (agent independence)
- `../02-design/02-dataflow.md` — §1 (resource scenarios), §2 (snapshot), §6 (reactive chain)
- `../02-design/06-testcases.md` — test case specs RE01–RE23, GC01–GC05, AG01–AG18, SN01–SN12

ResourceV2 uses `createCacheMap()` factory. `getEntry()` has two overloads (with/without `doInitiate`). `getEntry$()` has two reactive overloads via `Signal.compute`. GC uses `share({ resetOnRefCountZero })` + `cacheLifetime` timer. Core-level `hydrateSnapshot` is NOT exported from the core barrel (API-layer version is the sole public export — see Task 5.9). Use `cacheLifetime: false` in unit tests.

Follow existing code patterns. Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 8: Verify Plan Phase 5

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 7
- **Retry limit**: 1

### Prompt

Phase 7 implemented ResourceV2, ResourceV2Agent, and Snapshot (Plan Phase 5). Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/__tests__/ResourceV2.test.ts` — Tests RE01–RE16, RE18–RE23, GC01–GC05.
3. Run `npx vitest run src/query-v2/core/__tests__/ResourceV2Agent.test.ts` — Tests AG01–AG18.
4. Run `npx vitest run src/query-v2/core/__tests__/Snapshot.test.ts` — Tests SN01–SN12.
5. Verify core barrel: `src/query-v2/core/index.ts` exports all public core symbols but NOT `hydrateSnapshot`.
6. Verify no upward imports (core/ must not import from api/, react/, plugins/).

Read the verification criteria from `../03-plan/05-resource-agent-snapshot.md` (section "Verification").

Save the report to `04-implement/verification-5.md`.

---

## Phase 9: Code — Plan Phase 6 (API Layer)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 8
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/06-api-layer.md` fully — Tasks 6.1 through 6.6.

Implement every task in order. Key deliverables:
- `src/query-v2/api/createApi.ts` — main entry point factory (`createApi<TPlugins>`)
- `src/query-v2/api/createResourceV2.ts` — standalone resource factory (outside of createApi)
- `src/query-v2/api/hydrateSnapshot.ts` — API-level SSR hydration (takes `IApi` param — sole public export)
- `src/query-v2/api/index.ts` — api barrel
- Update `src/query-v2/index.ts` — add api layer exports
- Tests: `src/query-v2/api/__tests__/api.test.ts` (~11 cases AP01–AP06, AP08–AP11)

Reference design docs:
- `../02-design/03-model.md` — §12 (factory signatures), §8 (IApi), §11 (plugin types)
- `../02-design/04-decisions.md` — ADR-15 (V2 naming), ADR-16 (single API entry)
- `../02-design/01-architecture.md` — api layer position and rules
- `../02-design/06-testcases.md` — test case specs AP01–AP11

`createApi` manages resources in internal `Map<string, ResourceV2>`, supports `initialSnapshot` hydration, and plugin augmentation (`PluginAugmentations<TPlugins, TArgs, TData>` conditional types). `hydrateSnapshot` at API level is the sole public version — core-level one stays internal. `createResourceV2` standalone wraps `ResourceV2` without API/plugin infrastructure.

Follow existing code patterns. Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 10: Verify Plan Phase 6

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 9
- **Retry limit**: 1

### Prompt

Phase 9 implemented the API layer (Plan Phase 6). Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/api/__tests__/api.test.ts` — Tests AP01–AP06, AP08–AP11.
3. Verify api barrel: `src/query-v2/api/index.ts` exports `createApi`, `createResourceV2`, `hydrateSnapshot`.
4. Verify module barrel `src/query-v2/index.ts` now includes api layer exports.
5. Verify no upward imports (api/ must not import from react/, plugins/).

Read the verification criteria from `../03-plan/06-api-layer.md` (section "Verification").

Save the report to `04-implement/verification-6.md`.

---

## Phase 11: Code — Plan Phase 7 (React & Plugins)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 10
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/07-react-and-plugins.md` fully — Tasks 7.1 through 7.8.

Implement every task in order. Key deliverables:
- `src/query-v2/react/useResourceV2Agent.ts` — React hook using `useSyncExternalStore`, `useConstant`, `useEventHandler`
- `src/query-v2/react/index.ts` — react barrel
- `src/query-v2/plugins/ReactHooksPlugin.ts` — `IPlugin` implementation that augments resources with `useResourceV2Agent`
- `src/query-v2/plugins/index.ts` — plugins barrel
- Update `src/query-v2/index.ts` — add react and plugins layer exports
- Tests: `src/query-v2/react/__tests__/useResourceV2Agent.test.ts` (~10 cases RH01–RH10), `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` (~11 cases PL01–PL11), `src/query-v2/types/__tests__/type-level.test.ts` (type-level plugin augmentation tests)

Reference design docs:
- `../02-design/03-model.md` — §13 (React hook), §11 (plugin types), §14 (type hierarchy)
- `../02-design/04-decisions.md` — ADR-9 (plugin augmentation)
- `../02-design/02-dataflow.md` — §3 (plugins)
- `../02-design/06-testcases.md` — test case specs RH01–RH10, PL01–PL11

`useResourceV2Agent` creates a `ResourceV2Agent` via `resource.createAgent()`, uses `useSyncExternalStore` for concurrent mode safety. `ReactHooksPlugin` implements `IPlugin` with `augmentResource<TArgs, TData>(resource, options)` — attaches `useResourceV2Agent` as a method on resources created via `createApi`. SKIP token disconnects observation.

Use `@testing-library/react` for React hook tests. Follow existing React test patterns in the repo (check `src/common/react/` or `src/query/react/` for reference). Do NOT modify files outside `src/query-v2/` in this phase.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 12: Verify Plan Phase 7

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 11
- **Retry limit**: 1

### Prompt

Phase 11 implemented React hooks and plugins (Plan Phase 7). Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/react/__tests__/useResourceV2Agent.test.ts` — Tests RH01–RH10.
3. Run `npx vitest run src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` — Tests PL01–PL11.
4. Run `npx vitest run src/query-v2/types/__tests__/type-level.test.ts` — Plugin augmentation type tests.
5. Verify barrel exports: `src/query-v2/react/index.ts`, `src/query-v2/plugins/index.ts`.
6. Verify module barrel `src/query-v2/index.ts` now includes react and plugins layer exports.
7. Verify no upward imports (react/ must not import from plugins/; plugins/ may only import from react/ downward).

Read the verification criteria from `../03-plan/07-react-and-plugins.md` (section "Verification").

Save the report to `04-implement/verification-7.md`.

---

## Phase 13: Code — Plan Phase 8 (Integration Tests & Exports)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 12
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/08-integration-and-exports.md` fully — Tasks 8.1 through 8.8.

Implement every task in order. Key deliverables:
- `src/query-v2/__tests__/integration/query-flow.test.ts` — Tests INT01, INT02, INT12
- `src/query-v2/__tests__/integration/gc-lifecycle.test.ts` — Tests INT05, INT06
- `src/query-v2/__tests__/integration/optimistic-updates.test.ts` — Tests INT08, INT09, INT10
- `src/query-v2/__tests__/integration/snapshot-ssr.test.ts` — Tests INT03, INT04, INT07, INT13
- `src/query-v2/__tests__/integration/edge-cases.test.ts` — Tests E01–E10
- Finalize `src/query-v2/index.ts` — final public API surface (public vs internal exports per Task 8.7)
- Update `src/index.ts` — ensure `export * as unstable_queryV2 from "./query-v2"` works correctly (Task 8.8)

Reference design docs:
- `../02-design/06-testcases.md` — test case specs INT01–INT14, E01–E10
- `../02-design/02-dataflow.md` — all dataflow scenarios end-to-end
- `../02-design/03-model.md` — §15 (visibility summary for public/internal)
- `../02-design/08-risks.md` — risk mitigations requiring test coverage (R01, R02, R03, R05, R08, R09, R13, R17, R19, R20)

Integration tests exercise full cross-layer flows: createApi → createResourceV2 → useResourceV2Agent → full lifecycle. Use `createControllablePromise` / `createControllableObservable` for async control. Use fake timers for GC tests. Edge cases cover error conditions, concurrent operations, and boundary scenarios.

Final barrel must export only public API: `createApi`, `createResourceV2`, `hydrateSnapshot`, `useResourceV2Agent`, `ReactHooksPlugin`, `SKIP_TOKEN`, and all public types/interfaces. Internal symbols stay unexported.

Follow existing code patterns. `src/index.ts` line 9 already has the `unstable_queryV2` export — verify it resolves correctly after barrel finalization.

After implementation, run `npm run ts-check` — if it fails, fix within scope (max 2 attempts).

---

## Phase 14: Verify Plan Phase 8

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 13
- **Retry limit**: 1

### Prompt

Phase 13 implemented integration tests and finalized exports (Plan Phase 8). Verify:

1. Run `npm run ts-check` — must pass with no errors across the entire project.
2. Run `npx vitest run src/query-v2/__tests__/integration/` — All integration tests (INT01–INT14).
3. Run `npx vitest run src/query-v2/__tests__/integration/edge-cases.test.ts` — Tests E01–E10.
4. Run `npx vitest run src/query-v2/` — ALL query-v2 tests must pass (full regression).
5. Verify `src/query-v2/index.ts` exports match the public API surface per `../02-design/03-model.md#§15`.
6. Verify `src/index.ts` correctly re-exports `unstable_queryV2`.
7. Check that no internal symbols leak through the public barrel.

Read the verification criteria from `../03-plan/08-integration-and-exports.md` (section "Verification").

Save the report to `04-implement/verification-8.md`.

---

## Phase 15: Code — Plan Phase 9 (Documentation & Demos)

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 14
- **Retry limit**: 2

### Prompt

Read the plan phase file at `../03-plan/09-docs-and-demos.md` fully — Tasks 9.1 through 9.9.

Implement every task in order. Key deliverables:
- `docs/query-v2/v0.2/README.md` — main v0.2 documentation
- `docs/query-v2/v0.2/optimistic-updates.md` — optimistic update patterns guide
- `docs/query-v2/v0.2/ssr.md` — SSR/snapshot guide
- Deprecation banners added to v0.1 docs: `docs/query-v2/v0.1/README.md`, `docs/query-v2/v0.1/optimistic-updates.md`, `docs/query-v2/v0.1/ssr.md`, and the v0.1 internals doc
- `docs/query-v2/README.md` — update to link both v0.1 and v0.2
- `docs/migrations/query-v2.md` — update migration guide with v0.1→v0.2 migration steps
- Demo updates in `apps/demos/src/examples/query-v2/`: update 3 demo files to use v0.2 API

Reference design docs:
- `../02-design/07-docs.md` — documentation deliverables specification

Read the existing v0.1 docs and demo files to understand current patterns before creating v0.2 versions. Documentation should reflect the actual implemented API (read `src/query-v2/index.ts` and key source files for accurate API surface). Deprecation banners should point users to v0.2 equivalents.

Note: this phase modifies files OUTSIDE `src/query-v2/` — specifically `docs/` and `apps/demos/`. This is expected per the plan.

After implementation, run `npm run ts-check` — if it fails (e.g., demo TypeScript errors), fix within scope (max 2 attempts).

---

## Phase 16: Verify Plan Phase 9

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 15
- **Retry limit**: 1

### Prompt

Phase 15 implemented documentation and demo updates (Plan Phase 9). Verify:

1. Run `npm run ts-check` — must pass (demos must compile).
2. Verify all v0.2 doc files exist: `docs/query-v2/v0.2/README.md`, `docs/query-v2/v0.2/optimistic-updates.md`, `docs/query-v2/v0.2/ssr.md`.
3. Verify deprecation banners present in v0.1 docs: check that `docs/query-v2/v0.1/README.md` and other v0.1 files contain deprecation notices pointing to v0.2.
4. Verify `docs/query-v2/README.md` links to both v0.1 and v0.2.
5. Verify `docs/migrations/query-v2.md` contains v0.1→v0.2 migration instructions.
6. Verify demo files in `apps/demos/src/examples/query-v2/` use v0.2 API imports.
7. Run full check: `npm run check:all` — final validation that everything works together.

Read the verification criteria from `../03-plan/09-docs-and-demos.md` (section "Verification").

Save the report to `04-implement/verification-9.md`.

---

## Phase 17: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phases 1–16
- **Retry limit**: 2

### Prompt

Review the complete query-v2 implementation. Read all inputs:

**Plan phases** (what was supposed to be implemented):
- `../03-plan/01-types-and-lib.md`
- `../03-plan/02-state-machines.md`
- `../03-plan/03-cache-infrastructure.md`
- `../03-plan/04-rce-and-lifecycle.md`
- `../03-plan/05-resource-agent-snapshot.md`
- `../03-plan/06-api-layer.md`
- `../03-plan/07-react-and-plugins.md`
- `../03-plan/08-integration-and-exports.md`
- `../03-plan/09-docs-and-demos.md`

**Design documents** (source of truth for architecture and types):
- `../02-design/01-architecture.md`
- `../02-design/03-model.md`
- `../02-design/04-decisions.md`

**Research** (original context):
- `../01-research/README.md`

**Verification reports** (tester results):
- `04-implement/verification-1.md`
- `04-implement/verification-2-3.md`
- `04-implement/verification-4.md`
- `04-implement/verification-5.md`
- `04-implement/verification-6.md`
- `04-implement/verification-7.md`
- `04-implement/verification-8.md`
- `04-implement/verification-9.md`

**Task description**: `../TASK.md`

Write `04-implement/README.md` (replace the existing placeholder) with the full implementation record:
- Date, status, plan link
- Phase completion status (9/9 plan phases)
- Verification results summary (from all verification-*.md files)
- Quality review checklist: all plan phases implemented, verification passed, no out-of-scope files modified (except Phase 9 docs/demos), code follows project patterns, barrel exports correct, TypeScript strict mode, docs proportional, no security vulnerabilities
- List of ALL changed/created files across all phases

---

## Phase 18: Fix — Add `_lastEntry$` to ResourceV2

- **Agent**: `rdpi-codder`
- **Depends on**: Phase 8
- **Retry limit**: 2

### Prompt

**Context**: Phase 7 implemented ResourceV2 but omitted the `_lastEntry$` internal signal required by the design (ADR-11, `02-design/03-model.md` §7, `02-design/02-dataflow.md` §6, `02-design/04-decisions.md` ADR-11). The user also manually cleaned up unnecessary fields/methods and fixed barrel exports. Your job is ONLY to add the missing `_lastEntry$` signal.

**Additionally**: The user manually fixed exports in `src/query-v2/index.ts` — read the current file and do NOT change it. The user also removed garbage fields/methods from ResourceV2 — read the current code and work with what's there. Do NOT add anything the user removed.

**What to do**:

1. Read the current `src/query-v2/core/Resource/ResourceV2.ts` in full.
2. Read the design specification for `_lastEntry$`:
   - `../02-design/03-model.md` — search for `_lastEntry$` 
   - `../02-design/04-decisions.md` — ADR-11
   - `../02-design/02-dataflow.md` — §6 (reactive chain)
3. Add `private _lastEntry$: SignalFn<ResourceV2CacheEntry<TArgs, TData> | null>` field, initialized to `Signal.state(null)` in the constructor.
4. Update `_getOrCreateEntry()` to set `_lastEntry$` when an entry is accessed.
5. Update `getEntry$()` to read `_lastEntry$()` as a reactive dependency so that Signal.compute consumers recompute when the tracked entry changes.
6. Update `resetCache()` to set `_lastEntry$(null)` inside the `Batcher.run()` block.
7. Run `npm run ts-check` — if it fails, fix within scope.
8. Run `npx vitest run src/query-v2/core/__tests__/ResourceV2.test.ts` — all existing tests must pass (RE08 and RE23 specifically test `getEntry$` reactivity and reset behavior).

**Constraints**: Only modify `src/query-v2/core/Resource/ResourceV2.ts`. Do NOT touch any other files. Do NOT add new fields, methods, or exports beyond `_lastEntry$` integration.

---

## Phase 19: Verify — `_lastEntry$` Fix

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 18
- **Retry limit**: 1

### Prompt

Phase 18 added the missing `_lastEntry$` signal to ResourceV2. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/__tests__/ResourceV2.test.ts` — all tests must pass (especially RE08: getEntry$ reactive, RE23: getEntry$ returns null after reset).
3. Read `src/query-v2/core/Resource/ResourceV2.ts` and confirm:
   - `_lastEntry$` field exists with type `SignalFn<ResourceV2CacheEntry<TArgs, TData> | null>`.
   - `getEntry$()` reads `_lastEntry$()` as a reactive dependency.
   - `resetCache()` sets `_lastEntry$` to null.
   - `_getOrCreateEntry()` updates `_lastEntry$`.
4. Verify no other files were modified.

Save the report to `04-implement/verification-fix-lastEntry.md`.
- Post-implementation recommendations (manual testing areas, build verification)
- Recommended commit message

Run `npm run check:all` as final validation — report result in README.md.

---

# Redraft Round 1

## Phase 20: Fix Critical #1, #2, #3 + Medium #11

- **Agent**: `rdpi-codder`
- **Output**: `src/query-v2/react/useResourceV2Agent.ts`, `src/query-v2/index.ts`
- **Depends on**: Phase 19
- **Retry limit**: 2
- **Review issues**: #1, #2, #3, #11

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Your assigned issues: #1, #2, #3, #11.

**Issue #1 — useResourceV2Agent infinite re-render loop** (Critical):
Affected file: `src/query-v2/react/useResourceV2Agent.ts`.
`agent.start()` is called during render, mutating `_tracking$` signal, causing `useSyncExternalStore` to re-render infinitely. The SKIP branch also unconditionally creates a new object via `_tracking$.set(...)` each render. All RH01–RH10 tests fail.

Read the current implementation, then read the design:
- `../02-design/03-model.md` §13 (React hook contract)
- `../02-design/04-decisions.md` ADR-10 (agent start)

Fix: move `agent.start()` out of the render path (into `useEffect` or guard with a ref). Ensure the SKIP branch does not mutate signals during render. The `useSyncExternalStore` subscribe/getSnapshot contract must be honored — `getSnapshot` must return a stable reference when nothing changed.

**Issues #2, #3, #11 — Barrel export fixes** (Critical + Medium):
Affected file: `src/query-v2/index.ts`.

Read the current barrel, then read `../02-design/03-model.md` §15 (visibility summary).

- #2: Add missing `getSnapshot` and `Patcher` value exports.
- #3: Replace `export type * from "./types"` with explicit named type exports that exclude internal types (`ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `TCacheMapFactory`, `ICacheMapOptions`).
- #11: Add `stableStringify` export from lib.

After fixes, run `npm run ts-check` — fix any errors within scope.

---

## Phase 21: Verify Critical fixes

- **Agent**: `rdpi-tester`
- **Output**: `04-implement/verification-redraft-1-critical.md`
- **Depends on**: Phase 20
- **Retry limit**: 1
- **Review issues**: #1, #2, #3, #11

### Prompt

Phase 20 fixed Critical issues #1, #2, #3 and Medium #11. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/react/__tests__/useResourceV2Agent.test.ts` — ALL RH01–RH10 tests must pass (issue #1 fix).
3. Run `npx vitest run src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` — PL01–PL11 must pass (React integration still works).
4. Verify `src/query-v2/index.ts` barrel:
   - Exports `getSnapshot` (value export from core/Snapshot or api/).
   - Exports `Patcher` (value export from core/machines/).
   - Exports `stableStringify` (value export from lib/).
   - Does NOT export `ICacheEntry`, `ICacheEntryOptions`, `ICacheMap`, `TCacheMapFactory`, `ICacheMapOptions` (internal types must not leak).
5. Run `npx vitest run src/query-v2/` — full regression, report any NEW failures.

Save the report to `04-implement/verification-redraft-1-critical.md`.

---

## Phase 22: Fix High #4, #5, #6

- **Agent**: `rdpi-codder`
- **Output**: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`
- **Depends on**: Phase 21
- **Retry limit**: 2
- **Review issues**: #4, #5, #6

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Your assigned issues: #4, #5, #6.

All three issues are in the same file: `src/query-v2/core/resource/ResourceV2CacheEntry.ts`. Read it in full.

Also read the design references:
- `../02-design/03-model.md` §5 (CacheEntry), §7 (ResourceV2 fetch lifecycle), §9 (LifecycleHooks)
- `../02-design/04-decisions.md` ADR-6 (consistency violation), ADR-14 (CacheEntry.complete)
- `../02-design/02-dataflow.md` §1 (fetch scenarios including abort, error, consistency violation)

**Issue #4 — INT09: Consistency violation auto-invalidation**:
In `finishPatch` (or wherever a patch abort is handled), when `isConsistencyViolation` is true on the abort result, the entry must automatically call `invalidate()` to trigger a refetch. Currently the abort path does not check this flag.

**Issue #5 — INT13: `cacheDataLoaded` lifecycle callback never fires**:
After the first `MachineSuccess` transition in `_doFetch`, call `this._lifecycleHooks.resolveDataLoaded(...)` (or equivalent) so that `onCacheEntryAdded` listeners receive their `cacheDataLoaded` promise resolution.

**Issue #6 — E01: Synchronous throw in queryFn not caught**:
Wrap the `queryFn()` call in `_doFetch` with try/catch. A sync throw should transition the machine to `MachineError` state, just like an async rejection would.

After fixes, run `npm run ts-check` and `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` — fix any errors within scope.

---

## Phase 23: Verify High fixes

- **Agent**: `rdpi-tester`
- **Output**: `04-implement/verification-redraft-1-high.md`
- **Depends on**: Phase 22
- **Retry limit**: 1
- **Review issues**: #4, #5, #6

### Prompt

Phase 22 fixed High issues #4, #5, #6 in ResourceV2CacheEntry. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/__tests__/integration/optimistic-updates.test.ts` — INT09 (consistency violation auto-invalidation) must pass.
3. Run `npx vitest run src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts` — INT13 (`cacheDataLoaded` fires) must pass.
4. Run `npx vitest run src/query-v2/__tests__/edge-cases.test.ts` — E01 (sync throw in queryFn) must pass.
5. Run `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts` — all RCE01–RCE15 must still pass (regression check).
6. Run `npx vitest run src/query-v2/` — full regression, report any NEW failures.

Save the report to `04-implement/verification-redraft-1-high.md`.

---

## Phase 24: Fix Medium #7, #8, #9, #10

- **Agent**: `rdpi-codder`
- **Output**: Multiple files (see below)
- **Depends on**: Phase 23
- **Retry limit**: 2
- **Review issues**: #7, #8, #9, #10

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Your assigned issues: #7, #8, #9, #10.

**Issue #7 — GC mechanism not connected** (Medium):
Affected files: `src/query-v2/core/resource/ResourceV2.ts`.
Read the design: `../02-design/03-model.md` §7 (ResourceV2 GC), `../02-design/04-decisions.md` ADR-5 (GC refcount+timer).
`ResourceV2` does not implement `subscribe()`/refcount-based GC. The `share({resetOnRefCountZero})` RxJS pattern is not wired to the CacheMap lifecycle. GC01–GC05 and INT06 tests all fail. Implement the GC mechanism so that entries are removed from the CacheMap after all subscribers disconnect and `cacheLifetime` timer expires.

**Issue #8 — `_status$` not publicly accessible** (Medium):
Affected files: `src/query-v2/core/resource/ResourceV2.ts` (or the tests that reference it).
Tests RE19–RE22 reference `resource.status$()` but `ResourceV2._status$` is private. Either add a public `status$` getter or update the 4 tests to use the correct public API. Read the design (`../02-design/03-model.md` §7) to determine which approach is correct.

**Issue #9 — Demo app TS errors** (Medium):
Affected files: `apps/demos/src/examples/query-v2/simple-resource.tsx`, `apps/demos/src/examples/query-v2/optimistic-patches.tsx`, `apps/demos/src/examples/query-v2/ssr-snapshot.tsx`.
5 TypeScript errors: 3x `TS7006` implicit any, 1x `TS7031` implicit any, 1x `TS2741` missing `timestamp` property. Add type annotations to fix all 5 errors.

**Issue #10 — `type-level.test.ts` runtime crash** (Medium):
Affected file: `src/query-v2/types/__tests__/type-level.test.ts`.
PL10 test invokes `useResourceV2Agent` outside React context at runtime, causing `TypeError: Cannot read properties of null`. This is a duplicate of the already-passing test in `src/query-v2/plugins/__tests__/ReactHooksPlugin.type.test.ts`. Remove the runtime hook invocation or convert it to a type-only assertion (e.g., `expectTypeOf` without calling the hook).

After fixes, run `npm run ts-check` — fix any errors within scope.

---

## Phase 25: Verify Medium fixes

- **Agent**: `rdpi-tester`
- **Output**: `04-implement/verification-redraft-1-medium.md`
- **Depends on**: Phase 24
- **Retry limit**: 1
- **Review issues**: #7, #8, #9, #10

### Prompt

Phase 24 fixed Medium issues #7, #8, #9, #10. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/` AND `apps/demos/src/examples/query-v2/` (issue #9).
2. Run `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2.test.ts` — GC01–GC05 must pass (issue #7), RE19–RE22 must pass (issue #8).
3. Run `npx vitest run src/query-v2/__tests__/integration/gc-lifecycle.test.ts` — INT05, INT06 must pass (issue #7 GC integration).
4. Run `npx vitest run src/query-v2/types/__tests__/type-level.test.ts` — must not crash at runtime (issue #10).
5. Run `npx vitest run src/query-v2/` — full regression, report any NEW failures. All previously passing tests must still pass.

Save the report to `04-implement/verification-redraft-1-medium.md`.

---

## Phase 26: Re-review after Redraft Round 1

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phases 20, 21, 22, 23, 24, 25
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 1 fixes.

Read the original review: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read all Redraft Round 1 verification reports:
- `04-implement/verification-redraft-1-critical.md`
- `04-implement/verification-redraft-1-high.md`
- `04-implement/verification-redraft-1-medium.md`

Read the modified source files to confirm fixes are correct:
- `src/query-v2/react/useResourceV2Agent.ts` (issue #1)
- `src/query-v2/index.ts` (issues #2, #3, #11)
- `src/query-v2/core/resource/ResourceV2CacheEntry.ts` (issues #4, #5, #6)
- `src/query-v2/core/resource/ResourceV2.ts` (issues #7, #8)
- `apps/demos/src/examples/query-v2/simple-resource.tsx` (issue #9)
- `apps/demos/src/examples/query-v2/optimistic-patches.tsx` (issue #9)
- `apps/demos/src/examples/query-v2/ssr-snapshot.tsx` (issue #9)
- `src/query-v2/types/__tests__/type-level.test.ts` (issue #10)

Verify all 11 REVIEW.md issues are resolved. Run final validation:
- `npm run ts-check` — 0 errors in `src/query-v2/`
- `npx vitest run src/query-v2/` — all tests pass

Update `04-implement/README.md`:
- Set status to `Complete` (if all issues resolved) or `Inprogress` (if issues remain)
- Add Redraft Round 1 section documenting which issues were fixed
- Update verification results summary
- Update change summary with modified files

Write the updated REVIEW.md at `04-implement/REVIEW.md` with the new review results.

---

# Redraft Round 2

## Phase 27: Fix RH09 — useEffect dependency array + start() idempotency

- **Agent**: `rdpi-codder`
- **Output**: `src/query-v2/react/useResourceV2Agent.ts`, `src/query-v2/core/resource/ResourceV2Agent.ts`
- **Depends on**: Phase 26
- **Retry limit**: 2
- **Review issues**: #1 (RH09)

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Your assigned issue: #1 (RH09 — error state auto-retried by hook effect).

Also read User Feedback in REVIEW.md — items #1 (npm run check:all must pass) and #2 (Agent uses imperative approach instead of reactive).

**Two files need changes:**

**File 1: `src/query-v2/react/useResourceV2Agent.ts`** (lines 22–26)

The `useEffect` that calls `startAgent(agent, effectiveArg)` has NO dependency array. This means it fires on EVERY render. When error state triggers a re-render, the effect immediately calls `start()` again, which auto-retries the error, transitioning to `pending` before the test can observe the `error` state.

Fix: add `[effectiveArg]` to the `useEffect` dependency array so it only fires when args actually change (or on initial mount). Remove the `startedRef` pre-render sync start hack — it is no longer needed once the effect has a proper dependency array. The initial render should use the agent's default idle state and the effect will fire immediately after mount.

Read the design for the hook contract:
- `../02-design/03-model.md` §13 (React hook contract)
- `../02-design/04-decisions.md` ADR-10 (agent start)

**File 2: `src/query-v2/core/resource/ResourceV2Agent.ts`** (lines 72–78)

The same-args branch in `start()` currently auto-retries on error status:
```
if (machine.status === "error") {
    tracking.current.query().catch(() => {});
}
```

This makes `start()` non-idempotent for same args — calling `start(x)` twice with the same `x` transitions from error→pending, which is a side effect. The design specifies that `start()` should be idempotent for same args: calling it with the same args should be a no-op regardless of current status. Retry should only happen via an explicit `retry()` call or when args actually change.

Fix: remove the auto-retry-on-error logic from the same-args branch. The same-args path should always be a pure no-op (early return with no side effects).

After both fixes, run `npm run ts-check` — fix any errors within scope.

---

## Phase 28: Verify RH09 fix

- **Agent**: `rdpi-tester`
- **Output**: `04-implement/verification-redraft-2.md`
- **Depends on**: Phase 27
- **Retry limit**: 1
- **Review issues**: #1 (RH09)

### Prompt

Phase 27 fixed RH09 by adding `effectiveArg` to the `useEffect` dependency array in `useResourceV2Agent.ts` and removing auto-retry-on-error from `ResourceV2Agent.start()`. Verify:

1. Run `npm run ts-check` — must pass with no errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/react/__tests__/useResourceV2Agent.test.ts` — ALL RH01–RH10 tests must pass. Pay special attention to **RH09** (error state observable) which was the failing test.
3. Run `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — all agent tests must pass (verify start() idempotency didn't break anything).
4. Run `npx vitest run src/query-v2/` — full regression, **all 247 tests** must pass. Report any failures.
5. Run `npm run check:all` — must pass cleanly. Report full output.

Save the report to `04-implement/verification-redraft-2.md`.

---

## Phase 29: Re-review after Redraft Round 2

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phase 27, Phase 28
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 2 (FINAL round) fixes.

Read the current REVIEW.md: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read the Redraft Round 2 verification report: `04-implement/verification-redraft-2.md`.

Read the modified source files to confirm fixes are correct:
- `src/query-v2/react/useResourceV2Agent.ts` — useEffect now has `[effectiveArg]` dependency array; no sync start hack.
- `src/query-v2/core/resource/ResourceV2Agent.ts` — `start()` same-args branch is a pure no-op (no auto-retry on error).

Verify:
- RH09 issue is resolved (error state is stable and observable).
- All 3 User Feedback items from REVIEW.md are addressed (npm run check:all passes, Agent is reactive not imperative, no dynamic type imports).
- No regressions (all 247 tests pass).

Update `04-implement/README.md`:
- Set status to `Complete`
- Add Redraft Round 2 section documenting what was fixed
- Update test count and verification summary

Write the updated REVIEW.md at `04-implement/REVIEW.md` with the final review results.

---

# Redraft Round 3

## Phase 30: Fix TS errors in test files blocking check:all

- **Agent**: `rdpi-codder`
- **Output**: Fixed test files across `src/query-v2/`
- **Depends on**: Phase 29
- **Retry limit**: 2
- **Review issues**: User Feedback #1 from REVIEW.md

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md` — User Feedback #1: `npm run check:all` does not pass.

**Problem diagnosis**: `npm run ts-check` (uses `tsconfig.json`) passes because it excludes test files. But `npm run test` runs `tsc -p tsconfig.test.json` first, which includes test files — and 53 TS errors exist in test files within `src/query-v2/`.

Run `npx tsc -p tsconfig.test.json --noEmit 2>&1` to see the full error list. Then fix ALL type errors in the affected test files. Common error patterns to expect:
- `Type 'boolean' is not assignable to type 'number'` — likely `cacheLifetime` option typed as `number` but tests pass `true`
- `Spread types may only be created from object types` — likely spreading a class instance (`ResourceV2`) that doesn't satisfy the spread constraint
- Case-sensitivity path issues (`Resource` vs `resource` in import paths)
- Type parameter mismatches on mock/factory functions

Affected test files (run `tsc -p tsconfig.test.json` to get the full list):
- `src/query-v2/core/resource/__tests__/ResourceV2.test.ts`
- `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts`
- `src/query-v2/core/resource/__tests__/ResourceV2CacheEntry.test.ts`
- `src/query-v2/core/__tests__/Snapshot.test.ts`
- `src/query-v2/api/__tests__/createApi.test.ts`
- `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts`
- `src/query-v2/plugins/__tests__/ReactHooksPlugin.type.test.ts`
- `src/query-v2/react/__tests__/useResourceV2Agent.test.ts`
- `src/query-v2/types/__tests__/type-level.test.ts`
- `src/query-v2/__tests__/integration/query-flow.test.ts`
- `src/query-v2/__tests__/integration/optimistic-updates.test.ts`
- `src/query-v2/__tests__/integration/plugins-and-snapshot.test.ts`
- `src/query-v2/__tests__/integration/reset-and-multi-agent.test.ts`
- `src/query-v2/__tests__/edge-cases.test.ts`

Fix only type errors — do NOT change test logic or expected behavior. After fixing, run:
1. `npx tsc -p tsconfig.test.json --noEmit` — must produce 0 errors
2. `npx vitest run src/query-v2/` — all existing tests must still pass

Do NOT modify files outside `src/query-v2/`.

---

## Phase 31: Refactor Agent to use reactive getEntry$

- **Agent**: `rdpi-codder`
- **Output**: Updated `src/query-v2/core/resource/ResourceV2Agent.ts`, updated agent tests, updated hook
- **Depends on**: Phase 30
- **Retry limit**: 2
- **Review issues**: User Feedback #2 from REVIEW.md

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md` — User Feedback #2: Agent uses imperative `getEntry` instead of reactive `getEntry$`.

Read the design specification for this requirement:
- `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/04-decisions.md` — ADR-11: `getEntry$` Reactive Reset via ResourceV2 Status Signals
- `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/02-dataflow.md` — §6.1 (signal chain), §6.2 (getEntry$ reactive design), §6.4 (resetAll sequence)

Read the current implementation:
- `src/query-v2/core/resource/ResourceV2Agent.ts` — current imperative approach
- `src/query-v2/core/resource/ResourceV2.ts` — `getEntry$()` method (reads `_status$()` and `_lastEntry$()` signals)
- `src/query-v2/types/agent.types.ts` — `IResourceV2Agent` interface
- `src/query-v2/types/resource.types.ts` — `IResourceV2` interface (has `getEntry$` method)

**What must change**:

1. **`ResourceV2Agent` constructor** — instead of receiving an imperative `getEntry: (args) => ResourceV2CacheEntry` callback, it should receive a reference to `resource.getEntry$` (or the resource itself) so it can call the signal-tracked `getEntry$` method inside its reactive chain.

2. **`ResourceV2Agent.start(args)`** — when `start(args)` is called, the agent should use `getEntry$(args, true)` (the overload that creates-or-gets, i.e., `doInitiate=true`) to obtain the entry. Because `getEntry$` reads `_status$()` and `_lastEntry$()` signals internally, calling it from within a `Signal.compute` context creates reactive dependencies. This means:
   - When `resetAll()` sets `_status$` to "idle", `getEntry$` returns `null` — and the agent's `state$` automatically derives an idle state.
   - The agent becomes reactively aware of cache resets without explicit notification.

3. **`state$` derivation** — `_deriveState` should handle the case where `getEntry$` returns `null` (after reset) and derive the idle state.

4. **`ResourceV2.createAgent()`** (if it exists) or wherever agents are constructed — update to pass `getEntry$` reference instead of `getEntry`.

5. **Agent test updates** — update `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` to:
   - Ensure agent reacts to `resetAll()` / `resetCache()` by automatically returning to idle state
   - Test the `api.resetAll()` scenario: agent.start(args) → data arrives → api.resetAll() → agent.state$ becomes idle with null data
   - Maintain all existing test assertions that still apply

6. **Hook updates** — if `src/query-v2/react/useResourceV2Agent.ts` creates agents or interacts with this changed API, update accordingly.

After implementation, run:
1. `npx tsc -p tsconfig.test.json --noEmit` — 0 errors
2. `npx vitest run src/query-v2/` — all tests pass

Do NOT modify files outside `src/query-v2/`.

---

## Phase 32: Verify Redraft Round 3 fixes

- **Agent**: `rdpi-tester`
- **Output**: `04-implement/verification-redraft-3.md`
- **Depends on**: Phase 30, Phase 31
- **Retry limit**: 1

### Prompt

Phases 30–31 fixed:
- Phase 30: TS errors in test files (53 errors across 14 test files)
- Phase 31: Agent refactored to use reactive `getEntry$` instead of imperative `getEntry`

Run full verification:

1. `npx tsc --noEmit` — must pass with 0 errors (production code).
2. `npx tsc -p tsconfig.test.json --noEmit` — must pass with 0 errors (test code).
3. `npx vitest run src/query-v2/` — ALL tests must pass. Report total count.
4. `npm run check:all` — must pass completely (ts-check + lint + format:check + test). Report full result.
5. Verify Agent reactivity: read `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` and confirm there is a test case covering `resetAll()` / `resetCache()` causing the agent to return to idle state reactively.

Save the report to `04-implement/verification-redraft-3.md`.

---

## Phase 33: Re-review after Redraft Round 3

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phase 30, Phase 31, Phase 32
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 3 fixes.

Read REVIEW.md: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read the Redraft Round 3 verification report: `04-implement/verification-redraft-3.md`.

Read the modified source files:
- `src/query-v2/core/resource/ResourceV2Agent.ts` — now uses reactive `getEntry$` instead of imperative `getEntry`
- `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — has reactive reset test cases
- All test files fixed in Phase 30 (check that `tsc -p tsconfig.test.json` passes)

Verify:
1. **check:all passes** — `npm run check:all` completes with exit code 0 (ts-check + lint + format:check + test all pass).
2. **Agent is reactive** — Agent uses `getEntry$` (signal-tracked) instead of `getEntry` (imperative). Calling `resetAll()` / `resetCache()` causes agent's `state$` to reactively become idle.
3. **No regressions** — all tests pass, no new TS errors.
4. **Design conformance** — implementation matches ADR-11 and §6.2 from `02-design/02-dataflow.md`.

Update `04-implement/README.md`:
- Set status to `Complete`
- Add Redraft Round 3 section documenting what was fixed
- Update test count, verification summary, and phase count

Write the updated REVIEW.md at `04-implement/REVIEW.md` with the final review results.

---

# Redraft Round 4

## Phase 34: Auto-refetch after resetAll/resetCache for active agents + test AG22

- **Agent**: `rdpi-codder`
- **Output**: Code changes in `src/query-v2/core/resource/ResourceV2Agent.ts`, `src/query-v2/core/resource/ResourceV2.ts`, `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts`
- **Depends on**: Phase 33
- **Retry limit**: 2
- **Review issues**: User Feedback — auto-refetch after resetAll

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md` — see "User Feedback" section.

**Problem**: After `resetAll()` or `resetCache()`, if an agent is still active (i.e., `start(args)` was called and the agent is subscribed/mounted), the agent reactively goes to idle (AG19) but does NOT automatically re-initiate the query for its current args. An active agent should auto-refetch.

**Current reactive chain** (from Phase 31):
```
resetCache() → _status$.set("idle") → getEntry$() returns null → Agent.state$ recomputes → idle
```

**Required reactive chain**:
```
resetCache() → _status$.set("idle") → ... → _status$.set("ready")
                                              ↓
Agent.state$ recomputes → getEntry$(args, doInitiate=true) re-fires → new entry created → fetch starts → pending state
```

Read these files to understand the current implementation:
- `src/query-v2/core/resource/ResourceV2Agent.ts` — the `state$` Signal.compute and `start()`/`stop()` methods
- `src/query-v2/core/resource/ResourceV2.ts` — `getEntry$()`, `resetCache()`, `_status$` signal
- `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — existing tests AG19–AG21

Also read the design references for context:
- `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/02-dataflow.md` — §6.2 (getEntry$ reactive design), §6.4 (reset sequence)
- `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/04-decisions.md` — ADR-11

The fix likely involves ensuring that when the agent is active and `_status$` transitions back to "ready" after a reset, the `getEntry$` call with `doInitiate=true` in the agent's `state$` compute re-fires and creates a new cache entry (triggering a fetch). Investigate why this doesn't happen currently — it may be that `resetCache()` does not transition `_status$` back to "ready" after "idle", or the agent's compute doesn't re-fire correctly after the idle→ready transition.

**Deliverables**:
1. Fix the reactive chain so active agents auto-refetch after reset. Minimal changes — do not refactor unrelated code.
2. Add test **AG22** to `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts`:
   - `agent.start(args)` → wait for success data → call `resource.resetCache()` (or `api.resetAll()`) → agent should automatically re-fetch → new data arrives → agent state is success again.
   - The test must NOT manually call `start()` again after the reset — the point is that the agent auto-recovers.

After implementation, run:
- `npm run ts-check` — fix if needed (max 2 attempts)
- `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — AG22 must pass, AG19–AG21 must not regress
- `npx vitest run src/query-v2/` — all query-v2 tests must pass

---

## Phase 35: Verify auto-refetch fix

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 34
- **Retry limit**: 1

### Prompt

Phase 34 implemented auto-refetch for active agents after `resetAll()`/`resetCache()`. Verify:

1. Run `npm run ts-check` — must pass with 0 errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — confirm AG22 exists and passes. AG19–AG21 must still pass.
3. Run `npx vitest run src/query-v2/` — all query-v2 tests pass, no regressions.
4. Run `npm run check:all` — must pass (ts-check + lint + format:check + test).
5. Read `src/query-v2/core/resource/ResourceV2Agent.ts` and `src/query-v2/core/resource/ResourceV2.ts` — confirm the reactive chain: active agent auto-refetches after resetCache sets status back to ready.

Save the report to `04-implement/verification-redraft-4.md`.

---

## Phase 36: Re-review after Redraft Round 4

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phase 34, Phase 35
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 4.

Read REVIEW.md: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read the Redraft Round 4 verification report: `04-implement/verification-redraft-4.md`.

Read the modified source files:
- `src/query-v2/core/resource/ResourceV2Agent.ts` — auto-refetch logic after reset
- `src/query-v2/core/resource/ResourceV2.ts` — resetCache / getEntry$ / _status$ changes (if any)
- `src/query-v2/core/resource/__tests__/ResourceV2Agent.test.ts` — AG22 test

Verify:
1. **check:all passes** — `npm run check:all` completes with exit code 0.
2. **Auto-refetch works** — after resetAll/resetCache, an active agent automatically re-initiates the query for its current args without a manual `start()` call.
3. **No regressions** — all existing tests pass (AG19–AG21 and all other query-v2 tests).
4. **Minimal change** — only the necessary code was modified, no scope creep.

Update `04-implement/README.md`:
- Set status to `Complete`
- Add Redraft Round 4 section documenting what was fixed
- Update test count and phase count

Write the updated REVIEW.md at `04-implement/REVIEW.md` with final review results.

---

# Redraft Round 5

## Phase 37: Devtools integration for query-v2 resources and agents

- **Agent**: `rdpi-codder`
- **Output**: Code changes in `src/query-v2/core/resource/ResourceV2.ts`, `src/query-v2/core/resource/ResourceV2Agent.ts`, `src/query-v2/types/resource.types.ts`, `src/query-v2/types/agent.types.ts`, `src/query-v2/core/resource/__tests__/ResourceV2.devtools.test.ts`, `docs/query-v2/v0.2/devtools.md`
- **Depends on**: Phase 36
- **Retry limit**: 2
- **Review issues**: User Feedback — devtools integration (items 1–4 from REVIEW.md)

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md` — see "User Feedback" section (items 1–4 about devtools).

**Context**: query-v2 resources and agents use internal signals (`_status$`, `_lastEntry$`, `_tracking$`, `state$` etc.) but currently do NOT register a consolidated main state with `SharedOptions.DEVTOOLS`. The existing query-v1 pattern is in `src/query/core/QueriesLifetimeHooks.ts` — it calls `Devtools.createState()` to push state updates. The devtools infrastructure lives in `src/common/devtools/` (types: `DevtoolsLike`, `DevtoolsStateLike`; helpers: `combineDevtools`, `reduxDevtools`). The signals layer has `Devtools` in `src/signals/` that creates signal-level devtools hooks.

Read these files to understand existing patterns:
- `src/common/devtools/types.ts` — `DevtoolsLike` and `DevtoolsStateLike` interfaces
- `src/common/devtools/reduxDevtools.ts` — how Redux DevTools adapter works (batching, `state()` method)
- `src/common/options/SharedOptions.ts` — where `DEVTOOLS` is stored globally
- `src/query/core/QueriesLifetimeHooks.ts` — how v1 registers resource state with devtools (pattern reference)
- `src/query-v2/core/resource/ResourceV2.ts` — current ResourceV2 class
- `src/query-v2/core/resource/ResourceV2Agent.ts` — current Agent class
- `src/query-v2/types/resource.types.ts` — `IResourceV2Options` (has `key?: string`)
- `src/query-v2/types/agent.types.ts` — agent type definitions
- `docs/devtools/README.md` — existing devtools documentation for users

**Requirements** (from User Feedback):

1. **Default: only main state in devtools** — When `SharedOptions.DEVTOOLS` is set, ResourceV2 should register a single devtools state entry per resource that shows the **main resource state** (e.g., the current machine state: status, data, error, args). Do NOT send all internal signals (`_status$`, `_lastEntry$`, computed signals) by default. Similarly, Agent should register a single devtools entry showing its current tracked state (the machine from `state$`). The devtools entry should be a plain-object snapshot of the machine (status, data, error, args) — not the raw signal value.

2. **Name from resource key** — The devtools entry name must be derived from the `key` option in `IResourceV2Options`. For ResourceV2: use `key` directly (e.g., `"users"` → devtools name `"ResourceV2:users"`). For Agent: derive from the resource key (pass it through from ResourceV2 to Agent constructor, e.g., `"ResourceV2:users:agent"`). If `key` is not provided, use a fallback (e.g., `"ResourceV2:<anonymous>"` or skip devtools registration — follow the v1 pattern where `devtoolsName: false` disables it). The `key` field already exists in `IResourceV2Options` — use it.

3. **Debug option** — Add a `devtoolsDebug?: boolean` option to `IResourceV2Options`. When `true`, ResourceV2 additionally registers all internal signals (status$, lastEntry$, cache map states) with devtools for advanced debugging. Default is `false`. This is an opt-in feature for power users. When `devtoolsDebug` is true, the internal signals should appear with descriptive names (e.g., `"ResourceV2:users:_status$"`, `"ResourceV2:users:_lastEntry$"`).

4. **Documentation** — Create `docs/query-v2/v0.2/devtools.md` documenting the devtools integration for query-v2 users. Follow the style/structure of the existing `docs/devtools/README.md`. Cover:
   - How to enable devtools (reference `DefaultOptions.update({ DEVTOOLS: reduxDevtools() })`)
   - What appears in devtools by default (resource main state, agent state)
   - The `key` option and its role in devtools naming
   - The `devtoolsDebug` option for advanced debugging
   - Example code snippets

**Implementation approach**:
- In `ResourceV2` constructor: if `SharedOptions.DEVTOOLS` is available, call `DEVTOOLS.state(name, initState)` to register the main state. Subscribe to the machine signal of the current cache entry and push updates. Use `beforeDevtoolsPush` if needed, or create a direct integration similar to `QueriesLifetimeHooks`.
- In `ResourceV2Agent` constructor: similarly register agent's `state$` with devtools.
- Add `devtoolsDebug?: boolean` to `IResourceV2Options`.
- Pass `key` from ResourceV2 to Agent (via constructor parameter or method).
- Agent devtools should update when `state$` changes — use a Signal.effect or hook into the compute.
- Keep the implementation minimal and consistent with existing patterns.

**Type changes**:
- `IResourceV2Options`: add `devtoolsDebug?: boolean` (the `key` already exists)
- Agent constructor: accept an optional `resourceKey?: string` parameter

**Tests** — create `src/query-v2/core/resource/__tests__/ResourceV2.devtools.test.ts`:
- DT01: ResourceV2 with key registers devtools state when DEVTOOLS is set
- DT02: ResourceV2 without key does not register devtools (or uses fallback)
- DT03: Agent registers devtools state derived from resource key
- DT04: devtoolsDebug=true registers additional internal signals
- DT05: devtoolsDebug=false (default) does NOT register internal signals
- DT06: Devtools state updates when machine state changes (idle → pending → success)
- DT07: ResourceV2 with key=undefined and devtoolsDebug=false — no devtools registration
- Use a mock `DevtoolsLike` object to capture registrations and state updates.

After implementation, run:
- `npm run ts-check` — fix if needed (max 2 attempts)
- `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2.devtools.test.ts` — all DT tests must pass
- `npx vitest run src/query-v2/` — all query-v2 tests must pass, no regressions

---

## Phase 38: Verify devtools integration

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 37
- **Retry limit**: 1

### Prompt

Phase 37 implemented devtools integration for query-v2 resources and agents. Verify:

1. Run `npm run ts-check` — must pass with 0 errors in `src/query-v2/`.
2. Run `npx vitest run src/query-v2/core/resource/__tests__/ResourceV2.devtools.test.ts` — all DT01–DT07 tests must pass.
3. Run `npx vitest run src/query-v2/` — all query-v2 tests pass, no regressions.
4. Run `npm run check:all` — must pass (ts-check + lint + format:check + test).
5. Read `src/query-v2/core/resource/ResourceV2.ts` — confirm:
   - Main state is registered with devtools using the resource `key`
   - Only main machine state is pushed by default (not internal signals)
   - `devtoolsDebug=true` additionally registers internal signals
6. Read `src/query-v2/core/resource/ResourceV2Agent.ts` — confirm agent registers with devtools using resource key-derived name.
7. Read `docs/query-v2/v0.2/devtools.md` — confirm documentation exists and covers: enabling devtools, default behavior, `key` option, `devtoolsDebug` option, examples.
8. Read `src/query-v2/types/resource.types.ts` — confirm `devtoolsDebug?: boolean` option exists in `IResourceV2Options`.

Save the report to `04-implement/verification-redraft-5.md`.

---

## Phase 39: Re-review after Redraft Round 5

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phase 37, Phase 38
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 5.

Read REVIEW.md: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read the Redraft Round 5 verification report: `04-implement/verification-redraft-5.md`.

Read the modified/created source files:
- `src/query-v2/core/resource/ResourceV2.ts` — devtools registration logic
- `src/query-v2/core/resource/ResourceV2Agent.ts` — agent devtools registration
- `src/query-v2/types/resource.types.ts` — `devtoolsDebug` option
- `src/query-v2/types/agent.types.ts` — any agent type changes
- `src/query-v2/core/resource/__tests__/ResourceV2.devtools.test.ts` — DT01–DT07 tests
- `docs/query-v2/v0.2/devtools.md` — user documentation

Verify:
1. **check:all passes** — `npm run check:all` completes with exit code 0.
2. **Default: only main state** — confirm that by default only the main resource/agent state (machine snapshot) is sent to devtools, not all internal signals.
3. **Name from key** — confirm devtools entry names are derived from the resource `key` option.
4. **Debug option** — confirm `devtoolsDebug: true` additionally registers internal signals with descriptive names.
5. **Documentation** — confirm `docs/query-v2/v0.2/devtools.md` exists and is user-facing documentation covering all 4 feedback items.
6. **No regressions** — all existing tests pass (251+ query-v2 tests + new DT tests).
7. **Minimal change** — only devtools-related code was added, no scope creep.
8. **Pattern consistency** — follows existing devtools patterns from `src/common/devtools/` and `src/query/core/QueriesLifetimeHooks.ts`.

Update `04-implement/README.md`:
- Set status to `Complete`
- Add Redraft Round 5 section documenting what was added
- Update test count and phase count

Write the updated REVIEW.md at `04-implement/REVIEW.md` with final review results.

---

# Redraft Round 6

## Phase 40: Remove .thoughts references from source code + add memory leak tests

- **Agent**: `rdpi-codder`
- **Output**: Code changes in `src/query-v2/**/*.ts`, new test file `src/query-v2/__tests__/memory-leaks.test.ts`, new test file `src/query-v2/react/__tests__/memory-leaks.react.test.ts` (or similar)
- **Depends on**: Phase 39
- **Retry limit**: 2
- **Review issues**: User Feedback — items 1 (remove .thoughts refs) and 2 (memory leak tests)

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md` — see "User Feedback" items 1 and 2.

**Issue 1: Remove .thoughts references from source code**

Scan ALL files under `src/query-v2/` (including tests) for comments or strings referencing `.thoughts/` design artifacts. Search for these patterns:
- `ADR-` (e.g., "ADR-2", "ADR-11")
- `§` (e.g., "§6.2", "§4")
- `.thoughts` (literal path references)

For each found reference:
- If the comment is purely a design-doc citation (e.g., `// ADR-2: immutable machines`), **remove the reference entirely** or rewrite as a plain explanatory comment that describes the WHY without citing the artifact.
- If the comment references useful documentation that exists in `docs/`, replace with a `docs/` path reference instead.
- Do NOT remove comments that explain logic — only strip the `.thoughts` / ADR / § citation part.

Run `grep -rn "ADR-\|§\|\.thoughts" src/query-v2/` to find all occurrences. Fix every one.

**Issue 2: Memory leak tests**

Add tests verifying no memory leaks for both vanilla and React scenarios.

**Vanilla memory leak tests** — create or add to an appropriate test file (e.g., `src/query-v2/__tests__/memory-leaks.test.ts` or `src/query-v2/core/resource/__tests__/ResourceV2.memory.test.ts`):

- **ML01**: Agent dispose cleans up subscriptions — create a resource + agent, start a query, dispose the agent, verify that the agent's internal subscriptions are unsubscribed (check `.closed` on subscriptions or verify no further emissions are received).
- **ML02**: Resource resetCache cleans up entry signals — create a resource, initiate a query so entries exist, call `resetCache()`, verify the old cache entries' signal subscriptions are cleaned up (no retained references).
- **ML03**: LifecycleHooks timers are cleared on cleanup — if the resource uses `gcTime` / stale time, verify that pending timers are cleared when entries are cleaned up / resource is reset. Use `vi.useFakeTimers()`.
- **ML04**: Signal unsubscription on resource scope disposal — create a resource, subscribe to signals (`getEntry$`, agent `state$`), dispose/destroy the resource scope, verify signals no longer emit and subscriptions are closed.

**React memory leak tests** — create or add to `src/query-v2/react/__tests__/memory-leaks.react.test.ts` (or similar, following existing React test patterns in `src/query-v2/react/__tests__/`):

- **ML05**: Hook unmount cleans up subscriptions — render a component using `useResourceV2Query`, unmount it, verify that the hook's internal subscriptions are unsubscribed (spy on `.subscribe()` / `.unsubscribe()`).
- **ML06**: Multiple mount/unmount cycles don't accumulate subscriptions — mount, unmount, mount, unmount — verify subscription count returns to zero after final unmount.
- **ML07**: Changing query args on unmount doesn't leave stale subscriptions — change args, immediately unmount, verify cleanup.

For React tests, follow existing test patterns in `src/query-v2/react/__tests__/` (look at how they set up `renderHook`, `SharedOptions`, mock fetchers, etc.). Use `@testing-library/react` and `renderHook` from that library.

After implementation, run:
- `grep -rn "ADR-\|§\|\.thoughts" src/query-v2/` — must return 0 results (or only false positives in test descriptions if any).
- `npm run ts-check` — must pass with 0 errors.
- `npx vitest run src/query-v2/` — all tests pass including new ML01–ML07.

---

## Phase 41: Verify Redraft Round 6 fixes

- **Agent**: `rdpi-tester`
- **Depends on**: Phase 40
- **Retry limit**: 1

### Prompt

Phase 40 addressed two User Feedback items: (1) removing `.thoughts` references from source code, and (2) adding memory leak tests. Verify both:

**Verify Issue 1: No .thoughts references in source code**

1. Run `grep -rn "ADR-" src/query-v2/` — must return 0 matches in non-test code. Test descriptions may mention "ADR" only if they're referencing a concept, not a `.thoughts` path. Ideally 0 matches everywhere.
2. Run `grep -rn "§" src/query-v2/` — must return 0 matches (the section symbol should not appear in source/test files).
3. Run `grep -rn "\.thoughts" src/query-v2/` — must return 0 matches.
4. Spot-check 3–5 files that previously had heavy design-doc comments (likely: `ResourceV2.ts`, `ResourceV2Agent.ts`, `MachineWithData.ts`, `CacheEntry.ts`) to confirm comments are clean.

**Verify Issue 2: Memory leak tests**

5. Run the new memory leak test files:
   - `npx vitest run` on the vanilla memory leak test file — all ML01–ML04 tests pass.
   - `npx vitest run` on the React memory leak test file — all ML05–ML07 tests pass.
6. Verify each test actually asserts cleanup (not just that nothing throws). Read the test files and confirm they check: subscription `.closed` status, spy call counts, no emissions after cleanup, timer clearance.

**Full regression check**

7. Run `npm run check:all` — must pass fully (ts-check + lint + format:check + test).
8. Run `npx vitest run src/query-v2/` — all query-v2 tests pass, no regressions.

Save the report to `04-implement/verification-redraft-6.md`.

---

## Phase 42: Re-review after Redraft Round 6

- **Agent**: `rdpi-implement-reviewer`
- **Depends on**: Phase 40, Phase 41
- **Retry limit**: 2

### Prompt

Re-review the query-v2 implementation after Redraft Round 6.

Read REVIEW.md: `.thoughts/2026-03-23-1400_query-v2-full-implementation/04-implement/REVIEW.md`.
Read the Redraft Round 6 verification report: `04-implement/verification-redraft-6.md`.

Read the modified/created source files — focus on:
- All files under `src/query-v2/` that were modified to remove `.thoughts` references (spot-check at least 5 core files: `ResourceV2.ts`, `ResourceV2Agent.ts`, `MachineWithData.ts`, `CacheEntry.ts`, `Patcher.ts`)
- The new vanilla memory leak test file (ML01–ML04)
- The new React memory leak test file (ML05–ML07)

Verify:
1. **check:all passes** — `npm run check:all` completes with exit code 0.
2. **No .thoughts references** — confirm `grep -rn "ADR-\|§\|\.thoughts" src/query-v2/` returns 0 matches. Source code comments should reference `docs/` documentation or be self-explanatory — not design artifacts.
3. **Memory leak tests exist and are meaningful** — ML01–ML07 tests actually verify cleanup (subscriptions closed, timers cleared, no retained references, React hook unmount cleanup). Tests should not be trivial stubs.
4. **No regressions** — all existing tests still pass, no new TS errors.
5. **Minimal change** — only the two feedback items were addressed, no scope creep.

Update `04-implement/README.md`:
- Set status to `Complete` or `Redraft` depending on findings
- Add Redraft Round 6 section documenting what was changed
- Update phase count

Write the updated REVIEW.md at `04-implement/REVIEW.md` with final review results.
