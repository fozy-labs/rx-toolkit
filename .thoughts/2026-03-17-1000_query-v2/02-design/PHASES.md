---
title: "Phases: 02-design"
date: 2026-03-18
stage: 02-design
---

# Phases: 02-design

## Phase 1: Core Architecture

- **Agent**: `rdpi-architect`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are designing the architecture for a new `query-v2` module in the rx-toolkit library. This is a ground-up redesign replacing boolean-flag state management with class-based state machines, a dual-strategy cache, a plugin system, and SSR snapshot support.

**Read these files first:**
- Task description: `../../TASK.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`
- Research — Query v1 codebase analysis: `../01-research/01-codebase-query-v1.md`
- Research — Signals & common infrastructure: `../01-research/02-codebase-signals-common.md`
- Research — External research: `../01-research/03-external-research.md`
- Research — Open questions: `../01-research/04-open-questions.md`
- Research README (summary + key findings): `../01-research/README.md`

**Key decisions already made by the user (override any research recommendations that conflict):**
- **Plugin type system** (Q1): Deferred to this design stage — you must choose and justify one of the three approaches (declaration merging, generic accumulation, plugin interface with augment). Prototype mentally against TS2589 risk with ReactHooksPlugin.
- **Machine serialization** (Q2): Decided — machines expose a `.state` property (plain object) and provide `Machine.fromSnapshot(state)` static factory for rehydration.
- **Patcher** (Q3): Decided — implement as a utility class + `MachineWithData` shared base class for patch-capable machines (MachineSuccess, MachineRefreshing).
- **Isolation** (Q4): Decided — full isolation in `src/query-v2/`, no imports from `src/query/`. May reuse `src/common/` and `src/signals/`.
- **MachineRefreshing transitions** (Q5): Deferred to this design stage — you must define all MachineRefreshing transitions, error handling semantics (return to stale data vs. MachineError), and patch interaction during refresh.
- **NO_VALUE** (Q6): Decided — use a Symbol sentinel (`Symbol('NO_VALUE')`).
- **Scope** (Q13): Decided — only resources + createApi. No operations/commands in v2 MVP. Design `createApi` to accommodate future `createCommand` without breaking changes.
- **entry(args)** (Q14): Decided — returns `ICacheEntry` (the raw cache entry holding a Machine, not reactive).
- **ResourceDuplicator and select** (Q9, Q15): Out of scope for v2.

**Produce these output files:**

**`01-architecture.md`** — System architecture document:
- C4 Level 2 container diagram showing query-v2 within rx-toolkit (its relationship to signals, common, and the consuming application)
- C4 Level 3 component diagram showing internal query-v2 components: createApi, ResourceV2, CacheMap, Machine hierarchy, Patcher, Plugin system, Agent/Observer, SSR snapshot layer
- Module dependency diagram showing `src/query-v2/` internal folder structure and import relationships
- Class/interface hierarchy diagram for the Machine state classes (MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing) with transitions
- Component responsibility descriptions: what each module owns, what it delegates
- Public API surface: exports from `src/query-v2/index.ts`

**`02-dataflow.md`** — Data flow document:
- Sequence diagram: `resource.query(args)` — from user call through agent, cache lookup, fetch execution, machine transitions, signal updates, to React re-render
- Sequence diagram: `resource.query(args)` with cache hit (stale-while-revalidate)
- Sequence diagram: `resource.invalidate()` → MachineRefreshing flow (define error semantics here)
- Sequence diagram: Optimistic update via Patcher — `onQueryStarted` → `patcher.createPatch()` → apply → commit/rollback
- Sequence diagram: SSR — `api.getSnapshot()` on server, `createApi({ initialSnapshot })` on client, rehydration via `Machine.fromSnapshot()`
- Sequence diagram: Plugin initialization — how plugins hook into createApi/createResource lifecycle
- Data flow for `onCacheEntryAdded` lifecycle hook: when it fires, what it receives, cleanup semantics
- Data flow for `SKIP_TOKEN`: how it prevents query execution while maintaining type safety

