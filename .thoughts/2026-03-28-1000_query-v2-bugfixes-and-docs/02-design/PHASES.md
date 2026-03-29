---
title: "Phases: 02-design"
date: 2026-03-29
stage: 02-design
---

# Phases: 02-design

## Phase 1: Architecture + Short Design

- **Agent**: `rdpi-architect`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md` (summary and key findings)
- `../01-research/01-codebase-analysis.md` (architecture map, ~25 files, data flow, state machines, lifecycle hooks, test inventory)
- `../01-research/02-external-research.md` (comparative analysis: RTK Query, TanStack Query, SWR, Apollo Client)
- `../01-research/03-problem-analysis-part1.md` (bugs #1–#3: snapshot fetch bypass, onQueryStarted dead code, SWR error masking)
- `../01-research/04-problem-analysis-part2.md` (bugs #4–#5: Patcher consistency violation, $cacheDataLoaded hang)
- `../01-research/05-open-questions.md` (Q1–Q12 with user answers)

Design the system architecture (C4 Level 2–3) for the following changes to query-v2:

**Bug fixes (5):**
1. `ResourceV2CacheEntry` constructor — add `initialMachine` option to skip `_doFetch()` on snapshot hydration (Q3: lazy fetch)
2. `ResourceV2CacheEntry._doFetch` — wire `fireQueryStarted`/`resolveQueryFulfilled` calls into fetch lifecycle (Q1: wire in)
3. `ResourceV2Agent._deriveState$` — fix SWR error masking: derive `isError` from `currentMachine.status` before override, fix `previous$` clearing condition (Q2: error-transparent SWR)
4. `Patcher.resolvePatches` catch block — return `{ data: currentData, patchState: { patches: [], isConsistencyViolation: true } }` (Q4: fix catch return)
5. `LifecycleHooks.fireCacheEntryRemoved` — reject pending `$cacheDataLoaded` before deleting resolver entry (Q5: reject in fireCacheEntryRemoved)

**Enhancement (1):**
6. Add optional `lastError` field to `MachineSuccess` for same-args refetch error visibility (Q10: in scope)

**Docs & examples:**
7. Incremental doc fixes + targeted additions (Q7: option 3)
8. 4–5 minimal interactive examples: basic query, error/SWR states, SKIP token, snapshot hydration (Q9: option 1)

Produce `01-architecture.md` with:
- C4 container and component diagrams (Mermaid) showing affected modules and their relationships
- Component boundaries: which files/modules are modified for each fix area
- Module responsibility zones: `api/`, `core/`, `lib/`, `react/`, `plugins/`
- Sequence diagrams for key modified flows (fetch lifecycle with onQueryStarted, SWR state derivation, cache reset with promise rejection)
- State diagrams for MachineSuccess with `lastError` extension

Produce `00-short-design.md` per the specification (1–2 pages max, direction + key decisions + scope boundaries + research references). Key decisions must reference open question resolutions (Q1–Q12).

All design choices must cite research findings via relative links to `../01-research/` documents.

---

## Phase 2: Data Flow

- **Agent**: `rdpi-architect`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md`, `../01-research/02-external-research.md`, `../01-research/03-problem-analysis-part1.md`, `../01-research/04-problem-analysis-part2.md`, `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`, `01-architecture.md`

If `09-corrections.md` exists, read it.

Produce `02-dataflow.md` with data flow for these key scenarios:

1. **Snapshot hydration flow** — `createApi({ initialSnapshot })` → `hydrateEntry()` → `ResourceV2CacheEntry` with `initialMachine` (skip `_doFetch`). Show how the entry lifecycle differs from normal query creation.
2. **Fetch lifecycle with onQueryStarted** — `_doFetch()` → `fireQueryStarted` → queryFn execution → `resolveQueryFulfilled` (success path) / rejection (error path) / abort handling. Include `$queryFulfilled` promise resolution timing.
3. **SWR error state derivation** — Cross-args refetch: `previous$` set → new entry fetch fails → `_deriveState$` produces `isError: true` + stale data from `previous$` → `previous$` clearing condition using `currentMachine.status`. Include same-args refetch: `MachineRefreshing.errorHappened()` → `MachineSuccess` with `lastError`.
4. **Patcher commit with consistency violation** — `resolvePatches` → catch block → return with `isConsistencyViolation: true` → `_finishPatch` detection → `invalidate()`.
5. **Cache reset promise rejection** — `resetCache()` → `entry.complete()` → `fireCacheEntryRemoved` rejects `$cacheDataLoaded` → deletes resolver → `clearAll()`. Also: GC-triggered removal following same path.

