---
title: "Use Cases & API Examples — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-architect
---

# Use Cases & API Examples — query-v2

All examples use type signatures from [03-model.md](03-model.md). No `any` types. No `TError` generic.
All public API names carry the V2 suffix to distinguish from v1 exports (see [ADR-16](04-decisions.md#adr-16-v2-naming-convention--public-api-suffix)). Factory: `createApi` (no V2 suffix per ADR-16 exception). Standalone hooks: `useResourceV2`, `useOperationV2`. Plugin hook: `useResourceV2Agent`.

---

## Shared Setup (used across examples)

```typescript
import {
    createApi,
    createResourceV2,
    createOperationV2,
    useResourceV2,
    useOperationV2,
    ReactHooksPlugin,
    SKIP,
    type IResourceV2AgentState,
    type IOperationV2AgentState,
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
    plugins: [new ReactHooksPlugin()],
});
```

---

## Resource Use Cases

### UC-1: Basic Resource Creation and Subscription

**Scenario**: Simplest happy path — create a resource with `void` args and subscribe via agent.

```typescript
const todosResource = api.createResourceV2<void, TodoList>({
    key: "todos",
    queryFn: async (_args, { abortSignal }) => {
        const res = await fetch("/api/todos", { signal: abortSignal });
        return res.json();
    },
});

// ── Imperative usage ──
const agent = todosResource.createAgent();
agent.start(); // void args — no argument needed [ref: 03-model.md#8.2]

// Reactive subscription
const unsubscribe = agent.state$.obs.subscribe((state) => {
    console.log(state.status, state.data);
});

// Or direct signal read
const snapshot = agent.state$();
// snapshot.status: "pending" → "success"
// snapshot.data: null → TodoList
```

**React**:

```tsx
function TodoList() {
    const { data, isLoading, isError } = useResourceV2(todosResource);
    // void args — no second argument needed

    if (isLoading) return <div>Loading...</div>;
    if (isError) return <div>Error</div>;
    return <ul>{data!.items.map((t) => <li key={t.id}>{t.text}</li>)}</ul>;
}
```

[ref: 03-model.md#14 — `useResourceV2` void args overload]
[ref: 01-architecture.md#8 — No TError generic constraint]

---

### UC-2: Resource with Arguments — Dynamic Key

**Scenario**: Resource keyed by `{ id: string }`. Changing args triggers a new fetch; cache is per-args.

```typescript
const userResource = api.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: async (args, { abortSignal }) => {
        const res = await fetch(`/api/users/${args.id}`, { signal: abortSignal });
        return res.json();
    },
    cacheLifetime: 30_000,
});

// ── Agent tracks arg changes ──
const agent = userResource.createAgent();
agent.start({ id: "1" }); // fetches user 1
// ... later
agent.start({ id: "2" }); // fetches user 2, triggers SWR
```

**React — args from props**:

```tsx
function UserProfile({ userId }: { userId: string }) {
    const { data, isLoading, isInitialLoading } = useResourceV2(userResource, {
        id: userId,
    });

    // isInitialLoading: true only when no previous data exists
    // isLoading: true during any fetch (initial or SWR refetch)

    if (isInitialLoading) return <div>Loading user...</div>;
    return <div>{data?.name ?? "–"}</div>;
}
```

**Edge case — rapid arg changes**: When `userId` changes from "1" → "2" → "3" quickly, each `start()` call triggers `resource.query(newArgs)`. The agent tracks only the latest `current` entry. Inflight requests for "1" and "2" are not aborted at the agent level — but the agent ignores their results (only `current` entry matters). Resource-level abort occurs only if the same args get a new request.

---

### UC-3: Stale-While-Revalidate

**Scenario**: Show cached data from previous args while new args are loading.

```tsx
function UserSwitcher() {
    const [userId, setUserId] = React.useState("1");

    const { data, isLoading, isInitialLoading, status } = useResourceV2(
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

[ref: 01-architecture.md ADR-3 — SWR: keep previous until current resolves]
[ref: 02-dataflow.md#1.2 — SWR on Args Change sequence]

**SWR state derivation in agent** (illustrative):

```typescript
// Inside ResourceAgent.state$ computation:
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
    const { data, error, isError, isLoading } = useResourceV2(userResource, {
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
agent.start({ id: "1" }); // resource.query() sees error state → fetches again
```

**Refresh error (background refetch fails)**:

When invalidation/refresh fails, data is preserved per ADR-2. The agent's `refreshError` field is set so consumers can detect it:

```typescript
// Invalidate triggers background refetch
userResource.invalidate({ id: "1" });
// If refetch fails: MachineRefreshing → MachineSuccess (stale data preserved)
// Agent state: state$.refreshError contains the error, cleared on next success
```

[ref: 04-decisions.md ADR-2 — Refreshing errorHappened returns MachineSuccess with stale data]

---

### UC-5: Optimistic Updates with Patches (Immer)

**Scenario**: Toggle a todo's completed state optimistically, commit on server success, abort on failure.

```tsx
function ToggleTodo({ todo }: { todo: Todo }) {
    const { entry } = useResourceV2(todosResource);
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
// Patcher detects consistency violation → resource auto-invalidates
// Cache shows last valid patched data until fresh data arrives
```

[ref: 04-decisions.md ADR-6 — Patcher returns isConsistencyViolation, Resource auto-invalidates]

---

### UC-6: Resource Invalidation

**Scenario**: After a mutation, manually invalidate a resource so it refetches.

```typescript
// Direct invalidation
userResource.invalidate({ id: "1" });
// Entry must be in success state; transitions to MachineRefreshing

// Cross-resource invalidation via lifecycle hooks
const updateUserOp = api.createOperationV2<{ id: string; name: string }, User>({
    key: "update-user",
    queryFn: async (args) => {
        const res = await fetch(`/api/users/${args.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: args.name }),
        });
        return res.json();
    },
});

// In a component: after mutation, invalidate the resource
async function handleUpdateUser(id: string, newName: string) {
    await updateUserOp.execute({ id, name: newName });
    userResource.invalidate({ id });
}
```

**Invalidation of non-success entry**: No-op. Only `MachineSuccess` entries can transition to `MachineRefreshing`.
[ref: 02-dataflow.md#1.4 — Invalidation & Refetch]

---

### UC-7: Cache Lifetime — GC Behavior

**Scenario**: Component unmounts, cache entry lives for `cacheLifetime`, then is GC'd. On remount, cached data is available if still alive.

```tsx
function UserPage({ userId }: { userId: string }) {
    // useResourceV2 creates agent, subscribes to signal → refcount increments
    const { data } = useResourceV2(userResource, { id: userId });
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
    const { data, isLoading, status } = useResourceV2(
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
    const { data } = useResourceV2(userResource, { id: userId });
    return <h1>{data?.name}</h1>;
}

function UserSidebar({ userId }: { userId: string }) {
    const { data } = useResourceV2(userResource, { id: userId });
    return <aside>{data?.email}</aside>;
}

function App() {
    // Both components use userResource with { id: "1" }
    // Only ONE fetch to /api/users/1 occurs (inflight dedup in Resource.query)
    return (
        <>
            <UserHeader userId="1" />
            <UserSidebar userId="1" />
        </>
    );
}
```

**How dedup works**: `Resource.query(args)` checks the inflight map. If a request for the same serialized key is already in flight, it returns the existing promise instead of starting a new one.

---

### UC-10: Resource with Plugins — ReactHooksPlugin

**Scenario**: Plugin adds `useResourceV2Agent()` method directly to the resource instance.

```typescript
// Plugin-contributed hook (via declaration merging)
const state = userResource.useResourceV2Agent({ id: "1" });
// Equivalent to: useResourceV2(userResource, { id: "1" })
// But called as a method on the resource instance

// Standalone hook works without plugin:
const state2 = useResourceV2(userResource, { id: "1" });
```

[ref: docs/query-v2/v0.1/README.md — ReactHooksPlugin adds useResourceV2Agent]
[ref: 04-decisions.md ADR-9 — Plugin synchronous Object.assign composition]

**Plugin type augmentation** (consumer-side declaration):

```typescript
// In the plugin package or user's declaration file:
declare module "@fozy-labs/rx-toolkit/query-v2" {
    interface PluginContributionMap<TArgs, TData> {
        ReactHooksPlugin: {
            useResourceV2Agent(
                ...args: ArgsOrVoidOrSkip<TArgs>
            ): IResourceV2AgentState<TArgs, TData>;
        };
    }
}
```

[ref: 03-model.md#12 — PluginContributionMap declaration merging]

---

## Operation Use Cases

### UC-11: Basic Operation Execution

**Scenario**: Create a mutation operation and execute it imperatively.

```typescript
const createTodoOp = api.createOperationV2<{ text: string }, Todo>({
    key: "create-todo",
    queryFn: async (args) => {
        const res = await fetch("/api/todos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
        });
        return res.json();
    },
});

// Execute imperatively
const newTodo = await createTodoOp.execute({ text: "Buy groceries" });
console.log(newTodo.id); // server-assigned ID

// Reset to idle after use
createTodoOp.reset();
```

[ref: 03-model.md#9.2 — IOperation interface]

---

### UC-12: Operation with Loading/Error States in React

**Scenario**: Show loading indicator and handle errors for a mutation.

```tsx
function CreateTodoForm() {
    const [trigger, { isLoading, isError, error, data }] = useOperationV2(createTodoOp);

    const handleSubmit = async (text: string) => {
        try {
            const todo = await trigger({ text });
            console.log("Created:", todo.id);
        } catch (err) {
            // Error also reflected in state.isError
            console.error("Failed:", err);
        }
    };

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                handleSubmit(fd.get("text") as string);
            }}
        >
            <input name="text" />
            <button disabled={isLoading}>
                {isLoading ? "Creating..." : "Create"}
            </button>
            {isError && <p>Error: {String(error)}</p>}
        </form>
    );
}
```

[ref: 03-model.md#14 — useOperationV2 returns [trigger, state] tuple]

---

### UC-13: Concurrent Operation Handling

**Scenario**: User clicks "Save" rapidly. Each click triggers execute(). Latest-wins semantics.

```typescript
const agent = createTodoOp.createAgent();

// Rapid execution
agent.execute({ text: "First" });  // → MachinePending
agent.execute({ text: "Second" }); // → MachinePending (overwrites)

// When "First" resolves: ignored (stale execution context)
// When "Second" resolves: state → MachineSuccess with data from "Second"
```

[ref: 04-decisions.md ADR-14 — Latest-wins for operations]
[ref: 02-dataflow.md#2.2 — Concurrent Execution sequence]

**Important**: Operations are not cancellable (no AbortController). Stale network requests still execute server-side. If cancellation is needed, use Resource instead or manage it in `queryFn`.

---

## React Integration Use Cases

### UC-14: `useResourceV2()` Hook — Full Lifecycle

**Scenario**: Complete component lifecycle: mount → fetch → display → arg change → SWR → unmount.

```tsx
function UserCard({ userId }: { userId: string }) {
    const state = useResourceV2(userResource, { id: userId });
    // state: IResourceV2AgentState<{ id: string }, User>

    // Mount: agent.start({ id: userId }) → resource.query() → pending
    // Fetch resolves: status="success", data=User, isLoading=false
    // userId prop changes: SWR (previous data shown, new fetch, then update)
    // Unmount: agent destroyed, signal unsubscribed, GC timer may start

    switch (state.status) {
        case "idle":
            return null;
        case "pending":
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

### UC-15: `useOperationV2()` Hook — Mutation Trigger and Status

```tsx
interface UpdateUserArgs {
    id: string;
    name: string;
}

const updateUserOp = api.createOperationV2<UpdateUserArgs, User>({
    key: "update-user",
    queryFn: async (args) => {
        const res = await fetch(`/api/users/${args.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: args.name }),
        });
        return res.json();
    },
});

function EditUserForm({ user }: { user: User }) {
    const [name, setName] = React.useState(user.name);
    const [trigger, { isLoading, isSuccess, data }] = useOperationV2(updateUserOp);

    const handleSave = async () => {
        const updated = await trigger({ id: user.id, name });
        // Invalidate related resource after mutation
        userResource.invalidate({ id: user.id });
    };

    return (
        <div>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button onClick={handleSave} disabled={isLoading}>
                {isLoading ? "Saving..." : "Save"}
            </button>
            {isSuccess && <span>Saved: {data!.name}</span>}
        </div>
    );
}
```

---

### UC-16: Combining Resources and Operations

**Scenario**: Read data with resource, mutate with operation, invalidate after mutation.

```tsx
function TodoPage() {
    const { data: todos, isLoading, entry } = useResourceV2(todosResource);
    const [createTodo, createState] = useOperationV2(createTodoOp);

    const handleCreate = async (text: string) => {
        // Optimistic patch: add item immediately
        const patch = entry?.createPatch((draft) => {
            draft.items.push({ id: Date.now(), text, completed: false });
            draft.total += 1;
        });

        try {
            await createTodo({ text });
            patch?.commit();
            // Invalidate to get server-assigned IDs
            todosResource.invalidate(); // void args — no cast needed (ArgsOrVoid)
        } catch {
            patch?.abort(); // Rollback on failure
        }
    };

    if (isLoading && !todos) return <div>Loading...</div>;

    return (
        <div>
            <button
                onClick={() => handleCreate("New todo")}
                disabled={createState.isLoading}
            >
                {createState.isLoading ? "Adding..." : "Add Todo"}
            </button>
            <ul>
                {todos?.items.map((t) => (
                    <li key={t.id}>{t.text}</li>
                ))}
            </ul>
        </div>
    );
}
```

---

### UC-17: Server-Side Rendering (SSR)

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
const clientApi = createApi({
    keyPrefix: "my-app", // must match server
    initialSnapshot: window.__SNAPSHOT__ ?? null,
    maxSnapshotDataAge: 300_000, // 5 min — stale data auto-invalidated
    plugins: [new ReactHooksPlugin()],
});

const userResource = clientApi.createResourceV2<{ id: string }, User>({
    key: "users",
    queryFn: fetchUser,
    maxSnapshotDataAge: 60_000, // resource-level override
});

// Data available immediately — no loading spinner for hydrated entries
function UserProfile({ userId }: { userId: string }) {
    const { data, isRefreshing } = useResourceV2(userResource, { id: userId });
    // data is available instantly from snapshot
    // If snapshot data is older than maxSnapshotDataAge, auto-invalidation triggers refetch
    return (
        <div>
            {isRefreshing && <span>Refreshing...</span>}
            <span>{data?.name}</span>
        </div>
    );
}
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

### UC-18: Cache Reset — `resetAll()` Behavior

**Scenario**: Logout — clear all cached data across all resources.

```typescript
// Reset all resources in this API instance
api.resetAll();
// All cache entries: CacheEntry.complete() → abort patches → idle → fire onClean$ → delete
// All agents: state$ recomputes → idle state (data=null)
// GC timers cancelled
// _status$ → "idle" on all resources
// getEntry$() returns null after reset [ref: 04-decisions.md ADR-11]
```

**React impact**:

```tsx
function App() {
    const { data, status } = useResourceV2(userResource, { id: "1" });
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

**Global reset** (across all API instances):

```typescript
import { resetAllCacheV2 } from "@fozy-labs/rx-toolkit/query-v2";

resetAllCacheV2(); // Resets ALL resources across ALL createApi() instances
```

[ref: 02-dataflow.md#1.7 — GC Lifecycle]

---

### UC-19: Plugin Composition — Multiple Plugins

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
    plugins: [new ReactHooksPlugin(), LoggingPlugin],
});

const resource = api.createResourceV2<void, TodoList>({
    key: "todos",
    queryFn: fetchTodos,
});

// Both plugins' contributions are available:
resource.useResourceV2Agent(); // from ReactHooksPlugin
resource.logState();         // from LoggingPlugin
```

**Key collision detection**:

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
    plugins: [new ReactHooksPlugin(), BadPlugin],
});

api.createResourceV2({ key: "x", queryFn: async () => ({}) });
// Throws: Error("Plugin key collision: useResourceV2Agent")
```

[ref: 04-decisions.md ADR-9 — Sequential plugin application, runtime collision check]

---

## Lifecycle Hook Use Cases

### UC-20: WebSocket Subscription via onCacheEntryAdded

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
[ref: 03-model.md#10 — ICacheEntryAddedTools]


