---
title: "Plan: machine.md Rewrite"
date: 2026-04-05
stage: plan
role: rdpi-planner
---

# Plan: Rewrite `docs/query/concepts/machine.md`

Target file: `docs/query/concepts/machine.md`  
Language: Russian  
Target length: ~100–120 lines  
Source of truth: `research-machines.md`, `r-machine-gaps.md` (9-item checklist)

---

## Key Design Decisions

### D1. Four states, not five

The machine has **4 classes**: `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`.  
There is **no** `MachineRefreshError` class.

The doc shows **4 states** in the table, diagram, and interfaces.  
A dedicated note (2–3 sentences after the table) explains that the agent layer derives a logical `refresh-error` status from `MachineSuccess` where `lastError` is set. Cross-ref to `agent.md`.

### D2. Status table — exact columns and rows

| Column      | Description                             |
|-------------|-----------------------------------------|
| Статус      | `pending`, `success`, `error`, `refreshing` |
| `data`      | Type / null                             |
| `error`     | Type / null                             |
| `lastError` | Type / null (only `success` has `?`)    |
| `updatedAt` | Type / null                             |
| `patchState`| Type / null (only data-carrying states) |

**4 rows** — one per state.

Row values:

| Статус       | `data`              | `error`   | `lastError`    | `updatedAt` | `patchState`              |
|--------------|---------------------|-----------|----------------|-------------|---------------------------|
| `pending`    | `null`              | `null`    | —              | `null`      | —                         |
| `success`    | `TData`             | `null`    | `unknown / null`| `number`   | `TPatchState<TData> / null`|
| `error`      | `null`              | `unknown` | —              | `null`      | —                         |
| `refreshing` | `TData` (устаревшие)| `null`    | —              | `number`    | `TPatchState<TData> / null`|

"—" means the field does not exist on that state.

### D3. Mermaid diagram — exact nodes and transitions

Single `stateDiagram-v2`. **4 nodes**: `pending`, `success`, `error`, `refreshing`.  
No `refresh_error` node.

Transitions (exact labels):

```
[*] --> pending : Machine.pending(args)
[*] --> <any> : Machine.fromSnapshot(state)   ← note-style annotation, not a real arrow

pending --> success : successHappened(data)
pending --> error : errorHappened(error)

success --> refreshing : invalidate()
success --> pending : start(newArgs)
success --> success : createPatch() / finishPatch() / abortAllPendingPatches()

error --> pending : retry()
error --> pending : start(newArgs)

refreshing --> success : successHappened(data)
refreshing --> success : errorHappened(error) [+ lastError]
refreshing --> refreshing : createPatch() / finishPatch() / abortAllPendingPatches()
```

Key edge: `refreshing → success` via `errorHappened(error)` with annotation `lastError = error`.  
Self-loops on `success` and `refreshing` for patch methods — group into one edge with `/`-separated label.

`Machine.fromSnapshot()` shown as a **note** attached to the diagram (not as transitions to every state), e.g. `note right of pending : Machine.fromSnapshot(state)\nвосстанавливает любое состояние`.

### D4. TypeScript interfaces — 4 interfaces

Include exactly:

1. `TPendingState<TArgs>` — fields: `status`, `args`, `data`, `error`, `updatedAt`
2. `TSuccessState<TArgs, TData>` — fields: `status`, `args`, `data`, `error`, `updatedAt`, `lastError`, `patchState`
3. `TErrorState<TArgs>` — fields: `status`, `args`, `data`, `error`, `updatedAt`
4. `TRefreshingState<TArgs, TData>` — fields: `status`, `args`, `data`, `error`, `updatedAt`, `patchState`

**No** `TRefreshErrorState`. The `lastError?: unknown` on `TSuccessState` is the key addition vs current doc.

### D5. Per-state prose — minimal (rule #4 compliance)

