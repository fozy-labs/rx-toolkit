---
title: "Open Questions: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demos"
date: 2026-03-29
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: What data structure should replace the Array in CompareCacheMap?

**Context**: Problem #1 establishes that `CompareCacheMap` uses `Array<{ args, entry }>` with O(n) `find`/`findIndex` for every lookup. The task mandates Map/WeakMap for instant access. However, comparison-based caches inherently depend on a custom equality function — `Map` uses `===` identity, and `WeakMap` requires object keys (primitives like `string`, `number`, `void` are invalid WeakMap keys). The codebase analysis confirms args can be any `TArgs`, including primitives and non-serializable objects.

**Options**:
1. **`Map<TArgs, TEntry>` only** — Pros: O(1) lookup when the same args reference is reused (common in React where args are memoized). Works with all key types including primitives. / Cons: Only provides O(1) for reference-equal args. Structurally-equal but referentially-distinct args still require a fallback. This is essentially a reference-identity cache, not a replacement for comparison-based lookup.
2. **`WeakMap<object & TArgs, TEntry>` only** — Pros: O(1) lookup, automatic GC of entries when args are no longer referenced. / Cons: Does not accept primitive keys (`void`, `string`, `number`). Breaks for `createResourceV2<void, TData>` or `createResourceV2<string, TData>`. Cannot iterate (no `entries()`, `values()`, `size`).
3. **Hybrid: `Map` (or `WeakMap` for objects) as primary index + Array as fallback for comparison-based deduplication** — Pros: O(1) for repeated same-reference args; falls back to comparison scan only for new references that may be structurally equal. / Cons: Two data structures to maintain; insertion/deletion must update both; `delete` by comparison still requires the Array scan to find the entry, then remove from both.
4. **`Map<TArgs, TEntry>` as reference cache + comparison scan only on cache miss** — Pros: same-reference lookups are O(1); structurally-equal new references trigger one comparison scan, then the new reference is added to the Map. / Cons: Map grows with every distinct reference (memory leak if args references are not reused). Needs eviction or WeakRef strategy.

**Risks**: Choosing a WeakMap-only approach breaks primitive-args resources. Choosing Map-only with reference identity may silently change semantics — current behavior finds structurally-equal args via `compareArg`, a pure Map lookup would not. The `entries()` and `size` API contract (from `ICacheMap`) requires iterability, which WeakMap cannot provide.

**Researcher recommendation**: Option 3 or 4 (hybrid) appears most aligned with the task intent ("use Map/WeakMap for instant access") while preserving the comparison fallback. The reference cache acts as a fast path; the comparison function acts as a correctness guarantee. The exact choice between Map vs WeakMap for the reference cache depends on Q2 (the caching option design).

**User Feedback**: Давай сделаем проще (без кеширования сравнения) - просто `Map`

---

### Q2: What should the `doCacheArgs` equivalent for CompareCacheMap look like?

**Context**: Problem #2 notes that `doCacheArgs` is silently ignored by `CompareCacheMap`. In `SerializeCacheMap`, `doCacheArgs` creates a `WeakMap<object, string>` caching `args → serialized key`. For `CompareCacheMap`, the analogous concept is `args reference → entry` caching. This is tightly coupled to Q1 — the "caching option" may simply be the reference-identity Map/WeakMap from the new data structure, enabled by a flag.

**Options**:
1. **Reuse the `doCacheArgs` flag** — When `true` on compare strategy, enable a `WeakMap<object & TArgs, TEntry>` (or `Map`) that indexes entries by reference identity, bypassing the comparator for known references. Pros: no new API surface. Cons: `doCacheArgs` semantics differ between strategies (serialize: caches serialization result; compare: caches entry lookup).
2. **Always-on reference cache as part of Q1's data structure change** — The reference cache is not optional; it is the new primary data structure. `doCacheArgs` becomes irrelevant for compare strategy. Pros: simpler mental model, always O(1) for repeated references. Cons: slightly higher memory overhead even when not needed; removes user control.
3. **New option name (e.g., `doCacheByRef`)** — Separate flag from `doCacheArgs` to avoid semantic overloading. Pros: explicit, clear intent. Cons: adds to API surface; yet another option to explain.

**Risks**: If the caching option is always-on (option 2) and the data structure from Q1 uses `Map`, entries are never GC'd until explicitly deleted — potential memory leak for short-lived args references. If optional (option 1 or 3), users who don't enable it get the same O(n) behavior for new references.

