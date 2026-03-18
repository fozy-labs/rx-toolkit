---
title: "Use Cases — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Use Cases

## 1. Fix #1 + #2 — Standalone Hooks

### UC-1.1: Standalone `useResourceV2Agent` (no plugin)

Consumer imports the hook directly from the `react/` module and passes the resource explicitly. No plugin registration needed.

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';
import { useResourceV2Agent } from '@fozy-labs/rx-toolkit/query-v2/react';
// or via: unstable_queryV2.useResourceV2Agent (re-exported from barrel)

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    // No plugins — standalone hooks don't require ReactHooksPlugin
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

function UserProfile({ userId }: { userId: string }) {
    const state = useResourceV2Agent(userResource, { id: userId });

    if (state.isLoading) return <div>Loading...</div>;
    if (state.isError) return <div>Error: {state.error?.message}</div>;

    return <div>{state.data?.name}</div>;
}
```

[ref: ../01-research/01-codebase-analysis.md#1-react-hooks--plugin-dependency] — hooks already receive `resource` as closure arg; making it an explicit parameter is straightforward.
[ref: ../01-research/01-codebase-analysis.md#2-react-hooks-folder-location] — v1 uses standalone hooks pattern (`useResourceAgent(resource, args)`).

### UC-1.2: Plugin path (backward-compatible)

Consumers who already use `ReactHooksPlugin` continue to call hooks as resource methods. Behavior is identical — the plugin delegates to the standalone function internally.

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

function UserProfile({ userId }: { userId: string }) {
    // Plugin path — resource carries the hook method
    const state = userResource.useResourceV2Agent({ id: userId });
    return <div>{state.data?.name}</div>;
}
```

No API change. `augmentResource` now delegates to the standalone hook:

```typescript
// Internal: plugins/ReactHooksPlugin.ts
augmentResource(res, _options) {
    return {
        useResourceV2Agent: (args) => useResourceV2Agent(res, args),
        useResourceV2Ref: (args) => useResourceV2Ref(res, args),
    };
}
```

### UC-1.3: Standalone `useResourceV2Ref`

```typescript
import { useResourceV2Ref } from '@fozy-labs/rx-toolkit/query-v2/react';

function TodoActions({ todoId }: { todoId: number }) {
    const ref = useResourceV2Ref(todosResource, undefined);

    const handleToggle = async () => {
        const patch = ref.createPatch((draft) => {
            const item = draft.items.find(i => i.id === todoId);
            if (item) item.completed = !item.completed;
        });
        if (!patch) return;

        try {
            await toggleTodoOnServer(todoId);
            patch.commit();
        } catch {
            patch.abort();
        }
    };

    return <button onClick={handleToggle}>Toggle</button>;
}
```

### UC-1.4: Standalone hook with SKIP_TOKEN

```typescript
import { useResourceV2Agent } from '@fozy-labs/rx-toolkit/query-v2/react';
import { SKIP } from '@fozy-labs/rx-toolkit';

function ConditionalUser({ userId }: { userId: string | null }) {
    // SKIP prevents the query from firing; state remains idle
    const state = useResourceV2Agent(userResource, userId ? { id: userId } : SKIP);

    if (!userId) return <div>Select a user</div>;
    if (state.isLoading) return <div>Loading...</div>;
    return <div>{state.data?.name}</div>;
}
```

When `SKIP` is passed, the agent is created but `agent.start()` is not called. On a subsequent render with real args, the agent starts normally.

### UC-1.5: Edge case — plugin AND standalone in the same app

Both paths produce identical behavior because the plugin delegates to the standalone function. The same `ResourceV2Agent` lifecycle applies in both cases (one agent per component mount).

```typescript
// Component A uses plugin path
function UserA({ id }: { id: string }) {
    const state = userResource.useResourceV2Agent({ id });
    return <div>{state.data?.name}</div>;
}

// Component B uses standalone path
import { useResourceV2Agent } from '@fozy-labs/rx-toolkit/query-v2/react';

function UserB({ id }: { id: string }) {
    const state = useResourceV2Agent(userResource, { id });
    return <div>{state.data?.name}</div>;
}
```

