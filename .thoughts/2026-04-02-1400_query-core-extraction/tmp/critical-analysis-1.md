---
title: "Open Questions: Query Core Extraction"
date: 2026-04-02
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: What exactly is "core extraction" — shared base class, mixin, or composition?

**Context**: The research documents ~78 lines of duplication between `ResourceCacheEntry` and `CommandCacheEntry` (abort, lifecycle resolvers, `_fireCacheEntryAdded`, `complete()` cleanup). But the TASK.md says "extract the core logic from Resource so it can be reused by Commands." This is ambiguous — does it mean:
- (a) Make `CacheEntry` richer (push shared code down into the existing base class)
- (b) Create a new intermediate `FetchableCacheEntry` between `CacheEntry` and the two subclasses
- (c) Use mixins/composition instead of inheritance
- (d) Extract a standalone "fetch engine" that both entries delegate to

**Options**:
1. Enrich `CacheEntry` — Pros: minimal structural change, no new classes / Cons: `CacheEntry` becomes tightly coupled to fetch lifecycle; breaks SRP; harder to reuse CacheEntry for non-fetch scenarios
2. New `FetchableCacheEntry` intermediate — Pros: clean separation / Cons: deeper hierarchy (3 levels); `_fireCacheEntryAdded` args divergence makes generics messy
3. Composition (inject a `FetchEngine` object) — Pros: no inheritance tax, testable in isolation / Cons: more wiring boilerplate, breaks current field-access patterns
4. Mixins — Pros: flexible / Cons: TypeScript mixin ergonomics are awkward, debugging harder

**Risks**: Wrong choice locks the architecture into a pattern that fights future entity types (e.g., InfiniteQuery, Subscription)

**Researcher recommendation**: The research leans toward option (a) or (b) based on duplication structure, but doesn't evaluate composability for future entity types.

---

### Q2: What is the actual goal — DRY refactor or enabling new entity types?

**Context**: TASK.md says "extract core logic so it can be reused by Commands." But Commands already exist and work. The duplication is ~78 lines across ~600 total (13%). Is the goal:
- (a) Reduce duplication for maintainability
- (b) Create an abstraction layer that makes adding a 3rd entity type (e.g., InfiniteQuery, Subscription, StreamResource) trivial
- (c) Both

**Options**:
1. Pure DRY refactor — Pros: smaller scope, faster / Cons: may not generalize well to future types
2. Extensibility-first extraction — Pros: future-proof / Cons: risk of premature abstraction; no concrete 3rd entity type requirement exists today
3. DRY now with extensibility hooks — Pros: pragmatic / Cons: "hooks for the future" are often wrong

**Risks**: Over-engineering for hypothetical future entities. Under-engineering if a 3rd entity type is already planned.

**Researcher recommendation**: No research document mentions any planned 3rd entity type. Check CHANGELOG/roadmap.

---

### Q3: How should the divergent `_fireCacheEntryAdded` signatures be unified?

**Context**: Resource passes `(args, tools)` to the callback; Command passes `(tools)` only. The lifecycle types are separate (`TOnCacheEntryAdded` vs `TOnCommandCacheEntryAdded`). This is the biggest blocker for direct extraction of lifecycle code.

**Options**:
1. Generic callback `(context: TContext, tools: TTools)` where Command passes `undefined` context — Pros: unified / Cons: awkward API for Command consumers
2. Keep separate callbacks but extract the PromiseResolver setup into the base — Pros: extracts 80% of duplication / Cons: still 2 implementations of the "fire" part
3. Callback receives a single `tools` object that may optionally contain args — Pros: single type / Cons: breaking change to Resource's `onCacheEntryAdded` API

**Risks**: Any unification changes the public API for lifecycle hooks — breaking change territory

**Researcher recommendation**: Option 2 extracts most duplication while avoiding API breakage. No research document analyzed backward compatibility constraints.

---

### Q4: Should machine hierarchies be unified or left separate?

**Context**: Resource machines share `MachineWithData` abstract base; Command machines are standalone classes. The states map loosely (Pending≈Loading, Success≈Success, Error≈Error) but semantics diverge (Refreshing has no Command equivalent; Idle has no Resource equivalent). `cache-entry-comparison.md` documents the full structural diff.

