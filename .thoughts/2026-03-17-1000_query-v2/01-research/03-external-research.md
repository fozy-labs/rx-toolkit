---
title: "External Research: Query/Data-Fetching Patterns, Caching, State Machines, Plugins, and SSR"
date: 2026-03-17
stage: 01-research
role: rdpi-external-researcher
---

# External Research: Query v2 — Patterns and Libraries

## Comparative Analysis

| Library / Pattern | Approach | Pros | Cons | Confidence |
|---|---|---|---|---|
| RTK Query | Redux middleware + `createApi` endpoint builder pattern, normalized Redux state slice | Strong TS inference, auto-generated hooks, Immer-based optimistic updates with inverse patches, built-in SSR via `extractRehydrationInfo` | Coupled to Redux, heavy dependency tree, no built-in class-based state machines, SSR requires `next-redux-wrapper` or custom setup | **High** |
| TanStack Query (v5) | Standalone `QueryClient` + `QueryCache` + `QueryObserver` pattern, framework-agnostic core | Excellent cache lifecycle (`staleTime` / `gcTime`), `dehydrate`/`hydrate` SSR, observer pattern decouples cache from UI, framework adapters | No formal plugin system (uses callbacks on QueryCache/MutationCache), no built-in optimistic patch/rollback mechanism (manual via `onMutate`), cache keys are array-based (harder to serialize for SSR snapshots) | **High** |
| XState | Actor model + finite state machines, `createMachine` with `setup()` for typed implementations | Rigorous state modeling, prevents invalid transitions, strong TS typing via `setup()`, serializable state for devtools/snapshots | Heavyweight for simple fetch states, learning curve, class-based machine approach not directly supported (XState uses config objects), integrating with external caches requires custom wiring | **High** |
| Custom class-based machines (as in RFC) | Class instances represent states, methods return next machine | Lightweight, no dependency, easy serialization via class name, natural TS discrimination, methods enforce valid transitions | No ecosystem tooling (no visual debugger), must be carefully implemented to cover all edge cases, less discoverable than config-based | **Medium** |

---

## 1. RTK Query

### 1.1 `createApi` Pattern

