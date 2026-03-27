---
title: "Use Cases & API Examples — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-architect
---

# Use Cases & API Examples — query-v2

All examples use type signatures from [03-model.md](03-model.md). No `any` types. No `TError` generic.
All public API names carry the V2 suffix to distinguish from v1 exports (see [ADR-15](04-decisions.md#adr-15-v2-naming-convention--public-api-suffix)). Factory: `createApi` (no V2 suffix per ADR-15 exception). React hook: `useResourceV2Agent` (standalone and plugin-contributed).

---

## Shared Setup (used across examples)

```typescript
import {
    createApi,
    createResourceV2,
    useResourceV2Agent,
    ReactHooksPlugin,
    SKIP,
    type IResourceV2AgentState,
    type SKIP_TOKEN,
} from "@fozy-labs/rx-toolkit/query-v2";

// ── Domain types ──
interface User {
    id: string;
    name: string;
    email: string;
}

interface Todo {
    id: number;
    text: string;
    completed: boolean;
}

interface TodoList {
    items: Todo[];
    total: number;
}

// ── API instance ──
const api = createApi({
    keyPrefix: "my-app",
    cacheLifetime: 60_000,
    plugins: [new ReactHooksPlugin()] as const,
});
```

---

## ResourceV2 Use Cases

### UC-1: Basic ResourceV2 Creation and Subscription

**Scenario**: Simplest happy path — create a resource with `void` args and subscribe via agent.

```typescript
// Explicit generics (for documentation clarity):
const todosResource = api.createResourceV2<void, TodoList>({
    key: "todos",
    queryFn: async (_args, { abortSignal }) => {
        const res = await fetch("/api/todos", { signal: abortSignal });
        return res.json();
    },
});
// Note: When queryFn's signature fully determines TArgs and TData,
// explicit generics can be omitted — TypeScript infers them automatically.

// ── Imperative usage ──
const agent = todosResource.createAgent();
agent.start(); // void args — no argument needed [ref: 03-model.md#8.2]

// Reactive subscription
const unsubscribe = agent.state$.obs.subscribe((state) => {
    console.log(state.status, state.data);
});

// Or direct signal read
const state = agent.state$();
// state.status: "pending" → "success"
// state.data: null → TodoList
```

**React**:

```tsx
function TodoList() {
    const { data, isLoading, isError } = useResourceV2Agent(todosResource);
    // void args — no second argument needed

    if (isLoading) return <div>Loading...</div>;
    if (isError) return <div>Error</div>;
    return <ul>{data!.items.map((t) => <li key={t.id}>{t.text}</li>)}</ul>;
}
```

[ref: 03-model.md#13 — `useResourceV2Agent` void args overload]
[ref: 01-architecture.md#8 — No TError generic constraint]

---

### UC-2: ResourceV2 with Arguments — Dynamic Key

**Scenario**: ResourceV2 keyed by `{ id: string }`. Changing args triggers a new fetch; cache is per-args.

```typescript
const userResource = api.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
        return res.json();
    },
    cacheLifetime: 30_000,
});
// Note: Explicit generics <{ id: string }, User> are shown for clarity.
// If queryFn's parameter and return types are annotated, TypeScript can infer them.

// ── Agent tracks arg changes ──
const agent = userResource.createAgent();
agent.start({ id: "1" }); // fetches user 1
// ... later
agent.start({ id: "2" }); // fetches user 2, triggers SWR
```

**React — args from props**:

```tsx
function UserProfile({ userId }: { userId: string }) {
    const { data, isLoading, isInitialLoading } = useResourceV2Agent(userResource, {
        id: userId,
    });

    // isInitialLoading: true only when no previous data exists
    // isLoading: true during any fetch (initial or SWR refetch)

    if (isInitialLoading) return <div>Loading user...</div>;
    return <div>{data?.name ?? "–"}</div>;
}
```

**Edge case — rapid arg changes**: When `userId` changes from "1" → "2" → "3" quickly, each `start()` call obtains an entry via the factory callback and triggers `entry.query()`. The agent tracks only the latest `current` entry. Inflight requests for entries "1" and "2" continue independently (other consumers may still use them). The agent ignores their results by only reading `current` entry's state. Abort occurs at the entry level — each `ResourceV2CacheEntry` manages its own `AbortController`, aborting the previous inflight only when a new `query()` call is made to the same entry (e.g., on invalidation or force re-fetch).

---

### UC-3: Stale-While-Revalidate

**Scenario**: Show cached data from previous args while new args are loading.

```tsx
function UserSwitcher() {
    const [userId, setUserId] = React.useState("1");

    const { data, isLoading, isInitialLoading, status } = useResourceV2Agent(
        userResource,
        { id: userId },
    );

    // When userId changes "1" → "2":
    //   1. status = "pending", data = user1Data (SWR — previous entry's data)
    //   2. isLoading = true, isInitialLoading = false (previous data exists)
    //   3. After fetch: status = "success", data = user2Data

    return (
        <div>
            <button onClick={() => setUserId("2")}>Switch to User 2</button>
            {isLoading && <span>Updating...</span>}
            {data && <span>{data.name}</span>}
        </div>
    );
}
```

[ref: 04-decisions.md ADR-3 — SWR: keep previous until current resolves]
[ref: 02-dataflow.md#1.2 — SWR on Args Change sequence]

**SWR state derivation in agent** (illustrative):

```typescript
// Inside ResourceV2Agent.state$ computation:
// if current is pending and previous exists with success data:
//   data = previous.data, isLoading = true, isInitialLoading = false
// if current is pending and no previous:
//   data = null, isLoading = true, isInitialLoading = true
```

---

### UC-4: Error Handling — Error State, Retry, Recovery

**Scenario**: Fetch fails, user sees error, retries, succeeds.

```tsx
function UserWithRetry({ userId }: { userId: string }) {
    const { data, error, isError, isLoading } = useResourceV2Agent(userResource, {
        id: userId,
    });

    if (isError) {
        return (
            <div>
                <p>Failed to load user: {String(error)}</p>
                {/* Re-render with same args triggers query() which retries from error state */}
                <button onClick={() => window.location.reload()}>Retry</button>
            </div>
        );
    }

    if (isLoading) return <div>Loading...</div>;
    return <div>{data?.name}</div>;
}
```

**Imperative retry via agent**:

```typescript
const agent = userResource.createAgent();
agent.start({ id: "1" }); // fails → MachineError

// Calling start() with same args while in error state triggers retry
// [ref: 02-dataflow.md#1.6 — Error and Retry]
agent.start({ id: "1" }); // entry.query() sees error state → fetches again
```

[ref: 03-model.md#3 — MachineRefreshing.errorHappened(error) returns MachineSuccess with stale data preserved]
[ref: 02-dataflow.md#4.1 — State Machine specification: Refreshing → errorHappened → MachineSuccess]

---

### UC-5: Optimistic Updates with Patches (Immer)

**Scenario**: Toggle a todo's completed state optimistically, commit on server success, abort on failure.

```tsx
function ToggleTodo({ todo }: { todo: Todo }) {
    const { entry } = useResourceV2Agent(todosResource);
    // entry: IResourceV2CacheEntry<void, TodoList> | null

    const handleToggle = async () => {
        if (!entry) return;

        // 1. Create optimistic patch — Immer draft
        const patch = entry.createPatch((draft) => {
            const item = draft.items.find((i) => i.id === todo.id);
            if (item) item.completed = !item.completed;
        });
        if (!patch) return; // null if entry has no data (not success/refreshing)

        try {
            // 2. Send to server
            await fetch(`/api/todos/${todo.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ completed: !todo.completed }),
            });
            // 3. Commit — patch becomes permanent
            patch.commit();
        } catch {
            // 4. Abort — inverse patches applied, data rolled back
            patch.abort();
        }
    };

    return <button onClick={handleToggle}>{todo.text}</button>;
}
```

[ref: ../01-research/01-codebase-query-v2.md#24-machine-static-factory — Patch via MachineWithData]
[ref: docs/query-v2/v0.1/optimistic-updates.md — createPatch pattern]

**Edge case — consistency violation (multi-patch abort out of order)**:

```typescript
const entry = todosResource.getEntry(true); // void args: only doInitiate param needed

const patch1 = entry.createPatch((draft) => {
    draft.items.push({ id: 99, text: "New item", completed: false });
});
const patch2 = entry.createPatch((draft) => {
    draft.items[0].text = "Changed";
});

// Abort out of order — Immer applyPatches may fail
patch2?.commit();
patch1?.abort();
// Patcher detects consistency violation → ResourceV2CacheEntry auto-invalidates
// isConsistencyViolation is tracked in TPatchState on the ResourceV2CacheEntry (_patchState)
// Cache shows last valid patched data until fresh data arrives from refetch
```

[ref: 04-decisions.md ADR-6 — Patcher returns IPatchResolution with TPatchState; isConsistencyViolation preserved]

---

### UC-6: ResourceV2 Invalidation

**Scenario**: After a mutation, manually invalidate a resource so it refetches.

```typescript
// Direct invalidation via resource (delegates to entry.invalidate())
userResource.invalidate({ id: "1" });
// Looks up ResourceV2CacheEntry via CacheMap, calls entry.invalidate()
// Entry must be in success state; transitions to MachineRefreshing

// Or invalidate via cache entry directly
const entry = userResource.getEntry({ id: "1" });
entry?.invalidate(); // same effect as userResource.invalidate({ id: "1" })

// Or trigger a query via cache entry
entry?.query(); // initiates fetch if not already in-flight
entry?.query(true); // force re-fetch regardless of current state
```

**Invalidation of non-success entry**: No-op. Only `MachineSuccess` entries can transition to `MachineRefreshing`.
[ref: 02-dataflow.md#1.4 — Invalidation & Refetch]

---

### UC-7: Cache Lifetime — GC Behavior

**Scenario**: Component unmounts, cache entry lives for `cacheLifetime`, then is GC'd. On remount, cached data is available if still alive.

```tsx
function UserPage({ userId }: { userId: string }) {
    // useResourceV2Agent creates agent, subscribes to signal → refcount increments
    const { data } = useResourceV2Agent(userResource, { id: userId });
    // On unmount: agent destroyed, signal unsubscribed → refcount decrements
    // If refcount reaches 0: GC timer starts (30_000ms per userResource config)
    // If remounted before timer: GC cancelled, cached data shown instantly
    // If timer fires: CacheEntry.complete() → entry removed

    return <div>{data?.name ?? "Loading..."}</div>;
}
```

[ref: 04-decisions.md ADR-5 — Refcount + timer hybrid GC]
[ref: 02-dataflow.md#1.7 — GC Lifecycle sequence]

---

### UC-8: Conditional Fetching — SKIP

**Scenario**: Don't fetch until a precondition is met.

```tsx
function UserProfile({ userId }: { userId: string | null }) {
    const { data, isLoading, status } = useResourceV2Agent(
        userResource,
        userId ? { id: userId } : SKIP,
    );
    // When userId is null: status="idle", data=null, isLoading=false
    // When userId becomes non-null: fetch triggers automatically

    if (!userId) return <div>Select a user</div>;
    if (isLoading) return <div>Loading...</div>;
    return <div>{data?.name}</div>;
}
```

**Imperative SKIP**:

```typescript
const agent = userResource.createAgent();
agent.start(SKIP); // agent stays idle, no fetch
// ... later
agent.start({ id: "1" }); // now fetches
```

[ref: 03-model.md#8.1 — Agent accepts SKIP_TOKEN]

---

### UC-9: Multiple Resources with Shared Cache — Deduplication

**Scenario**: Two components request the same resource with the same args simultaneously. Only one fetch occurs.

```tsx
function UserHeader({ userId }: { userId: string }) {
    const { data } = useResourceV2Agent(userResource, { id: userId });
    return <h1>{data?.name}</h1>;
}

function UserSidebar({ userId }: { userId: string }) {
    const { data } = useResourceV2Agent(userResource, { id: userId });
    return <aside>{data?.email}</aside>;
}

function App() {
    // Both components use userResource with { id: "1" }
    // Only ONE fetch to /api/users/1 occurs (inflight dedup in ResourceV2.query)
    return (
        <>
            <UserHeader userId="1" />
            <UserSidebar userId="1" />
        </>
    );
}
```

**How dedup works**: Each `ResourceV2CacheEntry` tracks its own inflight promise. When `entry.query()` is called while a request is already in flight for that entry, it returns the existing promise instead of starting a new one. `ResourceV2.query(args)` delegates to the entry's `query()` method via CacheMap lookup.

---

### UC-10: ResourceV2 with Plugins — ReactHooksPlugin

**Scenario**: Plugin adds `useResourceV2Agent()` method directly to the resource instance.

```typescript
// Plugin-contributed hook (type-safe via PluginAugmentations<TPlugins>)
const state = userResource.useResourceV2Agent({ id: "1" });
// Equivalent to: useResourceV2Agent(userResource, { id: "1" })
// But called as a method on the resource instance

// Standalone hook works without plugin:
const state2 = useResourceV2Agent(userResource, { id: "1" });
```

[ref: docs/query-v2/v0.1/README.md — ReactHooksPlugin adds useResourceV2Agent]
[ref: 04-decisions.md ADR-9 — Plugin synchronous Object.assign composition with generic augmentation]

**How type augmentation works (no `declare module` needed):**

```typescript
// PluginResourceContributions maps ReactHooksPlugin → its contributions
// via conditional type (compile-time only, defined in types/plugin.types.ts)
//
// When createApi is called with plugins as const:
const api = createApi({ plugins: [new ReactHooksPlugin()] as const });
// api: IApi<readonly [ReactHooksPlugin]>

const resource = api.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: fetchUser,
});
// resource: IResourceV2<{id: string}, User>
//         & PluginAugmentations<readonly [ReactHooksPlugin], {id: string}, User>
//         = IResourceV2<{id: string}, User>
//         & { useResourceV2Agent(...args): IResourceV2AgentState<{id: string}, User> }

