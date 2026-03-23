---
title: "Phases: 02-design"
date: 2026-03-23
stage: 02-design
---

# Phases: 02-design

## Phase 1: Core Architecture

- **Agent**: `rdpi-architect`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are designing the architecture for a full rewrite of the **query-v2** module in a reactive toolkit library built on a custom Signals system. This is a complex, multi-layer module covering data fetching, caching, state machines, snapshots, plugins, and React integration.

**Critical context — read these files first:**

1. `../TASK.md` — task description
2. `../01-research/README.md` — research summary and key findings
3. `../01-research/01-codebase-query-v2.md` — full analysis of the current (broken) v2 code
4. `../01-research/02-codebase-query-v1.md` — reference analysis of the mature v1 module
5. `../01-research/03-external-research.md` — external best practices (TanStack Query, RTK Query, SWR, Apollo, Relay)
6. `../01-research/04-open-questions.md` — open questions with options and risks

Also read these source-of-truth references:
7. V0.1 documentation directory: `docs/query-v2/v0.1/` — read ALL files in this directory; this is the PRIMARY specification
8. Signals system: `src/signals/` — read `index.ts` and key types to understand the reactive primitive layer
9. Common utilities: `src/common/` — read exports to understand shared infrastructure (options, devtools, utils, react)
10. Query v1 for reference patterns: `src/query/index.ts` — understand the public API surface

**Key user decisions (binding constraints):**
- **TError**: NOT needed — no generic error type parameter anywhere. Errors are always `unknown`.
- **Command**: Keep in mind but do NOT design for this iteration. Resource and Operation only.
- **stableStringify**: Keep minimal — use a simple stable JSON serialization for cache keys.
- **DevTools**: Already included in Signal.state — no new devtools infrastructure needed.
- **Current v2 code**: NOT correct and NOT a reference. The v0.1 documentation is the source of truth.

**You must produce these output files:**

**`01-architecture.md`** — System Architecture:
- C4 Level 2-3 diagrams (Mermaid) showing module structure and external boundaries
- Module layering: define clear `lib/` → `core/` → `api/` → `react/` layers with dependency rules (each layer only depends on layers below it)
- Component responsibility zones: what lives in each layer and why
- Module dependency diagram (Mermaid): all internal module connections
- Class/interface hierarchy diagram (Mermaid)
- Integration points: how query-v2 connects to Signals system, common utilities, and React

**`02-dataflow.md`** — Data Flow:
- Sequence diagrams (Mermaid) for key scenarios:
  - Resource: initial fetch, refetch, stale-while-revalidate, cache hit, args change, abort, error → retry, GC lifecycle
  - Operation: execute, concurrent execution handling, error flow
  - Snapshot: signal → snapshot bridge, subscription lifecycle
  - Plugin: hook invocation order, plugin composition
- State machine diagrams (Mermaid) for Resource and Operation — complete specifications with all states and transitions. Must align with v0.1 docs state definitions. Mark which transitions are user-triggered vs internal.
- Cache data flow: write path (fetch → normalize → store), read path (key → lookup → snapshot), invalidation cascade, GC trigger flow

**`03-model.md`** — Domain Model:
- TypeScript interface/type definitions for ALL public and internal types:
  - Resource configuration, Resource instance, Resource state
  - Operation configuration, Operation instance, Operation state
  - CacheEntry: internal reactive container with signals
  - Snapshot types: immutable objects consumed by React
  - Cache types: key design, entry storage, lifetime management
  - Plugin types: hook signatures, plugin registration
  - Factory function signatures: `createResource()`, `createOperation()`, `createCache()`
  - React hook signatures: `useResource()`, `useOperation()`, etc.
- Generic type parameters: only `<TArgs, TData>` — no TError
- Clearly mark public vs internal types
- Type hierarchy showing how types compose

