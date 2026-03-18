---
title: "Phases: 04-implement"
date: 2026-03-18
stage: 04-implement
---

# Phases: 04-implement

## Phase 1: Code — Core Internal Split (Plan Phase 1)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/01-core-split.md
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 1: Core Internal Split for the query-v2 module.

**Read these files first:**
- Plan: `../03-plan/01-core-split.md` — contains all 8 tasks with exact file paths, move targets, and import changes
- Design architecture: `../02-design/01-architecture.md` — §fix-3 module boundary diagram
- Design decisions: `../02-design/04-decisions.md` — ADR-2 (core split)
- Current core barrel: `src/query-v2/core/index.ts` — current exports you must preserve

**What to do:**
Implement all 8 tasks from the plan phase in order (Task 1.1 through 1.8):

1. Create `src/query-v2/core/common/index.ts` barrel file re-exporting CacheEntry, CacheMap, LifecycleHooks
2. Create `src/query-v2/core/resource/index.ts` barrel file re-exporting ResourceV2, ResourceV2Agent
3. Move `CacheEntry.ts`, `CacheMap.ts`, `LifecycleHooks.ts` to `core/common/` and update their relative imports to machines (e.g., `./machines/Machine` → `../machines/Machine`)
4. Move `ResourceV2.ts`, `ResourceV2Agent.ts` to `core/resource/` and update their relative imports (e.g., `./CacheEntry` → `../common/CacheEntry`, `./machines/*` → `../machines/*`)
5. Update `core/index.ts` to re-export from `./common`, `./machines`, `./resource` instead of individual files
6. Update 3 absolute imports outside core: `createApi.ts`, `ReactHooksPlugin.ts`, `Snapshot.ts` — change `@/query-v2/core/ResourceV2` to `@/query-v2/core/resource/ResourceV2`
7. Move co-located test files `CacheEntry.test.ts` and `CacheMap.test.ts` to `core/common/` and update their machine imports
8. Update `core/__tests__/ResourceV2.test.ts`, `ResourceV2Agent.test.ts`, `LifecycleHooks.test.ts` imports to point to new sub-folder paths

**Constraints:**
- Follow existing code patterns precisely (naming, indentation, barrel exports, `@/` alias)
- The `machines/` directory does NOT move — it stays at `core/machines/`
- `core/index.ts` barrel must preserve the exact same public export surface — zero public API change
- Do NOT modify files outside the scope of this phase
- Maintain TypeScript strict mode compatibility
- If `ts-check` fails after implementation: fix within phase scope (max 2 attempts)

---

## Phase 2: Verify — Core Internal Split (Plan Phase 1)

- **Agent**: `rdpi-tester`
- **Output**: `verification-1.md`
- **Depends on**: Phase 1
- **Retry limit**: 1

### Prompt

Phase 1 (Core Internal Split) has been implemented. Verify the changes by running the verification checklist from the plan.

**Read the plan phase for verification criteria:**
- `../03-plan/01-core-split.md` — §Verification section

**Run these checks:**
1. `npm run ts-check` — all import paths must resolve after file moves
2. `npx vitest run src/query-v2/` — full test suite passes, all 8 machine tests unaffected
3. Verify `core/index.ts` barrel resolves: `ResourceV2`, `CacheEntry`, `CacheMap`, `LifecycleHooks`, `ResourceV2Agent` + all machine exports
4. Verify cross-subfolder import works: `ResourceV2` imports `CacheEntry` from `../common/CacheEntry`
5. Verify existing tests pass without assertion changes: ResourceV2.test.ts, ResourceV2Agent.test.ts, CacheEntry.test.ts, CacheMap.test.ts, LifecycleHooks.test.ts
6. Verify `query-v2/index.ts` barrel still exports all core symbols
7. No circular dependencies between `common/` and `resource/`

**Report format:** Pass/fail per check, error details if failed.
**Save to:** `04-implement/verification-1.md`

If tests fail: report the failures to the orchestrator. Do not attempt fixes — that's the coder's job on retry.

---

## Phase 3: Code — Standalone Hooks + React Folder (Plan Phase 2)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/02-standalone-hooks.md
- **Depends on**: Phase 2
- **Retry limit**: 2

### Prompt

You are implementing Plan Phase 2: Standalone Hooks + React Folder for the query-v2 module.

