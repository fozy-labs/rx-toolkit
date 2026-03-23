---
title: "Open Questions: query-v2 Full Implementation"
date: 2026-03-23
stage: 01-research
role: rdpi-questioner
---

# Open Questions: query-v2 Full Implementation

---

## High Priority

### Q1: Should ResourceV2 carry `TError` as a generic parameter or remain `<TArgs, TData>`?

**Context**: The current ResourceV2 class declares `<TArgs, TData>` but uses `TError` in `_refreshErrorListeners` — a compile error. `IResourceV2Agent` and `createResource` signatures include `TError`, but `IResourceV2` does not. This inconsistency propagates through the entire type system (CacheEntry, snapshot, plugin augmentation). V1 similarly lacks `TError` on Resource, defaulting to `unknown`.

**Options**:
1. **Add `TError` to ResourceV2 and all core types** — Pros: full type safety for error handlers and agent `refreshError`; aligns with plugin augmentation signatures / Cons: increases generic arity everywhere (CacheEntry, CacheMap, Machine classes all need `TError`); more verbose API
2. **Keep `TError` only at the API/consumer level** (Agent, createResource, hooks) — Pros: core stays simpler; `TError` only matters at boundaries / Cons: requires `as unknown as` casts at core↔API boundary; agents can't type-narrow errors from core
3. **Default `TError = unknown` at every level** — Pros: accessible but unobtrusive / Cons: still adds visual noise to every generic signature

**Risks**: If decided wrong, refactoring generics across all core classes later is extremely invasive.

**Researcher recommendation**: Option 2 — matches v1 pattern and keeps core simple. `TError` is only useful at the consumer boundary where error handlers/UI live.

---

### Q2: How should the Agent SWR (stale-while-revalidate) previous/current swap work?

**Context**: The current implementation clears `previous` immediately after setting it (ResourceV2Agent.ts:115–121), which defeats SWR. The test `A2: SWR — previous data shown while loading new args` requires `previous` to persist until `current` resolves. V1's ResourceAgent keeps `previous$` alive and only swaps when the new cache entry reaches `isDone`. This is a core UX-affecting behavior.

**Options**:
1. **V1 pattern**: Keep `previous` until `current` reaches success/error — Pros: proven SWR behavior; matches user expectations / Cons: must handle edge cases (rapid arg changes, reset while SWR active)
2. **Signal-based derived approach**: Compute SWR data from `current` machine state — if pending, use last known `data` as `previousData` — Pros: simpler tracking (no separate previous entry); data remains accessible as long as machine holds it / Cons: loses `previousData` if machine resets to idle; different semantics from v1
3. **Timer/debounce approach**: Clear previous after a delay or after current settles — Pros: handles rapid changes gracefully / Cons: introduces timing sensitivity

**Risks**: Incorrect SWR causes visible data flickering — the most common user-facing complaint in data-fetching libraries.

**Researcher recommendation**: Option 1 — direct port of v1's proven pattern, adapted to v2's signal-based tracking.

---

### Q3: Should Command (mutation) support be included in the "full implementation" scope?

**Context**: TASK.md says "fully, without simplifications." V0.1 docs explicitly state: "На данный момент команды не реализованы в query v2." V1 has a full Command system with link-based invalidation, optimistic updates, lock mechanisms. The current v2 code has zero Command infrastructure. Command represents ~30% of v1's codebase.

**Options**:
1. **Include Command in v2** — Pros: complete feature parity with v1; needed for real-world use; link system is tightly coupled to Resource / Cons: substantially increases scope; no existing v2 design or docs for Commands
2. **Defer Command to a separate task** — Pros: reduces scope; Resource-only is useful standalone; can design Commands after Resource is stable / Cons: API design decisions now may constrain Command later; `createApi` already has plugin infrastructure that assumes both
3. **Include Command stubs/types, defer implementation** — Pros: reserves API surface; can validate type compatibility / Cons: half-implemented stubs create confusion

