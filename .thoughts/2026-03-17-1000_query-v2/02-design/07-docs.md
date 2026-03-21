---
title: "Documentation Impact: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Documentation Impact: Query v2 Module

## New Documentation Pages

### `docs/query-v2/README.md` — Main Documentation
Concepts page covering: `createApi`, `ResourceV2`, Agents, Machine states, cache strategies, `SKIP_TOKEN`, lifecycle hooks, plugins, SSR snapshots. Structure parallel to existing [docs/query/README.md](../../docs/query/README.md) — same depth and style.

### `docs/query-v2/api-reference.md` — API Reference
Tables of options and return types for `createApi`, `api.createResource`, `IResourceV2`, `IResourceV2Agent`, machine classes. Similar in format to the tables in the RFC.

### `docs/query-v2/optimistic-updates.md` — Optimistic Updates Guide
Patcher usage: `createPatch`, `finishPatch`, commit/abort patterns. Replaces the v1 patch + Command link pattern.

### `docs/query-v2/ssr.md` — SSR Guide
`getSnapshot()` / `initialSnapshot` / `maxSnapshotDataAge` — server dehydration and client hydration. New topic — no v1 equivalent.

## Existing Pages to Update

### `docs/query/README.md`
Add a brief note at the top linking to query-v2 as the experimental successor. No structural changes to v1 docs.

### `README.md` (root)
Add query-v2 to the feature list. Mark as experimental.

## Migration Guide

### `docs/migrations/query-v2.md`
Migration from v1 to v2: concept mapping (Resource → ResourceV2, Command → out of scope, Agent pattern changes, boolean flags → machine states, `createResource` → `createApi` + `api.createResource`). Reference [docs/migrations/0.5.0.md](../../docs/migrations/0.5.0.md) for format.

## Demo App Updates

### `apps/demos/src/examples/query-v2/`
New demo directory with 2–3 examples mirroring existing v1 demos in scope:
- Basic resource query (parallel to [simple-list.tsx](../../apps/demos/src/examples/query/simple-list.tsx))
- Optimistic patches (parallel to [todo-patches.tsx](../../apps/demos/src/examples/query/todo-patches.tsx))
- SSR snapshot demo (new — no v1 equivalent)

Existing v1 demos in `apps/demos/src/examples/query/` remain unchanged.
