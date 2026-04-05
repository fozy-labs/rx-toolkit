---
title: "Research — api/README.md update analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

# api/README.md — Analysis

## CORRECT (keep as-is)

- Russian language, overall structure (example → options table → methods table)
- Reference-style links at document end (rule #2 ✓)
- `keyPrefix`, `plugins`, `serializeArgs`, `cacheRetentionTime`, `initialSnapshot`, `syncDriver` options
- Methods: `createResource`, `createCommand`, `getSnapshot()`, `resetAll()` — all target design
- `createCommand` stays (user decision #3: commands kept in docs as target)
- Link targets `[снимок]`, `[синхронизация]`, `[ресурс]`, `[команда]` — correct reference-style format

## Changes needed

### 1. Add `strategy` option to table

Missing entirely. Target: `"serialize"` | `"compare"`, default `"serialize"`. Determines cache key derivation.
[ref: research-api-plugins.md#1, docs-toc.md notes on api/README.md]

### 2. Add `compareArg` option to table

Missing. Relevant when `strategy = "compare"`. Counterpart to `serializeArgs`.
[ref: research-api-plugins.md#1]

### 3. Add `doCacheArgs` option to table

Missing. Boolean, controls WeakMap arg caching on entries.
[ref: research-api-plugins.md#1, docs-toc.md notes on api/README.md]

### 4. Rename `snapshotValidTime` → `maxSnapshotDataAge`

docs-toc.md explicitly says rename. Same semantics — max age before hydrated entries auto-invalidate.
[ref: docs-toc.md notes on api/README.md]

### 5. Fix default value for `cacheRetentionTime`

Current: `60_000 ms`. The "ms" suffix is inconsistent with other cells — pick uniform format. Minor.

### 6. Verify dead links are correctly formed

`[снимок]: ../usage/snapshot.md` and `[синхронизация]: ../usage/broadcast.md` — files don't exist yet, will be created. Paths correct per docs-toc structure. No change needed, just verify on creation.

### 7. Add link target for `[ресурсов]` plural form

Table cell `[ресурсов][ресурс]` uses `[ресурс]` ref which points to `../usage/resource.md`. Correct, but verify plural declension form renders properly.

### 8. Options table — column order consistency

Insert new options (`strategy`, `compareArg`, `doCacheArgs`) in logical position: `strategy` after `keyPrefix` (it's a top-level cache mode), `compareArg` next to `serializeArgs`, `doCacheArgs` near cache-related options.

## Ordered change list

1. Add row: `strategy` | `"serialize"` \| `"compare"` | `"serialize"` | Стратегия ключей кеша…
2. Add row: `compareArg` | `(a: TArgs, b: TArgs) => boolean` | `Object.is` | Функция сравнения аргументов (при `strategy: "compare"`)
3. Add row: `doCacheArgs` | `boolean` | `false` | Кеширование аргументов в записях (WeakMap-оптимизация)
4. Rename `snapshotValidTime` → `maxSnapshotDataAge` (in table row + description text + any inline mention)
5. Reorder table rows: `keyPrefix`, `strategy`, `serializeArgs`, `compareArg`, `doCacheArgs`, `cacheRetentionTime`, `plugins`, `initialSnapshot`, `maxSnapshotDataAge`, `syncDriver`
6. Verify all link targets at document end resolve to planned file paths — no action now, verify post-creation