**Read these files first:**
- Plan: `../03-plan/02-standalone-hooks.md` — contains all 7 tasks with exact file paths, signatures, and import lists
- Design architecture: `../02-design/01-architecture.md` — §fix-1-2 module boundary
- Design data flow: `../02-design/02-dataflow.md` — §1-standalone-hook-lifecycle, §2-plugin-hook-lifecycle
- Design model: `../02-design/03-model.md` — §3-standalone-hooks-relationship
- Design decisions: `../02-design/04-decisions.md` — ADR-1 (hooks dual-path)
- Design test cases: `../02-design/06-testcases.md` — §fix-1-2 (T1–T13)
- Current plugin: `src/query-v2/plugins/ReactHooksPlugin.ts` — source for hook extraction

**What to do:**
Implement all 7 tasks from the plan phase in order (Task 2.1 through 2.7):

1. Create `src/query-v2/react/useResourceV2Agent.ts` — standalone hook with `resource` as first param. Extract implementation from `ReactHooksPlugin.ts` (the `useResourceV2Agent` function body and `compareArgs` helper). Signature: `useResourceV2Agent<TArgs, TData, TError>(resource: ResourceV2<TArgs, TData, TError>, args: TArgs | SKIP_TOKEN): IResourceV2AgentState<TArgs, TData, TError>`
2. Create `src/query-v2/react/useResourceV2Ref.ts` — standalone hook with `resource` as first param. Extract from `ReactHooksPlugin.ts` (the `useResourceV2Ref` function body, `createRefHandle`, `createSkippedRef` helpers). Signature: `useResourceV2Ref<TArgs, TData, TError>(resource: ResourceV2<TArgs, TData, TError>, args: TArgs | SKIP_TOKEN): IResourceV2Ref<TArgs, TData, TError>`
3. Create `src/query-v2/react/index.ts` barrel re-exporting both hooks
4. Refactor `ReactHooksPlugin.ts` — remove all hook implementations and helpers, import from `@/query-v2/react/`, delegate: `useResourceV2Agent: (args) => useResourceV2Agent(res, args)`, `useResourceV2Ref: (args) => useResourceV2Ref(res, args)`. Keep: `IReactHooksPluginContributions` interface, plugin class shell, `install` method, declaration merging block
5. Update `src/query-v2/index.ts` — add `export { useResourceV2Agent, useResourceV2Ref } from "./react";`
6. Create standalone hook unit tests at `src/query-v2/react/__tests__/useResourceV2Agent.test.ts` and `useResourceV2Ref.test.ts` covering T1–T7. Use `@testing-library/react` `renderHook` and mock `ResourceV2` with controlled `queryFn`
7. Verify existing plugin/integration tests still pass (`ReactHooksPlugin.test.ts`, `plugin-augmentation.test.ts`). Update imports only if they break due to moved helpers.

**Constraints:**
- Follow existing code patterns precisely (naming, indentation, barrel exports, `@/` alias)
- The `ResourceV2` import path is now `@/query-v2/core/resource/ResourceV2` (updated in Phase 1)
- Both standalone and plugin call paths must produce identical behavior
- Do NOT modify files outside the scope of this phase
- Maintain TypeScript strict mode compatibility
- If `ts-check` fails after implementation: fix within phase scope (max 2 attempts)

---

## Phase 4: Verify — Standalone Hooks (Plan Phase 2)

- **Agent**: `rdpi-tester`
- **Output**: `verification-2.md`
- **Depends on**: Phase 3
- **Retry limit**: 1

### Prompt

Phase 2 (Standalone Hooks + React Folder) has been implemented. Verify the changes.

**Read the plan phase for verification criteria:**
- `../03-plan/02-standalone-hooks.md` — §Verification section

**Run these checks:**
1. `npm run ts-check` — new `react/` module compiles, `ReactHooksPlugin` delegation compiles
2. `npx vitest run src/query-v2/react/` — all new standalone hook tests pass (T1–T7)
3. `npx vitest run src/query-v2/plugins/` — existing plugin tests pass without changes (T10–T11)
4. `npx vitest run src/query-v2/__tests__/integration/plugin-augmentation.test.ts` — plugin augmentation integration passes (T8, T9, T12, T13)
5. Confirm plugin path and standalone path produce identical results: `resource.useResourceV2Agent(args)` delegates to `useResourceV2Agent(resource, args)`
6. `npx vitest run src/query-v2/` — full regression suite green

**Report format:** Pass/fail per check, error details if failed.
**Save to:** `04-implement/verification-2.md`

If tests fail: report the failures to the orchestrator. Do not attempt fixes.

---

## Phase 5: Code — DevTools Isolation + Snapshot Errors (Plan Phases 3A + 3B)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/03a-devtools-isolation.md and ../03-plan/03b-snapshot-errors.md
- **Depends on**: Phase 4
- **Retry limit**: 2

