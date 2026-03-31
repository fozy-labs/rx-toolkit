# RxToolkit Query

RxToolkit Query is a powerful data-fetching and server-state management library for React applications. Built on reactive primitives (RxJS signals), it provides automatic caching, background refetching, and immutable state machines for predictable data flow.

## Motivation

Managing server state is fundamentally different from client state. Server state is:

- Persisted remotely and shared across clients
- Requires async APIs for fetching and updating
- Can become stale without your knowledge

RxToolkit Query solves these challenges with:

- **Automatic caching** — Deduplicate requests, cache responses by arguments
- **Background refetching** — Keep data fresh with SWR (stale-while-revalidate) semantics
- **Immutable state machines** — Predictable states: `Pending` → `Success` / `Error` → `Refreshing`
- **Optimistic updates** — Instant UI feedback with automatic rollback via patches
- **Plugin system** — Extend with React hooks, devtools, and custom plugins
- **SSR support** — Snapshot serialization and hydration for server-side rendering
- **Commands** — First-class mutations with resource invalidation and linking

## Quick Start

### Installation

```bash
npm install @fozy-labs/rx-toolkit
```

### Create an API Instance

```typescript
import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});
```

### Define a Resource (Query)

A resource represents server data that needs to be fetched and cached.

```typescript
const todosResource = api.createResource<void, { items: string[] }>({
    key: 'todos',
    queryFn: async (_args, { abortSignal }) => {
        const res = await fetch('/api/todos', { signal: abortSignal });
        return res.json();
    },
});
```

### Use in React

```tsx
function TodoList() {
    const state = todosResource.useResourceAgent();

    if (state.isInitialLoading) return <div>Loading...</div>;
    if (state.isError) return <div>Error: {String(state.error)}</div>;

    return (
        <ul>
            {state.data?.items.map((item, i) => (
                <li key={i}>{item}</li>
            ))}
        </ul>
    );
}
```

### Define a Command (Mutation)

Commands represent operations that change server state. Use `commandLink` to automatically invalidate related resources.

```typescript
import { commandLink } from '@fozy-labs/rx-toolkit';

const addTodoCommand = api.createCommand<{ text: string }, { id: string; text: string }>({
    queryFn: async (args) => {
        const res = await fetch('/api/todos', {
            method: 'POST',
            body: JSON.stringify(args),
        });
        return res.json();
    },
    link: [
        commandLink({
            resource: todosResource,
            forwardArgs: () => undefined as void,
            invalidate: true,
        }),
    ],
});
```

### Use Command in React

```tsx
function AddTodo() {
    const [trigger, state] = addTodoCommand.useCommandAgent();

    return (
        <button
            onClick={() => trigger({ text: 'New todo' })}
            disabled={state.isLoading}
        >
            {state.isLoading ? 'Adding...' : 'Add Todo'}
        </button>
    );
}
```

### Conditional Fetching with SKIP

```tsx
import { SKIP } from '@fozy-labs/rx-toolkit';

function UserProfile({ userId }: { userId: string | null }) {
    const state = userResource.useResourceAgent(userId ? { id: userId } : SKIP);
    // Resource won't fetch until userId is provided
}
```

## Core Concepts

### Resources

Resources represent server data that needs to be fetched and cached. They automatically:

- Cache responses by arguments (serialized or compared by reference)
- Refetch stale data in the background (SWR)
- Share data between multiple components using the same arguments
- Clean up unused cache entries via garbage collection (refcount + timer)

```typescript
const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
        return res.json();
    },
    cacheLifetime: 30_000,
});
```

### Commands

Commands represent mutations — operations that change server state. They support:

- Automatic resource invalidation via `commandLink`
- Optimistic updates with automatic rollback
- Loading / success / error state tracking
- Linking to multiple resources at once

```typescript
const deleteUserCommand = api.createCommand<{ id: string }, void>({
    queryFn: async (args) => {
        await fetch(`/api/users/${args.id}`, { method: 'DELETE' });
    },
    link: [
        commandLink({
            resource: userResource,
            forwardArgs: (args) => args,
            invalidate: true,
        }),
    ],
});
```

### State Machines

Every resource and command uses immutable state machines for predictable state transitions.

**Resource states:**

```
Pending → Success | Error → Refreshing → Success | Error
```

| State | Description | Has Data |
|-------|------------|----------|
| `pending` | Initial state, first fetch is in progress | No |
| `success` | Data loaded successfully | Yes |
| `error` | Fetch failed | No (or stale data after failed refetch) |
| `refreshing` | Background refetch with existing data | Yes (stale) |

**Command states:**

```
Idle → Loading → Success | Error
```

Machine classes are exported as `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing` for resources and `CommandIdle`, `CommandLoading`, `CommandSuccess`, `CommandError` for commands.

> **Tip:** Use boolean flags (`isLoading`, `isError`, `isSuccess`) instead of checking `status` directly. This ensures correct behavior across all state combinations, including SWR error states where `isError` and `data` can coexist.

### Agents

An agent is an SWR observer for a resource. It provides computed state with convenience flags.

