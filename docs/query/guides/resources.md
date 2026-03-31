# Resources

Resources are the primary data-fetching primitive in RxQuery. A resource represents a single cacheable query — you define _how_ to fetch data and _what key_ to cache it under. The library handles caching, deduplication, garbage collection, and reactivity automatically. Resources follow Stale-While-Revalidate (SWR) semantics: stale data is served instantly while fresh data is fetched in the background.

## Creating a Resource

Use `api.createResource()` to define a resource. The two required pieces are a `queryFn` (how to fetch) and a `key` (cache namespace).

```typescript
import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

const userResource = api.createResource<{ id: string }, User>({
  key: 'users',
  queryFn: async (args, { abortSignal }) => {
    const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
    return res.json();
  },
  cacheLifetime: 30_000, // 30 seconds
});
```

### Resource Options

| Option | Type | Description |
|--------|------|-------------|
| `key` | `string` | Unique cache namespace (required for SSR) |
| `queryFn` | `(args, tools) => Promise<TData>` | Async data fetcher |
| `cacheLifetime` | `number \| false` | Time (ms) before an unused entry is garbage-collected. `false` disables GC |
| `serializeArgs` | `(args) => string` | Custom args serialization |
| `compareArg` | `(a, b) => boolean` | Custom args comparator |
| `onCacheEntryAdded` | `(args, tools) => void` | Lifecycle hook — entry created |
| `onQueryStarted` | `(args, tools) => void` | Lifecycle hook — query started |
| `maxSnapshotDataAge` | `number` | Max age (ms) of snapshot data for SSR hydration |

## Using Resources in React

The `ReactHooksPlugin` adds `useResourceAgent` directly to the resource. The hook returns a flat state object with convenience boolean flags.

```typescript
function UserProfile({ userId }: { userId: string }) {
  const state = userResource.useResourceAgent({ id: userId });

  if (state.isInitialLoading) return <Spinner />;
  if (state.isError) return <ErrorBanner error={state.error} />;

  return (
    <div>
      <h1>{state.data?.name}</h1>
      {state.isRefreshing && <small>Updating…</small>}
    </div>
  );
}
```

> You can also use the standalone hook: `useResourceAgent(userResource, { id: userId })`.

## Agent State Properties

`TResourceAgentState<TArgs, TData>` exposes these fields:

| Property | Type | Description |
|----------|------|-------------|
| `status` | `'pending' \| 'success' \| 'error' \| 'refreshing' \| 'idle'` | Current machine status |
| `data` | `TData \| null` | Current data (may be stale during refresh) |
| `error` | `unknown` | Current error, if any |
| `lastError` | `unknown` | Previous error preserved after recovery |
| `args` | `TArgs \| null` | Active query arguments |
| `isLoading` | `boolean` | `true` during any fetch (initial or refresh) |
| `isInitialLoading` | `boolean` | `true` only during the very first fetch (no prior data) |
| `isRefreshing` | `boolean` | `true` during background refresh with stale data |
| `isRefreshError` | `boolean` | `true` when a refresh fails but stale data remains |
| `isSuccess` | `boolean` | `true` when data is available |
| `isError` | `boolean` | `true` when an error is present |
| `entry` | `IResourceCacheEntry \| null` | Direct handle to the cache entry |

## Caching Behavior

Each unique combination of `(resource key, serialized args)` creates a separate cache entry. Subsequent requests with the same args return the cached result immediately and trigger a background revalidation.

```typescript
// Both components share the SAME cache entry — only one network request fires.
function Sidebar() {
  const { data } = userResource.useResourceAgent({ id: '1' });
  return <span>{data?.name}</span>;
}

function Header() {
  const { data } = userResource.useResourceAgent({ id: '1' });
  return <span>{data?.name}</span>;
}
```

## Garbage Collection

The cache uses a **refcount + timer** model:

1. While at least one agent subscribes to an entry, the entry stays alive.
2. When the last subscriber disconnects (e.g. component unmounts), a timer starts.
3. After `cacheLifetime` milliseconds the entry is evicted.

Set `cacheLifetime: false` to keep entries forever (useful for static data).

## Refetching and Invalidation

Use `invalidate()` to force a refetch for a specific set of args:

```typescript
// Imperative invalidation
userResource.invalidate({ id: '1' });

// Force query (bypasses cache freshness check)
await userResource.query({ id: '1' }, true);
```

If the entry is in `success` or `refreshing` state, `invalidate()` triggers a background refetch. If the entry doesn't exist yet, it's a no-op.

## Void Arguments

When a resource doesn't need arguments, use `void` as `TArgs`:

```typescript
const todosResource = api.createResource<void, Todo[]>({
  key: 'todos',
  queryFn: async (_args, { abortSignal }) => {
    const res = await fetch('/api/todos', { signal: abortSignal });
    return res.json();
  },
});

// No argument needed
function TodoList() {
  const { data, isLoading } = todosResource.useResourceAgent();
  // ...
}
```

## Direct Cache Entry Access

For advanced use cases (e.g. optimistic updates), access the cache entry directly:

```typescript
// Non-reactive read
const entry = userResource.getEntry({ id: '1' });
const machine = entry?.peek(); // current machine state

// Reactive read (returns Signal)
const entry$ = userResource.getEntry$({ id: '1' });

// Force entry creation
const guaranteedEntry = userResource.getEntry({ id: '1' }, true);
```
