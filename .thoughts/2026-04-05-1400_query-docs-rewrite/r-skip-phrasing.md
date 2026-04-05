---
type: research-finding
scope: skip-phrasing
status: complete
---

# Awkward "typeof SKIP" phrasing — findings

## Problem

The phrasing `typeof SKIP` leaks TypeScript type-level syntax into Russian prose, producing unnatural text like "Символ (`typeof SKIP`)". Nobody writes documentation this way. The fix: use natural Russian phrasing — "специальный символ `SKIP`" or "значение `SKIP`".

---

## 1. Occurrences in `docs/query/`

### 1.1 `docs/query/concepts/architecture.md`, line 79

**Current text:**
```
- **Agent** — при смене аргументов сохраняет предыдущие данные как fallback, пока новый запрос не завершится. Принимает `SKIP` (`typeof SKIP`) вместо аргументов — агент переходит в `idle`.
```

**Proposed replacement:**
```
- **Agent** — при смене аргументов сохраняет предыдущие данные как fallback, пока новый запрос не завершится. Принимает специальное значение `SKIP` вместо аргументов — агент переходит в `idle`.
```

### 1.2 `docs/query/concepts/architecture.md`, line 166

**Current text:**
```
| **`SKIP`** | Символ (`typeof SKIP`): передаётся вместо аргументов, чтобы отложить запрос. Агент переходит в `idle` |
```

**Proposed replacement:**
```
| **`SKIP`** | Специальный символ, который передаётся вместо аргументов, чтобы отложить запрос. Агент переходит в `idle` |
```

---

## 2. Occurrences in `.thoughts/2026-04-05-1400_query-docs-rewrite/`

These are internal planning/research files. They don't face users directly, but should still use clean phrasing to avoid propagating the pattern into generated docs.

### 2.1 `docs-toc.md`, line 52

**Current text:**
```
- Cover `SKIP` semantics: `typeof SKIP` as type, idle state, no fetch, argument typing via `ArgsOrVoidOrSkip`.
```

**Proposed replacement:**
```
- Cover `SKIP` semantics: `SKIP_TOKEN` type alias, idle state, no fetch, argument typing via `ArgsOrVoidOrSkip`.
```

*Rationale*: In a planning note the intent is to reference the type alias `SKIP_TOKEN` (which is `typeof SKIP`), not to use raw TS syntax as prose.

### 2.2 `docs-toc.md`, line 107

**Current text:**
```
| `types.md` | NEW | P1 | Shared types: machine state types (...), `SKIP` / `typeof SKIP`, `ArgsOrVoid`, `ArgsOrVoidOrSkip`, ... |
```

**Proposed replacement:**
```
| `types.md` | NEW | P1 | Shared types: machine state types (...), `SKIP` / `SKIP_TOKEN`, `ArgsOrVoid`, `ArgsOrVoidOrSkip`, ... |
```

*Rationale*: Reference the actual type alias name `SKIP_TOKEN` instead of the raw expression.

### 2.3 `user-decisions.md`, line 10

**Current text:**
```
8. **SKIP naming**: `SKIP` + `typeof SKIP` (not SKIP_TOKEN)
```

**No change proposed.** This is a record of a user decision. The phrasing here documents the user's choice between naming conventions (`typeof SKIP` vs `SKIP_TOKEN`). Altering it would misrepresent the decision. However, when *implementing* this decision in docs, the rule from `common-mistakes.md` §9 applies: write naturally.

### 2.4 `research-api-plugins.md`, line 79

**Current text:**
```
- `SKIP_TOKEN` — type alias `typeof SKIP`
```

**No change proposed.** This is a factual code-level note in a research document describing the actual TypeScript declaration. The phrasing is accurate and appropriate for this context.

### 2.5 `common-mistakes.md`, lines 47–50

**Current text:**
```
## 9. "typeof SKIP" phrasing
**User feedback**: "Символ (typeof SKIP):" — nobody writes like this. It's awkward phrasing.
```

**No change proposed.** This is the rule *about* the problem — it must reference the bad phrasing to document it.

---

## Summary

| # | File | Line | Action |
|---|------|------|--------|
| 1 | `docs/query/concepts/architecture.md` | 79 | **FIX** — replace `\`SKIP\` (\`typeof SKIP\`)` → `специальное значение \`SKIP\`` |
| 2 | `docs/query/concepts/architecture.md` | 166 | **FIX** — replace `Символ (\`typeof SKIP\`):` → `Специальный символ, который` |
| 3 | `.thoughts/.../docs-toc.md` | 52 | **FIX** — replace `\`typeof SKIP\` as type` → `\`SKIP_TOKEN\` type alias` |
| 4 | `.thoughts/.../docs-toc.md` | 107 | **FIX** — replace `\`typeof SKIP\`` → `\`SKIP_TOKEN\`` |
| 5 | `.thoughts/.../user-decisions.md` | 10 | KEEP — decision record |
| 6 | `.thoughts/.../research-api-plugins.md` | 79 | KEEP — code-level fact |
| 7 | `.thoughts/.../common-mistakes.md` | 47–50 | KEEP — rule definition |

**4 occurrences to fix, 3 to keep as-is.**
