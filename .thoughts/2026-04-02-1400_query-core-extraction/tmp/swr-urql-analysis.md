---
title: "External Research: SWR & urql Core Operation Separation"
date: 2026-04-02
stage: 01-research
role: rdpi-external-researcher
---

## Comparative Analysis

| Library | Approach | Pros | Cons | Confidence |
|---------|----------|------|------|------------|
| SWR | Monorepo single package, sub-modules (`swr`, `swr/mutation`, `swr/infinite`, `swr/subscription`, `swr/immutable`) sharing `swr/_internal` core | Simple mental model; cache is universal; middleware pattern for extensions | No operation "kind" concept — query vs mutation is implicit in which hook you import; mutation has its own state management separate from query | High |
| urql | Monorepo multi-package (`@urql/core`, `@urql/react`, etc.) with exchange pipeline; operations tagged with `kind` (`query`, `mutation`, `subscription`, `teardown`) | Explicit operation typing; exchanges filter by `operation.kind`; composable pipeline; framework-agnostic core | Higher complexity; stream-based (wonka); harder to understand for simple cases | High |

## SWR Architecture

### Package / Module Structure
- **Single npm package** `swr` with sub-path exports: `swr`, `swr/_internal`, `swr/mutation`, `swr/infinite`, `swr/immutable`, `swr/subscription`
- Module aliases in jest config confirm this: `'^swr$': '<rootDir>/src/index/index.ts'` etc.
- **Confidence: High** (source: [jest.config.js](https://github.com/vercel/swr/blob/main/jest.config.js), [src/_internal/index.ts](https://github.com/vercel/swr/blob/main/src/_internal/index.ts))

### Shared Core (`_internal`)
- `src/_internal/` is the true shared core, exporting: `Cache`, `SWRGlobalState`, `serialize`, `internalMutate`, `withMiddleware`, `createCacheHelper`, config, presets, types
- Both `useSWR` (query) and `useSWRMutation` (mutation) import from `_internal`
- No concept of "operation kind" at the core level — the cache stores `State<Data>` objects keyed by serialized key strings
- **Confidence: High** (source: [src/_internal/index.ts](https://github.com/vercel/swr/blob/main/src/_internal/index.ts))

### Cache Design
- `Cache<Data>` interface: `keys(): IterableIterator<string>`, `get(key): State<Data> | undefined`, `set(key, value)`, `delete(key)`
- Default implementation: `new Map()` wrapped with `initCache()`
- `SWRGlobalState = new WeakMap<Cache, GlobalState>()` — associates global state per cache instance (EVENT_REVALIDATORS, MUTATION tracking, FETCH tracking, PRELOAD tracking)
- Cache is **flat key-value** — no normalization, no operation type discrimination
- Cache entries are `State<Data>`: `{ data?, error?, isValidating?, isLoading? }`
- **Confidence: High** (source: [src/_internal/types.ts](https://github.com/vercel/swr/blob/main/src/_internal/types.ts), [src/_internal/utils/cache.ts](https://github.com/vercel/swr/blob/main/src/_internal/utils/cache.ts))

### Query: `useSWR`
- `useSWRHandler` in `src/index/use-swr.ts` — the core query hook
- Uses `useSyncExternalStore` to subscribe to cache changes
- Manages: auto-revalidation (focus, reconnect, interval, stale), deduplication, retry, suspense
- Returns `{ data, error, isLoading, isValidating, mutate }`
- `boundMutate` calls `internalMutate(cache, key, ...)` — i.e. query + mutation share the same mutation mechanism
- **Confidence: High** (source: [src/index/use-swr.ts](https://github.com/vercel/swr/blob/main/src/index/use-swr.ts))

### Mutation: `useSWRMutation`
- Lives in `src/mutation/index.ts` — **separate module, separate state management**
- Built as a **middleware** wrapping `useSWR` via `withMiddleware(useSWR, mutation)`
- Has its OWN internal state via `useStateWithDeps`: `{ data, error, isMutating }` — not the main cache state
- `trigger()` function: serializes key, calls fetcher, then calls `internalMutate` to update the shared cache
- **Default: `populateCache: false`** — mutations do NOT update the query cache by default
- Option `populateCache: true` or `populateCache: (result, currentData) => ...` to write back
- Option `revalidate: true/false/(data, key) => boolean` to trigger query refetch post-mutation
- Returns `{ trigger, reset, data, error, isMutating }` — different shape from `useSWR`
- **Confidence: High** (source: [src/mutation/index.ts](https://github.com/vercel/swr/blob/main/src/mutation/index.ts))

### State Management Approach
- **No state machine** — state is a flat `{ data, error, isValidating, isLoading }` object in the cache
- State transitions are imperative: `setCache({ isValidating: true })`, then on result: `setCache({ data, error: undefined, isValidating: false })`
- Dependency-tracking via `stateDependencies` ref — only re-renders when accessed properties change
- Mutation module has its own `useStateWithDeps` separate from the query cache subscription
- Deduplication, timestamps, and race condition handling via `SWRGlobalState` WeakMap side-channels
- **Confidence: High**

### Key Separation Pattern
- Query and mutation share the **same cache key space** and the **same `internalMutate` function**
- Separation is at the **hook level**: different hooks (`useSWR` vs `useSWRMutation`) with different behaviors
- `useSWRMutation` is literally `withMiddleware(useSWR, mutation)` — it wraps the query hook with a middleware that intercepts behavior
- Subscription (`swr/subscription`) also uses the middleware pattern, prefixing keys with `$sub$`
- Infinite pagination (`swr/infinite`) uses `$inf$` prefix
- **Confidence: High**

---

## urql Architecture

### Package Structure
- **True monorepo**: `@urql/core`, `@urql/react`, `@urql/svelte`, `@urql/vue`, `@urql/preact`, plus exchange packages (`@urql/exchange-graphcache`, `@urql/exchange-auth`, etc.)
- `@urql/core` is the framework-agnostic core: Client, types, exchanges, utilities
- Framework bindings are thin wrappers: `useQuery`, `useMutation`, `useSubscription` → call `client.executeQuery/executeMutation/executeSubscription`
- **Confidence: High** (source: [packages/core/src/client.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts), [packages/react-urql/src/components/index.ts](https://github.com/urql-graphql/urql/blob/main/packages/react-urql/src/components/index.ts))

### Operation Model
- Every request becomes an `Operation` object with explicit `kind`: `'query' | 'mutation' | 'subscription' | 'teardown'`
- `Operation` extends `GraphQLRequest` (which has `query`, `variables`, `key`)
- `key` is a hash of document + variables
- `OperationContext` carries config: `url`, `requestPolicy`, `fetchOptions`, `_instance` (unique per mutation invocation)
- **Mutations get unique `_instance`** so two mutations with same variables are distinct
- **Confidence: High** (source: [packages/core/src/types.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/types.ts), [packages/core/src/client.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts))

### Exchange Pipeline
- `Exchange = (input: ExchangeInput) => ExchangeIO`
- `ExchangeIO = (ops$: Source<Operation>) => Source<OperationResult>`
- Exchanges are composed left-to-right: `[cacheExchange, fetchExchange]` → cache sees operations first
- Each exchange receives stream of ALL operations, filters by `operation.kind`, forwards the rest
- Pipeline built with `wonka` (Observable-like library for streams)
- **Confidence: High** (source: [architecture.md](https://github.com/urql-graphql/urql/blob/main/docs/architecture.md), [packages/core/src/types.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/types.ts))

### How Exchanges Filter by Operation Kind

**cacheExchange** (`packages/core/src/exchanges/cache.ts`):
- `shouldSkip = ({ kind }) => kind !== 'mutation' && kind !== 'query'` — passes subscriptions and teardowns through
- Caches only query results (by key)
- On mutation result: invalidates cached queries whose typenames overlap with mutation response typenames
- **Confidence: High** (source: [cache.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/cache.ts), [cache.test.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/cache.test.ts))

**fetchExchange** (`packages/core/src/exchanges/fetch.ts`):
- Handles `query` and `mutation` (and optionally `subscription` if `fetchSubscriptions: true`)
- Filters out `teardown` operations
- **Confidence: High** (source: [fetch.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/fetch.ts))

**subscriptionExchange** (`packages/core/src/exchanges/subscription.ts`):
- By default: only handles `kind === 'subscription'`
- Option `enableAllOperations: true` → also handles query and mutation
- Option `isSubscriptionOperation: (op) => boolean` → custom filter
- Forwards non-matching operations to next exchange via `forward`
- **Confidence: High** (source: [subscription.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/subscription.ts))

### Client-Level Separation
- `client.executeQuery(request, opts)` → creates operation with `kind: 'query'`
- `client.executeMutation(request, opts)` → creates operation with `kind: 'mutation'`
- `client.executeSubscription(request, opts)` → creates operation with `kind: 'subscription'`
- All three call `client.executeRequestOperation(operation)` — **single dispatch point**
- Client validates: throws error if wrong method called for wrong kind (e.g. passing mutation to `executeQuery`)
- **Confidence: High** (source: [client.ts L805-846](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts), [client.test.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.test.ts))

### Client-Level State Differences per Kind
- **Queries**: results get `stale: true` flag when re-executed; shared/deduped by key via `active` map; use `takeUntil(teardown)`
- **Mutations**: use `_instance` for uniqueness; results stream ends on `!hasNext` via `takeWhile`; not deduped — each trigger is independent
- **Subscriptions**: results stream ends on `!hasNext` via `takeWhile`; use `takeUntil(teardown)`
- `reexecuteOperation()` treats kinds differently: mutations always queue; queries only reexecute if still active
- **Confidence: High** (source: [client.ts L601-731](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts))

### State Management (React Bindings)
- `useQuery`: subscribes to `client.executeQuery` stream, maps results to `{ data, error, fetching, stale, extensions, operation }`
- `useMutation`: `useState` with `{ fetching, data, error, stale, extensions, operation }`, calls `client.executeMutation` on explicit execution, takes 1 result
- `useSubscription`: subscribes to `client.executeSubscription` stream, accumulates results
- State shape is **identical across hooks** (`OperationResult`), but lifecycle differs (auto-subscribe vs explicit trigger)
- **Confidence: High** (source: [react-urql hooks](https://github.com/urql-graphql/urql/tree/main/packages/react-urql/src/hooks))

---

## Established Practices

- **Operation kind as first-class concept** (urql): tagging each request with its kind and filtering in middleware/exchanges is the dominant pattern across GraphQL clients (Apollo, urql, Relay all do this). **Confidence: High**
- **Middleware/plugin composition** for extending behavior: both SWR (middleware array) and urql (exchange pipeline) use composable middleware. **Confidence: High**
- **Shared cache, different access patterns**: both libraries use a single cache for all operation types, but mutations interact with the cache differently (urql: invalidation by typenames; SWR: explicit opt-in via `populateCache`). **Confidence: High**
- **Mutations are imperative, queries are declarative**: universal pattern — queries auto-fetch and subscribe; mutations are triggered explicitly. **Confidence: High**

## Opinions and Speculation

- SWR's "mutation is a middleware wrapping the query hook" pattern is elegant but can be confusing — `useSWRMutation` literally wraps `useSWR` but returns a completely different interface. This is a design choice, not an established best practice. **Confidence: Low** (opinion based on code structure)
- urql's stream-based architecture (wonka) provides theoretical composability advantages but adds cognitive overhead for non-RxJS developers. **Confidence: Low** (opinion)

## Pitfalls

- **SWR shared key space**: query and mutation can collide on the same key, which is intentional (they share cache) but can cause unexpected state contamination if `populateCache` is misconfigured. Source: SWR test `'should not read the cache from useSWR'`. **Confidence: Medium**
- **urql mutation deduplication**: mutations are NOT deduped (each gets unique `_instance`), which is correct but differs from query behavior — developers may expect dedup. Source: [client.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts). **Confidence: High**
- **urql exchange ordering matters**: exchanges are composed left-to-right, so putting `fetchExchange` before `cacheExchange` bypasses caching entirely. Source: [architecture.md](https://github.com/urql-graphql/urql/blob/main/docs/architecture.md). **Confidence: High**

## Performance

- SWR uses `useSyncExternalStore` with dependency-tracking (`stateDependencies`) to minimize re-renders — only accessed properties trigger updates. Source: [use-swr.ts](https://github.com/vercel/swr/blob/main/src/index/use-swr.ts). **Confidence: High**
- urql uses wonka streams with `share()` operator for multicast, avoiding duplicate exchange processing. Source: [client.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts). **Confidence: High**
- No comparative benchmarks found between the two libraries. **Confidence: High** (absence confirmed)

## Sources
- [vercel/swr — src/_internal/](https://github.com/vercel/swr/tree/main/src/_internal) — shared core: cache, state, mutate, types
- [vercel/swr — src/mutation/index.ts](https://github.com/vercel/swr/blob/main/src/mutation/index.ts) — useSWRMutation implementation
- [vercel/swr — src/index/use-swr.ts](https://github.com/vercel/swr/blob/main/src/index/use-swr.ts) — useSWR (query) implementation
- [vercel/swr — jest.config.js](https://github.com/vercel/swr/blob/main/jest.config.js) — module aliasing reveals package structure
- [urql-graphql/urql — docs/architecture.md](https://github.com/urql-graphql/urql/blob/main/docs/architecture.md) — official architecture overview
- [urql-graphql/urql — packages/core/src/client.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/client.ts) — Client implementation with per-kind handling
- [urql-graphql/urql — packages/core/src/types.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/types.ts) — Exchange, Operation, ExchangeIO types
- [urql-graphql/urql — packages/core/src/exchanges/cache.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/cache.ts) — cacheExchange with kind-based filtering
- [urql-graphql/urql — packages/core/src/exchanges/subscription.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/subscription.ts) — subscriptionExchange with kind filtering
- [urql-graphql/urql — packages/core/src/exchanges/fetch.ts](https://github.com/urql-graphql/urql/blob/main/packages/core/src/exchanges/fetch.ts) — fetchExchange
- [urql-graphql/urql — packages/react-urql/src/hooks/useMutation.ts](https://github.com/urql-graphql/urql/blob/main/packages/react-urql/src/hooks/useMutation.ts) — React mutation hook
