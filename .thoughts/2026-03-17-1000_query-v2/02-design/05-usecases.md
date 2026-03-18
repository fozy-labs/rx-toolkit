---
title: "Use Cases: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Use Cases: Query v2 Module

## UC-1: Basic Resource Definition and Querying

Define an API with `ReactHooksPlugin`, create a resource, and consume it from a React component.

```ts
import { createApi, ReactHooksPlugin, SKIP } from '@fozy-labs/rx-toolkit/query-v2';

// ---- API setup (e.g., src/api/main.ts) ----

interface User {
  id: number;
  name: string;
  email: string;
}

const mainApi = createApi({
  keyPrefix: 'main',
  plugins: [new ReactHooksPlugin()],
});

// TArgs = number, TData = User — inferred from queryFn
const getUserById = mainApi.createResource({
  key: 'getUserById',
  queryFn: async (userId: number, { abortSignal }): Promise<User> => {
    const res = await fetch(`/api/users/${userId}`, { signal: abortSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
});

// ---- React component ----

function UserProfile({ userId }: { userId: number | null }) {
  // Type inferred: args accepts number | SKIP_TOKEN
  // Return type: IResourceV2AgentState<number, User, Error>
  const userQuery = getUserById.useResourceV2Agent(userId ?? SKIP);

  if (userQuery.isInitialLoading) return <div>Loading...</div>;
  if (userQuery.isError) return <div>Error: {userQuery.error.message}</div>;
  if (!userQuery.isSuccess) return null;

  // userQuery.data is typed as User — no cast needed
  return (
    <div>
      <h1>{userQuery.data.name}</h1>
      <p>{userQuery.data.email}</p>
      {userQuery.isRefreshing && <span>Updating...</span>}
    </div>
  );
}
```

**Type inference expectations:**
- `getUserById` is `IResourceV2<number, User, Error> & IReactHooksPluginContributions<number, User, Error>` — no explicit generics needed.
- `useResourceV2Agent` argument type is `number | SKIP_TOKEN`.
- `userQuery.data` is `User | null` — narrowed to `User` after `isSuccess` check.

**Edge cases:**
- If `userId` changes rapidly, the Agent uses latest-wins: only the last `start()` call's result is applied. Previous fetches are aborted via `AbortController`.
- If `userId` becomes `null` (→ `SKIP`), the Agent preserves the last successful state — it does not reset to idle.

**Concurrent access:**
- Multiple components using `getUserById.useResourceV2Agent(sameId)` share the same `CacheEntry`. Each creates its own Agent, but the underlying fetch is deduplicated — only one in-flight request per args.

---

## UC-2: Cache Hit and Stale-While-Revalidate

Second call to `query()` with the same args hits cache. Agent shows stale data and refetches when args change.

```ts
// First call — cache miss, fetch happens
const entry1 = await getUserById.query(42);
// entry1.peek() → MachineSuccess({ id: 42, name: 'Alice', ... })

// Second call — cache hit, no fetch
const entry2 = await getUserById.query(42);
// entry2 === entry1 (same CacheEntry instance)

// Force refetch
const entry3 = await getUserById.query(42, /* doForce */ true);
// entry3 === entry1 (same CacheEntry, but MachineRefreshing → MachineSuccess)
```

**Stale-while-revalidate via Agent:**

```ts
class UserStore {
  private agent = getUserById.createAgent();
  readonly state$ = this.agent.state$; // Signal.compute

  async selectUser(userId: number) {
    // If userId=42 already resolved (MachineSuccess), and user now calls selectUser(99):
    // 1. Agent swaps: previous = entry(42), current = new entry(99)
    // 2. state$ immediately returns { data: Alice (stale), isLoading: true, isInitialLoading: false }
    // 3. When fetch(99) resolves: { data: Bob (fresh), isLoading: false }
    await this.agent.start(userId);
  }
}
```

**Edge cases:**
- `cacheLifetime` (default 120s): after expiration with no active subscribers, the CacheEntry is evicted. Next `query(42)` is a cache miss.
- Cache hit with `doForce=false` on a `MachineSuccess` entry returns the entry immediately without refetching. On a `MachineError` entry, a new fetch is triggered.

