---
title: "Phases: 01-research"
date: 2026-03-29
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Read the task at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md`.

Trace and document the following areas in `query-v2`. Only facts — no solutions or opinions.

**Area A — CacheMap internals:**
- Entry points: `@/query-v2/core/CacheMap/CompareCacheMap.ts`, `@/query-v2/core/CacheMap/SerializeCacheMap.ts`, `@/query-v2/core/CacheMap/createCacheMap.ts`, `@/query-v2/core/CacheMap/index.ts`
- Trace: internal data structures used by `CompareCacheMap` (how entries are stored, how lookups work — `find`/`findIndex` usage), how `SerializeCacheMap` stores and retrieves entries, and how `createCacheMap` selects between the two strategies.
- Document: the public interface (`@/query-v2/types/cache.types.ts`), all configuration options passed to each CacheMap variant, and the exact lookup/insertion algorithms.

**Area B — Devtools key extraction:**
- Trace how devtools keys are derived from arguments in both `CompareCacheMap` and `SerializeCacheMap`. Find where serialization is called for devtools purposes vs. cache lookup purposes.
- Check devtools integration points: any files in `@/query-v2/` or `@/common/devtools/` that consume cache keys for display.
- Document: the current key derivation flow for both strategies, including any redundant calls.

**Area C — LifecycleHooks ownership:**
- Entry points: `@/query-v2/core/LifecycleHooks.ts`, `@/query-v2/core/resource/ResourceV2.ts`, `@/query-v2/core/resource/ResourceV2CacheEntry.ts`, `@/query-v2/types/lifecycle.types.ts`, `@/query-v2/types/resource.types.ts`
- Trace: where `LifecycleHooks` is instantiated and who owns it (resource-level vs. entry-level). Document how hooks are invoked during entry lifecycle events.
- Map the dependency chain: who creates hooks, who passes them, who calls them.

**Area D — Demo examples:**
- Entry points: `apps/demos/src/examples/query-v2/error-swr-states.tsx` and all other files in `apps/demos/src/examples/query-v2/`
- Trace: how `isError` is used in the query-v2 demo examples. Document what conditions set `isError` to `true` vs. `false` in each example.
- Check if any example creates scenarios where `isError` can actually become `true`, or if they are all hardcoded/configured to never error.

**Area E — Tests:**
- Check tests in `@/query-v2/core/CacheMap/__tests__/`, `@/query-v2/core/__tests__/`, `@/query-v2/__tests__/`, and `@/query-v2/api/__tests__/`.
- List existing test coverage related to CompareCacheMap, SerializeCacheMap, LifecycleHooks, and devtools key extraction.

Scope boundaries: stay within `src/query-v2/`, `src/common/devtools/`, and `apps/demos/src/examples/query-v2/`. Do not investigate `src/query/` (v1) or `src/signals/`.

---

## Phase 2: Problem Analysis — CompareCacheMap data structure and caching (problems #1, #2)

- **Agent**: `rdpi-problem-analyst`
- **Output**: `02-problem-analysis-cache.md`
- **Depends on**: 1
- **Retry limit**: 1

### Prompt

Read the task at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md` — focus on problems #1 and #2.
Read the codebase analysis at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`.

Analyze two related problems in `CompareCacheMap`:

**Problem #1**: `CompareCacheMap` uses an Array with `find`/`findIndex` for entry lookup. The task states it MUST use Map/WeakMap for instant access.
- Examine `@/query-v2/core/CacheMap/CompareCacheMap.ts` — identify the exact lines/methods using Array-based lookup.
- Document expected behavior (O(1) Map/WeakMap lookup) vs. actual behavior (O(n) Array scan).
- Assess the performance impact: what is the typical cache size? How often are lookups performed?
- Check if `SerializeCacheMap` has the same problem or uses a different pattern.

**Problem #2**: `CompareCacheMap` does not support a caching option for instant lookup.
- Document what "caching option" means in context: does the task refer to a secondary Map index alongside the comparison-based storage?
- Compare with `SerializeCacheMap` — does it have any caching mechanism that `CompareCacheMap` lacks?
- Identify the configuration surface: `@/query-v2/types/cache.types.ts` — what options exist today for each CacheMap variant?

For both problems: stay evidence-first. Document expected vs. actual behavior. Identify relevant test cases in `@/query-v2/core/CacheMap/__tests__/` that cover or fail to cover these scenarios. Do not propose solutions.

---

## Phase 3: Problem Analysis — Devtools key extraction (problems #3, #4)

- **Agent**: `rdpi-problem-analyst`
- **Output**: `03-problem-analysis-devtools.md`
- **Depends on**: 1
- **Retry limit**: 1

### Prompt

Read the task at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md` — focus on problems #3 and #4.
Read the codebase analysis at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`.

Analyze two related problems with devtools key derivation:

**Problem #3**: For the comparison strategy, serialization is used when determining the devtools key. The task requires adding an option to specify a custom function for extracting the devtools key from arguments, with default being indices.
- Trace the exact code path in `CompareCacheMap` where devtools keys are generated.
- Document what "serialization is used" means — where is the serialization call, and why is it problematic for comparison-based caches (which don't normally serialize)?
- Document what "default — indices" means — how would index-based keys work for a comparison cache?
- Identify where in the type system (`@/query-v2/types/cache.types.ts`, `@/query-v2/types/shared.types.ts`) such an option would need to be declared.

**Problem #4**: For the serialization strategy, when determining the devtools key, an extra (redundant) serialization call is made.
- Trace the exact code path in `SerializeCacheMap` where devtools keys are generated.
- Identify the redundant serialization: where is the key serialized once for cache lookup and again for devtools? Show the exact locations.
- Document expected behavior (single serialization, reused for devtools) vs. actual behavior (double serialization).
- Check if `@/query-v2/lib/stableStringify.ts` is involved and how.

For both problems: provide exact file locations, line references, and code path traces. Identify relevant test cases. Do not propose solutions.

---

## Phase 4: Problem Analysis — LifecycleHooks ownership and demo isError (problems #5, #6)

- **Agent**: `rdpi-problem-analyst`
- **Output**: `04-problem-analysis-lifecycle-demos.md`
- **Depends on**: 1
- **Retry limit**: 1

### Prompt

Read the task at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md` — focus on problems #5 and #6.
Read the codebase analysis at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`.

Analyze two independent problems:

**Problem #5**: `LifecycleHooks` should belong to `ResourceEntry`, not the resource.
- Examine `@/query-v2/core/LifecycleHooks.ts` — how is the LifecycleHooks class structured?
- Examine `@/query-v2/core/resource/ResourceV2.ts` — where is LifecycleHooks currently instantiated and stored?
- Examine `@/query-v2/core/resource/ResourceV2CacheEntry.ts` — does ResourceEntry currently reference LifecycleHooks at all?
- Document the current ownership: Resource creates/owns hooks → hooks are shared across all entries. Clarify why this is problematic (e.g., per-entry lifecycle events getting mixed up, hooks not scoped to individual cache entries).
- Check `@/query-v2/types/lifecycle.types.ts` and `@/query-v2/types/resource.types.ts` for type-level ownership signals.
- Identify all call sites where LifecycleHooks methods are invoked — are they called with entry context or resource context?

**Problem #6**: In query-v2 interactive examples, the agent incorrectly implemented cases with "isError: false" (isError will always be false).
- Examine `apps/demos/src/examples/query-v2/error-swr-states.tsx` — this is the most likely file with error state demos.
- Check all other files in `apps/demos/src/examples/query-v2/` for `isError` usage.
- Document: what mock/fetch functions do these examples use? Do they ever reject or throw? If not, `isError` can never become `true`.
- Identify the exact code lines where `isError` is checked or displayed, and show why it's always `false`.

For both problems: provide exact file locations and evidence. Identify relevant test cases where applicable. Do not propose solutions.

---

## Phase 5: Open Questions

- **Agent**: `rdpi-questioner`
- **Output**: `05-open-questions.md`
- **Depends on**: 1, 2, 3, 4
- **Retry limit**: 1

### Prompt

Read the task at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/TASK.md`.
Read all available research outputs:
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/02-problem-analysis-cache.md`
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/03-problem-analysis-devtools.md`
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/04-problem-analysis-lifecycle-demos.md`

The task contains 6 problems across CompareCacheMap data structure, caching options, devtools key extraction for both comparison and serialization strategies, LifecycleHooks ownership, and demo correctness.

Generate open questions covering:
- **Technical constraints**: Map vs. WeakMap trade-offs for CompareCacheMap (WeakMap requires object keys — how does this interact with argument comparison?). Can a hybrid approach work?
- **API compatibility**: adding a devtools key extraction option — does this change the public API surface (`createCacheMap`, resource configuration)? Is it a breaking change?
- **Performance trade-offs**: the caching option for CompareCacheMap — what invalidation strategy does it need? How does it interact with the comparison function?
- **Scope ambiguities**: "LifecycleHooks should belong to ResourceEntry" — does this mean each entry gets its own LifecycleHooks instance, or is it a shared instance referenced from each entry? What about hooks that are inherently resource-level (not entry-level)?
- **Migration risks**: moving LifecycleHooks ownership — what downstream consumers or plugins depend on the current structure?
- **Demo fixes scope**: should the demos be fixed to actually demonstrate error states (add failing fetch scenarios), or should the `isError` checks simply be removed?

Classify each question as High/Medium/Low priority. Each question must include: context, options (if applicable), risks, and researcher recommendation.

---

## Phase 6: Research Review

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3, 4, 5
- **Retry limit**: 2

### Prompt

Read all phase outputs in `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/`:
- `01-codebase-analysis.md`
- `02-problem-analysis-cache.md`
- `03-problem-analysis-devtools.md`
- `04-problem-analysis-lifecycle-demos.md`
- `05-open-questions.md`

Update `README.md` in the same directory with:
1. **Summary**: 2-3 paragraphs covering all 6 problems and what was found.
2. **Documents**: linked list of all phase outputs with brief descriptions.
3. **Key Findings**: 5-7 bullets — the most important discoveries across all 6 problems.
4. **Contradictions and Gaps**: any inconsistencies between phase outputs, or areas where evidence is insufficient.
5. **Quality Review**: verify file existence, reference accuracy, source attribution with confidence levels, problem-analysis evidence quality (expected vs. actual documented for each problem), question actionability, no-solutions rule, frontmatter correctness, cross-reference consistency.
6. **Next Steps**: what the design stage needs to address.

Set README.md `status` to `Draft`.

Cross-reference check: verify claims in problem analysis documents against codebase analysis. Ensure all 6 problems from TASK.md are covered with sufficient evidence.

---

# Redraft Round 1

## Phase 7: Fix issue #1

- **Agent**: `rdpi-redraft`
- **Output**: `01-codebase-analysis.md`, `03-problem-analysis-devtools.md`
- **Depends on**: —
- **Retry limit**: 1
- **Review issues**: #1

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/REVIEW.md`.
Your assigned issue: #1.
Affected files: `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`, `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/03-problem-analysis-devtools.md`.

