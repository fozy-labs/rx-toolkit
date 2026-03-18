---
title: "Test Strategy — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
---

# Test Strategy

## Approach

**Testing pyramid:**

- **Unit**: Per-function/class behavior — standalone hooks, snapshot error logic, signal `isDisabled` flag. These are the primary layer for fixes #1/#2, #4, #5.
- **Integration**: Cross-module interaction — plugin delegation to standalone hooks, `createApi` + `hydrateSnapshot` throw propagation, core barrel re-exports after split. Cover fixes #1/#2 + #3 + #5.
- **Regression**: Existing tests must pass unchanged (or with minimal assertion updates where behavior intentionally changed). Cover all fix areas — especially #3 (import paths) and #5 (snapshot tests S4/S5 now expect throws instead of silent skips).

Fix #6 (JSDoc) and Fix #7 (docs) have **no test cases** — documentation-only changes.

---

## Test Cases

### Fix #1 + #2: Standalone React Hooks

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T1 | Unit | `useResourceV2Agent` renders with resource + args, returns reactive state | `useResourceV2Agent(resource, { id: "1" })` → resolve queryFn | `state.status === "success"`, `state.data === resolvedData` | P0 |
| T2 | Unit | `useResourceV2Agent` with `SKIP` — agent created but not started | `useResourceV2Agent(resource, SKIP)` | `state.status === "idle"`, `state.data === null`, queryFn not called | P0 |
| T3 | Unit | `useResourceV2Agent` — args change triggers re-query | Render with `args₁`, then re-render with `args₂` | `agent.start(args₂)` called, state updates to new data | P1 |
| T4 | Unit | `useResourceV2Agent` — SKIP → real args triggers start | Render with `SKIP`, then re-render with `{ id: "1" }` | Agent starts, state transitions idle → pending → success | P1 |
| T5 | Unit | `useResourceV2Agent` — same args on re-render is no-op | Render with `{ id: "1" }` twice (shallow-equal args) | `queryFn` called once, no re-query | P1 |
| T6 | Unit | `useResourceV2Ref` returns imperative ref with correct shape | `useResourceV2Ref(resource, { id: "1" })` | `ref.has`, `ref.lock`, `ref.invalidate`, `ref.createPatch`, `ref.create` exist | P0 |
| T7 | Unit | `useResourceV2Ref` with `SKIP` returns skipped ref | `useResourceV2Ref(resource, SKIP)` | `ref.has === false`, `ref.createPatch` returns `null` | P1 |
| T8 | Integration | Plugin `resource.useResourceV2Agent(args)` delegates to standalone and produces identical result | Plugin path: `resource.useResourceV2Agent({ id: "1" })` | Same `IResourceV2AgentState` as standalone path T1 | P0 |
| T9 | Integration | Plugin `resource.useResourceV2Ref(args)` delegates to standalone | Plugin path: `resource.useResourceV2Ref({ id: "1" })` | Same `IResourceV2Ref` shape as standalone path T6 | P1 |
| T10 | Regression | `ReactHooksPlugin` adds hook methods to resource (PL1) | `createApi({ plugins: [new ReactHooksPlugin()] })` → `resource.useResourceV2Agent` | `typeof resource.useResourceV2Agent === "function"` | P0 |
| T11 | Regression | Without `ReactHooksPlugin`, resource has no hook methods (PL2) | `createApi()` → `resource` | `resource.useResourceV2Agent === undefined` | P0 |
| T12 | Regression | `plugin-augmentation.test.ts` — all existing tests pass | Run existing test suite | All pass (imports updated if needed) | P0 |
| T13 | Regression | Multi-plugin composition — ReactHooksPlugin + custom plugin both contribute methods | `createApi({ plugins: [ReactHooksPlugin, CustomPlugin] })` | Both `useResourceV2Agent` and `customMethod` exist on resource | P1 |