**Concurrent access:**
- Two simultaneous `query(42)` calls (cache miss): only one fetch is made; both receive the same `CacheEntry` and the same resolved Promise.

---

## UC-3: Optimistic Update with Patcher

Use `onQueryStarted` to apply optimistic data, then commit or roll back.

```ts
import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit/query-v2';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

const api = createApi({
  keyPrefix: 'todos',
  plugins: [new ReactHooksPlugin()],
});

const getTodos = api.createResource({
  key: 'getTodos',
  queryFn: async (_: void, { abortSignal }): Promise<Todo[]> => {
    const res = await fetch('/api/todos', { signal: abortSignal });
    return res.json();
  },
});

// Separate mutation function (not a v2 command — those are out of scope)
async function toggleTodo(todoId: number) {
  // 1. Get current cache entry
  const cacheEntry = getTodos.entry(undefined);
  if (!cacheEntry) return;

  const machine = cacheEntry.peek();
  if (machine.state.status !== 'success') return;

  // 2. Create optimistic patch
  const { machine: patchedMachine, patch } = machine.createPatch((draft: Todo[]) => {
    const todo = draft.find(t => t.id === todoId);
    if (todo) todo.completed = !todo.completed;
  });

  // 3. Apply optimistic update — UI sees change immediately
  cacheEntry.set(patchedMachine);

  try {
    // 4. Perform server mutation
    await fetch(`/api/todos/${todoId}/toggle`, { method: 'POST' });

    // 5. Commit patch — originalData is cleared if no pending patches remain
    const committed = patchedMachine.finishPatch('commit', patch);
    cacheEntry.set(committed);
  } catch {
    // 6. Abort patch — data rolls back to originalData + remaining committed patches
    const rolledBack = patchedMachine.finishPatch('abort', patch);
    cacheEntry.set(rolledBack);
  }
}
```

**Via `onQueryStarted` lifecycle hook alternative:**

```ts
const getTodos = api.createResource({
  key: 'getTodos',
  queryFn: fetchTodos,
  onQueryStarted: async (_args, { $queryFulfilled, getCacheEntry }) => {
    // This hook fires on every query start
    // Primarily useful for cache warming / sync — patching is shown above
    try {
      const { data } = await $queryFulfilled;
      console.log('Query fulfilled with', data.length, 'todos');
    } catch (err) {
      console.error('Query failed', err);
    }
  },
});
```

**Edge cases:**
- **Multiple concurrent patches**: Patches form an ordered queue. `resolvePatches` applies them in order: committed (pre-pending) are resolved; pending are applied on top; committed (post-pending) stay in queue. The queue cleans up only after the last pending patch is resolved.
- **Patch on `MachineRefreshing`**: Allowed — patches apply on top of stale data. When refresh succeeds, all pending patches are aborted (fresh data supersedes optimistic changes).

**Concurrent access:**
- Two consumers creating patches concurrently on the same `CacheEntry`: both patches enter the queue. Their order is deterministic (insertion order). Commit/abort of one doesn't affect the other.