resource.useResourceV2Agent({ id: "1" }); // ✓ type-safe
```

[ref: 03-model.md#11 — PluginResourceContributions conditional type]

---

## React Integration Use Cases

### UC-11: `useResourceV2Agent()` Hook — Full Lifecycle

**Scenario**: Complete component lifecycle: mount → fetch → display → arg change → SWR → unmount.

> **Design note — agent state vs machine state**: The agent's `status` reflects the
> *current* cache entry's machine status, but `data` may come from the *previous*
> entry (SWR, per [ADR-3](04-decisions.md#adr-3-swr-previouscurrent-swap-semantics)).
> Therefore `state.data` is `TData | null` in *every* status, including `"pending"`.
> On initial fetch (no previous entry), `data` is `null`; on SWR args change,
> `data` carries the previous entry's successful data. This is an **isolated**
> design rule of the agent layer — the machine-level `TPendingState.data` is
> always `null`.

```tsx
function UserCard({ userId }: { userId: string }) {
    const state = useResourceV2Agent(userResource, { id: userId });
    // state: IResourceV2AgentState<{ id: string }, User>

    // Mount: agent.start({ id: userId }) → resource.query() → pending
    // Fetch resolves: status="success", data=User, isLoading=false
    // userId prop changes: SWR (previous data shown, new fetch, then update)
    // Unmount: agent destroyed, signal unsubscribed, GC timer may start

    switch (state.status) {
        case "idle":
            return null;
        case "pending":
            // Agent pending ≠ machine pending: data is TData | null here.
            // Initial fetch → data is null; SWR args change → data is previous entry's data.
            return state.data ? (
                // SWR: showing previous data while loading
                <div style={{ opacity: 0.5 }}>{state.data.name}</div>
            ) : (
                <div>Loading...</div>
            );
        case "success":
        case "refreshing":
            return (
                <div>
                    {state.isRefreshing && <span>Refreshing...</span>}
                    <h2>{state.data!.name}</h2>
                    <p>{state.data!.email}</p>
                </div>
            );
        case "error":
            return <div>Error: {String(state.error)}</div>;
    }
}
```

**State field summary for this lifecycle**:

| Phase | `status` | `data` | `isLoading` | `isInitialLoading` | `isRefreshing` |
|-------|----------|--------|-------------|---------------------|----------------|
| Mount (first fetch) | `"pending"` | `null` | `true` | `true` | `false` |
| Success | `"success"` | `User` | `false` | `false` | `false` |
| Args change (SWR) | `"pending"` | `User` (prev) | `true` | `false` | `false` |
| New data arrives | `"success"` | `User` (new) | `false` | `false` | `false` |
| Invalidation | `"refreshing"` | `User` (stale) | `true` | `false` | `true` |

---

### UC-12: Server-Side Rendering (SSR)

**Scenario**: Fetch data on server, create snapshot, hydrate on client.

**Server**:

```typescript
import { createApi } from "@fozy-labs/rx-toolkit/query-v2";

