---
title: "Phases: 01-research"
date: 2026-03-23
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis — query-v2, signals, and common

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-query-v2.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the **query-v2 module** and its foundation layers to build a comprehensive factual picture of the current state and intended design. This is the primary research phase for a very complex task: fully implementing query-v2 with tests.

**Read first:**
- Task description: `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/TASK.md`

**Areas to investigate (in order of priority):**

#### 1. Current query-v2 implementation (`src/query-v2/`)
List all files in `src/query-v2/` and all subdirectories recursively. Read every file. Document:
- Overall module structure and file organization
- Public API surface (`src/query-v2/index.ts` — what is exported)
- Core abstractions: Resource, Operation, Command state machines, their states and transitions
- The snapshot system — how snapshots are created, what they contain, how they relate to reactive state
- Cache layer (`src/query-v2/lib/`) — ReactiveCache, IndirectMap, any other cache primitives
- Plugin system (`src/query-v2/plugins/`) — what plugins exist, how they hook in
- React integration (`src/query-v2/react/`) — hooks, providers, context usage
- Type system (`src/query-v2/types/`) — key type definitions and their relationships
- API layer (`src/query-v2/api/`) — factory functions for creating resources, operations, commands
- Test files (`src/query-v2/__tests__/`) — what is tested, what patterns are used

#### 2. v0.1 Documentation (`docs/query-v2/v0.1/`)
List and read ALL files in `docs/query-v2/v0.1/`. Document:
- Intended architecture and design decisions
- API contracts described in docs
- State machine specifications
- Any diagrams or flow descriptions
- How the documented design differs from or extends the current implementation

#### 3. Signals system (`src/signals/`)
List all files in `src/signals/` recursively. Read key files to understand:
- Core signal primitives (State, Computed, Effect, etc.)
- Signal lifecycle and subscription model
- How signals are composed
- The public API surface (`src/signals/index.ts`)
- Base layer vs operators vs React integration

#### 4. Common utilities (`src/common/`)
List and read files in `src/common/`. Document:
- DevTools integration (`src/common/devtools/`)
- Shared options system (`src/common/options/`)
- React utilities (`src/common/react/`)
- Utility functions (`src/common/utils/`) — especially deepEqual, shallowEqual, PromiseResolver

#### 5. Gaps between implementation and documentation
After analyzing both the code and docs, explicitly list:
- Features described in docs but not implemented
- Implementation details that diverge from docs
- Code that exists but isn't documented
- Areas marked as hacky, TODO, or clearly incomplete in the code

**Output format:** Write your findings to `01-codebase-query-v2.md` in the stage directory. Use clear headings per area. Include file paths with `@/` prefix. Use Mermaid diagrams for state machines and architecture (max 15-20 elements each). No solutions or recommendations — only facts.

**Important:** If anything is unclear or ambiguous, you may ask the user clarifying questions via the `vscode_askQuestions` tool.

---