**Gotchas:**
- Consumer **must** call `finishPatch('commit' | 'abort', patch)` — forgetting this causes a hanging patch. Defense-in-depth: CacheEntry eviction and machine transitions auto-abort orphaned patches. [ref: [04-decisions.md](./04-decisions.md#adr-4)]

---

## UC-4: SSR Hydration / Dehydration

Server fetches data, produces a snapshot; client rehydrates and shows data immediately.

```ts
// ---- Server (e.g., Next.js getServerSideProps) ----

import { createApi } from '@fozy-labs/rx-toolkit/query-v2';

const serverApi = createApi({
  keyPrefix: 'main',
  // No plugins needed on server — no React hooks
});

const getUserById = serverApi.createResource({
  key: 'getUserById',
  queryFn: fetchUserById,
});

// Pre-fetch data
await getUserById.query(42);
await getUserById.query(99);

// Dehydrate — only MachineSuccess entries are captured
const snapshot = serverApi.getSnapshot();
// snapshot: {
//   version: 1,
//   keyPrefix: 'main',
//   resources: {
//     'getUserById': {
//       entries: {
//         '<serialized 42>': { status: 'success', args: 42, data: {...}, updatedAt: 1710700000000 },
//         '<serialized 99>': { status: 'success', args: 99, data: {...}, updatedAt: 1710700000000 },
//       }
//     }
//   }
// }

const html = `<script>window.__SNAPSHOT__ = ${JSON.stringify(snapshot)}</script>`;
```

```ts
// ---- Client ----

const clientApi = createApi({
  keyPrefix: 'main',
  plugins: [new ReactHooksPlugin()],
  initialSnapshot: window.__SNAPSHOT__, // TApiSnapshot
  maxSnapshotDataAge: 5_000, // entries older than 5s trigger invalidation
});

// resources re-created with same keys
const getUserById = clientApi.createResource({
  key: 'getUserById',
  queryFn: fetchUserById,
});

// Data is available immediately from snapshot — no loading state
// getUserById.entry(42)?.peek() → MachineSuccess(userData)

// If snapshot entry is older than maxSnapshotDataAge:
// Machine transitions: MachineSuccess → MachineRefreshing (stale data shown, fresh fetch started)
```

**Edge cases:**
- `keyPrefix` mismatch between server and client snapshots: hydration data is ignored (silent discard — not an error, because different APIs may coexist).
- `version` mismatch: hydration is skipped entirely. This protects against stale snapshot formats after code deployments.
- SSR snapshots require `keyStrategy: 'serialize'` (default). With `compare` strategy, `getSnapshot()` throws a descriptive error.

**Type inference:**
- `TApiSnapshot` is not generic — data is typed as `unknown` in the snapshot. Type safety is restored when `createResource` matches snapshot entries by `key`.

**Gotchas:**
- Resource `key` must match between server and client for hydration to work. Mismatched keys → entries are orphaned in the snapshot and ignored.
- `maxSnapshotDataAge` is checked at hydration time using `Date.now() - entry.updatedAt`. Clock skew between server and client can cause unexpected invalidations.

---

## UC-5: Plugin Usage

### Using `ReactHooksPlugin`

```ts
import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit/query-v2';

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

const getItems = api.createResource({
  key: 'items',
  queryFn: async () => fetch('/api/items').then(r => r.json()),
});

// With ReactHooksPlugin: getItems has useResourceV2Agent and useResourceV2Ref
// Without ReactHooksPlugin: these methods don't exist on the type

// ✓ Works — plugin installed
getItems.useResourceV2Agent(undefined);

// ✗ Type error if ReactHooksPlugin not in plugins array:
// Property 'useResourceV2Agent' does not exist on type 'IResourceV2<...>'
```

### Defining a Custom Plugin

```ts
import type { IPlugin, IPluginContext, IResourceV2 } from '@fozy-labs/rx-toolkit/query-v2';

// 1. Define the contributions interface
interface ILoggingPluginContributions {
  enableLogging(): void;
  disableLogging(): void;
}

// 2. Implement the plugin
class LoggingPlugin implements IPlugin {
  readonly name = 'LoggingPlugin';

  install(context: IPluginContext): void {
    // One-time API-level setup
    console.log(`LoggingPlugin installed for API with prefix: ${context.keyStrategy}`);
  }

  augmentResource<TArgs, TData, TError>(
    resource: IResourceV2<TArgs, TData, TError>,
  ): ILoggingPluginContributions {
    let enabled = false;
    return {
      enableLogging() { enabled = true; },
      disableLogging() { enabled = false; },
    };
  }
}

// 3. Type augmentation — connect plugin to its contributions type
// (This is the ExtractContributions mapping — see ADR-1)
// Plugin consumers must provide this if using third-party plugins.
```

**Type inference:**
- Built-in plugins (`ReactHooksPlugin`) have their `ExtractPluginContributions` mapping shipped with the library.
- Custom third-party plugins require the consumer to define a `ExtractPluginContributions` mapping for TypeScript to resolve augmented types.

**Edge cases:**
- Multiple plugins: contributions are intersected via `Prettify<UnionToIntersection<...>>`. Name collisions between plugins result in intersection of conflicting types (TypeScript will produce `never` for incompatible method overloads).

---

## UC-6: Lifecycle Hooks

### `onCacheEntryAdded` — WebSocket Subscription

```ts
const getLivePrice = api.createResource({
  key: 'livePrice',
  queryFn: async (symbol: string, { abortSignal }) => {
    const res = await fetch(`/api/prices/${symbol}`, { signal: abortSignal });
    return res.json() as Promise<{ price: number; timestamp: number }>;
  },
  onCacheEntryAdded: async (symbol, tools) => {
    // Wait for initial data before setting up real-time updates
    let ws: WebSocket | undefined;
    try {
      await tools.$cacheDataLoaded;

      ws = new WebSocket(`wss://prices.example.com/${symbol}`);
      ws.onmessage = (event) => {
        const update = JSON.parse(event.data);
        const entry = tools.getCacheEntry();
        // Can use entry to push updates into the machine
        // (implementation detail: resource.update or entry.set)
      };

      // Block until cache entry is removed — keeps the hook alive
      await tools.$cacheEntryRemoved;
    } catch {
      // $cacheDataLoaded rejected → entry removed before data loaded
      // Cleanup is handled in finally
    } finally {
      ws?.close();
    }
  },
});
```

**Firing rules:**
- `onCacheEntryAdded` fires once per unique args when a new `CacheEntry` is created (not on cache hit).
- If entry is evicted and re-created later (new query after cache lifetime expired), the hook fires again.

### `onQueryStarted` — Logging / Side Effects

```ts
const getUserById = api.createResource({
  key: 'getUserById',
  queryFn: fetchUserById,
  onQueryStarted: async (userId, { $queryFulfilled, getCacheEntry }) => {
    console.log(`Fetching user ${userId}...`);
    const startTime = Date.now();

    try {
      const { data } = await $queryFulfilled;
      console.log(`User ${userId} loaded in ${Date.now() - startTime}ms`);
    } catch (err) {
      console.error(`Failed to fetch user ${userId}:`, err);
    }
  },
});
```

**Edge cases:**
- `onQueryStarted` fires on **every** fetch, including refetches triggered by `invalidate()`. It fires for the initial fetch and for background refreshes.
- `$queryFulfilled` rejects both on actual errors and when the request is aborted. Consumer should handle both cases.
- `$cacheDataLoaded` in `onCacheEntryAdded` resolves only on the **first** `MachineSuccess` transition — not on subsequent refetches.

---

## UC-7: SKIP_TOKEN — Conditional Querying

```ts
import { SKIP } from '@fozy-labs/rx-toolkit/query-v2';

