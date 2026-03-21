---
title: "Phases: 01-research"
date: 2026-03-17
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis — Query v1 Module

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-query-v1.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the existing query v1 module in the rx-toolkit codebase. Your goal is to document facts about its architecture, patterns, data flow, and public API surface. **No solutions or opinions — only verifiable information.**

Read the task description at `.thoughts/2026-03-17-1000_query-v2/TASK.md` and the RFC at `docs/contributing/query-v2/README.md` to understand what the new query-v2 module aims to achieve.

Then systematically analyze the following areas of the query v1 module:

**1. Public API surface** — Read and document:
- `@/query/api/createResource.ts` — how resources are created, options accepted, return type
- `@/query/api/createCommand.ts` — command creation pattern
- `@/query/api/createOperation.ts` — operation creation pattern
- `@/query/api/createResourceDuplicator.ts` — duplication mechanism
- `@/query/api/resetAllQueriesCache.ts` — global cache reset
- `@/query/index.ts` — public re-exports
- `@/query/SKIP_TOKEN.ts` — SKIP_TOKEN implementation and usage

**2. Core internals** — Read and document:
- `@/query/core/Resource/Resource.ts` — Resource class: state management, query execution, caching, lifecycle
- `@/query/core/Resource/ResourceAgent.ts` — agent pattern: stale-while-revalidate, fresh/stale args, state signal
- `@/query/core/Resource/ResourceRef.ts` — ref pattern
- `@/query/core/Resource/ResourceDuplicator.ts` — duplication internals
- `@/query/core/QueriesCache.ts` — global cache management
- `@/query/core/QueriesLifetimeHooks.ts` — lifecycle hooks implementation
- `@/query/core/ResetAllQueriesSignal.ts` — reset signal mechanism
- `@/query/core/Command/` and `@/query/core/Operation/` — list and document their structure

**3. Library utilities** — Read and document:
- `@/query/lib/ReactiveCache.ts` — reactive cache implementation (how entries are stored, evicted, accessed)
- `@/query/lib/IndirectMap.ts` — indirect map pattern (key comparison strategy)

**4. React integration** — Read and document:
- `@/query/react/useResourceAgent.ts` — how the hook bridges Resource/Agent to React
- `@/query/react/useCommandAgent.ts` — command hook pattern
- `@/query/react/useOperationAgent.ts` — operation hook pattern
- `@/query/react/useResourceRef.ts` — ref hook pattern

**5. Types** — Read and document:
- `@/query/types/Resource.types.ts` — all Resource-related types, state shapes, generic parameters
- `@/query/types/shared.types.ts` — shared type definitions
- `@/query/types/Command.types.ts` and `@/query/types/Operation.types.ts`

**6. Tests** — Skim test files to understand:
- What scenarios are covered (happy path, error, caching, lifecycle)
- Test patterns used (mocking, setup)
- Read: `@/query/core/Resource/Resource.test.ts`, `@/query/core/QueriesCache.test.ts`, `@/query/core/QueriesLifetimeHooks.test.ts`, `@/query/lib/ReactiveCache.test.ts`, `@/query/lib/IndirectMap.test.ts`, `@/query/react/useResourceAgent.test.ts`

For each area, document:
- File structure and dependencies
- Key classes/functions and their signatures
- Data flow (how a query goes from invocation to cache to UI)
- Patterns that v2 should understand or diverge from (per RFC: v2 must NOT depend on v1 code)
- Configuration/options handling

Write your output to `.thoughts/2026-03-17-1000_query-v2/01-research/01-codebase-query-v1.md` with proper frontmatter (title, date, stage: 01-research, role: rdpi-codebase-researcher).

---

