---
title: "Architecture Decision Records — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-architect
---

# Architecture Decision Records — query-v2

---

## ADR-1: Module Layering Strategy

### Status
Proposed

### Context
The query-v2 module is complex: state machines, caching, lifecycle hooks, API factories, plugins, snapshot/SSR, and React integration. A flat structure would create circular dependencies and make testing difficult. V1 uses a `lib/ → core/ → api/ → react/` layering with proven success. [ref: ../01-research/02-codebase-query-v1.md#1-module-structure-and-organization]

External research confirms: all major libraries (TanStack Query, RTK Query, Apollo) separate core logic from framework bindings and from entry-point factories. [ref: ../01-research/03-external-research.md#1-comparative-analysis]

### Options Considered

1. **5-layer strict hierarchy (`lib/ → core/ → api/ → react/ → plugins/`)** — Each layer depends only on layers below. Types in a separate `types/` directory (no runtime). Plugins as Layer 5 above `react/`.
   - Pros: proven in v1; prevents circular deps; each layer independently testable
   - Cons: more directories; some boilerplate re-exports at barrel level

2. **Flat structure** — all modules at the same level, managed by import discipline.
   - Pros: simpler directory tree; fewer barrel files
   - Cons: no structural enforcement of dependency rules; easy to create cycles; v1 started flat and was refactored to layered

3. **Feature-based grouping** (`resource/`, `snapshot/`) — each feature folder contains its own lib/core/api/react.
   - Pros: high cohesion within features
   - Cons: cross-feature sharing (CacheEntry, machines, plugins) doesn't fit; duplicated infrastructure

### Decision
**Option 1**: 5-layer strict hierarchy (`lib/ → core/ → api/ → react/ → plugins/`). This extends v1's proven 4-layer structure with a plugins layer and provides clear testability boundaries.

### Consequences
- **Positive**: Each layer can be tested in isolation; dependency direction is enforceable via lint rules
- **Negative**: Barrel files (`index.ts`) needed at each layer; some re-exports may feel redundant
- **Risks**: Discipline needed to not shortcut layers (e.g., react/ importing from core/ directly) — mitigable with lint rule

---

## ADR-2: State Machine Implementation — Immutable Class-Based

### Status
Proposed

### Context
ResourceV2 cache entries transition through states: idle → pending → success/error → refreshing. Two approaches are possible: immutable class instances with methods (current v2 design) or plain state objects with external transition functions. [ref: ../01-research/01-codebase-query-v2.md#21-machine-state-model]

V2's current machine classes are immutable — transitions return new instances. This provides method-based transitions (`machine.start()`, `machine.invalidate()`) and `instanceof` checks. However, the class hierarchy had type issues due to `TError` (now removed). [ref: ../01-research/01-codebase-query-v2.md#55-type-inconsistency]

The v0.1 docs describe strongly-typed machines with methods specific to each status. [ref: docs/query-v2/v0.1/Внутриянка.md]

### Options Considered

1. **Immutable class instances** — `MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`. Transitions as methods returning new instances. `MachineWithData` abstract base for Success/Refreshing.
   - Pros: type-safe transitions (only valid methods per state); `instanceof` for runtime discrimination; encapsulates patch logic in `MachineWithData`; matches v0.1 docs requirement for strong typing
   - Cons: class hierarchy; serialization requires extracting `.state`; more boilerplate than plain objects

2. **Plain state objects + external factory** — `TMachineState` discriminated union. Transition functions: `transition(state, event) → newState`.
   - Pros: serializable by default; simpler types; no class hierarchy
   - Cons: lose method-based transitions; no `instanceof`; all transition functions must be imported separately; type narrowing only via `.status` discriminant

3. **Hybrid: classes for logic, extract `.state` for storage** — CacheEntry stores class instances, snapshot extracts `.state`.
   - Pros: best of both; classes for DX, plain objects for serialization
   - Cons: dual representation; must convert at snapshot boundary

### Decision
**Option 1** with `.state` extraction for snapshots (effectively Option 3 at the boundary). Immutable class-based machines provide the best developer experience for state transitions and align with v0.1 docs' strong typing requirements. Removing `TError` eliminates the type composition issues that plagued the current implementation.

**Legacy anti-pattern resolved**: The legacy implementation carries `TError` as a generic parameter, causing ~30+ `as unknown as` casts in `ResourceV2.ts` where machine types don't compose. By dropping `TError`, all types compose cleanly through the `Machine → CacheEntry → ResourceV2 → Agent` chain without any intermediate casts.

### Consequences
- **Positive**: Method-based transitions prevent invalid state changes at the type level; `MachineWithData` centralizes patch logic; `Machine.fromSnapshot()` handles deserialization; zero `as unknown as` casts needed
- **Negative**: Snapshot boundary requires `.state` extraction — a minor mapping
- **Risks**: None significant — this is a refinement of the existing design with the broken parts (TError) removed

---

## ADR-3: SWR Previous/Current Swap Semantics

### Status
Proposed

### Context
Stale-while-revalidate is a core UX feature: when args change, show previous data while loading new data. The current v2 implementation clears `previous` immediately after setting it, defeating SWR entirely. [ref: ../01-research/01-codebase-query-v2.md#63-startargs-method] [ref: ../01-research/README.md#key-findings]

V1's `ResourceAgent` keeps `previous$` alive until the new cache entry reaches a resolved state (`isDone`). [ref: ../01-research/02-codebase-query-v1.md#22-resourceagent]

All five external libraries implement SWR correctly: cached data shown during background refetch. [ref: ../01-research/03-external-research.md#22-stale-while-revalidate-pattern]

### Options Considered

1. **V1 pattern: keep previous until current resolves** — `ResourceAgent` tracks `{previous, current}` cache entries. Previous is nulled only when current reaches success/error.
   - Pros: proven in v1; matches all external libraries; correct SWR behavior; previous data available for UI transitions
   - Cons: must handle rapid arg changes (previous → previous → current chains); must handle reset while SWR is active

2. **Signal-derived: compute previousData from current machine state** — No separate previous entry. If current is pending, derive `previousData` from last known success.
   - Pros: simpler tracking; no separate entry reference
   - Cons: loses previousData if machine resets to idle; can't show previous data across different args (only within same cache entry)

3. **Timer/debounce: clear previous after delay** — Hold previous for a fixed timeout.
   - Pros: handles rapid changes
   - Cons: timing-sensitive; wrong UX if fetch takes longer than timer

### Decision
**Option 1**: Keep previous entry until current resolves. This is the proven SWR pattern from v1 and all major external libraries.

**Legacy anti-pattern resolved**: The legacy `ResourceV2Agent.start()` sets `previous ← current` then immediately clears `previous` to `null` on the next line, completely defeating SWR. The proven v1 approach keeps `previous` alive until `current` resolves.

**Specific swap logic for ResourceAgent.start(newArgs):**
1. If current entry exists and is in success/error state: `previous ← current`
2. If current entry is still pending (rapid change): previous stays as-is (don't chain)
3. `current ← new entry`
4. When current's machine reaches success or error: `previous ← null`

### Consequences
- **Positive**: Correct SWR behavior; users see stale data during loading; no data flicker
- **Negative**: Slightly more complex agent state; must track two cache entry references
- **Risks**: Rapid arg changes need careful handling — previous should not accumulate. Mitigated by the "don't chain" rule in point 2.

---

## ADR-4: CacheEntry Abstraction Boundary — Inheritance

### Status
Proposed

### Context
Three designs exist for the CacheEntry API surface: (a) minimal internal container with a separate wrapper, (b) ResourceV2CacheEntry inheriting from CacheEntry per v0.1 docs (`IResourceV2CacheEntry наследуется от ICacheEntry`), (c) minimal CacheEntry only. [ref: ../01-research/04-open-questions.md#q4-what-should-the-cacheentry-api-surface-look-like]

V1 has no CacheEntry abstraction — consumers interact via Agent and ResourceRef. V0.1 docs describe `IResourceV2CacheEntry` inheriting from `ICacheEntry` and adding resource-specific methods (`isMyArgs`, `createPatch`, `invalidate`). [ref: docs/query-v2/v0.1/README.md]

### Options Considered

1. **ResourceV2CacheEntry extends CacheEntry (inheritance)** — `CacheEntry<TState>` is the generic reactive container (`state$`, `set`, `complete`, `onClean$`). `ResourceV2CacheEntry<TArgs, TData>` extends `CacheEntry<TMachineInstance<TArgs, TData>>` via class inheritance. It inherits `state$()`, `peek()`, `set()`, `complete()`, `onClean$` and adds resource-specific members: `machine$` (signal property, alias for `state$()`), `isMyArgs()`, `createPatch()`, `invalidate()`. ResourceV2 stores entries as `ResourceV2CacheEntry` instances in `CacheMap<ResourceV2CacheEntry>`.
   - Pros: single object per entry (no wrapper allocation); v0.1 docs explicitly state inheritance ("наследуется от ICacheEntry"); `instanceof` checks work naturally; CacheEntry base stays generic; clean dependency chain: `ResourceV2 → CacheMap<ResourceV2CacheEntry> → ResourceV2CacheEntry extends CacheEntry → Machine`
   - Cons: ResourceV2CacheEntry exposes CacheEntry mutation methods (set, complete) — acceptable since both types are internal

2. **Composition/wrapper: IResourceV2CacheEntry wraps CacheEntry** — ResourceV2CacheEntry holds a private `_entry: CacheEntry` field and delegates calls.
   - Pros: consumer API can hide internal CacheEntry methods (set, complete)
   - Cons: extra wrapper allocation per entry; delegation boilerplate; contradicts v0.1 docs which specify inheritance; breaks the clean dependency chain

3. **Minimal CacheEntry only, no ResourceV2CacheEntry** — Consumers get raw CacheEntry.
   - Pros: simplest
   - Cons: consumers need ResourceV2 reference for all operations; poor DX; doesn't match v0.1 docs

### Decision
**Option 1**: `ResourceV2CacheEntry extends CacheEntry` (inheritance). The v0.1 docs explicitly specify inheritance (`IResourceV2CacheEntry наследуется от ICacheEntry`). Inheritance provides a single object per entry with no wrapper overhead, a clean dependency chain (`ResourceV2 → CacheMap<ResourceV2CacheEntry> → ResourceV2CacheEntry extends CacheEntry → Machine`), and natural `instanceof` checks. CacheEntry mutation methods being visible on ResourceV2CacheEntry is acceptable because both types are internal (not part of the public API boundary).

### Consequences
- **Positive**: Clean dependency chain with no indirection; single object per entry; matches v0.1 docs specification; CacheEntry base stays generic and reusable; no delegation boilerplate
- **Negative**: CacheEntry mutation methods (`set`, `complete`) visible on ResourceV2CacheEntry — acceptable for internal types
- **Risks**: None significant — inheritance is the simplest approach and aligns with the documented design

---

## ADR-5: GC Strategy — Refcount + Timer Hybrid

### Status
Proposed

### Context
Current v2 uses timer-only GC: `scheduleGc` starts a `setTimeout` on query completion. This doesn't account for active React subscriptions — data can be GC'd while a component is still showing it. [ref: ../01-research/01-codebase-query-v2.md#53-public-methods]

V1 uses timer-based via RxJS `share()` operator with `resetOnRefCountZero` — the timer starts only when subscriber count reaches zero. [ref: ../01-research/02-codebase-query-v1.md#52-reactivecache]

All major libraries use refcount + timer: TanStack Query (`gcTime` after zero observers), RTK Query (`keepUnusedDataFor` after zero subscriptions), Relay (retain/release + buffer). [ref: ../01-research/03-external-research.md#25-cache-garbage-collection-approaches]

### Options Considered

1. **Timer-only (current v2)** — GC timer starts immediately on query completion.
   - Pros: simple implementation
   - Cons: can GC data while components are still mounted; users must track subscriptions carefully

2. **Refcount + timer hybrid** — Track signal subscribers (via CacheEntry signal's subscription count). GC timer starts only when refcount reaches 0. Timer cancelled if new subscriber appears.
   - Pros: correct behavior; data never GC'd while observed; matches industry standard
   - Cons: must track subscriber count accurately; signal system needs to expose subscriber info or provide a hook

3. **Manual-only** — explicit `release()` calls.
   - Pros: predictable
   - Cons: leak-prone; terrible DX

### Decision
**Option 2**: Refcount + timer hybrid using the `share({resetOnRefCountZero})` RxJS pattern from v1's `ReactiveCache`. This is a proven, familiar pattern already in use in the codebase.

**Legacy anti-pattern resolved**: The legacy v2 `ResourceV2` uses plain `setTimeout`/`clearTimeout` stored in `_gcTimers: Map<string, setTimeout>`. GC timers are scheduled on query completion regardless of subscriber status. This can evict data while React components are still mounted. The v1 `ReactiveCache` elegantly solves this with `share()` — the new design adopts this approach.

**Implementation approach — share({resetOnRefCountZero}) from v1 ReactiveCache**:

CacheEntry's observable pipeline wraps the underlying `Signal.state` BehaviorSubject with `share()` and `finalize()`:

```typescript
this._value$ = signalize(
    this._signal$.pipe(
        finalize(() => {
            this.complete();
        }),
        share({
            connector: () => new ReplaySubject(1),
            resetOnRefCountZero: this._getOnRefCountZero(cacheLifetime),
            resetOnComplete: true,
        }),
    ),
);
```

Where `_getOnRefCountZero(cacheLifetime)` returns:
- `false` when `cacheLifetime === false` — GC disabled, never reset
- `true` when `cacheLifetime <= 0` — reset immediately on last unsubscribe
- `() => timer(cacheLifetime)` when `cacheLifetime > 0` — start timer on last unsubscribe; if a new subscriber appears before timer fires, the reset is cancelled automatically by `share()`

When the reset fires (timer completes with zero subscribers), `finalize()` calls `complete()` which performs full cleanup (ADR-14). ResourceV2 then removes the entry from CacheMap.

This approach is identical to v1's `ReactiveCache.ts` — battle-tested, familiar to the team, and requires no custom refcount tracking or explicit `setTimeout` management. The `share()` operator handles all subscriber bookkeeping internally.

[ref: src/query/lib/ReactiveCache.ts] — V1's `share({resetOnRefCountZero})` implementation.

### Consequences
- **Positive**: Solves the "GC while mounted" bug; reuses proven v1 pattern; no manual timer management; `share()` handles all edge cases (rapid subscribe/unsubscribe); familiar to the team
- **Negative**: Slightly more complex CacheEntry constructor; relies on RxJS `share()` semantics
- **Risks**: CacheEntry must expose its observable via `share()` pipeline. If signal subscription count is accessed differently (e.g., direct signal reads without RxJS subscription), those reads don't count toward refcount. Mitigable: agents and hooks subscribe via `.obs` (RxJS observable), which is the standard pattern.

---

## ADR-6: Patcher Safety — Consistency Violation Detection

### Status
Proposed

### Context
The Patcher uses Immer's `applyPatches` to apply/rollback patches. When patches are aborted out of order in a multi-patch scenario, `applyPatches` can throw because inverse patches reference paths/indices that no longer exist. V0.1 docs specify this as a "consistency violation" requiring auto-invalidation. [ref: docs/query-v2/v0.1/optimistic-updates.md] [ref: docs/query-v2/v0.1/Внутриянка.md]

Current implementation has no try/catch around `applyPatches`. [ref: ../01-research/01-codebase-query-v2.md#161-features-described-in-docs-but-not-implemented]

Without detection, stale patched data persists indefinitely — silent data corruption. [ref: ../01-research/README.md#key-findings]

### Options Considered

1. **Patcher returns error signal, ResourceV2 auto-invalidates** — `resolvePatches`/`finishPatch`/`abortAllPending` wrap `applyPatches` in try/catch. On catch, return `{ data: lastValidData, isConsistencyViolation: true }`. ResourceV2 checks the flag and calls `invalidate()`.
   - Pros: clean separation; Patcher stays pure (no resource reference); ResourceV2 decides what to do; matches v0.1 docs behavior
   - Cons: every call site must check the flag; slightly more complex return type

2. **Patcher throws, ResourceV2 catches** — Let Immer exception propagate. ResourceV2 wraps all patch operations in try/catch.
   - Pros: simpler Patcher
   - Cons: exceptions as control flow; risk of uncaught exceptions; multiple catch sites in ResourceV2

3. **Patcher auto-invalidates** — Patcher takes a callback for invalidation.
   - Pros: single location handles violation
   - Cons: Patcher gains resource-level responsibility; breaks layer separation

### Decision
**Option 1**: Patcher returns `IPatchResolution<TData>` containing `{ data, patchState }` from all mutation operations. The `patchState` field is a `TPatchState<TData> | null` object grouping `originalData`, `patches`, and `isConsistencyViolation` into a single structure.

On violation: `data` contains the last valid patched data before the failure, `patchState` is set to `null` (all patches dropped), and the `isConsistencyViolation` flag on the **previous** patchState signals that a violation occurred. `ResourceV2CacheEntry` stores `_patchState: TPatchState<TData> | null` as a private field — when patches are active, this field tracks the original (unpatched) data, the patch queue, and the consistency flag. When a Patcher operation returns `patchState.isConsistencyViolation === true`, `ResourceV2CacheEntry` triggers `invalidate()` automatically.

This structured approach eliminates the need for a sentinel type — when no patches are active, `patchState` is simply `null` (no need for a special "no original data" marker).

**Legacy anti-pattern resolved**: The legacy Patcher has no `try/catch` around `applyPatches`. When patches are aborted out of order, Immer throws an unhandled exception — silent data corruption with no recovery mechanism. The new design detects violations, preserves the flag in `TPatchState`, and auto-invalidates.

**Specific behavior per v0.1 docs:**
1. Consistency violation detected → ResourceV2.invalidate(args)
2. During invalidation, cache shows last valid patched data (not corrupted data)
3. When fresh data arrives from refetch, it replaces everything

### Consequences
- **Positive**: Data integrity preserved; silent corruption prevented; matches documented behavior; clean separation of concerns; `isConsistencyViolation` preserved in `TPatchState` (not lost after Patcher returns); sentinel type eliminated
- **Negative**: Every Patcher call site in ResourceV2CacheEntry must check the flag — 3-4 call sites total
- **Risks**: Edge case: violation during refreshing state — must handle gracefully (invalidation is already in progress). Mitigable: if already refreshing, skip the invalidation trigger.

---

## ADR-7: Cache Key Design — Minimal Stable Serialization

### Status
Proposed

### Context
Cache entries need deterministic keys for lookup. `stableStringify` provides sorted-key JSON.stringify. User decision: keep minimal — no Date/Map/Set support. [ref: ../01-research/04-open-questions.md#q10-what-cache-key-serialization-strategy-should-stablestringify-support]

Two strategies exist: `serialize` (string keys via `stableStringify` or custom `serializeArgs`) and `compare` (linear scan with `compareArg` function). [ref: ../01-research/01-codebase-query-v2.md#42-cachemap]

### Options Considered

1. **Minimal stableStringify (current)** — Handles plain objects, arrays, primitives with sorted keys. No Date/Map/Set. Users with complex args provide custom `serializeArgs`.
   - Pros: simple; covers 90% of cases; custom override available
   - Cons: silent key collision on Date/Map/Set args (mitigated by custom serializer option)

2. **Extended stableStringify** — Handle Date, Map, Set, RegExp with type prefixes.
   - Pros: safer out of the box
   - Cons: more code; may conflict with custom `serializeArgs`; edge cases (circular refs, Symbol values)

3. **Pluggable serializer, simple default** — Config option for serializer function.
   - Pros: flexible
   - Cons: one more option (already exists as `serializeArgs`)

### Decision
**Option 1**: Keep `stableStringify` minimal. The `serializeArgs` override already exists for custom needs. The `compare` strategy handles non-serializable args natively.

**Internal implementation for serialize strategy**: `SerializeCacheMap<TArgs, TEntry>` uses `Map<string, TEntry>` as backing store. Args are serialized to a string key via `stableStringify` (or custom `serializeArgs`). All operations — `get`, `getOrCreate`, `delete`, `has` — are O(1) hash map lookups. See [ADR-19](04-decisions.md#adr-19-cachemap-dual-implementation-with-factory-pattern) for the dual implementation design.

### Consequences
- **Positive**: Simple implementation; custom override available; `compare` strategy for non-serializable args
- **Negative**: Users passing Date/Map/Set as args without custom serializer get silent key collisions — must document this limitation
- **Risks**: Low — this matches the user's binding constraint and affects only users with non-primitive args who don't provide `serializeArgs`

---

## ADR-8: Snapshot Bridge — Signal State Extraction

### Status
Proposed

### Context
Snapshots must convert reactive signal-based state into serializable plain objects for SSR transfer. Two boundaries: capture (signal → snapshot) and hydrate (snapshot → signal). [ref: ../01-research/01-codebase-query-v2.md#7-snapshot-system] [ref: docs/query-v2/v0.1/ssr.md]

### Options Considered

1. **Extract machine `.state` during capture, reconstruct via `Machine.fromSnapshot()` during hydrate** — `getSnapshot()` iterates resources, peeks each CacheEntry, extracts `.state` from success machines. `hydrateSnapshot()` uses `Machine.fromSnapshot(state)` to reconstruct class instances.
   - Pros: clean boundary; snapshot is plain JSON; no class serialization; `Machine.fromSnapshot` already exists
   - Cons: minor mapping at each boundary

2. **Store plain state objects in CacheEntry, skip extraction** — CacheEntry uses plain `TMachineState` instead of class instances.
   - Pros: no extraction needed
   - Cons: rejected in ADR-2; loses method-based transitions

3. **Custom serializer/deserializer protocol** — Each machine class implements `toJSON()`/`fromJSON()`.
   - Pros: encapsulated serialization
   - Cons: over-engineering; `toJSON` on class instances causes issues with `JSON.stringify` (accidental double-serialize)

### Decision
**Option 1**: Extract `.state` during capture, reconstruct via `Machine.fromSnapshot()` during hydrate. This follows naturally from ADR-2's class-based machine design.

**Capture flow:**
1. `api.getSnapshot(): TApiSnapshot` — Iterate all resources via internal `resource.cacheEntries(): IterableIterator<[string | TArgs, ResourceV2CacheEntry<TArgs, TData>]>`
2. For each entry: `CacheEntry.peek(): TMachineInstance<TArgs, TData>` → check `instanceof MachineSuccess` → extract `{ status: "success", args: TArgs, data: TData, updatedAt: number }`
3. Only `MachineSuccess<TArgs, TData>` entries included (per v0.1 docs)

**Hydrate flow (per-resource consumption via `initialSnapshot`):**
1. `createApi({ initialSnapshot: TApiSnapshot | null })` — validate version and keyPrefix (throw on mismatch), **save** snapshot internally as `_savedSnapshot`
2. Each `api.createResourceV2<TArgs, TData>(options)` call checks `_savedSnapshot` for a snapshot slice matching `options.key`:
   - For each entry in the slice: `Machine.fromSnapshot<TArgs, TData>(slice: TMachineState<TArgs, TData>): TMachineInstance<TArgs, TData>` → internal `resource.hydrateEntry(args: TArgs, machine: TMachineInstance<TArgs, TData>): void`
   - Check `maxSnapshotDataAge`: if `Date.now() - updatedAt > maxSnapshotDataAge`, call `entry.invalidate(): void`
   - **Consume and delete** the snapshot slice from `_savedSnapshot`
3. `api.resetAll(): void` — **deletes** `_savedSnapshot` entirely (`_savedSnapshot = null`)

**Standalone `hydrateSnapshot(api: IApi, snapshot: TApiSnapshot): void`** remains available for post-creation explicit hydration (e.g., when snapshot arrives asynchronously).

### Consequences
- **Positive**: Clean separation; snapshot is a plain JSON object; no cyclic reference risks; version-controlled format
- **Negative**: None significant
- **Risks**: Snapshot format changes require version bump. Current version = 1. Breaking changes in machine state shape handled by version check in `hydrateSnapshot`.

---

## ADR-9: Plugin Hook API — Synchronous, Sequential, Object.assign Composition

### Status
Proposed

### Context
The plugin system needs to support at minimum `ReactHooksPlugin` and be extensible for future plugins. [ref: ../01-research/01-codebase-query-v2.md#8-plugin-system]

External research shows varied approaches: SWR uses hook wrapping middleware (onion model), Apollo uses link chains (network pipeline), RTK uses tag-based declarations. [ref: ../01-research/03-external-research.md#4-plugin--middleware-architectures]

V2's existing design uses `install()` + `augmentResource()` with contributions merged via `Object.assign`. TypeScript declaration merging enables type-safe contributions. [ref: ../01-research/01-codebase-query-v2.md#82-type-level-augmentation]

### Options Considered

1. **Synchronous install + augmentResource, Object.assign merge, declaration merging for types** — Plugins called sequentially. Each returns an object of contributed methods. Merged onto resource instance. TypeScript `declare module` for type augmentation.
   - Pros: simple runtime; established pattern (current v2 legacy); RTK Query uses similar module augmentation; plugins can see each other's contributions (sequential merge)
   - Cons: key collisions possible (runtime check needed); no async plugin support; declaration merging is **ambient** — applies globally to all modules, hard to scope; can't restrict contributions to specific `createApi` instances; breaks with multiple API instances

2. **Synchronous install + augmentResource, Object.assign merge, generic conditional type augmentation** — Same runtime as Option 1, but type-level contributions use `PluginAugmentations<TPlugin, TArgs, TData>` conditional types instead of `declare module`.
   - Pros: explicit and composable — contributions are scoped to the `createApi` call's plugin list; no ambient type pollution; each plugin defines its contributions alongside its class; `IApi<TPlugins>` is generic over plugin types; type-safe without affecting other modules
   - Cons: conditional type branches must be added for new plugins; slightly more complex type definitions

3. **SWR-style hook wrapping** — Plugins wrap the hook itself.
   - Pros: very composable; can modify behavior
   - Cons: only works for React hooks; doesn't apply to non-React usage; complex composition

4. **Event-based plugin hooks** — ResourceV2 emits lifecycle events, plugins subscribe.
   - Pros: decoupled; async-friendly
   - Cons: no contribution mechanism; can't add methods; more complex

### Decision
**Option 2**: Synchronous plugin API with `install()` + `augmentResource()` + `Object.assign` merge + **`PluginAugmentations<TPlugin>` generic conditional type augmentation** for types. Add runtime validation: throw on duplicate contribution keys across plugins.

**Legacy anti-pattern resolved**: The legacy code uses `declare module` / declaration merging to populate `PluginContributionMap`. Declaration merging is ambient — it applies globally, is hard to scope to a specific API instance, and can cause unexpected type pollution across modules. The generic `PluginAugmentations<TPlugin, TArgs, TData>` pattern is explicit: contributions are defined alongside plugin classes as conditional type branches, and `IApi<TPlugins>` is generic over the plugin tuple, so type safety is scoped to each `createApi()` call.

**Type-level mechanism:**

```typescript
// Each plugin's contributions mapped via conditional type
type PluginResourceContributions<TPlugin, TArgs, TData> =
    TPlugin extends ReactHooksPlugin
        ? IReactHooksPluginContributions<TArgs, TData>
        : {};

// Intersect all plugins' contributions
type PluginAugmentations<TPlugins extends readonly IPlugin[], TArgs, TData> =
    Prettify<UnionToIntersection<PluginResourceContributions<TPlugins[number], TArgs, TData>>>;

// IApi is generic over plugins
interface IApi<TPlugins extends readonly IPlugin[]> {
    createResourceV2<TArgs, TData>(options): IResourceV2<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>;
}
```

**Plugin runtime lifecycle (unchanged):**
1. `createApi()` calls `plugin.install(context)` for each plugin (in order)
2. `createResourceV2()` calls `plugin.augmentResource(resource, options)` for each plugin (in order)
3. Contributions merged via `Object.assign(resource, ...contributions)`
4. Runtime check: if any key already exists on resource, throw `Error("Plugin key collision: ${key}")`

**Tradeoffs vs declaration merging:**
| Aspect | Declaration merging (`declare module`) | Generic augmentation (`PluginAugmentations<T>`) |
|---|---|---|
| Scope | Ambient/global — affects all modules | Explicit — scoped to `createApi()` call |
| Adding new plugin | Add `declare module` block anywhere | Add conditional type branch in `PluginResourceContributions` |
| Multiple API instances | All share same augmented types | Each `IApi<TPlugins>` has its own augmented types |
| Third-party plugins | Plugin author adds `declare module` in their package | Plugin author adds conditional type mapping (or extends the union) |
| Composability | Implicit — contributions merge at declaration site | Explicit — contributions intersect at `createApi<[P1, P2]>` |

### Consequences
- **Positive**: Explicit, composable type augmentation; no ambient type pollution; scoped to API instance; future plugins follow the same pattern; runtime behavior unchanged
- **Negative**: Plugins can't intercept resource internals (only add methods); no async plugins; conditional type branches must be extended for new plugins
- **Risks**: Plugin ordering matters if plugins depend on each other's contributions. Mitigable: document that plugins are applied left-to-right and later plugins can see earlier contributions. Third-party plugins require adding a conditional type branch — mitigable via documentation and a type utility for plugin authors.

---

## ADR-10: Agent start() Behavior — Query on First Call, Observe on Subsequent

### Status
Proposed

### Context
Should `Agent.start(args)` trigger a fetch or only observe? Current v2 only calls `resource.entry(args)` (no fetch). V1's Agent calls `resource.initiate(args)` which triggers a fetch. Tests expect data after `agent.start(args)`. [ref: ../01-research/04-open-questions.md#q17-should-resourcev2agentstart-initiate-a-query-or-only-track]

React hooks (`useResourceV2Agent`) pass args to the agent — if the agent doesn't trigger fetches, hooks become useless without separate imperative fetch calls.

TanStack Query and SWR both trigger fetches on mount, reuse cache on subsequent renders. [ref: ../01-research/03-external-research.md#22-stale-while-revalidate-pattern]

### Options Considered

1. **`start()` triggers query (like v1)** — Always calls `resource.query(args)` which handles dedup.
   - Pros: complete lifecycle; hook users just pass args; matches v1
   - Cons: agent has fetch responsibility

2. **`start()` only observes** — Agent watches, external code fetches.
   - Pros: pure observer
   - Cons: terrible DX; hooks require separate fetch call

3. **`start()` triggers query on first call per args, observes after** — If cache exists and is fresh, observe. If not, trigger fetch.
   - Pros: SWR-friendly; dedup via entry-level inflight tracking; matches TanStack/SWR semantics
   - Cons: complexity of "should I fetch?" logic

### Decision
**Option 3**: `Agent.start(args)` obtains an entry via the `_getEntry` factory callback (see [ADR-18](04-decisions.md#adr-18-agent-independence-from-resource)) and calls `entry.query()` which internally checks: if data is already cached and fresh (success state), no fetch occurs (dedup). If entry is in idle or error state, a fetch is triggered. This matches SWR libraries and provides the best DX. The deduplication and query execution logic lives in `ResourceV2CacheEntry.query()` (see [ADR-17](04-decisions.md#adr-17-abort-and-inflight-management-at-cacheentry-level)).

**Legacy anti-pattern resolved**: The legacy `ResourceV2Agent.start()` only calls `resource.entry(args)` — it never triggers a fetch. Consumers using the agent (including React hooks) would never see data without a separate imperative `resource.query()` call, making the agent useless for its primary purpose.

### Consequences
- **Positive**: Complete lifecycle from hook; SWR-compatible; dedup handled by entry
- **Negative**: Agent depends on entry.query() which has side effects
- **Risks**: None — entry.query() has dedup and abort management (ADR-17)

---

## ADR-11: getEntry$ Reactive Reset via ResourceV2 Status Signals

### Status
Proposed

### Context
V0.1 docs describe `_status$` and `_lastEntry$` signals on ResourceV2 to make `getEntry$` react to `api.resetAll()`. Without these, `getEntry$` returns stale entries after a full cache reset. [ref: docs/query-v2/v0.1/Внутриянка.md] [ref: ../01-research/04-open-questions.md#q8-should-entry-react-to-resetall-via-resource-level-status-signals]

### Options Considered

1. **Implement `_status$` and `_lastEntry$`** as described in docs — `_status$: SignalFn<"idle" | "ready">`, `_lastEntry$: SignalFn<ResourceV2CacheEntry<TArgs, TData> | null>`. `getEntry$` uses `Signal.compute` reading both. `resetAll()` sets `_status$("idle")`, causing all `getEntry$` computeds to return null.
   - Pros: correct reactive behavior; exactly matches v0.1 docs; `getEntry$` reacts to reset
   - Cons: two additional signals per resource

2. **No status signals; reset via CacheEntry.complete()** — Each entry self-invalidates.
   - Pros: simpler
   - Cons: `getEntry$` still returns a reference to the completed entry; consumer must check validity

3. **Single event signal** — `_resetEvent$` that fires on reset.
   - Pros: lighter than two signals
   - Cons: doesn't provide the `binded` pattern described in docs

### Decision
**Option 1**: Implement `_status$` and `_lastEntry$` as specified in v0.1 docs. These are lightweight signals (one enum value, one nullable reference) with negligible performance impact.

**Legacy anti-pattern resolved**: The legacy code has `entry$()` but without `_status$`/`_lastEntry$` signals. As a result, `entry$()` does NOT react to `resetAll()` — it returns stale references to completed entries, causing silent bugs when users call `api.resetAll()` and expect components to re-render with fresh state.

### Consequences
- **Positive**: `getEntry$` correctly returns null after `resetAll()`; matches documented design exactly; enables the `binded` pattern for lazy entry binding
- **Negative**: Two extra signals per ResourceV2 instance — negligible overhead
- **Risks**: None — this is a direct implementation of the v0.1 specification

---

## ADR-12: Snapshot Hydration — No Structural Sharing

### Status
Proposed

### Context
When hydrating snapshot data into newly created resources, should structurally identical data be shared (structural sharing) or should fresh machine instances always be created? [ref: ../01-research/04-open-questions.md#q12-should-the-snapshot-system-use-structural-sharing-when-hydrating]

TanStack Query uses structural sharing on refetch. However, snapshot hydration is a fundamentally different, one-time-per-resource operation. [ref: ../01-research/03-external-research.md#32-tanstack-query--structural-sharing]

Snapshot lifecycle — the three phases are critical to understanding this ADR:
1. `createApi({ initialSnapshot })` — the snapshot is **saved** internally as `_savedSnapshot`. At this point, **no resources exist yet** — the API instance has just been created and its `_resources` set is empty.
2. `api.createResourceV2(options)` — a new `ResourceV2` is created with an **empty** `CacheMap`. The API checks `_savedSnapshot` for a slice matching `options.key`. If a matching slice exists, its entries are hydrated into the resource's empty cache via `Machine.fromSnapshot()`, and the slice is **consumed (deleted)** from `_savedSnapshot`. If any hydrated entry's data is stale (`Date.now() - updatedAt > maxSnapshotDataAge`), auto-invalidation is triggered for that entry.
3. `api.resetAll()` — the saved snapshot is **deleted entirely** (`_savedSnapshot = null`).

Because hydration occurs inside `createResourceV2()`, and the resource was just created at that moment, its `CacheMap` is always empty — there are no pre-existing entries. The question is solely whether the newly created machine instances from snapshot data should use structural sharing (reference-preserving deep merge) or be created as independent copies.

### Options Considered

1. **No structural sharing** — Each `createResourceV2()` call consumes its snapshot slice and creates fresh, independent machine instances via `Machine.fromSnapshot()`. Each entry gets its own copy of the data.
   - Pros: simple; deterministic; no reference entanglement between snapshot source data and live cache data; one-time operation per resource

2. **Deep-equal check** — Compare snapshot data against fetched data before hydrating.
   - Pros: avoids unnecessary re-renders if data hasn't changed
   - Cons: deep comparison on large datasets is expensive; no pre-existing data to compare against at resource creation time (cache is empty)

3. **Structural sharing** — Reuse reference-identical subtrees when constructing machine instances from snapshot data.
   - Pros: minimal re-renders in theory
   - Cons: complex implementation for a one-time operation; no existing data in the empty cache to share references with

### Decision
**Option 1**: No structural sharing at hydration time. Each `createResourceV2()` creates a fresh resource with an empty `CacheMap`, then populates it from the saved snapshot slice using `Machine.fromSnapshot()` to produce independent machine instances. This is a one-time operation per resource — each resource gets its snapshot slice exactly once when it is created. The small cost of one re-render per newly hydrated entry is acceptable.

### Consequences
- **Positive**: Simple, predictable behavior; snapshot data is an independent copy (no reference entanglement); clean per-resource consumption model
- **Risks**: Initial hydration may cause one extra re-render per entry (acceptable for a one-time per-resource operation)

---

## ADR-13: compare CacheMap Strategy — No Snapshot Support

### Status
Proposed

### Context
The `compare` cache strategy uses function-based key comparison instead of serialization. This means keys can't be converted to strings for snapshot serialization. [ref: ../01-research/04-open-questions.md#q18-should-the-compare-cachemap-strategy-support-snapshots] [ref: docs/query-v2/v0.1/ssr.md]

### Options Considered

1. **Keep limitation** — Throw if `getSnapshot()` is called with `compare` strategy.
   - Pros: honest; compare is a niche optimization for in-memory-only scenarios
   - Cons: blocks SSR for compare-strategy resources

2. **Custom snapshot serializer** — Per-resource serializer for snapshot.
   - Pros: flexible
   - Cons: additional API surface; each resource needs custom code

### Decision
**Option 1**: Throw on snapshot with `compare` strategy. This is a documented limitation per v0.1 SSR docs. `compare` strategy is for specialized in-memory-only scenarios (non-serializable args like class instances or WeakRef targets).

**Internal implementation for compare strategy**: `CompareCacheMap<TArgs, TEntry>` uses `Array<{ args: TArgs, entry: TEntry }>` as backing store. Args cannot be serialized to strings, so lookups are O(n) linear scans using the `compareArg` function. This is the fundamental reason `compare` cannot support snapshots — there are no string keys to serialize into `TApiSnapshot`. See [ADR-19](04-decisions.md#adr-19-cachemap-dual-implementation-with-factory-pattern) for the dual implementation design.

### Consequences
- **Positive**: No false promises; clear error on misuse
- **Negative**: Users choosing `compare` lose SSR — they should use `serialize` with custom `serializeArgs` instead
- **Risks**: None — documented limitation, default strategy is `serialize`

---

## ADR-14: CacheEntry.complete() — Full Cleanup

### Status
Proposed

### Context
When a cache entry is evicted (GC or resetAll), how much cleanup should `complete()` perform? Tests expect abort patches + reset to idle. Current implementation only fires `onClean$`. [ref: ../01-research/04-open-questions.md#q5-how-should-cacheentrycomplete-behave]

### Options Considered

1. **Full cleanup** — Abort all pending patches → reset machine to idle → fire `onClean$` → mark completed. All subsequent `set()` calls become no-ops.
   - Pros: deterministic; no dangling patch state; safe for GC; aligns with test expectations
   - Cons: if entry is re-used after GC cancellation, it loses state — but GC cancellation should prevent `complete()` from firing

2. **Fire-and-forget** — Only `onClean$` + mark completed.
   - Pros: simple
   - Cons: dangling patches may leak; inconsistent with tests

### Decision
**Option 1**: Full cleanup. `complete()` is a terminal operation — once called, the CacheEntry is decommissioned permanently. This matches test expectations and ensures clean GC semantics.

**Legacy anti-pattern resolved**: The legacy `CacheEntry.complete()` only fires `onClean$` and sets `_isCompleted = true`. It does NOT abort pending patches or reset the machine to idle — leaving dangling patch state and an inconsistent machine after eviction. Tests expect full cleanup but the legacy implementation doesn't deliver it.

### Consequences
- **Positive**: No dangling state; deterministic cleanup; safe GC
- **Negative**: None — `complete()` is final; no re-use expected
- **Risks**: None

---

## ADR-15: V2 Naming Convention — Public API Suffix

### Status
Accepted

### Context
The `query-v2` module coexists with `query` (v1) as unstable exports from `@fozy-labs/rx-toolkit`. Consumers may import from both modules simultaneously during the migration period. V0.1 documentation uses names like `createApi`, `useResourceV2Agent`, `IResourceV2CacheEntry`, `IResourceV2AgentState` — some already carry a "V2" suffix, others rely on the `unstable_queryV2` namespace prefix for disambiguation. When exported as flat named exports, the namespace prefix is lost, and names like `createResource`, `useResource`, `IResource` collide directly with v1 exports.

### Options Considered

1. **V2 suffix on all public names** — `createResourceV2`, `useResourceV2Agent`, `IResourceV2`, etc. Internal types that are not exported may keep shorter names. **Exception**: the top-level API factory (`createApi`), its return type (`IApi`), and its options type (`ICreateApiOptions`) do NOT carry the V2 suffix — see below.
   - Pros: unambiguous in any import context; grep-friendly; no namespace discipline required from consumers; aligns with existing v0.1 doc convention for hooks/types
   - Cons: slightly longer names; suffix removed when v1 is deprecated

2. **Rely on import path** — `import { createResource } from "@fozy-labs/rx-toolkit/query-v2"`.
   - Pros: shorter names
   - Cons: ambiguous when re-exported; barrel imports mix v1/v2; TypeScript declaration merging conflicts; IDE auto-import may pick wrong version

3. **Namespace object** — `queryV2.createResource(...)`.
   - Pros: namespaced; matches v0.1 `unstable_queryV2.createApi()`
   - Cons: no tree-shaking; non-standard for named exports; breaks plugin declaration merging

### Decision
**Option 1**: All public API names carry a "V2" suffix. The v0.1 docs' `createApi` becomes `createApiV2` as a standalone export. All public interfaces, hooks, and factory functions follow the same convention. Internal types (e.g., `ICacheEntry`, `CacheMap`, `Resource` class) may keep shorter names since they are not exported.

**Exception — API factory and its types**: The top-level API factory is `createApi` (NOT `createApiV2`). Its return type is `IApi` and its options type is `ICreateApiOptions`. The factory name describes the action ("create an API") rather than the specific version of the entity. The V2 suffix applies to names that describe versioned entities (resources, hooks, cache entries) which coexist with their v1 counterparts. The API container itself is not a versioned entity — it is the entry point that creates v2 things.

> User clarification: «Нет. что за `createApiV2`, везде указывалось `createApi`. Все еще слобо... (так и всатавь)»

**Complete public naming:**

| Category | Name |
|----------|------|
| API factory | `createApi` |
| ResourceV2 factory | `createResourceV2` |
| React hooks | `useResourceV2Agent` (standalone and plugin-contributed) |
| Plugin hook | `useResourceV2Agent` |
| ResourceV2 types | `IResourceV2`, `IResourceV2Options`, `IResourceV2CacheEntry`, `IResourceV2Agent`, `IResourceV2AgentState` |
| API types | `IApi`, `ICreateApiOptions` |
| Snapshot types | `TResourceV2SnapshotSlice` |

### Consequences
- **Positive**: Zero ambiguity with v1 exports; safe for barrel re-exports; IDE auto-import always picks the correct version; grep/search instantly distinguishes v1 from v2 code
- **Negative**: Slightly longer names; when v1 is eventually deprecated, a rename pass removes the suffix
- **Risks**: None — suffix removal is a mechanical rename with codemods

---

## ADR-16: Single API Instance as Entry Point

### Status
Proposed

### Context
The query-v2 module provides factory functions (e.g., `createResourceV2`) that can be used standalone. However, advanced features — shared cache configuration, plugin registration, SSR snapshot capture/hydration, and `resetAll()` — require coordination across all resources. V0.1 documentation describes `createApi` as the primary entry point that composes the shared cache, plugin system, and snapshot infrastructure.

[ref: docs/query-v2/v0.1/README.md] — "Точка входа для создания API-инстанса. Все ресурсы создаются через API."
[ref: ../01-research/01-codebase-query-v2.md#10-api-factory-createapi] — API factory orchestrates resource tracking, plugin install, augmentation, hydration.

External libraries follow the same pattern: RTK Query has `createApi()`, Apollo has `ApolloClient()`, Relay has `Environment()`. All serve as a single entry-point factory that coordinates configuration, caching, and plugin/middleware systems.

[ref: ../01-research/03-external-research.md#1-comparative-analysis] — All major libraries use a single configuration entry point.

### Options Considered

1. **Single API instance factory (`createApi`)** — Users call `createApi(options)` to get an `IApi` instance with bound `createResourceV2`, `resetAll`, `getSnapshot` methods. Plugins are installed at API creation, configuration is shared, and all resources created through the instance are tracked in an internal `Set<ResourceV2>`.
   - Pros: unified configuration; plugin system has a natural install point; snapshot can iterate all registered resources; `resetAll()` knows about everything; matches v0.1 docs and industry standard
   - Cons: indirection (resource creation goes through API instance); requires passing API instance or using module-level singleton

2. **Standalone factories with shared global state** — `createResourceV2()` used directly, sharing global resource tracking.
   - Pros: simpler API surface; no API instance needed
   - Cons: global mutable state; no per-instance configuration; plugins can't install per-API; multiple API instances impossible (breaks SSR where server/client need different instances); conflicts with v0.1 docs

3. **Both: API instance for full features, standalone for simple cases** — `createApi()` for the full setup, `createResourceV2()` as standalone for quick prototyping without plugins/snapshot.
   - Pros: flexibility; gradual adoption
   - Cons: two creation paths to maintain; standalone resources miss plugin augmentation; potential confusion about which path to use

### Decision
**Option 3** with **Option 1 as the canonical, primary path**. `createApi()` is the recommended entry point for all production usage. Standalone `createResourceV2()` exists for simple cases or testing but does not participate in the plugin system, snapshot, or `resetAll()` coordination.

The canonical setup flow:
1. Call `createApi(options)` with configuration, plugins, and optional snapshot
2. Use `api.createResourceV2(options)` to create each resource (plugins augment automatically)
3. Resources share cache configuration and are tracked for `resetAll()`/`getSnapshot()`

### Consequences
- **Positive**: Single clear entry point; plugins, snapshots, and resetAll work seamlessly; matches v0.1 documentation and industry conventions; standalone factory still available for simple cases
- **Negative**: Users must create an API instance before resources — minor ceremony
- **Risks**: None significant — the standalone factories provide an escape hatch for simple cases

---

## ADR-17: Abort and Inflight Management at CacheEntry Level

### Status
Proposed

### Context
The initial design placed abort management at the `ResourceV2` level via `_inflightMap: Map<string, AbortController>`. This tracked all inflight requests globally across all cache entries for a resource. The abort was triggered by Resource when args changed or when a new request superseded an old one.

This design couples abort management tightly with the Resource orchestration layer, while `ResourceV2CacheEntry` — the entity that owns the data and machine state — has no control over its own inflight lifecycle. Since each entry represents a single args→data mapping with its own machine state, it is the natural owner of abort logic. [ref: ../01-research/01-codebase-query-v2.md#54-query-execution-private]

Furthermore, moving abort to the entry level is consistent with ADR-4 (CacheEntry as first-class entity) and the principle that RCE manages its own query lifecycle. [ref: docs/query-v2/v0.1/README.md]

### Options Considered

1. **Resource-level `_inflightMap`** — `ResourceV2` tracks all inflight requests in a `Map<string, AbortController>`. On new query, Resource checks the map, aborts if needed, then starts a new request.
   - Pros: centralized control; Resource sees all requests
   - Cons: RCE has no control over its own inflight; abort logic mixed into Resource orchestration; coupling between Resource and abort lifecycle

2. **Entry-level abort** — Each `ResourceV2CacheEntry` holds `_abortController: AbortController | null` and `_inflightPromise: Promise<TData> | null`. When `entry.query()` is called, the entry creates a new `AbortController`. If a previous request is inflight, it is aborted first. Resource has no inflight map.
   - Pros: RCE fully owns its lifecycle (data, state, abort); cleaner separation of concerns; consistent with ADR-4; each entry independently manages dedup — `query()` returns existing promise if already inflight; simpler Resource class
   - Cons: Resource can't centrally abort all entries — but this isn't a needed operation (resetAll uses `complete()`)

### Decision
**Option 2**: Each `ResourceV2CacheEntry` manages its own `AbortController` and inflight promise. `ResourceV2` has no `_inflightMap`.

**Entry-level query lifecycle:**
1. `entry.query()` checks `_inflightPromise` — if already inflight, returns existing promise (dedup)
2. `entry.query(doForce=true)` or `entry.invalidate()` aborts existing inflight via `_abortController.abort()`
3. Creates new `AbortController`, stores it as `_abortController`
4. Calls `_queryFn(args, { abortSignal })`, transitions machine state
5. On resolve/reject: updates machine state, clears `_inflightPromise`

**Agent args change behavior**: When an agent switches from args1 to args2, it obtains a new entry for args2 and calls `entry2.query()`. Entry1's inflight request continues independently — other agents/consumers may still need that data. No cross-entry abort occurs.

### Consequences
- **Positive**: Clean ownership — RCE owns data, state, and abort; no global inflight tracking; per-entry dedup is simpler; eliminates `_inflightMap` from Resource
- **Negative**: No ability to "abort all inflight" from Resource level — but `resetAll()` calls `entry.complete()` which handles cleanup (ADR-14)
- **Risks**: None — the entry already owns its machine state, adding abort ownership is a natural extension

---

## ADR-18: Agent Independence from Resource

### Status
Proposed

### Context
The initial design had `ResourceV2Agent` holding a direct reference to `ResourceV2` (`_resource: ResourceV2`). Agent called `_resource.query(args)` to trigger fetches and `_resource.compareArgs()` for equality checks. This creates a tight coupling: the Agent module imports from the Resource module, and Agent cannot be tested or reasoned about without Resource.

However, Agent's actual needs are narrow: (1) obtain a cache entry for given args, (2) compare args for equality. Both can be provided as callbacks at agent creation time, without the Agent knowing about Resource at all. This follows the Dependency Inversion Principle — Agent depends on abstractions (callbacks), not on the concrete Resource class. [ref: ../01-research/02-codebase-query-v1.md#22-resourceagent]

### Options Considered

1. **Agent holds `_resource: ResourceV2`** — Direct reference. Agent calls `_resource.query(args)` and `_resource.compareArgs()`.
   - Pros: simple; single reference provides all needed functionality
   - Cons: tight coupling; Agent module must import Resource; Agent can't be tested without Resource mock; circular dependency risk if Resource imports Agent types

2. **Agent receives factory callbacks** — `_getEntry: (args: TArgs) => ResourceV2CacheEntry<TArgs, TData>` and `_compareArgs: (a: TArgs, b: TArgs) => boolean` provided at construction time by `ResourceV2.createAgent()`.
   - Pros: Agent depends only on RCE, not on Resource; clean dependency direction; Agent independently testable; no circular dependency risk; follows DIP
   - Cons: slightly more parameters at construction time

### Decision
**Option 2**: Agent receives `_getEntry` and `_compareArgs` callbacks. Agent's interface and concrete class have no reference to `ResourceV2`.

**Construction in ResourceV2.createAgent():**
```typescript
// Inside ResourceV2.createAgent():
return new ResourceV2Agent<TArgs, TData>({
    getEntry: (args: TArgs): ResourceV2CacheEntry<TArgs, TData> => this._cache.getOrCreate(args),
    compareArgs: (a: TArgs, b: TArgs): boolean => this._compareArgs(a, b),
});
```

**Agent.start(args: TArgs) flow:**
1. `entry: ResourceV2CacheEntry<TArgs, TData> = _getEntry(args: TArgs)` — factory callback creates/retrieves entry from CacheMap
2. Update `_tracking$` (previous/current swap per ADR-3)
3. `entry.query(): Promise<TData>` — entry manages fetch, abort, and state transitions (per ADR-17)

**Dependency chain after this change:**
- `ResourceV2` creates `ResourceV2Agent` and passes callbacks → Agent type has no Resource reference
- `ResourceV2Agent` works exclusively with `ResourceV2CacheEntry` instances
- Module dependency: `Agent → RCE` (not `Agent → Resource → CacheMap → RCE`)

### Consequences
- **Positive**: Clean dependency inversion; Agent module doesn't import Resource; Agent independently testable with mock callbacks; no circular dependency risk; consistent with ADR-17 (entry-level lifecycle)
- **Negative**: Two callback parameters instead of one Resource reference — trivial overhead
- **Risks**: None — callbacks are a well-established pattern for dependency inversion

---

## ADR-19: CacheMap Dual Implementation with Factory Pattern

### Status
Proposed

### Context
CacheMap must support two key strategies: `serialize` (default) and `compare`. These strategies require fundamentally different internal data structures:

- **Serialize**: Args are converted to a deterministic string via `stableStringify` or custom `serializeArgs`. A `Map<string, TEntry>` provides O(1) lookups.
- **Compare**: Args are non-serializable (class instances, RegExp, etc.). A comparator function determines equality via linear scan over an `Array<{ args, entry }>`. `Map<string, TEntry>` is impossible because there are no string keys.

Additionally, CacheMap is generic (`ICacheMap<TArgs, TEntry>`) and must not depend on `CacheEntry` or `ResourceV2CacheEntry` — yet it needs to *create* entries when `getOrCreate(args)` is called for unknown args. A factory callback resolves this: ResourceV2 provides the factory at construction time, and CacheMap calls it without knowing what it creates.

The query-v2 module must also be fully independent from v1. Configuration (default `compareArg`, `serializeArgs`, `cacheLifetime`) is provided through `createApi` options and per-resource options — there is no dependency on `SharedOptions` or `DefaultOptions` from `src/common/options/`. Pure utility functions from `common/` (`shallowEqual`, `PromiseResolver`, `useConstant`) are acceptable dependencies because they are stateless.

[ref: ../01-research/01-codebase-query-v2.md#42-cachemap] — CacheMap serialize/compare strategies.
[ref: docs/query-v2/v0.1/README.md] — keyStrategy configuration.

### Options Considered

1. **Single `CacheMap` class with internal `if/else` branching** — One class that checks `keyStrategy` on every operation and uses either `Map<string, TEntry>` or `Array` internally.
   - Pros: single class; single file
   - Cons: `if/else` on every lookup; dead code in compare path (serialization) and serialize path (comparator); harder to test in isolation; violates Single Responsibility Principle

2. **`ICacheMap` interface + two concrete implementations (`SerializeCacheMap`, `CompareCacheMap`) + factory function (`createCacheMap`)** — Interface defines the contract. Each implementation has its own optimal backing store. A static factory selects the implementation at construction time. Both receive a `factory: (args: TArgs) => TEntry` callback for entry creation.
   - Pros: clean separation; each implementation is simple and optimal; no branching overhead; independently testable; factory pattern decouples CacheMap from entry types; follows Open/Closed Principle
   - Cons: two classes + one factory instead of one class; marginally more files

3. **Strategy pattern within a single class** — `CacheMap` class delegates to an internal `ICacheMapStrategy` object.
   - Pros: single CacheMap class visible externally
   - Cons: indirection overhead; strategy interface just duplicates the CacheMap interface; no real simplification

### Decision
**Option 2**: `ICacheMap<TArgs, TEntry>` interface with two implementations: `SerializeCacheMap` (backed by `Map<string, TEntry>`) and `CompareCacheMap` (backed by `Array<{ args: TArgs, entry: TEntry }>`). A `createCacheMap(options)` factory selects the implementation based on `keyStrategy`.

**Factory callback for entry creation**: Both implementations receive `factory: (args: TArgs) => TEntry` at construction time. When `getOrCreate(args)` finds no matching entry, it calls `this._factory(args)` to create one and stores it. CacheMap never imports or references `ResourceV2CacheEntry` — the factory is provided by `ResourceV2` and creates `ResourceV2CacheEntry` instances.

**v2 module independence**: All configuration defaults (compareArg, serializeArgs, cacheLifetime) flow through `createApi` options → per-resource options. No dependency on `SharedOptions` or `DefaultOptions`. The default `compareArg` is `shallowEqual` from `common/utils/` (a pure utility), not from a mutable global singleton.

**Implementation details**:

| Aspect | `SerializeCacheMap` | `CompareCacheMap` |
|--------|---------------------|-------------------|
| Backing store | `Map<string, TEntry>` | `Array<{ args: TArgs, entry: TEntry }>` |
| Key derivation | `stableStringify(args)` or custom `serializeArgs` | `compareArg(a, b)` linear scan |
| Lookup complexity | O(1) | O(n) |
| Snapshot support | Yes (string keys) | No (throws on `getSnapshot()`) |
| Use case | Default; serializable args | Non-serializable args (class instances, RegExp) |

### TEntry Constraint Decision

`TEntry` in `ICacheMap<TArgs, TEntry>` is **intentionally unconstrained** (no `extends` bound). Rationale:

- **CacheMap never calls methods on entries**: All operations (`get`, `getOrCreate`, `delete`, `has`, `clear`, `values`, `entries`) are pure storage/retrieval — no method invocation on `TEntry`.
- **GC cleanup is external**: When GC fires, `CacheEntry.complete()` is triggered by the `share()` operator's `finalize()` callback. `ResourceV2` subscribes to `onClean$` and calls `_cache.delete(args)`. CacheMap only removes the key — it does not call `complete()` or any cleanup method. [ref: 02-dataflow.md#17-gc-lifecycle]
- **Consistent with Issue #9**: User requirement — "CacheMap has no knowledge of CacheEntry". An unconstrained `TEntry` enforces this structurally: CacheMap *cannot* call CacheEntry methods because it has no type-level knowledge of them.
- **Options rejected**: `TEntry extends CacheEntry` would leak CacheEntry into CacheMap's type signature, violating Issue #9. `TEntry extends IDisposable` would add a constraint for a method CacheMap never calls — unnecessary coupling.

### Consequences
- **Positive**: Each implementation is simple and optimal; no branching overhead; CacheMap stays generic — no CacheEntry knowledge; `TEntry` unconstrained enforces separation structurally; factory pattern cleanly decouples creation from storage; v2 module is fully self-contained; `compare` limitation (no snapshots) is structurally enforced (no string keys to serialize)
- **Negative**: Two classes instead of one — minor file overhead
- **Risks**: None — the interface contract ensures both implementations are interchangeable; `ResourceV2` works with `ICacheMap` and never knows which concrete class is behind it; unconstrained `TEntry` means CacheMap cannot accidentally gain CacheEntry coupling in the future