// Server — no plugins needed (no React)
const serverApi = createApi({ keyPrefix: "my-app" });

const userResource = serverApi.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: fetchUser,
});

// Execute queries
await userResource.query({ id: "1" });
await userResource.query({ id: "2" });

// Capture snapshot — only success entries included
const snapshot = serverApi.getSnapshot();
// snapshot: TApiSnapshot — plain JSON, serializable

// Embed in HTML
const html = `<script>window.__SNAPSHOT__ = ${JSON.stringify(snapshot)}</script>`;
```

**Client**:

```typescript
// Step 1: createApi saves snapshot internally (_savedSnapshot = initialSnapshot)
// Version and keyPrefix are validated at this time (throw on mismatch)
const clientApi = createApi({
    keyPrefix: "my-app", // must match server — validated against initialSnapshot.keyPrefix
    initialSnapshot: window.__SNAPSHOT__ ?? null,
    maxSnapshotDataAge: 300_000, // 5 min — stale data auto-invalidated
    plugins: [new ReactHooksPlugin()],
});
// At this point, snapshot is saved but NOT hydrated yet.

// Step 2: createResourceV2 consumes snapshot slice for "users" key.
// Matching entries are hydrated via Machine.fromSnapshot<TArgs, TData>(slice).
// If entry data is stale (age > maxSnapshotDataAge), auto-invalidation is triggered.
// The snapshot slice for "users" is then DELETED from _savedSnapshot.
const userResource = clientApi.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: fetchUser,
    maxSnapshotDataAge: 60_000, // resource-level override
});
// Data available immediately — no loading spinner for hydrated entries

