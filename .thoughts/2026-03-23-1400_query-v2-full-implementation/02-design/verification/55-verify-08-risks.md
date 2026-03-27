---
title: "Verification: 08-risks.md"
date: 2026-03-25
target: "../08-risks.md"
issues: [2, 17, 22, 27, 31, 37, 49]
---

# Verification — 08-risks.md

## Summary

All 7 assigned issues verified. **0 regressions found.**

## Issue Verification

### Issue #2 — Commands removed from risk descriptions
**Status**: PASS
**Method**: Regex search for `Command|command` across 08-risks.md.
**Evidence**: Zero matches in target file. Risk matrix (R01–R22) and all detailed mitigation plans contain no references to Commands. Scope risk R11 correctly scopes to "ResourceV2" without mentioning Commands.

---

### Issue #17 — Operations/OperationV2 removed from risks
**Status**: PASS
**Method**: Regex search for `Operation|OperationV2` across 08-risks.md.
**Evidence**: Zero matches in target file. R02 describes "ResourceV2 query orchestration" (not Operation). R10 mentions "interacting components" generically without naming Operations. R11 scope risk says "beyond ResourceV2" — no Operation remnants.

---

### Issue #22 — No SharedOptions/DefaultOptions in risks
**Status**: PASS
**Method**: Regex search for `SharedOptions|DefaultOptions` across 08-risks.md.
**Evidence**: Zero matches. No risk description references shared or default options. Configuration-related risks are absent, consistent with the removal of these concepts from the design.

---

### Issue #27 — No resetAllCacheV2 in risks
**Status**: PASS
**Method**: Regex search for `resetAllCacheV2|resetAllCache|resetAll|resetAllQueries` across 08-risks.md.
**Evidence**: Zero matches for any global reset function name. Two references to `resetCache()` exist (R02 line 67, R17 line 166), but both refer to resource-level reset operations (`RE14`, `E06` test cases), not the removed standalone `resetAllCacheV2()` function. This is correct — resource-level reset is a valid concept in the design.

---

### Issue #31 — refreshError removed from risks
**Status**: PASS
**Method**: Regex search for `refreshError|onRefreshError|notifyRefreshError` across 08-risks.md.
**Evidence**: Zero matches in target file. R01 (state machine transitions) mentions `.error` as a generic machine field, not `refreshError`. R09 discusses agent state derivation without referencing `refreshError`. The concept is cleanly removed.

---

### Issue #37 — TArgs consistency in risk descriptions
**Status**: PASS
**Method**: Regex search for `<TData>|<TArgs>|<TArgs, TData>` across 08-risks.md; also searched `TArgs|TData|TEntry|TError`.
**Evidence**: No generic type parameter syntax (`<...>`) appears anywhere in the file. The only type-related mention is R22: "`TError` removal causes downstream type errors" — which describes a risk about removing `TError`, not using it. No inconsistent `<TData>`-only or `<TArgs>`-only generics to flag. Risk descriptions operate at natural-language level without inline generics — no consistency issue possible.

---

### Issue #49 — Snapshot risks reflect correct lifecycle
**Status**: PASS
**Method**: Regex search for `snapshot|hydrat|already exists|if exists|skip hydrat|conditional hydrat|selective hydrat` across 08-risks.md.
**Evidence**:
- R04 ("Snapshot data inconsistency") mitigation uses `peek()` for point-in-time capture — no lifecycle-incorrect language.
- R09 mentions `getSnapshot` in `useSyncExternalStore` context — React API, unrelated to snapshot hydration system.
- R01 references `fromSnapshot` round-trip (SM30) — machine serialization, correct usage.
- Zero matches for "already exists", "if exists", "skip hydrat", "conditional hydration", "selective hydration".
- No remnants of incorrect lifecycle (check-if-exists / conditional skip). The 3-phase save→consume+delete→delete lifecycle is not contradicted.