Mermaid diagrams required: sequence diagrams for each scenario, state transition diagrams for machine states (including `lastError` extension), data flow diagrams showing signal/observable propagation.

Correction authority: may correct `01-architecture.md` or `00-short-design.md` if inaccuracies are found. Log corrections in `09-corrections.md` per the correction mechanism.

---

## Phase 3: Domain Model

- **Agent**: `rdpi-architect`
- **Depends on**: 2
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md`, `../01-research/02-external-research.md`, `../01-research/03-problem-analysis-part1.md`, `../01-research/04-problem-analysis-part2.md`, `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`

If `09-corrections.md` exists, read it.

Produce `03-model.md` with domain model changes:

1. **`MachineSuccess` type extension** — Add optional `lastError?: Error` field. Show class diagram with `MachineSuccess`, `MachineRefreshing`, `MachineError` and the state transitions that populate/clear `lastError`. Document when `lastError` is set (same-args refetch error via `errorHappened()`) and when it's cleared (next successful fetch).
2. **`ResourceV2CacheEntry` constructor changes** — New `initialMachine?` parameter in constructor options. Show how `_entryFactory` signature changes. Entity-relationship diagram for `ResourceV2CacheEntry` ↔ `ResourceV2Agent` ↔ `QueriesCacheV2`.
3. **`LifecycleHooks` resolver lifecycle** — Model the `_entryResolvers` map entries, `$cacheDataLoaded` promise states (pending → resolved / rejected), and the new rejection path in `fireCacheEntryRemoved`.
4. **`Patcher.resolvePatches` return type** — Model the corrected return shape from the catch block with `isConsistencyViolation: true`.
5. **SWR state derivation types** — Model the `DerivedState` interface changes (if any) to reflect `isError` being `true` while `data` contains stale data from `previous$`.
6. **`onQueryStarted` lifecycle types** — Model `fireQueryStarted` call context, `$queryFulfilled` promise type, and `resolveQueryFulfilled` data shape within `_doFetch`.

Mermaid diagrams required: class diagrams showing modified interfaces/types, entity-relationship diagrams for affected module relationships.

Correction authority: may correct `01-architecture.md`, `00-short-design.md`, `02-dataflow.md`. Log corrections in `09-corrections.md`.

---

## Phase 4: Architecture Decisions

- **Agent**: `rdpi-architect`
- **Depends on**: 3
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md`, `../01-research/02-external-research.md`, `../01-research/03-problem-analysis-part1.md`, `../01-research/04-problem-analysis-part2.md`, `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`

If `09-corrections.md` exists, read it.

Produce `04-decisions.md` formalizing ADRs for all design decisions. Each ADR must follow the format: Status, Context, Options (with pros/cons), Decision, Consequences.

Required ADRs (derived from open questions Q1–Q12 and architecture/dataflow/model documents):

- **ADR-1**: Snapshot hydration strategy — lazy fetch with `initialMachine` (Q3)
- **ADR-2**: `onQueryStarted` lifecycle wiring into `_doFetch` (Q1)
- **ADR-3**: Error-transparent SWR semantics with `previous$` clearing fix (Q2)
- **ADR-4**: Patcher catch-block return with `isConsistencyViolation` (Q4)
- **ADR-5**: `$cacheDataLoaded` rejection in `fireCacheEntryRemoved` (Q5), covering both resetCache and GC paths (Q12)
- **ADR-6**: `lastError` field on `MachineSuccess` for same-args refetch errors (Q10)
- **ADR-7**: Documentation scope — incremental fixes + targeted additions (Q7), migration guide deferred (Q8)
- **ADR-8**: Interactive examples — minimal set of 4–5 (Q9)
- **ADR-9**: Mandatory regression tests for each bug fix (Q11)
- **ADR-10**: Independent fix strategy with integration test verification (Q6)

