---
title: "Phases: 01-research"
date: 2026-03-28
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read the task at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/TASK.md`.

Analyze the `@/query-v2/` module. Map the following:

**Architecture & data flow:**
- Entry point: `@/query-v2/api/createApi.ts` — how `createApi` initializes resources, handles `initialSnapshot` option, and wires lifecycle hooks.
- Resource creation: `@/query-v2/api/_createResourceV2.ts` — how individual resources are created and configured.
- Core resource: `@/query-v2/core/resource/ResourceV2.ts`, `ResourceV2Agent.ts`, `ResourceV2CacheEntry.ts` — runtime behavior, agent orchestration, cache entry lifecycle.
- State machines: `@/query-v2/core/machines/Machine.ts`, `MachineSuccess.ts`, `MachineError.ts`, `MachinePending.ts`, `MachineRefreshing.ts`, `MachineWithData.ts` — state transitions, how SWR (stale-while-revalidate) is represented, how `isError`/`error` fields propagate through states.
- Patcher: `@/query-v2/core/machines/Patcher.ts` — what it does, how commits work, what "consistency violation" could mean.
- Snapshot: `@/query-v2/core/Snapshot.ts` — snapshot creation, age checking (`maxSnapshotDataAge`), and how snapshots interact with `queryFn` invocation.
- Lifecycle hooks: `@/query-v2/core/LifecycleHooks.ts` — all hooks including `onQueryStarted`, how they are registered and called.
- Cache: `@/query-v2/core/CacheEntry.ts`, `@/query-v2/core/CacheMap/` — cache structure, `$cacheDataLoaded` promise, `resetCache` behavior.
- Plugins: `@/query-v2/plugins/ReactHooksPlugin.ts` — how React hooks integrate with resources.

**Documentation structure:**
- Current docs: `@/docs/query-v2/README.md`, `devtools.md`, `optimistic-updates.md`, `ssr.md`
- Demo app: `@/apps/demos/src/` — what examples exist for query-v2
- Identify what is documented vs. what API surface exists but is undocumented.

**Tests:**
- Map existing test files: `@/query-v2/__tests__/`, `@/query-v2/core/__tests__/`, `@/query-v2/core/machines/__tests__/`, `@/query-v2/core/resource/__tests__/`, `@/query-v2/api/__tests__/`, `@/query-v2/plugins/__tests__/`, `@/query-v2/lib/__tests__/`.
- Note test coverage areas and gaps relevant to the 5 reported bugs.

Scope: Only `@/query-v2/` and its direct dependencies from `@/common/` and `@/signals/`. Do not analyze `@/query/` (v1).

Output only verifiable facts. No solutions or opinions.

---

## Phase 2: External Research

- **Agent**: `rdpi-external-researcher`
- **Output**: `02-external-research.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

Read the task at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/TASK.md`.

Research how comparable data-fetching/query libraries handle the following patterns. Focus on RTK Query, TanStack Query (React Query), SWR (Vercel), and Apollo Client:

1. **Initial/seed data with age checking** — How do these libraries handle pre-populated cache data (equivalent to `initialSnapshot`) and decide whether to refetch? What `staleTime`/`maxAge` semantics do they use?

2. **Lifecycle hooks (onQueryStarted)** — How do RTK Query's `onQueryStarted` and similar hooks work? When are they triggered, what arguments do they receive, what is the typical usage pattern (optimistic updates, side effects)?

3. **SWR error state management** — How do libraries handle the coexistence of stale data and error states? Specifically, when a refetch fails but stale data exists, how are `isError`, `error`, and `data` fields managed? Do any libraries "mask" errors when stale data is available?

4. **Optimistic update rollback (Patcher/commit patterns)** — How do libraries implement optimistic updates with rollback? What consistency guarantees exist during concurrent mutations?

5. **Cache reset and pending promises** — How do libraries handle in-flight promises (like `cacheDataLoaded`) when the cache is reset or invalidated? Do they reject, resolve, or leave hanging?

6. **Documentation patterns for query libraries** — What do well-documented query libraries include? Interactive examples, API references, migration guides, recipe pages?

Cross-reference claims across multiple sources. Annotate findings with confidence levels: High (documented in official docs), Medium (community consensus), Low (single source or opinion). Separate established practices from opinions.

---

## Phase 3: Problem Analysis — Bugs #1, #2, #3

- **Agent**: `rdpi-problem-analyst`
- **Output**: `03-problem-analysis-part1.md`
- **Depends on**: Phase 1, Phase 2
- **Retry limit**: 1

### Prompt

Read the task at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/TASK.md`.
Read the codebase analysis at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/01-codebase-analysis.md`.
Read the external research at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/02-external-research.md`.