### Fix #3: Core Internal Split

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T14 | Integration | All exports from `core/index.ts` barrel still resolve after split | `import { ResourceV2, CacheEntry, CacheMap, LifecycleHooks, ResourceV2Agent } from "@/query-v2/core"` | All symbols defined, no import errors | P0 |
| T15 | Integration | `ResourceV2` can import `CacheEntry` from `../common/CacheEntry` (cross-subfolder) | `ResourceV2.query()` triggers `CacheEntry` creation | Cache entry created and returned | P0 |
| T16 | Regression | All existing `core/__tests__/ResourceV2.test.ts` tests pass | Run test suite | All pass without modification | P0 |
| T17 | Regression | All existing `core/__tests__/ResourceV2Agent.test.ts` tests pass | Run test suite | All pass without modification | P0 |
| T18 | Regression | All existing `core/CacheEntry.test.ts` tests pass | Run test suite | All pass without modification | P0 |
| T19 | Regression | All existing `core/CacheMap.test.ts` tests pass | Run test suite | All pass without modification | P0 |
| T20 | Regression | All existing `core/__tests__/LifecycleHooks.test.ts` tests pass | Run test suite | All pass without modification | P0 |
| T21 | Regression | All machine tests pass (`Machine.test.ts`, `MachineIdle.test.ts`, etc.) | Run test suite | All pass — machines/ is not moved | P0 |
| T22 | Regression | `query-v2/index.ts` barrel re-exports core symbols | `import { ResourceV2, CacheEntry } from "@/query-v2"` | Symbols resolve | P1 |

### Fix #4: DevTools Agent State Isolation

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T23 | Unit | `ResourceV2Agent._tracking$` created with `isDisabled: true` | Instantiate `ResourceV2Agent` | `_tracking$` signal does NOT register with devtools | P0 |
| T24 | Unit | `ResourceV2Agent._refreshError$` created with `isDisabled: true` | Instantiate `ResourceV2Agent` | `_refreshError$` signal does NOT register with devtools | P0 |
| T25 | Unit | `ResourceV2Agent._state$` created with `isDisabled: true` | Instantiate `ResourceV2Agent` | `_state$` computed signal does NOT register with devtools | P0 |
| T26 | Regression | `CacheEntry._signal` still pushes to devtools | Create `CacheEntry`, trigger state change | `beforeDevtoolsPush` callback invoked, devtools receives machine state | P0 |
| T27 | Regression | Custom `beforeDevtoolsPush` on resource config still works | `createResource({ beforeDevtoolsPush: customFn })` → query → success | `customFn` called with machine state | P1 |
| T28 | Regression | All existing `ResourceV2Agent.test.ts` tests pass (state$ reactivity unaffected) | Run test suite | All pass — `isDisabled` does not affect signal reactivity | P0 |

### Fix #5: Snapshot Hydration Error Handling

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|
| T29 | Unit | Version mismatch throws descriptive error | `hydrateSnapshot({ version: 0, ... }, ...)` | `throw Error` containing "version mismatch", expected version, got version | P0 |
| T30 | Unit | Key prefix mismatch throws descriptive error | `hydrateSnapshot({ keyPrefix: "other", ... }, ..., "main", ...)` | `throw Error` containing "keyPrefix mismatch", expected prefix, got prefix | P0 |
| T31 | Unit | Unknown resource key logs warning and continues | `hydrateSnapshot({ resources: { unknown: {...}, known: {...} } })` with only "known" in registry | `console.warn` with "unknown resource key", known entries hydrated | P0 |
| T32 | Unit | Multiple entries: one valid + one unknown resource | Snapshot with `users` (registered) + `posts` (not registered) | `users` hydrated, `posts` warned, no throw | P1 |
| T33 | Unit | Corrupt machine status throws from `Machine.fromSnapshot` | Snapshot entry with `status: "invalid"` | `throw Error("Unknown machine status")` — unchanged behavior | P1 |
| T34 | Regression | Valid snapshot hydrates successfully | Snapshot with matching version, prefix, known resources | Entries hydrated to `MachineSuccess` | P0 |
| T35 | Regression | `maxSnapshotDataAge` triggers invalidation for stale entries | Stale `updatedAt` + `maxSnapshotDataAge` < age | Entry hydrated as `MachineRefreshing` | P0 |
| T36 | Regression | Snapshot round-trip works (S7) | `getSnapshot` → JSON → `hydrateSnapshot` | Identical data in target resource | P0 |
| T37 | Integration | `createApi` with `initialSnapshot` version mismatch — error propagates | `createApi({ initialSnapshot: { version: 0 } })` → `createResource(...)` | `createResource` throws (or `createApi` throws, depending on call site) | P0 |
| T38 | Integration | `createApi` with valid `initialSnapshot` — SSR round-trip | Server `getSnapshot` → client `createApi({ initialSnapshot })` → `createResource` | Data available immediately, `queryFn` not called | P1 |