## Phase 2: Codebase Analysis — query v1 reference architecture

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `02-codebase-query-v1.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the **original query v1 module** (`src/query/`) as a reference architecture for the query-v2 full implementation. The v1 module is mature, tested, and follows established patterns. Understanding it is critical because query-v2 should learn from its patterns while improving on its design.

**Read first:**
- Task description: `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/TASK.md`

**Areas to investigate:**

#### 1. Module structure and organization
List all files in `src/query/` and all subdirectories recursively. Document:
- File organization pattern (how code is split between api/, core/, lib/, react/, types/)
- Public API surface (`src/query/index.ts`)
- How the module is structured — what's the layering (core → lib → api → react)

#### 2. Core abstractions (`src/query/core/`)
Read all files in `src/query/core/`. Document:
- Resource, Operation, Command — their internal implementation
- State management approach (how state is stored and updated)
- QueriesCache — how caching works, cache keys, lifecycle
- QueriesLifetimeHooks — lifecycle management
- ResetAllQueriesSignal — reset mechanism
- How these core abstractions interact with each other

#### 3. API layer (`src/query/api/`)
Read all files. Document:
- Factory functions: createResource, createOperation, createCommand, createResourceDuplicator
- How factory functions wire core abstractions together
- Configuration options and defaults
- resetAllQueriesCache — global reset mechanism

#### 4. React integration (`src/query/react/`)
Read all files. Document:
- Hooks provided to consumers
- How hooks subscribe to reactive state
- SKIP_TOKEN usage pattern
- Provider/context usage if any

#### 5. Library utilities (`src/query/lib/`)
Read all files. Document:
- IndirectMap, ReactiveCache — compare with query-v2 versions
- Any other utilities

#### 6. Testing patterns
List and read test files in `src/query/` (look for `*.test.ts`, `*.spec.ts` files, and `__tests__/` directories). Also check `src/__tests__/` for integration tests that involve query. Document:
- How tests are structured
- What test utilities/helpers exist (`src/__tests__/helpers/`)
- Mocking strategies
- What is tested (unit vs integration)
- Test coverage patterns (what gets tested, what doesn't)

#### 7. Type system (`src/query/types/`)
Read type definitions. Document key types and how they're organized.

**Output format:** Write your findings to `02-codebase-query-v1.md` in the stage directory. Use clear headings per area. Include file paths with `@/` prefix. Focus on patterns that are transferable to v2. Use Mermaid diagrams for architecture overview. No solutions or recommendations — only facts.

**Important:** If anything is unclear or ambiguous, you may ask the user clarifying questions via the `vscode_askQuestions` tool.

---

## Phase 3: External Research — query/cache management best practices

- **Agent**: `rdpi-external-researcher`
- **Output**: `03-external-research.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are researching **external best practices for query/cache management libraries** in the frontend/reactive ecosystem. This research supports the full implementation of a query-v2 module in a signals-based reactive toolkit.

**Read first:**
- Task description: `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/TASK.md`
- Also read `docs/query-v2/README.md` for high-level understanding of the query-v2 module goals and `docs/query-v2/v0.1/` documentation for the intended v0.1 design.

**Research areas:**

#### 1. Comparable libraries
Analyze how these libraries handle query/cache management:
- **TanStack Query (React Query)** — cache invalidation, stale-while-revalidate, query keys, mutations, optimistic updates, garbage collection
- **RTK Query (Redux Toolkit)** — cache tags, invalidation, endpoints, transformResponse, cache lifecycle
- **SWR** — revalidation strategies, cache, mutation, error handling
- **Apollo Client** — normalized cache, cache policies, optimistic UI, reactive variables
- **Relay** — fragment-level caching, store updates, garbage collection

For each: document cache strategy, invalidation patterns, state machine for query lifecycle, error/retry handling, how subscriptions/refcounting work.

#### 2. State machine patterns for async operations
- Common state models for fetch operations (idle → loading → success/error)
- Stale-while-revalidate patterns
- Retry and backoff strategies
- Optimistic update and rollback patterns
- Cache garbage collection approaches (reference counting, TTL, LRU)

#### 3. Snapshot/immutable state patterns
- How libraries bridge reactive (mutable) internal state with immutable snapshots for consumers
- React `useSyncExternalStore` patterns
- Structural sharing for snapshot creation

#### 4. Plugin/middleware architectures
- How query libraries support extensibility (middleware, plugins, interceptors)
- Common plugin patterns: logging, devtools, persistence, retry

**Skepticism directive:** Cross-reference claims across multiple sources. Annotate each finding with confidence level:
- **High**: documented in official docs + widely used in practice
- **Medium**: found in multiple sources but not universally adopted
- **Low**: single source, blog post, or opinion piece

**Output format:** Write findings to `03-external-research.md` in the stage directory. Organize by research area. Include links to sources. No solutions — only factual analysis of what exists and how it works.

**Important:** If anything is unclear or ambiguous, you may ask the user clarifying questions via the `vscode_askQuestions` tool.

---

## Phase 4: Open Questions and Trade-offs