**`03-model.md`** — Domain model document:
- Full TypeScript interface/type definitions (design-level, not implementation) for:
  - `ICreateApiOptions<Plugins>`, `IApi<Plugins>` — createApi input/output
  - `IResourceV2Options<Args, Data, Error, KeyStrategy>`, `IResourceV2<Args, Data, Error>` — resource definition/instance
  - Machine classes: `MachineIdle`, `MachinePending`, `MachineSuccess<Data>`, `MachineError<Error>`, `MachineRefreshing<Data>` with all transitions typed
  - `MachineWithData<Data>` base class for patch-capable machines
  - `ICacheEntry<Data, Error>` — the cache unit
  - `CacheMap<Args, Data, Error>` — dual-strategy cache with serialize/compare modes
  - `IResourceV2Agent<Data, Error>` — the observer/agent that manages a single subscription
  - `Patcher` utility class API
  - `IPlugin`, `IPluginContext` — plugin system interfaces
  - `ReactHooksPlugin` — plugin providing `useResourceV2Agent`, `useResourceV2Ref`
  - `TApiSnapshot`, `TResourceSnapshot` — SSR snapshot types
  - `SKIP_TOKEN` type and value
  - `NO_VALUE` symbol type
  - Lifecycle hook types: `onCacheEntryAdded`, `onQueryStarted`
  - `beforeDevtoolsPush` callback type
- Entity relationship diagram showing how these types connect
- Generic type parameter flow: how `Args`, `Data`, `Error` propagate through createApi → createResource → CacheMap → Machine → Agent

**`04-decisions.md`** — Architecture Decision Records:
- **ADR-1: Plugin type system approach** — evaluate declaration merging vs. generic accumulation vs. plugin interface with augment. Consider TS2589 risk, developer ergonomics, and the ReactHooksPlugin use case. Choose one.
- **ADR-2: MachineRefreshing error handling** — on fetch error during refresh: (a) transition to MachineError losing stale data, (b) transition to MachineSuccess with stale data + error flag, (c) new MachineStaleError state. Choose one.
- **ADR-3: Cache key strategy implementation** — how CacheMap implements `serialize` (string keys, Map/object) vs. `compare` (reference keys, linear scan with shallowEqual). Performance thresholds and when to recommend each.
- **ADR-4: Patch lifecycle binding** — how Patcher ties patch commit/rollback to machine transitions and abort signals, fixing the v1 "hanging patch" bug.
- **ADR-5: Agent subscription model** — how IResourceV2Agent subscribes to cache entry changes, manages stale-while-revalidate, and handles concurrent queries (latest-wins vs. queue).
- **ADR-6: createApi extensibility for future commands** — how the createApi interface accommodates future `createCommand`/`createOperation` without breaking changes, given current resources-only scope.
- Additional ADRs as needed for non-obvious decisions.

Each ADR must follow the format: Status, Context (cite research), Options (with pros/cons), Decision, Consequences.

All Mermaid diagrams must be titled, max 15–20 elements per diagram (split if larger). All design choices must reference research documents via relative links (e.g., `[01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)`).

---

## Phase 2: Use Cases & Documentation Impact

- **Agent**: `rdpi-architect`
- **Output**: `05-usecases.md`, `07-docs.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

You are continuing the design of the query-v2 module. Phase 1 produced the core architecture. Now you design use cases with concrete TypeScript examples and assess documentation impact.

**Read these files first:**
- Task description: `../../TASK.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`
- Research README: `../01-research/README.md`
- Phase 1 outputs (read all):
  - `01-architecture.md`
  - `02-dataflow.md`
  - `03-model.md`
  - `04-decisions.md`

**Key scope decisions:**
- Only resources + createApi (no operations/commands)
- No ResourceDuplicator, no select transform
- entry(args) returns ICacheEntry (not reactive)
- Full isolation in `src/query-v2/`

**Produce these output files:**

**`05-usecases.md`** — Use cases with TypeScript code examples:

For each use case, provide a complete TypeScript code example showing the public API in action. Include type annotations to demonstrate inference.

Use cases to cover:
1. **Basic resource definition and querying** — `createApi` → `api.createResource` → `resource.query(args)` → reading data in a component via React hooks plugin
2. **Cache hit and stale-while-revalidate** — showing how a second `.query()` call hits cache, agent returns stale data immediately and refetches
3. **Optimistic update with Patcher** — `onQueryStarted` handler creating a patch, applying it, and committing on success / rolling back on error
4. **SSR hydration/dehydration** — server: `api.getSnapshot()`, client: `createApi({ initialSnapshot })`, showing machine rehydration
5. **Plugin usage** — defining a custom plugin, using ReactHooksPlugin, showing type augmentation in action
6. **Lifecycle hooks** — `onCacheEntryAdded` with cleanup, `onQueryStarted` with `patcher`
7. **SKIP_TOKEN** — conditional querying pattern (e.g., skip when args are undefined)
8. **Cache invalidation** — `resource.invalidate(args)` triggering MachineRefreshing, `resource.resetCache()`
9. **Dual key strategies** — showing `serialize` vs. `compare` configuration and when to use each
10. **Devtools integration** — `beforeDevtoolsPush` configuration, what appears in Redux DevTools
11. **Error handling patterns** — MachineError states, retry patterns, error recovery

For each use case also note:
- Edge cases and gotchas
- What happens under concurrent access
- Type inference expectations (what the user should NOT need to annotate)

**`07-docs.md`** — Documentation impact assessment:

**Keep this document SHORT and focused.** Only describe high-impact documentation changes. Large docs.md is an anti-pattern.

For each item, describe WHAT needs documentation, not HOW to write it. Do not write JSDoc. Match the existing rx-toolkit documentation style (see `docs/` folder structure).

Cover:
- New documentation pages needed for query-v2 (concepts, API reference, migration from v1)
- Existing documentation pages that need updates (if any)
- Example app updates needed in `apps/demos/`
- README.md updates needed

---

## Phase 3: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Output**: `06-testcases.md`, `08-risks.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are designing the QA strategy and risk analysis for the query-v2 module — a complex, ground-up redesign of the data-fetching layer in rx-toolkit.

