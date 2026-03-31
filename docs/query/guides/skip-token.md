# SKIP Token

The `SKIP` token lets you conditionally disable a resource query. When you pass `SKIP` instead of arguments, the resource agent stays in an `idle` state and no network request is made. This is the idiomatic way to handle conditional fetching — no `if`/`enabled` flags needed.

## Import

```typescript
import { SKIP } from '@fozy-labs/rx-toolkit';
```

`SKIP` is a unique symbol. The corresponding TypeScript type is `SKIP_TOKEN`.

## Basic Usage

Pass `SKIP` as the argument to `useResourceAgent` (or `agent.start()`) when you don't want the query to fire:

```typescript
function UserProfile({ userId }: { userId: string | null }) {
  const state = userResource.useResourceAgent(
    userId ? { id: userId } : SKIP,
  );

  if (!userId) return <p>Select a user</p>;
  if (state.isLoading) return <Spinner />;

  return <h1>{state.data?.name}</h1>;
}
```

When `userId` becomes non-null, the resource starts fetching automatically. When it goes back to `null`, the agent returns to idle and the previous data is released.

## Common Patterns

### Auth-gated Data

Fetch data only when the user is authenticated:

```typescript
function Dashboard({ token }: { token: string | null }) {
  const state = dashboardResource.useResourceAgent(
    token ? { token } : SKIP,
  );

  if (!token) return <LoginPrompt />;
  if (state.isInitialLoading) return <Skeleton />;

  return <DashboardView data={state.data} />;
}
```

### Dependent Queries

Chain resources so the second one waits for the first to resolve:

```typescript
function UserPosts({ userId }: { userId: string }) {
  const userState = userResource.useResourceAgent({ id: userId });

  const postsState = postsResource.useResourceAgent(
    userState.data ? { authorId: userState.data.id } : SKIP,
  );

  if (userState.isLoading || postsState.isLoading) return <Spinner />;

  return (
    <ul>
      {postsState.data?.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

### User Selection (Nothing Selected Yet)

A list–detail layout where the detail pane is empty until the user picks an item:

```typescript
function DetailPane({ selectedId }: { selectedId: string | null }) {
  const state = itemResource.useResourceAgent(
    selectedId ? { id: selectedId } : SKIP,
  );

  if (!selectedId) return <Placeholder text="Pick an item" />;
  if (state.isInitialLoading) return <Spinner />;
  if (state.isError) return <ErrorBanner error={state.error} />;

  return <ItemDetail item={state.data!} />;
}
```

## How It Works

Under the hood, when the agent receives `SKIP`:

1. It does **not** create or subscribe to any cache entry.
2. The agent state is set to `idle` with all flags `false` and all data fields `null`.
3. When the argument changes from `SKIP` to a real value, the agent starts normally.
4. When it changes from a real value to `SKIP`, the agent unsubscribes and goes idle.

This means garbage collection timers start as soon as the agent receives `SKIP`, just like a component unmounting.

## Type Signature

The argument type for hooks and `agent.start()` is `ArgsOrVoidOrSkip<TArgs>`:

```typescript
// If TArgs = void  → () | (SKIP_TOKEN)
// If TArgs = T     → (T) | (SKIP_TOKEN)
type ArgsOrVoidOrSkip<TArgs> =
  TArgs extends void ? [args?: SKIP_TOKEN] : [args: TArgs | SKIP_TOKEN];
```

This gives you full type safety — the compiler enforces that you pass either valid args or `SKIP`, nothing else.