**Source**: [RTK Query — createApi docs](https://redux-toolkit.js.org/rtk-query/api/createApi)

RTK Query's `createApi` is a single factory function that defines an entire API slice. Configuration:

```ts
const api = createApi({
  reducerPath: 'api', // unique key in Redux store
  baseQuery: fetchBaseQuery({ baseUrl: '/' }),
  tagTypes: ['Post', 'User'],
  endpoints: (build) => ({
    getPost: build.query<Post, number>({
      query: (id) => `post/${id}`,
      providesTags: (result, error, id) => [{ type: 'Post', id }],
    }),
    updatePost: build.mutation<Post, Partial<Post> & Pick<Post, 'id'>>({
      query: ({ id, ...body }) => ({ url: `post/${id}`, method: 'PATCH', body }),
      invalidatesTags: (result, error, { id }) => [{ type: 'Post', id }],
    }),
  }),
  keepUnusedDataFor: 60, // seconds
  serializeQueryArgs: defaultSerializeQueryArgs,
});
```

**Type flow**: The `build.query<ResultType, QueryArg>()` generic parameters propagate through generated hooks (`useGetPostQuery`) and auto-typed selectors. The endpoint name becomes the hook suffix (`getPost` → `useGetPostQuery`).

**Relevance for RFC**: The RFC's `createApi` + `api.createResource` is a two-step pattern (create API, then create resources separately), which avoids RTK Query's monolithic builder. In RTK Query the endpoints are defined inline, which makes code splitting harder (solved via `injectEndpoints`). The RFC's approach of separate `createResource` calls is more modular by default.

**Confidence**: **High** — well-documented official API, verified against docs.

### 1.2 Cache Key Strategy

**Source**: [RTK Query — Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior), [createApi — serializeQueryArgs](https://redux-toolkit.js.org/rtk-query/api/createApi)

Cache key construction:
1. Default: `endpointName + '(' + stableStringify(queryArgs) + ')'` — the `defaultSerializeQueryArgs` function sorts object keys, stringifies, and concatenates with endpoint name.
2. Per-endpoint `serializeQueryArgs` can return a string (used directly as cache key) or an object/number/boolean (re-serialized via `defaultSerializeQueryArgs`).
3. Cache keys are stored as `queryCacheKey` strings in the Redux state slice.

Cache entry lifecycle:
- Data is kept as long as at least one active subscriber exists (reference counting).
- When subscriber count reaches zero, a `keepUnusedDataFor` timer starts (default 60 seconds).
- After the timer expires with no new subscribers, the cached data is removed.
- `keepUnusedDataFor` can be set at API level or per-endpoint (endpoint overrides API).

**Relevance for RFC**: The RFC's `serialize` strategy aligns closely with RTK Query's approach (serialize args to string key). The RFC's `compare` strategy (structural comparison using `shallowEqual`) has no direct equivalent in RTK Query — it's closer to TanStack Query's key hashing. The RFC's `cacheLifetime` (in milliseconds) is analogous to `keepUnusedDataFor` (in seconds).

**Confidence**: **High** — directly from official documentation.

### 1.3 Lifecycle Hooks

**Source**: [RTK Query — createApi endpoint definition](https://redux-toolkit.js.org/rtk-query/api/createApi)

#### `onQueryStarted`
```ts
async onQueryStarted(arg, { dispatch, getState, queryFulfilled, getCacheEntry, updateCachedData }) {
  // Fires when query/mutation is initiated
  try {
    const { data } = await queryFulfilled;
    // onSuccess
  } catch (err) {
    // onError
  }
}
```
- Available for both queries and mutations.
- `queryFulfilled` is a Promise that resolves with `{ data, meta }` or rejects with the error.
- `updateCachedData` (queries only) uses Immer for immutable updates.
- Primary use cases: side-effects on success/failure, optimistic updates.

#### `onCacheEntryAdded`
```ts
async onCacheEntryAdded(arg, { cacheDataLoaded, cacheEntryRemoved, getCacheEntry, updateCachedData }) {
  // Fires when a new cache entry is created (first subscriber)
  try {
    await cacheDataLoaded; // Wait for first data to be available
    // Set up WebSocket or other streaming connection
  } catch {
    // cacheDataLoaded can reject if entry is removed before data loads
  }
  await cacheEntryRemoved; // Wait for cleanup
  // Cleanup connections
}
```
- `cacheDataLoaded` promise rejects with `'Promise never resolved before cacheEntryRemoved.'` if the entry is removed before any data arrives — this prevents memory leaks.
- `cacheEntryRemoved` promise resolves when the cache entry is finally removed.
- Primary use case: streaming updates (WebSocket subscriptions).

**Race condition handling**: The `cacheDataLoaded` / `cacheEntryRemoved` promise pair is designed to avoid leaks. If the entry is cleaned up before data arrives, `cacheDataLoaded` rejects, and the catch block should clean up any resources.

**Relevance for RFC**: The RFC specifies both `onCacheEntryAdded` and `onQueryStarted` hooks. RTK Query's API surface is well-established and can serve as a model. The `cacheDataLoaded` / `cacheEntryRemoved` promise pattern is particularly elegant for lifecycle management.

**Confidence**: **High** — directly from official documentation and code examples.

### 1.4 Plugin/Middleware Architecture

**Source**: [RTK Query — createApi](https://redux-toolkit.js.org/rtk-query/api/createApi), [RTK Query — Customizing createApi](https://redux-toolkit.js.org/rtk-query/usage/customizing-create-api)

RTK Query's extensibility is built on:
1. **Redux middleware**: The generated `api.middleware` handles cache invalidation timers, polling, and lifecycle callbacks.
2. **`buildCreateApi` function**: Allows building a custom `createApi` from modules (`coreModule()`, `reactHooksModule()`).
   ```ts
   import { buildCreateApi, coreModule, reactHooksModule } from '@reduxjs/toolkit/query/react';
   const createApi = buildCreateApi(coreModule(), reactHooksModule({ unstable__sideEffectsInRender: true }));
   ```
3. **`injectEndpoints`**: Allows code splitting by adding endpoints to an existing API slice.

This is a **module-based** plugin system, not a runtime plugin system. The modules are composed at build time to produce a specific version of `createApi`.

**Relevance for RFC**: The RFC's plugin system (e.g., `ReactHooksPlugin` adding `useResource` to resources) is more flexible than RTK Query's approach. RTK Query hard-codes the React hooks module, while the RFC wants plugins to dynamically modify the resource type. This is a fundamentally different design decision.

**Confidence**: **High** — documented API.

### 1.5 SSR Support

**Source**: [RTK Query — Server Side Rendering](https://redux-toolkit.js.org/rtk-query/usage/server-side-rendering)

RTK Query SSR workflow:
1. In `getStaticProps` / `getServerSideProps`: dispatch `api.endpoints.X.initiate(args)` for each query.
2. Wait for all queries: `await Promise.all(dispatch(api.util.getRunningQueriesThunk()))`.
3. In `createApi`, configure `extractRehydrationInfo` to intercept the `HYDRATE` action from `next-redux-wrapper` and merge the server state into the client cache.

```ts
extractRehydrationInfo(action, { reducerPath }) {
  if (isHydrateAction(action)) {
    return action.payload[reducerPath];
  }
}
```

No built-in snapshot versioning or age-based staleness checking on hydration. Staleness is handled via `refetchOnMountOrArgChange` (set to a number of seconds for SSG scenarios).

**Tip from docs**: Call `store.dispatch(api.util.resetApiState())` after sending the response to avoid rogue timers and memory leaks.

**Relevance for RFC**: The RFC's `initialSnapshot` / `getSnapshot()` + `maxSnapshotDataAge` approach is more explicit and self-contained than RTK Query's Redux-coupled `extractRehydrationInfo`. The RFC's approach doesn't require Redux or `next-redux-wrapper`.

**Confidence**: **High** — official documentation.

### 1.6 Optimistic Updates / Patch Mechanism

**Source**: [RTK Query — Manual Cache Updates](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates)

RTK Query uses Immer-based patching via `api.util.updateQueryData`:

```ts
async onQueryStarted({ id, ...patch }, { dispatch, queryFulfilled }) {
  const patchResult = dispatch(
    api.util.updateQueryData('getPost', id, (draft) => {
      Object.assign(draft, patch);
    })
  );
  try {
    await queryFulfilled;
  } catch {
    patchResult.undo(); // Rolls back via inverse patches
  }
}
```

Key details:
- `updateQueryData` returns `{ patches, inversePatches, undo() }`.
- `undo()` dispatches the inverse patches to revert the optimistic update.
- **Race condition warning**: With overlapping mutations, rolling back via `undo()` can cause issues. The docs recommend invalidating tags on error instead of rolling back in high-concurrency scenarios.
- `upsertQueryData` creates or replaces entire cache entries (no patching, no inverse patches).

**Relevance for RFC**: The RFC's patch mechanism is more sophisticated — it maintains an ordered queue of patches with statuses (pending/committed/aborted) and uses `originalData` to protect against race conditions. RTK Query's Immer-based approach is simpler but less robust under concurrent mutations.

**Confidence**: **High** — official docs with code examples.

---

## 2. TanStack Query (v5)

### 2.1 Query Key Serialization and Comparison

**Source**: [TanStack Query — Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)

Query keys in TanStack Query:
- Must be an **Array** at the top level.
- Can contain strings, numbers, nested objects — anything JSON-serializable.
- Keys are **hashed deterministically**: object key order doesn't matter. `['todos', { status, page }]` and `['todos', { page, status }]` are the same. `undefined` values in objects are also ignored.
- **Array item order matters**: `['todos', status, page]` ≠ `['todos', page, status]`.

Implementation: TanStack Query uses an internal `hashKey` function (in `queryCore`) that does a custom JSON serialization with sorted object keys. The resulting hash is a string used as the cache lookup key.

```ts
// Simplified internal hashKey logic (from TanStack Query source):
function hashKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_, val) =>
    isPlainObject(val)
      ? Object.keys(val).sort().reduce((result, key) => {
          result[key] = val[key];
          return result;
        }, {} as any)
      : val
  );
}
```

**Relevance for RFC**: The RFC's `stableStringify` for the `serialize` strategy is directly analogous to TanStack Query's `hashKey`. The RFC also offers a `compare` strategy (structural comparison), which TanStack Query does not — TanStack always serializes to a string hash.

**Confidence**: **High** — well-documented behavior, confirmed by source code.

### 2.2 Cache Lifetime Management

**Source**: [TanStack Query — Caching Examples](https://tanstack.com/query/latest/docs/framework/react/guides/caching), [TanStack Query — Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)

Two independent timers:

| Concept | Default | Purpose |
|---|---|---|
| `staleTime` | 0 (immediately stale) | How long data is considered "fresh". Fresh data won't be refetched in background. |
| `gcTime` | 5 minutes (300,000ms) | How long inactive (no observers) cache entries are kept in memory before garbage collection. |

Cache lifecycle:
1. First `useQuery` mount → hard loading state → network request → data cached.
2. Second `useQuery` for same key → data served immediately from cache → background refetch (if stale).
3. All observers unmount → `gcTime` timer starts.
4. Timer expires → cache entry garbage collected.
5. New subscriber before timer expires → cached data is returned, background refetch if stale.

Separation of `staleTime` (when to refetch) from `gcTime` (when to evict from memory) is a key design insight.

**Relevance for RFC**: The RFC's `cacheLifetime` maps most closely to RTK Query's `keepUnusedDataFor` / TanStack Query's `gcTime`. The RFC doesn't have an explicit `staleTime` equivalent — staleness seems to be managed implicitly via the machine state (MachineIdle vs. MachineRefreshing) and force-refetch patterns.

**Confidence**: **High** — well-documented with lifecycle diagrams.

### 2.3 Hydration/Dehydration for SSR

**Source**: [TanStack Query — Server Rendering & Hydration](https://tanstack.com/query/latest/docs/framework/react/guides/ssr)

TanStack Query SSR workflow:

```ts
// Server (loader)
const queryClient = new QueryClient();
await queryClient.prefetchQuery({ queryKey: ['posts'], queryFn: getPosts });
return { dehydratedState: dehydrate(queryClient) };

// Client
<QueryClientProvider client={queryClient}>
  <HydrationBoundary state={dehydratedState}>
    <App />
  </HydrationBoundary>
</QueryClientProvider>
```

Key details:
- **Three QueryClients** are involved: one for the loader/prefetch phase, one for server rendering, one for client rendering.
- `dehydrate(queryClient)` serializes the query cache to a JSON-serializable object.
- `HydrationBoundary` rehydrates the data into the client's `QueryClient`.
- By default, only successful queries are dehydrated (failed queries are excluded).
- `shouldDehydrateQuery` option can override this behavior.
- **Staleness on hydration**: `dataUpdatedAt` timestamp is preserved. With default `staleTime: 0`, queries refetch immediately on the client. Setting `staleTime: 60 * 1000` avoids double-fetching.
- **Memory on server**: `gcTime` defaults to `Infinity` on the server to prevent premature GC. Call `queryClient.clear()` after handling the request.
- **Security**: raw `JSON.stringify` of dehydrated state is vulnerable to XSS. Docs recommend `serialize-javascript` or `devalue` libraries.

**Relevance for RFC**: The RFC's `initialSnapshot` / `getSnapshot()` approach is similar to TanStack's `dehydrate` / `hydrate`. The RFC adds `maxSnapshotDataAge` which TanStack handles implicitly via `staleTime` + `dataUpdatedAt`. The RFC's approach of embedding the snapshot version is more explicit about compatibility.

**Confidence**: **High** — comprehensive official documentation with full examples.

### 2.4 Plugin System / Extension Points

**Source**: [TanStack Query — Plugins](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient)

TanStack Query does **not** have a formal plugin system. Extension points are:

1. **QueryCache callbacks**: `onSuccess`, `onError`, `onSettled` at cache level.
2. **MutationCache callbacks**: same pattern for mutations.
3. **Persistence plugins**: `persistQueryClient`, `createSyncStoragePersister`, `createAsyncStoragePersister` — these are standalone utilities, not a plugin API.
4. **`broadcastQueryClient`** (experimental): syncs cache across browser tabs via BroadcastChannel.
5. **Custom QueryClient wrapping**: users extend behavior by wrapping `QueryClient` methods or using the cache callbacks.

There is no mechanism for plugins to modify types or add methods to query results.

**Relevance for RFC**: The RFC's plugin system is significantly more ambitious than what TanStack Query offers. The ability for `ReactHooksPlugin` to add `useResource` to resources requires TypeScript-level type modification — something TanStack Query doesn't attempt.

**Confidence**: **High** — documented plugin section, confirmed by absence of formal plugin API.

### 2.5 QueryObserver Pattern

**Source**: [TanStack Query — QueryObserver API](https://tanstack.com/query/latest/docs/reference/QueryObserver)

`QueryObserver` is the core abstraction that bridges `QueryCache` and UI subscribers:
- Created with `new QueryObserver(queryClient, queryOptions)`.
- Subscribes to a specific query in the cache.
- Provides `getCurrentResult()` and a `subscribe(callback)` method.
- React hooks (`useQuery`) create a `QueryObserver` internally.
- Multiple observers for the same query key share the same cache entry (reference counted).

```ts
const observer = new QueryObserver(queryClient, {
  queryKey: ['posts'],
  queryFn: fetchPosts,
});
const unsubscribe = observer.subscribe((result) => {
  console.log(result.data);
});
```

**Relevance for RFC**: The RFC's `createAgent()` is analogous to TanStack's `QueryObserver`. Both create a scoped instance that tracks a specific query and provides reactive state. The RFC's agent also manages args (fresh/stale), which TanStack Query handles via query key changes.

**Confidence**: **High** — documented API reference.

---

## 3. State Machine Patterns for Data Fetching

### 3.1 XState / Stately Approach

**Source**: [XState — State Machines docs](https://stately.ai/docs/machines)

XState models fetch states as finite state machines with typed transitions:

```ts
const fetchMachine = createMachine({
  id: 'fetch',
  initial: 'idle',
  context: { data: null, error: null },
  states: {
    idle: {
      on: { FETCH: { target: 'pending' } },
    },
    pending: {
      invoke: {
        src: 'fetchData',
        onDone: { target: 'success', actions: assign({ data: (_, event) => event.data }) },
        onError: { target: 'error', actions: assign({ error: (_, event) => event.data }) },
      },
    },
    success: {
      on: { FETCH: { target: 'pending' }, RESET: { target: 'idle' } },
    },
    error: {
      on: { RETRY: { target: 'pending' }, RESET: { target: 'idle' } },
    },
  },
});
```

XState v5 provides:
- `setup()` for type-safe implementations (actions, guards, actors, delays).
- `transition(machine, state, event)` as a pure function to determine next state without actors.
- `getNextTransitions(state)` to introspect available transitions.
- Serializable state for devtools (XState Inspector).

**Confidence**: **High** — official XState v5 documentation.

### 3.2 Class-Based Machines vs. Discriminated Unions

**Class-based machines** (as in the RFC's approach):
```ts
class MachineIdle {
  toPending(promise: Promise<Data>): MachinePending { return new MachinePending(promise); }
}
class MachinePending {
  constructor(public promise: Promise<Data>) {}
  toSuccess(data: Data): MachineSuccess { return new MachineSuccess(data); }
  toError(error: Error): MachineError { return new MachineError(error); }
}
```

**Discriminated unions** (common TypeScript pattern):
```ts
type FetchState<T> =
  | { status: 'idle' }
  | { status: 'pending'; promise: Promise<T> }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

| Aspect | Class-Based | Discriminated Union |
|---|---|---|
| Transition validation | Methods enforce valid transitions at compile time | No compile-time enforcement; any status can be set |
| Devtools serialization | `constructor.name` or explicit `status` field | `status` field directly available |
| Data co-location | Data scoped to specific class instances | Data available via union narrowing |
| Instanceof checking | `machine instanceof MachineSuccess` | `machine.status === 'success'` |
| Extensibility | Subclassing, method overrides | Extending the union type |
| Snapshot compatibility | Need custom serialization logic | JSON-serializable by default |

**Opinions**: Blog posts and community discussions (XState Discord, Reddit r/typescript) suggest discriminated unions are preferred for simple state, while class-based machines add value when transition logic is complex or when methods need to carry behavior. The class-based approach is less common in the TypeScript ecosystem.

**Confidence**: **Medium** — class-based machine pattern is well-understood in OOP (State pattern from GoF), but using it specifically with TypeScript for fetch states is less documented. The RFC's approach is a valid but less common choice.

### 3.3 Transition Validation

Both approaches can validate transitions, but differently:

- **Class-based**: Only the methods present on a class are callable. `MachineIdle` has no `toError()` method → TypeScript prevents calling it. This is the RFC's approach.
- **XState config**: Transitions are defined per state. Sending an event not handled in the current state is silently ignored (no error).
- **Discriminated unions with functions**: Must manually check `status` before applying transition. Possible to add runtime validation with assertion functions.

**Pitfall**: With class-based machines, serialization/deserialization breaks `instanceof` checks. If the machine state is restored from a snapshot (SSR), the restored object won't be an instance of the original class. A factory/registry pattern is needed to reconstruct proper class instances from serialized state.

**Confidence**: **Medium** — pattern is established, specific serialization pitfall is well-known in OOP design.

### 3.4 Machines and Optimistic Updates

In XState, optimistic updates can be modeled as a parallel state or intermediate state:
```
pending → [optimistic success] → (server confirms) → committed success
                                → (server rejects) → rollback to previous state
```

This requires tracking both the optimistic state and the pre-optimistic state simultaneously, which maps to the RFC's patch queue concept (pending/committed/aborted patches applied on top of `originalData`).

**Confidence**: **Medium** — pattern described in XState community discussions and blog posts; not a built-in XState feature.

---

## 4. Plugin System Patterns in TypeScript

### 4.1 Declaration Merging

**Source**: TypeScript Handbook — Declaration Merging

```ts
interface Resource<TData, TArgs> {
  query(args: TArgs): Promise<TData>;
}

// Plugin augments the interface
declare module './resource' {
  interface Resource<TData, TArgs> {
    useResource(args: TArgs): [TData | undefined, () => void];
  }
}
```

**Pros**: Simple, well-supported by TypeScript. Works with module augmentation.
**Cons**: Global effect (all Resources get the augmented type, even without the plugin). No way to conditionally apply based on runtime plugin configuration. Fragile with generics.

**Confidence**: **Medium** — well-documented TypeScript feature, but using it for plugin systems has known limitations.

### 4.2 Generic Type Accumulation (Builder Pattern)

```ts
class ApiBuilder<TPlugins extends Plugin[] = []> {
  plugin<P extends Plugin>(p: P): ApiBuilder<[...TPlugins, P]> { /* ... */ }
  build(): Api<TPlugins> { /* ... */ }
}

type Api<TPlugins> = BaseApi & UnionToIntersection<PluginContributions<TPlugins[number]>>;
```

**Pros**: Type-safe, plugins only affect instances where they're registered. Composable.
**Cons**: Complex type gymnastics (`UnionToIntersection`, mapped types). Can produce hard-to-read error messages. Build step required.

**Example from ecosystem**: `tRPC` uses this pattern for its procedure builder, where middleware can augment the context type that flows to the resolver.

**Confidence**: **Medium** — pattern used by tRPC, Hono, and other TypeScript-first libraries. No single standard approach.

### 4.3 Plugin Interface with Type Mapping

```ts
interface ReactHooksPlugin {
  augment<TData, TArgs>(resource: Resource<TData, TArgs>): Resource<TData, TArgs> & {
    useResource(args: TArgs | SkipToken): UseResourceResult<TData>;
  };
}
```

The host object calls `plugin.augment()` during construction and the return type includes the plugin's contributions.

**Relevance for RFC**: The RFC's `ReactHooksPlugin` needs to add `useResource` to each resource created by an API that has the plugin. This most naturally fits a combination of generic type accumulation (on `createApi`) and conditional type mapping (on `createResource` return type).

**Pitfall**: TypeScript's type inference has limits with deeply nested generic plugin compositions. More than 2-3 plugins can cause type instantiation depth errors.

**Confidence**: **Medium** — multiple valid approaches, no single standard.

---

## 5. Serialization Strategies for Cache Keys

### 5.1 `stableStringify` / Deterministic JSON Serialization

**Established practice** (confirmed across multiple libraries):

Common implementation:
```ts
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, val) => {
    if (isPlainObject(val)) {
      return Object.keys(val).sort().reduce((acc, key) => {
        acc[key] = val[key];
        return acc;
      }, {} as Record<string, unknown>);
    }
    return val;
  });
}
```

Libraries using this approach:
- **TanStack Query**: internal `hashKey` function with sorted object keys.
- **RTK Query**: `defaultSerializeQueryArgs` — sorts keys, stringifies, concatenates with endpoint name.
- **SWR (Vercel)**: uses `stableHash` for key comparison (similar approach).
- **fast-json-stable-stringify** (npm): popular standalone package (~25M weekly downloads), handles edge cases like circular references.

**Edge cases and pitfalls**:
1. **`undefined` values**: `JSON.stringify` strips `undefined` values in objects. `{ a: 1, b: undefined }` → `'{"a":1}'`. This means `fn(1)` and `fn(1, undefined)` may produce the same cache key. Both TanStack Query and RTK Query exhibit this behavior intentionally.
2. **`Date` objects**: serialized as ISO strings. Two `Date` objects with the same timestamp produce the same key.
3. **`NaN`, `Infinity`, `-Infinity`**: serialized as `null` by `JSON.stringify`. Different values produce the same key.
4. **`Map`, `Set`, `RegExp`**: not serializable by default `JSON.stringify`. Will become `{}` or be stripped.
5. **Circular references**: `JSON.stringify` throws. `fast-json-stable-stringify` handles this.
6. **`BigInt`**: `JSON.stringify` throws a `TypeError`.
7. **Order of array elements**: preserved (arrays are ordered), unlike objects.

**Confidence**: **High** — well-understood problem, multiple production implementations.

### 5.2 Serialized String Keys vs. Structural Comparison

| Aspect | Serialized String Key | Structural Comparison |
|---|---|---|
| Lookup performance | O(1) hash map lookup | O(n) iteration with comparison function |
| Memory | String key stored alongside entry | Original args stored for comparison |
| Correctness | Subject to serialization edge cases (undefined, NaN, etc.) | Full structural fidelity |
| SSR snapshot | Keys are strings, easily serializable | Args must be serialized for snapshot |
| Custom types | Requires custom serializer for non-JSON types | Comparison function can handle any type |

**Relevance for RFC**: The RFC supports both strategies via `keyStrategy: 'serialize' | 'compare'`. The `serialize` strategy uses a `Map<string, CacheEntry>`, while `compare` uses the existing `IndirectMap` pattern from v1 (linear scan with comparison function). This dual approach is unique among major data-fetching libraries.

**Confidence**: **High** — trade-offs are well-documented across database and caching literature.

### 5.3 Argument Caching (`doCacheArgs`)

Memoization of serialization results is useful when:
- The same args object is used multiple times (common with signal-derived args in reactive systems).
- Serialization is expensive (deeply nested objects).

Implementation approach: a `WeakMap<object, string>` mapping from arg objects to their serialized forms. This leverages WeakMap's automatic garbage collection — when the arg object is no longer referenced, the cached serialization is also cleaned up.

**Pitfall**: Only works for object arguments (primitives can't be WeakMap keys). The RFC's `doCacheArgs` option must handle this edge case.

**Confidence**: **High** — WeakMap-based memoization for serialization is a well-known pattern.

---

## 6. SSR Hydration/Dehydration Patterns

### 6.1 Server → Client State Transfer

Common workflow across libraries:

```
Server:
  1. Create cache/client instance
  2. Prefetch queries
  3. dehydrate() → serializable snapshot
  4. Embed snapshot in HTML (script tag / page props)

Client:
  1. Parse snapshot from HTML
  2. Create cache/client instance
  3. hydrate(snapshot) → populate cache
  4. Render (data immediately available, no loading states)
```

**Libraries comparison**:

| Library | Dehydrate | Hydrate | Snapshot Format |
|---|---|---|---|
| TanStack Query | `dehydrate(queryClient)` → object with queries array | `<HydrationBoundary state={...}>` | `{ queries: [{ queryKey, queryHash, state: { data, dataUpdatedAt, ... } }] }` |
| RTK Query | Redux store state slice | `extractRehydrationInfo` on HYDRATE action | Full Redux state slice for the api reducer |
| Apollo Client | `client.extract()` → normalized cache | `new InMemoryCache({ ...}).restore(window.__APOLLO_STATE__)` | Normalized entity map |
| SWR | No built-in dehydration | `fallback` prop on `SWRConfig` with pre-fetched data | `{ [key: string]: data }` |

**Confidence**: **High** — documented across all major libraries.

### 6.2 Snapshot Versioning and Compatibility

**Established practices**:
- **TanStack Query**: No explicit version field. Dehydrated state includes `dataUpdatedAt` timestamps.
- **RTK Query**: No version field. State shape is tied to the `reducerPath`.
- **Apollo Client**: Cache version is implicit in the cache's normalized structure. Schema changes can break hydration.

**No library** in the ecosystem implements explicit snapshot versioning with compatibility checking. This is typically handled at the application level (e.g., cache busting via deployment).

**Relevance for RFC**: The RFC includes version + `keyPrefix` + type in `TApiSnapshot`, which is more robust than anything in the ecosystem. This guards against:
1. Version mismatches between server and client deployments.
2. Accidental hydration of data from a different API instance.

**Confidence**: **Medium** — versioning for snapshots is a best practice in data serialization, but no major query library implements it.

### 6.3 `maxSnapshotDataAge` — Staleness on Hydration

How libraries handle stale data during hydration:

| Library | Approach |
|---|---|
| **TanStack Query** | `staleTime` (default 0) causes immediate background refetch after hydration. Recommended to set `staleTime: 60 * 1000` for SSR to avoid double-fetch. `dataUpdatedAt` is preserved in dehydrated state. |
| **RTK Query** | `refetchOnMountOrArgChange` can be set to a number of seconds. If data is older than that threshold, it refetches on mount. |
| **Apollo Client** | No built-in staleness check on hydration. Uses `fetchPolicy` ('cache-first', 'network-only', etc.) which applies uniformly. |

**Relevance for RFC**: The RFC's `maxSnapshotDataAge` explicitly checks how old the data in a snapshot is and invalidates entries that exceed the threshold during hydration. This is more granular than TanStack's `staleTime` approach (which applies to all data, not just hydrated data) and more explicit than RTK Query's approach.

**Confidence**: **Medium** — the concept is sound but implementation varies significantly. No library implements exactly what the RFC describes.

---

## Established Practices

The following are confirmed by multiple sources as established, production-tested patterns:

1. **Deterministic JSON serialization with sorted keys** for cache key generation (TanStack Query, RTK Query, SWR). **Confidence: High.**

2. **Reference-counted cache entries with TTL eviction** — all major libraries track active subscribers and evict data after inactivity timeout (RTK Query: `keepUnusedDataFor`, TanStack: `gcTime`). **Confidence: High.**

3. **Promise-pair lifecycle hooks** (RTK Query's `cacheDataLoaded` / `cacheEntryRemoved`) for safe async resource management in cache entry lifecycles. **Confidence: High.**

4. **Dehydrate/Hydrate pattern** for SSR with three-phase flow (prefetch → serialize → rehydrate). **Confidence: High.**

5. **Observer/Agent pattern** for decoupling cache from UI subscribers (TanStack's `QueryObserver`, RFC's `createAgent`). **Confidence: High.**

6. **Immer-based patch/inverse-patch** for optimistic updates with rollback (RTK Query). **Confidence: High**, though the RFC's queue-based approach with `originalData` is a different, potentially more robust mechanism.

---

## Opinions and Speculation

The following are opinions or claims from single sources, clearly labeled:

1. **"Class-based state machines are overkill for data fetching"** — Common sentiment in XState community discussions. Counter-argument: the RFC's machines are simple (4-5 states) and the class approach provides compile-time transition safety. *Source: XState Discord discussions, various blog posts.* **Confidence: Low** (opinion).

2. **"Declaration merging for plugin types is fragile"** — Some TypeScript experts recommend against module augmentation for plugin systems due to global scope pollution. Builder pattern with generic accumulation is often recommended instead. *Source: TypeScript community discussions, Matt Pocock's TypeScript content.* **Confidence: Low** (opinion, though well-reasoned).

3. **"Structural comparison keys (the 'compare' strategy) don't scale beyond ~1000 entries"** — Linear scan with comparison function has O(n) lookup. For small caches (typical in UI applications), this is negligible. For large caches, serialized string keys are strongly preferred. *Source: General algorithmic analysis, not specific benchmarks for this use case.* **Confidence: Low** (theoretical, no specific measurements).

4. **"TanStack Query's separation of staleTime from gcTime is the gold standard"** — TkDodo (TanStack Query maintainer) argues this separation is essential for good UX. *Source: TkDodo's blog.* **Confidence: Medium** (single authoritative source).

---

## Pitfalls

### Known pitfalls from real-world usage:

1. **RTK Query: Overlapping optimistic mutations cause race conditions** — When multiple mutations overlap and one fails, calling `undo()` can revert unrelated changes. RTK Query docs explicitly warn about this and recommend tag invalidation instead. *Source: Official RTK Query docs.* **Confidence: High.**

2. **TanStack Query: `gcTime: 0` causes hydration errors** — Setting `gcTime` to 0 on the client can cause the garbage collector to remove data that `HydrationBoundary` just placed in the cache, before React finishes rendering. Minimum recommended: `2 * 1000`. *Source: Official TanStack Query SSR docs.* **Confidence: High.**

3. **SSR: Shared cache between requests leaks data between users** — Creating `QueryClient` at module scope (outside request handler) means all users share the same cache. Must create a new client per request. Both TanStack Query and RTK Query docs explicitly warn about this. *Source: Official docs for both libraries.* **Confidence: High.**

4. **JSON serialization pitfalls for cache keys** — `undefined`, `NaN`, `BigInt`, `Map`, `Set` values can produce incorrect or colliding cache keys. Developers often discover this only in production. *Source: Multiple bug reports across libraries.* **Confidence: High.**

5. **XState: State machine serialization drops behavior** — Serializing XState state (e.g., for devtools or SSR) preserves the value and context but loses the machine definition. Deserializing requires access to the original machine. Same applies to class-based machines — `instanceof` breaks after serialization. *Source: XState documentation, community discussions.* **Confidence: High.**

6. **TypeScript plugin system type depth limits** — Complex plugin compositions with deeply nested generics can hit TypeScript's type instantiation depth limit (default: 50). Manifests as `Type instantiation is excessively deep and possibly infinite.(2589)`. *Source: TypeScript GitHub issues, tRPC and Hono issue trackers.* **Confidence: High.**

7. **Immer patches and non-serializable data** — Immer's `produceWithPatches` only works correctly with plain objects and arrays. Using it with class instances, Maps, Sets, or Symbols produces unexpected results. *Source: Immer documentation.* **Confidence: High.**

---

## Performance

### Cache Key Serialization

No formal benchmarks found specifically for `stableStringify` vs. structural comparison in the context of query caching. However:

- `JSON.stringify` on simple objects (1-5 keys): ~0.5-2μs per call (V8 engine). *Source: V8 performance benchmarks, various microbenchmarks.*
- `fast-json-stable-stringify`: ~2-5x overhead vs. native `JSON.stringify` due to key sorting. Still sub-microsecond for typical query args.
- `shallowEqual` comparison: ~0.1-0.5μs for objects with 1-10 keys. Faster per comparison, but O(n) lookups mean total cost is O(n * comparison_cost).
- **Breakeven point**: For caches with > ~50-100 entries, serialized string keys with Map lookup will be faster than structural comparison with linear scan.

**Confidence**: **Medium** — based on general JS performance characteristics and microbenchmarks, not specific to the query caching use case.

### Memory

- Serialized string keys add one string per cache entry (typically 50-200 bytes for simple args).
- Structural comparison stores the original args object (already in memory as part of the cache entry in most designs).
- With `doCacheArgs`, an additional `WeakMap` entry per unique args object. Overhead is minimal (<100 bytes per entry) and automatically GC'd.

**Confidence**: **Medium** — estimates based on V8 memory characteristics.

### SSR Hydration

- Dehydrating a `QueryClient` with 50 queries (100KB total data): ~5-10ms on server (serialization). *Source: Estimated from TanStack Query SSR performance reports.*
- Hydrating on client: ~2-5ms for parsing and cache population.
- `maxSnapshotDataAge` checking adds negligible overhead (one `Date.now()` comparison per entry).

**Confidence**: **Low** — no formal benchmarks found. Estimates based on general serialization performance.

---

## Sources

- [RTK Query — createApi](https://redux-toolkit.js.org/rtk-query/api/createApi) — Full API reference for createApi, endpoint definitions, lifecycle hooks, serialization
- [RTK Query — Cache Behavior](https://redux-toolkit.js.org/rtk-query/usage/cache-behavior) — Cache key generation, subscription reference counting, keepUnusedDataFor
- [RTK Query — Manual Cache Updates](https://redux-toolkit.js.org/rtk-query/usage/manual-cache-updates) — Optimistic/pessimistic updates, updateQueryData, Immer patches, rollback
- [RTK Query — Server Side Rendering](https://redux-toolkit.js.org/rtk-query/usage/server-side-rendering) — extractRehydrationInfo, Next.js integration, SSR workflow
- [TanStack Query — Overview](https://tanstack.com/query/latest/docs/framework/react/overview) — Core concepts, QueryClient, useQuery
- [TanStack Query — Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) — Key serialization, deterministic hashing, array-based keys
- [TanStack Query — Caching Examples](https://tanstack.com/query/latest/docs/framework/react/guides/caching) — staleTime, gcTime, cache lifecycle
- [TanStack Query — Server Rendering & Hydration](https://tanstack.com/query/latest/docs/framework/react/guides/ssr) — dehydrate/hydrate, HydrationBoundary, three-QueryClient architecture
- [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) — onMutate rollback, via-UI vs. via-cache approaches
- [TanStack Query — Plugins](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient) — persistQueryClient, broadcastQueryClient
- [XState — State Machines](https://stately.ai/docs/machines) — createMachine, setup(), typed actions, transition functions, state serialization
- [TypeScript Handbook — Declaration Merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html) — Module augmentation for plugin type systems
- [fast-json-stable-stringify (npm)](https://www.npmjs.com/package/fast-json-stable-stringify) — Deterministic JSON serialization library
