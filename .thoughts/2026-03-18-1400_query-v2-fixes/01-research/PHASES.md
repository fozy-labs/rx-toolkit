---
title: "Phases: 01-research"
date: 2026-03-18
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis — Query v2 Module Structure

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

Analyze the query-v2 module at `@/query-v2/` to document the current state across all 7 fix areas listed in the task. Read `TASK.md` at `.thoughts/2026-03-18-1400_query-v2-fixes/TASK.md` first.

Investigate and document the following:

**1. React hooks & plugin dependency:**
- Read `@/query-v2/plugins/ReactHooksPlugin.ts` and `@/query-v2/plugins/types.ts`.
- Trace how React hooks are currently registered and consumed. Which hooks exist? How does the plugin mechanism work? What would break if hooks were used without registering the plugin?
- Check `@/query-v2/index.ts` for what is exported publicly.

**2. React hooks folder location:**
- Document where React hook code currently lives (expected: `@/query-v2/plugins/`).
- Check if a `@/query-v2/react/` folder exists. Note any imports from other parts of the codebase that reference the current hook locations.
- Check how the original query module (`@/query/react/`) organizes its React hooks for comparison.

**3. Core module organization:**
- Read `@/query-v2/core/index.ts` and list all exports.
- Map each file in `@/query-v2/core/` to a logical category: common utilities, state machines, or resource logic.
- Read `@/query-v2/core/machines/` — list all files and what each machine does.
- Document current grouping and what a `common` / `machines` / `resource` split would look like.

**4. DevTools agent state logging:**
- Search for devtools integration points in query-v2. Check `@/query-v2/` for any devtools-related imports or references.
- Look at `@/common/devtools/` for the shared devtools infrastructure.
- Trace what data is currently sent to devtools from query-v2 agents (`ResourceV2Agent.ts` and any agent-like constructs). Identify where agent state logs are emitted.

**5. Snapshot loading error handling:**
- Read `@/query-v2/snapshot/Snapshot.ts` fully.
- Trace the snapshot loading flow. What happens when loading fails? Is the failure silent? What error paths exist?
- Check `@/query-v2/snapshot/__tests__/` for existing test coverage of failure scenarios.

**6. JSDoc coverage:**
- Scan public API surface in `@/query-v2/api/` — list all exported functions/types and whether they have JSDoc.
- Check `@/query-v2/core/ResourceV2.ts` and `@/query-v2/core/CacheEntry.ts` for JSDoc on key methods.
- Note what percentage of public APIs currently have JSDoc vs. are undocumented.

**7. Optimistic update snapshot content:**
- Read `@/query-v2/snapshot/Snapshot.ts` to understand what data is captured in a snapshot.
- Read `docs/query-v2/optimistic-updates.md`, `docs/query-v2/api-reference.md`, and `docs/query-v2/ssr.md`.
- Document what data fields are included in a snapshot, especially during optimistic updates. Note whether any of the three doc files currently describe snapshot contents.

Output format: One section per fix area (numbered 1–7), each containing factual findings with file paths using `@/` notation. Include a final section listing all files that would be affected by the fixes. No solutions — only facts.

---

## Phase 2: Open Questions

- **Agent**: `rdpi-questioner`
- **Output**: `02-open-questions.md`
- **Depends on**: 1
- **Retry limit**: 1

### Prompt

Read the task description at `.thoughts/2026-03-18-1400_query-v2-fixes/TASK.md` and the codebase analysis at `.thoughts/2026-03-18-1400_query-v2-fixes/01-research/01-codebase-analysis.md`.

Based on these, formulate open questions across the 7 fix areas. Focus on:

- **Technical constraints**: What breaks if hooks move out of the plugin system? Are there circular dependency risks in the core split? Does the devtools integration have configuration options for filtering?
- **API compatibility**: Will removing the plugin requirement for React hooks change the public API? Will the core split change import paths for existing consumers?
- **Scope ambiguities**: What counts as "key code locations" for JSDoc — only public APIs or also internal critical paths? Which specific snapshot fields matter for optimistic update documentation?
- **Risks**: What is the test coverage for each affected area? Are there integration tests that would need updating?
- **Dependencies between fixes**: Do any of the 7 fixes conflict or depend on each other? (e.g., moving hooks to `react/` and making them plugin-independent are related)

For each question, provide:
- **Context**: Why this question matters
- **Options**: Possible answers (if applicable)
- **Risk**: What happens if the question is answered wrong
- **Priority**: High / Medium / Low

Classify questions as High priority if they could block implementation, Medium if they affect quality, Low if they are nice-to-know.

---

## Phase 3: Research Review

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2
- **Retry limit**: 2

### Prompt

Review all research outputs for the query-v2 fixes research stage:

- Codebase analysis: `.thoughts/2026-03-18-1400_query-v2-fixes/01-research/01-codebase-analysis.md`
- Open questions: `.thoughts/2026-03-18-1400_query-v2-fixes/01-research/02-open-questions.md`

Update the README.md at `.thoughts/2026-03-18-1400_query-v2-fixes/01-research/README.md`, preserving its frontmatter and adding:

1. **Summary**: 2–3 sentence overview of what the research found across the 7 fix areas.
2. **Documents**: Links to phase outputs with brief descriptions.
3. **Key Findings**: 5–7 bullet points capturing the most important facts discovered — e.g., current hook registration mechanism, core module boundaries, devtools data flow, snapshot error handling gaps, JSDoc coverage level.
4. **Contradictions and Gaps**: Any inconsistencies between the task description and what was found in the code, or areas where the codebase analysis couldn't fully answer a question.
5. **Quality Review**: Verify:
   - All file paths referenced in phase outputs actually exist
   - Claims are backed by specific code references
   - No solutions or design proposals leaked into research
   - Frontmatter is correct in all phase output files
   - Cross-references between documents are consistent
6. **Next Steps**: What the design stage should prioritize based on the findings.

Set README.md status to `Complete` if quality checks pass, or `Needs Review` with notes if issues are found.

---