function UserDetails({ userId }: { userId: number | undefined }) {
  // When userId is undefined, no fetch is triggered
  // When userId becomes defined, fetch starts automatically
  const userQuery = getUserById.useResourceV2Agent(userId ?? SKIP);

  // Type: IResourceV2AgentState<number, User, Error>
  // userQuery.data is User | null (null when skipped or loading)

  if (!userId) return <div>Select a user</div>;
  if (userQuery.isInitialLoading) return <div>Loading...</div>;
  if (userQuery.isSuccess) return <div>{userQuery.data.name}</div>;
  return null;
}
```

**Non-React usage:**

```ts
class UserStore {
  private agent = getUserById.createAgent();
  selectedUserId$ = Signal.state<number | null>(null);

  selectedUser$ = Signal.compute(() => {
    const id = this.selectedUserId$();
    // Agent receives SKIP — no fetch, state is idle or preserved from before
    return this.agent.state$();
  });

  selectUser(userId: number | null) {
    this.selectedUserId$.set(userId);
    this.agent.start(userId ?? SKIP);
  }
}
```

**Edge cases:**
- Transition from valid args to `SKIP`: Agent preserves the last successful state. `data` remains available; `isLoading` is `false`.
- Transition from `SKIP` to valid args: if args were previously fetched and are in cache, cache hit (no loading state shown).
- `SKIP` is a `unique symbol` — it cannot collide with any valid args value.

**Type inference:**
- `start(args: TArgs | SKIP_TOKEN)` — TypeScript union ensures only valid args or `SKIP` are accepted.

---

## UC-8: Cache Invalidation

```ts
// Invalidate specific args — triggers MachineSuccess → MachineRefreshing
getUserById.invalidate(42);
// Entry(42) transitions: MachineSuccess(staleData) → MachineRefreshing(staleData)
// Subscribers see: { data: staleData, isRefreshing: true }
// When fetch resolves: MachineRefreshing → MachineSuccess(freshData)