Each ADR must cite the corresponding open question (with user answer) and relevant research findings. Where decisions were already implicit in prior design documents, consolidate and formalize them.

Correction authority: may correct `01-architecture.md`, `00-short-design.md`, `02-dataflow.md`, `03-model.md`. Log corrections in `09-corrections.md`.

---

## Phase 5: Use Cases

- **Agent**: `rdpi-architect`
- **Depends on**: 4
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md`, `../01-research/02-external-research.md`, `../01-research/03-problem-analysis-part1.md`, `../01-research/04-problem-analysis-part2.md`, `../01-research/05-open-questions.md`

Read prior design outputs:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`

If `09-corrections.md` exists, read it.

Produce `05-usecases.md` with TypeScript code examples and React integration patterns for:

1. **Snapshot hydration** — `createApi({ initialSnapshot })` with `maxSnapshotDataAge` showing the entry starting in `MachineSuccess` without triggering `queryFn`. Edge case: snapshot data older than `maxSnapshotDataAge` → normal fetch triggered.
2. **`onQueryStarted` optimistic update** — `onQueryStarted` callback using `$queryFulfilled` to apply optimistic patches and roll back on failure. Show the lifecycle: `queryStarted` → patch applied → `queryFulfilled` (success: keep patch) or (error: undo patch).
3. **SWR error handling in React** — Component consuming a resource where cross-args refetch fails: `isError === true`, `error` present, `data` contains stale data from previous args. Show pattern for rendering error banner over stale data. Also show `lastError` from same-args refetch.
4. **Patcher consistency violation recovery** — Optimistic patch that encounters a consistency violation: the violation is now properly detected, `invalidate()` triggers refetch, data converges to server truth.
5. **Cache reset with pending queries** — `resetCache()` called while `$cacheDataLoaded` is pending: promise rejects, `onQueryStarted` callback receives rejection, no hanging promise.
6. **SKIP token usage** — Conditional query with `SKIP_TOKEN`, showing when the query is skipped and when it activates.

Edge cases to address: invalid/expired snapshot, abort during `onQueryStarted`, concurrent cache reset during fetch, `previous$` with `lastError`.

Correction authority: may correct any prior design document. Log corrections in `09-corrections.md`.

---

## Phase 6: Documentation Impact

- **Agent**: `rdpi-architect`
- **Depends on**: 5
- **Retry limit**: 2

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md` (§Documentation Structure)

Read prior design outputs:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`

If `09-corrections.md` exists, read it.

Produce `07-docs.md` — keep it SHORT and focused. Large docs.md is an anti-pattern. Only high-impact documentation changes.

**WARNING**: `07-docs.md` must describe WHAT needs documentation, not HOW. No JSDoc. No implementation code. Match existing project doc style in `docs/query-v2/`.

Scope (from Q7 answer: incremental fix + targeted additions, Q8: defer migration guide, Q9: 4–5 examples):

**Factual error fixes (blocking):**
- `docs/query-v2/README.md`: Replace `MachineIdle` references with correct state name
- `docs/query-v2/devtools.md`: Remove references to options not in `TDevtoolsOptions` type
- `docs/query-v2/optimistic-updates.md`: Update `onQueryStarted` docs after Bug #2 fix (was documented as functional but never fired)