To resolve the discrepancy, check the actual line numbers in `src/query-v2/core/resource/ResourceV2.ts` for the `serializeFn` definition and the factory closure. Update whichever document has the wrong line numbers so both documents agree with the source file.

Fix only your assigned issue.

---

## Phase 8: Fix issue #2

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`, `04-problem-analysis-lifecycle-demos.md`
- **Depends on**: 7
- **Retry limit**: 2
- **Review issues**: #2

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/REVIEW.md`.
Your assigned issue: #2.
Affected files: `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md`, `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/04-problem-analysis-lifecycle-demos.md`.

Audit the plugin directory `src/query-v2/plugins/` for LifecycleHooks dependencies:
- List all files in `src/query-v2/plugins/`.
- For each file, check imports and usage of `LifecycleHooks`, lifecycle types (`lifecycle.types.ts`), or any hook invocation patterns.
- Document findings as a new subsection in Area C of `01-codebase-analysis.md`.
- Update the Scope Boundaries section of `04-problem-analysis-lifecycle-demos.md` to reflect the plugin audit results instead of flagging it as unverified.

Stay evidence-only — no solutions or opinions. Fix only your assigned issue.

---

## Phase 9: Re-review after Redraft Round 1

- **Agent**: `rdpi-research-reviewer`
- **Depends on**: 7, 8
- **Retry limit**: 2

### Prompt

Read REVIEW.md at `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/REVIEW.md`.

Re-verify the files modified during Redraft Round 1:
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/01-codebase-analysis.md` — check that line references for `serializeFn`/factory in §Area B are now consistent with `03-problem-analysis-devtools.md`, and that §Area C now includes a plugin audit subsection.
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/03-problem-analysis-devtools.md` — check that line references for `serializeFn`/factory match `01-codebase-analysis.md` and the actual source file.
- `.thoughts/2026-03-29-1400_query-v2-compare-cache-and-fixes/01-research/04-problem-analysis-lifecycle-demos.md` — check that Scope Boundaries no longer flags the plugin directory as unverified.

Update README.md: refresh the Contradictions and Gaps section and Quality Review checklist items #8 (cross-references) to reflect the resolved issues. Set `status` to `Draft`.
