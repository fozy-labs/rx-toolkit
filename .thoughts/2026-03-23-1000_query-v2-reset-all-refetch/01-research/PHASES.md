---
title: "Phases: 01-research"
date: 2026-03-23
stage: 01-research
---

# Phases: 01-research

## Phase 1: Codebase Analysis — resetAll Mechanism, Agents, Tests, Demo

- **Agent**: `rdpi-codebase-researcher`
- **Output**: `01-codebase-analysis.md`
- **Depends on**: —
- **Retry limit**: 2

### Prompt

You are researching the query-v2 module in the rx-toolkit repository. Your goal is to document how `api.resetAll()` works and how agents respond to reset signals. **No solutions or opinions — only verifiable facts.**

Read the TASK.md at `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/TASK.md` for context.

Investigate the following areas and document your findings in `01-codebase-analysis.md`:

**1. resetAll Implementation**
- Start from the public API surface: `@/query-v2/api/` — find how `resetAll` is defined and exported.
- Trace the signal/event it produces. Look at `@/query-v2/core/` for any reset signal types (e.g., `ResetAllSignal`, `ResetSignal`, or similar).
- Document the full call chain: `api.resetAll()` → signal emission → signal propagation → subscribers.
- Check `@/query-v2/index.ts` for what is publicly exported related to reset.

**2. Agent Signal Handling**
- Investigate how each agent type handles reset signals:
  - **Resource** agents: look in `@/query-v2/core/` for Resource-related files. How does a Resource subscribe to and react to a reset signal? Does it clear cache? Does it trigger a refetch?
  - **Operation** agents: same investigation for Operation.
  - **Command** agents: same investigation for Command.
- For each agent type, document: what happens to cached data on reset, what happens to active subscriptions, whether any refetch/re-execution logic exists.
- Pay attention to the agent lifecycle — how does the agent know it's "active" (has subscribers/is mounted)?

**3. Test Coverage for resetAll**
- Search for existing tests related to `resetAll` in `@/query-v2/__tests__/` and any `*.test.ts` files within the query-v2 module.
- Also check `@/src/__tests__/integration/` for integration tests involving resetAll.
- Document: which scenarios are tested, which are missing (based on your code analysis), whether React integration tests exist for resetAll.

**4. Demo App Structure**
- Examine `@/apps/demos/` — look at the folder structure, routing setup, and how existing examples are organized.
- Check `@/apps/demos/src/examples/` for existing demo patterns.
- Document: how to add a new example page, what utilities exist in `@/apps/demos/src/utils/`, how the demo app connects to the library.

**5. Signals Infrastructure (if applicable)**
- Check if query-v2 uses the signals module (`@/signals/`) for its reactivity. If so, document how the reset signal flows through the signals infrastructure.
- Look for any `invalidate`, `refetch`, or `refresh` patterns already present in the codebase that could be relevant.

Reference all file paths using the `@/` alias (e.g., `@/query-v2/core/Resource.ts`). Include code snippets for critical sections. Use Mermaid diagrams to visualize signal flow if the chain involves more than 3 steps.

---

## Phase 2: External Research — Reset+Refetch Patterns in Query Libraries