### Prompt

You are implementing two parallelizable plan phases in a single pass:
- Plan Phase 3A: DevTools Agent State Isolation
- Plan Phase 3B: Snapshot Hydration Error Handling

These modify completely disjoint file sets and can safely be implemented together.

**Read these files first:**
- Plan 3A: `../03-plan/03a-devtools-isolation.md` — 2 tasks for devtools isolation
- Plan 3B: `../03-plan/03b-snapshot-errors.md` — 3 tasks for snapshot errors
- Design decisions: `../02-design/04-decisions.md` — ADR-3 (devtools filtering), ADR-4 (snapshot errors)
- Design data flow: `../02-design/02-dataflow.md` — §4-devtools-flow, §3-snapshot-hydration
- Design use cases: `../02-design/05-usecases.md` — UC-4.1–UC-4.6 (snapshot errors)
- Design test cases: `../02-design/06-testcases.md` — §fix-4 (T23–T28), §fix-5 (T29–T38)
- Current agent file: `src/query-v2/core/resource/ResourceV2Agent.ts`
- Current snapshot file: `src/query-v2/snapshot/Snapshot.ts`

**Plan Phase 3A — DevTools Isolation (Tasks 3A.1–3A.2):**

1. In `src/query-v2/core/resource/ResourceV2Agent.ts`, add `{ isDisabled: true }` as second argument to 3 signal constructors:
   - `_tracking$` — `Signal.state<AgentTracking<TData, TError>>({ previous: null, current: null })` → add `{ isDisabled: true }` as options arg
   - `_refreshError$` — `Signal.state<TError | null>(null)` → add `{ isDisabled: true }` as options arg
   - `_state$` — `Signal.compute<IResourceV2AgentState<TArgs, TData, TError>>(...)` → add `{ isDisabled: true }` as options arg
   - Do NOT modify `CacheEntry._signal` — it must continue to push to devtools

2. Verify existing agent tests (`src/query-v2/core/__tests__/ResourceV2Agent.test.ts`) — no modification expected.

**Plan Phase 3B — Snapshot Errors (Tasks 3B.1–3B.3):**

1. In `src/query-v2/snapshot/Snapshot.ts`, modify `hydrateSnapshot` function:
   - Version mismatch: replace `return;` with `throw new Error(\`Snapshot version mismatch: expected \${CURRENT_SNAPSHOT_VERSION}, got \${snapshot.version}. The snapshot format is incompatible with the current version of query-v2.\`);`
   - Key prefix mismatch: replace `return;` with `throw new Error(\`Snapshot keyPrefix mismatch: expected "\${apiKeyPrefix}", got "\${snapshot.keyPrefix}". Ensure the snapshot was created by the same API instance configuration.\`);`
   - Unknown resource key: replace `continue;` with `console.warn(\`[rx-toolkit] hydrateSnapshot: unknown resource key "\${resourceKey}", skipping.\`); continue;`

2. Update `src/query-v2/snapshot/__tests__/Snapshot.test.ts`:
   - S4 (version mismatch): change to `expect(() => hydrateSnapshot(...)).toThrow(/version mismatch/)`
   - S5 (key prefix mismatch): change to `expect(() => hydrateSnapshot(...)).toThrow(/keyPrefix mismatch/)`
   - Add T31: unknown resource key logs console.warn and continues
   - Add T32: partial hydration with unknown + valid keys
   - Add T33 (optional): corrupt machine status throw propagates
   - Verify S1–S3, S6–S8 still pass

3. Update `src/query-v2/__tests__/integration/ssr-hydration.test.ts`:
   - Version mismatch test: change to expect throw
   - Key prefix mismatch test: change to expect throw
   - Verify valid snapshot round-trip still works

**Constraints:**
- Follow existing code patterns precisely
- Error messages must include both expected and actual values for easy diagnosis
- `Machine.fromSnapshot` error behavior is unchanged
- Do NOT modify files outside the scope of these two phases
- Maintain TypeScript strict mode compatibility
- If `ts-check` fails: fix within phase scope (max 2 attempts)

---

## Phase 6: Verify — DevTools Isolation + Snapshot Errors (Plan Phases 3A + 3B)

- **Agent**: `rdpi-tester`
- **Output**: `verification-3-4.md`
- **Depends on**: Phase 5
- **Retry limit**: 1

### Prompt

Plan Phases 3A (DevTools Isolation) and 3B (Snapshot Errors) have been implemented. Verify both sets of changes.

**Read the plan phases for verification criteria:**
- `../03-plan/03a-devtools-isolation.md` — §Verification section
- `../03-plan/03b-snapshot-errors.md` — §Verification section

