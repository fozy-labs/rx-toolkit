# Devtools Integration (Query V2)

Query V2 resources and agents support integration with developer tools (Redux DevTools, @reatom/devtools, etc.) for real-time state inspection.

## Enabling Devtools

Pass a `devtools` instance to the resource options:

```typescript
import { reduxDevtools } from '@fozy-labs/rx-toolkit';
import { createApi } from '@fozy-labs/rx-toolkit/query-v2';

const devtools = reduxDevtools({ name: 'MyApp' });

const api = createApi({
  resources: {
    users: {
      key: 'users',
      queryFn: async ({ id }) => fetchUser(id),
      devtools,
    },
  },
});
```

Or when creating a standalone resource:

```typescript
import { ResourceV2 } from '@fozy-labs/rx-toolkit/query-v2';
import { reduxDevtools } from '@fozy-labs/rx-toolkit';

const devtools = reduxDevtools();

const usersResource = new ResourceV2({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
});
```

## Default Behavior

When `devtools` is provided, the resource registers **one main state entry** in devtools:

- **Name**: `query-v2:<key>` (e.g., `query-v2:users`)
- **State**: `{ status, data, error }` — the current machine snapshot
- Updates automatically on every state transition (idle → pending → success/error → refreshing)

Agents created via `resource.createAgent()` also register a devtools entry:

- **Name**: `query-v2:<key>/agent` (e.g., `query-v2:users/agent`)
- **State**: `{ status, data, error }` — the agent's derived state

Only the main aggregated state is shown — internal signals (cache maps, status signals) are **not** exposed by default, keeping the devtools panel clean.

### Reset Behavior

When `resetCache()` is called, the devtools entry resets to `{ status: "idle", data: null, error: null }`.

## Debug Mode

For advanced debugging, enable `devtoolsDebug`:

```typescript
const usersResource = new ResourceV2({
  key: 'users',
  queryFn: async ({ id }) => fetchUser(id),
  devtools,
  devtoolsDebug: true,
});
```

When `devtoolsDebug: true`, additional entries are registered:

| Entry | Description |
|-------|-------------|
| `query-v2:<key>/status$` | Internal resource status signal (`"idle"` / `"ready"`) |
| `query-v2:<key>/lastEntry$` | Whether a last entry reference exists (`"entry"` / `"null"`) |
| `query-v2:<key>/entry(<args>)` | Per-cache-entry machine state (status, data, error, args) |

This is useful for diagnosing cache lifecycle issues, understanding when entries are created and cleaned up, and observing internal signal transitions.

## Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `devtools` | `DevtoolsLike` | `undefined` | Devtools instance (e.g., from `reduxDevtools()`) |
| `devtoolsDebug` | `boolean` | `false` | When `true`, expose internal signals in devtools |

## Example: Full Setup

```typescript
import { reduxDevtools, DefaultOptions } from '@fozy-labs/rx-toolkit';
import { ResourceV2 } from '@fozy-labs/rx-toolkit/query-v2';

// Create a devtools instance
const devtools = reduxDevtools({ name: 'MyApp', batchStrategy: 'microtask' });

// Option A: Per-resource devtools
const usersResource = new ResourceV2({
  key: 'users',
  queryFn: fetchUsers,
  devtools,
});

// Option B: Per-resource with debug mode
const ordersResource = new ResourceV2({
  key: 'orders',
  queryFn: fetchOrders,
  devtools,
  devtoolsDebug: true, // See all internal signals
});

// Create agent — automatically tracked in devtools as "query-v2:users/agent"
const agent = usersResource.createAgent();
```