```typescript
const agent = userResource.createAgent();
agent.start({ id: '1' });

const state = agent.state$();
// state.status, state.data, state.error
// state.isLoading, state.isInitialLoading, state.isRefreshing
// state.isSuccess, state.isError
// state.entry — cache entry handle for optimistic patches
```

### Plugins

Plugins extend the API with additional methods on resources and commands.

- `ReactHooksPlugin` — Adds `.useResourceAgent()` and `.useCommandAgent()` hooks directly to resource/command instances
- Custom plugins can contribute any methods via the plugin interface

```typescript
const api = createApi({
    plugins: [new ReactHooksPlugin()],
});
```

> React hooks can also be used standalone without the plugin:
> `useResourceAgent(resource, args)` / `useCommandAgent(command)`

### Lifecycle Hooks

**`onCacheEntryAdded`** — Called when a new cache entry is created. Useful for WebSocket subscriptions:

```typescript
const resource = api.createResource({
    key: 'messages',
    queryFn: fetchMessages,
    onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        try {
            await $cacheDataLoaded;
            const ws = new WebSocket(`/ws/messages?id=${args.id}`);
            await $cacheEntryRemoved;
            ws.close();
        } catch {
            // Entry removed before data loaded — no cleanup needed
        }
    },
});
```

**`onQueryStarted`** — Called on every `queryFn` invocation. Useful for optimistic updates:

```typescript
const resource = api.createResource({
    key: 'todos',
    queryFn: fetchTodos,
    onQueryStarted: async (_args, { $queryFulfilled, getCacheEntry }) => {
        const entry = getCacheEntry();
        const patch = entry.createPatch(draft => {
            draft.items.push({ id: 'temp', text: 'Saving...' });
        });
        try {
            await $queryFulfilled;
            patch?.commit();
        } catch {
            patch?.abort();
        }
    },
});
```

## Guides

- [Optimistic Updates](./optimistic-updates.md) — Instant UI feedback with patches
- [SSR & Hydration](./ssr.md) — Server-side rendering and snapshots
- [DevTools](./devtools.md) — Redux DevTools integration

## API Reference

### Exports

```typescript
import {
    // API
    createApi,
    commandLink,

    // Sentinel tokens
    SKIP,

    // React hooks (standalone)
    useResourceAgent,
    useCommandAgent,

    // Plugins
    ReactHooksPlugin,

    // Resource machine classes
    Machine,
    MachinePending,
    MachineSuccess,
    MachineError,
    MachineRefreshing,
    MachineWithData,

    // Command machine classes
    CommandIdle,
    CommandLoading,
    CommandSuccess,
    CommandError,

    // Snapshot
    CURRENT_SNAPSHOT_VERSION,
} from '@fozy-labs/rx-toolkit';
```

### `createApi(options)`

Creates an API instance. All resources and commands are created through the API.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyPrefix` | `string \| null` | `null` | Key prefix for namespace isolation |
| `keyStrategy` | `'serialize' \| 'compare'` | `'serialize'` | Cache key strategy |
| `serializeArgs` | `(args) => string` | — | Custom argument serialization |
| `compareArg` | `(a, b) => boolean` | — | Custom argument comparison |
| `cacheLifetime` | `number` | `60000` | Cache entry lifetime (ms) |
| `plugins` | `IPlugin[]` | `[]` | Array of plugins |
| `initialSnapshot` | `TApiSnapshot \| null` | `null` | Initial snapshot for SSR hydration |
| `maxSnapshotDataAge` | `number` | — | Maximum snapshot data age (ms) |
| `doCacheArgs` | `boolean` | `false` | Cache deserialized args (only for `serialize` strategy) |

**Methods:** `createResource(options)`, `createCommand(options)`, `resetAll()`, `getSnapshot()`

### `api.createResource<TArgs, TData>(options)`

Defines a cacheable resource.

| Option | Type | Description |
|--------|------|-------------|
| `key` | `string` | Unique resource key (required for SSR) |
| `queryFn` | `(args, { abortSignal }) => Promise<TData>` | Fetch function |
| `cacheLifetime` | `number` | Override API-level cache lifetime |
| `onCacheEntryAdded` | `(args, tools) => void` | Hook on cache entry creation |
| `onQueryStarted` | `(args, tools) => void` | Hook on every query start |

**Methods:** `createAgent()`, `query(args, doForce?)`, `getEntry(args)`, `getEntry$(args)`, `invalidate(args)`

### `api.createCommand<TArgs, TResult>(options)`

Defines a mutation command.

| Option | Type | Description |
|--------|------|-------------|
| `queryFn` | `(args) => Promise<TResult>` | Mutation function |
| `link` | `CommandLink[]` | Array of resource links for invalidation |

### `commandLink(options)`

Links a command to a resource for automatic invalidation after execution.

| Option | Type | Description |
|--------|------|-------------|
| `resource` | `IResource` | Target resource to invalidate |
| `forwardArgs` | `(commandArgs) => resourceArgs` | Map command args to resource args |
| `invalidate` | `boolean` | Whether to invalidate the resource |

### `SKIP`

Sentinel token to skip fetching. Pass instead of args to `useResourceAgent()` for conditional queries.
