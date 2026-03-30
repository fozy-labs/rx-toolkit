---
title: "Use Cases: query-v2 CompareCacheMap, Devtools Keys, LifecycleHooks, Demo Fixes"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

# Use Cases

## UC1: CompareCacheMap with Map — Basic Resource Creation and Access

### Story

A developer creates a resource with compare strategy (by providing `compareArg`) and accesses it with different args references. The `CompareCacheMap` uses `Map<TArgs, TEntry>` with reference identity (`===`) instead of the removed `compareArg`-based lookup [ref: ../01-research/05-open-questions.md#Q1].

### Creating a compare-strategy resource

```typescript
import { _createResourceV2 } from "@/query-v2/api/_createResourceV2";
import { shallowEqual } from "@/common/utils/shallowEqual";

interface UserArgs {
    id: number;
    role: string;
}

interface UserData {
    name: string;
    email: string;
}

const userResource = _createResourceV2<UserArgs, UserData>({
    key: "users",
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}?role=${args.role}`, { signal: abortSignal });
        return res.json();
    },
    compareArg: shallowEqual, // triggers compare strategy → CompareCacheMap
});
```

### Same reference → cache hit (O(1))

```typescript
const args = { id: 1, role: "admin" };

// First call — cache miss, factory invoked, entry created
const entry1 = userResource.getEntry(args, true);
// Map.get(args) → undefined → factory(args, "0") → Map.set(args, entry)

// Second call with SAME reference — cache hit, O(1)
const entry2 = userResource.getEntry(args, true);
// Map.get(args) → entry ✅

console.assert(entry1 === entry2); // true — same entry returned
```

### New reference with same structure → cache miss

```typescript
const args1 = { id: 1, role: "admin" };
const args2 = { id: 1, role: "admin" }; // structurally equal, different reference

const entry1 = userResource.getEntry(args1, true);
const entry2 = userResource.getEntry(args2, true);
// Map.get(args2) → undefined (args1 !== args2) → factory invoked → NEW entry

console.assert(entry1 !== entry2); // true — separate entries!
```

This is an intentional semantic change from the current `Array.find(shallowEqual)` behavior. Callers must ensure reference stability for cache hits [ref: 01-architecture.md#4.1].

### React integration — stable references via hook deps

```tsx
import { useResourceV2Agent } from "@/query-v2/react/useResourceV2Agent";

function UserProfile({ userId }: { userId: number }) {
    // useResourceV2Agent accepts args directly — args reference changes on each render
    // unless userId itself changes, React.useEffect deps ensure agent.start is called
    // with the same logical args
    const state = userResource.useResourceV2Agent({ id: userId, role: "admin" });

    // In useResourceV2Agent implementation:
    // React.useEffect(() => { agent.start(...args); }, args);
    // The agent uses compareArgs (shallowEqual) to skip redundant starts.
    // The CacheMap lookup still uses reference identity —
    // agent.start calls resource.getEntry$(args, true) with the args object from useEffect.

    if (state.isInitialLoading) return <div>Loading...</div>;
    if (state.data) return <div>{state.data.name}</div>;
    return null;
}
```

The `ResourceV2Agent` bridges the reference-identity gap: it receives args from `useEffect`, calls `resource.getEntry$` with them. If args haven't changed by `shallowEqual`, the agent skips the call. When it does call, the same args object reference is reused within the agent's lifecycle, producing a cache hit on subsequent reads [ref: ../01-research/01-codebase-analysis.md#Area A].

---

## UC2: Custom devtoolsKey for Compare Strategy

### Story

A developer wants meaningful Redux DevTools keys for their compare-strategy resource instead of monotonic counter values. They provide a `devtoolsKey` function that extracts a human-readable key from args [ref: ../01-research/05-open-questions.md#Q3].

### Default behavior: monotonic counter

```typescript
const listResource = _createResourceV2<{ page: number }, PageData>({
    key: "pages",
    queryFn: fetchPage,
    compareArg: shallowEqual,
    // no devtoolsKey provided → default monotonic counter
});

const page1Args = { page: 1 };
const page2Args = { page: 2 };

listResource.getEntry(page1Args, true);
// CompareCacheMap: argsKey = String(0) → "0"
// Entry keyParts: ["Resource/", "pages/", "0"]
// Redux DevTools Signal key: "Resource/:pages/:0"

