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

You are designing the architecture for 7 targeted fixes to the `query-v2` module in `rx-toolkit`.

**Read these files first:**
- Task description: `../TASK.md`
- Research codebase analysis: `../01-research/01-codebase-analysis.md`
- Research open questions (with user decisions): `../01-research/02-open-questions.md`
- Research summary: `../01-research/README.md`

**User decisions that constrain your design** (from open questions `## User Answers`):
- Q1: Hooks support BOTH plugin path (`resource.useResourceV2Agent`) AND standalone export (`useResourceV2Agent(resource, args)`). Plugin system stays.
- Q2: Plugin system is NOT removed. Keep as-is.
- Q3: Core split is internal-only. `core/index.ts` re-exports from sub-dirs. No public API change.
- Q4: `hydrateSnapshot` must THROW on version mismatch and key prefix mismatch. Warn on other cases (unknown resource key, etc.).
- Q5: Code change IS needed for devtools. Agent state DOES leak to devtools via `Signal.state` and `Signal.compute` in `ResourceV2Agent`. Research was wrong on this — design a solution that prevents agent signals from pushing to devtools.
- Q6: JSDoc on public API + inline comments at "magic" locations.
- Q7: Find existing snapshot documentation and add optimistic update snapshot behavior there.
- Q8: Implementation order for fixes #1/#2 at designer's discretion.
- Q9: Only barrel imports are public. Deep imports not supported — files can be moved freely.
- Q10: No change to devtools opt-out mechanism.
- Q11: Self-contained JSDoc with `@see` links for complex concepts.
- Q12: Check integration tests before implementation.

**What to design:**

1. **System Architecture (C4 Level 2–3):** Draw the query-v2 module boundary with its sub-modules after all 7 fixes are applied. Show `core/common/`, `core/machines/`, `core/resource/`, `react/`, `plugins/`, `snapshot/`, `api/`, `types/`. Show how React hooks exist in `react/` as standalone functions AND are still available via `ReactHooksPlugin.augmentResource`. Show the signal/devtools boundary for fix #4.

2. **Component Boundaries:** For each fix, define which files/modules are touched and what their new responsibilities are:
   - Fix #1+#2: `react/useResourceV2Agent.ts`, `react/useResourceV2Ref.ts`, `react/index.ts` (new standalone hooks). `plugins/ReactHooksPlugin.ts` (thin wrapper delegating to standalone hooks). Show how the standalone hooks receive `resource` as a parameter vs. the plugin closure.
   - Fix #3: `core/common/` (CacheEntry, CacheMap, LifecycleHooks), `core/machines/` (already isolated), `core/resource/` (ResourceV2, ResourceV2Agent). Updated `core/index.ts` barrel.
   - Fix #4: Identify the exact signals in `ResourceV2Agent` that leak to devtools (`_state$` as `Signal.state`, any `Signal.compute`). Design how to disable `beforeDevtoolsPush` on those signals — either via a signal option or by changing signal type.
   - Fix #5: `snapshot/Snapshot.ts` `hydrateSnapshot` function — new error/throw logic.
   - Fix #6: List of files needing JSDoc (reference the inventory from codebase analysis §6).
   - Fix #7: Identify the target doc file and section for optimistic update snapshot content.

3. **Module Dependency Diagram (Mermaid):** Show the dependency graph between query-v2 sub-modules after restructuring. Highlight which modules depend on React vs. pure TypeScript.

4. **Data Flow Diagrams (Mermaid sequence diagrams):**
   - Hook lifecycle: standalone `useResourceV2Agent(resource, args)` → resource.createAgent() → CacheEntry → signal subscription → React re-render
   - Plugin hook lifecycle: `resource.useResourceV2Agent(args)` → delegating to standalone hook
   - Snapshot hydration with error handling: `hydrateSnapshot(snapshot, registry)` → version check (throw) → prefix check (throw) → per-entry hydration → Machine.fromSnapshot (throw on corrupt) → unknown resource (warn + skip)
   - DevTools flow: CacheEntry signal update → beforeDevtoolsPush → Redux DevTools. Show where agent signals are NOW (leaking) and where they should be (blocked).

5. **Domain Model:** Class/interface hierarchy diagram for ResourceV2, ResourceV2Agent, CacheEntry, Machine hierarchy. Show how standalone hooks relate to these (they receive ResourceV2 as parameter).

6. **Architecture Decision Records (ADRs):**
   - ADR-1: React hooks dual-path (standalone + plugin). Context: user wants both. Options evaluated in Q1. Decision: standalone functions in `react/` with plugin as thin wrapper. Consequences.
   - ADR-2: Core split strategy. Context: flat core. Decision: internal sub-folders with barrel re-export. Consequences.
   - ADR-3: DevTools agent state filtering. Context: agent signals leak. Decision: disable `beforeDevtoolsPush` on agent signals. Consequences for debugging.
   - ADR-4: Snapshot hydration error semantics. Context: silent failures. Decision: throw on version/prefix mismatch, warn on unknown resource. Consequences for SSR and upgrades.
   - ADR-5: JSDoc scope. Context: types covered, implementation not. Decision: public API + magic spots. Consequences.

