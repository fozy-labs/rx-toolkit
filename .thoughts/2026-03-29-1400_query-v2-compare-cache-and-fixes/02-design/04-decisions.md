---
title: "Architecture Decisions: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

# Architecture Decisions

Seven ADRs formalize the design decisions implicit in prior design documents (01-architecture, 02-dataflow, 03-model). Each ADR traces to a research open question and cites user feedback.

---

## ADR-1: CompareCacheMap Data Structure — Array → Map

### Status
Proposed

### Context
`CompareCacheMap` uses `Array<{args, entry}>` with `Array.find(compareArg)` for every lookup — O(n) per access, O(n²) for deletion via `findIndex` + `splice` [ref: ../01-research/02-problem-analysis-cache.md#Problem #1]. With typical cache sizes of 10–100 entries in list/table UIs, each React render performs up to n comparisons per hook instance. The task mandates Map/WeakMap for instant access.

**Resolves**: Q1 — "What data structure should replace the Array in CompareCacheMap?" [ref: ../01-research/05-open-questions.md#Q1]

**User feedback**: "Давай сделаем проще (без кеширования сравнения) - просто Map"

### Options Considered

1. **`Map<TArgs, TEntry>` with reference identity** — Pros: O(1) lookup for reference-equal args (common in React with memoized args). Works with all key types including primitives (`void`, `string`, `number`). Simple mental model. / Cons: Structurally-equal but referentially-distinct args produce separate cache entries — semantic change from current `compareArg`-based deduplication.

2. **`WeakMap<object & TArgs, TEntry>` only** — Pros: O(1) lookup, automatic GC of unused entries. / Cons: Does not accept primitive keys — breaks `createResourceV2<void, TData>()` and `createResourceV2<string, TData>()`. Cannot iterate (`entries()`, `values()`, `size` are unavailable), violating the `ICacheMap` interface contract [ref: ../01-research/05-open-questions.md#Q1].

3. **Hybrid: Map as primary index + Array as comparison fallback** — Pros: O(1) for same-reference args; falls back to comparison scan for structurally-equal new references. / Cons: Two data structures to maintain; insertion/deletion must synchronize both; `delete` by comparison still requires Array scan. Higher complexity for marginal benefit.

4. **Map with comparison scan on miss** — Pros: Same-reference lookups O(1); new references trigger one comparison scan, then stored in Map. / Cons: Map grows unboundedly with every distinct reference (memory leak if args are not reused). Requires eviction or WeakRef strategy.

### Decision
**Option 1** — `Map<TArgs, TEntry>` with reference identity (`===`).

`compareArg` function is removed from `CompareCacheMap` internals. The Map provides O(1) `get`, `set`, `delete`, `has`, `clear`. Callers using compare strategy must ensure args reference stability for cache hits — this aligns with React patterns where args are typically memoized via `useMemo` or stable references [ref: 01-architecture.md#4.1].

`compareArg` remains on `ICacheMapOptions` for type compatibility (the options type is a union used by both strategies) and continues to be used by `ResourceV2CacheEntry.isMyArgs()` and `ResourceV2Agent` — unrelated to cache lookup [ref: 01-architecture.md#4.1].

### Consequences
- **Positive**: O(1) lookup/delete for all Map operations. Eliminates `_find()` helper and `Array.find`/`findIndex`/`splice` overhead. Simpler implementation (Map standard library vs. manual array search).
- **Positive**: Works with all key types including `void` and primitives — no `WeakMap` restriction.
- **Negative**: Semantic change — structurally-equal but referentially-distinct args produce separate entries. Users relying on `compareArg` deduplication (e.g., `{id: 1}` created in multiple places) must memoize args for cache hits.
- **Negative**: `Map` does not auto-evict entries (unlike `WeakMap`). Entries remain until explicitly deleted or `clear()` is called. The existing `cacheLifetime` mechanism handles eviction.
- **Risk**: If users pass non-memoized args objects, cache grows unboundedly. Mitigated by `cacheLifetime` auto-cleanup.

---

## ADR-2: No Caching Option for Compare Strategy

### Status
Proposed

### Context
`doCacheArgs: true` is silently ignored when `keyStrategy === "compare"`. The option exists on `TResourceV2Options` and is passed through to `createCacheMap`, but `CompareCacheMap` never reads it — providing no user feedback [ref: ../01-research/02-problem-analysis-cache.md#Problem #2]. In `SerializeCacheMap`, `doCacheArgs` creates a `WeakMap<object, string>` caching `args → serialized key` to avoid re-serialization on repeated lookups.

With the ADR-1 decision to use `Map<TArgs, TEntry>`, the compare strategy inherently provides O(1) reference-identity lookup. There is no serialization step to cache.

**Resolves**: Q2 — "What should the `doCacheArgs` equivalent for CompareCacheMap look like?" [ref: ../01-research/05-open-questions.md#Q2]

**User feedback**: "Давай сделаем прощe - без кеширования для стратегии сравнения."

### Options Considered

1. **Reuse `doCacheArgs` flag for compare strategy** — When `true`, enable a `WeakMap<object & TArgs, TEntry>` as secondary index. Pros: no new API surface. / Cons: `doCacheArgs` semantics differ between strategies (serialize: caches serialization result; compare: caches entry lookup). Misleading for users.

2. **Always-on reference cache (inherent in Map)** — The `Map<TArgs, TEntry>` from ADR-1 IS the reference cache. `doCacheArgs` is irrelevant. Pros: simplest mental model, no per-strategy option confusion. / Cons: none — Map lookup is always O(1) with no additional caching layer needed.

3. **New option name `doCacheByRef`** — Separate flag from `doCacheArgs`. Pros: explicit intent. / Cons: unnecessary — Map already provides reference-based O(1).

### Decision
**Option 2** — No caching option for compare strategy. `doCacheArgs` is not applicable when `keyStrategy === "compare"`.

`doCacheArgs` remains on `TResourceV2Options` and `ICacheMapOptions` as an optional field — it applies only to `SerializeCacheMap` (caches `args → serialized key` in WeakMap). `CompareCacheMap` ignores it. Since it was already silently ignored (the existing bug), this is a formalization of the status quo, not a behavior change [ref: ../01-research/02-problem-analysis-cache.md#Problem #2].

### Consequences
- **Positive**: No API surface change. No new options to learn.
- **Positive**: Eliminates the confusing silent ignore — `doCacheArgs` has clear semantics: "cache the serialization result" (applies only to serialize strategy).
- **Negative**: Type system does not prevent users from passing `doCacheArgs: true` with `compareArg`. This matches the current behavior (already silently ignored). A TypeScript discriminated union could enforce this at type level, but adds complexity disproportionate to the benefit.
- **Neutral**: `createCacheMap` factory continues to forward `doCacheArgs` to both strategies in the options object. `CompareCacheMap` constructor ignores it (same as today).

---

## ADR-3: Devtools Key Option for Compare Strategy

### Status
Proposed

### Context
The factory closure in `ResourceV2` constructor unconditionally calls `serializeFn(args)` for devtools key derivation, even when `keyStrategy === "compare"`. This creates a semantic mismatch: compare strategy is designed for non-serializable args, yet serialization is forced for devtools [ref: ../01-research/03-problem-analysis-devtools.md#Problem #3]. The task specifies: "add an option to specify a function for extracting the devtools key from arguments, default — indices."

**Resolves**: Q3 — "How should the devtools key be derived for the compare strategy?" [ref: ../01-research/05-open-questions.md#Q3]

**User feedback**: "Новая опция в `ResourceV2Options`, которая применяется только к стратегии сравнения, по умолчанию монотонный счетчик (0, 1, 2...)."

### Options Considered

1. **`devtoolsKey?: (args: TArgs) => string` on `TResourceV2Options` — both strategies** — Pros: fully user-configurable. / Cons: for serialize strategy, the serialized key is already the natural devtools key. A user override would fight the serialize strategy's inherent behavior.

2. **`devtoolsKey?: (args: TArgs) => string` on `TResourceV2Options` — compare strategy only** — Pros: targeted, no confusion for serialize strategy users. Default: monotonic counter `String(counter++)`. / Cons: asymmetric API — option exists but only works for one strategy. Users must know their strategy to understand whether the option applies.

3. **CacheMap-level change: factory receives key as second param** — The `CacheMap.getOrCreate` passes the derived key to factory. Pros: key derivation colocated with data structure. / Cons: changes `TCacheMapFactory` signature (see ADR-4). This option is complementary to option 2, not alternative.

4. **Devtools key derived inside CacheMap post-creation** — CacheMap attaches key to entry after factory returns. Pros: clean separation. / Cons: CacheMap gains devtools awareness; entry's `Signal.state` already needs key at construction time (keyParts).

### Decision
**Option 2** combined with **Option 3** — New `devtoolsKey?: (args: TArgs) => string` on `TResourceV2Options`, applied only to compare strategy. The option flows through `ICacheMapOptions` to `CompareCacheMap`. The factory signature change (ADR-4) is the delivery mechanism.

- **Default** (no `devtoolsKey` provided): `CompareCacheMap` uses a monotonic counter `String(this._counter++)`. Counter starts at 0, increments on each `getOrCreate` miss, never resets or reuses values after deletion [ref: 02-dataflow.md#1.1].
- **Custom** (`devtoolsKey` provided): `CompareCacheMap` calls `devtoolsKey(args)` to derive the key string.
- **Serialize strategy**: `devtoolsKey` option is ignored. The serialized key (from `_getKey(args)`) is always used as `argsKey`.

Devtools keys appear in Signal state names as the third keyPart: `"Resource/:users/:0"` (counter) or `"Resource/:users/:myCustomKey"` (custom) [ref: 03-model.md#8].

### Consequences
- **Positive**: Compare strategy no longer calls `serializeFn`/`stableStringify` — zero serialization for non-serializable args. Eliminates the semantic mismatch.
- **Positive**: Monotonic counter produces stable, unique devtools keys. No gaps or reuse after deletion.
- **Positive**: User-configurable override for cases where semantic keys are preferred (e.g., `(args) => args.name`).
- **Negative**: Counter-based keys like `"0"`, `"1"` are positional, not semantic — less informative in devtools for debugging. Mitigated by the `devtoolsKey` override option.
- **Negative**: Adds one optional field to `TResourceV2Options`. Minimal API surface increase.
- **Risk**: If `devtoolsKey` returns non-unique values, multiple entries may share the same devtools key string. The counter-based default avoids this (monotonic). Uniqueness of custom keys is the user's responsibility [ref: 03-model.md#9.3 INV-F4].

---

## ADR-4: Factory Signature Change to Eliminate Double Serialization

### Status
Proposed

### Context
The factory closure in `ResourceV2` constructor calls `serializeFn(args)` to produce devtools keys. For serialize strategy, `SerializeCacheMap._getKey(args)` already computes the serialized key — the factory closure serializes again (call #2), producing an identical string redundantly [ref: ../01-research/03-problem-analysis-devtools.md#Problem #4]. For compare strategy, the factory closure forces serialization on non-serializable args (problem #3, addressed by ADR-3). Both problems share a root cause: the factory `(args) => TEntry` has no way to receive a pre-computed key from the CacheMap.

Solving Q3 (devtools key for compare) and Q6 (double serialization for serialize) together via a single factory signature change avoids two different mechanisms for the same issue [ref: ../01-research/05-open-questions.md#Q6].

**Resolves**: Q6 — "How should the double serialization in SerializeCacheMap be eliminated?" [ref: ../01-research/05-open-questions.md#Q6], interconnected with Q3 and Q5.

**User feedback on Q6**: "На усмотрения дизайнера."
**User feedback on Q5**: "query-v2 is not yet released, so we can adjust the API without breaking changes."

### Options Considered

1. **Pass key from CacheMap to factory: `(args, argsKey) => TEntry`** — `getOrCreate` passes the already-computed key as second argument. Pros: eliminates redundancy cleanly; single interface change solves both Q3 and Q6; CacheMap is the authority on key derivation. / Cons: changes `TCacheMapFactory` signature — internal type change.

2. **Side-channel via mutable ref** — Resource sets up a mutable ref; CacheMap writes to it; factory reads from it. Pros: no signature change. / Cons: fragile, stateful coupling; race conditions possible; harder to reason about.

3. **Post-creation callback: `onEntryCreated(entry, key)`** — CacheMap notifies resource after factory returns. Pros: no factory signature change. / Cons: `Signal.state` needs key at construction time (in CacheEntry constructor via `keyParts`) — a post-creation callback is too late.

4. **Accept redundancy for serialize; only fix compare** — Pros: minimal change. / Cons: known performance issue remains; inconsistent approach across strategies.

### Decision
**Option 1** — Change `TCacheMapFactory<TArgs, TEntry>` from `(args: TArgs) => TEntry` to `(args: TArgs, argsKey: string) => TEntry`.

Each CacheMap implementation passes its naturally-derived key:
- **`SerializeCacheMap.getOrCreate`**: computes `const key = this._getKey(args)`, passes `key` as `argsKey` → **eliminates serialization call #2** [ref: 02-dataflow.md#1.2].
- **`CompareCacheMap.getOrCreate`**: derives `argsKey` from counter or `devtoolsKey(args)` (ADR-3), passes to factory → **eliminates `serializeFn` call entirely for compare strategy** [ref: 02-dataflow.md#1.1].

The `ResourceV2` factory closure simplifies from `(args) => this._entryFactory(args, serializeFn(args))` to `(args, argsKey) => this._entryFactory(args, argsKey)` — a passthrough [ref: 03-model.md#5.1]. `serializeFn` is no longer called inside the factory closure; for serialize strategy it is called once inside `_getKey()`.

Since `query-v2` is not yet released, this internal type change has no external breaking change impact [ref: ../01-research/05-open-questions.md#Q5].

### Consequences
- **Positive**: Serialization happens exactly once per new entry (serialize strategy) or zero times (compare strategy). Eliminates the double serialization [ref: ../01-research/03-problem-analysis-devtools.md#Exact Redundancy Locations].
- **Positive**: Single mechanism solves both Q3 and Q6 — CacheMap is the single authority for key derivation.
- **Positive**: Factory closure in `ResourceV2` becomes a trivial passthrough, reducing indirection.
- **Negative**: Internal type `TCacheMapFactory` changes. All factory call sites must pass `argsKey`. Since there is one call site per CacheMap implementation and one consumer (`ResourceV2`), the change scope is narrow [ref: 03-model.md#10].
- **Neutral**: `doCacheArgs` WeakMap in `SerializeCacheMap` continues to work unchanged — it caches the `_getKey` result, which is still called once per `getOrCreate`.

---

## ADR-5: LifecycleHooks Ownership Move to ResourceEntry

### Status
Proposed

### Context
`LifecycleHooks` is a single instance owned by `ResourceV2`, using `Map<TArgs, Resolvers>` with `===` reference identity. `fireQueryStarted` silently overwrites unresolved `$queryFulfilled` promises when called twice for the same args reference — leaking pending promises. For `void`-args resources, all operations collapse to a single Map key, causing interference between concurrent fetches [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5].

**Resolves**: Q4 — "Should LifecycleHooks be per-entry instances or a single instance with per-entry scoping?" [ref: ../01-research/05-open-questions.md#Q4]

**User feedback**: "Каждая `ResourceV2CacheEntry` самостоятельно вызывает хуки."

### Options Considered

1. **Each `ResourceV2CacheEntry` owns lifecycle resolver state** — No shared `LifecycleHooks` class. Each entry has `_entryDataLoaded`, `_entryRemoved`, `_queryFulfilled` resolvers as instance fields. Callbacks (`onCacheEntryAdded`, `onQueryStarted`) are passed directly from resource options. Pros: eliminates cross-entry interference entirely; simpler internal state; no args-keyed Map needed. / Cons: `LifecycleHooks.clearAll()` from `ResourceV2.resetCache()` must be replaced by iterating entries — but `resetCache()` already iterates `values()` [ref: 01-architecture.md#5.3].

2. **Shared `LifecycleHooks`, keyed by entry reference** — Replace `Map<TArgs, Resolvers>` with `Map<ResourceV2CacheEntry, Resolvers>`. Pros: keeps single instance; entries are unique references. / Cons: `LifecycleHooks` gains dependency on `ResourceV2CacheEntry` type (currently generic). Adds a type parameter. Shared instance remains a conceptual complexity.

3. **LifecycleHooks split: resource-level + entry-level** — `onCacheEntryAdded` stays on resource (resource-level event), `onQueryStarted`/`$queryFulfilled` move to entry. Pros: semantically correct separation. / Cons: two lifecycle hook locations; split adds conceptual complexity; `onCacheEntryAdded` still needs resolver state which would remain in a shared class.

### Decision
**Option 1** — Each `ResourceV2CacheEntry` owns its lifecycle resolver state. The `LifecycleHooks` class (`core/LifecycleHooks.ts`) is deleted entirely.

Implementation structure [ref: 03-model.md#4]:
- Entry gains fields: `_entryDataLoaded: PromiseResolver<TData> | null`, `_entryRemoved: PromiseResolver<void> | null`, `_queryFulfilled: PromiseResolver<{data: TData}> | null`
- Entry gains callback refs: `_onCacheEntryAdded: TOnCacheEntryAdded<TArgs, TData>`, `_onQueryStarted: TOnQueryStarted<TArgs, TData>`
- Constructor fires `onCacheEntryAdded` (creates entry-level resolvers, invokes user callback) [ref: 03-model.md#4.3]
- `_doFetch` fires `onQueryStarted` (rejects leftover `_queryFulfilled`, creates new resolver, invokes user callback) [ref: 03-model.md#4.4]
- `complete()` settles all pending resolvers [ref: 03-model.md#4.5]

`ResourceV2` changes:
- `_lifecycleHooks` field removed
- `_onCacheEntryAdded`, `_onQueryStarted` stored as direct callback references
- Factory passes callbacks to entry constructor
- `resetCache()` relies on `entry.complete()` for cleanup — no separate `clearAll()` [ref: 02-dataflow.md#2.2]

### Consequences
- **Positive**: Eliminates cross-entry interference. Each entry's `_queryFulfilled` is independent — concurrent fetches on different entries cannot overwrite each other's resolvers.
- **Positive**: `void`-args resources work correctly — no Map key collision since resolvers are per-entry, not per-args.
- **Positive**: Refetch handling is explicit — old `_queryFulfilled` is rejected before creating new resolver (INV-LH3) [ref: 03-model.md#9.2]. Prevents silent promise leak.
- **Positive**: `resetCache()` simplifies — `entry.complete()` handles all cleanup, no separate `clearAll()` call or double-processing risk [ref: 02-dataflow.md#2.2].
- **Positive**: Plugin system is unaffected — confirmed orthogonal to LifecycleHooks [ref: ../01-research/01-codebase-analysis.md#Area C].
- **Negative**: `ResourceV2CacheEntry` gains ~6 new fields and lifecycle management responsibility. Increases class complexity. Mitigated by the fields being simple nullable `PromiseResolver` instances with clear lifecycle (create → settle → null).
- **Negative**: Entry constructor gains side effects (`_fireCacheEntryAdded` invokes user callback). This matches current behavior (factory called `LifecycleHooks.fireCacheEntryAdded` immediately after entry creation), but the responsibility is now inside the constructor.
- **Neutral**: Hydration via `ResourceV2.hydrateEntry()` continues to work — factory creates entry with `initialMachine`, `onCacheEntryAdded` fires if configured, `$cacheDataLoaded` resolves immediately for `MachineSuccess` initial state [ref: 01-architecture.md#5.7].

---

## ADR-6: `entries()` Removal from ICacheMap

### Status
Proposed

### Context
`ICacheMap.entries()` returns `IterableIterator<[string | TArgs, TEntry]>` — a union type because `SerializeCacheMap` yields `[string, TEntry]` and `CompareCacheMap` yields `[TArgs, TEntry]`. With `CompareCacheMap` moving to `Map<TArgs, TEntry>` (ADR-1), the key type remains `TArgs`.

A consumer audit from the domain model phase identified three consumers of `entries()` via `ResourceV2.cacheEntries()` [ref: 01-architecture.md#4.1]:

| Consumer | Usage | Needs Key? |
|----------|-------|-----------|
| `Snapshot.getSnapshot()` | Iterates `[key, entry]`, uses `key` for snapshot keys, throws if `typeof key !== "string"` | Yes — migrates to `entry.argsKey` (new field from ADR-4) |
| `createApi` stale check | Iterates `[, entry]`, ignores key | No — migrates to `values()` |
| `ResourceV2.resetCache()` | Already uses `values()` | No change needed |

**Resolves**: Q9 — "Should `CompareCacheMap.entries()` return type change if the internal data structure changes?" [ref: ../01-research/05-open-questions.md#Q9]

**User feedback**: "На сколько я понимаю `entries()` вообще не нужен, и можно его удалить."

### Options Considered

1. **Keep union return type** — Consumers already handle both cases. No change. Pros: no migration. / Cons: union type is awkward; `[string | TArgs, TEntry]` forces consumers to check key type. Unclear after ADR-1 since both strategies' keys are different types.

2. **Make `entries()` generic per strategy** — Add a `TKey` type parameter to `ICacheMap`. `entries(): IterableIterator<[TKey, TEntry]>`. Pros: type-safe per strategy. / Cons: adds a type parameter to the interface; `Snapshot` still needs to distinguish strategies.

3. **Remove `entries()` from `ICacheMap`** — Consumers migrate to `values()`. Key access for Snapshot is via `entry.argsKey` (populated from factory's `argsKey` parameter, ADR-4). Pros: eliminates union type; simpler interface. / Cons: consumers must migrate (2 call sites).

### Decision
**Option 3** — Remove `entries()` from `ICacheMap`. Add `readonly argsKey: string` to `IResourceV2CacheEntry` and `ResourceV2CacheEntry` [ref: 03-model.md#2.2].

`ResourceV2.cacheEntries()` method is removed. Replaced by `ResourceV2.cacheValues()` returning `IterableIterator<ResourceV2CacheEntry<TArgs, TData>>` [ref: 03-model.md#5.4].

`Snapshot.getSnapshot()` migrates to:
```typescript
for (const entry of resource.cacheValues()) {
    entries[entry.argsKey] = { ... };
}
```

The `argsKey` is populated from the factory's second parameter — for serialize strategy it is the serialized string, for compare strategy it is the counter string [ref: 03-model.md#4.2].

### Consequences
- **Positive**: Eliminates the awkward `[string | TArgs, TEntry]` union return type from the interface.
- **Positive**: `ICacheMap` interface is simpler (7 methods + 1 property instead of 8 methods + 1 property).
- **Positive**: `argsKey` on entry is a more direct access pattern for Snapshot — no iterator destructuring needed.
- **Negative**: Two consumer call sites require migration (`Snapshot.getSnapshot()`, `createApi` stale check). Both are straightforward.
- **Risk**: Snapshot's compare-strategy guard currently checks `typeof key !== "string"` — with `argsKey` always being a string (counter for compare, serialized for serialize), the guard logic needs a different distinction mechanism. This is a Snapshot-internal concern, not a CacheMap concern. The guard can check resource's `keyStrategy` or rely on the fact that compare-strategy `argsKey` values are counter strings, not JSON [ref: 03-model.md#6.1 Note].

---

## ADR-7: Demo isError Fix — Description and UI Only

### Status
Proposed

### Context
All 8 query-v2 demo examples display `isError: false` at all times. Root cause: queryFns succeed on the first call, so errors occur only during `refreshing` (SWR semantics), producing `MachineSuccess` with `lastError`, not `MachineError`. `isError` derives from `originalStatus === "error"` which requires `MachineError` — only reachable from `MachinePending` [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #6].

The `error-swr-states.tsx` demo is the primary error demo but never shows `isError: true` because `fetchCount` starts at 0, increments to 1 on first call (odd → success), then alternates. The first fetch always succeeds, placing the machine in `MachineSuccess` permanently [ref: 02-dataflow.md#3.2].

**Resolves**: Q8 — "Should the error demos be fixed to actually demonstrate error states, or should `isError` checks simply be removed?" [ref: ../01-research/05-open-questions.md#Q8]

**User feedback**: "Исправить ложное описание и поведение UI (логику менять не нужно)."

### Options Considered

1. **Fix queryFn to fail on first call** — Change `error-swr-states.tsx` to throw on `fetchCount === 1`. Pros: actually demonstrates `MachineError` → `isError: true`. / Cons: user first sees error on page load; changes queryFn logic (contradicts user feedback).

2. **Fix UI descriptions and remove unreachable error banners** — Update text to explain SWR semantics. Show `lastError`/`isRefreshError` instead of `isError`. Remove conditional banners that never render. Pros: no queryFn changes; teaches SWR correctly. / Cons: `isError: true` is never demonstrated.

3. **Add "trigger error" button** — Interactive error triggering. Pros: user controls when error occurs. / Cons: more complex demo code; changes component logic.

4. **New dedicated error-state demo** — Separate file where first fetch fails. Pros: separation of concerns. / Cons: more files; out of scope per user feedback.

### Decision
**Option 2** — Fix UI descriptions and behavior. Do not change queryFn logic in any demo file.

Changes per file [ref: 01-architecture.md#6.2]:

| File | Fix |
|------|-----|
| `error-swr-states.tsx` | Relabel as "SWR error recovery" demo. Replace `isError` display with `isRefreshError` + `lastError`. Remove unreachable error banner. Show `state.error` to demonstrate error data availability under SWR. |
| `lifecycle-hooks.tsx` | Remove or relabel `isError` display as "always false in this example." |
| `basic-query.tsx` | Remove misleading `isError` display or add comment. |
| `optimistic-patches.tsx` | Remove unreachable `if (state.isError)` early return or add comment. |
| `ssr-snapshot.tsx` | Remove unreachable `{state.isError && (...)}` block or add comment. |

### Consequences
- **Positive**: Demo UI accurately reflects SWR semantics. Users learn that `lastError`/`isRefreshError` are the correct way to check for errors after initial success.
- **Positive**: No queryFn logic changes — zero risk of breaking demo behavior.
- **Positive**: `error-swr-states.tsx` becomes a genuinely educational demo about SWR error recovery instead of a misleading error-state demo.
- **Negative**: No demo shows `isError: true`. Users wanting to see the `MachinePending → MachineError` path must construct this scenario themselves. Acceptable — this is an uncommon UI pattern in SWR-based applications.
- **Neutral**: No production code impact — demo files only.