// Reset all resources in the API
mainApi.resetAll();
// All entries across all resources transition to MachineIdle
// All pending patches are aborted
// All in-flight requests are aborted via AbortController
// All CacheEntries are evicted
```

**In a React component:**

```ts
function UserActions({ userId }: { userId: number }) {
  const userRef = getUserById.useResourceV2Ref(userId);

  const handleRefresh = () => {
    userRef.invalidate();
    // UI sees isRefreshing=true, stale data still visible
  };

  return <button onClick={handleRefresh}>Refresh</button>;
}
```

**Edge cases:**
- `invalidate()` on a `MachineIdle` or `MachinePending` entry: no-op (nothing to refresh).
- `invalidate()` on `MachineError`: no-op — use `retry()` or `start()` instead.
- `invalidate()` on already `MachineRefreshing`: the in-flight refresh is aborted, a new one starts.
- If the refresh fetch fails: machine transitions back to `MachineSuccess` with stale data preserved. Error is available via lifecycle hooks and agent's `refreshError`. [ref: [04-decisions.md](./04-decisions.md#adr-2)]

**Concurrent access:**
- Two components call `invalidate(42)` simultaneously: only one fetch is active (the second call aborts and restarts, or is deduplicated if args match).

---

## UC-9: Dual Key Strategies

### `serialize` strategy (default)

```ts
const api = createApi({
  keyStrategy: 'serialize', // default
  // serializeArgs defaults to stableStringify
});

const getUser = api.createResource({
  key: 'getUser',
  queryFn: async (params: { id: number; includeDetails: boolean }) => {
    return fetch(`/api/users/${params.id}?details=${params.includeDetails}`).then(r => r.json());
  },
});

// These produce the same cache key (stableStringify sorts object keys):
getUser.query({ id: 1, includeDetails: true });
getUser.query({ includeDetails: true, id: 1 }); // cache hit — same serialized key
```

### `compare` strategy

```ts
const api = createApi({
  keyStrategy: 'compare',
  compareArg: shallowEqual, // default
});

const getUser = api.createResource({
  queryFn: async (params: { id: number; filter: RegExp }) => {
    // RegExp is not serializable — compare strategy doesn't need serialization
    return fetchUserWithFilter(params);
  },
});

// O(n) lookup via shallowEqual — suitable for small caches (≤50 entries)
```

### Custom serialization

```ts
const api = createApi({
  keyStrategy: 'serialize',
  serializeArgs: (args) => {
    // Custom: sort array args for stable keys
    if (Array.isArray(args)) return JSON.stringify([...args].sort());
    return JSON.stringify(args);
  },
});
```

**When to use which:**
- `serialize` (default): For all typical use cases. O(1) lookup. Required for SSR snapshots.
- `compare`: When args contain non-serializable values (RegExp, Date instances with identity semantics, class instances). O(n) lookup — recommended for ≤50 cache entries.

**Edge cases:**
- `doCacheArgs: true` with `serialize` strategy: serialized keys are memoized in a `WeakMap<object, string>` — avoid if args are primitives (WeakMap requires object keys).
- `compare` strategy + `getSnapshot()`: throws an error. SSR requires serialized keys.

**Gotchas:**
- With `serialize`, `serializeArgs` must produce equal strings for semantically equal args. The default `stableStringify` handles this for plain objects/arrays but not for `Date`, `Map`, `Set`, etc.

---

## UC-10: Devtools Integration

```ts
const getUserById = api.createResource({
  key: 'getUserById',
  queryFn: fetchUserById,
  beforeDevtoolsPush: (machineState, push) => {
    // machineState is the plain .state object: { status, data, args, error, updatedAt, ... }

    // Example: redact sensitive data before sending to devtools
    if (machineState.status === 'success' && machineState.data) {
      push({
        ...machineState,
        data: {
          ...machineState.data,
          email: '[REDACTED]',
          password: undefined,
        },
      });
    } else {
      push(machineState);
    }
  },
});
```

**How it works:**
- query-v2 does NOT have a separate devtools module. Instead, each `CacheEntry` uses `Signal.state<TMachine>()` internally, and the devtools integration is provided by Signal's built-in `beforeDevtoolsPush` callback and `Devtools.createSignalHooks()`. [ref: [ADR-8 in 04-decisions.md](./04-decisions.md#adr-8)]
- The `CacheEntry`'s Signal.state() is created with a `key` option formatted as `'{keyPrefix}/{resourceKey}/{serializedArgs}'` and a default `beforeDevtoolsPush` that projects `machine` → `machine.state` (plain JSON-serializable object).
- User-provided `beforeDevtoolsPush` (as in the example above) composes with the default projection.

**What appears in Redux DevTools:**
- State name: `[keyPrefix]/[resourceKey]/[serializedArgs]#i=[index]` (e.g., `main/getUserById/"42"#i=5`) — follows Signal's standard key format.
- State value: the machine's `.state` plain object. Default projection: `{ status, data, args, error, updatedAt }`.
- Each transition (idle → pending → success) appears as a separate action in the DevTools timeline.
- Signal lifecycle hooks handle registration (on CacheEntry creation) and disposal (on CacheEntry eviction/GC) automatically.