**Risks**: If Command is deferred, architectural decisions in Resource/API may not accommodate it well. If included, scope explodes.

**Researcher recommendation**: Defer to a separate task (Option 2), but design the plugin and API interfaces with Command extensibility in mind. Document Command requirements as constraints.

---

### Q4: What should the CacheEntry API surface look like — `state$` vs `machine$()` vs richer `IResourceV2CacheEntry`?

**Context**: Three conflicting visions exist: (a) current implementation uses `state$` getter on CacheEntry, (b) tests and Agent code reference `machine$()` method, (c) v0.1 docs describe `IResourceV2CacheEntry` with `isMyArgs()`, `createPatch()`, and other resource-specific methods. V1 has no CacheEntry abstraction — consumers interact via Agent/Ref only.

**Options**:
1. **Minimal CacheEntry** (`state$`/`machine$` only) + resource-level methods (getEntry returns raw entry) — Pros: simple; CacheEntry stays a dumb container / Cons: consumers need resource reference to do anything useful with an entry
2. **Rich CacheEntry as described in docs** (`IResourceV2CacheEntry` with `isMyArgs`, `createPatch`, etc.) — Pros: self-contained API; entries are useful standalone / Cons: CacheEntry must know about its parent resource and args; tight coupling; complicates GC
3. **Separate CacheEntry (internal) vs EntryHandle (external)** — Pros: clean separation of internal reactive state from consumer API / Cons: more types to maintain

**Risks**: Wrong abstraction boundary means either too-thin entries (requiring users to pass resource+args everywhere) or too-fat entries (coupling issues).

**Researcher recommendation**: Option 3 — Keep CacheEntry as internal reactive container, expose EntryHandle (or Ref) as the rich consumer-facing API. This matches v1's ResourceRef pattern.

---

### Q5: How should `CacheEntry.complete()` behave — fire-and-forget cleanup or full state reset?

**Context**: Tests expect `complete()` to abort all pending patches and reset machine to idle, but the implementation only fires `onClean$` and sets `_completed`. This is critical for GC correctness — when a cache entry expires, pending optimistic patches need deterministic cleanup.

**Options**:
1. **Full cleanup**: abort patches → reset to idle → fire `onClean$` → mark completed — Pros: deterministic; no dangling patch state; safe for GC / Cons: if entry is re-used after GC cancellation, it loses its state
2. **Fire-and-forget**: only `onClean$` + mark completed — Pros: simple; consistent with v1's cache cleanup behavior / Cons: dangling patches may leak; inconsistent with test expectations
3. **Two-phase**: `complete()` aborts patches but doesn't reset idle; separate `destroy()` does full teardown — Pros: allows "soft complete" for temporary disconnection / Cons: more lifecycle complexity

**Risks**: Incorrect cleanup leads to memory leaks or inconsistent UI state after GC.

**Researcher recommendation**: Option 1 — aligns with test expectations and ensures clean GC semantics. Entries that complete should be fully decommissioned.

---

### Q6: How should consistency violation detection work in the Patcher?

**Context**: V0.1 docs specify that when `applyPatches` from Immer throws during an abort, this is a "consistency violation" requiring auto-invalidation. The current Patcher has no try/catch around `applyPatches`. This affects data integrity for any multi-patch scenario.

**Options**:
1. **Patcher detects violation, returns error signal** — Resource reads the signal and auto-invalidates — Pros: clean separation; Patcher doesn't need resource reference / Cons: Patcher return types become more complex (data-or-error union)
2. **Patcher throws, ResourceV2 catches and invalidates** — Pros: simple error flow / Cons: exceptions as control flow is an anti-pattern; risk of uncaught exceptions
3. **Patcher returns `{ data, isConsistencyViolation }` tuple** — Pros: explicit; no exceptions; caller decides what to do / Cons: every Patcher call site must check the flag

**Risks**: Without detection, stale patched data remains indefinitely after a failed abort — silent data corruption visible to users.

**Researcher recommendation**: Option 3 — explicit return value. Resource checks the flag and calls `invalidate()`. This matches the documented behavior while keeping Patcher pure.