**Targeted additions:**
- Error handling guide: SWR error semantics (Bug #3 fix), `lastError` on `MachineSuccess` (Q10), error recovery patterns
- Lifecycle hooks guide: `onQueryStarted` / `$queryFulfilled` usage after Bug #2 wiring
- Brief deferred migration note in `docs/query-v2/README.md` re: v1→v2 (Q8)

**Interactive examples spec (4–5 examples, visual, no commands/mutations):**
- Basic query example
- Error/SWR states example (showcases Bug #3 fix)
- SKIP token example
- Snapshot hydration example (showcases Bug #1 fix)
- (Optional 5th) Lifecycle hooks with `onQueryStarted`

For each example: describe purpose, which concepts it demonstrates, and which existing demos it relates to (check `apps/demos/src/examples/`).

Correction authority: may correct any prior design document. Log corrections in `09-corrections.md`.

---

## Phase 7: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Depends on**: 6
- **Retry limit**: 1

### Prompt

Read all research documents:
- `../01-research/README.md`, `../01-research/01-codebase-analysis.md` (§Test Inventory), `../01-research/03-problem-analysis-part1.md` (test evidence sections), `../01-research/04-problem-analysis-part2.md` (test evidence sections)

Read all design outputs:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `07-docs.md`

If `09-corrections.md` exists, read it.

Produce `06-testcases.md` with test case tables covering all 6 fix areas + `lastError` enhancement + docs + examples. Format: ID, Category, Description, Input, Expected Output, Priority. Categories: unit, integration, e2e.

Mandatory regression tests (Q11):
- Bug #1: Snapshot hydration with valid `maxSnapshotDataAge` → `queryFn` NOT called. Update existing test E07 assertion.
- Bug #2: `onQueryStarted` fires on fetch, `$queryFulfilled` resolves/rejects correctly. Covers: success, error, abort.
- Bug #3: Cross-args refetch error → `isError: true`, `data` = stale, `previous$` cleared. Same-args refetch error → `lastError` populated.
- Bug #4: `resolvePatches` catch → `isConsistencyViolation: true` returned → `_finishPatch` detects → `invalidate()` called.
- Bug #5: `resetCache()` with pending `$cacheDataLoaded` → promise rejects. GC-triggered removal → same behavior.

Integration tests: snapshot hydration + lifecycle hooks interaction (Q6), full SWR cycle with error recovery, cache reset during optimistic update.

Produce `08-risks.md` with risk analysis table: ID, Risk, Probability (H/M/L), Impact (H/M/L), Strategy (Accept/Mitigate/Avoid), Mitigation. Include detailed mitigation plans for high-impact risks. Consider: `lastError` on `MachineSuccess` broadening machine type surface, `onQueryStarted` changing fetch execution profile, SWR semantics breaking change for consumers pattern-matching on `status === "refreshing"`.

---

## Phase 8: General Design Review

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 7
- **Retry limit**: 2

### Prompt

Review ALL design documents in `02-design/`:
- `00-short-design.md`, `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`, `07-docs.md`, `08-risks.md`

If `09-corrections.md` exists, review it.

Read research documents for traceability checks:
- `../01-research/README.md` (key findings, contradictions)
- `../01-research/05-open-questions.md` (Q1–Q12 with user answers — verify all are addressed)

Quality review checklist:
- [ ] Research traceability — all design choices cite research findings
- [ ] ADR completeness — all 10 ADRs have Status, Context, Options, Decision, Consequences
- [ ] Mermaid conformance — titled, max 15–20 elements, split large diagrams
- [ ] Test-risk coverage — test cases cover identified risks
- [ ] Docs proportionality — `07-docs.md` is short and focused
- [ ] Docs describe WHAT not HOW — no implementation code
- [ ] All 12 open questions (Q1–Q12) addressed or explicitly deferred
- [ ] Risk analysis has actionable mitigations
- [ ] Internal consistency — no contradictions between documents
- [ ] No implementation code in design documents
- [ ] `00-short-design.md` exists, is within 1–2 pages, and aligns with architecture
- [ ] Correction log entries (if any) are factual, not stylistic
- [ ] Corrected documents reflect the logged corrections accurately
- [ ] `lastError` on `MachineSuccess` (Q10, in scope) is fully designed across architecture, model, dataflow, usecases, and test cases
- [ ] Bug #2 (`onQueryStarted` wiring) design covers success, error, and abort paths in dataflow and use cases

Write/update `README.md` with: overview, goals, non-goals, document links, key decisions summary, quality review checklist results, next steps.

---

## Phase 9: Correction Log Review

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 8
- **Retry limit**: 2

### Prompt

Read `README.md` (written by Phase 8).

If `09-corrections.md` exists:
- Read `09-corrections.md` and all design documents it references
- Cross-reference each correction entry against the current state of the corrected file — verify "Original" matches what existed before and "Corrected" matches current content
- Check for cascading inconsistencies — verify no correction introduced a new contradiction with other documents
- Verify each correction rationale is grounded in research (`../01-research/`) or earlier design documents

If `09-corrections.md` does NOT exist:
- Spot-check cross-document consistency: verify `01-architecture.md` component boundaries align with `03-model.md` types, `02-dataflow.md` sequences reference correct types from `03-model.md`, `04-decisions.md` ADRs match architecture choices, `05-usecases.md` code examples use types from `03-model.md`, `06-testcases.md` covers all risks from `08-risks.md`
- Confirm absence of corrections is legitimate given the scope (6 fix areas + enhancement + docs + examples is moderately complex — some corrections between tiers would be expected)

Append a `### Correction Log Review` subsection to the Quality Review section in `README.md`.

---

# Redraft Round 1

## Phase 10: Fix issue #1 + Mermaid diagram parse errors

- **Agent**: `rdpi-redraft`
- **Output**: `02-dataflow.md`
- **Depends on**: 9
- **Retry limit**: 2
- **Review issues**: #1 + User Feedback items 1–3

### Prompt

Read REVIEW.md at `02-design/REVIEW.md`.
Your assigned issues: #1 (abort text contradiction) and all 3 User Feedback Mermaid errors.
Affected files: `02-design/02-dataflow.md`.

Issue #1: In §2 "Fetch Lifecycle with onQueryStarted", the introductory paragraph (~line 131) says `resolveQueryFulfilled` is called "on completion (success, error, or abort)". The diagram shows `resolveQueryFulfilled` is NOT called for aborted fetches. Fix the text to read "on completion (success or error)" — matching the diagram and `01-architecture.md` §5.

Mermaid errors: Three diagrams in `02-dataflow.md` have parse/lexical errors:
1. State Diagram "Machine States with lastError Extension" — lexical error on line 25 (unrecognized text in status field syntax). Fix the syntax to be valid Mermaid stateDiagram-v2.
2. Promise Settlement State Machine — parse error on line 11 (unexpected `DESCR` token — likely prose text inside a state definition). Fix to valid Mermaid stateDiagram-v2.
3. Summary of Signal/Observable Propagation Across All Scenarios — parse error on line 47 (unexpected `PS` token — likely parenthesis syntax issue in node definition). Fix to valid Mermaid flowchart — use bracket syntax for nodes containing special characters.

For each Mermaid fix: ensure the diagram renders correctly, preserves the intended semantic content, and uses valid Mermaid syntax. Do not alter the meaning of any diagram.

Fix only your assigned issues. Do not make other changes.

---

## Phase 11: Re-review after Redraft Round 1

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 10
- **Retry limit**: 2

### Prompt

Re-review `02-design/02-dataflow.md` after Redraft Round 1 fixes.

Verify:
1. §2 introductory text now correctly states `resolveQueryFulfilled` is called "on completion (success or error)" — NOT "success, error, or abort". Confirm consistency with the sequence diagram in the same section and with `01-architecture.md` §5.
2. All three previously broken Mermaid diagrams are now valid and renderable:
   - "Machine States with lastError Extension" state diagram
   - "Promise Settlement State Machine" state diagram
   - "Summary of Signal/Observable Propagation Across All Scenarios" flowchart
3. No other content in `02-dataflow.md` was inadvertently modified.

Also read `09-corrections.md` (if it was updated) and verify any new entries are accurate.

Update `README.md` quality review section with Redraft Round 1 results.