listResource.getEntry(page2Args, true);
// CompareCacheMap: argsKey = String(1) → "1"
// Redux DevTools Signal key: "Resource/:pages/:1"
```

Counter properties:
- Starts at 0 per `CompareCacheMap` instance
- Increments only on cache miss (new entries)
- Never reuses values after deletion — if entry "0" is deleted and a new entry created, it gets counter value "2" (or next) [ref: 02-dataflow.md#1.1]

### Custom devtoolsKey

```typescript
const userResource = _createResourceV2<{ id: number; role: string }, UserData>({
    key: "users",
    queryFn: fetchUser,
    compareArg: shallowEqual,
    devtoolsKey: (args) => `${args.id}-${args.role}`,
});

const adminArgs = { id: 42, role: "admin" };
userResource.getEntry(adminArgs, true);
// CompareCacheMap: argsKey = devtoolsKey(args) → "42-admin"
// Entry keyParts: ["Resource/", "users/", "42-admin"]
// Redux DevTools Signal key: "Resource/:users/:42-admin"
```

### DevTools appearance

In Redux DevTools, the signal state tree shows entries organized by their `keyParts.join(":")`:

```
State
├── Resource/:users/:42-admin     ← custom devtoolsKey
│   └── { status: "success", data: { name: "Alice", ... } }
├── Resource/:users/:7-viewer     ← custom devtoolsKey
│   └── { status: "pending", ... }
└── Resource/:pages/:0            ← monotonic counter (no devtoolsKey)
    └── { status: "success", data: { items: [...] } }
```

### devtoolsKey for serialize strategy — ignored

```typescript
const serializedResource = _createResourceV2<{ id: number }, UserData>({
    key: "users-s",
    queryFn: fetchUser,
    // no compareArg → serialize strategy
    devtoolsKey: (args) => `user-${args.id}`, // IGNORED — serialize strategy uses serialized key
});

serializedResource.getEntry({ id: 1 }, true);
// SerializeCacheMap: key = stableStringify({id: 1}) → '{"id":1}'
// argsKey passed to factory = '{"id":1}' (the serialized key, not devtoolsKey)
// Redux DevTools: "Resource/:users-s/:{"id":1}"
```

The `devtoolsKey` option applies only to compare strategy. For serialize strategy, the serialized key is always used as `argsKey` [ref: 04-decisions.md#ADR-3].

---

## UC3: Serialize Strategy — No Double Serialization

### Story

This use case verifies the internal optimization where `SerializeCacheMap` passes its already-computed serialized key to the factory, eliminating the redundant second serialization call [ref: ../01-research/03-problem-analysis-devtools.md#Problem #4].

### Current flow (problem): two serialization calls

```typescript
// CURRENT: ResourceV2 constructor (ResourceV2.ts:47-51)
const serializeFn = options.serializeArgs ?? stableStringify;
factory: (args) => this._entryFactory(args, serializeFn(args))
//                                          ^^^^^^^^^^^^^^^^^ call #2

// CURRENT: SerializeCacheMap.getOrCreate (SerializeCacheMap.ts:34-40)
getOrCreate(args: TArgs): TEntry {
    const key = this._getKey(args);  // calls serializeArgs(args) — call #1
    let entry = this._map.get(key);
    if (!entry) {
        entry = this._factory(args);  // factory internally calls serializeFn(args) — call #2
        // stableStringify invoked TWICE with same args, producing identical string
        this._map.set(key, entry);
    }
    return entry;
}
```

### Proposed flow: single serialization call

```typescript
// PROPOSED: ResourceV2 constructor
factory: (args, argsKey) => this._entryFactory(args, argsKey)
//                argsKey received from CacheMap — passthrough, no serialization

