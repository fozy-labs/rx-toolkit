---
title: "Phases: 02-design"
date: 2026-03-30
stage: 02-design
---

# Phases: 02-design

## Phase 1: Architecture + Short Design

- **Agent**: `rdpi-architect`
- **Output**: `01-architecture.md`, `00-short-design.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../TASK.md` — 6 problems
- `../01-research/README.md` — research summary, key findings, contradictions
- `../01-research/01-codebase-analysis.md` — CacheMap internals, devtools key flow, LifecycleHooks chain, demo behavior, test coverage
- `../01-research/02-problem-analysis-cache.md` — problems #1 (Array O(n)) and #2 (doCacheArgs ignored)
- `../01-research/03-problem-analysis-devtools.md` — problems #3 (serialization for compare devtools key) and #4 (double serialization)
- `../01-research/04-problem-analysis-lifecycle-demos.md` — problems #5 (LifecycleHooks shared) and #6 (isError always false)
- `../01-research/05-open-questions.md` — 9 design questions with user feedback

Also read actual source files to understand current architecture:
- `src/query-v2/core/CacheMap/CompareCacheMap.ts`
- `src/query-v2/core/CacheMap/SerializeCacheMap.ts`
- `src/query-v2/core/CacheMap/cache.types.ts`
- `src/query-v2/core/ResourceV2.ts`
- `src/query-v2/core/ResourceV2CacheEntry.ts`
- `src/query-v2/core/LifecycleHooks.ts`

Design the system architecture covering all 6 problems as three change areas:

