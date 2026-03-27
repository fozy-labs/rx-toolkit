# Verification Round 13 — Summary

## Individual File Checks (8 agents)

| Phase | File | Verdict | Issues |
|-------|------|---------|--------|
| 48 | 01-architecture.md | FAIL | 1 Low: missing Machines→Patcher edge in §4 |
| 49 | 02-dataflow.md | PASS | 2 minor observations (non-blocking) |
| 50 | 03-model.md | PASS | 0 issues |
| 51 | 04-decisions.md | PASS | 0 issues |
| 52 | 05-usecases.md | PASS | 0 issues |
| 53 | 06-testcases.md | PASS | 0 issues |
| 54 | 07-docs.md | PASS | 0 issues |
| 55 | 08-risks.md | PASS | 0 issues |

**Result**: 7/8 PASS. All previous 49 issues + reviewer issues verified as resolved with zero regressions. One Low-severity gap in 01-architecture.md.

---

## Cross-File Consistency Checks (12 agents)

| Phase | Pair | Verdict | Critical | High | Medium | Low |
|-------|------|---------|----------|------|--------|-----|
| 56 | 01-arch × 04-decisions | INCONSISTENT | 0 | 3 | 4 | 0 |
| 57 | 01-arch × 06-testcases | INCONSISTENT | 1 | 5 | 6 | 3 |
| 58 | 02-dataflow × 03-model | INCONSISTENT | 0 | 2 | 2 | 3 |
| 59 | 02-dataflow × 05-usecases | INCONSISTENT | 0 | 0 | 1 | 3 |
| 60 | 03-model × 02-dataflow | CONSISTENT | 0 | 0 | 0 | 2 WARN |
| 61 | 03-model × 06-testcases | INCONSISTENT | 0 | 0 | 3 FAIL | 14 WARN |
| 62 | 04-decisions × 01-arch | CONSISTENT | 0 | 0 | 0 | 1 |
| 63 | 04-decisions × 05-usecases | INCONSISTENT | 0 | 0 | 2 | 3 |
| 64 | 05-usecases × 03-model | INCONSISTENT | 0 | 0 | 1 | 0 |
| 65 | 05-usecases × 04-decisions | CONSISTENT | 0 | 0 | 0 | 0 |
| 66 | 06-tests × 01-arch | INCONSISTENT | 0 | 0 | 1 | 5 |
| 67 | 06-tests × 02-dataflow | INCONSISTENT | 1 | 0 | 2 | 4 |

---

## Critical Issues (2)

### CRI-1: createPatch return type mismatch (57-cross-01x06)
Architecture class diagram `MachineWithData.createPatch` does not include new machine instance in return type, but tests expect `{ machine, patchHandle }`.

**User Feedback**: `MachineWithData.createPatch` must include new machine instance.


### CRI-2: Args-change abort behavior contradiction (67-cross-06x02)
Tests RE11/INT12 assert that changing agent args **aborts** the inflight request for the old entry. Dataflow §1.5 explicitly says the old request **continues independently** — abort only happens within the same entry (on invalidation/force). **Mutually exclusive behaviors — design decision required.**

**User Feedback**: agent do not abort (becouse he does not know if other agents are using the same entry, and aborting would cause unintended consequences for them).

---

## High Issues (10)

1. **plugins/ layer contradiction** (56): ADR-1 says "alongside api/" (Layer 3), architecture shows Layer 5
2. **`_lastEntry$` type mismatch** (56): Architecture says `ResourceV2CacheEntry`, ADR-11 says `CacheEntry`
3. **patchState double ownership** (56): Both MachineWithData and RCE define patchState/createPatch
4. **ResourceV2 missing 4 methods** (57): `resetCache`, `cacheEntries`, `hydrateEntry`, `hasEntry` in tests but not architecture
5. **`createCacheMap()` factory absent** (57): Used in tests, not in architecture diagrams
6. **IResourceV2CacheEntry interface absent** (57): Not in architecture class diagrams
7. **initialSnapshot mechanism unmodeled** (57): `createApi({initialSnapshot})` not in architecture
8. **LifecycleHooks lacks method specs** (57): Architecture has box but no methods
9. **Machine transition methods missing from model** (58): Model has only state types, no `start`, `successHappened`, `errorHappened`, etc.
10. **Success→Pending at entry level incorrect** (58): Agent-level transition misplaced in entry-level context

**User Feedback**:
1. Исследовать ВСЮ документацию, перепроверить, спроектировать и исправть
2. Исследовать ВСЮ документацию, перепроверить, спроектировать и исправть  
3. Ясли я провильно понял issue, "Вызов `resourceCacheEntry.createState()` приводит к вызову `machine.createState()`" - это же нормальное поведение, нужно детально исследовать проблему, ВСЮ документацию, перепроверить, спроектировать и исправть только при необходимости.
4. Нужно перепроверить (в тч всю доку), нужны ли вообще эти методы ресурсы (например, я не могу придумать кейса, что должен делать `cacheEntries`)
5. `createCacheMap()` - это же просто фабрика, можно скоректировать для ясности. + я не понял почему High.
6. На диаграмах есть `ResourceV2CacheEntry`. Я не вижу проблемы.
7. Не high
8. Не high
9. Исправить
10. Перепроверить и исправить

---

## Medium Issues (12)

1. Layer count "4-layer" but diagrams show 5 (56)
2. `_signal$` vs `_state$`/`_value$` naming (56)
3. SKIP vs SKIP_TOKEN inconsistency (56)
4. Missing RxJS dependency in diagram (56)
5. ResourceV2 concrete class not in model (58)
6. `hydrateEntry()` not in model (58)
7. resetAll "abort patches" contradiction (59 vs dataflow)
8. SM24 test references `refreshing.patches` but model uses nested `patchState.patches` (61)
9. AG12 test references `state$.obs` not defined on ComputeFn (61)
10. LH06 test says "resolves with data" but type is `Promise<{data: TData}>` (61)
11. patchState on machine state vs RCE in UC-5 comment (63)
12. compareArg typing at API level — `(a: unknown, b: unknown)` vs typed (64)

**User Feedback**:
*. Исследовать ВСЮ документацию, перепроверить, спроектировать и исправть

---

## Low Issues (34)

Detailed in individual verification files.
