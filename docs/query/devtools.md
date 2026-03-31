# DevTools Integration

Query resources and agents support integration with developer tools (Redux DevTools, @reatom/devtools, etc.) for real-time state inspection.

## Enabling Devtools

Pass a `devtools` instance to the resource options:

```typescript
import { reduxDevtools } from '@fozy-labs/rx-toolkit';
import { query } from '@fozy-labs/rx-toolkit';

const devtools = reduxDevtools({ name: 'MyApp' });

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

const usersResource = api.createResource({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
});
```

Or when creating a standalone resource with `beforeDevtoolsPush`:

```typescript
import { query } from '@fozy-labs/rx-toolkit';
import { reduxDevtools } from '@fozy-labs/rx-toolkit';

const devtools = reduxDevtools();

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

const usersResource = api.createResource({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
  beforeDevtoolsPush: (value, push) => push(value),
});
```

## Default Behavior

When `devtools` is provided, the resource registers **one main state entry** in devtools:

- **Name**: `query:<key>` (e.g., `query:users`)
- **State**: `{ status, data, error }` — the current machine snapshot
- Updates automatically on every state transition (pending → success/error → refreshing)

Agents created via `resource.createAgent()` also register a devtools entry:

- **Name**: `query:<key>/agent` (e.g., `query:users/agent`)
- **State**: `{ status, data, error }` — the agent's derived state

Only the main aggregated state is shown — internal signals (cache maps, status signals) are **not** exposed, keeping the devtools panel clean.

### Reset Behavior

When `resetCache()` is called, the devtools entry resets to `{ status: "pending", data: null, error: null }` (entry is re-created in `MachinePending` state, or removed entirely).

## Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `devtools` | `DevtoolsLike` | `undefined` | Devtools instance (e.g., from `reduxDevtools()`) |
| `beforeDevtoolsPush` | `(value, push) => void` | `undefined` | Intercept state before pushing to devtools |
| `devtoolsKey` | `(args: TArgs) => string` | `undefined` | Custom devtools key derivation (compare strategy only). Default: monotonic counter (0, 1, 2…) |

## Example: Full Setup

```typescript
import { reduxDevtools, DefaultOptions } from '@fozy-labs/rx-toolkit';
import { query } from '@fozy-labs/rx-toolkit';

// Create a devtools instance
const devtools = reduxDevtools({ name: 'MyApp', batchStrategy: 'microtask' });

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

// Per-resource devtools
const usersResource = api.createResource({
  key: 'users',
  queryFn: fetchUsers,
  devtools,
});

// Per-resource with beforeDevtoolsPush
const ordersResource = api.createResource({
  key: 'orders',
  queryFn: fetchOrders,
  devtools,
  beforeDevtoolsPush: (value, push) => {
    // Transform or filter state before sending to devtools
    push(value);
  },
});

// Create agent — automatically tracked in devtools as "query:users/agent"
const agent = usersResource.createAgent();
```

### Signal Key Format

Devtools entries use the key format `"Resource/:key/:argsKey"`. For **serialize** strategy, `argsKey` is the serialized args string (e.g., `"Resource/:users/{"id":"1"}"`). For **compare** strategy, `argsKey` is a monotonic counter by default (e.g., `"Resource/:users/:0"`, `"Resource/:users/:1"`). Use the `devtoolsKey` option to provide semantic keys instead: `devtoolsKey: (args) => args.name` produces `"Resource/:users/:Alice"`.
