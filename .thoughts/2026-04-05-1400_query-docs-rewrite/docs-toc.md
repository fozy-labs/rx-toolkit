---
title: "Documentation Table of Contents — Query Module"
date: 2026-04-05
stage: 02-design
role: rdpi-architect
---

# Documentation Table of Contents

Complete file index for `docs/query/`. Grouped by directory, ordered by reading flow within each group.

Statuses: **EXISTS** = file exists, needs update to match target design; **NEW** = file to create; **STUB** = existing placeholder to be replaced; **REMOVE** = file to delete (content moved elsewhere).

Priorities: **P0** = blocking (architecture + core usage/API); **P1** = core (complete the picture); **P2** = nice to have (contributors, polish).

---

## `docs/query/` — Root

| File | Status | Priority | Description |
|------|--------|----------|-------------|
| `README.md` | NEW | P0 | Architecture overview: how API → Resource/Command → CacheMap → CacheEntry → Machine fit together; glossary of terms (entry, machine, agent, patch, snapshot, link, plugin); reading order guide |
| `broadcast-RFC.md` | REMOVE | — | TODO stub; content superseded by `usage/broadcast.md` |

[ref: ../01-research/gaps-and-questions.md#Structural / cross-cutting gaps] — no architecture overview exists.
[ref: ../01-research/gaps-and-questions.md#Structural / cross-cutting gaps] — no glossary exists.

---

## `docs/query/concepts/` — Concept Docs

Explain behavior, not class APIs. Each page answers "how does X work and why?"

| File | Status | Priority | Description |
|------|--------|----------|-------------|
| `machine.md` | EXISTS | P0 | State machine: 5 states (pending, success, error, refreshing, refresh-error), transition rules, immutability, `lastError` semantics, transition diagram |
| `cache.md` | NEW | P1 | Cache system: entries and their lifecycle, key derivation strategies (serialize vs compare), `cacheRetentionTime` / GC via refcount timer, `serializeArgs` / `stableStringify` / `compareArg` |
| `agent.md` | NEW | P1 | Agent concept: SWR observation across cache entries, `SKIP` and idle state, cross-entry data fallback, `state$` derivation, how `useResource`/`useCommand` are built on agents |
| `patching.md` | NEW | P1 | Optimistic updates: patch lifecycle (create → commit/abort), Immer integration, patch accumulation & stacking, rebase on refresh, consistency violation detection & auto-rollback |

**Notes on `machine.md` update (P0)**:
- Add `lastError` field to success state (currently absent from doc types). [ref: ../01-research/gaps-and-questions.md#Machine doc vs code mismatch]
- Document that `refreshing → errorHappened()` produces `success` with `lastError`, not a separate `refresh-error` class. The 5th state (`refresh-error`) is a logical status exposed by agent, not a machine class. [ref: ../01-research/research-machines.md#Key Design Decisions]
- Add `patchState` to state type definitions for `success` and `refreshing`. [ref: ../01-research/research-machines.md#MachineSuccess]

**Notes on `cache.md` (P1)**:
- Cover `stableStringify` limitations (no Date/Map/Set/RegExp). [ref: ../01-research/gaps-and-questions.md#Completely missing topics]
- Explain retention lifecycle: last subscriber drops → timer starts → entry completes → removed from CacheMap. [ref: ../01-research/research-cache-resource.md#1. CacheEntry]
- Document `doCacheArgs` option (WeakMap optimization). [ref: ../01-research/research-cache-resource.md#2. CacheMap]

**Notes on `agent.md` (P1)**:
- Cover `SKIP` semantics: `SKIP_TOKEN` type alias, idle state, no fetch, argument typing via `ArgsOrVoidOrSkip`. [ref: ../01-research/gaps-and-questions.md#Completely missing topics] — SKIP naming per user decision.
- Explain SWR fallback: previous entry data shown while current entry loads. [ref: ../01-research/research-cache-resource.md#4. ResourceAgent]
- Cover `compareArgs` for arg identity. [ref: ../01-research/research-api-plugins.md#5. useResourceAgent]

---

## `docs/query/usage/` — Usage Guides

Show how to use features. Code examples, typical patterns, edge cases.

| File | Status | Priority | Description |
|------|--------|----------|-------------|
| `resource.md` | EXISTS | P0 | Resource: creation, `queryFn`, options, `useResource` hook, conditional fetching (`SKIP`), states & boolean flags, imperative API (trigger, refresh, getEntry, getEntry$, createAgent), SWR behavior |
| `command.md` | EXISTS | P0 | Command: creation, `queryFn`, key semantics (auto-sid, explicit key), `useCommand` hook, imperative API (trigger, getEntry, getEntry$, createAgent), key sharing between consumers |
| `links.md` | NEW | P1 | Links: `resource.link()` config, `forwardArgs` mapping, `invalidate`, `optimisticUpdate`, `update`, combining strategies, multi-entry invalidation, timing & ordering |
| `lifecycle.md` | NEW | P1 | Lifecycle hooks: `onCacheEntryAdded` (entry, $cacheDataLoaded, $cacheEntryRemoved), `onQueryStarted` ($queryFulfilled, getCacheEntry), PromiseResolver semantics, error swallowing, typical patterns (WebSocket, cache warming) |
| `snapshot.md` | NEW | P1 | SSR & hydration: `getSnapshot()`, `api.initialSnapshot`, `snapshotValidTime` / `maxSnapshotDataAge`, version checks, what gets serialized (only success entries), hydration lifecycle |
| `broadcast.md` | NEW | P1 | Cross-tab sync: `syncDriver` option, `ISyncDriver` interface contract, `broadcastSyncDriver` setup, data flow between tabs, partial sync scenarios |
| `plugins.md` | NEW | P2 | Plugins: `reactHooksPlugin()` usage, writing a custom plugin (`IPlugin` interface), `install` / `augmentResource` contract, type-level augmentation pattern (`PluginResourceContributions`) |
| `devtools.md` | NEW | P2 | DevTools: `key` option for readable names, Redux DevTools integration, devtools config on API and resource level |

**Notes on `resource.md` update (P0)**:
- Extract links examples into `usage/links.md`, replace with cross-reference.
- Expand SKIP section or cross-reference `concepts/agent.md` for deep semantics.
- Add `idle` to status table (currently missing — it's the SKIP state). [ref: ../01-research/research-cache-resource.md#4. ResourceAgent]
- Ensure boolean flags match target `TResourceAgentState`. [ref: ../01-research/research-api-plugins.md#5. useResourceAgent]

**Notes on `command.md` update (P0)**:
- Extract links section into `usage/links.md`, replace with cross-reference.
- Commands are removed from code but kept in docs as target design. [ref: user-decisions.md#3]
- Clarify auto-sid generation vs explicit key. [ref: ../01-research/gaps-and-questions.md#Poorly covered / incomplete topics]

**Notes on `links.md` (P1)**:
- Currently split between `usage/command.md` (examples) and no standalone page. [ref: ../01-research/gaps-and-questions.md#Poorly covered / incomplete topics]
- Document `forwardArgs` → cache key resolution, timing of rollback on error. [ref: ../01-research/research-cache-resource.md#5. ResourceCacheEntry]

**Notes on `lifecycle.md` (P1)**:
- Document `PromiseResolver` rejection on query supersede. [ref: ../01-research/research-cache-resource.md#7. Lifecycle Hooks]
- Document error swallowing behavior. [ref: ../01-research/gaps-and-questions.md#Poorly covered / incomplete topics]

**Notes on `broadcast.md` (P1)**:
- Replaces `broadcast-RFC.md` stub. [ref: ../01-research/gaps-and-questions.md#Completely missing topics]
- Spec for `syncDriver` / `ISyncDriver` — target design, not necessarily current implementation.

---

## `docs/query/api/` — API Reference

Signatures, options tables, return types. Minimal prose — link to concepts/usage for explanations.

| File | Status | Priority | Description |
|------|--------|----------|-------------|
| `README.md` | EXISTS | P0 | `createApi`: factory signature, full options table, methods table (`createResource`, `createCommand`, `getSnapshot`, `resetAll`), plugin registration |
| `resource.md` | NEW | P0 | Resource API reference: `TResourceOptions` (all fields), returned `IApiResource` methods (useResource, trigger, refresh, getEntry, getEntry$, createAgent, link), return types |
| `command.md` | NEW | P0 | Command API reference: `TCommandOptions` (all fields), returned `IApiCommand` methods (useCommand, trigger, getEntry, getEntry$, createAgent), key parameter |
| `types.md` | NEW | P1 | Shared types: machine state types (`TPendingState`, `TSuccessState`, `TErrorState`, `TRefreshingState`), agent state (`TResourceAgentState`), `SKIP` / `SKIP_TOKEN`, `ArgsOrVoid`, `ArgsOrVoidOrSkip`, `IPatchHandle`, `LinkEntry`, snapshot types |

**Notes on `api/README.md` update (P0)**:
- Rename `snapshotValidTime` → `maxSnapshotDataAge` if that's the target name (currently inconsistent between doc and code). [ref: ../01-research/research-api-plugins.md#1. createApi]
- Add `strategy` option (`"serialize"` | `"compare"`). [ref: ../01-research/research-api-plugins.md#1. createApi]
- Add `doCacheArgs` option. [ref: ../01-research/research-api-plugins.md#1. createApi]
- Update dead links (`../usage/snapshot.md`, `../usage/broadcast.md`) — they'll become valid with new pages.

---

## `docs/query/internal/` — Internal Docs (Contributors)

Implementation details for contributors. Not required for users.

| File | Status | Priority | Description |
|------|--------|----------|-------------|
| `README.md` | NEW | P2 | Internal architecture overview: C4 component diagram, module dependencies (core → types, api → core, plugins → core, react → plugins), build & test notes |
| `cache-internals.md` | NEW | P2 | CacheEntry: RxJS share + ReplaySubject + resetOnRefCountZero pipeline, Signal bridge, completion lifecycle. CacheMap: SerializeCacheMap vs CompareCacheMap implementations, eviction wiring via onClean$ |
| `patcher.md` | NEW | P2 | Patcher: `resolvePatches` algorithm (committed→bake, aborted→inverse, pending→keep), Immer `enablePatches` setup, `finishPatch` reference equality, consistency violation recovery path |

---

## Summary

| Directory | EXISTS | NEW | STUB/REMOVE | Total |
|-----------|--------|-----|-------------|-------|
| Root | 0 | 1 | 1 (remove) | 2 |
| `concepts/` | 1 | 3 | 0 | 4 |
| `usage/` | 2 | 6 | 0 | 8 |
| `api/` | 1 | 3 | 0 | 4 |
| `internal/` | 0 | 3 | 0 | 3 |
| **Total** | **4** | **16** | **1** | **21** |

| Priority | Count |
|----------|-------|
| P0 | 7 (README, machine.md, resource.md×2, command.md×2, api/README.md) |
| P1 | 10 (cache, agent, patching, links, lifecycle, snapshot, broadcast, api/types, api/resource — wait, api/resource is P0) |
| P2 | 4 (plugins, devtools, internal/*) |

### Suggested writing order (P0 first)

1. `README.md` — architecture overview (everything else references it)
2. `concepts/machine.md` — update to match target design (5 states, lastError, patchState)
3. `api/README.md` — update createApi reference (new options, fix dead links)
4. `api/resource.md` — resource API reference
5. `api/command.md` — command API reference
6. `usage/resource.md` — update, extract links
7. `usage/command.md` — update, extract links
8. P1 concepts: `cache.md`, `agent.md`, `patching.md`
9. P1 usage: `links.md`, `lifecycle.md`, `snapshot.md`, `broadcast.md`
10. P1 api: `types.md`
11. P2: `plugins.md`, `devtools.md`, `internal/*`
