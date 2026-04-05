---
title: "Gap Analysis: machine.md vs Research Findings"
date: 2026-04-05
stage: 01-research
role: researcher
---

# Gap Analysis: machine.md

## 1. What's CORRECT (keep)

- Overall structure: intro → status table → per-state descriptions → diagram → data model
- Immutability concept (every transition = new instance)
- `pending`, `success`, `error`, `refreshing` states — fields and semantics correct
- `Machine.pending(args)` as entry point
- TypeScript interfaces for `TPendingState`, `TSuccessState`, `TErrorState`, `TRefreshingState` — shapes mostly correct (minus missing fields noted below)
- Table format for overview of states
- `patchState` field on `success` / `refreshing` / `refresh-error` descriptions — present and correct

## 2. What's WRONG or MISSING

### 2.1 `lastError` field

**Missing.** `MachineSuccess` has `lastError?: unknown` in code. Neither the status table, nor the `success` description, nor `TSuccessState` interface include it. This field is critical because it carries the error from a failed refresh.

### 2.2 `patchState` field

**Partially present.** Text descriptions for success/refreshing/refresh-error list `patchState` — good. But the status table at the top does NOT show `patchState` column. Inconsistency.

### 2.3 `refresh-error` treatment — **FUNDAMENTALLY WRONG**

Current doc treats `refresh-error` as a standalone 5th machine state with its own `TRefreshErrorState` interface. Research shows:

- There is **no** `MachineRefreshError` class.
- `MachineRefreshing.errorHappened(error)` → returns `MachineSuccess` with `lastError` set.
- `refresh-error` is a **logical status derived at agent layer**, not a machine class.
- The `TRefreshErrorState` interface in the doc **does not exist in code**.

**Target**: Explain that the machine has **4 classes** (Pending, Success, Error, Refreshing). The "refresh-error" logical status is a `MachineSuccess` where `lastError` is populated. Doc should clarify this distinction.

### 2.4 Transition methods — errors

| In doc | Actual (from research) | Issue |
|--------|----------------------|-------|
| `finishAllPatches()` | `abortAllPendingPatches()` | Wrong method name |
| `refreshing → refresh_error : errorHappened(error)` | `refreshing → success : errorHappened(error)` (with `lastError`) | Wrong target state |
| `refresh_error → refreshing : invalidate()` | N/A — no refresh-error machine class | Nonexistent transition |
| `refresh_error → pending : start(newArgs)` | N/A | Nonexistent transition |
| `refresh_error → refresh_error : createPatch/finishPatch/finishAllPatches` | N/A | Nonexistent transitions |

Missing transitions: `success.invalidate()` should carry `lastError` context (need to verify if `MachineRefreshing` receives `lastError`).

### 2.5 Mermaid diagram — inaccurate

- Contains `refresh_error` as a state node — must be removed.
- `errorHappened` from `refreshing` should point to `success` (with note about `lastError`).
- Uses `finishAllPatches()` — should be `abortAllPendingPatches()`.
- Does not show `abortAllPendingPatches` properly.
- Missing: `Machine.fromSnapshot()` as alternative entry point.

### 2.6 Data model — extra/wrong interface

- `TRefreshErrorState` interface should be **removed** (no such type in code).
- `TSuccessState` is missing `lastError?: unknown`.

## 3. Style violations (per common-mistakes.md)

| Rule | Violation |
|------|-----------|
| #2 (reference-style links) | Doc has zero links at all — no cross-references to related docs. Not a format violation but a content gap. |
| #4 (don't duplicate diagram + prose) | The per-state text descriptions partially duplicate what the status table already shows (fields per state). The table + interfaces + descriptions = triple redundancy for field lists. |
| #9 (natural SKIP phrasing) | N/A (SKIP not mentioned here). |

No other style rules triggered — doc doesn't have inline links, doesn't have super-diagrams (only one diagram, which is acceptable for machine states), doesn't mix architecture with usage.

## 4. Ordered checklist of ALL changes

1. **Remove `refresh-error` as machine state.** Rewrite to show 4 machine classes. Explain that `refresh-error` is a logical/agent-level status produced by `MachineSuccess` + `lastError`.
2. **Add `lastError?: unknown` field** to `success` state description and `TSuccessState` interface. Explain when it's populated (after `refreshing.errorHappened()`).
3. **Delete `TRefreshErrorState` interface** from data model section.
4. **Fix the status table**: remove `refresh-error` row OR reframe it as "logical status"; add `patchState` column.
5. **Fix transition diagram (Mermaid)**: remove `refresh_error` node; point `refreshing → errorHappened()` to `success`; rename `finishAllPatches()` → `abortAllPendingPatches()`.
6. **Fix method names**: replace all `finishAllPatches()` → `abortAllPendingPatches()` throughout doc.
7. **Reduce field-list redundancy** (rule #4): keep status table as overview + TypeScript interfaces as precise spec; trim per-state text descriptions to only add semantics not visible in table/interfaces (e.g., explain *when* `lastError` is set, not repeat that it's `unknown`).
8. **Add cross-references** (reference-style per rule #2): link to future `concepts/patching.md` for patch details, `concepts/agent.md` for agent-level statuses, `README.md` glossary.
9. **Add `Machine.fromSnapshot()`** to entry points (currently only `Machine.pending()` mentioned).