---

### Q7: What is the correct type for CacheEntry's inner signal — `TMachineInstance<TData>` or `TMachine<TData>`?

**Context**: The codebase uses immutable machine class instances (MachineIdle, MachinePending, etc.), but snapshots and serialization work with plain `TMachine<TData>` state objects (`{ status, data, error, ... }`). Currently `CacheEntry` wraps a `Signal.state<TState>` where `TState` varies between uses. ResourceV2 does ~30+ `as unknown as` casts because machine classes and plain state objects don't unify cleanly.

**Options**:
1. **CacheEntry stores machine instances** — Pros: methods available directly (`.start()`, `.invalidate()`); pattern matching on `instanceof`; immutability guaranteed / Cons: not serializable; snapshot must extract `.state`; harder to type generically
2. **CacheEntry stores plain state objects** — Pros: serializable; simpler types; no class hierarchy / Cons: lose method-based transitions; must use external factory for transitions; lose `instanceof` checks
3. **CacheEntry stores machine instances, expose `.state` for serialization** — Pros: best of both; clean internal API / Cons: still has the generic typing challenge for `TMachineInstance` union

**Risks**: Wrong choice causes pervasive type casting throughout the codebase, increasing bug surface.

**Researcher recommendation**: Option 1 (machine instances) — this is the existing design intent and provides the best DX for state transitions. Fix the type system to eliminate casts rather than downgrading to plain objects.

---

### Q8: Should `entry$()` / `getEntry$()` react to `resetAll()` via resource-level status signals?

**Context**: V0.1 internal docs describe `_status$` (idle/ready) and `_lastEntry$` signals that enable `getEntry$` to return `null` after `resetAll()` and reactively track entry availability. The current implementation has neither signal. Without them, `entry$()` can return stale entries after a full cache reset.

**Options**:
1. **Implement `_status$` and `_lastEntry$`** as described in docs — Pros: correct reactive behavior; `getEntry$` reacts to `resetAll()`; enables the `binded` pattern / Cons: adds two signals per resource; increases complexity
2. **Skip resource-level signals, reset via CacheEntry.complete()** — each entry self-invalidates on reset — Pros: simpler; no new signals / Cons: `entry$()` may still return a completed entry reference; consumer must check entry validity
3. **Implement `_status$` only, derive entry tracking differently** — Pros: single signal signals reset; can clear returned refs / Cons: partial implementation of the documented design

**Risks**: Without reactive reset awareness, components using `entry$()` will show stale data after `resetAll()` — a correctness bug.

**Researcher recommendation**: Option 1 — the internal docs describe this for good reason. Two small signals per resource is negligible overhead relative to correctness.

---

### Q9: How should the v2 type system handle the `void` args pattern for parameter-less resources?

**Context**: V0.1 docs require "Agent accepts `void` without explicit `undefined`". V1 handles this via a `FallbackOnNever` utility type in definitions. In v2, `TArgs` genericizes CacheEntry, CacheMap, Machine, Agent, and Resource. Making `void` args ergonomic requires careful conditional typing at every boundary that accepts `TArgs`.

**Options**:
1. **`TArgs extends void ? () => ... : (args: TArgs) => ...` conditional signatures** — Pros: clean for end users / Cons: explosion of conditional types; hard to maintain
2. **Default `TArgs = void`, use `TArgs | void` internally** — Pros: simple default / Cons: still requires explicit handling at API boundaries
3. **Overloads on createAgent/hooks** — Pros: best DX; signature per case / Cons: many overloads to maintain; doesn't generalize to CacheMap/CacheEntry

**Risks**: Bad ergonomics for the most common case (parameter-less queries) frustrates users.

**Researcher recommendation**: Option 3 at the API/hook level + Option 2 internally. Overloads where consumers interact, simpler types inside.

---

## Medium Priority

### Q10: What cache key serialization strategy should `stableStringify` support?