function UserProfile({ userId }: { userId: string }) {
    const { data, isRefreshing } = useResourceV2Agent(userResource, { id: userId });
    // data is available instantly from snapshot (consumed at createResourceV2 time)
    // If snapshot data is older than maxSnapshotDataAge, auto-invalidation triggers refetch
    return (
        <div>
            {isRefreshing && <span>Refreshing...</span>}
            <span>{data?.name}</span>
        </div>
    );
}
```

**Step 3 — resetAll deletes saved snapshot:**
```typescript
clientApi.resetAll();
// _savedSnapshot = null (saved snapshot deleted entirely)
// All cache entries: CacheEntry.complete() → abort patches → idle → fire onClean$ → delete
// Any subsequent createResourceV2() will NOT see snapshot data
```
```

[ref: docs/query-v2/v0.1/ssr.md — Full SSR flow]
[ref: 04-decisions.md ADR-8 — Snapshot bridge via .state extraction]
[ref: 04-decisions.md ADR-13 — compare strategy throws on snapshot]

**Edge case — compare strategy**:

```typescript
const api = createApi({ keyStrategy: "compare" });
api.getSnapshot(); // Throws: snapshot not supported with "compare" strategy
```

---

## System Use Cases

### UC-13: Cache Reset — `resetAll()` Behavior