---

## Edge Cases

### Hooks (Fix #1 + #2)

| Edge Case | Test Strategy |
|-----------|---------------|
| Standalone hook called outside React render cycle | Should throw React hooks invariant error — rely on React's own validation, no custom guard needed |
| Two components using standalone + plugin paths for same resource/args | Both share `CacheEntry` via `CacheMap`. Unit test: two `createAgent()` calls on same resource/args produce agents that read same cache entry |
| Unmount during pending query | Agent cleanup should abort signal. Covered by existing agent lifecycle tests in `ResourceV2Agent.test.ts` |
| `resource` parameter is `null`/`undefined` | TypeScript types prevent this. No runtime guard needed — trust the type system at internal boundaries |

### Core Split (Fix #3)

| Edge Case | Test Strategy |
|-----------|---------------|
| Circular dependency between `common/` and `resource/` | Cannot happen — `resource/` imports from `common/`, not vice versa. Verified via architecture dependency graph. Compiler will catch if introduced. |
| Test files import directly from `core/CacheEntry` (old path) | Test imports use relative paths (`../CacheEntry`). After file moves to `common/CacheEntry`, these tests co-located in `core/__tests__/` need path updates. Compiler catches. |

### DevTools (Fix #4)

| Edge Case | Test Strategy |
|-----------|---------------|
| Future agent signal added without `isDisabled` | Not testable now — inline comment on `ResourceV2Agent` class serves as reminder. Code review responsibility. |
| `Signal.compute` with `isDisabled` still propagates reactivity | Covered by T28 — existing agent tests verify `state$` reactivity after adding `isDisabled` |

### Snapshot Errors (Fix #5)

| Edge Case | Test Strategy |
|-----------|---------------|
| SSR rolling deployment: server v1 snapshot + client v2 code | T37 covers this — version mismatch throws. Consumer must wrap in try/catch or ensure version parity. |
| Snapshot with `null` keyPrefix + API with `null` keyPrefix | Should succeed (both null, `null === null` is true). Covered by existing S2/S7 tests where keyPrefix is null. |
| Snapshot with empty `resources: {}` — no entries to hydrate | Should succeed silently — loop body never executes. Add as minor P2 test. |
| `console.warn` spy verification for unknown resource | T31 must spy on `console.warn` and verify message format |

---

## Performance Criteria

No performance thresholds apply to these fixes. All changes are:
- Structural (file moves, import changes)
- Configuration (`isDisabled: true` flag — zero runtime cost)
- Error handling (throw/warn on mismatch — cold path only)
- Documentation (no runtime impact)

---

## Correctness Verification

End-to-end validation approach for each fix area:

