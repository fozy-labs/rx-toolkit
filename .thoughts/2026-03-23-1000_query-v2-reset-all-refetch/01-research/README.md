---
title: "Research: QueryV2 api.resetAll() Re-fetch for Active Agents"
date: 2026-03-23
status: Review
feature: "After api.resetAll(), active agents should re-fetch their data"
---

## Summary

The research stage investigated the current behavior of `api.resetAll()` in query-v2, its impact on active agents, and how comparable libraries (RTK Query, TanStack Query) handle the "reset all cache → refetch active queries" pattern. The core finding is that **query-v2 has no mechanism to notify agents that a reset occurred or to trigger re-fetching**. When `resetAll()` is called, cache entries are permanently completed and removed, but agents hold stale references to dead entries and have no way to detect the reset or re-bind to fresh entries. The agent's same-args guard in `start()` further prevents re-querying even if `start()` were called again.

External research confirms that TanStack Query's `resetQueries` is the gold-standard implementation: a two-phase design that resets query state and then explicitly refetches all active (observed) queries within a batched notification. RTK Query's `resetApiState` takes a weaker approach — it clears state but relies on hooks to detect the uninitialized state on re-render, with documented pitfalls about hooks getting stuck. The codebase analysis and external research both point to a **push-based notification** model as the preferred architecture, consistent with query-v2's signal-based reactivity.