**Context**: Current `stableStringify` does sorted-key JSON.stringify but does NOT handle Date, Map, Set, RegExp. TanStack Query and RTK Query both use deterministic serialization with support for common JS types. Cache key collisions cause data corruption (wrong data for wrong args).

**Options**:
1. **Keep minimal stableStringify** (current) — Pros: simple; covers 90% of cases (plain objects, arrays, primitives) / Cons: silent key collision on Date/Map/Set args
2. **Extend to handle Date, Map, Set** — Pros: safer; matches user expectations / Cons: larger code; may conflict with custom `serializeArgs` overrides
3. **Provide pluggable serializer, keep default simple** — Pros: flexible; default stays simple / Cons: one more config option

**Risks**: Key collision is a silent corruption bug — extremely hard to debug in production.

**Researcher recommendation**: Option 2 — extend to handle common types. Silent corruption is worse than slightly more serialization code.

---

### Q11: What GC strategy should v2 use — timer-only, refcount-only, or hybrid?

**Context**: Current v2 uses timer-based GC (`cacheLifetime` + `setTimeout`). V1 uses timer-based via RxJS `share()` operator with resetOnRefCountZero. TanStack Query uses `gcTime` (timer after zero observers). RTK Query uses `keepUnusedDataFor` (timer after zero subscriptions). No library in the research uses pure refcount without a timer.

**Options**:
1. **Timer-only (current)** — `scheduleGc`/`cancelGc` per entry — Pros: simple; works well for server-rendered ephemeral data / Cons: doesn't account for active React subscriptions; may GC data while components still mounted
2. **Refcount + timer fallback** — like TanStack/RTK: GC timer starts only when refcount reaches 0 — Pros: correct behavior; data never GC'd while observed; aligns with industry / Cons: must track subscriptions accurately; Agent lifecycle ties into refcount
3. **Manual-only** — user calls `resource.release(args)` explicitly — Pros: predictable / Cons: leak-prone; terrible DX

**Risks**: Timer-only GC can delete data that an active component is reading, causing errors or refetch storms.

**Researcher recommendation**: Option 2 — hybrid refcount + timer. This is the industry standard and prevents the most common GC-related bugs.

---

### Q12: Should the snapshot system use structural sharing when hydrating?

**Context**: When snapshot data is hydrated, it creates new machine instances from plain state objects. If the application also has pre-existing cache data (e.g., from a client-side navigation), hydration could overwrite or duplicate entries. TanStack Query uses structural sharing on refetch to minimize re-renders.

**Options**:
1. **No structural sharing** — hydrate creates fresh instances; existing entries are not overwritten (current skip-if-exists behavior) — Pros: simple; deterministic / Cons: hydrated data always triggers re-renders even if identical
2. **Deep-equal check before hydrating** — skip hydration if existing data equals snapshot data — Pros: avoids unnecessary re-renders / Cons: deep comparison on potentially large datasets is expensive
3. **Structural sharing on hydration** — reuse reference-identical subtrees — Pros: minimal re-renders; good performance / Cons: complex implementation; only beneficial at hydration time (one-time)

**Risks**: Without any sharing, SSR hydration causes unnecessary full-tree re-renders on client.

**Researcher recommendation**: Option 1 — the current skip-if-exists is sufficient. Structural sharing at hydration is over-engineering for a one-time operation.

---

### Q13: What should the `refreshError` field on Agent state look like?

**Context**: Tests assert `agent.state$().refreshError` exists. V0.1 docs mention error access on agents. `IResourceV2AgentState` does not include `refreshError`. The `ResourceV2.onRefreshError()` listener exists but Agent doesn't subscribe. In v1, refresh errors are absorbed (stale data preserved, no error surfaced) — v2's ADR-2 does the same at machine level but the agent needs to communicate the error somehow.