Analyze these three reported issues:

**Bug #1: `createApi({ initialSnapshot })` calls `queryFn` despite valid snapshot**
- Trace the code path from `createApi` receiving `initialSnapshot` through to the decision point where `queryFn` is called or skipped.
- Identify where `maxSnapshotDataAge` is checked and how the age comparison works.
- Document expected behavior vs. what likely happens based on code analysis.
- Check `@/query-v2/core/Snapshot.ts` and `@/query-v2/api/createApi.ts` for the snapshot age logic.
- Look for existing tests covering this scenario in `@/query-v2/api/__tests__/` and `@/query-v2/core/__tests__/`.

**Bug #2: `onQueryStarted` lifecycle hook never called (alleged dead code)**
- Trace where `onQueryStarted` is defined, registered, and where it should be invoked.
- Check `@/query-v2/core/LifecycleHooks.ts` and how lifecycle hooks are wired into the resource/agent.
- Determine: is the hook actually dead code, or is the junior developer missing a configuration step?
- Look for tests that verify `onQueryStarted` invocation.

**Bug #3: SWR masks `isError` when `error` object is present**
- Trace the state machine transitions when a refetch fails but stale data exists (SWR scenario).
- Check `MachineError.ts`, `MachineRefreshing.ts`, `MachineWithData.ts` — how `isError` and `error` are derived.
- Document the exact state shape when SWR shows stale data after a failed refetch.
- Determine if `isError` is genuinely masked or if this is expected SWR behavior.

For each bug: document expected vs actual behavior, the exact code path involved, whether reproduction evidence exists (tests, logs), and the root location of the issue. Do NOT propose fixes.

---

## Phase 4: Problem Analysis — Bugs #4, #5

- **Agent**: `rdpi-problem-analyst`
- **Output**: `04-problem-analysis-part2.md`
- **Depends on**: Phase 1, Phase 2
- **Retry limit**: 1

### Prompt

Read the task at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/TASK.md`.
Read the codebase analysis at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/01-codebase-analysis.md`.
Read the external research at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/02-external-research.md`.

Analyze these two reported issues:

**Bug #4: Consistency violation on commit is lost in Patcher**
- Read `@/query-v2/core/machines/Patcher.ts` thoroughly.
- Trace the commit flow: what happens when a commit is applied, what consistency checks exist, and what happens when a violation is detected.
- Determine if violations are silently swallowed, logged but not propagated, or if there is a race condition.
- Check for existing tests in `@/query-v2/core/machines/__tests__/` that cover Patcher commit scenarios.
- Document the exact code path where a consistency violation could be "lost."

**Bug #5: `$cacheDataLoaded` promise hangs on `resetCache`**
- Trace the lifecycle of `$cacheDataLoaded`: where it is created, what resolves it, and what happens when `resetCache` is called.
- Check `@/query-v2/core/CacheEntry.ts`, `@/query-v2/core/CacheMap/`, and `@/query-v2/core/resource/ResourceV2.ts`.
- Determine if `resetCache` clears cache entries without resolving/rejecting pending promises.
- Look for existing tests covering cache reset while `$cacheDataLoaded` is pending.
- Document the exact mechanism that causes the hang.

For each bug: document expected vs actual behavior, the exact code path involved, whether reproduction evidence exists (tests, logs), and the root location of the issue. Do NOT propose fixes.

---

## Phase 5: Open Questions

- **Agent**: `rdpi-questioner`
- **Output**: `05-open-questions.md`
- **Depends on**: Phase 1, Phase 2, Phase 3, Phase 4
- **Retry limit**: 1

### Prompt

Read the task at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/TASK.md`.