Do NOT write per-state subsections with field lists (that's triple redundancy with table + interfaces).
Instead: a single paragraph after the table covering **only** semantics not visible in the table:

- `pending`: entry point, no data yet.
- `success`: `lastError` is populated when a previous refresh failed (link → agent.md for `refresh-error` status).
- `error`: no data preserved; user must `retry()` or `start()`.
- `refreshing`: stale data shown while fetch runs; `errorHappened()` returns to `success` (stale-while-revalidate).

This paragraph is ~6–8 lines total. Not per-state subsections.

---

## Section-by-Section Outline

### §1. Title and intro  
**Heading**: `# Стейт-машина запроса`  
**Content** (3–4 lines):
- Each query is an immutable state machine.
- Every transition creates a new instance — old is never mutated.
- Machine has 4 states.
- Two entry points: `Machine.pending(args)` (normal) and `Machine.fromSnapshot(state)` (SSR hydration).

**No code blocks. No diagram.**

### §2. Status overview table  
**Heading**: `## Обзор состояний`  
**Content**: The table from D2 above (4 rows × 6 columns).

Immediately after the table — a **note block** (Russian `> **Примечание**`):
> На уровне агента из `success` с `lastError` выводится логический статус `refresh-error`. Машина не имеет отдельного класса для этого — подробнее см. [agent.md][agent].

### §3. State semantics — compact paragraph  
**Heading**: None (continuation of §2, or use `### Семантика состояний` if needed for readability)  
**Content**: The compact paragraph from D5 — 6–8 lines covering what the table can't show.

Things to include:
- `pending` = initial state, always the starting point for a new query.
- `success.lastError` = error from a failed refresh; data is still valid.
- `error` = terminal until `retry()` or `start()`.
- `refreshing` = background re-fetch; `errorHappened()` → `success` (not `error`) to preserve stale data (SWR pattern).
- Patch methods (`createPatch`, `finishPatch`, `abortAllPendingPatches`) available on data-carrying states — details in [patching.md][patching].

**No** per-state subsections. **No** field lists.

### §4. Transition diagram  
**Heading**: `## Диаграмма переходов`  
**Content**: One Mermaid `stateDiagram-v2` block as specified in D3.

After the diagram — 1–2 sentences:
- `errorHappened()` в `refreshing` возвращает `success` с `lastError` — данные не теряются.
- `Machine.fromSnapshot()` can restore any state (e.g., SSR hydration).

**No** prose description of what the diagram shows (rule #4).

### §5. Data model (TypeScript interfaces)  
**Heading**: `## Модель данных`  
**Content**: One `ts` code block with 4 interfaces (D4).

After the block — 1 sentence:
- `TPatchState` described in [patching.md][patching].

### §6. Reference-style links  
No heading. At the very end of the file, separated by `---`:

```
[patching]: ./patching.md
[agent]: ./agent.md
[architecture]: ./architecture.md
```

---

## What to EXCLUDE (explicitly)

- No `TRefreshErrorState` interface.
- No per-state subsections with field lists (H3 sections like `### pending`, `### success`, etc.).
- No `refresh-error` as a machine state/node.
- No `finishAllPatches()` — correct name is `abortAllPendingPatches()`.
- No inline links — all reference-style.
- No architecture-level content (class hierarchy, Patcher internals, Immer details) — that belongs in architecture.md.
- No usage examples (those go to usage/ docs).
- No `MachineWithData` discussion (implementation detail — architecture.md territory).

---

## Cross-reference mapping

| Link ref         | Target file               | Used in sections |
|------------------|---------------------------|------------------|
| `[patching]`     | `./patching.md`           | §3, §5          |
| `[agent]`        | `./agent.md`              | §2 (note), §3   |
| `[architecture]` | `./architecture.md`       | §1 (if needed)  |

---

## Checklist coverage

Mapping to `r-machine-gaps.md` 9-item checklist:

| # | Gap item | Covered by |
|---|----------|------------|
| 1 | Remove `refresh-error` as machine state | D1, §2 table (4 rows), §4 diagram (4 nodes), §5 (no TRefreshErrorState) |
| 2 | Add `lastError` field | D2 table column, D4 TSuccessState interface, §3 semantics paragraph |
| 3 | Delete `TRefreshErrorState` | D4 (only 4 interfaces), exclusion list |
| 4 | Fix status table | D2 — 4 rows, 6 columns including `patchState` |
| 5 | Fix Mermaid diagram | D3 — 4 nodes, correct transitions, no refresh_error |
| 6 | Fix `finishAllPatches` → `abortAllPendingPatches` | D3 diagram labels, exclusion list |
| 7 | Reduce field-list redundancy | D5 — no per-state subsections, compact paragraph only |
| 8 | Add cross-references | §6 reference links, used in §2/§3/§5 |
| 9 | Add `Machine.fromSnapshot()` | §1 intro, §4 diagram note |

All 9 items addressed.

---

## Estimated structure (line count)

| Section | Lines |
|---------|-------|
| §1 Title + intro | ~6 |
| §2 Table + note | ~12 |
| §3 Semantics paragraph | ~10 |
| §4 Diagram + post-note | ~30 |
| §5 Interfaces + note | ~42 |
| §6 Links | ~6 |
| **Total** | **~106** |

Within the 100–120 target.