// PROPOSED: SerializeCacheMap.getOrCreate
getOrCreate(args: TArgs): TEntry {
    const key = this._getKey(args);  // calls serializeArgs(args) — ONLY serialization call
    let entry = this._map.get(key);
    if (!entry) {
        entry = this._factory(args, key);  // key passed directly — no second serialization
        this._map.set(key, entry);
    }
    return entry;
}
```

### Verification trace

For a resource `createResourceV2<{id: number}, UserData>({ key: "users", queryFn: fetchUser })`:

1. `userResource.getEntry({ id: 1 }, true)` → calls `cache.getOrCreate({ id: 1 })`
2. `SerializeCacheMap._getKey({ id: 1 })` → `stableStringify({ id: 1 })` → `'{"id":1}'` — **serialization call #1 (only)**
3. `Map.get('{"id":1}')` → `undefined` (cache miss)
4. `factory({ id: 1 }, '{"id":1}')` → `this._entryFactory({ id: 1 }, '{"id":1}')` — **argsKey received, not computed**
5. `keyParts = ["Resource/", "users/", '{"id":1}']`
6. `CacheEntry` → `Signal.state(init, { key: 'Resource/:users/:{"id":1}' })`
7. `Map.set('{"id":1}', entry)`

Total `stableStringify` calls: **1** (was 2 in current implementation).

With `doCacheArgs: true`, step 2 may return from WeakMap cache instead of calling `stableStringify`, but either way only one serialization path is exercised per `getOrCreate` call [ref: 02-dataflow.md#1.2].

---

## UC4: Per-Entry LifecycleHooks

### Story

A developer uses `onCacheEntryAdded` and `onQueryStarted` callbacks. Each `ResourceV2CacheEntry` owns its resolver state. Concurrent entries with the same logical args (but different references) do not interfere with each other's `$queryFulfilled` promises [ref: ../01-research/05-open-questions.md#Q4].

### Basic onQueryStarted

```typescript
const userResource = _createResourceV2<{ id: number }, UserData>({
    key: "users",
    queryFn: async (args) => {
        const res = await fetch(`/api/users/${args.id}`);
        return res.json();
    },
    onQueryStarted: async (args, { $queryFulfilled, getCacheEntry }) => {
        console.log(`Query started for user ${args.id}`);

        try {
            const { data } = await $queryFulfilled;
            console.log(`Query fulfilled: ${data.name}`);
        } catch (err) {
            console.log(`Query failed: ${err}`);
        }
    },
});
```

**Proposed internal flow** (per-entry, no shared Map):

1. `resource.getEntry({ id: 1 }, true)` → `cache.getOrCreate(args)` → factory → `new ResourceV2CacheEntry({...})`
2. Entry constructor calls `_fireCacheEntryAdded()` (if `onCacheEntryAdded` defined)
3. Entry constructor calls `_doFetch()` (no `initialMachine`)
4. Inside `_doFetch()`:
   - Creates `_queryFulfilled = new PromiseResolver<{data}>()`
   - Calls `onQueryStarted(args, { $queryFulfilled: _queryFulfilled.promise, getCacheEntry: () => this })`
   - User callback begins awaiting `$queryFulfilled`
5. `queryFn` resolves → `_queryFulfilled.resolve({ data })` → user callback's `await` completes

### Basic onCacheEntryAdded

```typescript
const userResource = _createResourceV2<{ id: number }, UserData>({
    key: "users",
    queryFn: fetchUser,
    onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        console.log(`Cache entry created for user ${args.id}`);

        try {
            const data = await $cacheDataLoaded;
            console.log(`First data loaded: ${data.name}`);
        } catch {
            console.log("Entry removed before data loaded");
            return; // entry was removed — no point continuing
        }

        // Set up long-lived subscription (e.g., WebSocket)
        const ws = new WebSocket(`/ws/users/${args.id}`);
        ws.onmessage = (e) => { /* update cache entry */ };

        await $cacheEntryRemoved;
        ws.close(); // cleanup when entry is removed
        console.log(`Cache entry removed for user ${args.id}`);
    },
});
```

**Proposed internal flow**:

1. Entry constructor calls `_fireCacheEntryAdded()`:
   - Creates `_entryDataLoaded = new PromiseResolver<TData>()`
   - Creates `_entryRemoved = new PromiseResolver<void>()`
   - Calls `onCacheEntryAdded(args, { $cacheDataLoaded: _entryDataLoaded.promise, $cacheEntryRemoved: _entryRemoved.promise })`
2. First successful `_doFetch` → `_entryDataLoaded.resolve(data)` → `$cacheDataLoaded` fulfills
3. Entry's `complete()` (from `resetCache()` or GC) → `_entryRemoved.resolve()` → `$cacheEntryRemoved` fulfills

### Concurrent entries — promise isolation

The critical fix: two entries for the same logical args (different references in compare strategy) have independent `$queryFulfilled` resolvers.

```typescript
const resource = _createResourceV2<{ id: number }, UserData>({
    key: "users",
    queryFn: async (args) => {
        await new Promise(r => setTimeout(r, 1000));
        return { name: `User ${args.id}`, email: `user${args.id}@example.com` };
    },
    compareArg: shallowEqual,
    onQueryStarted: async (args, { $queryFulfilled }) => {
        try {
            const { data } = await $queryFulfilled;
            console.log(`[Entry for args ref] Fulfilled: ${data.name}`);
        } catch (err) {
            console.log(`[Entry for args ref] Rejected: ${err}`);
        }
    },
});