1. **Hooks (Fix #1+#2)**: Render a component using standalone `useResourceV2Agent`, verify it receives data from `queryFn`. Render same component via plugin path, verify identical behavior. This is T1 + T8.

2. **Core split (Fix #3)**: Run the full existing test suite (`vitest run src/query-v2/`). Zero test modifications expected for machine/cache tests. Only import path updates in files that deep-import moved files.

3. **DevTools (Fix #4)**: Verify agent signals don't register with devtools mock (T23-T25). Verify `CacheEntry` still does (T26). Run existing agent tests to confirm no reactivity regression (T28).

4. **Snapshot errors (Fix #5)**: Run modified snapshot tests (S4 → expects `throw` instead of silent skip; S5 → expects `throw`). Run SSR hydration integration tests (version/prefix mismatch tests → expect `throw`). Run S7 round-trip → no change.

5. **Full regression**: Run `vitest run` on entire `src/query-v2/` tree. All tests green.

---

## Existing Test Files: Update vs. Create

### Files to UPDATE (existing)

| File | Reason | Fix # |
|------|--------|-------|
| `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` | `ReactHooksPlugin.augmentResource` now delegates — verify delegation behavior. Existing PL1-PL4 tests should pass as-is if plugin API is unchanged. | #1/#2 |
| `src/query-v2/__tests__/integration/plugin-augmentation.test.ts` | May need import path updates if `ReactHooksPlugin` internal imports change. Test behavior unchanged. | #1/#2 |
| `src/query-v2/snapshot/__tests__/Snapshot.test.ts` | **S4**: Change from "snapshot ignored" to `expect(() => ...).toThrow(/version mismatch/)`. **S5**: Change from "silently skipped" to `expect(() => ...).toThrow(/keyPrefix mismatch/)`. Add new tests for `console.warn` on unknown resource. | #5 |
| `src/query-v2/__tests__/integration/ssr-hydration.test.ts` | Two tests change: "version mismatch → snapshot ignored" and "keyPrefix mismatch → snapshot ignored" now expect throws instead of silent no-hydration. | #5 |
| `src/query-v2/core/__tests__/ResourceV2.test.ts` | Import path update only if test uses deep imports from `core/` root (e.g., `../ResourceV2` → `../resource/ResourceV2`). | #3 |
| `src/query-v2/core/__tests__/ResourceV2Agent.test.ts` | Same — import path update if deep imports change after file move to `resource/`. | #3 |
| `src/query-v2/core/__tests__/LifecycleHooks.test.ts` | Import path update: `../LifecycleHooks` → `../common/LifecycleHooks`. | #3 |
| `src/query-v2/core/CacheEntry.test.ts` | File may need to move to `core/common/CacheEntry.test.ts` or update import from `./CacheEntry` to `./common/CacheEntry`. | #3 |
| `src/query-v2/core/CacheMap.test.ts` | Same as CacheEntry — file co-located, may move or update imports. | #3 |

### Files to CREATE (new)

| File | Purpose | Fix # |
|------|---------|-------|
| `src/query-v2/react/__tests__/useResourceV2Agent.test.ts` | Unit tests for standalone `useResourceV2Agent` (T1-T5) | #1/#2 |
| `src/query-v2/react/__tests__/useResourceV2Ref.test.ts` | Unit tests for standalone `useResourceV2Ref` (T6-T7) | #1/#2 |
| `src/query-v2/core/common/index.ts` | Barrel file (not a test — but triggers T14) | #3 |
| `src/query-v2/core/resource/index.ts` | Barrel file (not a test — but triggers T14) | #3 |

### Files UNCHANGED (regression only — run as-is)

| File | Note |
|------|------|
| `src/query-v2/core/machines/Machine.test.ts` | `machines/` not moved |
| `src/query-v2/core/machines/MachineIdle.test.ts` | Unchanged |
| `src/query-v2/core/machines/MachinePending.test.ts` | Unchanged |
| `src/query-v2/core/machines/MachineSuccess.test.ts` | Unchanged |
| `src/query-v2/core/machines/MachineError.test.ts` | Unchanged |
| `src/query-v2/core/machines/MachineRefreshing.test.ts` | Unchanged |
| `src/query-v2/core/machines/MachineWithData.test.ts` | Unchanged |
| `src/query-v2/core/machines/Patcher.test.ts` | Unchanged |
| `src/query-v2/__tests__/integration/query-flow.test.ts` | May need import path updates for machines deep imports after #3, but behavior unchanged |
| `src/query-v2/api/__tests__/createApi.test.ts` | Unchanged unless snapshot error tests overlap |