**Researcher recommendation**: This depends heavily on Q1. If Q1 results in a hybrid structure with a Map as primary index, then caching is inherently always-on (option 2) and `doCacheArgs` for compare strategy becomes a no-op or should be removed from the type for that strategy. Clarify Q1 first.

**User Feedback**: Давай сделаем прощe - без кеширования для стратегии сравнения.

---

### Q3: How should the devtools key be derived for the compare strategy?

**Context**: Problem #3 reveals that `serializeFn(args)` is called for devtools key derivation even when `keyStrategy === "compare"`. The task specifies: "add an option to specify a function for extracting the devtools key from arguments, default — indices." The codebase analysis shows devtools keys flow through `ResourceV2._entryFactory` → `CacheEntry` → `Signal.state({ key })`. Currently there is no type-level option for custom devtools key extraction.

**Options**:
1. **New option on `TResourceV2Options`: `devtoolsKey?: (args: TArgs) => string`** — Applies to both strategies. Default for compare: index-based (`"0"`, `"1"`, ...). Default for serialize: the serialized key (current behavior). Pros: fully user-configurable. Cons: adds API surface; user must understand devtools key semantics.
2. **New option on `TResourceV2Options`: `devtoolsKey?: (args: TArgs) => string`** — Applies only to compare strategy (serialize strategy already has a natural key). Pros: targeted. Cons: asymmetric API — option exists but only works for one strategy.
3. **CacheMap-level change: factory receives index or key as second param** — The `CacheMap.getOrCreate` passes the derived key (index for compare, serialized string for serialize) to the factory. Pros: key derivation is colocated with the data structure. Cons: changes the `TCacheMapFactory` signature from `(args) => TEntry` to `(args, key) => TEntry`, which is a breaking change to the internal factory type.
4. **Devtools key derived inside CacheMap, not in factory** — CacheMap itself attaches the key to the entry after creation. Pros: clean separation. Cons: CacheMap currently has no knowledge of devtools; would need a new responsibility or callback.

**Risks**: Index-based defaults produce keys like `"Resource/:users/:0"` — these are positional, not semantic. If entries are deleted and new ones created, indices may be reused or gaps appear, making devtools history confusing. Additionally, the index is determined at insertion time — if the internal data structure changes from Array to Map (Q1), there is no natural "index."

**Researcher recommendation**: Option 1 (user-configurable `devtoolsKey` on resource options) with strategy-specific defaults seems cleanest. However, the "default — indices" part needs clarification: does "index" mean a monotonically increasing counter (never reused), or the array position (can have gaps)? A counter is safer for devtools readability. This also interacts with Q1 — if Array is replaced, array position is no longer available, but a counter is always available.

**User Feedback**: Новая опция в `ResourceV2Options`, которая применяется только к стратегии сравнения, по умолчанию монотонный счетчик (0, 1, 2...).

---

### Q4: Should LifecycleHooks be per-entry instances or a single instance with per-entry scoping?

**Context**: Problem #5 states "LifecycleHooks should belong to ResourceEntry." The analysis reveals the current shared instance uses `Map<TArgs, Resolvers>` with `===` identity — causing cross-entry interference when the same args reference is reused for `fireQueryStarted` (overwrites prior unresolved `$queryFulfilled`). The task is ambiguous: does "belong to entry" mean each entry instantiates its own `LifecycleHooks`, or that the resolver state is scoped per-entry inside a shared instance?