// Two different args references → two separate entries in CompareCacheMap
const argsRef1 = { id: 1 };
const argsRef2 = { id: 1 }; // structurally equal, different reference

resource.getEntry(argsRef1, true); // Entry A — own _queryFulfilled resolver
resource.getEntry(argsRef2, true); // Entry B — own _queryFulfilled resolver

// CURRENT PROBLEM (shared LifecycleHooks with Map<TArgs, Resolvers>):
// fireQueryStarted(argsRef1, ...) → Map.set(argsRef1, resolversA)
// fireQueryStarted(argsRef2, ...) → Map.set(argsRef2, resolversB)
// With ===, argsRef1 !== argsRef2 → separate Map entries (works only by luck of reference)
// But for void-args resources: Map.set(undefined, resolversA) then Map.set(undefined, resolversB)
// → resolversA overwritten! Promise leak.

// PROPOSED (per-entry):
// Entry A has its own _queryFulfilled resolver — created in Entry A._doFetch()
// Entry B has its own _queryFulfilled resolver — created in Entry B._doFetch()
// No shared Map. No interference. Both $queryFulfilled promises resolve independently.
```

### Refetch — old promise explicitly rejected

```typescript
const resource = _createResourceV2<void, ItemData>({
    key: "items",
    queryFn: fetchItems,
    onQueryStarted: async (_args, { $queryFulfilled }) => {
        try {
            const { data } = await $queryFulfilled;
            console.log("Success:", data);
        } catch (err) {
            console.log("Rejected:", err); // "Query superseded" on refetch
        }
    },
});

// First fetch starts → onQueryStarted callback #1 awaits $queryFulfilled
resource.getEntry(undefined, true);