**Options**:
1. Shared `BaseMachine` with `status`, `args`, `data`, `error` fields — Pros: type-level unification / Cons: forces `null` fields everywhere, weakens discriminated unions
2. Shared interface only (structural typing) — Pros: no runtime coupling / Cons: doesn't actually reduce code
3. Leave separate — Pros: each hierarchy optimized for its entity / Cons: continued divergence

**Risks**: Forcing unification destroys the crisp discriminated union types that consumers rely on for type narrowing

**Researcher recommendation**: TanStack Query and RTK Query both keep query/mutation state machines fully separate. Evidence strongly favors option 3.

---

### Q5: What is the backward compatibility contract?

**Context**: No research document addresses which APIs are public vs internal. If `CacheEntry`, `ResourceCacheEntry`, machine classes, or lifecycle hook types are part of the public API, extraction is a breaking change. The `types/index.ts` barrel re-exports all 12 type modules.

**Options**:
1. All types in `types/` are public — extraction must preserve exact signatures
2. Only `IResource`, `ICommand`, `IApi`, agent state types are public — internals can change freely
3. Semver minor — additions ok, removals need major bump

**Risks**: Accidentally breaking consumers who depend on internal types. No documentation distinguishes public from internal.

**Researcher recommendation**: Missing data. Must audit `src/query/index.ts` exports and `docs/` to determine what's guaranteed public.

---

## Medium Priority

### Q6: What about the Snapshot/SSR system?

**Context**: `shared-infra.md` documents the Snapshot system (`getSnapshot`, `hydrateSnapshot`, `Machine.fromSnapshot`). It only supports Resource — not Command. If extraction creates a shared fetch layer, does the snapshot system need to become entity-agnostic?

**Options**:
1. Leave snapshot Resource-only (Commands are mutations, no SSR state)
2. Make snapshot support pluggable per entity type

**Risks**: If extraction moves `hydrateEntry` logic into shared code, snapshot coupling may break

**Researcher recommendation**: RTK Query's mutations have no snapshot/SSR. TanStack mutations have no hydration. Evidence suggests mutations don't need it. But the research didn't verify Command's relationship to the snapshot code path.

---

### Q7: How does the plugin system interact with extraction?

**Context**: `IPlugin` has separate `augmentResource` and `augmentCommand` methods. `ReactHooksPlugin` augments both independently. If a shared "entity" abstraction is created, does the plugin interface need a unified `augmentEntity` method?

**Options**:
1. Keep separate `augmentResource`/`augmentCommand` (no plugin API change)
2. Add `augmentEntity(entity, type)` alongside existing methods
3. Replace with single `augmentEntity`

**Risks**: Option 3 breaks existing plugins. Option 2 creates redundancy.

**Researcher recommendation**: Only one plugin exists (`ReactHooksPlugin`). But the research didn't check if there's documentation encouraging third-party plugins.

---

### Q8: What test coverage exists for the code being extracted?

**Context**: `command-structure.md` lists 7 test files for Command. `resource-internals.md` doesn't enumerate Resource test files. Neither document maps test coverage to the specific duplicated code paths (abort management, lifecycle resolver cleanup, `_fireCacheEntryAdded`).

**Options**:
1. Extraction-safe — existing tests cover the behavior being moved
2. Extraction-risky — tests are coupled to class structure and will break

**Risks**: Refactoring without knowing test coverage = regressions

**Researcher recommendation**: Missing data. Must audit actual test files for structure-sensitive assertions vs behavior-only assertions.

---

### Q9: What role does the `Batcher` play and is it a shared concern?

**Context**: `cache-entry-comparison.md` notes Command wraps transitions in `Batcher.run()` while Resource does NOT use `Batcher` in `_doFetch`. `Resource.resetCache()` does use `Batcher`. The research doesn't explain what `Batcher` is, when it's needed, or whether a unified fetch path should always batch.