**Options**:
1. **Each `ResourceV2CacheEntry` owns a `LifecycleHooks` instance** — No args-keyed Maps needed; each instance manages exactly one set of resolvers. Pros: eliminates cross-entry interference entirely; simpler internal state. Cons: `LifecycleHooks` constructor currently receives `onCacheEntryAdded` and `onQueryStarted` callbacks from resource-level options — these would need to be passed to each entry. The `clearAll()` call from `ResourceV2.resetCache()` would need to iterate all entries instead of calling one method.
2. **Shared `LifecycleHooks` instance, but keyed by entry reference instead of args** — Replace `Map<TArgs, Resolvers>` with `Map<ResourceV2CacheEntry, Resolvers>`. Pros: keeps single instance; entries are unique references. Cons: `LifecycleHooks` gains a dependency on `ResourceV2CacheEntry` type (currently generic). The type parameter changes from `<TArgs, TData>` to include entry type.
3. **LifecycleHooks split: resource-level hooks (onCacheEntryAdded) stay on resource, entry-level hooks (onQueryStarted/onQueryFulfilled) move to entry** — Pros: semantically correct — `onCacheEntryAdded` is a resource-level event (new entry in resource's cache), while `onQueryStarted`/`onQueryFulfilled` are entry-level events. Cons: splits the class; two different lifecycle hook locations to understand.

**Risks**: Moving hooks to entries changes the instantiation lifecycle — hooks must be set up before the first fetch, and torn down on entry cleanup. `onCacheEntryAdded` fires when the entry is created but before it fetches — if hooks are per-entry, the entry would need to fire its own creation event, which is circular. If hooks remain resource-level for `onCacheEntryAdded` but per-entry for query hooks, the split adds conceptual complexity.

**Researcher recommendation**: Option 1 is the most straightforward interpretation of the task. The `onCacheEntryAdded` callback can still be invoked from `ResourceV2._entryFactory` (the resource knows when an entry is added). The per-entry instance handles only `onQueryStarted`/`$queryFulfilled`/`$cacheDataLoaded`/`$cacheEntryRemoved` — scoped to that entry's lifecycle. This eliminates the args-keyed Map entirely.

**User Feedback**: Каждая `ResourceV2CacheEntry` самостоятельно вызывает хуки.

---

## Medium Priority

### Q5: Does adding `devtoolsKey` to `TResourceV2Options` constitute a breaking change?

**Context**: Problems #3 and #4 both require changes to how devtools keys are derived. Adding a new optional field to `TResourceV2Options` is technically non-breaking (existing code compiles). However, changing the **default** devtools key format for compare strategy (from serialized args to indices) changes what appears in Redux DevTools. Users who rely on specific key patterns in devtools for debugging or tooling would see different keys after upgrade.

**Options**:
1. **Non-breaking: new optional field, default behavior unchanged for serialize strategy** — Compare strategy default changes from serialized args to indices (or counter). Serialize strategy default is unchanged. Pros: existing serialize-strategy users see no change. Cons: compare-strategy users see different devtools keys (but since compare-strategy devtools keys were broken for non-serializable args, this is arguably a fix, not a break).
2. **Breaking: change `TCacheMapFactory` signature to `(args, argsKey) => TEntry`** — Internal breaking change. Pros: CacheMap can pass the key to the factory. Cons: any code creating custom CacheMap implementations must update.

**Risks**: `TCacheMapFactory` is defined in public types (`cache.types.ts`). If users import and implement custom factories, option 2 is a public API break. However, the research did not find evidence of external custom factory usage — this is an internal type primarily consumed by `ResourceV2`.

**Researcher recommendation**: Option 1 is safer. The factory signature is likely internal-only, but changing defaults for devtools display is low-risk since devtools keys are for debugging, not program behavior. Mark it as a minor change in CHANGELOG.

**User Feedback**: query-v2 is not yet released, so we can adjust the API without breaking changes.

---

### Q6: How should the double serialization in SerializeCacheMap be eliminated?

**Context**: Problem #4 shows that `SerializeCacheMap.getOrCreate` serializes args for Map lookup (call #1), then the factory closure serializes again for devtools key (call #2). Both use the same function with the same args. The `doCacheArgs` WeakMap does not mitigate this because call #2 bypasses `_getKey()`.

**Options**:
1. **Pass the serialized key from CacheMap to the factory** — `getOrCreate` passes the already-computed key as a second argument to the factory. Pros: eliminates redundancy cleanly. Cons: changes `TCacheMapFactory` signature (see Q5 risk). Aligns with Q3 option 3.
2. **Factory closure captures the key via a side channel** — Resource sets up a mutable ref; CacheMap's `_getKey` writes to it; factory reads from it. Pros: no signature change. Cons: fragile, stateful coupling; harder to reason about.
3. **Move devtools key derivation out of the factory, into CacheMap** — CacheMap calls a `onEntryCreated(entry, key)` callback after factory invocation. Pros: clean separation. Cons: new callback mechanism; CacheMap gains devtools awareness.
4. **Accept the redundancy for serialize strategy; only fix compare strategy** — Pros: minimal change. Cons: leaves a known performance issue; inconsistent approach.

**Risks**: Options 1 and 3 require changes to the CacheMap ↔ factory interface, which affects both strategies. If this interface change is made for Q3 (devtools key for compare), it can solve Q6 simultaneously. Solving them separately risks two different mechanisms for the same problem.

**Researcher recommendation**: Solve Q3 and Q6 together. If the factory signature changes to receive the argsKey (option 1), both problems are addressed: compare strategy passes index/counter, serialize strategy passes the serialized key (already computed). Single interface change, both strategies benefit.

**User Feedback**: На усмотрения дизайнера.

---

### Q7: What downstream consumers or plugins depend on the current LifecycleHooks ownership structure?

**Context**: Problem #5 requires moving LifecycleHooks from resource to entry. The codebase analysis identified the dependency chain: `ResourceV2` → creates `LifecycleHooks` → passes closures to entries → entries invoke closures → closures call back to `LifecycleHooks`. The plugin system (`@/query-v2/plugins/`) may interact with lifecycle hooks. `resetCache()` calls `this._lifecycleHooks.clearAll()`.

**Options**:
1. **Audit all plugin files for LifecycleHooks interaction before proceeding** — Read all files in `src/query-v2/plugins/` and check for `onCacheEntryAdded`, `onQueryStarted`, lifecycle-related imports.
2. **Proceed with the move; fix any plugin breakage during implementation** — Treat plugins as internal consumers and update them as needed.

**Risks**: If a plugin holds a reference to the resource-level `LifecycleHooks` instance (unlikely but possible), moving hooks to entries would break it. The `Snapshot` system (`hydrateEntry`) creates entries without going through the normal factory path — if lifecycle hooks are per-entry, hydrated entries need hooks too.

**Researcher recommendation**: Option 1 is prudent — a quick audit during design phase costs little and prevents implementation surprises. The codebase analysis did not fully explore the plugin directory.

**User Feedback**: На усмотрения дизайнера.

---

## Low Priority

### Q8: Should the error demos be fixed to actually demonstrate error states, or should `isError` checks simply be removed?

**Context**: Problem #6 shows that `isError` is always `false` in all demos. The root cause is that queryFns succeed on the first call, so errors only occur during `refreshing` (SWR semantics keep `isError: false`). Two fundamentally different fixes exist.

**Options**:
1. **Fix queryFn to fail on first call** — e.g., change `error-swr-states.tsx` to throw on `fetchCount === 1` (odd) instead of even. First mount errors → `MachineError` → `isError: true`. Subsequent success → SWR. Pros: actually demonstrates the error → success → stale-while-revalidate flow. Cons: user first sees an error on page load, which may be confusing in a demo.
2. **Remove `isError` checks from demos that don't demonstrate errors** — Keep `isError` only in `error-swr-states.tsx`, fix that demo to actually error. Remove `isError` display from `basic-query`, `skip-token`, etc. Pros: clean, no misleading UI. Cons: fewer demos showing error state.
3. **Add a "trigger error" button** — Let the user explicitly trigger a failing fetch (e.g., set a flag that makes the next queryFn throw on a pending entry after resetAll). Pros: interactive, user controls when error occurs. Cons: more complex demo code.
4. **Create a separate dedicated error-state demo** — New example file (`error-states.tsx`) where the first fetch always fails. Existing demos remain success-only. Pros: separation of concerns. Cons: more files to maintain.

**Risks**: Minimal — these are demo files with no production impact. The main risk is confusing new users if demos show misleading state information.

**Researcher recommendation**: Option 1 for `error-swr-states.tsx` (it's the error demo, it should show errors) combined with option 2 for other demos (remove misleading `isError` display where it can never be `true`). This provides one clear error demo and clean non-error demos.

**User Feedback**: Исправить ложное описание и поведение UI (логику менять не нужно);

---

### Q9: Should `CompareCacheMap.entries()` return type change if the internal data structure changes?

**Context**: Currently `ICacheMap.entries()` returns `IterableIterator<[string | TArgs, TEntry]>` — a union because `SerializeCacheMap` yields `[string, TEntry]` and `CompareCacheMap` yields `[TArgs, TEntry]`. If Q1 introduces a Map with different key types, the entries iterator behavior may change.

**Options**:
1. **Keep union return type** — Consumers already handle both cases. No change.
2. **Make `entries()` generic per strategy** — `ICacheMap<TArgs, TEntry, TKey>` with `entries(): IterableIterator<[TKey, TEntry]>`. Pros: type-safe per strategy. Cons: adds a type parameter to the interface.
3. **Normalize: always return `[TArgs, TEntry]`** — Both strategies return original args. `SerializeCacheMap` would need to store args alongside serialized keys. Pros: uniform API. Cons: additional storage in `SerializeCacheMap`.

**Risks**: Low. `entries()` is used in snapshots and iteration. Changing the return type might affect `Snapshot.getSnapshot()` which iterates cache entries. Need to verify.

**Researcher recommendation**: Defer until Q1 is resolved. The data structure choice determines what keys are naturally available for iteration.

**User Feedback**: На сколько я понимаю `entries()` вообще не нужен, и можно его удалить
