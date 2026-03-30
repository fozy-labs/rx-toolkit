---
title: "Problem Analysis: Devtools Key Derivation (Problems #3 and #4)"
date: 2026-03-29
stage: 01-research
role: rdpi-problem-analyst
---

## Reported Problem

Two related issues with devtools key derivation in `query-v2`:

- **Problem #3**: For the comparison (`"compare"`) cache strategy, serialization is used when determining the devtools key. A custom function for extracting the devtools key from arguments is needed, with index-based keys as the default.
- **Problem #4**: For the serialization (`"serialize"`) cache strategy, an extra (redundant) serialization call is made when determining the devtools key.

Both problems originate from the same code path: the factory closure in `ResourceV2` constructor that unconditionally calls `serializeFn(args)`.

---

## Problem #3 — Serialization Used for Devtools Key in Compare Strategy

### Expected vs Actual

- **Expected**: The compare strategy should not depend on serialization at all. Devtools keys should be derived via a user-configurable function, defaulting to index-based keys (positional entry indices within the cache).
- **Actual**: The compare strategy uses `serializeFn(args)` (defaults to `stableStringify`) to produce the devtools key string. There is no option for a custom devtools key extractor. There is no index-based fallback.

### What "serialization is used" Means

The factory closure in the `ResourceV2` constructor at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L51):

```ts
factory: (args) => this._entryFactory(args, serializeFn(args)),
```

`serializeFn` is unconditionally defined at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L47):

```ts
const serializeFn = options.serializeArgs ?? stableStringify;
```

This means even when `keyStrategy === "compare"`, the factory always calls `serializeFn(args)`. The serialized result (`argsKey`) flows into `_entryFactory` at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L147), where it is used solely for devtools key assembly at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L157):

```ts
keyParts: this._key ? ["Resource/", `${this._key}/`, argsKey] : undefined,
```