- **Agent**: `rdpi-questioner`
- **Output**: `04-open-questions.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 1

### Prompt

You are synthesizing **open questions, trade-offs, ambiguities, and constraints** for the full implementation of a query-v2 module. This is a very complex task — a full rewrite of a query/cache management system built on signals.

**Read first:**
- Task description: `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/TASK.md`
- Codebase analysis (query-v2, signals, common): `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/01-codebase-query-v2.md`
- Codebase analysis (query v1 reference): `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/02-codebase-query-v1.md`
- External research: `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/03-external-research.md`

**Generate questions in these categories:**

1. **Architecture & Design Constraints** — How should query-v2 layer on signals? What are the boundaries between core, lib, api, react? Should the architecture mirror v1 or diverge?

2. **State Machine Completeness** — Are the state machines for Resource, Operation, Command fully specified in docs? Are there edge cases not covered? How do error states, retries, and cancellation work?

3. **Snapshot System** — How should the snapshot system bridge reactive signals to immutable React-consumable state? What structural sharing strategy should be used? How does this interact with useSyncExternalStore?

4. **Cache Strategy** — Cache invalidation, garbage collection (TTL vs refcount vs manual), cache key design, normalized vs denormalized cache.

5. **Plugin/Extensibility** — What plugin API surface is needed? What must be in core vs pluggable?

6. **Testing Strategy** — What testing approach fits this complexity? Unit vs integration split, async testing patterns, how to test state machines.

7. **API Compatibility** — Should query-v2 maintain any backward compatibility with v1? What migration path is needed?

8. **Performance** — Memory management, subscription efficiency, re-render minimization, large cache scenarios.

9. **Scope Ambiguities** — What's in scope for the "full implementation"? What about devtools, SSR, persistence?

**For each question, provide:**
- **Context**: why this question matters (1-2 sentences)
- **Options**: possible approaches (if applicable)
- **Risks**: what goes wrong if this isn't addressed
- **Priority**: High / Medium / Low
- **Recommendation**: your suggested path forward (based on research findings)

**Output format:** Write to `04-open-questions.md` in the stage directory. Group by category. Number each question globally (Q1, Q2, ...). Aim for 15-30 substantive questions.

**Important:** If anything is unclear or ambiguous, you may ask the user clarifying questions via the `vscode_askQuestions` tool.

---

## Phase 5: Research Review and Synthesis

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 2

### Prompt

You are the **research reviewer** for the query-v2 full implementation research stage. Your job is to synthesize all findings into a comprehensive README.md and verify the quality and consistency of all research outputs.

**Read ALL phase outputs:**
- `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/01-codebase-query-v2.md`
- `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/02-codebase-query-v1.md`
- `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/03-external-research.md`
- `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/04-open-questions.md`

**Update `README.md`** at `@/.thoughts/2026-03-23-1400_query-v2-full-implementation/01-research/README.md` with the following structure:

### README.md Structure

1. **Summary** — 3-5 sentence overview of what was researched and the key takeaway
2. **Documents** — table linking to each phase output with brief description
3. **Key Findings** — 5-7 bullet points of the most important discoveries across all research
4. **Contradictions and Gaps** — where phase outputs disagree, where information is missing, where docs and code diverge
5. **Quality Review** — checklist (see below)
6. **Next Steps** — what the design stage needs to address based on this research

### Quality Review Checklist

Verify each item and mark pass/fail:
- [ ] All referenced files exist and paths are correct (`@/` prefix)
- [ ] Source attribution: external claims have confidence levels (High/Medium/Low)
- [ ] No solutions or recommendations in codebase analysis (phases 1-2 should be facts only)
- [ ] Open questions are actionable (each has context, options, risks, priority)
- [ ] Frontmatter is correct in all phase output files
- [ ] Cross-references between documents are consistent (claims in one doc don't contradict another)
- [ ] Mermaid diagrams are present for state machines and architecture
- [ ] Coverage: all areas from TASK.md have been investigated
- [ ] Code paths referenced actually exist in the codebase

Set README.md `status` to `Done` if all checks pass, or `Needs Review` if any fail (with explanation).

**Important:** If anything is unclear or ambiguous, you may ask the user clarifying questions via the `vscode_askQuestions` tool.

---