**Options**:
1. **`refreshError: unknown | null`** on agent state — set when refresh fails, cleared on next successful fetch — Pros: simple; tests already expect this / Cons: agent state grows; must decide when to clear
2. **Event-based**: Agent emits a `refreshError` event/signal, not part of state — Pros: doesn't pollute snapshot state; error is transient by nature / Cons: requires separate subscription; less ergonomic in React
3. **Boolean `hasRefreshError` + separate error accessor** — Pros: state stays small; detail available on demand / Cons: two concepts to track

**Risks**: If refresh errors are silently swallowed, users have no way to show error toasts or retry UI for background refreshes.

**Researcher recommendation**: Option 1 — matches test expectations and provides the simplest React integration.

---

### Q14: How should the plugin `augmentResource` API compose with TypeScript declaration merging?

**Context**: The current plugin system uses `PluginContributionMap` with declaration merging to type-augmented resource methods. `Object.assign` merges contributions at runtime. This pattern is fragile — it relies on exact plugin names matching interface keys, and offers no compile-time guarantee that `augmentResource` returns the declared types.

**Options**:
1. **Keep current declaration merging** — Pros: works for known plugins; third-party plugins can augment / Cons: no runtime safety; name collisions between plugins possible; refactoring plugin names breaks types
2. **Generic plugin interface with inferred contributions** — `IPlugin<TContributions>` — Pros: type-safe at plugin definition; inferred at API level / Cons: harder to type `createApi` when plugins are heterogeneous
3. **Hybrid: declaration merging for external, generic for internal** — Pros: flexibility / Cons: two patterns to understand

**Risks**: Plugin type safety is important for a library's API ergonomics; broken types erode user trust.

**Researcher recommendation**: Option 1 with stricter runtime validation — the declaration merging pattern is established (RTK Query uses similar module augmentation). Add runtime checks that `augmentResource` return keys match expected contributions.

---

### Q15: Should v2 tests use the v1 "controllable promise" pattern or adopt a different async testing approach?

**Context**: V1 tests consistently use a controllable pattern: `queryFn` returns a promise with externally-accessible `resolve`/`reject`. This works well but is verbose. V2 tests already use this pattern but some tests have timing issues due to `flushMicrotasks()` usage. Modern testing libraries offer alternatives (fake timers, async-act wrappers).

**Options**:
1. **Keep controllable pattern** (direct port from v1) — Pros: proven; explicit; no hidden timing / Cons: verbose; many `calls[0].resolve()` boilerplate
2. **Add helper wrappers** — `createControllable()` + `expectState()` utilities — Pros: less boilerplate; reusable / Cons: another abstraction to learn
3. **vi.fakeTimers + deferred resolution** — Pros: can test timeout-based behavior (GC, SWR timing) / Cons: can interfere with signals/RxJS schedulers

**Risks**: Flaky async tests waste development time and erode confidence in the test suite.

**Researcher recommendation**: Option 2 — extend the v1 controllable pattern with thin helpers. Keep `flushMicrotasks()` for promise chains, use `vi.fakeTimers` only for timer-specific tests (GC lifetime).

---

### Q16: What should `query$()` return and how does it differ from `query()`?

**Context**: `query()` returns `Promise<ICacheEntry>` (imperative). `query$()` exists but is not in `IResourceV2` interface. V0.1 docs describe `getEntry$()` as reactive. The distinction between `query` (forces fetch), `query$` (reactive query?), `entry` (get cache entry), and `entry$` (reactive entry) is unclear — four methods with overlapping semantics.

**Options**:
1. **Drop `query$`** — keep `query()` (imperative) and `entry$()` (reactive) — Pros: clear separation; fewer concepts / Cons: no reactive "fetch if stale" operation
2. **`query$` = reactive entry + auto-initiate** — like `entry$(args, true)` — Pros: convenience / Cons: overlaps with `entry$(args, { doInitiate: true })`
3. **`query$` = signal that tracks query status** (pending/settled) reactively — Pros: unique capability / Cons: complex; unclear use case

**Risks**: Overlapping method semantics confuse users and bloat the API surface.

**Researcher recommendation**: Option 1 — simplify to `query()` + `entry$()`. If `entry$` with `doInitiate: true` covers the reactive-fetch case, `query$` is redundant.