The `keyParts` array is joined in `CacheEntry` constructor at [CacheEntry.ts](src/query-v2/core/CacheEntry.ts#L22):

```ts
key: options?.keyParts?.join(":"),
```

producing a Signal key like `"Resource/:users/:{"id":1}"` for devtools display.

### Why This Is Problematic

1. **Semantic mismatch**: The compare strategy exists specifically for cases where args may be non-serializable (RegExp, functions, class instances, etc.). Calling `stableStringify` on non-serializable args produces incorrect/indistinguishable keys (e.g., `{}` for RegExp, `undefined` for functions).
2. **No escape hatch**: There is no option in `TResourceV2Options` or `ICacheMapOptions` to provide a custom devtools key derivation function.
3. **Performance waste**: Serialization is performed for every new entry even though the compare strategy never needs it for cache lookup.

### What "Default — Indices" Means

The task states the default devtools key for compare strategy should be **indices** — i.e., the positional index of the entry within the cache. For example, the first entry created would get devtools key `"0"`, the second `"1"`, etc. This would produce Signal keys like `"Resource/:users/:0"`, `"Resource/:users/:1"`.

Currently `CompareCacheMap` stores entries in an `Array<{ args, entry }>` at [CompareCacheMap.ts](src/query-v2/core/CacheMap/CompareCacheMap.ts#L9), so indices are naturally available as the array position at insertion time (i.e., `this._entries.length` before push at [CompareCacheMap.ts](src/query-v2/core/CacheMap/CompareCacheMap.ts#L31)). However, the devtools key is currently derived **outside** `CacheMap` (in the factory closure), not inside it.

### Code Path Trace (Compare Strategy)

1. User calls `resource.query(args)` or `resource.getEntry(args, true)`
2. → `this._cache.getOrCreate(args)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L70)
3. → `CompareCacheMap.getOrCreate(args)` — [CompareCacheMap.ts](src/query-v2/core/CacheMap/CompareCacheMap.ts#L27-L32)
4. → `this._find(args)` — linear scan via `_compareArg` (**no serialization**) — [CompareCacheMap.ts](src/query-v2/core/CacheMap/CompareCacheMap.ts#L19-L21)
5. → Cache miss: `this._factory(args)` — the factory closure at [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L51)
6. → **`serializeFn(args)` is called** → `stableStringify(args)` by default — **serialization call for devtools only**
7. → `this._entryFactory(args, argsKey)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L147)
8. → `keyParts: ["Resource/", "${key}/", argsKey]` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L157)
9. → `CacheEntry` constructor: `key: keyParts.join(":")` — [CacheEntry.ts](src/query-v2/core/CacheEntry.ts#L22)
10. → `Signal.state(initialState, { key })` — Signal created with devtools key

### Type System Locations Requiring Changes

- `TResourceV2Options<TArgs, TData>` at [resource.types.ts](src/query-v2/types/resource.types.ts#L20-L32) — currently has no option for devtools key extraction. A new optional field (e.g., `devtoolsKey?: (args: TArgs) => string`) would be declared here.
- `ICacheMapOptions<TArgs, TEntry>` at [cache.types.ts](src/query-v2/types/cache.types.ts#L42-L49) — the factory signature `TCacheMapFactory<TArgs, TEntry>` at [cache.types.ts](src/query-v2/types/cache.types.ts#L40) currently takes only `(args: TArgs) => TEntry`. If index-based keys must be generated inside the CacheMap, either the factory signature or the CacheMap interface needs to change.

---

## Problem #4 — Double Serialization in Serialize Strategy

### Expected vs Actual

- **Expected**: For the serialize strategy, args are serialized once. The resulting string key serves both as the `Map` lookup key **and** as the devtools `argsKey`. Single `stableStringify` (or custom serializer) invocation per new entry.
- **Actual**: Args are serialized **twice** for every new entry — once by `SerializeCacheMap._getKey()` for Map lookup, and once by the factory closure `serializeFn(args)` for devtools key derivation. Both calls invoke the same serialization function with the same args.

### Code Path Trace (Serialize Strategy — New Entry)

1. User calls `resource.query(args)` or `resource.getEntry(args, true)`
2. → `this._cache.getOrCreate(args)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L70)
3. → `SerializeCacheMap.getOrCreate(args)` — [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L37-L44)
4. → **Serialization call #1**: `const key = this._getKey(args)` — [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L38)
   - `_getKey(args)` calls `this._serializeArgs(args)` — [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L29) (or line 24 via WeakMap path)
   - `_serializeArgs` defaults to `stableStringify` — [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L16)
5. → `this._map.get(key)` — cache miss (undefined)
6. → `entry = this._factory(args)` — the factory closure — [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L41)
7. → **Serialization call #2**: `serializeFn(args)` inside the factory closure — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L51)
   - `serializeFn` defaults to the **same** `stableStringify` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L47)
   - Same function, same args, producing the same string — redundant computation
8. → `this._entryFactory(args, argsKey)` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L147)
9. → `keyParts: ["Resource/", "${key}/", argsKey]` — [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L157)
10. → `CacheEntry` → `Signal.state` with `key: keyParts.join(":")` — [CacheEntry.ts](src/query-v2/core/CacheEntry.ts#L22)

### Exact Redundancy Locations

| Call | Location | Purpose | Function |
|------|----------|---------|----------|
| #1 | [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L38) → [line 29](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L29) | Map lookup key | `this._serializeArgs(args)` (= `stableStringify`) |
| #2 | [ResourceV2.ts](src/query-v2/core/resource/ResourceV2.ts#L51) | Devtools argsKey | `serializeFn(args)` (= `stableStringify`) |

Both calls use the same serialization function (set to `stableStringify` by default, or to `options.serializeArgs` if provided). The `ResourceV2` constructor passes the same `serializeFn` to both the factory closure (line 51) and to `createCacheMap` options as `serializeArgs` (line 52):

```ts
const serializeFn = options.serializeArgs ?? stableStringify;         // line 47

this._cache = createCacheMap({
    keyStrategy,
    factory: (args) => this._entryFactory(args, serializeFn(args)),   // line 51 — call #2
    serializeArgs: serializeFn,                                       // line 52 — same fn → call #1
    compareArg: options.compareArg,
    doCacheArgs: options.doCacheArgs,
});
```

### `doCacheArgs` Mitigation

When `doCacheArgs: true` is set, `SerializeCacheMap` caches the serialization result in a `WeakMap<object, string>` at [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L13). This means call #1 populates the WeakMap, but call #2 bypasses it entirely because it calls `serializeFn` directly (not via `_getKey`). The `doCacheArgs` WeakMap only caches within `SerializeCacheMap._getKey()` — it does not help the factory closure.

### `stableStringify` Involvement

`stableStringify` at [stableStringify.ts](src/query-v2/lib/stableStringify.ts#L12-L23) is the default serialization function. It uses `JSON.stringify` with a key-sorting replacer. It is called in both locations. It is a pure function with no internal memoization, so repeated calls with the same args produce redundant computation. The cost scales with args complexity (nested objects, large arrays).

### Existing Entry Path (No Redundancy)

For existing entries, `getOrCreate` at [SerializeCacheMap.ts](src/query-v2/core/CacheMap/SerializeCacheMap.ts#L38-L44) calls `_getKey(args)` (serialization call #1), finds the entry in the Map, and returns it. The factory is never invoked, so serialization call #2 never occurs. The redundancy is **only on new entry creation**.

---

## Test Evidence

### Relevant tests found

- [CacheEntry.test.ts](src/query-v2/core/__tests__/CacheEntry.test.ts#L93-L97) — test `CE09`: verifies `keyParts` pass through to Signal construction. Does NOT validate the key format, only that construction succeeds.
- [CacheMap.test.ts](src/query-v2/core/CacheMap/__tests__/CacheMap.test.ts) — tests `CM01`–`CM19`: cover CacheMap CRUD operations. No tests for factory-level behavior, devtools key derivation, or serialization call counting.

### Failing test cases

None. No existing test verifies devtools key correctness or counts serialization invocations.

### Gap

- No test asserts the devtools key format produced for compare vs serialize strategies.
- No test counts serialization invocations per `getOrCreate` call to catch the double-serialization.
- No test verifies behavior when non-serializable args (RegExp, functions) are used with the compare strategy and devtools is enabled.
- No integration test connects `ResourceV2` → `CacheMap` → `CacheEntry` → Signal key for devtools verification.

---

## Scope Boundaries

**Analyzed**:
- Full code path from `ResourceV2` constructor through `createCacheMap`, both `SerializeCacheMap.getOrCreate` and `CompareCacheMap.getOrCreate`, factory closure, `_entryFactory`, `CacheEntry` constructor, to Signal key creation.
- Type system: `ICacheMapOptions`, `TCacheMapFactory`, `TResourceV2Options`, `ICacheEntryOptions`.
- `stableStringify` implementation and its stateless nature.
- `doCacheArgs` WeakMap path and why it doesn't mitigate the double serialization.
- All test files under `query-v2` for devtools/keyParts/serialization coverage.

**Not analyzed**:
- Signal internals (how `key` is consumed by devtools after `Signal.state` creation) — outside problem scope.
- Devtools consumer implementations (`reduxDevtools`, `combineDevtools`) — the key format is the issue, not how it's displayed.
- Performance impact quantification of the double serialization — documented as a redundancy, not benchmarked.
