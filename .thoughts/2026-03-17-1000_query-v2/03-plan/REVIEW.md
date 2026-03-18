---
title: "Review: 03-plan"
date: 2026-03-18
status: Approved
stage: 03-plan
---

## Source

Reviewer agent (`rdpi-plan-reviewer`) output in README.md Quality Review section + approval gate sanity check (file existence, criteria coverage).

## Issues Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 3

## Issues

1. **Architecture folder structure doesn't list `lib/stableStringify.ts`**
   - What's wrong: Design architecture §4 folder layout only lists `SKIP_TOKEN.ts` and `NO_VALUE.ts` under `lib/`, but the plan correctly creates `stableStringify.ts` there (Task 1.3). Minor design omission, plan is correct.
   - Where: `01-foundation.md` Task 1.3 vs design `01-architecture.md` §4
   - Expected: Architecture §4 should have listed `stableStringify.ts` under `lib/`
   - Severity: Low
   - Source: Reviewer
   - Checklist item: #2

2. **R1 (TS2589) early type prototype not tracked as dedicated task**
   - What's wrong: Risk R1 mitigation step 1 recommends creating a standalone type prototype before implementing full ResourceV2. The plan defines `PluginAugmentations` in Phase 1 but the 2-plugin type validation test is only in Phase 6 (Task 6.4, PL6).
   - Where: Cross-reference `08-risks.md` R1 vs Phase 6 Task 6.4
   - Expected: Optional — a Phase 1 subtask or note about verifying `PluginAugmentations` compiles with 2+ mock plugins
   - Severity: Low
   - Source: Reviewer
   - Checklist item: #15

3. **`ICacheEntry.onClean$: Observable<void>` from model not addressed in plan**
   - What's wrong: Model §1.5 defines `onClean$` on `ICacheEntry`, but Task 3.2 describes CacheEntry purely via Signal.state per ADR-7 and does not mention `onClean$`. May be a remnant from an earlier design iteration.
   - Where: `03-cache-layer.md` Task 3.2 vs design `03-model.md` §1.5
   - Expected: Task 3.2 should acknowledge `onClean$` and either implement it or note it's replaced by `complete()` per ADR-7
   - Severity: Low
   - Source: Reviewer
   - Checklist item: #6

## Recommendations

- Consider adding a brief note in Phase 1 (Task 1.1) to verify `PluginAugmentations` compiles with 2 mock plugins — catches TS2589 early without a separate task.
- The `onClean$` question can be resolved by the implementing agent in Phase 3 — just ensure alignment with ADR-7 is documented.