---

### Q17: Should ResourceV2Agent.start() initiate a query or only track an entry?

**Context**: Current implementation only calls `resource.entry(typedArgs)` (no force fetch). V1's Agent calls `resource.initiate(args)` which triggers a fetch. Tests expect data to appear after `agent.start(args)` → implying a query should fire. If Agent only tracks, who triggers the fetch?

**Options**:
1. **Agent.start() triggers query (like v1)** — Pros: complete lifecycle; hook users just pass args and get data / Cons: Agent has more responsibility; harder to reason about when fetches happen
2. **Agent.start() only observes, external code triggers queries** — Pros: Agent is pure observer; explicit fetch control / Cons: terrible DX; every consumer must call `resource.query(args)` AND track via agent
3. **Agent.start() triggers query on first call per args, observes on subsequent** — Pros: SWR-friendly; dedup via existing inflight map / Cons: complexity of "first call" detection

**Risks**: If Agent doesn't trigger fetches, the React hook `useResourceV2Agent` becomes useless without separate imperative fetch calls.

**Researcher recommendation**: Option 3 — matches SWR semantics (fetch on mount, reuse cache on re-render). This is what TanStack Query and SWR do.

---

## Low Priority

### Q18: Should the `compare` CacheMap strategy support snapshots?

**Context**: `getSnapshot()` throws if `keyStrategy === "compare"` because compare keys aren't serializable. This is a documented limitation. However, if a user creates resources with compare strategy and later wants SSR, they're blocked.

**Options**:
1. **Keep the limitation** (throw on snapshot) — Pros: honest; compare strategy is niche / Cons: limits SSR adoption
2. **Allow custom snapshot serializer per resource** — Pros: flexible / Cons: additional API surface
3. **Auto-fallback to `toString()` or `JSON.stringify` for compare keys** — Pros: best-effort / Cons: may produce incorrect keys

**Risks**: Low — compare strategy is a specialized use case; most users will use serialize.

**Researcher recommendation**: Option 1 — document the limitation clearly. Compare strategy is for in-memory-only scenarios.

---

### Q19: Should DevTools integration be part of the core implementation or deferred?

**Context**: V1 has DevTools integration via `QueriesLifetimeHooks` (auto-adds DevTools listener). V2's `CacheEntry` has `beforeDevtoolsPush` option and `keyParts` for DevTools. The signals system has its own DevTools (Redux DevTools integration via `reduxDevtools()`). TASK.md doesn't explicitly mention DevTools.

**Options**:
1. **Include DevTools hooks** in core (like v1) — Pros: essential for debugging; v1 pattern exists / Cons: adds complexity; DevTools format for v2 machines may differ from v1
2. **Defer DevTools to a plugin** — `DevToolsPlugin` — Pros: clean core; optional dependency / Cons: harder to add after-the-fact if core hooks aren't designed for it
3. **Include hooks, defer UI/formatting** — Pros: hooks are cheap; formatting is the complex part / Cons: hooks without UI provide no value

**Risks**: If core hooks for DevTools aren't included, adding them later requires touching every state transition.

**Researcher recommendation**: Option 3 — include the hooks infrastructure (signal naming, `beforeDevtoolsPush` passthrough) but defer the actual DevTools plugin/formatting. This matches v1's approach.

---

## User Answers

### Q1: Should ResourceV2 carry `TError` as a generic parameter?
**Decision**: TError НЕ нужен.

### Q2: How should the Agent SWR previous/current swap work?
**Decision**: SWR сломан, т.к. реализация V2 не корректна. В задаче указано, что ценности в текущей V2 мало.

### Q3: Should Command (mutation) support be included in scope?
**Decision**: Держать в голове, но не делать.

### Q4: What should the CacheEntry API surface look like?
**Decision**: Документация наиболее актуальна, а реализация не корректная (см. задачу).

### Q5: How should CacheEntry.complete() behave?
**Decision**: Реализация V2 не корректна и ценности не представляет (указано в задаче).