**Edge cases:**
- `beforeDevtoolsPush` with `push` not called: state is silently dropped — useful for filtering certain transitions.
- Without `beforeDevtoolsPush`: default behavior pushes `machine.state` as-is. Sensitive data in `TData` will be visible in devtools.
- `compare` strategy: serialized args are not available for the devtools state name. The `key` option is recommended for readable devtools labels.

---

## UC-11: Error Handling Patterns

### Basic Error Handling

```ts
const getUser = api.createResource({
  key: 'getUser',
  queryFn: async (userId: number, { abortSignal }) => {
    const res = await fetch(`/api/users/${userId}`, { signal: abortSignal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json() as Promise<User>;
  },
});

// In component
function UserView({ userId }: { userId: number }) {
  const q = getUser.useResourceV2Agent(userId);

  if (q.isError) {
    // q.error is typed as Error
    return <div>Error: {q.error.message}</div>;
  }

  // After a successful refresh fails, data is preserved:
  if (q.isSuccess && q.refreshError) {
    return (
      <div>
        <p>Data may be outdated: {q.refreshError.message}</p>
        <UserCard user={q.data} />
      </div>
    );
  }

  if (q.isSuccess) return <UserCard user={q.data} />;
  if (q.isLoading) return <div>Loading...</div>;
  return null;
}
```

### Retry Pattern

```ts
// Manual retry from error state
class UserStore {
  private agent = getUserById.createAgent();

  retry() {
    // Agent's current entry is MachineError
    // start() transitions: MachineError → MachinePending
    this.agent.start(this.agent.state$().args!);
  }
}
```

### Error Recovery — MachineRefreshing Error Semantics

```ts
// When MachineRefreshing fails:
// Machine: MachineRefreshing(staleData) → error → MachineSuccess(staleData)
// Error flows through: onQueryStarted → $queryFulfilled.catch()
// Agent: refreshError is set, data is preserved

const getUser = api.createResource({
  key: 'getUser',
  queryFn: fetchUser,
  onQueryStarted: async (userId, { $queryFulfilled }) => {
    try {
      await $queryFulfilled;
    } catch (err) {
      // This catches both initial fetch errors AND refresh errors
      // Can differentiate by checking machine state before the fetch
      console.error('Query error for user', userId, err);
    }
  },
});
```

**Edge cases:**
- `TError` defaults to `Error` but can be customized: `createResource<number, User, MyAppError>({ ... })`. The error type propagates to `IResourceV2AgentState.error` and `IResourceV2AgentState.refreshError`.
- Abort errors (`AbortError`): when a request is aborted via `AbortController` (e.g., component unmount, new query for same args), the `AbortError` is typically swallowed by the resource orchestrator — it does **not** transition to `MachineError`.
- Multiple errors without recovery: Machine stays in `MachineError`. Each `retry()` / `start()` transitions to `MachinePending` — if that also fails, back to `MachineError`.

**Concurrent access:**
- Error state is per-CacheEntry (per-args). One args value failing does not affect other entries in the same resource.