All design choices MUST cite specific findings from the research documents (use relative links like `[codebase analysis §1](../01-research/01-codebase-analysis.md)`).

Use Mermaid diagrams: C4 container/component, module dependency, class/interface hierarchy, sequence diagrams. Max 15–20 elements per diagram — split larger diagrams. ADR format: Status, Context, Options (with pros/cons), Decision, Consequences.

---

## Phase 2: Use Cases & Documentation Impact

- **Agent**: `rdpi-architect`
- **Output**: `05-usecases.md`, `07-docs.md`
- **Depends on**: 1
- **Retry limit**: 2

### Prompt

You are designing use cases and documentation impact for the 7 query-v2 fixes.

**Read these files first:**
- Architecture outputs from phase 1: `./01-architecture.md`, `./02-dataflow.md`, `./03-model.md`, `./04-decisions.md`
- Research codebase analysis: `../01-research/01-codebase-analysis.md`
- Research open questions (with user decisions): `../01-research/02-open-questions.md`

**Produce `05-usecases.md`:**

For each fix area, provide TypeScript code examples showing the API from the consumer's perspective:

1. **Fix #1+#2 — Standalone hooks:**
   - Use case: Import and use `useResourceV2Agent` as a standalone function from `@rx-toolkit/query-v2/react` (or the appropriate public path). Show `useResourceV2Agent(myResource, args)`.
   - Use case: Continue using hooks via plugin path: `resource.useResourceV2Agent(args)` after `createApi({ plugins: [ReactHooksPlugin] })`.
   - Use case: Using `useResourceV2Ref` standalone.
   - Edge case: Using standalone hook with SKIP_TOKEN.
   - Edge case: What happens if a consumer uses the plugin AND imports the standalone hook — are they the same function?

2. **Fix #3 — Core split:**
   - Use case: Importing from `@rx-toolkit/query-v2` — show that public path doesn't change.
   - Edge case: Internal module importing from `core/common/CacheEntry` vs. `core/` barrel.

3. **Fix #4 — DevTools filtering:**
   - Use case: Creating a resource and agent — agent state does NOT appear in Redux DevTools, only CacheEntry state does.
   - Edge case: Custom `beforeDevtoolsPush` on a resource config — verify it still works for CacheEntry but doesn't enable agent logging.

4. **Fix #5 — Snapshot errors:**
   - Use case: `hydrateSnapshot` with valid snapshot — succeeds normally.
   - Use case: `hydrateSnapshot` with old version snapshot — throws descriptive error.
   - Use case: `hydrateSnapshot` with wrong key prefix — throws descriptive error.
   - Use case: `hydrateSnapshot` with unknown resource key — logs warning, skips entry, continues.
   - Use case: `hydrateSnapshot` with corrupt machine status — throws (existing behavior from `Machine.fromSnapshot`).
   - Edge case: Server-side rendering with version upgrade scenario — what should the consumer catch/handle?

5. **Fix #6 — JSDoc:**
   - Use case: Describe which methods get JSDoc (reference the architecture inventory). Show 2-3 example JSDoc strings for critical methods (`createApi`, `ResourceV2.createAgent`, `ResourceV2.query`).

6. **Fix #7 — Documentation:**
   - Use case: Identify the exact doc file and section where optimistic update snapshot behavior will be added.
   - Describe WHAT information is added (snapshot captures optimistic `data` but excludes `originalData` and `patches`; implications for hydration).

Include migration path for fix #1+#2: consumers currently using `plugins: [ReactHooksPlugin]` + `resource.useResourceV2Agent(args)` want to switch to standalone hooks. Document the steps.

**Produce `07-docs.md`:**

⚠️ CRITICAL: `07-docs.md` must be SHORT and focused. Large docs.md is an anti-pattern. Only describe high-impact documentation changes. Do NOT write the actual JSDoc or documentation content — only describe WHAT needs documenting and WHERE.

Content:
- Fix #7: Which existing doc file(s) need the optimistic update snapshot section. What the section should cover (bullet points only).
- Fix #1+#2: Whether `docs/query-v2/README.md` or `docs/query-v2/api-reference.md` needs an update to mention standalone hooks. Keep it minimal — just the location and 1-sentence description of what to add.
- Fix #5: Whether the SSR doc (`docs/query-v2/ssr.md`) needs a note about new error behavior.
- Match the existing rx-toolkit doc style. Describe WHAT, not HOW like implementation code. No JSDoc in this file.

---

## Phase 3: QA Strategy & Risks