- **Agent**: `rdpi-external-researcher`
- **Output**: `02-external-research.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are researching how established query/data-fetching libraries handle the pattern of "reset all cache → refetch active queries." This research supports a feature where `api.resetAll()` should cause active agents to re-fetch after cache is cleared.

Read the TASK.md at `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/TASK.md` for context.

Investigate the following and document findings in `02-external-research.md`:

**1. RTK Query (Redux Toolkit Query)**
- How does `api.util.resetApiState()` work? Does it trigger refetches for active subscriptions?
- How does RTK Query track "active" queries (subscriptions)?
- What is the behavior after reset: do mounted components automatically refetch, or does the user need to trigger it manually?
- Document the mechanism: signal/action → middleware → cache invalidation → subscription notification → refetch.

**2. TanStack Query (React Query)**
- How does `queryClient.resetQueries()` differ from `queryClient.invalidateQueries()` and `queryClient.removeQueries()`?
- What happens to active observers when queries are reset?
- How does React Query determine which queries are "active" and should refetch?
- Document the observer pattern used to trigger refetches on mounted components.

**3. Common Patterns and Best Practices**
- What is the typical UX pattern for "logout → reset → re-login" in SPAs? How do query libraries support this?
- Is there a consensus on whether reset should clear cache only vs. clear+refetch?
- Any known pitfalls: race conditions, stale closures, unmounted components receiving refetch signals?

**4. Authentication/Logout Use Case**
- How do developers typically implement "logout resets all data" using these libraries?
- Are there recommended patterns for the auth flow (single API instance, reset on logout)?

**Skepticism directive**: Cross-reference claims between official documentation and community sources. Annotate each finding with a confidence level:
- **High**: from official docs or source code
- **Medium**: from well-known community guides or widely-adopted patterns
- **Low**: from blog posts, forums, or single sources

Provide URLs for all sources cited.

---

## Phase 3: Open Questions — Gaps, Trade-offs, and Ambiguities

- **Agent**: `rdpi-questioner`
- **Output**: `03-open-questions.md`
- **Depends on**: 1, 2
- **Retry limit**: 1

### Prompt

You are synthesizing open questions and unresolved trade-offs for the feature: "After `api.resetAll()`, active query-v2 agents should re-fetch their data."

Read these files for context:
- TASK.md: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/TASK.md`
- Codebase analysis: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/01-codebase-analysis.md`
- External research: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/02-external-research.md`

Based on both research outputs, generate a structured list of open questions. Each question must include:
- **Context**: why this question matters
- **Options**: possible answers or approaches (if applicable)
- **Risks**: what could go wrong if the question is answered incorrectly
- **Recommendation**: the researcher's suggested direction based on evidence

**Categories of questions to consider:**

1. **Technical Constraints** — Are there architectural limitations in how signals propagate that would prevent refetch? Does the agent lifecycle support detecting "active" state?
2. **API Compatibility** — Would adding refetch-on-reset change the public API contract? Are there existing consumers that depend on the current "reset without refetch" behavior?
3. **Scope Boundaries** — Should all agent types (Resource, Operation, Command) refetch on reset, or only Resource? What about agents with parameters — should they refetch with last-used params?
4. **Performance Trade-offs** — If many agents are active, does a simultaneous refetch cause a thundering-herd problem? Should refetches be batched or staggered?
5. **Test Strategy** — What test infrastructure exists for testing reset+refetch? Are there helpers for simulating active subscriptions in tests?
6. **Demo Scope** — What is the minimal auth demo that demonstrates the feature? Does it need a mock auth backend?

Classify each question as **High**, **Medium**, or **Low** priority based on its impact on the design stage.

---

## Phase 4: Research Review — Synthesize and Verify

- **Agent**: `rdpi-research-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 1, 2, 3
- **Retry limit**: 2

### Prompt

You are reviewing and synthesizing the research outputs for the feature: "After `api.resetAll()`, active query-v2 agents should re-fetch their data."

Read all phase outputs:
- Codebase analysis: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/01-codebase-analysis.md`
- External research: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/02-external-research.md`
- Open questions: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/03-open-questions.md`

Also read the original task: `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/TASK.md`

Update the `README.md` at `.thoughts/2026-03-23-1000_query-v2-reset-all-refetch/01-research/README.md`. Preserve the existing frontmatter but set `status: Done` if review passes, or `status: Inprogress` if issues found. Write/update the body with:

1. **Summary** — 2-3 paragraph overview of what was researched and key conclusions
2. **Documents** — list of all phase output files with brief descriptions
3. **Key Findings** — 5-7 bullet points of the most important facts discovered
4. **Contradictions and Gaps** — any conflicts between codebase analysis and external research, or areas where information is incomplete
5. **Quality Review** — checklist:
   - [ ] All referenced files exist in the stage directory
   - [ ] Code paths described in codebase analysis are accurate (spot-check 2-3 claims by examining the actual source files)
   - [ ] External research sources have URLs and confidence levels
   - [ ] Open questions are actionable and include context/options/risks/recommendation
   - [ ] No solutions or design proposals are present in research outputs (facts only)
   - [ ] Frontmatter is correct on all documents
   - [ ] Cross-references between documents are consistent
6. **Next Steps** — what the design stage should focus on based on research findings

If any quality check fails, document the failure clearly. The orchestrator will decide whether to proceed or request fixes.

---