## Phase 2: Codebase Analysis — Signals & Common Infrastructure

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `02-codebase-signals-common.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the signals system and common infrastructure in the rx-toolkit codebase that the new query-v2 module will build upon. **No solutions or opinions — only verifiable information.**

Read the task description at `.thoughts/2026-03-17-1000_query-v2/TASK.md` and the RFC at `docs/contributing/query-v2/README.md` to understand what primitives query-v2 will use.

Analyze the following areas:

**1. Signals primitives** — Read and document:
- `@/signals/signals/State.ts` — State signal: creation, `.set()`, `.get()`, reactivity mechanism
- `@/signals/signals/Computed.ts` — Computed signal: dependency tracking, recomputation
- `@/signals/signals/Effect.ts` — Effect: subscription, cleanup, lifecycle
- `@/signals/signals/Signal.ts` — Signal namespace/factory (how `Signal.state()`, `Signal.compute()` are exposed)
- `@/signals/index.ts` — public exports
- `@/signals/types/` — type definitions for signals

**2. Signal base layer** — Read and document:
- `@/signals/base/ReadonlySignal.ts` — base signal interface
- `@/signals/base/SyncObservable.ts` — synchronous observable pattern
- `@/signals/base/Batcher.ts` — batching mechanism (important for cache updates)
- `@/signals/base/DependencyTracker.ts` — how dependencies are tracked
- `@/signals/base/ComputeCache.ts` — computation caching
- `@/signals/base/Devtools.ts` — signal-level devtools integration

**3. Devtools integration** — Read and document:
- `@/common/devtools/reduxDevtools.ts` — Redux DevTools bridge: how state changes are pushed
- `@/common/devtools/combineDevtools.ts` — combining multiple devtools sources
- `@/common/devtools/types.ts` — devtools type definitions
- Document the `beforeDevtoolsPush` pattern if it exists in v1 (the RFC requires it for v2)

**4. Common utilities** — Read and document:
- `@/common/utils/shallowEqual.ts` — shallow comparison (used as default `compareArg` in RFC)
- `@/common/utils/deepEqual.ts` — deep comparison
- `@/common/utils/PromiseResolver.ts` — promise resolution utility
- `@/common/options/SharedOptions.ts` — shared options pattern (how options are inherited/overridden)
- `@/common/options/DefaultOptions.ts` — default options mechanism

**5. Common React hooks** — Read and document:
- `@/common/react/useConstant.ts` — constant value hook
- `@/common/react/useEventHandler.ts` — event handler hook

**6. Signal operators** — List and briefly document:
- `@/signals/operators/` — available operators and their patterns (query-v2 may need to leverage some)

**7. Signal React integration** — Read and document:
- `@/signals/react/` — how signals integrate with React (this is how query-v2's React plugin will work)

For each area, document:
- File structure and exports
- Key interfaces and their signatures
- How reactivity flows (signal → computed → effect → UI)
- How devtools integration works end-to-end
- Patterns for options inheritance (API-level → resource-level defaults)

Write your output to `.thoughts/2026-03-17-1000_query-v2/01-research/02-codebase-signals-common.md` with proper frontmatter (title, date, stage: 01-research, role: rdpi-codebase-researcher).

---

## Phase 3: External Research

- **Agent**: `rdpi-external-researcher`
- **Output**: `03-external-research.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are researching external patterns and libraries relevant to building a query/data-fetching module with caching, state machines, plugins, and SSR support. **Cross-reference all claims, annotate confidence levels (High/Medium/Low), separate established practices from opinions.**

Read the task description at `.thoughts/2026-03-17-1000_query-v2/TASK.md` and the RFC at `docs/contributing/query-v2/README.md` to understand the target architecture.

Research the following areas:

**1. RTK Query (Redux Toolkit Query)** — Analyze:
- `createApi` pattern: how endpoints are defined, how types flow from query functions to hooks
- Cache key strategy: how args are serialized, cache entry lifecycle
- `onCacheEntryAdded` and `onQueryStarted` lifecycle hooks: API surface, typical use cases, race condition handling
- Plugin/middleware architecture: how RTK Query extends behavior
- SSR support: how snapshots are created and hydrated
- Optimistic updates / patch mechanism: how patches are applied and rolled back
- Confidence: High (well-documented, widely used)

**2. TanStack Query (React Query)** — Analyze:
- Query key serialization and comparison strategies
- Cache lifetime management (staleTime, gcTime)
- Hydration/dehydration for SSR
- Plugin system (if any) or extension points
- Agent-like patterns (query observers)
- Confidence: High (well-documented, widely used)

**3. State machine patterns for data fetching** — Research:
- XState / Stately approach to modeling fetch states (idle → pending → success/error)
- Benefits of class-based machines vs. discriminated unions
- Transition validation: ensuring only valid state transitions
- How machines handle optimistic updates and rollbacks
- Confidence: Medium (pattern well-known, class-based machine approach is less common)