Context: The task involves fixing 5 bugs in query-v2 (snapshot age bypass, onQueryStarted lifecycle, SWR error masking, Patcher commit consistency, $cacheDataLoaded hang on resetCache), updating outdated documentation, and adding interactive examples.

Read all available research outputs:
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/01-codebase-analysis.md`
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/02-external-research.md`
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/03-problem-analysis-part1.md`
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/04-problem-analysis-part2.md`

Generate open questions covering:
- **Technical constraints**: Are any of the 5 bugs interconnected? Could fixing one affect another?
- **API compatibility**: Will bug fixes change public API behavior? Are there breaking change risks?
- **SWR semantics**: Is bug #3 actually a bug or intentional SWR behavior? What should the correct semantics be?
- **Lifecycle hooks**: If `onQueryStarted` is genuinely dead code, should it be removed or implemented? What is the intended contract?
- **Documentation scope**: What should the updated docs cover? Is a migration guide needed from query v1 to v2?
- **Interactive examples scope**: What scenarios should examples demonstrate? Query-only (no mutations) per TASK.md item #7.
- **Test coverage**: What test gaps exist for these bugs? Should regression tests be mandatory?
- **Scope ambiguities**: Is item #6 (outdated docs) a full rewrite or incremental update?

Classify each question as High/Medium/Low priority. Include context, options (if applicable), risks, and a recommendation for each.

---

## Phase 6: Research Review

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: Phase 1, Phase 2, Phase 3, Phase 4, Phase 5
- **Retry limit**: 2

### Prompt

Read all research outputs in the stage directory `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/`:
- `01-codebase-analysis.md`
- `02-external-research.md`
- `03-problem-analysis-part1.md`
- `04-problem-analysis-part2.md`
- `05-open-questions.md`
- `README.md` (current state)

Update `README.md` with:
1. **Summary** — 2-3 paragraph overview of what was researched and key findings
2. **Documents** — table linking to each research artifact with brief description

---

# Redraft Round 1

## Phase 7: Fix issues #1, #2

- **Agent**: `rdpi-redraft`
- **Output**: `01-codebase-analysis.md`, `04-problem-analysis-part2.md`
- **Depends on**: Phase 1, Phase 4
- **Retry limit**: 2
- **Review issues**: 1, 2

### Prompt

Read REVIEW.md at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/REVIEW.md`.
Your assigned issues: #1, #2.
Affected files: `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/01-codebase-analysis.md`, `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/04-problem-analysis-part2.md`.
Fix only your assigned issues.

---

## Phase 8: Re-review after Redraft Round 1

- **Agent**: `rdpi-research-reviewer`
- **Depends on**: Phase 7
- **Retry limit**: 2

### Prompt

Read REVIEW.md at `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/REVIEW.md` to understand the issues that were fixed.

Re-verify the following files modified by Phase 7:
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/01-codebase-analysis.md`
- `@/.thoughts/2026-03-28-1000_query-v2-bugfixes-and-docs/01-research/04-problem-analysis-part2.md`

Check that:
1. Line references for `_finishPatch` in `ResourceV2CacheEntry.ts` are now consistent between `01-codebase-analysis.md` §5 and `04-problem-analysis-part2.md` §Bug #4.
2. The self-contradicting paragraph about `$cacheDataLoaded` in `01-codebase-analysis.md` §9 has been rewritten for clarity with a non-contradictory narrative while preserving the correct final conclusion.
3. No other content was inadvertently changed.

Also re-check the full quality review checklist from the original Phase 6 criteria against all research outputs. Update `README.md` accordingly.
3. **Key Findings** — 5-7 bullet points capturing the most important discoveries across all research
4. **Contradictions and Gaps** — any conflicts between documents, missing information, or areas where research was inconclusive
5. **Quality Review** — checklist verifying:
   - All referenced files exist
   - Cross-references between documents are accurate
   - Source attributions include confidence levels
   - Problem analyses contain evidence (expected vs actual, code paths)
   - Open questions are actionable (not vague)
   - No solutions or design proposals leaked into research
   - Frontmatter is correct in all documents
6. **Next Steps** — what the design stage should focus on

Verify cross-references: claims in problem analysis should be traceable to codebase analysis findings. External research patterns should be cited with confidence levels.
