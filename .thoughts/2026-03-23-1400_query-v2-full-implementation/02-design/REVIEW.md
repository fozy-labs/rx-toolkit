---
title: "Review: 02-design"
date: 2026-03-25
status: Approved
stage: 02-design
---

# Approval Gate Review — 02-design (Gate Round 10)

## Source

Phase 76 reviewer output (all 35 Low-severity issues verified resolved, 0 regressions, all 10 checklist items PASS) + Approval Gate sanity check (document existence, issue resolution verification, checklist completeness, user feedback compliance).

## Issues Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

## Issues

No issues found.

All issues across all severity levels have been resolved:
- 2 Critical (CRI-1, CRI-2) — resolved in Redraft Round 13
- 10 High (#3–#12) — resolved in Redraft Round 13
- 12 Medium (#13–#24) — resolved in Redraft Round 13
- 35 Low (LOW-A1–A6, LOW-D1–D7, LOW-M1–M6, LOW-U1–U4, LOW-T1–T14) — resolved in Redraft Round 14, verified by Phase 76

### Sanity Check Results (Gate Round 10)

| Check | Status |
|-------|--------|
| All 8 design documents exist and are non-empty | ✅ |
| README.md Quality Review covers all 10 expected criteria | ✅ |
| All 10 checklist items marked PASS | ✅ |
| All 35 Low issues have per-issue evidence in README | ✅ |
| User feedback ("fix all Low issues") fully addressed | ✅ |
| Regression spot-checks (11 prior issues) all clear | ✅ |
| No new issues detected | ✅ |

## Recommendations

None. After 14 redraft rounds across 76 phases — including a comprehensive 20-agent parallel verification audit (Verification Round 13, Phases 48–67) and targeted Low-issue fixes (Phases 72–75) — the design is thorough and internally consistent. Ready for 03-plan.

---

## Previous Gate History

## Issues

### Critical

**1. `createPatch` return type mismatch (CRI-1)**
- What's wrong: Architecture §5.1 class diagram shows `MachineWithData.createPatch(patchFn): IPatchHandle | null`, but tests SM31 expect `{ machine, patchHandle }` — i.e. both a new immutable machine instance AND a handle. Machines are immutable (transitions return new instances), so `createPatch` must return the new machine alongside the handle.
- Where: 01-architecture.md §5.1 vs 06-testcases.md SM31
- What's expected: Architecture and model must define the correct return type for `createPatch` — likely `{ machine: MachineWithData<TData>, patchHandle: IPatchHandle } | null`
- Severity: Critical
- Source: Verification (57-cross-01x06)
- Checklist item: #10 (internal consistency)

**2. Args-change abort behavior contradiction (CRI-2)**
- What's wrong: Tests RE11/INT12 assert that changing agent args **aborts** the inflight request for the old entry. Dataflow §1.5 explicitly says the old request **continues independently** — abort only happens within the same entry. These are mutually exclusive behaviors. A design decision is required.
- Where: 06-testcases.md RE11/INT12 vs 02-dataflow.md §1.5
- What's expected: One authoritative behavior — either args-change aborts old entry's request (update dataflow), or it doesn't (update tests). The dataflow rationale (shared cache — other consumers may still need args1 data) is architecturally sound.
- Severity: Critical
- Source: Verification (67-cross-06x02)
- Checklist item: #10 (internal consistency)

### High

**3. plugins/ layer number contradiction**
- What's wrong: ADR-1 says plugins are "alongside api/" (Layer 3), architecture shows Layer 5.
- Where: 04-decisions.md ADR-1 vs 01-architecture.md §2
- What's expected: Consistent layer number.
- Severity: High
- Source: Verification (56-cross-01x04)

**4. `_lastEntry$` type mismatch**
- What's wrong: Architecture says `ResourceV2CacheEntry`, ADR-11 says `CacheEntry`.
- Where: 01-architecture.md §5.2 vs 04-decisions.md ADR-11
- What's expected: Consistent type for `_lastEntry$` signal.
- Severity: High
- Source: Verification (56-cross-01x04)

**5. patchState double ownership**
- What's wrong: Both MachineWithData and RCE define patchState/createPatch — unclear which entity owns patchState.
- Where: 01-architecture.md §5.1 vs §5.2 and 04-decisions.md ADR-6
- What's expected: Clear ownership boundary documented.
- Severity: High
- Source: Verification (56-cross-01x04)

**6. ResourceV2 missing 4 methods**
- What's wrong: Tests reference `resetCache`, `cacheEntries`, `hydrateEntry`, `hasEntry` on ResourceV2, but architecture class diagrams don't show them.
- Where: 01-architecture.md §5.2 vs 06-testcases.md RE14–RE18
- What's expected: Architecture must document all methods (public or internal).
- Severity: High
- Source: Verification (57-cross-01x06)

**7. `createCacheMap()` factory absent from architecture**
- What's wrong: Tests CM-F04/F05 reference `createCacheMap()` factory, architecture only shows concrete classes.
- Where: 01-architecture.md vs 06-testcases.md CM-F04/F05
- What's expected: Factory function documented in architecture.
- Severity: High
- Source: Verification (57-cross-01x06)

**8. `IResourceV2CacheEntry` interface absent from architecture**
- What's wrong: Tests reference `IResourceV2CacheEntry` as consumer-facing interface, architecture only shows class.
- Where: 01-architecture.md §5.2 vs 06-testcases.md AG14/RE07
- What's expected: Public interface vs implementation class distinction.
- Severity: High
- Source: Verification (57-cross-01x06)

**9. `initialSnapshot` mechanism unmodeled in architecture**
- What's wrong: The dominant hydration path (`createApi({initialSnapshot})` with lazy per-resource consumption) is not modeled in architecture §3a — no `_savedSnapshot` internal field, no `initialSnapshot` in options.
- Where: 01-architecture.md §3a vs 06-testcases.md AP08/SN07–SN12
- What's expected: Architecture diagrams show `initialSnapshot` and `_savedSnapshot` lifecycle.
- Severity: High
- Source: Verification (57-cross-01x06)

**10. LifecycleHooks lacks method specifications**
- What's wrong: Architecture has LifecycleHooks box but no methods specified.
- Where: 01-architecture.md
- What's expected: Hook method signatures listed.
- Severity: High
- Source: Verification (57-cross-01x06)

**11. Machine transition methods missing from model**
- What's wrong: Model §3 has state type definitions but no `start`, `successHappened`, `errorHappened` transition method signatures on machine classes.
- Where: 03-model.md vs 02-dataflow.md diagrams showing transitions
- What's expected: Model defines machine class methods, not just state shapes.
- Severity: High
- Source: Verification (58-cross-02x03)

**12. Success→Pending transition at entry level incorrect**
- What's wrong: An agent-level transition (SWR) is described as if it occurs at the entry level in dataflow/model context.
- Where: 02-dataflow.md / 03-model.md
- What's expected: Clear separation of entry-level vs agent-level transitions.
- Severity: High
- Source: Verification (58-cross-02x03)

### Medium

**13.** Layer count "4-layer" in text but diagrams show 5 layers (56)
**14.** `_signal$` vs `_state$`/`_value$` naming inconsistency (56)
**15.** SKIP vs SKIP_TOKEN naming inconsistency (56)
**16.** Missing RxJS dependency in formal dependency diagram §4 (56)
**17.** ResourceV2 concrete class not in model (58)
**18.** `hydrateEntry()` not in model (58)
**19.** resetAll "abort patches" contradiction between documents (59)
**20.** SM24 test references `refreshing.patches` but model uses `patchState.patches` (61)
**21.** AG12 test references `state$.obs` not defined on ComputeFn (61)
**22.** LH06 test says "resolves with data" but type is `Promise<{data: TData}>` (61)
**23.** patchState on machine state vs RCE in UC-5 comment (63)
**24.** `compareArg` typing `(a: unknown, b: unknown)` vs typed at API level (64)

### Low (35 total)

34 Low issues detailed across individual verification files (48–55) + 1 from individual check (01-architecture.md missing Machines→Patcher edge in §4). Primarily: naming inconsistencies, test organizational labels, missing edge cases in test coverage, numbering gaps (RE17, AP07), documentation-only concerns.

## Recommendations

1. **CRI-2 (args-change abort)** is a genuine design decision that needs human input. The dataflow rationale (shared cache entries shouldn't be aborted by one consumer switching away) is architecturally sound. Consider correcting the tests to match the dataflow, not the other way around.
2. **CRI-1 (createPatch return type)** likely needs architecture + model alignment — check what `03-model.md` says and align all three (model, architecture, tests).
3. Most High issues are concentrated in **01-architecture.md** — the architecture document is the least detailed and hasn't kept pace with model/tests evolution over 12 redraft rounds. A focused architecture update pass would resolve issues 3–10.
4. Many Medium/Low issues are cross-document naming inconsistencies that a single normalization pass could fix.
5. Consider whether all 58 issues need fixing before proceeding to Plan, or whether High/Medium/Low can be deferred to implementation where the code itself will be the source of truth.

## User Feedback

Not Approved — fix Critical + High + Medium issues.

## Recommendations

Design is clean. 49 issues resolved across 12 redraft rounds. Phase 47 verified Issue #49 with x10 thoroughness. Approval gate sanity check independently confirmed ADR-12 correctness and absence of contamination. The design stage is ready to proceed to 03-plan.

## User Feedback (pending)

Awaiting user decision.

---

User did not approve. 4 issues (Round 3):

### Issue #37 — TArgs должны быть типизированы везде (Severity: High)
**Description**: TArgs непоследовательно типизированы — в одних объектах `TArgs`, в других `unknown`, в дженериках часто указан только `<TData>` вместо `<TArgs, TData>`. Все дженерики по всему дизайну должны быть `<TArgs, TData>`.

### Issue #38 — CacheMap: TEntry должен быть явно определён (Severity: High)
**Description**: Нужно явно решить: CacheMap знает про CacheEntry или нет. Если `ICacheMap<TArgs, TEntry>` — `TEntry` или должен наследоваться от `CacheEntry` (constraint), или называться по-другому. Это правило применимо ко всем местам, где TEntry используется.

### Issue #39 — Исправить существующие issues (Medium + Low) (Severity: Medium)
**Description**: Исправить 2 оставшихся замечания ревьюера: useEventHandler в C4 L1 / ADR-19 и disconnected node в §5.2 dataflow.

### Issue #40 — Агрессивная перепроверка всего дизайна (Severity: High)
**Description**: Еще раз «агрессивно» перепроверить все документы на внутреннюю согласованность.

### User Issues Resolution — Round 1 (16/16 resolved)

| # | Issue | Severity | Resolved |
|---|-------|----------|----------|
| 1 | V2 suffix consistently applied | High | ✅ |
| 2 | Commands removed completely | High | ✅ |
| 3 | Dependency chain explicit | Critical | ✅ |
| 3.1 | No direct ResourceV2 → CacheEntry dependency | Critical | ✅ |
| 4 | useOperationV2 / useResourceV2 removed | High | ✅ |
| 5 | Design differentiated from legacy | High | ✅ |
| 6 | ResourceV2CacheEntry inherits CacheEntry | Critical | ✅ |
| 7 | Private fields in class diagrams | Medium | ✅ |
| 8 | Batcher.run() optional for single changes | Medium | ✅ |
| 9 | CacheMap has no knowledge of CacheEntry | Critical | ✅ |
| 10 | GC timer uses share({resetOnRefCountZero}) | High | ✅ |
| 11 | ResourceV2CacheEntry has invalidate(), query() | High | ✅ |
| 12 | Patcher output with isConsistencyViolation | High | ✅ |
| 13 | "snapshot" variable renamed | Low | ✅ |
| 14 | Plugin augmentation: PluginAugmentations\<TPlugin\> | High | ✅ |
| 15 | Pending state data typed as TData \| null | High | ✅ |
| 16 | Generic type inference noted | Low | ✅ |

### User Issues Resolution — Round 2 (10/10 resolved)

| # | Issue | Severity | Resolved |
|---|-------|----------|----------|
| 17 | Operations/OperationV2 completely removed | High | ✅ |
| 18 | No `_inflightMap`; abort at RCE level | High | ✅ |
| 19 | CacheMap: serialize vs compare different implementations | High | ✅ |
| 20 | Boolean "is" prefix | Medium | ✅ |
| 21 | `machine$` is a signal, not a method | Medium | ✅ |
| 22 | No SharedOptions/DefaultOptions | High | ✅ |
| 23 | getOrCreate with factory | High | ✅ |
| 24 | Agent works with RCE, queryFn executed by RCE | High | ✅ |
| 25 | Agent does NOT depend on Resource | High | ✅ |
| 26 | Resource.invalidate delegates to RCE.invalidate | Medium | ✅ |

### Reviewer Issues — Round 7 (3/3 resolved, 1 Low skipped)

| # | Issue | Severity | Resolved |
|---|-------|----------|----------|
| R7-1 | 3 OperationV2 scope-exclusion mentions | Medium | ✅ |
| R7-2 | `refreshError` missing from `IResourceV2AgentState` | Medium | ✅ |
| R7-3 | "declaration merging" in plugin test strategy | Low | ✅ |
| R7-4 | Research ref anchors contain "Command" | Low | Skipped (acceptable) |

## Recommendations

None. After 7 redraft rounds across 8 review cycles, the design is comprehensive and internally consistent. All 26 user issues and all reviewer issues resolved.

## User Feedback

User did not approve. 10 new issues identified (Round 3):

### Issue #27 — No separate resetAllCacheV2(), only api.resetAll() (Severity: High)
**Location**: All design documents
**Description**: Вводить отдельно `resetAllCacheV2()` не нужно, только `api.resetAll()`.

### Issue #28 — "Snapshot" → "CacheEntry" dependency in C4 unclear (Severity: Medium)
**Location**: `01-architecture.md` (C4 diagrams)
**Description**: Непонятно, что за "Snapshot" зависит от "CacheEntry" в C4. Если эта зависимость корректна — уточнить что за snapshot; если некорректна — поправить.

### Issue #29 — Verify all C4 diagrams against previous 2 rounds of feedback (Severity: High)
**Location**: `01-architecture.md`
**Description**: Проверить все C4 диаграммы на корректность к замечаниям из 2 предыдущих раундов утверждения.

### Issue #30 — common/useEventHandler has no references in Module Dependency Diagram (Severity: Medium)
**Location**: `01-architecture.md` ("Module Dependency Diagram — All Internal Connections")
**Description**: На `common/useEventHandler` никто не ссылается — это корректно? Если нет — убрать или исправить.

### Issue #31 — Remove refreshError, onRefreshError, notifyRefreshError (Severity: High)
**Location**: All design documents
**Description**: `refreshError`, `onRefreshError`, `notifyRefreshError` — убираем, т.к. они не нужны.

### Issue #32 — Dataflow diagrams don't show what and when is returned (Severity: High)
**Location**: `02-dataflow.md` (especially "1.2 Stale-While-Revalidate (Args Change)" and others)
**Description**: Dataflow диаграммы частично не показывают, что и когда возвращается.

### Issue #33 — "1.3 Cache Hit (Same Args)" contains meaningless entities (Severity: Medium)
**Location**: `02-dataflow.md` §1.3
**Description**: Содержит сущности, которые не несут смысла. Упростить.

### Issue #34 — "1.7 GC Lifecycle" — abort patches не обоснован (Severity: Medium)
**Location**: `02-dataflow.md` §1.7
**Description**: Не понятно зачем делать "abort patches". Если добавлено ошибочно — поправить, если всё верно — пояснить.

### Issue #35 — "1.7 GC Lifecycle" — возможно должен содержать abortController.abort() (Severity: Medium)
**Location**: `02-dataflow.md` §1.7
**Description**: Проверить, должен ли GC Lifecycle содержать `abortController.abort()`. Перепроверить и при необходимости поправить.

### Issue #36 — "3.4 ReactHooksPlugin Lifecycle" — disconnected graph (Severity: Medium)
**Location**: `02-dataflow.md` §3.4
**Description**: Связь "React Component" → "useResourceV2Agent" отделена от основного графика. Либо вынести в отдельный блок, либо доработать этот.