**Run these checks:**

DevTools Isolation (3A):
1. `npm run ts-check` — `{ isDisabled: true }` is a valid `SignalOptions` field
2. `npx vitest run src/query-v2/core/__tests__/ResourceV2Agent.test.ts` — all existing agent tests pass, `state$` reactivity unaffected (T28)
3. Verify agent signal constructors have `isDisabled: true`: `_tracking$` (T23), `_refreshError$` (T24), `_state$` (T25)
4. Verify `CacheEntry._signal` is unaffected — still has `beforeDevtoolsPush` callback, no `isDisabled` (T26)

Snapshot Errors (3B):
5. `npx vitest run src/query-v2/snapshot/` — S4/S5 expect `toThrow`, new T31/T32 tests pass, S1–S3/S6–S8 unchanged
6. `npx vitest run src/query-v2/__tests__/integration/ssr-hydration.test.ts` — version/prefix mismatch tests expect throws (T37), valid SSR round-trip passes (T38)
7. Verify error messages are descriptive: contain expected value, actual value, and actionable guidance

Full regression:
8. `npx vitest run src/query-v2/` — full regression suite green

**Report format:** Pass/fail per check, error details if failed. Group results by plan phase (3A, 3B).
**Save to:** `04-implement/verification-3-4.md`

If tests fail: report the failures to the orchestrator. Do not attempt fixes.

---

## Phase 7: Code — JSDoc + Documentation (Plan Phases 4A + 4B)

- **Agent**: `rdpi-codder`
- **Output**: Code changes per ../03-plan/04a-jsdoc.md and ../03-plan/04b-documentation.md
- **Depends on**: Phase 6
- **Retry limit**: 2

### Prompt

You are implementing two parallelizable plan phases in a single pass:
- Plan Phase 4A: JSDoc comments on public API
- Plan Phase 4B: Documentation updates

These modify completely disjoint file sets (source code JSDoc vs. markdown docs) and can safely be implemented together.

**Read these files first:**
- Plan 4A: `../03-plan/04a-jsdoc.md` — 7 tasks for JSDoc
- Plan 4B: `../03-plan/04b-documentation.md` — 2 tasks for documentation
- Design decisions: `../02-design/04-decisions.md` — ADR-5 (JSDoc scope)
- Design use cases: `../02-design/05-usecases.md` — UC-5.2–UC-5.4 (JSDoc examples), UC-6.1–UC-6.2 (doc content)
- Design docs spec: `../02-design/07-docs.md` — exact doc update targets
- Current docs: `docs/query-v2/ssr.md`, `docs/query-v2/api-reference.md`

**Plan Phase 4A — JSDoc (Tasks 4A.1–4A.7):**

1. `src/query-v2/api/createApi.ts` — JSDoc on `createApi` function: description, `@param options`, `@returns`, `@see`
2. `src/query-v2/core/resource/ResourceV2.ts` — Class-level JSDoc + JSDoc on `createAgent()`, `query()`, `query$()`, `entry()`, `resetCache()`. Do NOT modify existing JSDoc on other methods.
3. `src/query-v2/core/resource/ResourceV2Agent.ts` — Class-level JSDoc + `state$`, `start()` JSDoc. Add inline comments on each `{ isDisabled: true }` explaining agent signals are excluded from devtools intentionally.
4. `src/query-v2/core/common/CacheEntry.ts` — Class-level JSDoc + `machine$()`, `peek()`, `set()`, `complete()`. Inline comment on `beforeDevtoolsPush` explaining the intentional type mismatch.
5. `src/query-v2/plugins/ReactHooksPlugin.ts` — Class-level JSDoc mentioning standalone alternative. Inline comment on declaration merging block.
6. `src/query-v2/react/useResourceV2Agent.ts` and `useResourceV2Ref.ts` — Function-level JSDoc with `@param`, `@returns`, `@see`
7. `src/query-v2/snapshot/Snapshot.ts` — Inline comments at version mismatch throw, keyPrefix mismatch throw, and console.warn for unknown resource

**Plan Phase 4B — Documentation (Tasks 4B.1–4B.2):**

1. `docs/query-v2/ssr.md` — Two additions:
   - Fix #7: Append 3–5 bullet points to "Ограничения" section about optimistic update snapshot behavior (patched data vs originalData, patches excluded, hydration implications, recommendation to commit/abort before getSnapshot)
   - Fix #5: Add 3–4 bullet points about hydration error behavior (throws on version/prefix mismatch, console.warn on unknown resource, try/catch advice for rolling deployments)