- **Agent**: `rdpi-qa-designer`
- **Output**: `06-testcases.md`, `08-risks.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are designing the test strategy and risk analysis for the 7 query-v2 fixes.

**Read these files first:**
- Architecture: `./01-architecture.md`, `./02-dataflow.md`, `./03-model.md`, `./04-decisions.md`
- Use cases: `./05-usecases.md`
- Research codebase analysis: `../01-research/01-codebase-analysis.md`
- Research open questions (with user decisions): `../01-research/02-open-questions.md`

**Produce `06-testcases.md`:**

Provide a test case table with columns: ID, Category, Description, Input, Expected Output, Priority (P0/P1/P2).

Categories:
- **Unit**: Per-function/class tests
- **Integration**: Cross-module interaction tests
- **Regression**: Tests ensuring existing behavior is preserved

Cover ALL 7 fix areas:

1. **Fix #1+#2 (Hooks):**
   - Standalone `useResourceV2Agent` works without plugin registration
   - Standalone `useResourceV2Ref` works without plugin registration
   - Plugin-based hooks still work as before (regression)
   - Standalone hook with SKIP_TOKEN
   - Both paths produce equivalent behavior
   - Integration: plugin-augmentation.test.ts still passes

2. **Fix #3 (Core split):**
   - All existing imports from `core/index.ts` barrel still resolve
   - Internal cross-references between `common/`, `machines/`, `resource/` work
   - Regression: all existing core tests pass without modification

3. **Fix #4 (DevTools):**
   - Agent signals do NOT trigger devtools push
   - CacheEntry signals still trigger devtools push (regression)
   - Custom `beforeDevtoolsPush` on resource config still works for CacheEntry

4. **Fix #5 (Snapshot errors):**
   - Version mismatch throws with descriptive message
   - Key prefix mismatch throws with descriptive message
   - Unknown resource key logs warning and continues
   - Corrupt machine status throws (existing behavior preserved)
   - Valid snapshot hydrates successfully (regression)
   - Multiple entries: one valid + one unknown resource → valid hydrated, unknown warned

5. **Fix #6 (JSDoc):** — No test cases (documentation only).

6. **Fix #7 (Docs):** — No test cases (documentation only).

Also list existing test files that need updating vs. new test files to create. Reference the current test files from the research analysis.

**Produce `08-risks.md`:**

Risk analysis table with columns: ID, Risk, Probability (H/M/L), Impact (H/M/L), Strategy (Accept/Mitigate/Avoid), Mitigation.

Key risks to evaluate:
- Breaking change risk from hooks restructuring (affects consumers)
- Plugin backward compatibility
- Core split breaking internal imports
- DevTools filtering accidentally hiding useful CacheEntry data
- Snapshot error throwing breaking existing SSR flows that expect silent skip
- Version upgrade scenario: app deploys new code, old snapshot in cache → immediate throw
- Cross-fix interaction: fixes #1+#2 + #3 happening simultaneously — merge conflicts, import resolution
- Test coverage gaps for integration paths (Q12 from research)

For each high-impact risk, provide a detailed mitigation plan (2-3 sentences minimum).

---

## Phase 4: Design Review

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing all design documents for the query-v2 fixes design stage.

**Read ALL design documents:**
- `./01-architecture.md`
- `./02-dataflow.md`
- `./03-model.md`
- `./04-decisions.md`
- `./05-usecases.md`
- `./06-testcases.md`
- `./07-docs.md`
- `./08-risks.md`

**Read research documents for traceability check:**
- `../01-research/01-codebase-analysis.md`
- `../01-research/02-open-questions.md` (especially `## User Answers` section)
- `../01-research/README.md`

**Review criteria:**

1. **Research traceability**: Every design decision must trace back to a research finding or a user decision from open questions. Flag any decision that contradicts a user answer (e.g., if the design removes the plugin system, that contradicts Q2 answer).

2. **Internal consistency**: Check that architecture, data flow, model, decisions, use cases, test cases, and risks are all consistent with each other. Use cases must match the architecture. Test cases must cover the use cases. Risks must align with the design choices.

3. **Completeness**: All 7 fixes must have architecture, at least one use case, relevant test cases (except #6 and #7), and risk assessment. Every ADR must have Status, Context, Options, Decision, Consequences.

4. **Feasibility**: Are the proposed changes implementable given the current codebase structure? Cross-check file paths from architecture against the codebase analysis.

5. **Mermaid conformance**: All diagrams must be syntactically valid Mermaid, titled, max 15–20 elements.

6. **Docs proportionality**: `07-docs.md` should be SHORT. Flag if it's too verbose or contains implementation details.

7. **User decision compliance**: Verify each user answer (Q1–Q12) is respected:
   - Q1: Both standalone AND plugin hooks supported
   - Q2: Plugin system preserved
   - Q3: Internal-only restructure, barrel re-exports
   - Q4: Throw on version/prefix mismatch, warn on others
   - Q5: Code change for devtools filtering (agent signals blocked)
   - Q6: Public API JSDoc + magic spot comments
   - Q7: Add to existing doc location
   - Q9: Only barrel public
   - Q10: No devtools opt-out changes
   - Q11: JSDoc + @see for complex concepts

8. **Risk-test coverage**: Every high-priority risk should have at least one test case addressing it. Every P0 test case should correspond to a core design element.

**Output:**

Update `README.md` in this directory with:
- Overview (1-2 sentences)
- Goals and Non-Goals
- Document links (all 8 documents)
- Key Decisions summary (1-line per ADR)
- Quality Review section with a checklist table (criterion, status PASS/WARN/FAIL, notes)
- Next Steps

Set `status` in README.md frontmatter to `Approved` if all criteria pass, or `Needs Revision` if any FAIL.

---