### Q6: How should consistency violation detection work in the Patcher?
**Decision**: На этапе дизайна.

### Q7: What is the correct type for CacheEntry's inner signal?
**Decision**: Решать на этапе V2 (см. задачу).

### Q8: Should entry$() react to resetAll() via resource-level status signals?
**Decision**: Решать на следующих этапах (см. задачу).

### Q9: How should the v2 type system handle the void args pattern?
**Decision**: На этапе дизайна.

### Q10: What cache key serialization strategy should stableStringify support?
**Decision**: Opt 1 — минимальный (оставить как есть).

### Q11: What GC strategy should v2 use?
**Decision**: Решать на следующих этапах (см. задачу).

### Q12: Should the snapshot system use structural sharing when hydrating?
**Decision**: На этапе дизайна.

### Q13: What should the refreshError field on Agent state look like?
**Decision**: SKIP — все вопросы по реализации V2 (см. задачу).

### Q14: How should the plugin augmentResource API compose with TypeScript?
**Decision**: SKIP — все вопросы по реализации V2 (см. задачу).

### Q15: Should v2 tests use the v1 "controllable promise" pattern?
**Decision**: На этапе дизайна.

### Q16: What should query$() return?
**Decision**: SKIP — все вопросы по реализации V2 (см. задачу).

### Q17: Should ResourceV2Agent.start() initiate a query or only track?
**Decision**: На этапе дизайна.

### Q18: Should the compare CacheMap strategy support snapshots?
**Decision**: На этапе дизайна.

### Q19: Should DevTools integration be part of the core implementation?
**Decision**: DevTools включены в Signal.state, ничего более не требуется.

---

### Q20: Should `ResourceDuplicator` be included in v2?

**Context**: V1's `ResourceDuplicator` handles batch queries returning data for multiple args. It uses `ComputedReactiveCache` to aggregate state from multiple cache entries. V2 has no duplicator concept in docs or implementation. The pattern is useful but niche.

**Options**:
1. **Include in v2** — Pros: feature parity; batch queries are a real pattern / Cons: significant additional complexity; new cache type needed
2. **Defer to a separate task** — Pros: reduces scope / Cons: API design may not accommodate it later
3. **Design the hook point, implement later** — Pros: future-proof; minimal effort now / Cons: untested API surface

**Risks**: Low impact — Duplicator is optional for most applications.

**Researcher recommendation**: Option 2 — defer. The plugin system provides an extension point if needed later.

---

### Q21: How should `lockEntry` interact with GC?

**Context**: `ResourceV2.lockEntry(args)` exists to prevent GC eviction. V1 uses a counting semaphore (`lockCount`). V2's lock has no corresponding unlock or refcount. The interaction between manual locks, timer-based GC, and refcount-based GC (if adopted per Q11) needs specification.

**Options**:
1. **Counting semaphore** (like v1) — `lock()` returns `unlock` function — Pros: proven pattern; multiple lockers supported / Cons: leak if `unlock` is never called
2. **Boolean lock** — single lock/unlock — Pros: simpler / Cons: can't support multiple independent lockers
3. **`Disposable`-based** — `lock()` returns a `Disposable` auto-unlocking on scope exit — Pros: modern JS pattern; GC-safe / Cons: `using` declarations not yet widely adopted

**Risks**: Lock leaks prevent GC, causing memory bloat over long sessions.

**Researcher recommendation**: Option 1 — counting semaphore matches v1 and is the simplest reliable pattern.

---

### Q22: What documentation should v0.2 contain and how should it relate to v0.1?

**Context**: TASK.md states "New, more precise documentation should be placed in (query-v2/v0.2)." V0.1 docs contain a README, SSR guide, optimistic updates guide, and internal engineering notes. Some v0.1 content is outdated (references `getEntry` instead of actual method names, missing Command, etc.).

