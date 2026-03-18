---
title: "Review: 02-design"
date: 2026-03-18
status: Approved
stage: 02-design
---

## Source

Re-reviewer agent (`rdpi-design-reviewer`, Phase 7) output in README.md Quality Review section + approval gate sanity check (file existence, checklist coverage). This is the re-review after Redraft Round 1.

## Issues Summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 1

## Issues

1. **Pre-existing: `MachineSuccess.start(args)` inconsistency** — The model's transition rules table (§4.2, row 6) lists `success → pending` via `start(args)`, and test case M5 expects `success.start({ id: 2 })` → `MachinePending`. However, the `MachineSuccess` class definition (model §1.3) only declares `invalidate()` and `reset()` — no `start()` method. The architecture state diagram (§5) also omits this transition. This is a pre-existing inconsistency (present before Redraft Round 1), not a regression.
   - Where: `03-model.md` §1.3 vs. §4.2 (row 6); `01-architecture.md` §5; `06-testcases.md` test M5
   - Expected: All four locations agree on whether `MachineSuccess` has a `start(args)` transition
   - Severity: Low
   - Source: Re-review (Phase 7)
   - Checklist item: #10 (internal consistency)

## Redraft Round 1 Resolution

All 5 issues from the previous review were resolved:

| ID | Description | Status |
|----|-------------|--------|
| UF#1 | Folder structure: SKIP_TOKEN/NO_VALUE moved to `lib/` | RESOLVED |
| UF#2 | Machine State Hierarchy diagram corrected (12 transitions) | RESOLVED |
| UF#3 | Devtools: removed separate module, uses `Signal.state()` `beforeDevtoolsPush`; ADR-8 rewritten | RESOLVED |
| #1 | `TApiSnapshot` cross-reference added in model §1.11 | RESOLVED |
| #2 | ADR-9 added for hook naming split | RESOLVED |

## Recommendations

- The `MachineSuccess.start(args)` inconsistency (Issue #1) is low-severity and non-blocking. Can be resolved in the Plan stage when test cases are finalized. Either add `start(args)` to the class definition and state diagram, or remove the transition table row and test M5.

## User Feedback (Round 1)

1. **Proposed folder structure** — Файлы-символы (SKIP_TOKEN, NO_VALUE) не должны лежать в корне модуля. Нужна организация по подпапкам.
2. **§5 Machine State Hierarchy** — Схема состояний неверная, требуется исправление.
3. **Devtools.createState()** — Отдельный devtools-модуль не нужен. Следует использовать существующий `beforeDevtoolsPush` у `Signal.state()` вместо кастомного решения.

## User Feedback (Round 2 — Approval)

`MachineSuccess` не должен иметь метод `start()`. Направление исправления Low-замечания #1: убрать `start(args)` из таблицы переходов (§4.2 row 6) и тест-кейса M5, а не добавлять в определение класса. Учесть на этапе 03-plan.
