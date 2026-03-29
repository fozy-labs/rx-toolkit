# Devtools Integration (Query V2)

Query V2 resources and agents support integration with developer tools (Redux DevTools, @reatom/devtools, etc.) for real-time state inspection.

## Enabling Devtools

Pass a `devtools` instance to the resource options:

```typescript
import { reduxDevtools } from '@fozy-labs/rx-toolkit';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const devtools = reduxDevtools({ name: 'MyApp' });

const api = unstable_queryV2.createApi({
  plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const usersResource = api.createResourceV2({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
});
```

Or when creating a standalone resource with `beforeDevtoolsPush`:

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';
import { reduxDevtools } from '@fozy-labs/rx-toolkit';

const devtools = reduxDevtools();

const api = unstable_queryV2.createApi({
  plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const usersResource = api.createResourceV2({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
  beforeDevtoolsPush: (value, push) => push(value),
});
```

## Default Behavior

When `devtools` is provided, the resource registers **one main state entry** in devtools:

- **Name**: `query-v2:<key>` (e.g., `query-v2:users`)
- **State**: `{ status, data, error }` — the current machine snapshot
- Updates automatically on every state transition (pending → success/error → refreshing)

Agents created via `resource.createAgent()` also register a devtools entry:

- **Name**: `query-v2:<key>/agent` (e.g., `query-v2:users/agent`)
- **State**: `{ status, data, error }` — the agent's derived state

Only the main aggregated state is shown — internal signals (cache maps, status signals) are **not** exposed, keeping the devtools panel clean.

### Reset Behavior

When `resetCache()` is called, the devtools entry resets to `{ status: "pending", data: null, error: null }` (entry is re-created in `MachinePending` state, or removed entirely).

## Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `devtools` | `DevtoolsLike` | `undefined` | Devtools instance (e.g., from `reduxDevtools()`) |
| `beforeDevtoolsPush` | `(value, push) => void` | `undefined` | Intercept state before pushing to devtools |

## Example: Full Setup

```typescript
import { reduxDevtools, DefaultOptions } from '@fozy-labs/rx-toolkit';
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

// Create a devtools instance
const devtools = reduxDevtools({ name: 'MyApp', batchStrategy: 'microtask' });

const api = unstable_queryV2.createApi({
  plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

// Per-resource devtools
const usersResource = api.createResourceV2({
  key: 'users',
  queryFn: fetchUsers,
  devtools,
});

// Per-resource with beforeDevtoolsPush
const ordersResource = api.createResourceV2({
  key: 'orders',
  queryFn: fetchOrders,
  devtools,
  beforeDevtoolsPush: (value, push) => {
    // Transform or filter state before sending to devtools
    push(value);
  },
});

// Create agent — automatically tracked in devtools as "query-v2:users/agent"
const agent = usersResource.createAgent();
```