// Invalidate triggers refetch:
resource.invalidate();
// Inside _doFetch():
// 1. Old _queryFulfilled.reject(new Error("Query superseded"))
//    → callback #1's await rejects with "Query superseded"
// 2. New _queryFulfilled = new PromiseResolver()
// 3. onQueryStarted called again → callback #2 awaits new $queryFulfilled
```

This prevents the silent promise leak from the current `LifecycleHooks._queryResolvers.set()` overwrite [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5].

---

## UC5: Demo isError — Corrected UI

### Story

Demo examples display `isError: false` at all times because SWR semantics keep `isError` false once the first fetch succeeds. The fix corrects misleading descriptions and unreachable UI elements without changing queryFn logic [ref: ../01-research/05-open-questions.md#Q8]. User feedback: "Исправить ложное описание и поведение UI (логику менять не нужно)."

### error-swr-states.tsx — Primary fix target

**Current problems**:
- Title "Ошибки и SWR-состояния" implies `isError: true` is demonstrated — it is not [ref: ../01-research/01-codebase-analysis.md#Area D]
- `isError` badge always shows `false`
- Error banner `{state.isError && (...)}` never renders — dead code
- Item styling `{state.isError ? 'bg-warning-50...' : 'bg-default-100'}` always takes the else branch

**Proposed changes**:

| Element | Current | Proposed |
|---------|---------|----------|
| Card title | `⚠️ Ошибки и SWR-состояния (Query v2)` | `⚠️ SWR-восстановление после ошибки (Query v2)` |
| `isError` badge | `isError: {String(state.isError)}` | `isRefreshError: {String(state.isRefreshError)}` |
| Error banner condition | `{state.isError && (...)}` (never renders) | `{state.isRefreshError && (...)}` with text explaining stale data is preserved |
| Error banner text | `❌ Ошибка: {String(state.error)}` | `⚠️ Ошибка при обновлении: {String(state.error)}` + `Данные сохранены (SWR-семантика)` |
| Item styling condition | `state.isError` | `state.isRefreshError` |
| Bottom description | `Каждый чётный запрос возвращает ошибку. Нажмите кнопку для повторной попытки.` | `Каждый чётный запрос возвращает ошибку. При ошибке во время обновления данные сохраняются (stale-while-revalidate). isError остаётся false, используйте isRefreshError.` |

Key React code changes:

```tsx
// BEFORE:
<span className={`... ${state.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
    isError: {String(state.isError)}
</span>

// AFTER:
<span className={`... ${state.isRefreshError ? 'bg-warning-100 text-warning-700' : 'bg-default-100 text-default-400'}`}>
    isRefreshError: {String(state.isRefreshError)}
</span>
```

```tsx
// BEFORE:
{state.isError && (
    <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg">
        <p className="text-danger font-semibold">❌ Ошибка: {String(state.error)}</p>
        ...
    </div>
)}

// AFTER:
{state.isRefreshError && (
    <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg">
        <p className="text-warning-700 font-semibold">
            ⚠️ Ошибка при обновлении: {String(state.error)}
        </p>
        <p className="text-xs text-warning-500 mt-1">
            Данные сохранены благодаря SWR-семантике. isError: false, isRefreshError: true.
        </p>
    </div>
)}
```

### lifecycle-hooks.tsx

**Current problems**:
- `isError` badge with conditional danger styling — rarely triggers
- Error banner `{state.isError && (...)}` — rarely renders (only after specific `resetAll` + `queryCount` sequences)

**Proposed changes**:

| Element | Current | Proposed |
|---------|---------|----------|
| `isError` badge | `isError: {String(state.isError)}` | Remove or replace with `isRefreshError: {String(state.isRefreshError)}` |
| Error banner | `{state.isError && (...)}` | `{state.isRefreshError && (...)}` with softened messaging: `⚠️ Ошибка при обновлении (данные сохранены)` |
| Bottom description | (unchanged) | Add note: `isError = true только если первый запрос завершился ошибкой. После успешной загрузки ошибки обновления показываются через isRefreshError.` |

### basic-query.tsx

**Current problem**: Displays `isError: {String(state.isError)}` badge — always `false` since `queryFn` never throws.

**Proposed change**: Remove the `isError` badge entirely. This demo demonstrates a basic successful query — showing `isError` for a never-failing queryFn is misleading. The `isLoading`, `isSuccess`, and `status` badges are sufficient.

```tsx
// REMOVE this block from the status indicators:
<span className={`px-2 py-1 rounded text-xs font-mono ${state.isError ? 'bg-danger-100 text-danger-700' : 'bg-default-100 text-default-400'}`}>
    isError: {String(state.isError)}
</span>
```

### optimistic-patches.tsx

**Current problem**: Early return `if (state.isError) { return <Card>...</Card>; }` — unreachable since `queryFn` never throws.

**Proposed change**: Remove the unreachable early return block:

```tsx
// REMOVE this block:
if (state.isError) {
    return (
        <Card className="max-w-4xl">
            <CardBody className="text-center py-8 text-danger">
                ❌ Ошибка: {state.error?.toString()}
            </CardBody>
        </Card>
    );
}
```

### ssr-snapshot.tsx

**Current problem**: `{state.isError && (<p>❌ Ошибка загрузки</p>)}` inside `UserCard` — unreachable since `queryFn` always resolves.

**Proposed change**: Remove the unreachable error block from `UserCard`:

```tsx
// REMOVE from UserCard:
{state.isError && (
    <p className="text-danger">❌ Ошибка загрузки</p>
)}
```

### Summary of changes per demo file

| File | Changes | Lines affected (approx.) |
|------|---------|------------------------|
| `error-swr-states.tsx` | Replace `isError` → `isRefreshError`, fix title, fix error banner, update description | ~15 lines |
| `lifecycle-hooks.tsx` | Replace `isError` → `isRefreshError` in badge and banner, add description note | ~8 lines |
| `basic-query.tsx` | Remove `isError` badge | ~3 lines (delete) |
| `optimistic-patches.tsx` | Remove unreachable `if (state.isError)` early return | ~6 lines (delete) |
| `ssr-snapshot.tsx` | Remove unreachable `{state.isError && (...)}` in `UserCard` | ~3 lines (delete) |

Files **not changed**: `simple-resource.tsx` (no `isError` display), `skip-token.tsx` (no `isError` display), `snapshot-hydration.tsx` (no `isError` display).

---

## Edge Cases

### EC1: CompareCacheMap with `void` args (single-entry resource)

`void`-args resources pass `undefined` as `TArgs`. `Map<TArgs, TEntry>` supports `undefined` as a key.

```typescript
const singleResource = _createResourceV2<void, AppConfig>({
    key: "config",
    queryFn: fetchConfig,
    compareArg: shallowEqual, // compare strategy with void args
});

// First call: Map.get(undefined) → undefined → factory(undefined, "0") → Map.set(undefined, entry)
singleResource.getEntry(undefined, true); // entry created

// Second call: Map.get(undefined) → entry ✅ (same undefined reference)
singleResource.getEntry(undefined, true); // cache hit

// All void-args calls share the same Map key (undefined === undefined)
// → single entry, no duplication. This is correct behavior.
```

**Contrast with current problem**: The current `Array.find(shallowEqual)` also works for void args but at O(n) cost. The new `Map.get(undefined)` is O(1).

**LifecycleHooks improvement**: Current shared `LifecycleHooks` uses `Map<TArgs, Resolvers>`. For void args, `Map.set(undefined, resolversA)` then `Map.set(undefined, resolversB)` overwrites resolversA. With per-entry ownership, each entry (there's only one for void args) has its own resolver — no collision [ref: ../01-research/04-problem-analysis-lifecycle-demos.md#Problem #5].

### EC2: CompareCacheMap with primitive args (`string`, `number`)

`Map` supports primitives as keys. Primitives with the same value are `===` equal.

```typescript
const pageResource = _createResourceV2<number, PageData>({
    key: "pages",
    queryFn: (page) => fetchPage(page),
    compareArg: (a, b) => a === b, // compare strategy with number args
});

// Primitives: 1 === 1 → always true regardless of "reference"
pageResource.getEntry(1, true);  // cache miss → factory → entry
pageResource.getEntry(1, true);  // cache HIT — Map.get(1) → entry ✅

// Different values
pageResource.getEntry(2, true);  // cache miss → new entry
```

```typescript
const slugResource = _createResourceV2<string, ArticleData>({
    key: "articles",
    queryFn: (slug) => fetchArticle(slug),
    compareArg: (a, b) => a === b,
});

slugResource.getEntry("hello-world", true);  // cache miss
slugResource.getEntry("hello-world", true);  // cache HIT — "hello-world" === "hello-world" ✅
```

Primitive args with compare strategy gain the most from the Map change: current `Array.find(compareArg)` scans O(n), but `Map.get(primitiveValue)` is O(1) and structurally equal primitives are always reference-equal.

**Note**: `WeakMap` cannot accept primitives as keys — this is why ADR-1 chose `Map` over `WeakMap` [ref: 04-decisions.md#ADR-1].

### EC3: LifecycleHooks cleanup on `resetCache()`

When `ResourceV2.resetCache()` is called, each entry's `complete()` settles its own lifecycle resolvers. No shared `clearAll()` needed [ref: 02-dataflow.md#2.2].

```typescript
const resource = _createResourceV2<void, ItemData>({
    key: "items",
    queryFn: fetchItems,
    onCacheEntryAdded: async (_args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        const ws = new WebSocket("/ws/items");

        try {
            await $cacheDataLoaded;
            console.log("Data loaded — WebSocket active");
        } catch {
            console.log("Entry removed before data loaded");
            ws.close();
            return;
        }

        await $cacheEntryRemoved;
        ws.close();
        console.log("Entry removed — WebSocket closed");
    },
    onQueryStarted: async (_args, { $queryFulfilled }) => {
        try {
            await $queryFulfilled;
        } catch (err) {
            console.log("Query rejected:", err);
        }
    },
});

// Entry created, fetch starts
resource.getEntry(undefined, true);
// → onCacheEntryAdded fires, WebSocket opened
// → onQueryStarted fires, awaiting $queryFulfilled
// → queryFn succeeds → $queryFulfilled resolves, $cacheDataLoaded resolves

// Later: resetCache()
resource.resetCache();
// For each entry, entry.complete() is called:
// 1. Abort inflight fetch (if any)
// 2. _entryDataLoaded: already resolved → null (no-op)
// 3. _entryRemoved.resolve() → $cacheEntryRemoved fulfills → WebSocket closed
// 4. _queryFulfilled: already resolved → null (no-op)
// 5. super.complete() → fires onClean$ → cache.delete(args)
```

**Scenario: resetCache() while fetch is inflight**:

```typescript
// Entry created, fetch starts (takes 2 seconds)
resource.getEntry(undefined, true);
// → onCacheEntryAdded fires → awaiting $cacheDataLoaded
// → onQueryStarted fires → awaiting $queryFulfilled

// resetCache() before fetch completes:
resource.resetCache();
// entry.complete():
// 1. Abort controller aborted → queryFn fetch cancelled
// 2. _entryDataLoaded.reject("Cache entry removed before data loaded")
//    → onCacheEntryAdded catch block fires → WebSocket closed
// 3. _entryRemoved.resolve() → $cacheEntryRemoved fulfills (but callback already returned)
// 4. _queryFulfilled.reject("Cache entry removed")
//    → onQueryStarted catch block fires: "Query rejected: Cache entry removed"
// All promises settled. No leaks.
```

### EC4: LifecycleHooks with hydrated entries (Snapshot system)

`ResourceV2.hydrateEntry()` creates entries with an `initialMachine` (typically `MachineSuccess`). The entry constructor skips `_doFetch()` when `initialMachine` is provided. Lifecycle hooks still fire for hydrated entries [ref: 01-architecture.md#5.7].

```typescript
// Snapshot hydration (called by createApi during initialization):
resource.hydrateEntry(
    { id: 1 },
    new MachineSuccess({ id: 1 }, { name: "Alice" }, null, Date.now())
);
```

**Internal flow for hydrated entry**:

1. `hydrateEntry` sets `_pendingInitialMachine = machine`
2. `cache.getOrCreate(args)` → factory → `new ResourceV2CacheEntry({ ..., initialMachine: MachineSuccess })`
3. Entry constructor:
   - `super(MachineSuccess)` — entry starts in success state (no pending)
   - `_fireCacheEntryAdded()` fires (if callback defined):
     - `_entryDataLoaded = new PromiseResolver()`
     - `_entryRemoved = new PromiseResolver()`
     - `onCacheEntryAdded(args, { $cacheDataLoaded, $cacheEntryRemoved })` invoked
   - `initialMachine` is defined → `_doFetch()` is **not called**
   - Therefore `onQueryStarted` is **not fired** immediately

4. Since the entry is already in `MachineSuccess`:
   - `$cacheDataLoaded` needs to resolve. But `_entryDataLoaded.resolve(data)` is only called in `_doFetch` success path.
   - **For hydrated entries**: the `_fireCacheEntryAdded` method should detect `initialMachine` is `MachineSuccess` and resolve `_entryDataLoaded` immediately with `initialMachine.data` [ref: 03-model.md#4.3].

```typescript
// Inside _fireCacheEntryAdded (proposed addition for hydration):
private _fireCacheEntryAdded(): void {
    if (!this._onCacheEntryAdded) return;

    this._entryDataLoaded = new PromiseResolver<TData>();
    this._entryRemoved = new PromiseResolver<void>();

    const tools: ICacheEntryAddedTools<TData> = {
        $cacheDataLoaded: this._entryDataLoaded.promise,
        $cacheEntryRemoved: this._entryRemoved.promise,
    };

    try {
        this._onCacheEntryAdded(this._args, tools);
    } catch { /* swallow */ }

    // Resolve immediately if entry starts with data (hydration)
    const machine = this.peek();
    if (machine.status === "success" && this._entryDataLoaded) {
        this._entryDataLoaded.resolve(machine.data);
        this._entryDataLoaded = null;
    }
}
```

**User callback experience for hydrated entry**:

```typescript
onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
    // $cacheDataLoaded resolves immediately for hydrated entries
    const data = await $cacheDataLoaded; // resolves synchronously (microtask)
    console.log(`Hydrated data: ${data.name}`);

    const ws = new WebSocket(`/ws/users/${args.id}`);

    await $cacheEntryRemoved;
    ws.close();
},
```

**When invalidated after hydration**:

```typescript
// Entry was hydrated (MachineSuccess), no fetch occurred
resource.invalidate({ id: 1 });
// → entry.invalidate() → _doFetch()
// → _doFetch fires onQueryStarted (first time for this entry)
// → queryFn called, new data returned
// → _entryDataLoaded already resolved (from hydration) → no-op on success
// → _queryFulfilled resolves with new data
```
