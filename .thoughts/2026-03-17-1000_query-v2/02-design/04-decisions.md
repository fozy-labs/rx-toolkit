---
title: "Architecture Decision Records: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Architecture Decision Records: Query v2 Module

## ADR-1: Plugin Type System Approach

### Status
Proposed

### Context
The RFC requires `ReactHooksPlugin` to add `useResourceV2Agent` and `useResourceV2Ref` methods to resources created via an API that has the plugin installed. This means `createApi({ plugins: [new ReactHooksPlugin()] }).createResource(...)` must return a type that includes both the base `IResourceV2` methods and the plugin's contributed methods.

Three approaches were identified during research:
1. **Declaration merging** — global interface augmentation via `declare module`
2. **Generic type accumulation** — tRPC-style builder with `TPlugins` generic array
3. **Plugin interface with `augment()`** — each plugin returns its contributions, composed at `createResource` site

[ref: [03-external-research.md](../01-research/03-external-research.md)#4, [04-open-questions.md](../01-research/04-open-questions.md)#Q1]

The highest risk is TS2589 ("Type instantiation is excessively deep and possibly infinite") when deeply nested generics accumulate. External research confirms this occurs at >2-3 plugins with deep generic chains. [ref: [03-external-research.md](../01-research/03-external-research.md)#4.2 — tRPC TS2589 reports]

### Options Considered

**Option A: Declaration merging**
```ts
// resource.ts
interface IResourceV2<TArgs, TData, TError> { /* base methods */ }

// react-plugin.d.ts
declare module './resource' {
  interface IResourceV2<TArgs, TData, TError> {
    useResourceV2Agent(args: TArgs | SKIP_TOKEN): IResourceV2AgentState<TArgs, TData, TError>;
  }
}
```
- Pros: Simple, native TypeScript feature, zero runtime type overhead.
- Cons: **Global effect** — ALL resources get hook methods, even without ReactHooksPlugin. No way to scope augmentation to specific API instances. Fragile with generic interface merging across modules (may produce unexpected results). Contradicts the RFC's per-API plugin scoping.

**Option B: Generic type accumulation**
```ts
interface IApi<TPlugins extends IPlugin[] = []> {
  createResource<TArgs, TData, TError>(options: ...):
    IResourceV2<TArgs, TData, TError> & PluginAugmentations<TPlugins, TArgs, TData, TError>;
}

type PluginAugmentations<TPlugins, TArgs, TData, TError> =
  Prettify<UnionToIntersection<ExtractContributions<TPlugins[number], TArgs, TData, TError>>>;
```
- Pros: **Type-safe** — plugins only affect API instances where they're installed. `TPlugins` flows from `createApi` to `createResource` return type. Developer sees exact methods available via IntelliSense. Composable with multiple plugins.
- Cons: Complex type-level code (`UnionToIntersection`, conditional types). TS2589 risk at depth. Error messages harder to read.

**Option C: Plugin interface with `augment()` return type**
```ts
interface IPlugin {
  augmentResource<TArgs, TData, TError>(resource: IResourceV2<...>): Record<string, unknown>;
}
// Return type inferred from augmentResource implementation
```
- Pros: Flexible, each plugin is self-contained.
- Cons: Requires manual composition when multiple plugins contribute. TypeScript can't easily infer the union/intersection of multiple plugins' `augmentResource` return types without generic accumulation.

### Decision
**Option B: Generic type accumulation** — with TS2589 mitigations.

Rationale:
1. The RFC explicitly scopes plugins to API instances (`createApi({ plugins: [...] })`), making declaration merging (Option A) unsuitable — it can't scope contributions per-instance.
2. Option C ultimately needs the same generic accumulation mechanism as Option B to compose multiple plugins, but without the clean `TPlugins` type parameter flow.
3. TS2589 risk is mitigated by:
   - Keeping `PluginAugmentations` shallow (one level of `UnionToIntersection`, no recursion).
   - Each plugin's `ExtractContributions` type is a simple interface (not a deeply nested generic).
   - Using `Prettify<T>` to flatten intersections for IntelliSense.
   - The expected plugin count for rx-toolkit is 1-2 (ReactHooksPlugin, possibly future plugins), well within safe limits.

**Mental prototype with ReactHooksPlugin:**

```ts
// Plugin declares its contributions via a mapped type
interface ExtractPluginContributions<P extends IPlugin, TArgs, TData, TError> {
  // Narrowing: if P is ReactHooksPlugin → contributions
}

// Simplified: plugin type declares a Contributions type member
class ReactHooksPlugin implements IPlugin {
  // ... runtime methods ...
}

// Type-level extraction
type ExtractContributions<P, TA, TD, TE> =
  P extends ReactHooksPlugin
    ? IReactHooksPluginContributions<TA, TD, TE>
    : {};

// Usage resolves to:
const resource = api.createResource({ queryFn: fetchUser });
// typeof resource = IResourceV2<number, User, Error> & IReactHooksPluginContributions<number, User, Error>
// → resource.useResourceV2Agent(userId) ✓
// → resource.query(userId) ✓
```

This resolves in a single `UnionToIntersection` pass — no recursion, no excessive depth. Each plugin adds a flat interface. Tested mentally: `[ReactHooksPlugin, SomeOtherPlugin]` → `PluginAugmentations` = `Prettify<IReactHooksPluginContributions & IOtherContributions>` — one level deep, well within TS limits.

### Consequences
- Positive: Type-safe per-instance plugin scoping. Clean IntelliSense via `Prettify`. No global pollution.
- Positive: Adding a new plugin doesn't require module augmentation — just implement `IPlugin` and declare a contributions type.
- Negative: Requires a `ExtractContributions` conditional type per plugin. Adding a custom third-party plugin requires the consumer to also provide this type mapping.
- Risk: A plugin with deeply nested generics in its contributions type could still trigger TS2589. Mitigated by keeping contribution interfaces flat.

---

## ADR-2: MachineRefreshing Error Handling

### Status
Proposed

### Context
When `MachineRefreshing` is active (re-fetching data while holding stale data) and the fetch fails, the system must decide what happens to the stale data and the machine state.

In v1, `isReloading + isError` was an undefined combination — the flat boolean flags didn't prevent it, leading to ambiguous states. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#2.1 — ResourceQueryState.error sets isError=true regardless of isReloading]

TanStack Query preserves stale data on background refetch failure by default. [ref: [03-external-research.md](../01-research/03-external-research.md)#2.2 — TanStack cache lifecycle]

[ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q5]

### Options Considered

**Option A: Transition to `MachineError`, losing stale data**
```
MachineRefreshing(staleData) → error → MachineError(error) — data lost
```
- Pros: Clean state model — error state is unambiguous.
- Cons: **UX degradation** — user loses the data they were viewing due to a transient network error. Must re-fetch from scratch.

**Option B: Transition back to `MachineSuccess` with stale data preserved**
```
MachineRefreshing(staleData) → error → MachineSuccess(staleData)
 + error passed to lifecycle hooks (onQueryStarted → $queryFulfilled rejects)
 + Agent exposes refreshError field
```
- Pros: Data is preserved; user sees stale data + can be notified of error. Matches TanStack Query behavior. Lifecycle hooks still receive the error for logging/notification.
- Cons: Error is not on the Machine itself — requires Agent-level tracking for UI display. Slightly non-obvious: `MachineSuccess` is the state after an error.

**Option C: New `MachineStaleError` state**
```
MachineRefreshing(staleData) → error → MachineStaleError(staleData, error)
```
- Pros: Explicit about the dual condition.
- Cons: Adds a 6th machine state, increasing state machine complexity. Would need its own transitions. Not present in RFC (which lists exactly 5 states). `MachineStaleError` doesn't fit the `MachineWithData` hierarchy cleanly (is it patchable?).

### Decision
**Option B: Transition back to `MachineSuccess` preserving stale data.**

Rationale:
1. Preserving stale data on transient errors is the dominant pattern in modern data-fetching libraries (TanStack Query, SWR). [ref: [03-external-research.md](../01-research/03-external-research.md)#2.2]
2. The RFC specifies exactly 5 machine classes. Adding a 6th contradicts the RFC's design.
3. The error is not lost — it flows through `onQueryStarted` → `$queryFulfilled.catch()` and is available on the Agent's `refreshError` field for UI display.
4. Option B keeps the state machine simpler while providing all information needed for UI rendering.

Implementation detail: `MachineRefreshing.errorHappened(error)` returns a `MachineSuccess` with the original stale data, no patches (patches are preserved from before refresh), and the same `updatedAt` timestamp. The error info is not stored on the machine — it's a transient event handled by lifecycle hooks.

### Consequences
- Positive: Stale data preserved on transient errors — better UX.
- Positive: State machine stays at 5 classes — simpler model.
- Positive: Lifecycle hooks provide the error for logging/notification.
- Negative: Agent requires a `refreshError` field that's sourced from outside the Machine (from the lifecycle hook or a side-channel).
- Negative: `MachineSuccess` doesn't mean "last fetch succeeded" — it means "data is available". Consumers must check `refreshError` on the Agent for the full picture.

---

## ADR-3: Cache Key Strategy Implementation

### Status
Proposed

### Context
The RFC specifies two cache key strategies: `serialize` (string keys, O(1) lookup) and `compare` (structural comparison, O(n) lookup). No major library offers both — this is unique to rx-toolkit. [ref: [03-external-research.md](../01-research/03-external-research.md)#5.2]

The `serialize` strategy is required for SSR snapshots (keys must be serializable). The `compare` strategy matches v1's `IndirectMap` approach. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#3.2 — IndirectMap]

[ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q7]

### Options Considered

**Option A: Two separate cache implementations**
- `SerializedCacheMap extends Map<string, CacheEntry>` — wraps native `Map` with `serializeArgs` key transformation.
- `CompareCacheMap` — array-based with linear scan via `compareArg`.
- Pros: Optimized for each strategy.
- Cons: Duplicated logic for iteration, cleanup, etc.

**Option B: Abstract `ICacheMap` interface with two implementations**
- Interface: `{ get, set, delete, has, values, entries, clear, size }`
- `SerializedCacheMap` and `CompareCacheMap` implement the interface.
- `CacheMap.create(options)` factory selects implementation.
- Pros: Clean architecture, testable, extensible.
- Cons: One level of indirection.

**Option C: Single `CacheMap` class with internal strategy**
- One class, constructor receives strategy.
- Internally delegates to `Map<string, ...>` or array scan based on strategy.
- Pros: Single class to maintain. Strategy is an implementation detail.
- Cons: Conditional logic in every method.

### Decision
**Option B: Abstract `ICacheMap` interface with two implementations.**

Rationale:
1. The two strategies have fundamentally different data structures (`Map<string, ...>` vs. `Array<[Args, ...]>`). A shared interface with separate implementations is the natural OOP pattern.
2. The `ICacheMap` interface is small (7 methods) — minimal abstraction overhead.
3. Each implementation can be unit-tested independently.
4. v1's `IndirectMap` (analogous to `CompareCacheMap`) is 116 lines — small enough that the duplication concern is minimal.

Implementation notes:
- `SerializedCacheMap`: Uses `Map<string, CacheEntry>`. `serializeArgs` is called once per operation. With `doCacheArgs=true`, wraps a `WeakMap<object, string>` memoization layer. [ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q10]
- `CompareCacheMap`: Uses `Array<{ args: TArgs, entry: CacheEntry }>` with linear scan via `compareArg`. Includes `WeakMap<object, number>` index cache (like v1's `IndirectMap`). [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#3.2]
- SSR snapshots are only supported with `serialize` strategy. With `compare` strategy, `getSnapshot()` throws a descriptive error. [ref: RFC — `initialSnapshot` is `'serialize'` mode only]
- Performance guidance: `compare` is recommended for ≤50 entries or when args contain non-serializable types. `serialize` for all other cases. [ref: [03-external-research.md](../01-research/03-external-research.md)#Performance — breakeven ~50-100 entries]

### Consequences
- Positive: Clean separation. Each strategy optimized for its data structure.
- Positive: `CacheMap.create(options)` factory isolates the strategy choice from consumer code.
- Negative: Two classes to maintain and test (but both are small).
- Risk: `compare` strategy's O(n) lookup may surprise users with large caches. Documentation should recommend `serialize` as default.

---

## ADR-4: Patch Lifecycle Binding

### Status
Proposed

### Context
v1's patch system has a known "hanging patch" bug: if a pending patch transaction is never committed or aborted (e.g., due to an unhandled error in a Command), it blocks `originalData` cleanup indefinitely. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#2.3 — ResourceRef:42-131, [04-open-questions.md](../01-research/04-open-questions.md)#Q12]

v2 does not have Commands in MVP scope, but users can create patches via the `onQueryStarted` lifecycle hook, and the bug can still manifest if a consumer forgets to commit/abort.

### Options Considered

**Option A: Timeout-based auto-abort**
- If a patch remains `pending` for >N seconds, auto-abort.
- Pros: Self-healing.
- Cons: Arbitrary timeout. False positives for slow operations. Not deterministic.

**Option B: Bind to AbortController of the associated request**
- When the request's `AbortController` aborts, all patches created in `onQueryStarted` for that request are auto-aborted.
- Pros: Deterministic. Tied to the actual operation lifecycle.
- Cons: Patches created outside `onQueryStarted` (future commands) don't have an associated request.

**Option C: Machine transition cleanup**
- When Machine transitions to `MachineIdle` (reset), call `abortAllPendingPatches()`.
- When `successHappened()` resolves a refresh, abort orphaned pending patches.
- Pros: Tied to state machine lifecycle. No external coordination needed.
- Cons: Doesn't catch hanging patches while the machine stays in `MachineSuccess`.

**Option D: Combine B + C + CacheEntry cleanup**
- AbortController binding for request-associated patches.
- Machine transition cleanup for state changes.  
- CacheEntry eviction aborts all remaining patches.
- Pros: Defense in depth. Covers all cases.
- Cons: More complex implementation.

### Decision
**Option D: Combined approach — AbortController + machine transitions + CacheEntry cleanup.**

Rationale:
1. The "hanging patch" bug is explicitly called out in the RFC as a problem to fix. A robust multi-layer fix is warranted.
2. **Layer 1 — AbortController**: When `onQueryStarted` provides tools, the patch handles are associated with the request's abort signal. If the request is aborted (e.g., new query for same args), patches auto-abort. This is the primary fix for the common case.
3. **Layer 2 — Machine transitions**: `MachineWithData.abortAllPendingPatches()` is called when:
   - `MachineSuccess.start(newArgs)` → pending patches from old args are irrelevant.
   - `MachineRefreshing.successHappened(data)` → fresh data supersedes optimistic patches.
   - Any `reset()` transition.
4. **Layer 3 — CacheEntry eviction**: When a CacheEntry is cleaned up (cache lifetime expired), any remaining patches are aborted as part of cleanup.

Implementation detail: `Patcher.createPatch()` returns a handle with `commit()`, `abort()` methods. The `ResourceV2` orchestrator attaches an abort listener to the request's `AbortController`: `abortSignal.addEventListener('abort', () => handle.abort())`. This ensures deterministic cleanup.

### Consequences
- Positive: Eliminates the v1 "hanging patch" bug through defense-in-depth.
- Positive: Deterministic cleanup in the common case (AbortController).
- Positive: Safety net via machine transitions and cache eviction for edge cases.
- Negative: More complex than a single mechanism. Three abort paths must be consistent.
- Risk: Double-abort is possible (abort from both AbortController and machine transition). `abort()` must be idempotent (already the case in v1's transaction model).

---

## ADR-5: Agent Subscription Model

### Status
Proposed

### Context
`ResourceV2Agent` (the observer) needs to:
1. Subscribe to a specific CacheEntry's Machine signal.
2. Implement stale-while-revalidate (show previous data while new data loads).
3. Handle concurrent queries when args change rapidly (latest-wins).

v1's `ResourceAgent` uses `previous$`/`current$` tracking with `Signal.state` + `Signal.compute`. [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#2.2]

TanStack Query's `QueryObserver` uses a similar pattern — switching observed query when key changes. [ref: [03-external-research.md](../01-research/03-external-research.md)#2.5]

### Options Considered

**Option A: Latest-wins with previous/current tracking (v1 pattern)**
- Agent holds `Signal.state<{ previous: CacheEntry | null, current: CacheEntry }>`.
- `state$` is a `Signal.compute` that reads `current.machine$.get()` and optionally `previous.machine$.get()` for SWR.
- On `start(newArgs)`: swap current → previous, set new entry as current.
- Latest call always wins — no queueing.
- Pros: Proven in v1. Simple. Handles rapid arg changes naturally.
- Cons: Only tracks one level of history (previous, not a full queue).

**Option B: Queue-based with abort**
- Agent maintains a queue of pending requests.
- Only the latest request's result is applied; earlier ones are aborted.
- Pros: Explicit about concurrency.
- Cons: More complex than needed. AbortController already handles request cancellation.

### Decision
**Option A: Latest-wins with previous/current tracking.**

Rationale:
1. v1's pattern is proven and maps directly to the RFC's agent API (stale-while-revalidate). [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#2.2]
2. Queue-based approach (Option B) adds complexity without benefit — the resource already aborts the previous request's `AbortController` when a new query starts for the same CacheEntry.
3. One level of history (previous) is sufficient for SWR: while current is loading, show previous data.

Implementation detail:
- `_state$`: `Signal.state<{ previous: ICacheEntry | null, current: ICacheEntry | null }>`.
- `state$`: `Signal.compute(() => { ... })` — reads `current.machine$.get()` for reactive subscription. If current is pending and previous has data, merges stale data into state. Adds `isInitialLoading = isLoading && !hasPreviousData`.
- On `start(args)`:
  1. If `args === SKIP`: no-op.
  2. If args same as current: no-op (unless `force`).
  3. Otherwise: `resource.query(args)` → get new CacheEntry.
  4. Swap: `previous = current`, `current = newEntry`.
  5. When current resolves (success/error): `previous = null`.

### Consequences
- Positive: Simple, proven pattern. One `Signal.compute` gives reactive SWR behavior.
- Positive: Aligns with v1 — familiar pattern for existing users.
- Negative: Only one level of history. If user changes args 3 times rapidly, only the most recent "previous" data is available, not the one-before.
- Risk: Memory — previous CacheEntry is held until current resolves. Acceptable tradeoff.

---

## ADR-6: createApi Extensibility for Future Commands

### Status
Proposed

### Context
v2 MVP scope is resources-only (no commands/operations). However, `createApi` should accommodate future `createCommand` without breaking changes. [ref: [04-open-questions.md](../01-research/04-open-questions.md)#Q13]

The RFC says `createApi` is for "creating a group of resources (and in the future, operations)". If the API shape has to change to add commands, it's a breaking change.

### Options Considered

**Option A: Minimal `IApi` — add `createCommand` later as a new method**
- `IApi` has only `createResource`, `resetAll`, `getSnapshot`.
- When commands are added, `IApi` gains `createCommand`.
- Pros: Minimal surface now. Adding a method is backward-compatible.
- Cons: None significant — adding new methods to an interface consumers don't implement is non-breaking.

**Option B: Generic `createEndpoint` method**
- `IApi.createEndpoint(type: 'resource' | 'command', options)` — single entry point for all types.
- Pros: Extensible to any future type.
- Cons: Overengineered. Loses specific type safety. Harder to use.

**Option C: Reserved namespace in `IApi`**
- `IApi` includes `createCommand?: never` as a placeholder.
- Pros: Signals intent in types.
- Cons: Awkward. `never` methods in types is non-standard.

### Decision
**Option A: Minimal `IApi` — add `createCommand` as a new method when needed.**

Rationale:
1. Adding a new method to `IApi` is backward-compatible — existing code that only uses `createResource` continues to work. There's no TypeScript or runtime breaking change.
2. The only forward-compatibility concern is `resetAll()` — it must reset both resources AND future commands. This is handled by design: `resetAll()` iterates a generic internal registry of all entities, not a typed list.
3. `getSnapshot()` / `initialSnapshot` — commands don't produce snapshots (they're mutations, not data). No forward-compatibility issue.
4. Plugin system — `IPlugin.augmentResource` is resource-specific. Future commands will need `augmentCommand`. The `IPlugin` interface can be extended with an optional method: `augmentCommand?()`. This is non-breaking.

Implementation notes:
- Internal `IApi` state: a `Map<string, IResourceV2 | ICommandV2>` entity registry. `resetAll()` iterates and resets all entities.
- `createResource` keys are validated for uniqueness against all entities (not just resources), reserving the key namespace.

### Consequences
- Positive: Minimal API surface for MVP. No speculative abstractions.
- Positive: Adding `createCommand` later is backward-compatible.
- Negative: Plugin system will need extension for commands (new `augmentCommand` method).
- Risk: If commands need fundamentally different plugin integration, the `IPlugin` interface may need redesign. Mitigated by keeping `IPlugin` simple now and extending later.

---

## ADR-7: CacheEntry Implementation — Signal-based vs. BehaviorSubject-based

### Status
Proposed

### Context
v1's `ReactiveCache` uses a `BehaviorSubject` wrapped in `signalize()` to bridge into the signal graph. This works but adds a layer of indirection (RxJS BehaviorSubject → share/ReplaySubject → signalize → ReadonlySignal). [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#3.1]

v2 can use `Signal.state` directly as the reactive primitive, since the signal system already provides everything needed: synchronous read (`peek`/`get`), reactive subscription (`.obs`), batched updates (`Batcher`), and devtools integration. [ref: [02-codebase-signals-common.md](../01-research/02-codebase-signals-common.md)#1.1]

### Options Considered

**Option A: Signal.state directly**
- CacheEntry wraps `Signal.state<TMachine>`.
- Pros: Simpler. No BehaviorSubject/RxJS indirection. Native signal batching. Devtools integration built-in.
- Cons: Cache lifetime management (ref-counting, TTL) must be implemented separately — v1 used RxJS `share({ resetOnRefCountZero: timer(lifetime) })`.

**Option B: Keep BehaviorSubject + signalize (v1 pattern)**
- Pros: Proven. Cache lifetime via RxJS operators.
- Cons: More complex. Two reactive systems (RxJS + signals) for one purpose.

### Decision
**Option A: Signal.state directly.**

Rationale:
1. The signal system is the reactive foundation of v2. Adding an RxJS layer for a single feature (lifetime management) is unnecessary complexity.
2. Cache lifetime can be implemented with `setTimeout`/`clearTimeout` tracked by the `ResourceV2` class (or a dedicated `LifetimeManager`). When the last subscriber to a CacheEntry's signal drops (detectable via Effect unsubscribe count or explicit lock mechanism), start the timer. This is simpler than RxJS's `share` dance.
3. `Signal.state` provides `beforeDevtoolsPush` natively — Machine instances are projected to `.state` plain objects before pushing. [ref: [02-codebase-signals-common.md](../01-research/02-codebase-signals-common.md)#2.6]

### Consequences
- Positive: Simpler architecture. One reactive system.
- Positive: Better devtools integration (Signal devtools hooks are native).
- Negative: Must implement ref-counting / lifetime management manually (not complex, but net-new code).
- Risk: Edge cases in lifetime management (orphan entries, rapid subscribe/unsubscribe). Mitigated by comprehensive testing.

---

## ADR-8: Devtools Integration via Signal.state() beforeDevtoolsPush

### Status
Proposed

### Context
Redux DevTools expects JSON-serializable data. Machine class instances are not JSON-serializable. The existing signals infrastructure already provides a complete devtools integration path: `Signal.state()` accepts a `beforeDevtoolsPush` callback that intercepts values before they reach devtools. `Devtools.createSignalHooks()` handles the lifecycle (register on create, push on change, cleanup on dispose). [ref: [02-codebase-signals-common.md](../01-research/02-codebase-signals-common.md)#2.6, [04-open-questions.md](../01-research/04-open-questions.md)#Q11]

The question is whether query-v2 needs its own devtools module/component or can reuse Signal's built-in mechanism.

### Options Considered

**Option A: Separate devtools module for query-v2**
- A dedicated `DevtoolsProjection` component or `query-v2/devtools/` module that manages its own state registration with `Devtools.createState()`.
- Pros: Full control over devtools key format, batching, and state shape.
- Cons: Duplicates existing Signal devtools infrastructure. Adds a module to maintain. `Devtools.createState()` is already used internally by `Signal.state()` — calling it again creates redundant state entries.

**Option B: Reuse Signal.state()'s built-in beforeDevtoolsPush**
- `CacheEntry` holds a `Signal.state<TMachine>()`. When creating this signal, pass a `beforeDevtoolsPush` callback that projects the Machine instance to its `.state` plain object before pushing to devtools.
- Devtools key naming is controlled via Signal.state()'s `key` option (e.g., `'[keyPrefix]/[resourceKey]/[serializedArgs]'`).
- User-level customization is provided via `IResourceV2Options.beforeDevtoolsPush`, which is forwarded to the inner Signal.state() options.
- Pros: Zero additional infrastructure. Leverages the Signal lifecycle (auto-register, auto-dispose via FinalizationRegistry). Consistent with how all other signals appear in devtools. No new module to maintain.
- Cons: Devtools key format is constrained to Signal's `{key}#i={index}` pattern (acceptable — can embed resource/args info in the key string).

### Decision
**Option B: Reuse Signal.state()'s built-in `beforeDevtoolsPush`.** No separate devtools module is needed.

The `CacheEntry` creates its internal `Signal.state<TMachine>()` with:
- `key`: formatted as `'{keyPrefix}/{resourceKey}/{serializedArgs}'`
- `beforeDevtoolsPush`: a default callback that projects `machine` → `machine.state` (plain JSON-serializable object), composed with the user's `beforeDevtoolsPush` if provided in resource options.

This means machine state transitions are automatically reflected in Redux DevTools via Signal's existing devtools hooks — no custom registration, batching, or disposal logic is needed.

### Consequences
- Positive: Zero additional devtools code in query-v2. No `DevtoolsProjection` component or `query-v2/devtools/` folder.
- Positive: Consistent with the rest of rx-toolkit — all reactive state appears in devtools through the same Signal mechanism.
- Positive: User customization via `beforeDevtoolsPush` follows the established pattern (same API as `Signal.state()` options).
- Positive: Automatic cleanup via Signal's `FinalizationRegistry`-based disposal.
- Negative: Devtools key format depends on Signal's naming convention. Acceptable — the key string is fully controllable via the `key` option.

---

## ADR-9: Hook Naming — useResourceV2Agent / useResourceV2Ref Split

### Status
Proposed

### Context
The RFC defines a single `useResource(args)` hook that returns reactive query state in React components. However, v1 of rx-toolkit already established a convention of splitting resource hooks into two:
- `useResourceAgent(args)` — creates/manages an Agent (stale-while-revalidate observer with full lifecycle)
- `useResourceRef(args)` — provides an imperative ref handle for cache manipulation (invalidation, patching, existence checks)

These hooks serve different purposes: `useResourceAgent` is for data consumption (read-heavy), while `useResourceRef` is for cache manipulation (write-heavy). [ref: [01-codebase-query-v1.md](../01-research/01-codebase-query-v1.md)#4 — v1 React hooks pattern]

Additionally, v2 uses the `ResourceV2` naming convention to distinguish from v1 types.

### Options Considered

**Option A: Single `useResourceV2(args)` hook (matching RFC)**
- Returns a combined object with both data consumption and imperative manipulation methods.
- Pros: Matches RFC exactly. Single import for consumers.
- Cons: Breaks established v1 convention. Mixes two concerns (reactive observation and imperative manipulation) in one return value. Larger return object even when consumer only needs one concern.

**Option B: Split into `useResourceV2Agent(args)` and `useResourceV2Ref(args)` (matching v1 convention)**
- `useResourceV2Agent(args)`: Returns `IResourceV2AgentState` — reactive data, loading states, error info.
- `useResourceV2Ref(args)`: Returns `IResourceV2Ref` — imperative handle for invalidation, patching, lock.
- Pros: Consistent with v1's `useResourceAgent`/`useResourceRef`. Clear separation of concerns. Each hook has a focused API surface. Easier to tree-shake (consumers who only need data don't pull in imperative logic).
- Cons: Diverges from RFC's single-hook design. Two imports instead of one.

### Decision
**Option B: Split into `useResourceV2Agent(args)` and `useResourceV2Ref(args)`.**

Rationale:
1. v1 users are familiar with the `Agent`/`Ref` split. Maintaining the convention reduces migration friction.
2. The two hooks address fundamentally different use cases: data rendering (`Agent`) vs. cache manipulation (`Ref`). Combining them violates single-responsibility.
3. The `V2` suffix clearly distinguishes from v1 hooks (`useResourceAgent` → `useResourceV2Agent`), following the project's naming convention for the new module.
4. The RFC's `useResource` is a high-level design — the split is a natural refinement appropriate for the implementation stage.

### Consequences
- Positive: Consistent with v1 naming. Clear separation of concerns.
- Positive: `V2` suffix prevents import conflicts when v1 and v2 coexist.
- Negative: Diverges from RFC's single `useResource` hook — requires documentation explaining the split.
- Negative: Two hooks to learn instead of one (minor — each is simpler than a combined hook).