**Read these files first:**
- Task description: `../../TASK.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`
- Research README: `../01-research/README.md`
- Research — Open questions (for risk context): `../01-research/04-open-questions.md`
- All Phase 1 and Phase 2 outputs:
  - `01-architecture.md`
  - `02-dataflow.md`
  - `03-model.md`
  - `04-decisions.md`
  - `05-usecases.md`
  - `07-docs.md`
- Existing test setup: `../../../../src/__tests__/setup.ts`
- Existing test helpers: list `../../../../src/__tests__/helpers/` directory for available test utilities
- Vitest config: `../../../../vitest.config.ts`

**Key context:**
- The project uses Vitest for testing (see vitest.config.ts)
- The module is fully isolated in `src/query-v2/` — tests go in `src/query-v2/__tests__/` or colocated
- The module depends on `src/signals/` (State, Computed, Effect) and `src/common/` (shallowEqual, deepEqual, PromiseResolver, SharedOptions)
- React hooks testing will need `@testing-library/react` patterns (check existing react test patterns in `src/query/react/` or `src/signals/react/`)

**Produce these output files:**

**`06-testcases.md`** — Test strategy and test case tables:

Test strategy section:
- Unit test approach: what to test in isolation (machines, CacheMap, Patcher, individual functions)
- Integration test approach: what to test as connected systems (createApi → createResource → query → cache → machine transitions)
- React hooks test approach: how to test useResourceV2Agent, useResourceV2Ref
- Mock strategy: what to mock (fetch functions, timers for staleTime/gcTime), what to test with real implementations
- Coverage targets and priorities

Test case tables — use this format for each component area:

| ID | Category | Description | Input | Expected Output | Priority |
|----|----------|-------------|-------|-----------------|----------|

Cover these areas with test cases:
1. Machine transitions (all valid transitions, invalid transition rejection, MachineRefreshing error paths)
2. CacheMap (serialize strategy, compare strategy, entry creation, lookup, eviction/GC)
3. Patcher (createPatch, apply, commit, rollback, hanging patch prevention)
4. ResourceV2 (query, invalidate, resetCache, entry, SKIP_TOKEN handling)
5. Agent (subscription, stale-while-revalidate, concurrent query handling)
6. createApi (resource registration, plugin initialization, snapshot get/restore)
7. SSR (getSnapshot, initialSnapshot rehydration, maxSnapshotDataAge, stale snapshot handling)
8. Plugin system (plugin initialization, ReactHooksPlugin hooks, type augmentation verification)
9. Lifecycle hooks (onCacheEntryAdded with cleanup, onQueryStarted with patcher)
10. Devtools (beforeDevtoolsPush, machine state serialization)
11. Edge cases (NO_VALUE sentinel, empty cache, concurrent invalidations, rapid re-queries)

**`08-risks.md`** — Risk analysis:

