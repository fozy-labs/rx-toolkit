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

1. **4-layer strict hierarchy (`lib/ → core/ → api/ → react/`)** — Each layer depends only on layers below. Types in a separate `types/` directory (no runtime). Plugins alongside `api/`.
   - Pros: proven in v1; prevents circular deps; each layer independently testable; clear upgrade path for adding Command later
   - Cons: more directories; some boilerplate re-exports at barrel level

2. **Flat structure** — all modules at the same level, managed by import discipline.
   - Pros: simpler directory tree; fewer barrel files
   - Cons: no structural enforcement of dependency rules; easy to create cycles; v1 started flat and was refactored to layered

3. **Feature-based grouping** (`resource/`, `operation/`, `snapshot/`) — each feature folder contains its own lib/core/api/react.
   - Pros: high cohesion within features
   - Cons: cross-feature sharing (CacheEntry, machines, plugins) doesn't fit; duplicated infrastructure

### Decision
**Option 1**: 4-layer strict hierarchy. This matches v1's proven structure and provides clear testability boundaries.

### Consequences
- **Positive**: Each layer can be tested in isolation; dependency direction is enforceable via lint rules; adding Command in future means adding to core/ and api/ without touching lib/ or react/
- **Negative**: Barrel files (`index.ts`) needed at each layer; some re-exports may feel redundant
- **Risks**: Discipline needed to not shortcut layers (e.g., react/ importing from core/ directly) — mitigable with lint rule

---

## ADR-2: State Machine Implementation — Immutable Class-Based

### Status
Proposed

