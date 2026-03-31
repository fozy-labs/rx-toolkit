---
title: "Open Questions: CommandV2 in query-v2"
date: 2026-03-30
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: Which v1 Command features MUST be ported to CommandV2?

**Context**: Command v1 exposes: state machine (create/load/success/error), CommandAgent (per-component mutation tracking), link system (invalidate, lock, update, optimisticUpdate, create), `select` transform, lifecycle hooks (`onCacheEntryAdded`, `onQueryStarted`), `mutate()` (deprecated Promise wrapper), `isRepeating` flag, `ResetAllQueriesSignal` subscription, and devtools integration. Query-v2 already has its own Patcher, lifecycle hooks, and signal infrastructure. Some v1 features may be redundant or superseded.

**Options**:
1. **Full parity** — port everything including `lock`, `create`, `isRepeating`, `mutate()` — Pros: zero migration friction / Cons: carries forward deprecated/rarely-used API surface, increases scope
2. **Core + link essentials** — port state machine, agent, `invalidate`, `update`, `optimisticUpdate`; drop `lock`, `create`, `mutate()`, `isRepeating` — Pros: lean API, aligns with query-v2 philosophy / Cons: breaking for users relying on lock/create
3. **Minimal MVP** — port state machine and agent only; links deferred to a later phase — Pros: fast delivery, can iterate / Cons: commands without invalidation are nearly useless in practice

**Risks**: Dropping `lock` or `create` without deprecation path leaves users stranded. Over-porting wastes effort on features nobody uses.

**Researcher recommendation**: Option 2 is the sweet spot — `lock` and `create` are niche; `mutate()` is already deprecated; `isRepeating` can be derived from agent state. Confirm via usage audit.

---

### Q2: What state machine shape should CommandV2 use — v2 immutable machines or a simplified variant?

**Context**: v1 uses a flat `CommandQueryState` static class with `create/load/success/error` transitions and flags like `isRepeating`, `isDone`, `isInitiated`. v2 Resource uses an immutable class hierarchy (`MachinePending → MachineSuccess | MachineError`, `MachineSuccess → MachineRefreshing`). Commands differ from resources: they don't have a "refreshing" concept (no stale-while-revalidate), they don't keep cached results between invocations, and `pending` semantics differ (commands start idle, not pending).

**Options**:
1. **Reuse v2 Resource machine as-is** — map `pending=loading`, ignore `refreshing` — Pros: zero new machine code, unified Patcher integration / Cons: `refreshing` state is meaningless for commands; `MachineSuccess.invalidate()` transition makes no sense; would need to suppress/ignore states
2. **Create a parallel CommandMachine hierarchy** — `CommandIdle → CommandLoading → CommandSuccess | CommandError` — Pros: clean semantics, no ghost states, `idle` vs `pending` distinction / Cons: duplicated machine pattern, more code
3. **Extend v2 machines with a discriminator** — add a `kind: "resource" | "command"` field, restrict transitions per kind — Pros: single hierarchy / Cons: violates SRP, leaky abstraction, testing complexity
4. **Flat state object (v1 style)** — simple `{ status, data, error, args }` without class hierarchy — Pros: simple / Cons: loses immutable transition guarantees, inconsistent with v2 patterns

**Risks**: Forcing resource machine onto commands creates confusing states (`refreshing` on a command). A fully separate machine duplicates Patcher integration.

**Researcher recommendation**: Option 2 — commands have fundamentally different lifecycle (idle→loading→done vs pending→success→refreshing). Patcher can be shared as a standalone utility.

---

### Q3: How should CommandV2 link/invalidation work with v2 Resources?

**Context**: v1 links target `ResourceInstance` (v1) via `ResourceRef` which exposes `lock()`, `patch()`, `invalidate()`, `create()`. v2 Resources (`IResourceV2`) expose `invalidate(args)`, `getEntry(args)`, and entries expose `createPatch(patchFn)→IPatchHandle`. The APIs are structurally different. CommandV2 must target v2 Resources.

**Options**:
1. **Direct v2 Resource method calls** — CommandV2 calls `resource.invalidate(args)` and `entry.createPatch(fn)` directly, no intermediate `Ref` abstraction — Pros: simple, uses existing v2 API / Cons: tightly couples Command internals to Resource internals; harder to mock/test
2. **New CommandRef adapter** — lightweight wrapper over v2 Resource that exposes `invalidate()`, `patch()`, `commitPatch()`, `abortPatch()` for a specific args tuple — Pros: clean boundary, testable, mirrors v1 `ResourceRef` concept / Cons: another layer of indirection
3. **Plugin-based linking** — links are a separate plugin, not baked into Command core — Pros: keeps Command core minimal, extensible / Cons: links are so fundamental to commands that making them optional adds friction