**Scenario**: Logout — clear all cached data across all resources.

```typescript
// Reset all resources in this API instance
api.resetAll();
// Step 1: _savedSnapshot = null (saved snapshot deleted entirely)
// Step 2: For each resource in _resources: Set<ResourceV2>:
//   All cache entries: CacheEntry.complete() → abort patches → idle → fire onClean$ → delete
// All agents: state$ recomputes → idle state (data=null)
// GC timers cancelled
// _status$ → "idle" on all resources
// getEntry$() returns null after reset [ref: 04-decisions.md ADR-11]
// Any subsequent createResourceV2() will NOT see snapshot data
```

**React impact**:

```tsx
function App() {
    const { data, status } = useResourceV2Agent(userResource, { id: "1" });
    // After api.resetAll():
    //   status → "idle", data → null
    //   Component re-renders with empty state
    //   Next render: agent.start() triggers fresh fetch

    const handleLogout = () => {
        api.resetAll();
        // All components using this API's resources will re-render with idle state
    };

    return <button onClick={handleLogout}>Logout</button>;
}
```

[ref: 02-dataflow.md#1.7 — GC Lifecycle]

---

### UC-14: Plugin Composition — Multiple Plugins

**Scenario**: Compose multiple plugins on a single API instance.

```typescript
// Custom logging plugin
const LoggingPlugin: IPlugin = {
    name: "LoggingPlugin",
    install(context) {
        console.log("LoggingPlugin installed, strategy:", context.keyStrategy);
    },
    augmentResource(resource, options) {
        return {
            logState() {
                // contributed method
                console.log("Resource key:", options.key);
            },
        };
    },
};

// Compose with ReactHooksPlugin
const api = createApi({
    plugins: [new ReactHooksPlugin(), LoggingPlugin] as const,
});
// api: IApi<readonly [ReactHooksPlugin, typeof LoggingPlugin]>

// Inferred form — TypeScript deduces <void, TodoList> from fetchTodos signature:
const resource = api.createResourceV2({
    key: "todos",
    queryFn: fetchTodos,
});
// Equivalent explicit form (for documentation or when inference is ambiguous):
// const resource = api.createResourceV2<void, TodoList>({ key: "todos", queryFn: fetchTodos });

// Both plugins' contributions are available:
resource.useResourceV2Agent(); // from ReactHooksPlugin (typed via PluginAugmentations)
resource.logState();           // from LoggingPlugin (typed as Record<string,unknown> at type level)
```

**How PluginAugmentations resolves for multiple plugins:**

```typescript
// PluginAugmentations<readonly [ReactHooksPlugin, typeof LoggingPlugin], void, TodoList>
//   = Prettify<UnionToIntersection<
//       PluginResourceContributions<ReactHooksPlugin, void, TodoList>
//     | PluginResourceContributions<typeof LoggingPlugin, void, TodoList>
//   >>
//   = Prettify<UnionToIntersection<
//       IReactHooksPluginContributions<void, TodoList> | {}
//   >>
//   = IReactHooksPluginContributions<void, TodoList>
//   = { useResourceV2Agent(): IResourceV2AgentState<void, TodoList> }
//
// LoggingPlugin does not extend ReactHooksPlugin, so its branch resolves to {}.
// Its runtime methods (logState) are added via Object.assign but typed as
// Record<string, unknown> unless LoggingPlugin is given its own conditional branch.
```

**Adding type-safe contributions for a custom plugin:**

```typescript
// Define contribution interface alongside plugin class
interface ILoggingPluginContributions {
    logState(): void;
}

// Extend the PluginResourceContributions conditional type
// (in the same module or a .d.ts file co-located with the plugin)
type PluginResourceContributions<TPlugin, TArgs, TData> =
    TPlugin extends ReactHooksPlugin
        ? IReactHooksPluginContributions<TArgs, TData>
    : TPlugin extends typeof LoggingPlugin
        ? ILoggingPluginContributions
    : {};
// Now PluginAugmentations resolves LoggingPlugin contributions too.
```

**Key collision detection** (runtime, unchanged from legacy):

```typescript
const BadPlugin: IPlugin = {
    name: "BadPlugin",
    install() {},
    augmentResource() {
        return {
            useResourceV2Agent() {}, // collides with ReactHooksPlugin
        };
    },
};

const api = createApi({
    plugins: [new ReactHooksPlugin(), BadPlugin] as const,
});

api.createResourceV2({ key: "x", queryFn: async () => ({}) });
// Throws: Error("Plugin key collision: useResourceV2Agent")
```

[ref: 04-decisions.md ADR-9 — Sequential plugin application, runtime collision check, generic augmentation]

---

## Lifecycle Hook Use Cases

### UC-15: WebSocket Subscription via onCacheEntryAdded

**Scenario**: Open a WebSocket when a cache entry is created, close it when the entry is GC'd.

```typescript
const messagesResource = api.createResourceV2<{ chatId: string }, Message[]>({
    key: "messages",
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/messages/${args.chatId}`, {
            signal: abortSignal,
        });
        return res.json();
    },
    onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
        // Wait for initial data before opening WS
        await $cacheDataLoaded;

        const ws = new WebSocket(`wss://api.example.com/ws/messages?chatId=${args.chatId}`);

        ws.addEventListener("message", (event) => {
            const newMessage = JSON.parse(event.data) as Message;
            const entry = messagesResource.getEntry(args);
            entry?.createPatch((draft) => {
                draft.push(newMessage);
            })?.commit();
        });

        // When entry is GC'd or reset, close WS
        await $cacheEntryRemoved;
        ws.close();
    },
});
```

[ref: docs/query-v2/v0.1/README.md — onCacheEntryAdded pattern]
[ref: 03-model.md#9 — ICacheEntryAddedTools]

---

### UC-16: Compare Strategy — Non-Serializable Args

**Scenario**: A resource keyed by a RegExp pattern. RegExp is not serializable via JSON, so the `compare` strategy with a custom comparator is used. Internally, `CompareCacheMap` stores entries in an array and performs linear scan via the comparator.

```typescript
// API with compare strategy
const api = createApi({
    keyStrategy: "compare",
    compareArg: (a: RegExp, b: RegExp) => a.source === b.source && a.flags === b.flags,
    plugins: [new ReactHooksPlugin()],
});