### Context
Resource cache entries transition through states: idle → pending → success/error → refreshing. Two approaches are possible: immutable class instances with methods (current v2 design) or plain state objects with external transition functions. [ref: ../01-research/01-codebase-query-v2.md#21-machine-state-model]

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

### Consequences
- **Positive**: Method-based transitions prevent invalid state changes at the type level; `MachineWithData` centralizes patch logic; `Machine.fromSnapshot()` handles deserialization
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

## ADR-4: CacheEntry Abstraction Boundary

### Status
Proposed

### Context
Three designs exist for the CacheEntry API surface: (a) minimal internal container, (b) rich consumer-facing object per v0.1 docs (`IResourceV2CacheEntry` with `isMyArgs`, `createPatch`), (c) separate internal + external types. [ref: ../01-research/04-open-questions.md#q4-what-should-the-cacheentry-api-surface-look-like]

V1 has no CacheEntry abstraction — consumers interact via Agent and ResourceRef. V0.1 docs describe `IResourceV2CacheEntry` with resource-specific methods. [ref: docs/query-v2/v0.1/README.md]

### Options Considered

1. **Minimal internal CacheEntry + rich IResourceV2CacheEntry wrapper** — `CacheEntry` is the internal generic reactive container (`ICacheEntry<TState>` with `state$`, `set`, `complete`, `onClean$`). `IResourceV2CacheEntry` is a consumer-facing wrapper that composes an internal `ICacheEntry<TMachineInstance<TData>>` and adds `isMyArgs`, `createPatch`. It delegates `machine$()` → `CacheEntry.state$()` and `peek()` → `CacheEntry.peek()`.
   - Pros: clean separation; internal CacheEntry stays simple and generic (no machine knowledge); consumer API is rich; matches v1's ResourceRef pattern
   - Cons: two types for similar concept; wrapper creation cost (negligible)

2. **Rich CacheEntry as described in v0.1 docs** — CacheEntry itself has `isMyArgs`, `createPatch`, etc.
   - Pros: single type; matches docs literally
   - Cons: CacheEntry must know about its parent Resource and args; tight coupling; CacheEntry can't be generic across Resource and Operation

3. **Minimal CacheEntry only, no consumer wrapper** — Consumers get raw CacheEntry.
   - Pros: simplest
   - Cons: consumers need Resource reference for all operations; poor DX; doesn't match v0.1 docs

### Decision
**Option 1**: Internal `ICacheEntry<TState>` (generic, minimal) + `IResourceV2CacheEntry` wrapper (resource-specific, consumer-facing). Resource instantiates `ICacheEntry<TMachineInstance<TData>>`. The wrapper is created by Resource when returning entries from `getEntry`/`getEntry$`. It composes the underlying CacheEntry via a private `_entry` field and closes over the resource reference and args.

### Consequences
- **Positive**: Internal CacheEntry can be reused by both Resource and Operation (generic `ICacheEntry<TState>` — no machine knowledge); consumer API matches v0.1 docs; Resource controls what operations are exposed
- **Negative**: Small wrapping overhead (closure + proxy object) — negligible
- **Risks**: Must ensure wrapper stays in sync with underlying CacheEntry lifecycle (if CacheEntry is completed, wrapper operations should no-op or throw)

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
**Option 2**: Refcount + timer hybrid. GC timer starts when refcount drops to 0, fires after `cacheLifetime` ms. If refcount goes above 0 during the timer, cancel it. Refcount is derived entirely from signal subscriptions (agents, hooks, manual `.obs` subscriptions).

**Implementation approach**: Use the CacheEntry's underlying `Signal.state` observable's subscription count. When the RxJS observable has zero subscribers, start the GC timer. When a new subscriber arrives, cancel the timer. This aligns with how v1's `ReactiveCache` uses `share()`.

### Consequences
- **Positive**: Solves the "GC while mounted" bug; matches all major libraries; purely subscriber-based — no manual lock/unlock API needed
- **Negative**: Slightly more complex than timer-only; must handle edge cases (subscribe/unsubscribe rapidly)
- **Risks**: If signal subscription count is not directly accessible, may need a lightweight wrapper. Mitigable: wrap CacheEntry's observable with refcount tracking via `share({ resetOnRefCountZero: false })` + manual counter.

---

## ADR-6: Patcher Safety — Consistency Violation Detection

### Status
Proposed

### Context
The Patcher uses Immer's `applyPatches` to apply/rollback patches. When patches are aborted out of order in a multi-patch scenario, `applyPatches` can throw because inverse patches reference paths/indices that no longer exist. V0.1 docs specify this as a "consistency violation" requiring auto-invalidation. [ref: docs/query-v2/v0.1/optimistic-updates.md] [ref: docs/query-v2/v0.1/Внутриянка.md]

Current implementation has no try/catch around `applyPatches`. [ref: ../01-research/01-codebase-query-v2.md#161-features-described-in-docs-but-not-implemented]

Without detection, stale patched data persists indefinitely — silent data corruption. [ref: ../01-research/README.md#key-findings]

### Options Considered

1. **Patcher returns error signal, Resource auto-invalidates** — `resolvePatches`/`finishPatch`/`abortAllPending` wrap `applyPatches` in try/catch. On catch, return `{ data: lastValidData, isConsistencyViolation: true }`. Resource checks the flag and calls `invalidate()`.
   - Pros: clean separation; Patcher stays pure (no resource reference); Resource decides what to do; matches v0.1 docs behavior
   - Cons: every call site must check the flag; slightly more complex return type

2. **Patcher throws, Resource catches** — Let Immer exception propagate. Resource wraps all patch operations in try/catch.
   - Pros: simpler Patcher
   - Cons: exceptions as control flow; risk of uncaught exceptions; multiple catch sites in Resource

3. **Patcher auto-invalidates** — Patcher takes a callback for invalidation.
   - Pros: single location handles violation
   - Cons: Patcher gains resource-level responsibility; breaks layer separation

### Decision
**Option 1**: Patcher returns `{ data, patches, baseData, isConsistencyViolation }` from all mutation operations. On violation, `data` contains the last valid patched data before the failure, `patches` is set to null (all patches dropped). Resource checks `isConsistencyViolation` and triggers `invalidate()`.

**Specific behavior per v0.1 docs:**
1. Consistency violation detected → Resource.invalidate(args)
2. During invalidation, cache shows last valid patched data (not corrupted data)
3. When fresh data arrives from refetch, it replaces everything

### Consequences
- **Positive**: Data integrity preserved; silent corruption prevented; matches documented behavior; clean separation of concerns
- **Negative**: Every Patcher call site in MachineWithData must check the flag — 3-4 call sites total
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
1. Iterate all resources via internal `resource.cacheEntries()` (internal method, not on public `IResourceV2`)
2. For each entry: `CacheEntry.peek()` → check `instanceof MachineSuccess` → extract `{ status, args, data, updatedAt }`
3. Only success entries included (per v0.1 docs)

**Hydrate flow:**
1. Validate version and keyPrefix (throw on mismatch)
2. For each entry: `Machine.fromSnapshot(slice)` → internal `resource.hydrateEntry(args, machine)`
3. Check `maxSnapshotDataAge`: if expired, call `resource.invalidate(args)`

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

1. **Current v2 pattern: synchronous install + augmentResource, Object.assign merge, declaration merging for types** — Plugins called sequentially. Each returns an object of contributed methods. Merged onto resource instance.
   - Pros: simple; established pattern (current v2); declaration merging works for TypeScript; RTK Query uses similar module augmentation; plugins can see each other's contributions (sequential merge)
   - Cons: key collisions possible (runtime check needed); no async plugin support; plugins can't intercept/wrap resource behavior

2. **SWR-style hook wrapping** — Plugins wrap the hook itself.
   - Pros: very composable; can modify behavior
   - Cons: only works for React hooks; doesn't apply to non-React usage; complex composition

3. **Event-based plugin hooks** — Resource emits lifecycle events, plugins subscribe.
   - Pros: decoupled; async-friendly
   - Cons: no contribution mechanism; can't add methods; more complex

### Decision
**Option 1**: Synchronous plugin API with `install()` + `augmentResource()`/`augmentOperation()` + `Object.assign` merge + declaration merging. Add runtime validation: throw on duplicate contribution keys across plugins.

**Plugin lifecycle:**
1. `createApi()` calls `plugin.install(context)` for each plugin (in order)
2. `createResourceV2()` calls `plugin.augmentResource(resource, options)` for each plugin (in order)
3. Contributions merged via `Object.assign(resource, ...contributions)`
4. Runtime check: if any key already exists on resource, throw `Error("Plugin key collision: ${key}")`

### Consequences
- **Positive**: Simple to implement and understand; TypeScript declaration merging provides type safety; future plugins follow the same pattern
- **Negative**: Plugins can't intercept resource internals (only add methods); no async plugins
- **Risks**: Plugin ordering matters if plugins depend on each other's contributions. Mitigable: document that plugins are applied left-to-right and later plugins can see earlier contributions.

---

## ADR-10: Agent start() Behavior — Query on First Call, Observe on Subsequent

### Status
Proposed

### Context
Should `Agent.start(args)` trigger a fetch or only observe? Current v2 only calls `resource.entry(args)` (no fetch). V1's Agent calls `resource.initiate(args)` which triggers a fetch. Tests expect data after `agent.start(args)`. [ref: ../01-research/04-open-questions.md#q17-should-resourcev2agentstart-initiate-a-query-or-only-track]

React hooks (`useResourceV2`) pass args to the agent — if the agent doesn't trigger fetches, hooks become useless without separate imperative fetch calls.

TanStack Query and SWR both trigger fetches on mount, reuse cache on subsequent renders. [ref: ../01-research/03-external-research.md#22-stale-while-revalidate-pattern]

### Options Considered

1. **`start()` triggers query (like v1)** — Always calls `resource.query(args)` which handles dedup.
   - Pros: complete lifecycle; hook users just pass args; matches v1
   - Cons: agent has fetch responsibility

2. **`start()` only observes** — Agent watches, external code fetches.
   - Pros: pure observer
   - Cons: terrible DX; hooks require separate fetch call

3. **`start()` triggers query on first call per args, observes after** — If cache exists and is fresh, observe. If not, trigger fetch.
   - Pros: SWR-friendly; dedup via inflight map; matches TanStack/SWR semantics
   - Cons: complexity of "should I fetch?" logic

### Decision
**Option 3**: `Agent.start(args)` calls `resource.query(args)` which internally checks: if data is already cached and fresh (success state), no fetch occurs (dedup). If entry doesn't exist or is in error state, a fetch is triggered. This matches SWR libraries and provides the best DX. The deduplication and caching logic lives in `Resource.query()`, not in the agent.

### Consequences
- **Positive**: Complete lifecycle from hook; SWR-compatible; dedup handled by Resource
- **Negative**: Agent depends on Resource.query() which has side effects
- **Risks**: None — Resource.query() already has dedup and inflight tracking

---

## ADR-11: getEntry$ Reactive Reset via Resource Status Signals

### Status
Proposed

### Context
V0.1 docs describe `_status$` and `_lastEntry$` signals on Resource to make `getEntry$` react to `api.resetAll()`. Without these, `getEntry$` returns stale entries after a full cache reset. [ref: docs/query-v2/v0.1/Внутриянка.md] [ref: ../01-research/04-open-questions.md#q8-should-entry-react-to-resetall-via-resource-level-status-signals]

### Options Considered

1. **Implement `_status$` and `_lastEntry$`** as described in docs — `_status$: SignalFn<"idle" | "ready">`, `_lastEntry$: SignalFn<CacheEntry | null>`. `getEntry$` uses `Signal.compute` reading both. `resetAll()` sets `_status$("idle")`, causing all `getEntry$` computeds to return null.
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

### Consequences
- **Positive**: `getEntry$` correctly returns null after `resetAll()`; matches documented design exactly; enables the `binded` pattern for lazy entry binding
- **Negative**: Two extra signals per Resource instance — negligible overhead
- **Risks**: None — this is a direct implementation of the v0.1 specification

---

## ADR-12: Snapshot Hydration — No Structural Sharing

### Status
Proposed

### Context
When snapshot data is hydrated, should structurally identical data be shared with pre-existing cache entries? [ref: ../01-research/04-open-questions.md#q12-should-the-snapshot-system-use-structural-sharing-when-hydrating]

TanStack Query uses structural sharing on refetch. However, hydration is a one-time operation. [ref: ../01-research/03-external-research.md#32-tanstack-query--structural-sharing]

### Options Considered

1. **No structural sharing** — Hydrate creates fresh instances. Existing entries are not overwritten (skip-if-exists).
   - Pros: simple; deterministic; skip-if-exists prevents data loss
   - Cons: hydrated data triggers re-renders even if identical

2. **Deep-equal check** — Skip hydration if existing data matches.
   - Pros: avoids unnecessary re-renders
   - Cons: deep comparison on large datasets is expensive

3. **Structural sharing** — Reuse reference-identical subtrees.
   - Pros: minimal re-renders
   - Cons: complex implementation for a one-time operation

### Decision
**Option 1**: No structural sharing at hydration time. Skip-if-exists is sufficient — if data is already in cache (from client-side navigation), hydration doesn't overwrite. Hydration is a one-time operation where the small cost of a re-render is acceptable.

### Consequences
- **Positive**: Simple, predictable behavior; no data loss from hydration overwrite
- **Negative**: Initial hydration may cause one extra re-render per entry — acceptable for a one-time operation
- **Risks**: None

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

### Consequences
- **Positive**: No false promises; clear error on misuse
- **Negative**: Users choosing `compare` lose SSR — they should use `serialize` with custom `serializeArgs` instead
- **Risks**: None — documented limitation, default strategy is `serialize`

---

## ADR-14: Operation Concurrent Execution — Latest-Wins

### Status
Proposed

### Context
Operations (mutations) don't have cache maps — they have a single state. When `execute()` is called while a previous execution is pending, the system needs a conflict resolution strategy.

V1's Command always re-initiates on `execute()`. [ref: ../01-research/02-codebase-query-v1.md#26-commandagent] No deduplication, no cancellation.

### Options Considered

1. **Latest-wins** — Each `execute()` overwrites the pending state. When a stale response arrives (from an earlier call), it's ignored because args/timestamp don't match the current execution.
   - Pros: simple; natural for mutations; user sees latest state
   - Cons: stale requests still consume network resources

2. **Abort previous** — Each `execute()` aborts the previous AbortController.
   - Pros: saves network resources
   - Cons: some operations shouldn't be aborted (POST side effects may have already occurred server-side)

3. **Queue** — Execute sequentially.
   - Pros: ordered execution
   - Cons: operations are user-triggered and should be responsive, not queued

### Decision
**Option 1**: Latest-wins. Each `execute()` creates a new execution context. When a previous execution resolves, check if it's still the current one — if not, ignore. Operations are not cancellable (no AbortController — per the difference from Resources).

### Consequences
- **Positive**: Simple mental model; latest state always visible; no risk of aborting side-effectful mutations
- **Negative**: Stale network requests not cancelled — acceptable for mutations which typically have side effects
- **Risks**: If user needs true cancellation, they should use Resource (which has AbortController) or manage cancellation in their queryFn

---

## ADR-15: CacheEntry.complete() — Full Cleanup

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

### Consequences
- **Positive**: No dangling state; deterministic cleanup; safe GC
- **Negative**: None — `complete()` is final; no re-use expected
- **Risks**: None

---

## ADR-16: V2 Naming Convention — Public API Suffix

### Status
Accepted

### Context
The `query-v2` module coexists with `query` (v1) as unstable exports from `@fozy-labs/rx-toolkit`. Consumers may import from both modules simultaneously during the migration period. V0.1 documentation uses names like `createApi`, `useResourceV2Agent`, `IResourceV2CacheEntry`, `IResourceV2AgentState` — some already carry a "V2" suffix, others rely on the `unstable_queryV2` namespace prefix for disambiguation. When exported as flat named exports, the namespace prefix is lost, and names like `createResource`, `useResource`, `IResource` collide directly with v1 exports.

### Options Considered

1. **V2 suffix on all public names** — `createResourceV2`, `useResourceV2`, `IResourceV2`, etc. Internal types that are not exported may keep shorter names. **Exception**: the top-level API factory (`createApi`), its return type (`IApi`), and its options type (`ICreateApiOptions`) do NOT carry the V2 suffix — see below.
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

**Exception — API factory and its types**: The top-level API factory is `createApi` (NOT `createApiV2`). Its return type is `IApi` and its options type is `ICreateApiOptions`. The factory name describes the action ("create an API") rather than the specific version of the entity. The V2 suffix applies to names that describe versioned entities (resources, operations, hooks, cache entries) which coexist with their v1 counterparts. The API container itself is not a versioned entity — it is the entry point that creates v2 things.

> User clarification: «Нет. что за `createApiV2`, везде указывалось `createApi`. Все еще слобо... (так и всатавь)»

**Complete public naming:**

| Category | Name |
|----------|------|
| API factory | `createApi` |
| Resource factory | `createResourceV2` |
| Operation factory | `createOperationV2` |
| Reset | `resetAllCacheV2` |
| React hooks | `useResourceV2`, `useOperationV2` |
| Plugin hook | `useResourceV2Agent` |
| Resource types | `IResourceV2`, `IResourceV2Options`, `IResourceV2CacheEntry`, `IResourceV2Agent`, `IResourceV2AgentState` |
| Operation types | `IOperationV2`, `IOperationV2Options`, `IOperationV2Agent`, `IOperationV2AgentState` |
| API types | `IApi`, `ICreateApiOptions` |
| Snapshot types | `TResourceV2SnapshotSlice` |

### Consequences
- **Positive**: Zero ambiguity with v1 exports; safe for barrel re-exports; IDE auto-import always picks the correct version; grep/search instantly distinguishes v1 from v2 code
- **Negative**: Slightly longer names; when v1 is eventually deprecated, a rename pass removes the suffix
- **Risks**: None — suffix removal is a mechanical rename with codemods

---

## ADR-17: Single API Instance as Entry Point

### Status
Proposed

### Context
The query-v2 module provides multiple factory functions (`createResourceV2`, `createOperationV2`) that can be used standalone. However, advanced features — shared cache configuration, plugin registration, SSR snapshot capture/hydration, and `resetAll()` — require coordination across all resources and operations. V0.1 documentation describes `createApi` as the primary entry point that composes the shared cache, plugin system, and snapshot infrastructure.

[ref: docs/query-v2/v0.1/README.md] — "Точка входа для создания API-инстанса. Все ресурсы создаются через API."
[ref: ../01-research/01-codebase-query-v2.md#10-api-factory-createapi] — API factory orchestrates registry, plugin install, augmentation, hydration.

External libraries follow the same pattern: RTK Query has `createApi()`, Apollo has `ApolloClient()`, Relay has `Environment()`. All serve as a single entry-point factory that coordinates configuration, caching, and plugin/middleware systems.

[ref: ../01-research/03-external-research.md#1-comparative-analysis] — All major libraries use a single configuration entry point.

### Options Considered

1. **Single API instance factory (`createApi`)** — Users call `createApi(options)` to get an `IApi` instance with bound `createResourceV2`, `createOperationV2`, `resetAll`, `getSnapshot` methods. Plugins are installed at API creation, configuration is shared, and all resources created through the instance are tracked in a registry.
   - Pros: unified configuration; plugin system has a natural install point; snapshot can iterate all registered resources; `resetAll()` knows about everything; matches v0.1 docs and industry standard
   - Cons: indirection (resource creation goes through API instance); requires passing API instance or using module-level singleton

2. **Standalone factories with shared global state** — `createResourceV2()` and `createOperationV2()` used directly, sharing a global cache registry.
   - Pros: simpler API surface; no API instance needed
   - Cons: global mutable state; no per-instance configuration; plugins can't install per-API; multiple API instances impossible (breaks SSR where server/client need different instances); conflicts with v0.1 docs

3. **Both: API instance for full features, standalone for simple cases** — `createApi()` for the full setup, `createResourceV2()` as standalone for quick prototyping without plugins/snapshot.
   - Pros: flexibility; gradual adoption
   - Cons: two creation paths to maintain; standalone resources miss plugin augmentation; potential confusion about which path to use

### Decision
**Option 3** with **Option 1 as the canonical, primary path**. `createApi()` is the recommended entry point for all production usage. Standalone `createResourceV2()`/`createOperationV2()` exist for simple cases or testing but do not participate in the plugin system, snapshot, or `resetAll()` coordination.

The canonical setup flow:
1. Call `createApi(options)` with configuration, plugins, and optional snapshot
2. Use `api.createResourceV2(options)` to create each resource (plugins augment automatically)
3. Use `api.createOperationV2(options)` to create each operation
4. Resources and operations share cache configuration and are tracked for `resetAll()`/`getSnapshot()`

### Consequences
- **Positive**: Single clear entry point; plugins, snapshots, and resetAll work seamlessly; matches v0.1 documentation and industry conventions; standalone factories still available for simple cases
- **Negative**: Users must create an API instance before resources — minor ceremony
- **Risks**: None significant — the standalone factories provide an escape hatch for simple cases