Both paths call the **same** `useResourceV2Agent` function. Each component mount creates its own `ResourceV2Agent`, but they share the underlying `CacheEntry` (keyed by serialized args). There is no conflict — this is by design.

### Migration: Plugin → Standalone

Consumers currently using `plugins: [ReactHooksPlugin]` + `resource.useResourceV2Agent(args)` can switch to standalone hooks:

**Step 1**: Add standalone hook imports.

```diff
+ import { useResourceV2Agent, useResourceV2Ref } from '@fozy-labs/rx-toolkit/query-v2/react';
```

**Step 2**: Change call sites from resource method to standalone function.

```diff
- const state = userResource.useResourceV2Agent({ id: userId });
+ const state = useResourceV2Agent(userResource, { id: userId });

- const ref = userResource.useResourceV2Ref(undefined);
+ const ref = useResourceV2Ref(userResource, undefined);
```

**Step 3** *(optional)*: Remove `ReactHooksPlugin` from `createApi` if no other plugin-augmented methods are used.

```diff
  const api = unstable_queryV2.createApi({
      keyPrefix: 'my-app',
-     plugins: [new unstable_queryV2.ReactHooksPlugin()],
  });
```

Both approaches can coexist — migration can be incremental.

---

## 2. Fix #3 — Core Split

### UC-2.1: Public import path unchanged

Consumers importing from the public barrel see no change:

```typescript
import { ResourceV2, CacheEntry, CacheMap, ResourceV2Agent } from '@fozy-labs/rx-toolkit';
// or
import { ResourceV2, CacheEntry } from '@fozy-labs/rx-toolkit/query-v2';
```

Both paths continue to work because `core/index.ts` re-exports from its sub-folders:

```typescript
// core/index.ts (updated)
export * from "./common";
export * from "./machines";
export * from "./resource";
```

