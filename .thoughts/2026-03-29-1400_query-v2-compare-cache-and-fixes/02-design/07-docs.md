---
title: "Documentation Impact: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

# Documentation Impact

Scope calibration: existing `docs/query-v2/` contains 4 files (~350 lines total). Changes below are proportional — mostly small updates to existing sections, one new option row.

---

## New Documentation

### `devtoolsKey` option in `docs/query-v2/README.md`

Add one row to the **Параметры `createResourceV2`** table:

| `devtoolsKey` | `(args: TArgs) => string` | Функция для извлечения ключа devtools из аргументов (только для стратегии `compare`). По умолчанию — монотонный счётчик (0, 1, 2…) |

Add a short note (2–3 sentences) under **Cache Strategies** explaining that compare strategy uses a monotonic counter for devtools identification by default and that `devtoolsKey` overrides this [ref: 04-decisions.md#ADR-3].

### `devtoolsKey` mention in `docs/query-v2/devtools.md`

Add one row to the **Options Reference** table for `devtoolsKey`. Add a short paragraph (3–4 sentences) explaining Signal key format for compare strategy entries: `"Resource/:key/:counter"` vs `"Resource/:key/:customKey"` [ref: 05-usecases.md#UC2].

---

## Updated Documentation

### Lifecycle Hooks section in `docs/query-v2/README.md`

The existing **Lifecycle Hooks** section documents `onCacheEntryAdded` and `onQueryStarted` with correct external API — tools signatures (`$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled`, `getCacheEntry`) are unchanged. **No external API change**, but the internal ownership model changed (per-entry resolvers instead of shared class) [ref: 04-decisions.md#ADR-5].

- No change to user-facing code examples or tables.
- If the docs mention the internal `LifecycleHooks` class anywhere — remove that reference (class is deleted). Currently no such reference exists in `README.md`.

### `doCacheArgs` description in `docs/query-v2/README.md`

The `doCacheArgs` row exists in both `createApi` and `createResourceV2` parameter tables. Add a clarification that this option applies only to serialize strategy (`keyStrategy: 'serialize'`). Compare strategy ignores it [ref: 04-decisions.md#ADR-2].

### `entries()` removal — `docs/query-v2/ssr.md`

The snapshot format documentation in `ssr.md` references `entries` in the `TApiSnapshot` interface shape. Verify and update the snapshot format type if it still references a `[serializedArgs: string]` key — this is a serialize-strategy-only feature and remains correct. No change needed if `getSnapshot` is serialize-only (confirmed: SSR requires `keyStrategy: 'serialize'`) [ref: 00-short-design.md#Scope Boundaries].

---

## Demo Documentation

### `isError` description corrections

Research found misleading `isError` labels in demo files [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #6]. The demo files themselves are being fixed (code changes in Area C). No separate documentation update needed — the demos are self-documenting. Note the corrections in the CHANGELOG when releasing.

---

## No Change Needed

| Section / File | Reason |
|---|---|
| `docs/query-v2/optimistic-updates.md` | Patch API (`createPatch`, `commit`, `abort`) is unaffected by these changes |
| `docs/query-v2/ssr.md` | SSR is serialize-strategy-only; compare strategy changes do not affect snapshots |
| `docs/query-v2/README.md` — Machine States | Machine state transitions unchanged |
| `docs/query-v2/README.md` — Agents | Agent API unchanged |
| `docs/query-v2/README.md` — SKIP | SKIP token unaffected |
| `docs/query-v2/README.md` — Plugins | Plugin system orthogonal to these changes |
| `docs/query-v2/README.md` — GC | Cache lifetime / refcount model unchanged |
| `docs/query-v2/README.md` — Error Handling | SWR error semantics unchanged |
| `docs/devtools/README.md` | Generic devtools docs; query-v2-specific changes scoped to `docs/query-v2/devtools.md` |