**Risks**: Without a Ref adapter, link logic becomes entangled with Resource internals. If v2 Resource API changes, all command link code breaks.

**Researcher recommendation**: Option 2 — a thin `ResourceV2Ref` adapter keeps boundaries clean and mirrors the proven v1 pattern. The adapter can be <30 LOC.

---

### Q4: Should CommandV2 use CacheMap or simpler per-agent state?

**Context**: v1 Command creates a `QueriesCache` (key→ReactiveCache map) but `CommandAgent` always replaces the current entry — agents don't look up previous results by args. v2 Resource uses `CacheMap` heavily for SWR caching. Commands are fire-and-forget mutations; caching results by args is unusual. However, v1 uses caches for lifecycle hooks (`onCacheEntryAdded`) and the `cacheLifetime` cleanup pattern.

**Options**:
1. **No CacheMap — state lives on CommandV2Agent** — each agent holds a single `CacheEntry` or raw `Signal.state`. Command class is stateless. — Pros: simple, matches mutation semantics / Cons: no `onCacheEntryAdded` anchor, can't share state between agents, `ResetAllQueriesSignal` harder to implement
2. **CacheMap but with 1-entry-per-agent semantic** — Command owns CacheMap keyed by agent ID, each agent gets exactly one entry — Pros: reuses v2 infra, lifecycle hooks work, reset works / Cons: map overhead for single-entry usage
3. **Simple Map<AgentId, CacheEntry>** — lightweight map without serialization/compare complexity — Pros: minimal overhead, still supports reset & lifecycle / Cons: reinvents a simpler CacheMap anyway
4. **Shared CacheMap keyed by args** (like v1) — Pros: multiple agents with same args share state / Cons: commands rarely benefit from this; adds stale-result confusion

**Risks**: Over-engineering cache infra for commands wastes effort. Under-engineering breaks lifecycle hooks and `resetAll()`.

**Researcher recommendation**: Option 3 — a simple `Map<symbol, CacheEntry>` per Command, where each agent gets a unique symbol key. Supports lifecycle + reset without CacheMap overhead.

---

### Q5: How must the plugin system change for Command support?

**Context**: v2 plugin system is resource-centric: `IPlugin.augmentResource()`, `PluginResourceContributions` conditional type, `ReactHooksPlugin` returns `useResourceV2Agent`. There is no `augmentCommand()` hook, no `PluginCommandContributions` type, and the `IApi` interface only has `createResourceV2()`.

**Options**:
1. **Add parallel command hooks to IPlugin** — `augmentCommand?(command, options)→Record`, new `PluginCommandContributions` conditional type — Pros: symmetric with resource, plugins can contribute command-specific hooks / Cons: doubles plugin type complexity, every plugin gets two optional methods
2. **Single `augment()` method with discriminated union** — `augment(target: Resource | Command)` — Pros: one method / Cons: unclear type inference, plugin must branch internally
3. **Commands opt out of plugin augmentation initially** — plugins only augment resources; `useCommandV2Agent` is a standalone export — Pros: minimal plugin changes, fast delivery / Cons: inconsistent API surface (`resource.useResourceV2Agent()` vs standalone `useCommandV2Agent()`)
4. **Generic `augment(kind, target)` refactor** — Pros: extensible to future entity types / Cons: over-engineering for two entity types