**`04-decisions.md`** — Architecture Decision Records:
- Use ADR format: Status, Context, Options (with pros/cons), Decision, Consequences
- Number as ADR-1, ADR-2, etc.
- Minimum ADRs to cover (resolve these from research open questions):
  - ADR: Module layering strategy (lib/core/api/react split)
  - ADR: State machine implementation approach (signal-based vs class-based)
  - ADR: SWR previous/current swap semantics (research finding #2 — v1's approach vs v2's broken approach)
  - ADR: CacheEntry abstraction boundary (internal reactive container vs consumer handle)
  - ADR: GC strategy — refcount+timer hybrid vs timer-only (research finding #5)
  - ADR: Patcher safety — consistency violation detection (research finding #3)
  - ADR: Cache key design — stable serialization approach
  - ADR: Snapshot bridge mechanism (signals → immutable state for React)
  - ADR: Plugin hook API (synchronous vs async, hook points, composition)
- Each ADR must cite research documents as evidence

**Constraints:**
- All Mermaid diagrams must be titled and contain max 15-20 elements. Split larger diagrams.
- All design choices must reference research findings with relative links (e.g., `[01-research §5.3](../01-research/01-codebase-query-v2.md#53-...)`)
- No implementation code — interfaces and types only as specification.
- Stay aligned with v0.1 docs as source of truth; note any deliberate deviations as ADRs.

If you encounter ambiguity or need user input on any architectural decision, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 2: Use Cases & Documentation Impact

- **Agent**: `rdpi-architect`
- **Output**: `05-usecases.md`, `07-docs.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

You are continuing the design for the **query-v2** module. Phase 1 has produced the core architecture. Now you must define use cases with concrete API examples and assess documentation impact.

**Read these files first:**

1. `../TASK.md` — task description
2. Phase 1 outputs in this directory: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`
3. `../01-research/01-codebase-query-v2.md` — for understanding current API surface
4. `../01-research/02-codebase-query-v1.md` — for v1 API patterns as reference
5. V0.1 documentation: `docs/query-v2/v0.1/` — read ALL files; this is the primary specification for API shape
6. Current v2 React hooks: `src/query-v2/react/` — understand existing hook patterns (even though implementation is broken, the API shape may inform decisions)

**Key constraints (same as Phase 1):**
- No TError generic — errors are `unknown`
- No Command — Resource and Operation only
- V0.1 docs are the source of truth

**You must produce these output files:**

**`05-usecases.md`** — Use Cases & API Examples:

For each use case, provide:
- Brief description of the scenario
- Complete TypeScript code example showing the API in action
- React component example where applicable
- Edge case variants and how they're handled

Cover these use case categories:

*Resource use cases:*
*Operation use cases:*
*React integration use cases:*
*System use cases:*

Each code example must use the type signatures from `03-model.md`. Show realistic TypeScript — no `any` types, proper generics.

**`07-docs.md`** — Documentation Impact:

**WARNING: This file must be SHORT and focused. Large docs.md is an anti-pattern.**

Only cover high-impact documentation changes:
- Which existing docs need updates (list file paths and what changes)
- What NEW documentation is needed for v0.2
- What concepts require explanation (brief list)
- Migration guide scope: what users of current v2 need to know
- Example app considerations for `apps/demos/`

Do NOT write the documentation itself. Only describe WHAT needs documentation. Match the existing project documentation style (see `docs/` directory structure). No JSDoc specifications.

**Constraints:**
- Code examples are specifications, not implementation — show the PUBLIC API surface only
- All examples must be consistent with types in `03-model.md` and architecture in `01-architecture.md`
- Reference phase 1 decisions where relevant

If you encounter ambiguity or need user input on any API design question, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 3: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Output**: `06-testcases.md`, `08-risks.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are designing the QA strategy and risk analysis for a full rewrite of the **query-v2** module — a complex reactive data-fetching layer with state machines, caching, snapshots, plugins, and React hooks.

**Read these files first:**

1. `../TASK.md` — task description
2. All Phase 1 outputs: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`
3. Phase 2 outputs: `05-usecases.md`, `07-docs.md`
4. `../01-research/01-codebase-query-v2.md` — especially §16 (gaps and issues), §14 (existing test coverage)
5. `../01-research/02-codebase-query-v1.md` — especially §6.3 (v1 testing patterns: controllable promises, flushMicrotasks)
6. `../01-research/03-external-research.md` — especially §2.7 (testing approaches in external libs)
7. `../01-research/04-open-questions.md` — Q15 (testing approach question)

Also reference:
8. Existing test infrastructure: `src/__tests__/setup.ts`, `src/__tests__/helpers/`
9. V1 test patterns: `src/query/core/Resource/Resource.test.ts`, `src/query/api/createResource.test.ts`
10. Current v2 tests (broken but informative): `src/query-v2/__tests__/`
11. Vitest config: `vitest.config.ts`

**You must produce these output files:**

**`06-testcases.md`** — Test Strategy & Test Cases:

*Test Strategy section:*
- Testing layers: unit (per module), integration (cross-layer), component (React hooks)
- Testing tools: Vitest (already configured), React Testing Library (for hooks)
- Key testing patterns to adopt from v1 research:
  - Controllable-promise pattern (externally resolvable promises for async testing)
  - `flushMicrotasks()` for async chain testing
  - `cacheLifetime: false` to eliminate TTL interference in tests
  - `devtoolsName: false` to disable DevTools hooks in tests
- Test isolation: each test must be independent, no shared cache state
- How to test state machines: transition-by-transition verification
- How to test snapshots: verify immutability, verify signal→snapshot sync
- How to test plugins: mock hooks, verify invocation order
- How to test React hooks: `renderHook()`, act() boundaries, cleanup verification

*Test Case tables — one table per architectural layer:*

Format: | ID | Category | Description | Input | Expected Output | Priority |

Categories to cover:
- **lib layer**: Cache data structures, IndirectMap, ReactiveCache, stable key serialization
- **core layer — state machines**: Every state transition for Resource machine, every state transition for Operation machine, invalid transition handling, concurrent transition edge cases
- **core layer — CacheEntry**: Entry lifecycle, signal updates, snapshot generation, previous data retention (SWR), abort handling
- **core layer — Agent**: Fetch orchestration, abort on args change, retry logic, error propagation
- **core layer — Patcher**: Optimistic update application, rollback on abort, consistency violation detection
- **core layer — Cache**: Key lookup, entry creation, invalidation, GC lifecycle (refcount + timer), bulk reset
- **core layer — Plugins**: Hook invocation, plugin composition, error in plugin handling
- **api layer**: Factory function behavior (`createResource`, `createOperation`), configuration validation, option merging
- **react layer**: Hook subscription lifecycle, re-render triggers, cleanup on unmount, Suspense/ErrorBoundary interaction (if applicable), concurrent mode safety
- **integration**: Full fetch→cache→snapshot→React render pipeline, cross-resource invalidation, plugin + cache + snapshot interaction, GC under real component lifecycle

Assign priority: P0 (blocks other tests), P1 (core functionality), P2 (edge cases), P3 (nice-to-have).

Target: comprehensive coverage. This is a rewrite — every public and internal behavior needs verification.

**`08-risks.md`** — Risk Analysis:

*Risk table format:*
| ID | Risk | Probability (H/M/L) | Impact (H/M/L) | Strategy | Mitigation |

Cover these risk categories:
- **Technical risks**: state machine correctness, async race conditions, memory leaks from signal subscriptions, snapshot consistency with concurrent updates, Immer patch compatibility, plugin error isolation
- **Integration risks**: Signals system compatibility, React 18/19 concurrent mode, useSyncExternalStore tearing, existing test infrastructure sufficiency
- **Scope risks**: complexity explosion, scope creep into Command territory, v0.1 doc ambiguities requiring interpretation
- **Quality risks**: test flakiness from async timing, coverage gaps in edge cases, regression from v1 behavior differences
- **Performance risks**: unnecessary re-renders, cache memory growth, GC pressure

For each High-impact risk, provide a **detailed mitigation plan** (not just "mitigate" — describe specific actions).

If you encounter ambiguity or need user input on testing strategy decisions, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 4: Design Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing the complete design for the **query-v2** module rewrite. All design documents have been produced — your job is to verify quality, consistency, and completeness.

**Read ALL design documents in this directory:**
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

**Read research documents for traceability verification:**
- `../01-research/README.md`
- `../01-research/01-codebase-query-v2.md`
- `../01-research/02-codebase-query-v1.md`
- `../01-research/03-external-research.md`
- `../01-research/04-open-questions.md`

**Read the source of truth:**
- `docs/query-v2/v0.1/` — all files

**Review criteria — check each and report pass/fail:**

1. **Research traceability**: Every design decision in `04-decisions.md` must reference specific research findings. Verify the references are accurate (the cited section actually supports the decision).

2. **ADR completeness**: Every ADR has Status, Context, Options with pros/cons, Decision, Consequences. No ADR is missing consequences.

3. **Internal consistency**: 
   - Types in `03-model.md` match the architecture described in `01-architecture.md`
   - Sequence diagrams in `02-dataflow.md` use the same component names as `01-architecture.md`
   - Use case code examples in `05-usecases.md` match the types in `03-model.md`
   - Test cases in `06-testcases.md` cover the state transitions in `02-dataflow.md`
   - Risks in `08-risks.md` align with complexity identified in architecture

4. **Mermaid conformance**: All diagrams titled, elements ≤ 15-20, valid Mermaid syntax.

5. **V0.1 doc alignment**: Design aligns with v0.1 documentation. Any deliberate deviations are recorded as ADRs.

6. **Completeness**: 
   - All state machine states and transitions are specified
   - All public API types are defined
   - All layers (lib/core/api/react) have design coverage
   - Plugin API is fully specified
   - GC lifecycle is fully designed

7. **Research open questions resolved**: Check each question from `../01-research/04-open-questions.md`. For each, verify it's either resolved by an ADR, addressed in the design, or explicitly deferred with justification.

8. **User decisions honored**:
   - No TError generic anywhere in the type definitions
   - No Command design (only Resource and Operation)
   - DevTools uses existing Signal.state infrastructure
   - Current v2 code is not used as a reference (design may diverge)

9. **Test-risk coverage**: Every High/Medium risk in `08-risks.md` has corresponding test cases in `06-testcases.md`.

10. **Documentation proportionality**: `07-docs.md` describes WHAT, not HOW. No JSDoc. Appropriately short.

11. **No implementation code**: Design documents contain type specifications and examples, not runnable implementation.

12. **Feasibility**: The design is implementable given the Signals system, existing common utilities, and the project's architecture patterns.

**Update `README.md`** with:

```yaml
---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-23
status: <"Approved" or "Not Approved">
feature: "Full implementation of query-v2 module with tests"
research: "../01-research/"
---
```

Structure:
- **Overview**: 2-3 sentence summary of what was designed
- **Goals**: what the design achieves
- **Non-Goals**: what was explicitly excluded (Command, TError, etc.)
- **Documents**: table linking all 8 design documents with descriptions
- **Key Decisions**: summary table of all ADRs with one-line descriptions
- **Quality Review**: checklist table with all 12 criteria above, pass/fail status, and notes for any failures
- **Issues Found**: numbered list of any problems discovered, with severity and location
- **Contradictions**: any inconsistencies between documents
- **Next Steps**: what the plan stage needs to know

If you find issues, list them with:
- Issue number
- Severity (Critical/High/Medium/Low)
- Location (which document, which section)
- Description
- Expected fix

Set status to "Not Approved" if any Critical or High issues exist. Set to "Approved" if only Medium/Low issues (which can be addressed in planning).

If you encounter ambiguity in review criteria or need user input on approval thresholds, use the `vscode_askQuestions` tool to ask clarifying questions.

---

# Redraft Round 1

## Phase 5: Restore V2 suffix across all design documents (issues #1, #6)

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`, `07-docs.md`, `08-risks.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 2
- **Review issues**: #1, #6

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md`.
Your assigned issues: **#1** (naming deviations without ADR) and **#6** (V2 suffix must be preserved).

**Context**: V1 and V2 coexist as unstable exports. The V2 suffix is mandatory to distinguish them. The design incorrectly dropped the V2 suffix from public API names and incorrectly claimed in `05-usecases.md` that "Naming follows v0.1 docs: `createCache` (not `createApi`)" — whereas v0.1 docs actually use `createApi`.

**Your tasks:**

1. **Restore V2 suffix** on ALL public-facing names across ALL 8 design documents. Specifically:
   - `createCache` → `createCacheV2` (or restore to `createApiV2` if that's what v0.1 docs use — check `docs/query-v2/v0.1/` to confirm the canonical name)
   - `createResource` → `createResourceV2`
   - `createOperation` → `createOperationV2`
   - `useResource` → `useResourceV2`
   - `useOperation` → `useOperationV2`
   - `useResourceAgent` → `useResourceV2Agent`
   - `IResource` → `IResourceV2` (and all related interfaces: `IResourceCacheEntry` → `IResourceV2CacheEntry`, etc.)
   - `IOperation` → `IOperationV2` (and related types)
   - Any other public type/function that was renamed to drop V2 — check v0.1 docs for the canonical names
   - **Internal types** that are not exported publicly may optionally keep shorter names, but all public API names must have V2 suffix

2. **Add ADR-16** to `04-decisions.md` documenting the V2 naming convention:
   - Status: Accepted
   - Context: V1 and V2 modules coexist as unstable exports; consumers import from both
   - Decision: All V2 public API names carry "V2" suffix to avoid ambiguity with V1 exports
   - Consequences: Slightly longer names; clear distinction; suffix can be dropped when V1 is deprecated

3. **Fix `05-usecases.md` header** — remove the incorrect claim about naming following v0.1 docs with `createCache`. Update header to accurately reflect the naming convention.

**Files to read first:**
- `docs/query-v2/v0.1/` — ALL files, to identify the canonical V2 names from the specification
- All 8 design documents in this directory (01 through 08)

**Constraint**: Be thorough — search every document for occurrences of the old (V2-suffix-dropped) names and replace them. Missing even one creates an inconsistency. Do NOT change internal-only type names that are not part of the public API surface.

If you encounter ambiguity or need user input on any naming decision, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 6: Fix ArgsOrVoid, MachinePending diagram, module dependency, and ResourceV2CacheEntry diagrams (issues #2, #3, #4, #5)

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `03-model.md`, `05-usecases.md`
- **Depends on**: 5
- **Retry limit**: 2
- **Review issues**: #2, #3, #4, #5

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md`.
Your assigned issues: **#2**, **#3**, **#4**, **#5**.

Phase 5 has already restored V2 suffixes across all documents. You are working on the post-V2-naming versions of the files.

**Affected files**: `01-architecture.md`, `03-model.md`, `05-usecases.md`

**Issue #2 — `ArgsOrVoid` not applied to IResourceV2 methods** (Low):
- Location: `03-model.md` §7.2 (IResourceV2 interface), `05-usecases.md` UC-16
- Problem: Void-args ergonomic overloads (`ArgsOrVoid`, `ArgsOrVoidOrSkip`) are applied to React hooks and `Agent.start()`, but `IResourceV2` methods (`invalidate`, `getEntry`, `getEntry$`, `compareArgs`, `getSerializedKey`) still use `args: TArgs`, requiring manual casting when `TArgs = void`.
- Fix: Apply the same `ArgsOrVoid<TArgs>` pattern to all public-facing `IResourceV2` methods that accept `TArgs`. Use TypeScript method overloading or conditional parameter patterns consistent with how hooks already handle this. Update UC-16 in `05-usecases.md` to show the improved ergonomics (no cast needed for void args).

**Issue #3 — MachinePending class diagram generic mismatch** (Low):
- Location: `01-architecture.md` §5.1, Mermaid classDiagram
- Problem: `MachinePending~TData~` shows an `args: TArgs` field, but the class only has `<TData>` generic — `TArgs` is not available at the class level.
- Fix: Either change the field to `args: unknown` in the diagram, or add a note/comment explaining that `TArgs` is recovered at the Resource level. Choose whichever is more accurate to the actual design in `03-model.md`.

**Issue #4 — Snapshot → Resource dependency in Module Dependency Diagram** (User feedback):
- Location: `01-architecture.md`, module dependency diagram (Mermaid)
- Problem: The diagram shows Snapshot depending on Resource, which is wrong or misleading. Snapshot should not depend on Resource.
- Fix: Remove or correct the Snapshot → Resource dependency arrow. Consult the architecture description in `01-architecture.md` to determine the correct dependency direction. Snapshot should depend on core primitives (Machine, CacheEntry), not on Resource directly.

**Issue #5 — ResourceV2CacheEntry not on diagrams** (User feedback):
- Location: `01-architecture.md` (class/component diagrams)
- Problem: `ResourceV2CacheEntry` (the consumer-facing cache entry wrapper per ADR-4) is absent from the architecture diagrams.
- Fix: Add `ResourceV2CacheEntry` to the appropriate class hierarchy or component diagram in `01-architecture.md`. Show its relationship to the internal `CacheEntry` and how it's consumed by the public API. Keep diagrams within the 15-20 element limit — split if needed.

**Files to read first:**
- `01-architecture.md`, `03-model.md`, `05-usecases.md` (the current versions, after Phase 5 naming fixes)
- `04-decisions.md` ADR-4 (CacheEntry boundary) for issue #5 context

**Constraints:**
- Fix ONLY the four listed issues — no scope creep.
- Maintain all Mermaid diagram conventions: titled, ≤ 15-20 elements, valid syntax.
- Ensure type changes in `03-model.md` are consistent with usage in `05-usecases.md`.

If you encounter ambiguity or need user input on any fix, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 7: Re-review after Redraft Round 1

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 5, 6
- **Retry limit**: 2

### Prompt

Re-review all design documents after Redraft Round 1 fixes. Phase 5 restored V2 suffixes and added ADR-16. Phase 6 fixed ArgsOrVoid on IResourceV2 methods, MachinePending diagram generic, module dependency diagram, and added ResourceV2CacheEntry to diagrams.

**Read ALL design documents in this directory:**
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

**Read REVIEW.md** at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md` — verify each of the 6 issues has been resolved:

1. V2 suffix restored on all public API names + ADR-16 added
2. `ArgsOrVoid` applied to IResourceV2 methods
3. MachinePending diagram generic fixed
4. Snapshot → Resource dependency corrected
5. ResourceV2CacheEntry added to diagrams
6. V2 suffix preserved (same as #1)

**Also verify** that the fixes didn't introduce new inconsistencies:
- V2 suffixes are applied consistently (no mix of old and new names)
- Type changes in `03-model.md` match usage in `05-usecases.md` and test cases in `06-testcases.md`
- New ADR-16 is properly numbered and formatted
- Diagrams remain valid Mermaid with ≤ 15-20 elements

**Read research documents for full context:**
- `../01-research/README.md`
- V0.1 docs: `docs/query-v2/v0.1/` — all files

**Apply the same 12 review criteria from Phase 4.** Focus especially on criteria #3 (internal consistency), #5 (V0.1 doc alignment), and #10 (documentation proportionality).

**Update `README.md`** with the review results. Set status to "Approved" if all 6 issues are resolved and no new Critical/High issues. Set to "Not Approved" if problems remain. Update the Quality Review checklist and Issues Found sections.

If you encounter ambiguity or need user input on approval, use the `vscode_askQuestions` tool to ask clarifying questions.

---

# Redraft Round 2

## Phase 8: Add createApiV2 and ReactHooksPlugin to architecture; fix PL06 wording

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
- **Depends on**: 5, 6, 7
- **Retry limit**: 2
- **Review issues**: User feedback items (createApiV2, ReactHooksPlugin), Reviewer issue #1 (PL06 wording)

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md`.

You are fixing **three gaps** identified after the second review cycle:

---

**Gap A — `createApiV2` is missing from the architecture.**

`createApiV2` is the primary entry-point factory for the query-v2 module. According to the v0.1 documentation (`docs/query-v2/v0.1/` — read ALL files there), it is the main factory that users call to create an API instance, which in turn provides `createResourceV2`, `createOperationV2`, shared cache, and plugin registration.

Currently, the design documents mention `createApiV2` in some places (e.g., use cases) but it is **not** explicitly modeled as a core architectural component. You must:

1. **`01-architecture.md`**: Add `createApiV2` to the C4 diagrams and module dependency diagrams. It should appear in the `api/` layer as the top-level factory that composes cache, resource factory, operation factory, and plugin system. Show its relationships to other components.
2. **`02-dataflow.md`**: Add a sequence diagram (or extend an existing one) showing the `createApiV2` initialization flow: how it creates the shared cache, registers plugins, and returns the API object with bound factories.
3. **`03-model.md`**: Ensure `createApiV2` factory signature is fully defined — input options type, return type (the API instance interface with its methods), and how plugins augment the return type via declaration merging. If the type already exists, verify it's complete. If it's missing or incomplete, add it.
4. **`04-decisions.md`**: If there's no ADR covering the "single API instance as entry point" pattern, add one (next available ADR number). If an existing ADR already covers this indirectly, ensure it explicitly mentions `createApiV2`.
5. **`05-usecases.md`**: Verify that use cases show `createApiV2` as the standard way users set up the module. If they already do, no changes needed. If any use case uses `createResourceV2` / `createOperationV2` standalone without going through the API instance, ensure there's at least one primary use case that shows the canonical `createApiV2` flow.

---

**Gap B — `ReactHooksPlugin` is missing from the architecture.**

According to v0.1 documentation, React hooks integration is delivered via a **plugin** (`ReactHooksPlugin`), not as standalone hook functions. This means `useResourceV2Agent` (and potentially other React hooks) are contributed to the resource/operation instances by the plugin, not imported separately.

You must:

1. **`01-architecture.md`**: Add `ReactHooksPlugin` to the architecture diagrams. Show it in the `react/` layer (or `plugins/` layer — check v0.1 docs for placement). Show how it plugs into the API instance via the plugin system, and how it augments resource/operation instances with React hook methods.
2. **`02-dataflow.md`**: Add or extend a diagram showing the ReactHooksPlugin registration flow and how it attaches hooks to resource/operation instances. Show the lifecycle: plugin registers → user creates resource → plugin's `augmentResource()` adds `useResourceV2Agent` method → user calls `resource.useResourceV2Agent()` in React component.
3. **`03-model.md`**: Ensure `ReactHooksPlugin` type is fully defined — the plugin interface, hook signatures it contributes, declaration merging it performs on `IResourceV2` / `IOperationV2`. Verify consistency with the plugin types from ADR-9.
4. **`05-usecases.md`**: Verify that at least one use case shows: (a) registering `ReactHooksPlugin` via `createApiV2`, and (b) using the plugin-contributed hooks on a resource/operation instance. Fix any use case that shows React hooks as standalone imports if that contradicts v0.1 docs.
5. **`06-testcases.md`**: Verify plugin test cases (PL category) adequately cover `ReactHooksPlugin`. Fix PL06 wording per reviewer issue #1 — check v0.1 docs to determine whether `useOperationV2` is a plugin-contributed method on the operation instance or a standalone hook, and update the test case description to be precise.

---

**Gap C — PL06 wording ambiguity (Reviewer issue #1).**

In `06-testcases.md`, test case PL06 says "ReactHooksPlugin contributes `useResourceV2Agent` and `useOperationV2` methods". Check v0.1 docs to determine the actual plugin contribution surface:
- Does the plugin contribute hooks on operations via `augmentOperation()`?
- Or is `useOperationV2` a standalone hook only?

Update PL06 to accurately reflect the v0.1 specification. This is addressed as part of Gap B item 5 above.

---

**Files to read first (in order):**
1. `docs/query-v2/v0.1/` — ALL files; this is the source of truth for `createApiV2` and `ReactHooksPlugin`
2. All design documents in this directory: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
3. REVIEW.md in this directory

**Constraints:**
- All Mermaid diagrams must remain titled and within the 15-20 element limit. Split diagrams if adding components pushes past the limit.
- Maintain V2 suffix convention (ADR-16) on all new names.
- All new types must use `<TArgs, TData>` generics only — no TError.
- Do NOT restructure existing content. Add the missing components into the existing document structure.
- Be thorough: `createApiV2` and `ReactHooksPlugin` should be as well-integrated into the design as `ResourceV2` and `OperationV2` already are — they are not peripheral; they are central to how users interact with the module.

If you encounter ambiguity about the v0.1 specification or need user input on any design question, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 9: Re-review after Redraft Round 2

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 8
- **Retry limit**: 2

### Prompt

Re-review all design documents after Redraft Round 2. Phase 8 added `createApiV2` and `ReactHooksPlugin` as first-class architectural components and fixed PL06 wording.

**This is the third review cycle. Previous reviews missed significant architectural gaps. You MUST be thorough and systematic this time.**

**Read ALL design documents in this directory:**
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

**Read the source of truth — this is MANDATORY, not optional:**
- `docs/query-v2/v0.1/` — read ALL files. Enumerate every public API name, every type, every factory, every plugin, every hook mentioned in v0.1 docs. Then cross-check against the design documents to ensure nothing is missing.

**Read research documents:**
- `../01-research/README.md`
- `../01-research/01-codebase-query-v2.md`
- `../01-research/02-codebase-query-v1.md`
- `../01-research/04-open-questions.md`

**Read REVIEW.md** (current) to verify Redraft Round 2 issues are resolved:
- Gap A: `createApiV2` now appears in architecture diagrams, data flows, domain model, decisions, and use cases
- Gap B: `ReactHooksPlugin` now appears in architecture diagrams, data flows, domain model, and use cases
- Gap C: PL06 wording is accurate per v0.1 docs

**Specific verification steps (do ALL of these):**

1. **Completeness audit against v0.1 docs**: List every public-facing concept from v0.1 documentation (factories, types, interfaces, plugins, hooks, options). For each one, verify it appears in the design documents. Report any that are missing.

2. **`createApiV2` integration check**: Verify `createApiV2` is:
   - In at least one C4 or module dependency diagram in `01-architecture.md`
   - Has an initialization sequence diagram in `02-dataflow.md`
   - Has a complete factory signature and return type in `03-model.md`
   - Is the primary entry point shown in use cases in `05-usecases.md`

3. **`ReactHooksPlugin` integration check**: Verify `ReactHooksPlugin` is:
   - In architecture diagrams in `01-architecture.md`
   - Has a registration/usage flow in `02-dataflow.md`
   - Has type definitions in `03-model.md`
   - Is shown in use cases with plugin registration and hook usage in `05-usecases.md`
   - Has adequate test coverage in `06-testcases.md`

4. **Apply ALL 12 review criteria from Phase 4** (research traceability, ADR completeness, internal consistency, Mermaid conformance, v0.1 alignment, completeness, open questions resolved, user decisions honored, test-risk coverage, docs proportionality, no implementation code, feasibility).

5. **Cross-document consistency**: Verify that names, types, and relationships are consistent across ALL 8 documents. Spot-check at least 5 specific types/components to ensure they match between `03-model.md`, `01-architecture.md`, and `05-usecases.md`.

**Update `README.md`** with:

```yaml
---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-23
status: <"Approved" or "Not Approved">
feature: "Full implementation of query-v2 module with tests"
research: "../01-research/"
---
```

Include:
- Updated **Documents** table (if descriptions changed)
- Updated **Key Decisions** table (if new ADRs were added)
- Updated **Quality Review** section with all 12 criteria — pass/fail with specific notes
- **Redraft Round 2 Resolution** table verifying each gap (A, B, C) is resolved
- **Issues Found**: any remaining problems with severity and location
- Set status to "Approved" only if ALL of these are true:
  - No Critical or High issues
  - `createApiV2` is fully integrated
  - `ReactHooksPlugin` is fully integrated
  - v0.1 completeness audit passes (no missing public concepts)

If issues remain, set status to "Not Approved" and list them clearly.

If you encounter ambiguity or need user input on approval, use the `vscode_askQuestions` tool to ask clarifying questions.

---

# Redraft Round 3

## Phase 10: Rename `createApiV2` → `createApi` across all documents; add `hydrateSnapshot()` to model

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`, `07-docs.md`, `08-risks.md`
- **Depends on**: 8, 9
- **Retry limit**: 2
- **Review issues**: User feedback (createApiV2 → createApi naming), Reviewer issue #1 (hydrateSnapshot signature)

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md`.

You are fixing **two issues** identified in the third review cycle.

---

**Issue A — Rename `createApiV2` → `createApi` (User feedback — PRIORITY)**

The user explicitly states: the top-level API factory is **`createApi`**, NOT `createApiV2`. The V2 suffix convention (ADR-16) applies to resource/operation/hook names that coexist with V1 counterparts, but it was **over-applied** to the factory function. The factory is just `createApi` — it creates a query-v2 API instance, but the factory name itself carries no suffix.

You must:

1. **Rename `createApiV2` → `createApi`** in ALL 8 design documents. This is a global rename — search every document for `createApiV2` (including Mermaid diagrams, code examples, prose, type definitions, ADR text) and replace with `createApi`.

2. **Rename `ICreateApiV2Options` → `ICreateApiOptions`** — the options type follows the factory name.

3. **Rename `IApiV2` → `IApi`** — the return type follows the factory name.

4. **Update ADR-16** in `04-decisions.md` to explicitly document this exception:
   - Add a clarification that `createApi`, `ICreateApiOptions`, and `IApi` are **exceptions** to the V2 suffix rule. The factory is the entry point into the V2 module, but since there is no V1 `createApi` to collide with, the suffix is unnecessary and was intentionally omitted.
   - Keep the existing ADR-16 content about V2 suffix convention — only add the exception clause.

5. **Update ADR-17** (if it references `createApiV2` as the single API instance entry point) — rename to `createApi` there as well.

6. **Verify `TApiSnapshot`** — if there is a `TApiV2Snapshot` or similar type tied to the API factory, rename consistently. If it's `TApiSnapshot` already, leave it.

**Important**: Only `createApi` / `ICreateApiOptions` / `IApi` lose the V2 suffix. Everything else keeps V2:
- `createResourceV2`, `createOperationV2` — KEEP V2
- `useResourceV2`, `useOperationV2`, `useResourceV2Agent` — KEEP V2
- `IResourceV2`, `IOperationV2`, `IResourceV2CacheEntry` — KEEP V2
- `ReactHooksPlugin` — no V2 suffix (it never had one)

---

**Issue B — Add `hydrateSnapshot()` standalone function signature to model (Reviewer issue #1)**

Architecture §7.1 lists `hydrateSnapshot()` as a public runtime export. Dataflow §3.1 and ADR-8 describe its behavior. However, `03-model.md` does not include the standalone `hydrateSnapshot()` function signature.

You must:

1. **Add to `03-model.md`** (in section §13 or as new §13.3): a `declare function hydrateSnapshot(api: IApi, snapshot: TApiSnapshot): void;` signature (use the new `IApi` name, not `IApiV2`).
2. Ensure the signature is consistent with the hydration behavior described in `02-dataflow.md` §3.1 and `04-decisions.md` ADR-8.

---

**Files to read first (in order):**
1. All 8 design documents in this directory: `01-architecture.md` through `08-risks.md`
2. `04-decisions.md` — specifically ADR-16 and ADR-17
3. `02-dataflow.md` §3.1 and `04-decisions.md` ADR-8 (for hydrateSnapshot context)

**Constraints:**
- Fix ONLY the two listed issues — no scope creep.
- Be exhaustive with the rename: grep mentally through every document section, every Mermaid diagram, every code block, every type reference. Missing even one `createApiV2` creates an inconsistency.
- Maintain all Mermaid diagram conventions: titled, ≤ 15-20 elements, valid syntax.
- The user's exact words in the review: "Нет. что за `createApiV2`, везде указывалось `createApi`. Все еще слобо... (так и всатавь)" — include this verbatim in the ADR-16 amendment as user context, preserving the original Russian text.

If you encounter ambiguity or need user input on any naming decision, use the `vscode_askQuestions` tool to ask clarifying questions.

---

## Phase 11: Re-review after Redraft Round 3

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 10
- **Retry limit**: 2

### Prompt

Re-review all design documents after Redraft Round 3. Phase 10 renamed `createApiV2` → `createApi` (and related types `IApiV2` → `IApi`, `ICreateApiV2Options` → `ICreateApiOptions`) across all documents, updated ADR-16 with the exception clause, and added the `hydrateSnapshot()` standalone function signature to `03-model.md`.

**This is the fourth review cycle. Previous reviews have repeatedly missed issues. You MUST be exceptionally thorough and systematic.**

**Read ALL design documents in this directory:**
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

**Read the source of truth — MANDATORY:**
- `docs/query-v2/v0.1/` — read ALL files

**Read REVIEW.md** at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md` — verify Round 3 issues are resolved:

1. **`createApiV2` → `createApi` rename**: Search ALL 8 documents for any remaining `createApiV2`, `ICreateApiV2Options`, or `IApiV2` references. There must be ZERO remaining — every occurrence must now be `createApi`, `ICreateApiOptions`, `IApi`. Check prose, code blocks, Mermaid diagrams, type definitions, ADR text, use case examples, test case descriptions.
2. **ADR-16 exception**: Verify ADR-16 now explicitly documents that `createApi`/`ICreateApiOptions`/`IApi` are exceptions to the V2 suffix convention, with clear rationale.
3. **`hydrateSnapshot()` signature**: Verify it appears in `03-model.md` with correct parameter types (using `IApi`, not `IApiV2`), and is consistent with `02-dataflow.md` §3.1 and ADR-8.
4. **V2 suffixes preserved where required**: Spot-check that `createResourceV2`, `createOperationV2`, `useResourceV2`, `useOperationV2`, `useResourceV2Agent`, `IResourceV2`, `IOperationV2`, `IResourceV2CacheEntry` still retain their V2 suffixes. The rename was ONLY for the API factory and its direct types.

**Specific verification checklist (do ALL):**

- [ ] Zero occurrences of `createApiV2` across all 8 documents
- [ ] Zero occurrences of `ICreateApiV2Options` across all 8 documents
- [ ] Zero occurrences of `IApiV2` across all 8 documents
- [ ] ADR-16 has exception clause for `createApi`/`ICreateApiOptions`/`IApi`
- [ ] `hydrateSnapshot()` signature in `03-model.md`
- [ ] `hydrateSnapshot()` uses `IApi` (not `IApiV2`) as parameter type
- [ ] V2 suffixes intact on all other public API names (spot-check 5+ types)
- [ ] Mermaid diagrams updated (no `createApiV2` in any diagram)
- [ ] Use case code examples use `createApi` (not `createApiV2`)
- [ ] Test case descriptions use `createApi` (not `createApiV2`)

**Apply ALL 12 review criteria from Phase 4.** Pay special attention to:
- Criteria #3 (internal consistency) — the rename must be consistent everywhere
- Criteria #5 (V0.1 doc alignment) — `createApi` matches v0.1 docs
- Criteria #6 (completeness) — `hydrateSnapshot()` now fills the last known gap

**V0.1 completeness audit (repeat from Phase 9):**
Enumerate every public-facing concept from v0.1 docs. Cross-check against design documents. Report any missing items.

**Update `README.md`** with:

```yaml
---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-23
status: <"Approved" or "Not Approved">
feature: "Full implementation of query-v2 module with tests"
research: "../01-research/"
---
```

Include:
- Updated **Documents** table reflecting `createApi` naming
- Updated **Key Decisions** table reflecting ADR-16 amendment
- **Redraft Round 3 Resolution** table verifying both issues
- **Quality Review** section with all 12 criteria — pass/fail with specific notes
- **Issues Found**: any remaining problems with severity and location
- Set status to "Approved" only if:
  - Zero remaining `createApiV2`/`IApiV2`/`ICreateApiV2Options` references
  - `hydrateSnapshot()` signature present and correct
  - No Critical or High issues
  - V0.1 completeness audit passes

If issues remain, set status to "Not Approved" and list them clearly.

If you encounter ambiguity or need user input on approval, use the `vscode_askQuestions` tool to ask clarifying questions.

---

# Redraft Round 4

## Phase 12: Redesign CacheEntry / ResourceV2CacheEntry hierarchy, trim IResourceV2, fix Mermaid syntax, fix §16 naming

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
- **Depends on**: 10, 11
- **Retry limit**: 2
- **Review issues**: User feedback items #1–#5 from Redraft Round 4

### Prompt

Read REVIEW.md at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md`.

You are fixing **five interconnected issues** identified in the fourth review cycle. Issues #1, #2, and #4 form a coherent hierarchy redesign; #3 and #5 are mechanical fixes in affected files.

---

**Issue #1 — ResourceV2CacheEntry is poorly integrated into the class hierarchy**

The current design has something like `ResourceV2CacheEntry implements IResourceV2CacheEntry extends CacheEntry`. This relationship is wrong or poorly thought out. You must rethink how `ResourceV2CacheEntry` relates to `CacheEntry`.

Before making changes, read the v0.1 documentation (`docs/query-v2/v0.1/` — ALL files) and `04-decisions.md` ADR-4 (CacheEntry abstraction boundary) to understand the *intended* relationship. Then read the *current* `03-model.md` to see what was actually designed.

Key design question: Is `ResourceV2CacheEntry` a **wrapper around** CacheEntry (composition), or does it **extend** CacheEntry (inheritance)? The answer depends on what CacheEntry represents:
- If CacheEntry is a low-level reactive data container (signals for data, error, status), then ResourceV2CacheEntry should **compose** it (has-a CacheEntry) and add Resource-level concerns on top.
- If CacheEntry is meant to be extended per-resource, then inheritance may be correct — but then CacheEntry must be designed as a proper base class.

Consult v0.1 docs to determine which pattern aligns with the specification. Redesign the relationship accordingly in `03-model.md` and update `01-architecture.md` diagrams.

---

**Issue #2 — CacheEntry must NOT contain `machine$()`**

`CacheEntry` is currently designed with a `machine$()` field (or signal). This is wrong. CacheEntry is a **lower-level cache primitive** — it stores reactive data (data$, error$, status$, timestamps, etc.) but should NOT have knowledge of state machines. The state machine (`MachineIdle`, `MachinePending`, etc.) is a **Resource-level concern** — it belongs on the Resource or ResourceV2CacheEntry, not on the raw CacheEntry.

You must:
1. **Remove `machine$()` from CacheEntry** in `03-model.md`. CacheEntry should only contain low-level reactive storage (data signal, error signal, status flags, timestamps, refcount, etc.).
2. **Move machine responsibility** to the appropriate higher level — likely `ResourceV2CacheEntry` or `ResourceV2Agent` (depending on where the state machine lives in the architecture). Check `01-architecture.md` and `04-decisions.md` ADR-2 (state machine approach) to determine the correct owner.
3. **Update `02-dataflow.md`** if any cache data flow diagrams show `machine$` inside CacheEntry — move it to the correct component.
4. **Update `01-architecture.md`** class hierarchy diagrams to reflect the corrected CacheEntry contents.

---

**Issue #3 — Mermaid diagrams in `02-dataflow.md` §6 "Cache Data Flow" have parsing errors**

Section 6 of `02-dataflow.md` contains Mermaid diagrams that are syntactically invalid and cannot be rendered. These are diagrams about the cache write path, read path, invalidation, and/or GC flow.

You must:
1. Read `02-dataflow.md` section 6 carefully.
2. Fix ALL Mermaid syntax errors. Common Mermaid issues: invalid node IDs (must not start with numbers or contain special chars), missing arrow syntax, unclosed brackets, graph direction not declared, subgraph nesting errors, invalid sequence diagram participant names.
3. Since issues #1 and #2 change the cache hierarchy, the diagram *content* may also need updating — ensure the fixed diagrams reflect the redesigned CacheEntry/ResourceV2CacheEntry split.
4. Diagrams must follow conventions: titled, max 15-20 elements, valid Mermaid syntax.

---

**Issue #4 — IResourceV2 contains junk fields not specified in v0.1 docs**

The current `IResourceV2` interface in `03-model.md` has many fields whose use cases are unclear and which are NOT specified in the v0.1 documentation.

You must:
1. Read `docs/query-v2/v0.1/` — ALL files. Identify which fields/methods the v0.1 docs actually specify for the Resource interface.
2. Read the current `IResourceV2` in `03-model.md`.
3. **Remove any field** from `IResourceV2` that is NOT in v0.1 docs AND does not have a clear use case justified by an ADR or by the architecture design.
4. If a field is needed but missing from v0.1 docs, it must have an ADR or a clear architectural justification noted in a comment. If it has neither, remove it.
5. Update `05-usecases.md` if any use case references a removed field.
6. Update `06-testcases.md` if any test case references a removed field.

**Be conservative**: when in doubt about whether a field is needed, ask the user via `vscode_askQuestions` rather than silently keeping it.

---

**Issue #5 — `TResourceSnapshotSlice` → `TResourceV2SnapshotSlice` in §16 summary table** (Low)

In `03-model.md` §16, the summary table lists `TResourceSnapshotSlice` without the V2 suffix. Per ADR-16, this should be `TResourceV2SnapshotSlice` (which is how it's defined in §11). Fix the name in the §16 table.

---

**Files to read first (in order):**
1. `docs/query-v2/v0.1/` — ALL files; this is the source of truth for what IResourceV2 should contain and how CacheEntry/ResourceV2CacheEntry should relate
2. `03-model.md` — current type definitions (especially CacheEntry, ResourceV2CacheEntry, IResourceV2CacheEntry, IResourceV2, machine types, §16 summary table)
3. `01-architecture.md` — class hierarchy and component diagrams showing CacheEntry/ResourceV2CacheEntry
4. `02-dataflow.md` — section 6 (Cache Data Flow) with the broken Mermaid diagrams
5. `04-decisions.md` — ADR-2 (state machines), ADR-4 (CacheEntry boundary), ADR-16 (V2 naming)
6. `05-usecases.md` — for consistency with type changes
7. `06-testcases.md` — for consistency with type changes

**Constraints:**
- Fix ONLY the five listed issues — no scope creep.
- The redesigned CacheEntry must be purely a low-level reactive data container — no machine, no Resource-level logic.
- ResourceV2CacheEntry's relationship to CacheEntry must be clear (composition vs inheritance) and justified.
- All Mermaid diagrams must be titled, ≤ 15-20 elements, and syntactically valid.
- V0.1 docs are the source of truth for IResourceV2 fields. Remove anything not justified.
- Maintain V2 suffix convention (ADR-16) on all public names.
- All types use `<TArgs, TData>` generics only — no TError.

If you encounter ambiguity or need user input on ANY design question (especially the CacheEntry/ResourceV2CacheEntry relationship or whether to keep/remove specific IResourceV2 fields), use the `vscode_askQuestions` tool to ask clarifying questions. Do not guess — ask.

---

## Phase 13: Re-review after Redraft Round 4

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 12
- **Retry limit**: 2

### Prompt

Re-review all design documents after Redraft Round 4. Phase 12 redesigned the CacheEntry/ResourceV2CacheEntry hierarchy (removing `machine$()` from CacheEntry, clarifying the relationship between CacheEntry and ResourceV2CacheEntry), trimmed junk fields from IResourceV2 to match v0.1 docs, fixed Mermaid syntax errors in `02-dataflow.md` §6, and fixed the `TResourceSnapshotSlice` → `TResourceV2SnapshotSlice` naming in `03-model.md` §16.

**This is the fifth review cycle. Be exceptionally thorough.**

**Read ALL design documents in this directory:**
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

**Read the source of truth — MANDATORY:**
- `docs/query-v2/v0.1/` — read ALL files

**Read REVIEW.md** at `.thoughts/2026-03-23-1400_query-v2-full-implementation/02-design/REVIEW.md` — verify Redraft Round 4 issues are resolved:

1. **CacheEntry no longer contains `machine$()`**: Verify CacheEntry in `03-model.md` is purely a low-level reactive data container. No machine-related fields. Check `01-architecture.md` diagrams too.
2. **ResourceV2CacheEntry properly relates to CacheEntry**: Verify the relationship (composition or inheritance) is clearly defined, consistent between `03-model.md` and `01-architecture.md`, and aligns with ADR-4. The pattern must be architecturally sound.
3. **Mermaid diagrams in `02-dataflow.md` §6 are valid**: Copy each Mermaid diagram from section 6 and verify it has no syntax errors. Check: valid node IDs, proper arrow syntax, closed brackets, correct graph/flowchart declarations, valid subgraph nesting.
4. **IResourceV2 contains only v0.1-specified fields**: Cross-check every field in IResourceV2 against v0.1 documentation. Any field not in v0.1 must have an explicit ADR or architectural justification. Flag any unexplained fields.
5. **`TResourceV2SnapshotSlice`** in §16 summary table: Verify the V2 suffix is now present.

**Specific verification steps:**

- [ ] CacheEntry has NO machine-related fields (`machine$`, `machine`, `getMachine`, etc.)
- [ ] ResourceV2CacheEntry's relation to CacheEntry is clearly documented (composition vs inheritance)
- [ ] The class/interface hierarchy in `01-architecture.md` matches `03-model.md` type definitions
- [ ] ALL Mermaid diagrams in `02-dataflow.md` §6 render without syntax errors
- [ ] Every field in IResourceV2 is traceable to v0.1 docs or an ADR
- [ ] `03-model.md` §16 uses `TResourceV2SnapshotSlice` (not `TResourceSnapshotSlice`)
- [ ] Changes to CacheEntry/ResourceV2CacheEntry are consistent across all 8 documents
- [ ] Use cases in `05-usecases.md` still work with the trimmed IResourceV2
- [ ] Test cases in `06-testcases.md` still reference valid types and fields

**Apply ALL 12 review criteria from Phase 4.** Pay special attention to:
- Criteria #3 (internal consistency) — hierarchy changes must be consistent everywhere
- Criteria #4 (Mermaid conformance) — fixed diagrams must be valid
- Criteria #5 (V0.1 doc alignment) — IResourceV2 must now match v0.1 closely
- Criteria #6 (completeness) — ensure nothing important was accidentally removed

**V0.1 completeness audit (repeat):** Enumerate every public-facing concept from v0.1 docs. Cross-check against design documents. Report any missing items.

**Update `README.md`** with:

```yaml
---
title: "Design: Full implementation of query-v2 module"
date: 2026-03-23
status: <"Approved" or "Not Approved">
feature: "Full implementation of query-v2 module with tests"
research: "../01-research/"
---
```

Include:
- **Redraft Round 4 Resolution** table verifying all 5 issues
- Updated **Quality Review** section with all 12 criteria — pass/fail with notes
- **Issues Found**: any remaining problems with severity and location
- Set status to "Approved" only if:
  - CacheEntry is clean (no machine knowledge)
  - ResourceV2CacheEntry hierarchy is sound
  - IResourceV2 matches v0.1 docs
  - Mermaid diagrams are valid
  - No Critical or High issues

If issues remain, set status to "Not Approved" and list them clearly.

If you encounter ambiguity or need user input on approval, use the `vscode_askQuestions` tool to ask clarifying questions.

---