**4. Plugin system patterns** — Research:
- Type-safe plugin systems in TypeScript: how plugins modify the type of a host object
- Declaration merging vs. generic type accumulation vs. builder pattern
- Plugin systems that add methods to existing objects (similar to RFC's ReactHooksPlugin adding `useResource`)
- Confidence: Medium (multiple valid approaches, no single standard)

**5. Serialization strategies for cache keys** — Research:
- `stableStringify` / deterministic JSON serialization: common implementations, edge cases
- Serialized string keys vs. structural comparison: trade-offs (memory, performance, correctness)
- Argument caching (`doCacheArgs` in RFC): memoization of serialization results
- Confidence: High (well-understood problem)

**6. SSR hydration/dehydration patterns** — Research:
- How data-fetching libraries handle server → client state transfer
- Snapshot versioning and compatibility
- `maxSnapshotDataAge` concept: staleness checking on hydration
- Confidence: Medium (patterns vary significantly across frameworks)

For each area, provide:
- Summary of findings
- Relevant code patterns or API examples
- Known pitfalls and edge cases
- Confidence level with justification

Write your output to `.thoughts/2026-03-17-1000_query-v2/01-research/03-external-research.md` with proper frontmatter (title, date, stage: 01-research, role: rdpi-external-researcher).

---

## Phase 4: Open Questions

- **Agent**: `rdpi-questioner`
- **Output**: `04-open-questions.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 1

### Prompt

You are synthesizing open questions, trade-offs, ambiguities, and constraints for the query-v2 module implementation.

Read the task description at `.thoughts/2026-03-17-1000_query-v2/TASK.md` and the RFC at `docs/contributing/query-v2/README.md`.

Then read ALL research outputs:
- `.thoughts/2026-03-17-1000_query-v2/01-research/01-codebase-query-v1.md` — query v1 analysis
- `.thoughts/2026-03-17-1000_query-v2/01-research/02-codebase-signals-common.md` — signals & common infrastructure
- `.thoughts/2026-03-17-1000_query-v2/01-research/03-external-research.md` — external patterns

Generate questions covering these categories:

**Technical constraints:**
- Signal reactivity: can the existing signals system support the reactive cache patterns described in the RFC? Are there batch update concerns?
- Type inference: how can the plugin system modify resource types (e.g., ReactHooksPlugin adding `useResource`)? What TypeScript patterns are feasible?
- State machine classes: the RFC shows class-based machines with transition methods — how do these serialize for devtools/snapshots?

**API compatibility:**
- How does `SKIP_TOKEN` work in v2 vs. v1? Are there behavioral differences?
- How do `onCacheEntryAdded` and `onQueryStarted` interact with the state machine lifecycle?
- How does `beforeDevtoolsPush` integrate with the existing devtools infrastructure?

**Performance trade-offs:**
- `serialize` vs. `compare` key strategy: memory and CPU implications at scale
- `doCacheArgs` memoization: when is it beneficial vs. wasteful?
- Cache lifetime and eviction: interaction with signal garbage collection

**Scope ambiguities (from RFC):**
- The RFC mentions "в дальнейшем и операций" for `createApi` — are operations/commands in scope for v2?
- `Patcher.resolvePatches` and `Patcher.finishPatch` — is the Patcher a separate utility class? What's the full API?
- `NO_VALUE` sentinel — how is it implemented? Type-level handling?
- `MachineRefreshing` — the RFC mentions it but doesn't show full implementation. What transitions does it support?

**Risks:**
- v2 must NOT depend on v1 — but both will coexist. How to avoid naming conflicts, global state leaks?
- Plugin type manipulation in TypeScript can be fragile. What happens when plugins compose?
- Race conditions in patches: the RFC mentions v1 has a "hanging patch" bug — how to avoid it in v2?

Classify each question as **High**, **Medium**, or **Low** priority. For each question provide:
1. Context (what triggered this question)
2. Options (if applicable)
3. Risks (what happens if this is unresolved)
4. Recommendation (researcher's best judgment based on available facts)

Write your output to `.thoughts/2026-03-17-1000_query-v2/01-research/04-open-questions.md` with proper frontmatter (title, date, stage: 01-research, role: rdpi-questioner).

---

## Phase 5: Research Review

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 2

### Prompt

You are reviewing and synthesizing all research outputs for the query-v2 module research stage.

Read ALL phase outputs:
- `.thoughts/2026-03-17-1000_query-v2/01-research/01-codebase-query-v1.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/02-codebase-signals-common.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/03-external-research.md`
- `.thoughts/2026-03-17-1000_query-v2/01-research/04-open-questions.md`

Also read the original task and RFC:
- `.thoughts/2026-03-17-1000_query-v2/TASK.md`
- `docs/contributing/query-v2/README.md`

Update `.thoughts/2026-03-17-1000_query-v2/01-research/README.md` with the following structure:

1. **Summary** — 2–3 sentence overview of what was researched and key conclusions
2. **Documents** — list of all phase output files with brief descriptions
3. **Key Findings** — 5–7 bullets capturing the most important facts discovered:
   - Query v1 architecture patterns to learn from (and diverge from)
   - Signals capabilities and limitations for reactive caching
   - Devtools integration approach
   - External patterns most relevant to v2 design
   - Plugin type system feasibility
   - SSR hydration approach viability
   - State machine class pattern assessment
4. **Contradictions and Gaps** — anything inconsistent across documents or missing
5. **Quality Review** — verify:
   - All output files exist and have correct frontmatter
   - References between documents are accurate
   - Source attribution includes confidence levels (in external research)
   - Questions in 04-open-questions.md are actionable with priorities
   - No solutions or design proposals appear in research outputs (no-solutions rule)
   - Cross-reference consistency (claims in one document don't contradict another)
6. **Next Steps** — what the design stage should focus on first

Set README.md `status` to `Done` if quality review passes, or `Needs Review` if issues are found.

---