**Risks**: If commands skip plugin augmentation, the `createApi` DX is inconsistent (resources get augmented methods, commands don't). If plugins are extended, type complexity may explode.

**Researcher recommendation**: Option 1 — symmetry matters for DX. `augmentCommand` is optional on `IPlugin`, so existing plugins don't break. `PluginCommandContributions` conditional type follows the same pattern.

---

### Q6: What should the public API look like on `createApi`?

**Context**: Currently `createApi` returns `{ createResourceV2, resetAll, getSnapshot }`. v1 exposes `createCommand` as a standalone factory. Users need a way to create CommandV2 instances that inherit API defaults, participate in `resetAll()`, and get plugin augmentation.

**Options**:
1. **`api.createCommandV2(options)`** — mirrors `createResourceV2`, returns augmented CommandV2 instance — Pros: consistent, discoverable / Cons: snapshot for commands is debatable (commands don't cache data long-term)
2. **Standalone `createCommandV2(options)` only** — no API integration — Pros: simple, matches v1 / Cons: no shared defaults, no `resetAll()`, no plugin augmentation
3. **Both** — standalone factory + `api.createCommandV2()` — Pros: flexibility / Cons: two code paths to maintain

**Risks**: Excluding commands from `createApi` means commands can't participate in `resetAll()` or inherit `keyStrategy`/`cacheLifetime` defaults.

**Researcher recommendation**: Option 3 — standalone for simple use cases, `api.createCommandV2()` for full integration, matching the resource pattern (`_createResourceV2` standalone + `api.createResourceV2`).

---

## Medium Priority

### Q7: Should CommandV2 support `select` transforms?

**Context**: v1 Command supports `select(data)→selected` allowing post-processing of command results. v2 Resource does NOT have select (it was removed). Adding select to CommandV2 but not ResourceV2 would be asymmetric.

**Options**:
1. **Include select** — Pros: useful for API response normalization / Cons: asymmetric with v2 resource, adds `Data` vs `Result` vs `Selected` type complexity
2. **Drop select** — Pros: simpler types, consistent with v2 resource / Cons: users must transform data manually

**Risks**: Low — select is syntactic sugar; `.then(transform)` in queryFn achieves the same result.

**Researcher recommendation**: Option 2 — drop `select` for consistency with v2 design philosophy. Document the queryFn-based alternative.

---

### Q8: How should CommandV2 participate in snapshots/SSR?

**Context**: v2 Resource supports `getSnapshot()` and `hydrateEntry()` for SSR. Commands are mutations — snapshotting their last result is unusual but could be useful for SSR'd pages that show "last action" state.

**Options**:
1. **Exclude commands from snapshots** — Pros: simple, semantically correct (mutations aren't cached) / Cons: can't restore command state on hydration
2. **Include commands in snapshots** — Pros: full state restoration / Cons: unclear semantics, stale mutation results served on hydrate

**Risks**: Low — SSR for mutations is an edge case.

**Researcher recommendation**: Option 1 — exclude from snapshots. Commands start in idle state on every page load.

---

### Q9: Should CommandV2Agent support SWR-like previous data?

**Context**: v2 ResourceV2Agent tracks `_previous$` for stale-while-revalidate UX. v1 CommandAgent does NOT track previous results — each initiation is independent. However, showing "last successful result" while a new mutation is in-flight could be useful (e.g., showing the last server response in a form).

**Options**:
1. **No previous tracking** — Pros: simpler, matches v1, matches mutation semantics / Cons: can't show stale data during re-mutation
2. **Optional previous tracking** — Pros: flexibility / Cons: adds complexity to agent state shape

**Risks**: Low — this is a convenience feature.

**Researcher recommendation**: Option 1 — commands are fire-and-forget. Previous data adds confusion. Users can track this in component state if needed.

---

## Low Priority

### Q10: Naming convention — `CommandV2` or `Mutation`?

**Context**: v1 uses "Command" (CQRS terminology). The broader ecosystem (React Query, RTK Query) uses "Mutation". Query-v2 uses "ResourceV2" (not "QueryV2").

**Options**:
1. **CommandV2** — Pros: naming consistency with v1, CQRS alignment / Cons: less familiar to React Query migrants
2. **Mutation** — Pros: industry-standard terminology / Cons: breaks continuity with v1
3. **CommandV2** externally, "mutation" in docs — Pros: both audiences served / Cons: terminology mismatch

**Risks**: Purely cosmetic. Name can be aliased.

**Researcher recommendation**: Option 1 — keep `CommandV2` for continuity. Docs can mention "mutation" as a synonym.

---

### Q11: Should devtools integration be built-in or plugin-based?

**Context**: v1 Command has built-in devtools integration via `QueriesLifetimeHooks`. v2 hasn't formalized devtools for resources yet. Building devtools into CommandV2 core couples it to the devtools implementation.

**Options**:
1. **Built-in** (like v1) — Pros: works out of the box / Cons: coupling, bloat for non-devtools users
2. **Plugin-based** — Pros: opt-in, decoupled / Cons: more setup for users who want devtools
3. **Deferred** — ship without devtools, add later — Pros: fast MVP / Cons: debugging harder during development

**Risks**: Low — devtools can always be added later.

**Researcher recommendation**: Option 3 — defer devtools. Focus on core functionality first.