2. `docs/query-v2/api-reference.md` — In the "ReactHooksPlugin" section, add ~5 lines noting standalone imports from `@fozy-labs/rx-toolkit/query-v2/react` without requiring the plugin, with import path and one-line usage example.

**Constraints:**
- JSDoc uses correct `@param`, `@returns`, `@see` syntax
- No JSDoc added to machine classes (`MachineIdle`, `MachinePending`, etc.) or private helpers
- Documentation is proportional: ~20 lines total across 2 doc files, no new files, no demo changes
- Follow existing doc style and language (Russian section headers in ssr.md)
- If `ts-check` fails: fix within phase scope (max 2 attempts)

---

## Phase 8: Verify — JSDoc + Documentation (Plan Phases 4A + 4B)

- **Agent**: `rdpi-tester`
- **Output**: `verification-5-6.md`
- **Depends on**: Phase 7
- **Retry limit**: 1

### Prompt

Plan Phases 4A (JSDoc) and 4B (Documentation) have been implemented. Verify the changes.

**Read the plan phases for verification criteria:**
- `../03-plan/04a-jsdoc.md` — §Verification section
- `../03-plan/04b-documentation.md` — §Verification section

**Run these checks:**

JSDoc (4A):
1. `npm run ts-check` — JSDoc does not affect compilation
2. Verify JSDoc is present on: `createApi`, `ResourceV2` class + 5 methods, `ResourceV2Agent` class + 2 members, `CacheEntry` class + 4 methods, `ReactHooksPlugin` class, both standalone hooks
3. Verify inline comments are present at: `CacheEntry.beforeDevtoolsPush`, 3 `ResourceV2Agent` signal constructors, `hydrateSnapshot` error branches, `ReactHooksPlugin` declaration merging
4. Verify NO JSDoc was added to machine classes (`MachineIdle`, `MachinePending`, `MachineError`, `MachineRefreshing`, `MachineSuccess`, `MachineWithData`, `Machine`)

Documentation (4B):
5. Verify `docs/query-v2/ssr.md` contains optimistic update snapshot behavior in "Ограничения" section
6. Verify `docs/query-v2/ssr.md` contains hydration error behavior documentation
7. Verify `docs/query-v2/api-reference.md` mentions standalone hook imports
8. Verify no new documentation files were created
9. Verify documentation additions are proportional (~20 lines across 2 files)

**Report format:** Pass/fail per check, error details if failed. Group results by plan phase (4A, 4B).
**Save to:** `04-implement/verification-5-6.md`

If issues found: report to the orchestrator.

---

## Phase 9: Implementation Review

- **Agent**: `rdpi-implement-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8
- **Retry limit**: 2

### Prompt

All implementation phases are complete. Review the entire implementation and produce the final implementation record.

**Read these files:**
- Task: `../TASK.md`
- Research summary: `../01-research/README.md`
- Design summary: `../02-design/README.md`
- All plan phases:
  - `../03-plan/01-core-split.md`
  - `../03-plan/02-standalone-hooks.md`
  - `../03-plan/03a-devtools-isolation.md`
  - `../03-plan/03b-snapshot-errors.md`
  - `../03-plan/04a-jsdoc.md`
  - `../03-plan/04b-documentation.md`
- All verification reports:
  - `04-implement/verification-1.md`
  - `04-implement/verification-2.md`
  - `04-implement/verification-3-4.md`
  - `04-implement/verification-5-6.md`

**Write `04-implement/README.md`** (replace the existing placeholder) with:

1. **Frontmatter**: title, date, status (Approved if all checks pass, else Failed), feature, plan link
2. **Implementation record**: date, status, plan link
3. **Phase completion status**: N/6 plan phases implemented (Phase 1: Core Split, Phase 2: Standalone Hooks, Phase 3A: DevTools, Phase 3B: Snapshot, Phase 4A: JSDoc, Phase 4B: Docs)
4. **Verification results summary**: aggregate pass/fail from all 4 verification reports
5. **Quality review checklist**:
   - All plan phases implemented
   - All verification checks passed
   - No out-of-scope files modified
   - Code follows project patterns (`@/` aliases, barrel exports, naming conventions)
   - TypeScript strict mode passes
   - Documentation proportional (~20 lines across 2 doc files, no new files)
   - No security vulnerabilities introduced
6. **List of all changed files** (new files, modified files, moved files)
7. **Post-implementation recommendations**: build validation, manual testing areas (React hook rendering, SSR hydration error handling, devtools inspection)
8. **Recommended commit message** in conventional commits format covering all 7 fixes

---