Risk table format:

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|

Probability and Impact: H (High), M (Medium), L (Low).
Strategy: Accept, Mitigate, Avoid.

Cover at minimum:
1. TS2589 recursion limit from plugin type system (from research Q1)
2. Machine class `instanceof` breakage after SSR deserialization (from research finding #6)
3. Hanging patch regression (from research finding #7 — v1 bug that v2 must fix)
4. Performance degradation with `compare` key strategy at scale (from research finding #4)
5. Signals integration complexity (Effect cleanup, Batcher interaction with machine transitions)
6. Scope creep from deferred commands/operations adding unexpected coupling
7. Test complexity / coverage gaps in async + reactive + state machine intersection
8. Breaking changes if plugin type system needs revision post-release

For each High-impact risk, provide a detailed mitigation plan (2–4 sentences, concrete steps).

---

## Phase 4: Design Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing the complete design for the query-v2 module. All design documents have been produced. Your job is to verify consistency, completeness, research traceability, and feasibility.

**Read ALL of these files:**
- Task description: `../../TASK.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`
- Research documents:
  - `../01-research/README.md`
  - `../01-research/01-codebase-query-v1.md`
  - `../01-research/02-codebase-signals-common.md`
  - `../01-research/03-external-research.md`
  - `../01-research/04-open-questions.md`
- Design documents (all outputs from phases 1–3):
  - `01-architecture.md`
  - `02-dataflow.md`
  - `03-model.md`
  - `04-decisions.md`
  - `05-usecases.md`
  - `06-testcases.md`
  - `07-docs.md`
  - `08-risks.md`

**Key user decisions that the design MUST reflect:**
- Plugin type system: architect chose an approach in ADR-1 — verify it's justified and addresses TS2589 risk
- Machine serialization: `.state` property + `Machine.fromSnapshot()` — verify this is in the model and data flow
- Patcher: utility class + `MachineWithData` base class — verify in model and architecture
- Full isolation in `src/query-v2/` — verify no imports from `src/query/`
- MachineRefreshing transitions: architect defined in ADR-2 — verify completeness and consistency across all documents
- NO_VALUE: Symbol sentinel — verify in model
- Scope: resources + createApi only, no operations/commands — verify no scope creep, verify createApi extensibility (ADR-6)
- entry(args) returns ICacheEntry — verify in model and use cases
- ResourceDuplicator and select: out of scope — verify not present

**Review criteria — check each systematically:**

1. **Research traceability**: Every design choice in 04-decisions.md must cite specific research findings. Spot-check 3–5 architecture decisions against the research documents — do the cited findings actually support the decision?

2. **Internal consistency**: Do the types in 03-model.md match the components in 01-architecture.md? Do the sequence diagrams in 02-dataflow.md use the same method names and flow as the model? Do the use cases in 05-usecases.md use the API defined in the model? Do test cases in 06-testcases.md cover the use cases?

3. **Completeness**: Are all RFC features addressed (createApi, createResource, machines, cache, plugins, SSR, lifecycle hooks, SKIP_TOKEN, devtools)? Are all user decisions reflected? Are all research open questions either addressed or explicitly deferred?

4. **Feasibility**: Can the designed architecture actually be implemented with the existing signals infrastructure? Are there any circular dependencies in the module structure? Are the TypeScript types achievable without hitting compiler limits?

5. **ADR completeness**: Does every ADR have Status, Context, Options, Decision, Consequences? Are there decisions made in other documents that should be ADRs but aren't?

6. **Mermaid conformance**: Are all diagrams titled? Are they within the 15–20 element limit? Are they syntactically correct?

7. **Test-risk coverage**: Does every High-impact risk in 08-risks.md have corresponding test cases in 06-testcases.md? Are there test cases for every use case in 05-usecases.md?

8. **Docs proportionality**: Is 07-docs.md short and focused? Does it describe WHAT not HOW? No JSDoc?

9. **No implementation code**: Design documents should contain type definitions and API examples, not implementation logic. Flag any implementation code.

10. **Research open questions**: Are all 17 questions from 04-open-questions.md either addressed by a design decision or explicitly listed as deferred/out-of-scope?

**After reviewing, update `README.md`:**
- Set status to `Done` if approved, `Redraft` if issues found
- Write: Overview, Goals, Non-Goals, Documents (with links), Key Decisions summary, Quality Review checklist table, Next Steps
- The Quality Review table must have columns: #, Criterion, Status (PASS/FAIL/WARN), Notes
- If any criterion is FAIL, status must be `Redraft` and Next Steps must describe what needs fixing

---

# Redraft Round 1

## Phase 5: Fix User Feedback #1 (folder structure), #2 (machine state hierarchy)

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `03-model.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 2
- **Review issues**: User Feedback #1, #2

### Prompt

Read REVIEW.md at `./REVIEW.md`.
Your assigned issues: User Feedback #1 (folder structure) and User Feedback #2 (§5 Machine State Hierarchy).

Affected files:
- `01-architecture.md` — folder structure / module dependency diagram, §5 machine state hierarchy diagram
- `03-model.md` — any folder/path references that reflect module structure

Also read for context:
- Task description: `../../TASK.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`
- Research — Query v1 codebase analysis: `../01-research/01-codebase-query-v1.md` (for existing folder structure reference)

Fix only your assigned issues. Do not modify other content.

---

## Phase 6: Fix User Feedback #3 (devtools approach), Reviewer issues #1, #2

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
- **Depends on**: 5
- **Retry limit**: 2
- **Review issues**: User Feedback #3, Reviewer issue #1, Reviewer issue #2

### Prompt

Read REVIEW.md at `./REVIEW.md`.
Your assigned issues:
- User Feedback #3: Devtools — remove the separate devtools module design. Instead of `Devtools.createState()`, use the existing `beforeDevtoolsPush` callback from `Signal.state()`. Update all references accordingly.
- Reviewer issue #1: Move `TApiSnapshot` type definitions earlier in `03-model.md` or add cross-references from SSR sections.
- Reviewer issue #2: Add an ADR (or a note in an existing ADR) documenting the decision to split the RFC's single `useResource` into `useResourceV2Agent` / `useResourceV2Ref` following v1 conventions.

Affected files:
- `01-architecture.md` — devtools component references, component diagrams
- `02-dataflow.md` — devtools-related sequence diagrams
- `03-model.md` — devtools type definitions, `TApiSnapshot` placement (reviewer #1)
- `04-decisions.md` — ADR-8 (devtools projection) rewrite, new ADR for hook naming split (reviewer #2)
- `05-usecases.md` — devtools use case (#10), hook naming references
- `06-testcases.md` — devtools test cases

Also read for context:
- Existing signals devtools integration: `../../../../src/signals/base/Devtools.ts` (or check `../01-research/02-codebase-signals-common.md` for `beforeDevtoolsPush` details)
- Task description: `../../TASK.md`

Fix only your assigned issues. Do not modify other content.

---

## Phase 7: Re-review after Redraft Round 1

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 5, 6
- **Retry limit**: 2

### Prompt

Re-review all design documents modified in Redraft Round 1. The original review found 2 Low-severity issues and the user provided 3 feedback items. Phases 5 and 6 addressed them.

**Read all modified files:**
- `01-architecture.md` — verify folder structure is reorganized (UF#1), machine state hierarchy diagram is corrected (UF#2), devtools references updated (UF#3)
- `02-dataflow.md` — verify devtools sequence diagrams updated (UF#3)
- `03-model.md` — verify folder paths updated (UF#1), devtools types simplified (UF#3), `TApiSnapshot` placement improved (reviewer #1)
- `04-decisions.md` — verify ADR-8 (devtools) rewritten to use `beforeDevtoolsPush` (UF#3), hook naming ADR added (reviewer #2)
- `05-usecases.md` — verify devtools use case updated (UF#3)
- `06-testcases.md` — verify devtools test cases updated (UF#3)

**Also read for traceability:**
- REVIEW.md at `./REVIEW.md` — the original issues that were to be fixed
- Research README: `../01-research/README.md`
- RFC: `../../../../docs/contributing/query-v2/README.md`

**Review criteria (same as original Phase 4):**
1. All REVIEW.md issues (reviewer #1, #2) and User Feedback (#1, #2, #3) are resolved
2. Internal consistency across all documents is maintained after changes
3. No regressions — existing passing criteria still hold
4. Mermaid diagrams are syntactically correct and titled
5. Research traceability preserved

**Update `README.md`:**
- Set status to `Done` if all issues resolved, `Redraft` if still issues
- Update the Quality Review checklist table with re-review results
- Update Next Steps

---