const regexResource = api.createResourceV2<RegExp, string[]>({
    key: "regex-matches",
    queryFn: async (pattern, { abortSignal }) => {
        const res = await fetch(`/api/search?pattern=${encodeURIComponent(pattern.source)}`, {
            signal: abortSignal,
        });
        return res.json();
    },
});

// ── Usage ──
const agent = regexResource.createAgent();
agent.start(/foo.*bar/i);
// Internally: CompareCacheMap.getOrCreate(/foo.*bar/i)
//   1. Linear scan over _entries using compareArg
//   2. No match found → calls factory(/foo.*bar/i) → creates ResourceV2CacheEntry
//   3. New entry stored in _entries array
//   4. entry.query() initiated

agent.start(/foo.*bar/i);
// Same args (compareArg returns true) → same entry returned, no new fetch
```

**React**:

```tsx
function RegexSearch({ pattern }: { pattern: RegExp }) {
    const { data, isLoading } = useResourceV2Agent(regexResource, pattern);
    if (isLoading) return <div>Searching...</div>;
    return <ul>{data?.map((m, i) => <li key={i}>{m}</li>)}</ul>;
}
```

**Edge case — snapshot not supported**:

```typescript
api.getSnapshot();
// Throws: "Snapshot not supported with 'compare' strategy"
// CompareCacheMap has no string keys to serialize into TApiSnapshot
```

[ref: 04-decisions.md ADR-13 — compare strategy throws on snapshot]
[ref: 04-decisions.md ADR-19 — CacheMap dual implementation: CompareCacheMap uses array + linear scan]
[ref: 03-model.md#6.3 — CompareCacheMap concrete implementation]

---

### UC-17: CacheMap Factory — Entry Creation Mechanism

**Scenario**: Shows how `CacheMap.getOrCreate(args)` creates entries via the factory callback, preserving CacheMap's genericity.

```typescript
// Inside ResourceV2 constructor (illustrative — internal code):
const cache: ICacheMap<TArgs, ResourceV2CacheEntry<TArgs, TData>> = createCacheMap({
    factory: (args: TArgs) => new ResourceV2CacheEntry({
        args,
        queryFn,
        compareArgs: resolvedCompareArgs,
        cacheLifetime: resolvedCacheLifetime,
    }),
    keyStrategy: options.keyStrategy ?? "serialize",
    serializeArgs: options.serializeArgs,
    compareArg: options.compareArg,
});

// When Agent.start(args) is called:
// 1. Agent calls _getEntry(args) callback
// 2. ResourceV2 delegates to cache.getOrCreate(args)
// 3. CacheMap checks if entry exists for args (by serialized key or comparator)
// 4. If not found → CacheMap calls factory(args) → ResourceV2CacheEntry created
// 5. Entry stored in CacheMap, returned to Agent
// 6. Agent calls entry.query() → fetch initiated

// Another agent with same args:
// 1. cache.getOrCreate(sameArgs) → finds existing entry → returns it
// 2. entry.query() returns existing inflight promise (dedup)
```

This mechanism ensures:
- CacheMap is generic — it never imports `ResourceV2CacheEntry` or `CacheEntry`
- Entry creation logic is owned by `ResourceV2`, encapsulated in the factory
- Multiple consumers (agents, direct `resource.query()`) share the same entry

[ref: 03-model.md#6.4 — getOrCreate mechanism]
[ref: 04-decisions.md ADR-19 — Factory pattern for entry creation]


