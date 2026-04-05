---
title: "Research — cache.md content plan"
date: 2026-04-05
stage: research
role: researcher
sources: docs-only (Rule #11)
---

# Research: what goes into `docs/query/concepts/cache.md`

## 1. Proposed sections

1. **Intro** — CacheEntry as reactive container holding one Machine; CacheMap as indexed collection of entries.
2. **Key derivation** — two strategies: `serialize` (args→string via `serializeArgs`/`stableStringify`) and `compare` (reference equality). Chosen per-resource at creation.
3. **CacheEntry lifecycle** — creation → active (has subscribers) → retention window → removal from CacheMap.
4. **`cacheRetentionTime` & GC** — refcount-based timer (default 60 s); `false` = keep forever. Configurable at API and resource level.
5. **`serializeArgs` & `stableStringify`** — default serializer, custom override, how key maps to entry.
6. **Relationship to Machine** — entry *holds* a Machine; each Machine transition produces new immutable instance inside entry.

## 2. Topics to cover & doc sources

| Topic | Source(s) in existing docs |
|-------|---------------------------|
| CacheEntry = reactive container, Signal + Observable | [architecture.md][arch] — "Кеш" section |
| CacheMap = passive container, eviction via `onClean$` | [architecture.md][arch] — "Кеш" section |
| Two strategies: `serialize` vs `compare` | [architecture.md][arch] — CacheMap description |
| `cacheRetentionTime` default 60 s, `false` disables | [api/README.md][api] — options table; [api/resource.md][api-res] — options table |
| Retention lifecycle: last subscriber drops → timer → removed | [architecture.md][arch] — CacheEntry; [usage/resource.md][usage-res] — point 3 ("Кеш-запись сохраняется в течение cacheRetentionTime") |
| `serializeArgs` / `stableStringify` | [api/README.md][api] — options; [api/resource.md][api-res] — options |
| Instant cache hit on remount | [usage/resource.md][usage-res] — point 4 |
| Entry holds one Machine | [architecture.md][arch] — diagram + "хранит"; [machine.md][machine] — immutable transitions |
| `onCacheEntryAdded` hook (entry created) | [api/resource.md][api-res]; [usage/resource.md][usage-res] — lifecycle section |
| `getEntry` / `getEntry$` for programmatic access | [api/resource.md][api-res] — methods; [usage/resource.md][usage-res] — imperative API |
| Glossary: CacheEntry = "GC по refcount-таймеру" | [architecture.md][arch] — glossary |
| Glossary: CacheMap = "индексированных ключом" | [architecture.md][arch] — glossary |

## 3. Items from docs-toc design notes (NOT in existing docs — user decision needed)

docs-toc.md mentions these in "Notes on cache.md" but they come from code research, not existing docs:

- `stableStringify` limitations (no Date/Map/Set/RegExp) — not documented anywhere yet.
- `doCacheArgs` option (WeakMap optimization) — not in any existing doc.
- `compareArg` option — not in any existing doc.
- `strategy` option (`"serialize"` | `"compare"`) — architecture.md describes the two strategies conceptually, but no explicit `strategy` option is documented.

Per Rule #11: do NOT add these unless user explicitly requests. Flag for user decision.

## 4. What NOT to include

- RxJS internals (share, ReplaySubject, resetOnRefCountZero) — belongs in `internal/cache-internals.md` (P2)
- Signal bridge implementation — internal
- Code-level class names (SerializeCacheMap, CompareCacheMap) — internal
- Usage flows (how useResource triggers queries) — belongs in `usage/resource.md`
- Lifecycle hooks details (onCacheEntryAdded body) — belongs in `usage/lifecycle.md`
- Patching/optimistic updates — belongs in `concepts/patching.md`
- Snapshot/SSR — belongs in `usage/snapshot.md`
- Agent/SWR behavior — belongs in `concepts/agent.md`

## 5. Cross-references needed

| From cache.md | To |
|---------------|----|
| Machine inside entry | [concepts/machine.md][machine] |
| Agent observes entry | [concepts/agent.md][agent] |
| Patching via entry | [concepts/patching.md][patching] |
| `onCacheEntryAdded` hook | [usage/lifecycle.md][lifecycle] |
| `getEntry` / `getEntry$` | [api/resource.md][api-res] |
| Snapshot = serialized success entries | [usage/snapshot.md][snapshot] |
| `cacheRetentionTime` option | [api/README.md][api], [api/resource.md][api-res] |
| Architecture overview | [concepts/architecture.md][arch] |

## 6. Diagram candidates

- **Entry lifecycle** state diagram: `created → active → retention → removed` (one focused diagram, Rule #6).
- **Key derivation** flow: args → serialize/compare → CacheMap lookup → CacheEntry (optional, only if adds clarity beyond text).

---

[arch]: ../../docs/query/concepts/architecture.md
[api]: ../../docs/query/api/README.md
[api-res]: ../../docs/query/api/resource.md
[usage-res]: ../../docs/query/usage/resource.md
[machine]: ../../docs/query/concepts/machine.md
[agent]: ../../docs/query/concepts/agent.md
[patching]: ../../docs/query/concepts/patching.md
[lifecycle]: ../../docs/query/usage/lifecycle.md
[snapshot]: ../../docs/query/usage/snapshot.md
