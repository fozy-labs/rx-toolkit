---
title: "Use Cases: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

# Use Cases

This document provides TypeScript code examples and React integration patterns for the six key scenarios affected by the bug fixes and the `lastError` enhancement. Each use case includes the primary usage pattern, edge cases, and expected behavior after the fixes. All examples use the **post-fix** API surface.

---

## 1. Snapshot Hydration — `createApi({ initialSnapshot })` with `maxSnapshotDataAge`

### User Story

As a developer building an SSR application, I want to hydrate the client-side cache from a server-generated snapshot so that users see data immediately without a loading spinner — and without wasting a network request for fresh data.

[ref: ../01-research/03-problem-analysis-part1.md#Bug #1]
[ref: 04-decisions.md#ADR-1]

### Primary Pattern — Fresh Snapshot (No Fetch Triggered)

```typescript
import { createApi, ReactHooksPlugin, type TApiSnapshot } from "@anthropic/rx-toolkit/query-v2";

// Server-side: capture snapshot
const serverApi = createApi({
  keyPrefix: "myApp",
  plugins: [ReactHooksPlugin()],
});

const usersResource = serverApi.createResourceV2({
  key: "users",
  queryFn: async (args: { id: number }) => {
    const res = await fetch(`/api/users/${args.id}`);
    return res.json() as Promise<{ name: string; email: string }>;
  },
});

// Pre-fetch on server
await usersResource.query({ id: 1 });
const snapshot: TApiSnapshot = serverApi.getSnapshot();

// Client-side: hydrate from snapshot
const clientApi = createApi({
  keyPrefix: "myApp",
  initialSnapshot: snapshot,
  maxSnapshotDataAge: 60_000, // 60 seconds
  plugins: [ReactHooksPlugin()],
});

const clientUsersResource = clientApi.createResourceV2({
  key: "users",
  queryFn: async (args: { id: number }) => {
    // This is NOT called for hydrated entries within maxSnapshotDataAge
    const res = await fetch(`/api/users/${args.id}`);
    return res.json();
  },
});
```

**Expected behavior (post-fix):**
- Entry for `{ id: 1 }` starts directly in `MachineSuccess` state from snapshot data.
- `queryFn` is **not** called — zero network requests for fresh hydrated entries.
- `$cacheDataLoaded` remains pending (no actual network fetch occurred).
- The React component reads data immediately via `useResourceV2Agent`.

[ref: 01-architecture.md#6. Sequence Diagram — Snapshot Hydration]
[ref: 02-dataflow.md#1. Snapshot Hydration Flow]

### React Integration — Hydrated Resource

```typescript
function UserProfile({ userId }: { userId: number }) {
  const { data, isLoading, isSuccess } = clientUsersResource.useResourceV2Agent({ id: userId });

  // For userId=1 (hydrated): isSuccess=true immediately, no loading spinner
  if (isLoading) return <Spinner />;
  if (!isSuccess || !data) return null;

  return (
    <div>
      <h2>{data.name}</h2>
      <p>{data.email}</p>
    </div>
  );
}
```

### Edge Case — Stale Snapshot (Refetch Triggered)

```typescript
// Snapshot was captured 2 minutes ago; maxSnapshotDataAge is 60 seconds
const staleSnapshot: TApiSnapshot = {
  version: 1,
  keyPrefix: "myApp",
  resources: {
    users: {
      entries: [
        {
          args: { id: 1 },
          machine: {
            status: "success",
            data: { name: "Alice", email: "alice@example.com" },
            updatedAt: Date.now() - 120_000, // 2 minutes ago
          },
        },
      ],
    },
  },
};

const api = createApi({
  keyPrefix: "myApp",
  initialSnapshot: staleSnapshot,
  maxSnapshotDataAge: 60_000,
  plugins: [ReactHooksPlugin()],
});

const usersResource = api.createResourceV2({
  key: "users",
  queryFn: async (args: { id: number }) => {
    // Called for stale entries — Date.now() - updatedAt > maxSnapshotDataAge
    const res = await fetch(`/api/users/${args.id}`);
    return res.json();
  },
});
```

**Expected behavior:**
- Entry for `{ id: 1 }` is hydrated to `MachineSuccess` via `initialMachine` (no constructor fetch).
- `maxSnapshotDataAge` check detects `120_000 > 60_000` → calls `entry.invalidate()`.
- `invalidate()` transitions to `MachineRefreshing(staleData)` and triggers `_doFetch()`.
- User sees stale data immediately, then sees fresh data when `queryFn` resolves.

[ref: ../01-research/01-codebase-analysis.md#1. Entry Point: createApi]

### Edge Case — Invalid Snapshot Version

```typescript
const invalidSnapshot: TApiSnapshot = {
  version: 999, // unsupported version
  keyPrefix: "myApp",
  resources: {},
};

// createApi validates snapshot version at creation time
// Invalid version → snapshot ignored, entries created normally via queryFn
const api = createApi({
  keyPrefix: "myApp",
  initialSnapshot: invalidSnapshot,
  plugins: [ReactHooksPlugin()],
});
```

**Expected behavior:** Snapshot validation fails at `createApi` (version mismatch). No hydration occurs. All entries are created normally with `MachinePending` + `_doFetch()`.

[ref: ../01-research/01-codebase-analysis.md#1. Entry Point: createApi]

---

## 2. `onQueryStarted` Optimistic Update

### User Story

As a developer implementing an edit form, I want to optimistically update the cached user data before the server confirms the mutation, and roll back the optimistic change if the server rejects it.

[ref: ../01-research/03-problem-analysis-part1.md#Bug #2]
[ref: 04-decisions.md#ADR-2]

### Primary Pattern — Optimistic Patch with `$queryFulfilled`

```typescript
import { createApi, ReactHooksPlugin } from "@anthropic/rx-toolkit/query-v2";

interface User {
  id: number;
  name: string;
  email: string;
}

const api = createApi({
  keyPrefix: "myApp",
  plugins: [ReactHooksPlugin()],
});

const usersResource = api.createResourceV2({
  key: "users",
  queryFn: async (args: { id: number }): Promise<User> => {
    const res = await fetch(`/api/users/${args.id}`);
    return res.json();
  },
  onQueryStarted: async (args, { $queryFulfilled, getCacheEntry }) => {
    // This fires on every _doFetch invocation (post Bug #2 fix)
    console.log("Query started for", args);

    try {
      const { data } = await $queryFulfilled;
      console.log("Query fulfilled with", data);
    } catch (error) {
      console.log("Query failed with", error);
    }
  },
});
```

**Lifecycle (post-fix):**
1. `_doFetch()` called → `fireQueryStarted(args, entry)` invoked.
2. `onQueryStarted` callback receives `{ $queryFulfilled, getCacheEntry }`.
3. `queryFn` executes.
4. On success: `$queryFulfilled` resolves with `{ data }`.
5. On error: `$queryFulfilled` rejects with the error.

[ref: 01-architecture.md#5. Sequence Diagram — Fetch Lifecycle]
[ref: 02-dataflow.md#2. Fetch Lifecycle with onQueryStarted]

### Optimistic Update with Rollback

```typescript
const updateUserResource = api.createResourceV2({
  key: "updateUser",
  queryFn: async (args: { id: number; name: string }): Promise<User> => {
    const res = await fetch(`/api/users/${args.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: args.name }),
    });
    return res.json();
  },
  onQueryStarted: async (args, { $queryFulfilled }) => {
    // Step 1: Apply optimistic patch to the read resource
    const entry = usersResource.getEntry({ id: args.id });
    if (!entry) return;

    const patchHandle = entry.createPatch((draft) => {
      draft.name = args.name; // Optimistically apply the new name
    });

    if (!patchHandle) return;

    try {
      // Step 2: Wait for server confirmation
      await $queryFulfilled;
      // Step 3: Success — commit the optimistic patch
      patchHandle.commit();
    } catch {
      // Step 4: Failure — roll back the optimistic patch
      patchHandle.abort();
    }
  },
});
```

**Lifecycle:**
1. `queryStarted` → `onQueryStarted` callback invoked.
2. Optimistic patch applied via `entry.createPatch()` — user sees updated name immediately.
3. `queryFn` fires the PUT request.
4. **Success**: `$queryFulfilled` resolves → `patchHandle.commit()` finalizes the patch.
5. **Error**: `$queryFulfilled` rejects → `patchHandle.abort()` reverts to original data.

[ref: ../01-research/02-external-research.md#2. Lifecycle Hooks]

### React Integration — Optimistic UI

```typescript
function EditUserName({ userId }: { userId: number }) {
  const { data, isSuccess } = usersResource.useResourceV2Agent({ id: userId });
  const [inputName, setInputName] = React.useState("");

  const handleSave = () => {
    // Trigger the update — optimistic patch is applied in onQueryStarted
    updateUserResource.query({ id: userId, name: inputName });
  };

  if (!isSuccess || !data) return <Spinner />;

  return (
    <div>
      {/* data.name updates optimistically, then confirms or rolls back */}
      <p>Current name: {data.name}</p>
      <input value={inputName} onChange={(e) => setInputName(e.target.value)} />
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
```

### Edge Case — Abort During `onQueryStarted`

```typescript
const resource = api.createResourceV2({
  key: "abortable",
  queryFn: async (args: { id: number }, { abortSignal }) => {
    const res = await fetch(`/api/data/${args.id}`, { signal: abortSignal });
    return res.json();
  },
  onQueryStarted: async (args, { $queryFulfilled }) => {
    const entry = someResource.getEntry(args);
    const patchHandle = entry?.createPatch((draft) => {
      draft.optimistic = true;
    });

    try {
      await $queryFulfilled;
      patchHandle?.commit();
    } catch {
      // If a newer _doFetch supersedes this one (stale controller),
      // $queryFulfilled is NOT settled for this invocation.
      // The newer _doFetch creates its own onQueryStarted lifecycle.
      //
      // However, if the entry is removed (resetCache/GC), clearAll()
      // rejects all outstanding _queryResolvers, causing this catch
      // to fire. Roll back the patch safely:
      patchHandle?.abort();
    }
  },
});
```

**Expected behavior on abort (stale supersession):** The stale `_doFetch` returns early without settling `$queryFulfilled`. The old resolver is orphaned but will be rejected by `clearAll()` on cache reset. The newer `_doFetch` has its own `fireQueryStarted` → new `$queryFulfilled`. The user's `onQueryStarted` for the stale fetch effectively hangs until cache reset — this matches RTK Query's behavior where each dispatch creates a new lifecycle.

[ref: 02-dataflow.md#$queryFulfilled Promise Timing]

---

## 3. SWR Error Handling in React

### User Story

As a React developer, I want to show an error banner when a refetch fails, while continuing to display stale data from the previous successful fetch — so the user isn't left with a blank screen.

[ref: ../01-research/03-problem-analysis-part1.md#Bug #3]
[ref: 04-decisions.md#ADR-3]

### Pattern A — Cross-Args Refetch Failure (Error + Stale Data)

```typescript
const postsResource = api.createResourceV2({
  key: "posts",
  queryFn: async (args: { userId: number }) => {
    const res = await fetch(`/api/users/${args.userId}/posts`);
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    return res.json() as Promise<{ title: string }[]>;
  },
});

function UserPosts({ userId }: { userId: number }) {
  const { data, error, isError, isRefreshing, status, lastError } =
    postsResource.useResourceV2Agent({ userId });

  return (
    <div>
      {/* Error banner — shown when isError is true, even with stale data */}
      {isError && error && (
        <div className="error-banner">
          Failed to load posts for user {userId}: {String(error)}
          <button onClick={() => postsResource.query({ userId })}>Retry</button>
        </div>
      )}

      {/* Stale data — rendered alongside error banner */}
      {data && (
        <ul className={isError ? "stale-data" : ""}>
          {data.map((post, i) => (
            <li key={i}>{post.title}</li>
          ))}
        </ul>
      )}

      {/* Loading state — no data available yet */}
      {!data && !isError && <Spinner />}
    </div>
  );
}
```

**Scenario walkthrough (post-fix):**

1. `userId=1` → `queryFn` resolves → `{ status: "success", data: [...], isError: false }`.
2. `userId=2` → entry for userId=1 saved as `previous$`. New entry in `MachinePending`.
3. SWR kicks in: `{ status: "refreshing", data: userId1Posts, isError: false }` — user sees previous posts while loading.
4. `userId=2` `queryFn` **rejects** → `MachineError`.
5. **Post-fix state**: `{ status: "refreshing", data: userId1Posts, error: Error, isError: true }`.
   - `isError: true` ← derived from `originalStatus` ("error") before SWR override. ✓
   - `data: userId1Posts` ← stale data from `previous$`. ✓
   - `error: Error` ← from `currentMachine.error`. ✓
   - `previous$` cleared ← `originalStatus === "error"` triggers clearing. ✓

[ref: 02-dataflow.md#3. SWR Error State Derivation]
[ref: ../01-research/02-external-research.md#3. SWR Error State Management]

### Pattern B — Same-Args Refetch Failure (`lastError`)

```typescript
function UserPostsWithLastError({ userId }: { userId: number }) {
  const { data, isSuccess, lastError } = postsResource.useResourceV2Agent({ userId });

  return (
    <div>
      {/* lastError banner — data is still valid but may be stale */}
      {isSuccess && lastError && (
        <div className="warning-banner">
          Data may be outdated — last refresh failed: {String(lastError)}
          <button onClick={() => postsResource.invalidate({ userId })}>
            Retry refresh
          </button>
        </div>
      )}

      {isSuccess && data && (
        <ul>
          {data.map((post, i) => (
            <li key={i}>{post.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Scenario walkthrough:**

1. `queryFn` resolves → `MachineSuccess` with `lastError: undefined`. Shows data, no warning.
2. `invalidate()` called → `MachineRefreshing`. `queryFn` runs again.
3. `queryFn` **rejects** → `MachineRefreshing.errorHappened(error)` → `MachineSuccess({ data: staleData, lastError: error })`.
4. Agent state: `{ status: "success", isSuccess: true, data: staleData, lastError: error }`.
5. Component shows data + warning banner about stale data.
6. Next successful `invalidate()` → `MachineSuccess` without `lastError` → warning disappears.

[ref: 03-model.md#1. MachineSuccess Type Extension]
[ref: 04-decisions.md#ADR-6]

### Edge Case — `previous$` with `lastError`

When cross-args SWR provides stale data from a previous entry that itself had `lastError`:

```typescript
// Scenario:
// 1. userId=1 fetched successfully, then invalidated → refetch fails → lastError set
// 2. Switch to userId=2 → previous$ = userId=1 entry (MachineSuccess with lastError)
// 3. userId=2 fetching...

// Agent state during step 3 (pending + previous$):
// {
//   status: "refreshing",     // SWR override
//   data: userId1Data,        // from previous$
//   error: null,              // pending, not error
//   isError: false,           // originalStatus is "pending"
//   lastError: undefined,     // comes from current machine, not previous$
// }
```

**Design note:** `lastError` in the derived state comes from the **current** machine's `lastError`, not from `previous$`. When the current entry is `MachinePending`, `lastError` is `undefined` regardless of what `previous$` carries. This is intentional — `lastError` reflects the current entry's refetch history, not the previous entry's.

---

## 4. Patcher Consistency Violation Recovery

### User Story

As a developer using optimistic patches, I want the system to automatically recover when an optimistic patch becomes structurally incompatible with server data — by detecting the consistency violation, invalidating the cache, and refetching fresh data.

[ref: ../01-research/04-problem-analysis-part2.md#Bug #4]
[ref: 04-decisions.md#ADR-4]

### Primary Pattern — Violation Detection and Auto-Invalidation

```typescript
const todosResource = api.createResourceV2({
  key: "todos",
  queryFn: async (args: { listId: number }) => {
    const res = await fetch(`/api/lists/${args.listId}/todos`);
    return res.json() as Promise<{ items: { id: number; text: string }[] }>;
  },
});

// Step 1: Data loaded — { items: [{ id: 1, text: "Buy milk" }] }
// Step 2: Optimistic patch — add a todo
const entry = todosResource.getEntry({ listId: 1 });
const patchHandle = entry?.createPatch((draft) => {
  draft.items.push({ id: 99, text: "Optimistic todo" });
});
// Patched state: { items: [{ id: 1, text: "Buy milk" }, { id: 99, text: "Optimistic todo" }] }

// Step 3: Meanwhile, a refetch returns completely different structure
// Server returns: { items: [] } (list was cleared server-side)
// Patcher.resolvePatches tries to apply the patch on []:
//   - applyPatches([], forwardPatches) → THROWS (structural mismatch)

// Step 4 (post-fix): resolvePatches returns:
//   { data: currentData, patchState: { patches: [], isConsistencyViolation: true } }

// Step 5: _finishPatch detects:
//   resolution.patchState?.isConsistencyViolation === true → invalidate()

// Step 6: invalidate() → MachineRefreshing → _doFetch → fresh server data
// Data converges to server truth: { items: [] }
```

**Post-fix flow:**
1. `applyPatches` throws in `resolvePatches` catch block.
2. Catch returns `{ patchState: { patches: [], isConsistencyViolation: true } }` instead of `{ patchState: null }`.
3. `_finishPatch` checks `patchState?.isConsistencyViolation === true` → `true`.
4. `entry.invalidate()` → `MachineRefreshing` → `_doFetch()` → fresh data from server.
5. Entry data converges to server truth.

[ref: 03-model.md#4. Patcher.resolvePatches Return Type]
[ref: 02-dataflow.md#4. Patcher Commit with Consistency Violation]

### React Integration — Transparent Recovery

```typescript
function TodoList({ listId }: { listId: number }) {
  const { data, isRefreshing, isSuccess } = todosResource.useResourceV2Agent({ listId });

  // The consumer is unaware of the consistency violation.
  // From the React perspective:
  //   1. data = patched data (optimistic)
  //   2. brief MachineRefreshing (auto-invalidation refetch)
  //   3. data = server truth (fresh)

  if (!isSuccess && !isRefreshing) return <Spinner />;

  return (
    <ul>
      {data?.items.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
      {isRefreshing && <li className="loading">Syncing...</li>}
    </ul>
  );
}
```

### Edge Case — Commit-Path vs Abort-Path Detection

```typescript
// Commit path (post-fix): uses primary detection
// resolution.patchState?.isConsistencyViolation === true → detected ✓

// Abort path: uses secondary heuristic
// resolution.patchState === null && type === "aborted" && prevPatches.some(p => p !== patch) → detected ✓

// Both paths lead to invalidate() → refetch → server truth
```

[ref: 02-dataflow.md#_finishPatch Detection — Data Flow]

---

## 5. Cache Reset with Pending Queries

### User Story

As a developer implementing a logout flow, I want `resetCache()` to cleanly tear down all pending queries — rejecting `$cacheDataLoaded` promises, aborting inflight fetches, and leaving no hanging promises that could cause memory leaks.

[ref: ../01-research/04-problem-analysis-part2.md#Bug #5]
[ref: 04-decisions.md#ADR-5]

### Primary Pattern — `resetCache()` Rejects `$cacheDataLoaded`

```typescript
const api = createApi({
  keyPrefix: "myApp",
  plugins: [ReactHooksPlugin()],
});

const usersResource = api.createResourceV2({
  key: "users",
  queryFn: async (args: { id: number }) => {
    const res = await fetch(`/api/users/${args.id}`);
    return res.json();
  },
  onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
    // MUST wrap $cacheDataLoaded in try/catch (matches RTK Query pattern)
    try {
      const { data } = await $cacheDataLoaded;
      // Set up streaming, WebSocket subscription, etc.
      const ws = new WebSocket(`/ws/users/${args.id}`);

      await $cacheEntryRemoved;
      // Cleanup when entry is removed
      ws.close();
    } catch {
      // $cacheDataLoaded rejected:
      //   - "Promise never resolved before cacheEntryRemoved." (entry destroyed)
      //   - "Cache cleared" (fallback from clearAll)
      // No streaming setup needed — entry is already gone
    }
  },
});

// Trigger a query (entry in MachinePending — data not yet loaded)
usersResource.query({ id: 1 });

// Before data arrives, reset the cache
usersResource.resetCache();
```

**Expected behavior (post-fix):**
1. `query({ id: 1 })` creates entry → `MachinePending` → `_doFetch()` starts.
2. `onCacheEntryAdded` fires → `$cacheDataLoaded` is pending.
3. `resetCache()` calls `entry.complete()` → aborts inflight fetch → fires `onClean$`.
4. `fireCacheEntryRemoved` runs:
   - `dataLoaded.reject(new Error("Promise never resolved before cacheEntryRemoved."))` — `$cacheDataLoaded` rejected. ✓
   - `entryRemoved.resolve()` — `$cacheEntryRemoved` resolved.
   - Resolver deleted from `_entryResolvers`.
5. `clearAll()` runs on empty `_entryResolvers` — safe no-op for entry resolvers.
6. No hanging promises. `onCacheEntryAdded` catch block fires, skips WebSocket setup.

[ref: 02-dataflow.md#5. Cache Reset Promise Rejection]
[ref: ../01-research/02-external-research.md#5. Cache Reset and Pending Promises]

### Edge Case — `onQueryStarted` During Cache Reset

```typescript
const resource = api.createResourceV2({
  key: "data",
  queryFn: async (args: { id: number }) => {
    await new Promise((r) => setTimeout(r, 5000)); // slow query
    return { id: args.id };
  },
  onQueryStarted: async (args, { $queryFulfilled }) => {
    try {
      const { data } = await $queryFulfilled;
      // Won't reach here if resetCache is called first
    } catch (error) {
      // $queryFulfilled rejected by clearAll():
      //   - Error("Cache cleared")
      console.log("Query interrupted:", error);
    }
  },
});

resource.query({ id: 1 });
// While queryFn is executing:
resource.resetCache();
// clearAll() rejects outstanding _queryResolvers → $queryFulfilled rejects
```

**Expected behavior:** `$queryFulfilled` is rejected by `clearAll()` with `Error("Cache cleared")`. The `onQueryStarted` catch block fires. No hanging promise.

### Edge Case — Concurrent Cache Reset During Fetch

```typescript
// Scenario: Two rapid resetCache calls while a fetch is pending
resource.query({ id: 1 }); // starts fetch
resource.resetCache();      // aborts fetch, rejects promises, clears cache
resource.query({ id: 1 }); // creates new entry, starts new fetch
resource.resetCache();      // aborts new fetch, rejects new promises

// Each resetCache cleanly tears down:
//   1. entry.complete() → abort + fireCacheEntryRemoved (rejects $cacheDataLoaded)
//   2. clearAll() → rejects _queryResolvers
// No accumulated hanging promises across multiple reset cycles.
```

---

## 6. SKIP Token Usage — Conditional Queries

### User Story

As a React developer, I want to skip a query when the required arguments are not yet available (e.g., waiting for user selection) — and have the query activate automatically when valid arguments are provided.

[ref: ../01-research/01-codebase-analysis.md#4. ResourceV2Agent]

### Primary Pattern — Conditional Fetch with `SKIP`

```typescript
import { SKIP, type SKIP_TOKEN } from "@anthropic/rx-toolkit/query-v2";

const userDetailsResource = api.createResourceV2({
  key: "userDetails",
  queryFn: async (args: { userId: number }) => {
    const res = await fetch(`/api/users/${args.userId}/details`);
    return res.json();
  },
});

function UserDetails({ userId }: { userId: number | null }) {
  const state = userDetailsResource.useResourceV2Agent(
    userId !== null ? { userId } : SKIP,
  );

  // When userId is null:
  //   state = { status: "idle", data: null, isLoading: false, isError: false }
  //   No queryFn call. No entry created.

  // When userId becomes non-null (e.g., 42):
  //   state transitions: "idle" → "pending" → "success"
  //   queryFn called with { userId: 42 }

  if (state.status === "idle") {
    return <p>Select a user to view details</p>;
  }

  if (state.isLoading) return <Spinner />;
  if (state.isError) return <ErrorMessage error={state.error} />;

  return (
    <div>
      <h2>{state.data.name}</h2>
      <p>{state.data.bio}</p>
    </div>
  );
}
```

### Pattern — SKIP with Dependent Queries

```typescript
function UserWithPosts() {
  const [selectedUserId, setSelectedUserId] = React.useState<number | null>(null);

  // First query: always active
  const userList = usersListResource.useResourceV2Agent({ page: 1 });

  // Second query: depends on selection — skipped until userId is available
  const userPosts = postsResource.useResourceV2Agent(
    selectedUserId !== null ? { userId: selectedUserId } : SKIP,
  );

  return (
    <div>
      <UserList
        users={userList.data?.users ?? []}
        onSelect={(id) => setSelectedUserId(id)}
      />
      {selectedUserId === null ? (
        <p>Select a user to see their posts</p>
      ) : userPosts.isLoading ? (
        <Spinner />
      ) : (
        <PostList posts={userPosts.data ?? []} />
      )}
    </div>
  );
}
```

### Pattern — SKIP Toggle (Activate/Deactivate)

```typescript
function ToggleableQuery({ enabled }: { enabled: boolean }) {
  const state = someResource.useResourceV2Agent(
    enabled ? { id: 1 } : SKIP,
  );

  // enabled=false → "idle" state, no fetch
  // enabled=true  → fetches { id: 1 }
  // enabled=false again → agent stops tracking, reverts to "idle"
  //   (existing cache entry is NOT destroyed — only the agent stops observing)

  return (
    <div>
      <p>Status: {state.status}</p>
      {state.data && <pre>{JSON.stringify(state.data, null, 2)}</pre>}
    </div>
  );
}
```

**Key behavior:** `SKIP` prevents the agent from starting. When `SKIP` is replaced with real args, the agent starts tracking the entry (creating it if necessary). When args revert to `SKIP`, the agent stops — but the cache entry persists until GC or `resetCache`.

---

## 7. Combined Edge Cases

### Edge Case — Expired Snapshot + `onQueryStarted` Interaction

```typescript
const api = createApi({
  keyPrefix: "myApp",
  initialSnapshot: staleSnapshot, // all entries exceed maxSnapshotDataAge
  maxSnapshotDataAge: 30_000,
  plugins: [ReactHooksPlugin()],
});

const resource = api.createResourceV2({
  key: "data",
  queryFn: async (args: { id: number }) => {
    const res = await fetch(`/api/data/${args.id}`);
    return res.json();
  },
  onQueryStarted: async (args, { $queryFulfilled }) => {
    try {
      const { data } = await $queryFulfilled;
      console.log("Refetch completed:", data);
    } catch (error) {
      console.log("Refetch failed:", error);
    }
  },
});
```

**Expected behavior:**
1. Entry hydrated with `initialMachine` → `MachineSuccess` (no `_doFetch`, no `onQueryStarted`).
2. `maxSnapshotDataAge` check → stale → `entry.invalidate()` → `MachineRefreshing`.
3. `invalidate()` triggers `_doFetch()` → `fireQueryStarted()` → `onQueryStarted` callback fires.
4. `$queryFulfilled` settles based on `queryFn` result.
5. `onQueryStarted` does NOT fire during hydration — only during the subsequent invalidation-triggered fetch.

### Edge Case — `resetCache` During `onQueryStarted` Optimistic Update

```typescript
const resource = api.createResourceV2({
  key: "items",
  queryFn: async (args: { id: number }) => {
    await new Promise((r) => setTimeout(r, 3000)); // 3s delay
    return { id: args.id, value: "server" };
  },
  onQueryStarted: async (args, { $queryFulfilled }) => {
    const entry = otherResource.getEntry(args);
    const patchHandle = entry?.createPatch((draft) => {
      draft.value = "optimistic";
    });

    try {
      await $queryFulfilled;
      patchHandle?.commit();
    } catch {
      // resetCache triggers this catch via clearAll() rejecting _queryResolvers
      patchHandle?.abort();
      // abort() on an already-completed entry is a no-op (entry was destroyed by resetCache)
    }
  },
});

resource.query({ id: 1 });
// 1s later:
resource.resetCache();
// → entry.complete() aborts fetch, clears _patchState
// → fireCacheEntryRemoved rejects $cacheDataLoaded
// → clearAll() rejects $queryFulfilled
// → onQueryStarted catch fires → patchHandle.abort() (no-op on destroyed entry)
// No hanging promises. No leaked optimistic patches.
```

### Edge Case — `previous$` Entry Has `lastError`, Then New Args Succeed

```typescript
// Timeline:
// 1. agent.start({ id: 1 }) → success
// 2. invalidate({ id: 1 }) → refetch fails → MachineSuccess({ lastError: error })
// 3. agent.start({ id: 2 }) → previous$ = entry({ id: 1 }) with lastError
// 4. id=2 fetching... → SWR shows id=1 data
//    state: { status: "refreshing", data: id1Data, lastError: undefined }
//    (lastError from current pending entry, not previous$)
// 5. id=2 succeeds → MachineSuccess
//    state: { status: "success", data: id2Data, lastError: undefined }
//    previous$ cleared

// Key: lastError is always from the CURRENT entry, not from previous$.
// Switching args resets the lastError perspective to the new entry.
```