**Area A — CacheMap + Devtools Keys (problems #1–#4):**
- CompareCacheMap replaces internal `Array<{args, entry}>` with `Map<TArgs, TEntry>`. No comparison-based deduplication, no caching option (per user feedback on Q1, Q2). The `compareArg` function is still used for `has`/`get` fallback or is removed entirely — decide based on the semantics.
- New optional `devtoolsKey` field on `TResourceV2Options` for compare strategy only. Default: monotonic counter (0, 1, 2...). Does not apply to serialize strategy (per user feedback on Q3).
- Eliminate double serialization in serialize strategy: the factory receives the already-computed key from CacheMap, so `SerializeCacheMap.getOrCreate` passes its key to the factory (per Q6 recommendation to solve Q3 and Q6 together via factory signature change `(args, argsKey) => TEntry`).
- `entries()` on `ICacheMap` — evaluate whether it can be removed entirely (user feedback on Q9 suggests it may be unnecessary). If consumers exist, document them.

**Area B — LifecycleHooks (problem #5):**
- Each `ResourceV2CacheEntry` owns and invokes its own lifecycle hooks (per user feedback on Q4). No shared args-keyed Map.
- `onCacheEntryAdded` can still be triggered from the factory/resource level (resource knows when entry is created), but `onQueryStarted`/`$queryFulfilled`/`$cacheDataLoaded`/`$cacheEntryRemoved` are scoped to the entry.
- Audit plugin interactions: check `src/query-v2/plugins/` for any LifecycleHooks dependencies (per Q7).

**Area C — Demo fixes (problem #6):**
- Fix false descriptions and misleading `isError` UI in demo files. Do NOT change queryFn logic (per user feedback on Q8). Identify which demo files display `isError` and what the correct behavior description should be.
- Demo files are in `apps/demos/src/examples/`.

Produce `01-architecture.md` with:
- C4 Level 2–3 diagrams (Mermaid) showing module boundaries for CacheMap, ResourceV2, ResourceV2CacheEntry, LifecycleHooks before and after changes
- Component boundaries: what changes in each module, what stays the same
- Module dependency diagrams showing how the factory signature change affects the dependency chain
- Class/interface hierarchy for the new CacheMap structure
- Sequence diagram for devtools key derivation flow (compare and serialize strategies)
- Preliminary ADRs for each key decision (will be formalized in Phase 4)

Produce `00-short-design.md` per the specification: direction (2–3 paragraphs referencing research), key decisions (up to 7, one sentence each + research ref), scope boundaries (in/out), and research references (3–5 links).

---

## Phase 2: Data Flow

- **Agent**: `rdpi-architect`
- **Output**: `02-dataflow.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`
- `../01-research/01-codebase-analysis.md`
- `../01-research/02-problem-analysis-cache.md`
- `../01-research/03-problem-analysis-devtools.md`
- `../01-research/04-problem-analysis-lifecycle-demos.md`
- `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`
- `01-architecture.md`
- `09-corrections.md` (if exists)

Design data flow for key scenarios across all three change areas. Produce `02-dataflow.md` with:

**CacheMap data flow:**
- Sequence diagram: `Resource.getOrCreate(args)` → `CompareCacheMap.getOrCreate(args)` → `Map.get(args)` → factory call with `(args, argsKey)` → entry creation with devtools key. Show how the monotonic counter increments and how the argsKey reaches `CacheEntry` → `Signal.state({ key })`.
- Sequence diagram: `SerializeCacheMap.getOrCreate(args)` → `_getKey(args)` → `Map.get(key)` → factory call with `(args, key)` → entry creation. Show how double serialization is eliminated.
- State diagram: CompareCacheMap entry lifecycle (create → access → delete). Show Map operations at each transition.
- Data flow for `doCacheArgs` in SerializeCacheMap (unchanged) vs CompareCacheMap (no caching, no `doCacheArgs`).

**LifecycleHooks data flow:**
- Sequence diagram: entry creation → hooks setup → `fireQueryStarted` → fetch → `fireQueryFulfilled`/`fireQueryRejected` → `$queryFulfilled` resolution. All scoped to a single entry instance (no shared Map).
- Sequence diagram: `Resource.resetCache()` → iterate entries → each entry cleans up its own hooks. Compare with current: `Resource.resetCache()` → `LifecycleHooks.clearAll()`.
- State diagram: entry-level hook states (idle → queryStarted → fulfilled/rejected → idle).

**Demo data flow:**
- State diagram: the SWR state machine showing why `isError` stays `false` when first fetch succeeds. Trace `MachinePending → MachineSuccess → refreshing → MachineSuccess(lastError)`.

You have correction authority over `01-architecture.md` and `00-short-design.md`. If you find inaccuracies, fix them in-place and log each correction in `09-corrections.md` per the correction mechanism.

---

## Phase 3: Domain Model

- **Agent**: `rdpi-architect`
- **Output**: `03-model.md`
- **Depends on**: 2
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`
- `../01-research/01-codebase-analysis.md`
- `../01-research/02-problem-analysis-cache.md`
- `../01-research/03-problem-analysis-devtools.md`
- `../01-research/04-problem-analysis-lifecycle-demos.md`
- `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `09-corrections.md` (if exists)

Read actual source types:
- `src/query-v2/core/CacheMap/cache.types.ts` — current `ICacheMap`, `TCacheMapFactory`, strategy types
- `src/query-v2/types/` — ResourceV2 option types, entry types
- `src/query-v2/core/LifecycleHooks.ts` — current LifecycleHooks class and types
- `src/query-v2/core/ResourceV2CacheEntry.ts` — current entry class

Design the domain model. Produce `03-model.md` with:

**Type changes:**
- Updated `ICacheMap<TArgs, TEntry>` interface: evaluate `entries()` removal (user feedback: may not be needed — check all consumers via `Snapshot.getSnapshot()`, `ResourceV2.resetCache()`, and any other iteration sites). If consumers exist, decide on return type. If not, remove.
- Updated `TCacheMapFactory` signature: `(args: TArgs, argsKey: string) => TEntry` (from `(args: TArgs) => TEntry`).
- New `devtoolsKey?: (args: TArgs) => string` field on the compare-strategy subset of `TResourceV2Options`.
- Updated `CompareCacheMap` class: internals change from `Array<{args, entry}>` to `Map<TArgs, TEntry>`, no `compareArg` usage for lookup.
- Updated `SerializeCacheMap.getOrCreate`: passes computed key to factory.

**LifecycleHooks types:**
- Per-entry `LifecycleHooks` instance (or simplified hooks object): define what state and methods move to the entry.
- Updated `ResourceV2CacheEntry` constructor/fields to include hooks.
- Updated `ResourceV2` to no longer own a shared `LifecycleHooks` instance.

**Class diagrams (Mermaid):**
- Before/after class hierarchy for CacheMap family
- Before/after ResourceV2 → ResourceV2CacheEntry → LifecycleHooks relationships
- Entity-relationship diagram for the devtools key derivation chain

You have correction authority over all prior tier outputs (`00-short-design.md`, `01-architecture.md`, `02-dataflow.md`). Log corrections in `09-corrections.md`.

---

## Phase 4: Architecture Decisions

- **Agent**: `rdpi-architect`
- **Output**: `04-decisions.md`
- **Depends on**: 3
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`
- `../01-research/05-open-questions.md` (user feedback on each question)

Read prior design outputs:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `09-corrections.md` (if exists)

Formalize architecture decisions into ADRs. Produce `04-decisions.md` with ADR format: Status, Context, Options (with pros/cons), Decision, Consequences. Each ADR should reference the research open question it resolves and cite user feedback.

Required ADRs:

- **ADR-1: CompareCacheMap data structure** — Replace Array with Map. Context: Q1 analysis. Decision: plain `Map<TArgs, TEntry>` (user: "просто Map"). Consequences for `compareArg` function, `entries()`, and lookup semantics.

- **ADR-2: No caching option for compare strategy** — Remove/ignore `doCacheArgs` for compare. Context: Q2 analysis. Decision: no caching for compare strategy (user: "без кеширования для стратегии сравнения"). Consequences for `TResourceV2Options` type, `createCacheMap` factory.

- **ADR-3: Devtools key option for compare strategy** — New `devtoolsKey` option. Context: Q3 analysis. Decision: optional `devtoolsKey?: (args: TArgs) => string` on compare-strategy options, default is monotonic counter (user feedback). Consequences for type surface, factory signature.

- **ADR-4: Factory signature change to eliminate double serialization** — `TCacheMapFactory` becomes `(args, argsKey) => TEntry`. Context: Q6 analysis, Q3/Q4 interconnection. Decision: CacheMap passes computed key to factory. Consequences: fixes both Q3 (compare gets counter-based key) and Q4 (serialize reuses computed key). Note: query-v2 is not yet released, so no breaking change concerns (user feedback on Q5).

- **ADR-5: LifecycleHooks ownership move to ResourceEntry** — Each entry owns hooks. Context: Q4 analysis. Decision: per-entry hooks (user: "каждая ResourceV2CacheEntry самостоятельно вызывает хуки"). Consequences for `ResourceV2`, `ResourceV2CacheEntry`, `resetCache()`, plugin interactions.

- **ADR-6: `entries()` removal from ICacheMap** — Context: Q9 analysis. Decision: based on consumer audit from Phase 3 model. If no consumers found, remove. If consumers exist, adapt.

- **ADR-7: Demo isError fix approach** — Fix descriptions and UI only. Context: Q8 analysis. Decision: correct misleading text, do not change queryFn logic (user: "исправить ложное описание и поведение UI, логику менять не нужно").

You have correction authority over all prior tier outputs. Log corrections in `09-corrections.md`.

---

## Phase 5: Use Cases

- **Agent**: `rdpi-architect`
- **Output**: `05-usecases.md`
- **Depends on**: 4
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`
- `../01-research/01-codebase-analysis.md`
- `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `09-corrections.md` (if exists)

Read current usage patterns:
- `src/query-v2/api/createResource.ts` — how resources are created
- `src/query-v2/react/` — React hooks that consume resources
- `apps/demos/src/examples/` — existing demo files (list directory to find query-v2 examples)

Produce `05-usecases.md` with TypeScript code examples and React integration patterns:

**Use case 1: CompareCacheMap with Map — basic resource creation and access.** Show `createResourceV2` with compare strategy, args lookup via Map identity. Show what happens when the same args reference is reused vs a new reference with same values.

**Use case 2: Custom devtoolsKey for compare strategy.** Show `createResourceV2` with `devtoolsKey: (args) => args.id` or similar. Show default behavior (monotonic counter). Show how keys appear in Redux DevTools.

**Use case 3: Serialize strategy — no double serialization.** Show that the factory receives the pre-computed key. No user-visible API change, but demonstrate the internal flow for verification.

**Use case 4: Per-entry LifecycleHooks.** Show `onCacheEntryAdded` and `onQueryStarted` with the new per-entry model. Show concurrent entries with the same args do not interfere. Show `$queryFulfilled` promise isolation.

**Use case 5: Demo isError — corrected UI.** Show what the demo components should display: correct descriptions of SWR behavior, accurate labels for error states. Describe the minimal text/UI changes needed in each affected demo file.

**Edge cases:**
- CompareCacheMap with `void` args (single-entry resource)
- CompareCacheMap with primitive args (`string`, `number`)
- LifecycleHooks cleanup on `resetCache()`
- LifecycleHooks with hydrated entries (Snapshot system)

You have correction authority over all prior tier outputs. Log corrections in `09-corrections.md`.

---

## Phase 6: Documentation Impact

- **Agent**: `rdpi-architect`
- **Output**: `07-docs.md`
- **Depends on**: 5
- **Retry limit**: 2

### Prompt

Read prior design outputs:
- `00-short-design.md`
- `01-architecture.md`
- `04-decisions.md`
- `05-usecases.md`
- `09-corrections.md` (if exists)

Read existing documentation:
- `docs/query-v2/README.md`
- `docs/query-v2/devtools.md`
- `docs/query-v2/optimistic-updates.md` (may reference lifecycle hooks)

Produce `07-docs.md` describing WHAT documentation changes are needed. Keep this SHORT and focused — large docs.md is an anti-pattern.

WARNING: This document must be SHORT. Only list high-impact documentation changes. Do NOT write the actual documentation content. Describe WHAT needs to change, not HOW to write it. No JSDoc. No implementation code.

Expected sections:
- **New documentation**: `devtoolsKey` option for compare strategy (brief explanation of the option, default counter behavior)
- **Updated documentation**: LifecycleHooks section if it exists in query-v2 docs (ownership model changed to per-entry)
- **Updated documentation**: any reference to `doCacheArgs` for compare strategy (now irrelevant)
- **Demo documentation**: note that demo descriptions were corrected for isError accuracy
- **No change needed**: list existing doc sections that are unaffected

You have correction authority over all prior tier outputs. Log corrections in `09-corrections.md`.

---

## Phase 7: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Output**: `06-testcases.md`, `08-risks.md`
- **Depends on**: 6
- **Retry limit**: 1

### Prompt

Read all research documents:
- `../01-research/README.md` — key finding #7 (test coverage gaps)
- `../01-research/01-codebase-analysis.md` — test coverage section
- `../01-research/02-problem-analysis-cache.md` — test gaps for CacheMap
- `../01-research/03-problem-analysis-devtools.md` — test gaps for devtools keys
- `../01-research/04-problem-analysis-lifecycle-demos.md` — test gaps for LifecycleHooks and demos

Read all design documents:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `07-docs.md`
- `09-corrections.md` (if exists)

Read existing test files:
- `src/query-v2/__tests__/` — list directory to understand current test structure

Produce `06-testcases.md` with test case tables:

| ID | Category | Description | Input | Expected Output | Priority |

Categories:
- **CacheMap-unit**: CompareCacheMap with Map internals — get, set, delete, has with reference identity, primitive args, void args, size tracking
- **CacheMap-devtools**: devtools key derivation — monotonic counter default, custom devtoolsKey function, key format in signals
- **CacheMap-serialize**: SerializeCacheMap — no double serialization (mock/spy on serialize function, verify call count), factory receives pre-computed key
- **LifecycleHooks-unit**: per-entry hooks — concurrent entries don't interfere, $queryFulfilled isolation, cleanup on entry removal, resetCache iterates entries
- **LifecycleHooks-hydration**: hooks with hydrated entries from Snapshot system
- **Integration**: resource creation → entry access → hooks firing → devtools key visible
- **Demo-visual**: demo files show correct descriptions and UI behavior

Produce `08-risks.md` with risk analysis table:

| ID | Risk | Probability | Impact | Strategy | Mitigation |

Key risks to analyze:
- CompareCacheMap Map semantics: reference identity differs from comparison equality — entries with structurally-equal but reference-different args create duplicates
- Factory signature change: all CacheMap implementations and tests must update
- LifecycleHooks move: plugin interactions, Snapshot hydration path, resetCache behavior
- Monotonic counter: counter value persistence across resetCache (reset or continue?)
- Demo changes: minimal risk, but verify no demo relies on specific isError state

Include detailed mitigation plans for high-impact risks. Include performance test criteria for CacheMap lookup (O(1) verification).

---

## Phase 8: General Design Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 7
- **Retry limit**: 2

### Prompt

Read ALL design documents in this directory:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`
- `09-corrections.md` (if exists)

Read research documents for traceability check:
- `../01-research/README.md`
- `../01-research/05-open-questions.md` (verify user feedback was respected in all decisions)

Review all documents against the following checklist:

- [ ] Research traceability — all design choices cite research findings
- [ ] ADR completeness — all 7 ADRs have Status, Context, Options, Decision, Consequences
- [ ] Mermaid conformance — titled, max 15–20 elements, split large diagrams
- [ ] Test-risk coverage — test cases cover identified risks
- [ ] Docs proportionality — `07-docs.md` is short and focused
- [ ] Docs describe WHAT not HOW — no implementation code in docs
- [ ] Research open questions addressed or deferred — all 9 Qs from `05-open-questions.md` resolved
- [ ] User feedback respected — decisions match user feedback from open questions
- [ ] Risk analysis has actionable mitigations
- [ ] Internal consistency — no contradictions between documents
- [ ] No implementation code in design documents
- [ ] `00-short-design.md` exists, is within 1–2 pages, and aligns with architecture
- [ ] Correction log entries (if any) are factual, not stylistic
- [ ] Corrected documents reflect the logged corrections accurately

Write/update `README.md` with: overview, goals, non-goals, document links, key decisions summary, quality review checklist with pass/fail status, next steps.

---

## Phase 9: Correction Log Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 8
- **Retry limit**: 2

### Prompt

Read `09-corrections.md` (if exists) and all design documents:
- `00-short-design.md`
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

Read `README.md` (updated by Phase 8).

If `09-corrections.md` exists:
- Cross-reference each entry against the current state of the corrected file — verify "Original" matches what was before and "Corrected" matches what is now in the file.
- Check for cascading inconsistencies — verify no correction introduced a new contradiction with other documents.
- Verify rationale is grounded in research or earlier design documents.

If `09-corrections.md` does not exist:
- Spot-check cross-document consistency: verify CacheMap descriptions match between architecture, dataflow, and model. Verify LifecycleHooks ownership is consistently described. Verify ADR decisions align with architecture and model.
- Confirm absence is legitimate given the clear user direction from research open questions.

Append a `### Correction Log Review` subsection to the Quality Review section in `README.md`.

---

# Redraft Round 1

## Phase 10: Fix issue #1 — Mermaid diagram syntax errors

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `05-usecases.md`, `04-decisions.md`, `06-testcases.md`, `07-docs.md`, `08-risks.md`
- **Depends on**: 9
- **Retry limit**: 2
- **Review issues**: #1

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/REVIEW.md`.
Your assigned issue: #1 (Mermaid diagram syntax errors).

Affected files confirmed by review:
- `01-architecture.md` (§2.2, §3.2)
- `03-model.md` (§2.3, §7.1, §7.2, §7.4)
- `05-usecases.md`

However, you MUST NOT limit yourself to only those files. Scan and validate EVERY Mermaid code block in EVERY design document in this directory:
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

For each Mermaid code block found, check for these known error patterns and any other syntax issues:
1. **Generic types with curly braces** — `Array~{args, entry}~`, `PromiseResolver~{data}~` etc. cause `OPEN_IN_STRUCT` errors. Replace curly braces inside generics with parentheses or angle brackets or restructure the type notation.
2. **Double colons in method signatures** — `+get(args: TArgs) : : TEntry` must use a single colon for return type: `+get(args TArgs) TEntry` (class diagram methods use no colons at all in Mermaid syntax).
3. **State diagram description colons** — state descriptions with colons cause `Expecting 'SPACE'... got 'DESCR'` errors. Escape or remove colons from state descriptions.
4. **Any other Mermaid v10.9.3 incompatibilities** — validate each diagram holistically.

Fix all issues in-place. Do NOT change the semantic content of any diagram — only fix syntax to make it parseable by Mermaid v10.9.3.

---

## Phase 11: Re-review after Redraft Round 1

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 10
- **Retry limit**: 2

### Prompt

Re-verify ALL Mermaid diagrams in ALL design documents modified by Phase 10:
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

For every Mermaid code block, verify:
1. No generic types with curly braces inside `~...~` notation
2. No double colons in class diagram method/attribute signatures
3. No unescaped colons in state diagram descriptions
4. Each diagram type keyword is correct (`classDiagram`, `sequenceDiagram`, `stateDiagram-v2`, `flowchart`, `graph`, `C4Context`, etc.)
5. Each diagram parses as valid Mermaid v10.9.3 syntax

Also re-check the original review checklist item #3 (Mermaid diagrams present and conformant) — confirm it now genuinely passes.

Update `README.md`: set status to reflect re-review result. Append a `### Redraft Round 1 Review` subsection to the Quality Review section confirming all Mermaid diagrams are now valid.

---

# Redraft Round 2

## Phase 12: Fix issue #1 — Mermaid classDiagram syntax errors (round 2)

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `05-usecases.md`
- **Depends on**: 11
- **Retry limit**: 2
- **Review issues**: #1

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/02-design/REVIEW.md`.
Your assigned issue: #1 (Mermaid diagram syntax errors persist after Redraft Round 1).

Affected files — scan and fix ALL `classDiagram` blocks in:
- `01-architecture.md` (§2.2, §3.2 and any other classDiagram blocks)
- `02-dataflow.md` (any classDiagram blocks)
- `03-model.md` (§7.1, §7.2 and any other classDiagram blocks)
- `05-usecases.md` (any classDiagram blocks)

Three specific Mermaid syntax problems cause "Cannot read properties of undefined (reading 'split')" and "Syntax error in text" errors:

**Problem 1 — `<<type alias>>` annotation**: Mermaid does NOT support spaces inside annotation markers `<<...>>`. Every occurrence of `<<type alias>>` must be changed to `<<type>>`. Search all classDiagram blocks for annotations with spaces and fix them.

**Problem 2 — Bare callable signatures**: Lines like `(args TArgs) TEntry` inside a class body are NOT valid Mermaid class diagram members. Every class member must have a name. Replace bare callable signatures with named methods, e.g. `+call(args TArgs) TEntry`. Search all classDiagram blocks for lines that start with `(` inside a class body.

**Problem 3 — Method return type colons**: Mermaid classDiagram method format is `+methodName(param Type) ReturnType` — no colon before the return type. Verify that no method line uses `::` or `: :` before the return type. Fix any occurrences.

Do NOT change the semantic content of any diagram. Only fix syntax to make diagrams parseable by Mermaid v10.9.3.

---

## Phase 13: Re-review after Redraft Round 2

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 12
- **Retry limit**: 2

### Prompt

Re-verify ALL Mermaid classDiagram blocks in the files modified by Phase 12:
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `05-usecases.md`

For every classDiagram block, verify:
1. No annotations with spaces inside `<<...>>` (e.g. `<<type alias>>` is invalid, `<<type>>` is valid)
2. No bare callable signatures — every class member line must start with a visibility modifier (`+`, `-`, `#`, `~`) or a named identifier, never with `(`
3. No `::` or `: :` in method return types — format must be `+methodName(param Type) ReturnType`
4. All generic type notation uses `~...~` without curly braces
5. Each diagram parses as valid Mermaid v10.9.3 syntax

Re-check checklist item #3 (Mermaid diagrams present and conformant). Confirm it now genuinely passes for classDiagram blocks.

Update `README.md`: append a `### Redraft Round 2 Review` subsection to the Quality Review section. Set status based on review result.
