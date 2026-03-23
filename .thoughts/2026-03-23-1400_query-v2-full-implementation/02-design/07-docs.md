---
title: "Documentation Impact — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-architect
---

# Documentation Impact — query-v2

## Existing Docs Requiring Updates

| File | Change |
|------|--------|
| `docs/query-v2/README.md` | Replace single-line redirect with v0.2 link alongside v0.1 |
| `docs/query-v2/v0.1/README.md` | Add deprecation banner pointing to v0.2 |
| `docs/query-v2/v0.1/optimistic-updates.md` | Add deprecation banner |
| `docs/query-v2/v0.1/ssr.md` | Add deprecation banner |
| `docs/query-v2/v0.1/Внутриянка.md` | Add deprecation banner |
| `docs/migrations/query-v2.md` | Update with v0.1→v0.2 migration notes |

## New Documentation Needed (v0.2)

Create `docs/query-v2/v0.2/` with:

- **README.md** — Main reference: `createApi`, `createResourceV2`, `createOperationV2`, hooks, SKIP, machine states, lifecycle hooks, plugins. Mirror the structure of `docs/query-v2/v0.1/README.md` but with V2-suffixed API naming per ADR-16 (`createApi` as entry point, `useResourceV2`/`useOperationV2` standalone hooks).
- **optimistic-updates.md** — Patch lifecycle, consistency violations, multi-patch edge cases. Same scope as v0.1 version.
- **ssr.md** — Snapshot capture/hydrate, `maxSnapshotDataAge`, `compare` strategy limitation. Same scope as v0.1 version.

## Key Concepts Requiring Explanation

- Naming changes from v0.1: V2 suffix on resource/operation/hook names per ADR-16 (`createApi` unchanged, `useResourceV2Agent` preserved, etc.)
- No `TError` generic — errors are `unknown`
- No Command — Resource and Operation only
- `getEntry$` reactivity to `resetAll()` via `_status$`/`_lastEntry$` signals
- GC model: refcount + timer hybrid (v0.1 docs were vague on this)
- Consistency violation auto-invalidation behavior

## Migration Guide Scope

For users of current v2 (v0.1): breaking changes include API naming, removal of `TError`, `useResourceV2Ref` consolidation into `IResourceV2CacheEntry.createPatch`. Doc should be a short section in the existing `docs/migrations/query-v2.md`.

## Demo App Considerations

Update existing demos in `apps/demos/src/examples/query-v2/`:
- `simple-resource.tsx` — update imports/API to v0.2 naming
- `optimistic-patches.tsx` — update to new patch API
- `ssr-snapshot.tsx` — update to `createApi` naming

No new demo files needed — existing demos cover the key scenarios.