Eleven open questions were identified, ranging from high-priority architectural decisions (push vs pull notification, how to define "active" agents, how agents re-bind to new cache entries) to lower-priority implementation details (demo approach, test helpers). The open questions are well-structured with options, risks, and researcher recommendations that lean toward a push-based, per-resource signal with clear-and-reload semantics (matching TanStack's `resetQueries`).

## Documents

- [Codebase Analysis](./01-codebase-analysis.md) — Traces `api.resetAll()` → `resource.resetCache()` → `entry.complete()` call chain, agent signal handling, test coverage gaps, demo app structure, and signals infrastructure.
- [External Research](./02-external-research.md) — Comparative analysis of RTK Query `resetApiState` and TanStack Query `resetQueries`, including mechanism details, observer patterns, pitfalls, and performance considerations.
- [Open Questions](./03-open-questions.md) — 11 open questions (4 high, 4 medium, 3 low priority) covering architectural trade-offs for the reset+refetch mechanism.

## Key Findings

1. **No notification mechanism exists**: `resetAll()` → `resetCache()` → `entry.complete()` is a fire-and-forget chain with no pub/sub, event bus, or signal to inform agents. The agent's `_state$` does recompute to `idle`, but the entry is permanently locked (`_completed = true`) and removed from the cache map. (Codebase Analysis §1)
2. **Agent same-args guard blocks re-fetch**: Even if `start(args)` were called after reset, the same-args check at `ResourceV2Agent.ts:130` returns early, making it a no-op. The agent must either nullify `_currentArgs` or bypass the guard to re-query. (Codebase Analysis §2.4)
3. **TanStack Query's two-phase reset is the established pattern**: `resetQueries` explicitly calls `query.reset()` on each matching query, then `refetchQueries({ type: 'active' })` — all within `notifyManager.batch()`. This is the reference architecture for query-v2's fix. (External Research §TanStack Query)
4. **RTK Query's pull-based approach has documented pitfalls**: Hooks can get stuck in loading state if no re-render occurs after `resetApiState`. This is exactly the bug described in TASK.md. (External Research §Pitfalls)
5. **query-v2 has zero test coverage for agent behavior after reset**: All existing `resetAll`/`resetCache` tests only verify cache clearing. No tests check agent reactive state, re-fetch behavior, or React hook integration post-reset. (Codebase Analysis §3)
6. **Existing `invalidate(args)` pattern provides a template**: `resource.invalidate()` already implements single-entry SWR refetch (`MachineSuccess → MachineRefreshing`). The reset+refetch mechanism can follow a similar pattern but with clear-and-reload semantics. (Codebase Analysis §5.5)
7. **Existing demo already demonstrates the bug**: The `simple-resource.tsx` demo has a "Сбросить все ресурсы v2" button that calls `api.resetAll()` — data disappears but does not re-fetch, directly showing the reported issue. (Codebase Analysis §4.6)

## Contradictions and Gaps

- **Line number inaccuracies in codebase analysis**: Several file:line references use approximate or outdated line numbers. For example, `resetCache()` is cited at `ResourceV2.ts:283-302` but is actually at lines 425-449; the `start()` same-args check is cited at `ResourceV2Agent.ts:107-111` but is at line 130. Code snippets and behavioral descriptions are accurate — only the line offsets are wrong. This is a documentation quality issue, not a factual error.
- **No gap between codebase and external research findings**: The codebase analysis's conclusion ("no mechanism exists to notify active agents") is fully consistent with the external research's reference implementations. Both documents agree that a push-based notification is the preferred approach.
- **Missing detail on `Batcher.run` semantics**: The codebase analysis mentions `Batcher.run` for atomic signal updates (§5.1), and the open questions recommend using it for batching (Q6), but neither document details the batching guarantees (e.g., does it coalesce multiple `signal.set()` calls into one notification cycle?). This should be clarified in the design stage.

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | All phases produced output files | PASS | All 3 defined phases (codebase analysis, external research, open questions) have output files present in the stage directory. Verified against PHASES.md. |
| 2 | Codebase analysis has exact file:line references | PARTIAL | File paths are correct and code snippets match actual source. However, several line numbers are off by significant margins (e.g., `ResourceV2.ts:283` vs actual `:425` for `resetCache()`). The `@/` alias paths are used consistently. Behavioral descriptions verified as accurate by spot-checking 3 claims against source. |
| 3 | External research has source + confidence annotations | PASS | Every claim is annotated with confidence level (High/Medium/Low). All external sources have URLs. RTK and TanStack claims are marked High with source code references. Only the auth recipe pattern is Medium. |
| 4 | Open questions are actionable (context, options, risks) | PASS | All 11 questions have Context, Options (2-4 each), Risks, and Researcher recommendation. High/Medium/Low priority is clearly assigned. |
| 5 | No solutions or design proposals in research | PASS | Codebase analysis is facts-only. External research documents patterns without proposing solutions. Open questions contain "Researcher recommendation" leanings which are acceptable per review guidelines — they inform decisions without prescribing solutions. |
| 6 | YAML frontmatter present on all files | PASS | All 3 output files have correct YAML frontmatter with title, date, stage, and role fields. |
| 7 | Cross-references consistent between documents | PASS | Open questions correctly reference codebase analysis findings (e.g., same-args guard, `_completed` flag, `_onClean$`). External research findings about TanStack's two-phase pattern and RTK's pitfalls are consistently cited in open questions. No contradictions found between documents. |

### Issues Found

1. **Line number inaccuracies in codebase analysis** — `01-codebase-analysis.md` §1.4 cites `ResourceV2.ts:283-302` for `resetCache()`, actual location is `:425-449`. §2.4 cites `ResourceV2Agent.ts:107-111` for same-args check, actual is `:130-133`. Multiple other line references are similarly offset. Code snippets and behavioral claims are accurate. **Severity: Low** — line numbers serve as navigational aids; the code snippets embedded in the document are the authoritative reference and they are correct.

## Next Steps

Proceeds to Design stage after human review. The design stage should focus on:

1. **Architecture decision**: Push-based notification mechanism — per-resource reset signal (Q7 Option 2) with agent registration on `start()`/deregistration on `destroy()` (Q2 Option 1).
2. **Agent re-binding strategy**: How agents nullify `_currentArgs` and re-call `start()` with preserved last args (Q3 Option 1).
3. **Reset semantics**: Clear-data-and-show-loading (Q4 Option 1) as the default, matching TanStack's `resetQueries`.
4. **Batching**: Wrap reset + refetch-trigger in `Batcher.run` (Q6 Option 2).
5. **Test plan**: Agent-level + React hook-level tests for reset+refetch behavior (Q10 Option 3).
6. **Demo**: Auth-flow demo with token-gated mock (Q9 Option 3).