**Options**:
1. Batcher is always needed (add to extracted base)
2. Batcher is optional (caller decides)
3. Batcher is Command-specific (don't extract)

**Risks**: Wrong batching behavior causes glitchy UI updates or breaks signal reactivity

**Researcher recommendation**: Missing data. `Batcher` is not documented in any research file.

---

### Q10: What about the stale-check divergence (controller identity vs signal.aborted)?

**Context**: `cache-entry-comparison.md` §4.3 shows Resource checks `this._abortController !== controller` while Command checks `controller.signal.aborted`. Both are functionally equivalent but have different semantics on stale success/error (Resource propagates, Command swallows).

**Options**:
1. Standardize on `signal.aborted` (simpler, more idiomatic)
2. Standardize on controller identity check (current Resource behavior)
3. Keep divergent (configurable per entity)

**Risks**: Changing Resource's stale-check mechanism could alter error propagation behavior — subtle regression territory

**Researcher recommendation**: Need clarification on whether the divergence is intentional design or accidental drift.

---

## Low Priority

### Q11: Should `ResourceRef` be generalized?

**Context**: `ResourceRef` is a Command-only adapter wrapping `IResource` for linked resource effects (invalidate + patch). If extraction creates a shared fetch layer, linked-entity effects might become a generic concern.

**Options**:
1. Keep Command-only
2. Generalize to `EntityRef` for cross-entity effects

**Risks**: Over-abstraction for a pattern only used by Command→Resource links

**Researcher recommendation**: No evidence of Resource→Command or Command→Command links in the codebase.

---

### Q12: Coverage artifacts from deleted files — should they be cleaned?

**Context**: `shared-infra.md` §12 notes `QueriesCache.ts`, `QueriesLifetimeHooks.ts`, `ResetAllQueriesSignal.ts` exist only in `coverage/` (stale). These might confuse future researchers.

**Risks**: Minimal — but adds noise to the workspace.

**Researcher recommendation**: Cleanup is orthogonal to extraction. Can be done separately.

---

## Research Gaps Identified

### Not explored:
- **`src/query/index.ts` public API surface** — what exactly is exported? This determines backward compatibility scope (Q5)
- **`src/query/__tests__/` integration tests** — structure, coverage of shared paths. Only file names listed, no content analysis (Q8)
- **`Batcher` utility** — definition, usage patterns, when it's needed (Q9). Referenced in findings but never analyzed
- **`src/signals/` dependency surface** — how deeply does the query module depend on the signals layer? Can the extracted core be signal-agnostic? (not asked but relevant)
- **`docs/query/README.md`** — does it document public API guarantees? (Q5)
- **Error message strings** — are lifecycle rejection messages (`"Cache entry removed"`, `"before data loaded"`, `"Query superseded"`) tested or part of the contract?
- **`createResourceDuplicator`** — exists in coverage artifacts, referenced in `src/query/api/`. Not analyzed. May inform extraction patterns
- **DevTools integration** — `_beforeDevtoolsPush` on Resource, `combineDevtools` in shared infra. How does extraction affect devtools observability?
- **`query-v2/` directory in coverage** — what is this? Is there an ongoing v2 rewrite that this extraction should align with?

### Contradictions found:
- **TASK.md says "Do NOT focus on Command implementation details"** but 3 of 7 research files are detailed Command analysis (`command-structure.md`, `cache-entry-comparison.md` partially). The comparison is necessary but the balance is inverted — Resource internals get 1 file, Command gets ~1.5 files of detailed analysis
- **Duplication estimate inconsistency**: `command-structure.md` §8 estimates "40-60 lines" extractable from `_fireCacheEntryAdded` and `complete()`. `cache-entry-comparison.md` §6 totals ~78 lines across all patterns. The numbers don't conflict but the scope differs without explanation
- **`shared-infra.md` says Command machines are "Stub — full implementation in Phase 2"** — if these are stubs, is extracting shared code from stubs premature? Or was "Phase 2" already completed?
- **Line count discrepancies**: `resource-internals.md` says ResourceCacheEntry is ~360 lines; `cache-entry-comparison.md` says ~290 lines; `command-structure.md` says ~300 for CommandCacheEntry. Minor but suggests different file states or counting methods


## Conclusion
Status: success
Artifacts: .thoughts/2026-04-02-1400_query-core-extraction/tmp/critical-analysis-1.md
Summary:
- 5 high-priority questions identified blocking design (extraction strategy, goal scope, API compat, lifecycle sig divergence, machine unification)
- Key research gaps: public API surface audit, Batcher analysis, test structure analysis, query-v2 context
- External research (TanStack, RTK Query) consistently favors minimal shared abstractions between query/mutation types
Escalation: none
Next step: present questions to user for decisions before proceeding to design