[ref: ../01-research/02-open-questions.md#q3] — internal-only restructure, no public API change.
[ref: ../01-research/02-open-questions.md#q9] — only barrel imports are public; deep imports not supported.

### UC-2.2: Edge case — Internal cross-imports

Internal modules reference sub-folder paths after the split. Example:

```typescript
// core/resource/ResourceV2.ts — imports from sibling sub-folder
import { CacheEntry } from "../common/CacheEntry";
import { CacheMap } from "../common/CacheMap";
import { Machine } from "../machines/Machine";
```

These are internal implementation details. The compiler catches any broken paths immediately.

---

## 3. Fix #4 — DevTools Filtering

### UC-3.1: Agent state NOT in Redux DevTools

After the fix, creating a resource and agent results in **only** `CacheEntry` state appearing in Redux DevTools.

```typescript
const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});

const agent = userResource.createAgent();
agent.start({ id: '1' });
// → CacheEntry signal pushes to devtools: "my-app/users/{"id":"1"}"
// → Agent signals (_tracking$, _refreshError$, _state$) are invisible to devtools
```

In Redux DevTools, only entries like `my-app/users/{"id":"1"}` appear — showing machine state transitions (`idle → pending → success`). No `State/#i=N` or `Computed/#i=N` noise entries from agent signals.

[ref: ../01-research/02-open-questions.md#q5] — user confirmed agent state leaks; `isDisabled: true` on agent signals is the fix.

### UC-3.2: Edge case — Custom `beforeDevtoolsPush` on resource

A user-provided `beforeDevtoolsPush` continues to work for `CacheEntry` signal pushes. It does NOT affect agent signals — they remain disabled regardless.

```typescript
const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
    beforeDevtoolsPush: (value, push) => {
        // Custom transform — only applied to CacheEntry signal pushes
        push({ ...value, _custom: true });
    },
});

// CacheEntry pushes go through beforeDevtoolsPush → devtools ✅
// Agent signals remain isDisabled: true → devtools ❌ (unaffected by beforeDevtoolsPush)
```

This is correct: `beforeDevtoolsPush` is a `CacheEntry` concern. Agent signals are internal derived state and never participate in the devtools pipeline.

---

## 4. Fix #5 — Snapshot Errors

### UC-4.1: Valid snapshot — succeeds normally

```typescript
const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    initialSnapshot: validSnapshot, // version matches, keyPrefix matches
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});
// → Entries from snapshot are hydrated. No errors.
```

### UC-4.2: Version mismatch — throws descriptive error

```typescript
const staleSnapshot: TApiSnapshot = {
    version: 0, // Old version, current is 1
    keyPrefix: 'my-app',
    resources: { /* ... */ },
};

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    initialSnapshot: staleSnapshot,
});

// During createResource → hydrateSnapshot throws:
// Error: Snapshot version mismatch: expected 1, got 0.
//        The snapshot format is incompatible with the current version of query-v2.
```

[ref: ../01-research/02-open-questions.md#q4] — throw on version/prefix mismatch.

### UC-4.3: Key prefix mismatch — throws descriptive error

```typescript
const wrongPrefixSnapshot: TApiSnapshot = {
    version: 1,
    keyPrefix: 'other-app', // Doesn't match 'my-app'
    resources: { /* ... */ },
};

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    initialSnapshot: wrongPrefixSnapshot,
});

// During createResource → hydrateSnapshot throws:
// Error: Snapshot keyPrefix mismatch: expected "my-app", got "other-app".
//        Ensure the snapshot was created by the same API instance configuration.
```

### UC-4.4: Unknown resource key — warns and continues

```typescript
const snapshotWithRemovedResource: TApiSnapshot = {
    version: 1,
    keyPrefix: 'my-app',
    resources: {
        users: { entries: { /* ... */ } },
        posts: { entries: { /* ... */ } }, // 'posts' resource no longer exists
    },
};

const api = unstable_queryV2.createApi({
    keyPrefix: 'my-app',
    initialSnapshot: snapshotWithRemovedResource,
});

const userResource = api.createResource<{ id: string }, User>({
    key: 'users',
    queryFn: fetchUser,
});
// → 'users' entries hydrated successfully
// → console.warn: [rx-toolkit] hydrateSnapshot: unknown resource key "posts", skipping.
// → App continues normally
```

### UC-4.5: Corrupt machine status — throws from `Machine.fromSnapshot`

```typescript
const corruptSnapshot: TApiSnapshot = {
    version: 1,
    keyPrefix: 'my-app',
    resources: {
        users: {
            entries: {
                '{"id":"1"}': {
                    status: 'invalid_status' as any, // Corrupt
                    args: { id: '1' },
                    data: null,
                    updatedAt: Date.now(),
                },
            },
        },
    },
};

// During hydrateSnapshot → Machine.fromSnapshot throws:
// Error: Unknown machine status: invalid_status
```

This is existing behavior — `Machine.fromSnapshot` already throws on unknown status. The error propagates to the caller.

[ref: ../01-research/01-codebase-analysis.md#5-snapshot-loading-error-handling] — `Machine.fromSnapshot` throws on corrupt status, error is NOT caught.

### UC-4.6: Edge case — SSR version upgrade

In an SSR scenario where the server generates snapshot with version N but the client runs version N+1 (e.g., during a rolling deployment):

```typescript
// Server (version N) generated the snapshot embedded in HTML
const snapshot = window.__API_SNAPSHOT__; // version: N

// Client (version N+1) tries to hydrate
try {
    const api = unstable_queryV2.createApi({
        keyPrefix: 'my-app',
        initialSnapshot: snapshot,
    });
    const resource = api.createResource({ key: 'users', queryFn: fetchUser });
} catch (e) {
    // Handle version mismatch — fall back to fresh queries
    console.error('Snapshot incompatible, starting fresh:', e.message);
    const api = unstable_queryV2.createApi({ keyPrefix: 'my-app' });
    const resource = api.createResource({ key: 'users', queryFn: fetchUser });
}
```

The consumer should either:
1. **Ensure version parity** between server and client (typical SSR setup — same build artifact)
2. **Wrap in try/catch** if rolling deployments may produce version mismatches

---

## 5. Fix #6 — JSDoc

### UC-5.1: JSDoc inventory

Per [ref: ../01-research/01-codebase-analysis.md#6-jsdoc-coverage], the following items receive JSDoc:

**Public API:**
- `createApi()` — parameters, return type, brief usage
- `ResourceV2` — class-level + `createAgent()`, `query()`, `query$()`, `entry()`, `resetCache()`
- `ResourceV2Agent` — class-level + `state$`, `start()`
- `CacheEntry` — class-level + `machine$()`, `peek()`, `set()`, `complete()`
- `ReactHooksPlugin` — class-level
- `useResourceV2Agent()` — function-level with `@see` link
- `useResourceV2Ref()` — function-level with `@see` link

**Inline comments (non-JSDoc):**
- `CacheEntry.beforeDevtoolsPush` — intentional type mismatch
- `ResourceV2Agent` signal constructors — `isDisabled: true` rationale
- `hydrateSnapshot` error logic — error semantics

[ref: ../01-research/02-open-questions.md#q6] — public API + inline comments at magic locations.
[ref: ../01-research/02-open-questions.md#q11] — self-contained JSDoc with `@see` links for complex concepts.

### UC-5.2: Example JSDoc — `createApi`

```typescript
/**
 * Create an API instance that manages resources, caching, and plugins.
 *
 * All resources are created through the API instance, which provides shared
 * configuration, snapshot support, and plugin augmentation.
 *
 * @param options - Configuration for the API instance.
 * @returns An API instance with `createResource`, `resetAll`, and `getSnapshot` methods.
 *
 * @see {@link docs/query-v2/README.md} for usage guide.
 */
export function createApi<TPlugins extends IPlugin[] = []>(
    options?: ICreateApiOptions<TPlugins>,
): IApi<PluginAugmentations<TPlugins>> { ... }
```

### UC-5.3: Example JSDoc — `ResourceV2.createAgent`

```typescript
/**
 * Create an agent that tracks a cache entry with stale-while-revalidate semantics.
 *
 * The agent provides a reactive `state$` signal with computed status flags
 * (`isLoading`, `isSuccess`, `isError`, etc.). Designed for use in React hooks
 * via `useResourceV2Agent`.
 *
 * @returns A new agent bound to this resource.
 */
createAgent(): ResourceV2Agent<TArgs, TData, TError> { ... }
```

### UC-5.4: Example JSDoc — `ResourceV2.query`

```typescript
/**
 * Execute a query for the given arguments.
 *
 * If a cache entry with matching args already exists and is fresh, returns
 * the existing entry without re-fetching. Pass `doForce = true` to bypass
 * the cache and always fetch.
 *
 * @param args - Query arguments passed to `queryFn`.
 * @param doForce - If `true`, bypass cache and force a fresh fetch.
 * @returns The cache entry after the query completes.
 */
async query(args: TArgs, doForce?: boolean): Promise<CacheEntry<TData, TError>> { ... }
```

---

## 6. Fix #7 — Documentation

### UC-6.1: Target location

The existing documentation in `docs/query-v2/ssr.md` contains an "Ограничения" (Limitations) section that already states:

> Snapshot не включает информацию о патчах или pending-запросах.

This is the exact location where optimistic update snapshot behavior should be expanded.

[ref: ../01-research/01-codebase-analysis.md#7-optimistic-update-snapshot-content] — `ssr.md` already partially covers snapshot limitations.
[ref: ../01-research/02-open-questions.md#q7] — user decision: find existing snapshot documentation and expand it.

### UC-6.2: Content to add

A new bullet or short paragraph in the "Ограничения" section of `docs/query-v2/ssr.md` explaining:

- During active optimistic patches, `data` in the snapshot is the **patched** (optimistic) data, not the original server data.
- `originalData` and `patches` fields are NOT included in `TResourceV2SnapshotSlice`.
- Hydrating such a snapshot installs the optimistic data as canonical — as if it were confirmed server data.
- Implication: avoid taking snapshots while patches are uncommitted, or commit/abort patches before `getSnapshot()`.

This complements the existing note about patches being excluded — it clarifies **what happens** when a snapshot is taken mid-patch, rather than just stating that patch metadata is omitted.