**Options**:
1. **v0.2 as a clean rewrite** — Pros: no legacy baggage; docs match implementation / Cons: effort; must reproduce all correct v0.1 content
2. **v0.2 as incremental update to v0.1** — copy + modify — Pros: faster; preserves correct content / Cons: may carry v0.1 errors
3. **v0.2 docs generated/extracted from implementation** — JSDoc + extraction — Pros: always in sync / Cons: narrative docs are better for learning; JSDoc adds noise to code

**Risks**: Low — docs are important but don't block implementation.

**Researcher recommendation**: Option 1 — clean rewrite once implementation is stable. V0.1 serves as a reference but shouldn't be the base.

---

### Q23: Should the `select` transform be supported in v2?

**Context**: V1 has a `select` option on Resource that transforms raw query data before caching. V2 docs don't mention `select`. However, `select` is useful for deriving subset views (e.g., extracting a specific field from API response). TanStack Query and RTK Query both support similar transforms.

**Options**:
1. **Include `select`** — Pros: powerful; reduces boilerplate for common transforms / Cons: complicates type system (distinction between `TResult` and `TData`); affects snapshot shape
2. **Defer, recommend computed signals** — Pros: signals system already provides derived state; no core complexity / Cons: less convenient; each consumer re-derives
3. **Include via plugin** — Pros: optional; doesn't bloat core / Cons: frequent enough pattern that plugin feels heavyweight

**Risks**: Without `select`, migration from v1 requires rewriting all transform logic.

**Researcher recommendation**: Option 2 for initial implementation — v2's signal foundation makes computed derivations natural. Reconsider if migration friction is high.

---

### Q24: How should the test suite handle the `Batcher.run()` synchronous batching in async test scenarios?

**Context**: Machine transitions and signal updates are batched via `Batcher.run()`. Tests must account for batching — some state changes are deferred until the batch completes. V1 tests handle this implicitly via `flushMicrotasks()`, but v2's more complex state machines may have multi-step transitions within a single batch.

**Options**:
1. **Explicit `Batcher.run()` in tests** — wrap assertions that depend on settled state — Pros: precise; documents batching semantics / Cons: verbose; easy to forget
2. **Auto-flush after every async operation in test helpers** — Pros: less boilerplate / Cons: hides timing bugs
3. **Test at the signal output level** (collect values, assert sequence) — Pros: tests what consumers see; agnostic to batching / Cons: harder to test intermediate states

**Risks**: Batching-unaware tests produce false positives (pass when behavior is incorrect) or intermittent failures.

**Researcher recommendation**: Option 3 for integration tests (test observable output sequences), Option 1 for unit tests (explicit batching control).

---

### Q25: Should SSR support `compare`-strategy resources or only `serialize`?

**Context**: Identical to Q18 but from the SSR perspective. The snapshot system currently throws on compare strategy. If SSR is a first-class feature, this limitation should be documented prominently or addressed.

**Risks**: Users who adopt compare strategy and later need SSR face a breaking change.

**Researcher recommendation**: Document clearly in v0.2. Serialize is the default and recommended strategy. Compare is opt-in for advanced in-memory-only use cases.

---

### Q26: Should `createApi` remain the primary entry point, or should standalone `createResource` also be supported?

**Context**: V1 exports standalone `createResource`, `createCommand` directly — no API wrapper needed. V2 routes everything through `createApi()`. This is a fundamental API design choice affecting adoption friction.

**Options**:
1. **`createApi` only** (current) — Pros: centralized config; plugins; snapshot/reset scope / Cons: boilerplate for simple cases; can't use a resource without an API instance
2. **Both `createApi` and standalone factories** — Pros: flexibility; simple cases stay simple / Cons: two paths to maintain; standalone resources can't participate in API-level features (snapshot, resetAll, plugins)
3. **`createApi` with a minimal default** — e.g., `const api = createApi()` with zero config — Pros: low friction; consistent path / Cons: still one more concept vs direct `createResource`

**Risks**: V1→v2 migration friction if users must introduce `createApi` wrappers.

**Researcher recommendation**: Option 3 — keep `createApi` as the sole entry point but make zero-config instantiation trivial.
