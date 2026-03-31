# Commands

Commands represent mutations — write operations that change server state. Unlike resources (which model reads), a command fires once when you call `trigger()` and transitions through `idle → loading → success | error`. Commands can be linked to resources to automatically invalidate or optimistically update cached data after a mutation completes.

## Creating a Command

```typescript
const addTodoCommand = api.createCommand<{ text: string }, Todo>({
  queryFn: async (args, { abortSignal }) => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: args.text }),
      signal: abortSignal,
    });
    return res.json();
  },
});
```

### Command Options

| Option | Type | Description |
|--------|------|-------------|
| `queryFn` | `(args, tools) => Promise<TResult>` | Async mutation function |
| `link` | `CommandLink[]` | Resource links for post-mutation effects |
| `onCacheEntryAdded` | `(args, tools) => void` | Lifecycle hook — entry created |
| `onQueryStarted` | `(args, tools) => void` | Lifecycle hook — mutation started |
| `cacheLifetime` | `number \| false` | Cache lifetime for the command's own result |
| `devtoolsName` | `string` | Label shown in devtools |

## Using Commands in React

The `ReactHooksPlugin` adds `useCommandAgent()` to the command instance. It returns a `[trigger, state]` tuple — similar to the `useMutation` pattern.

```typescript
function AddTodoForm() {
  const [trigger, state] = addTodoCommand.useCommandAgent();

  const handleSubmit = async (text: string) => {
    try {
      const newTodo = await trigger({ text });
      console.log('Created:', newTodo);
    } catch (err) {
      console.error('Failed:', err);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(e.currentTarget.text.value); }}>
      <input name="text" />
      <button disabled={state.isLoading}>
        {state.isLoading ? 'Saving…' : 'Add'}
      </button>
      {state.isError && <span>Error: {String(state.error)}</span>}
    </form>
  );
}
```

## Command Agent State

`TCommandAgentState<TArgs, TResult>` is a 4-branch discriminated union:

| Property | Type | Description |
|----------|------|-------------|
| `status` | `'idle' \| 'loading' \| 'success' \| 'error'` | Current status |
| `data` | `TResult \| null` | Result from the last successful mutation |
| `error` | `unknown` | Error from the last failed mutation |
| `args` | `TArgs \| null` | Arguments of the last trigger call |
| `isLoading` | `boolean` | `true` while the mutation is in flight |
| `isSuccess` | `boolean` | `true` after a successful mutation |
| `isError` | `boolean` | `true` after a failed mutation |

## Resource Invalidation with `link`

The most common post-mutation effect is invalidating a cached resource so it refetches fresh data. Use `commandLink()` to create a type-safe link:

```typescript
import { commandLink } from '@fozy-labs/rx-toolkit';

const deleteTodoCommand = api.createCommand<{ id: string }, void>({
  queryFn: async (args) => {
    await fetch(`/api/todos/${args.id}`, { method: 'DELETE' });
  },
  link: [
    commandLink({
      resource: todosResource,
      forwardArgs: () => undefined as void, // todosResource takes void args
      invalidate: true,
    }),
  ],
});
```

When `invalidate: true`, the linked resource refetches after the command succeeds.

## Optimistic Updates via `link`

For instant UI feedback, use `optimisticUpdate` to patch the resource cache _before_ the server responds. If the mutation fails, patches are rolled back automatically.

```typescript
const toggleTodoCommand = api.createCommand<{ id: string; done: boolean }, void>({
  queryFn: async (args) => {
    await fetch(`/api/todos/${args.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: args.done }),
    });
  },
  link: [
    commandLink({
      resource: todosResource,
      forwardArgs: () => undefined as void,
      invalidate: true,
      optimisticUpdate: ({ draft, args }) => {
        const todo = draft.find((t) => t.id === args.id);
        if (todo) todo.done = args.done;
      },
    }),
  ],
});
```

You can also use `update` (runs _after_ the mutation succeeds) to apply the server response directly to the cached data without a full refetch.

## Chaining Commands

`trigger()` returns a Promise, so commands naturally chain:

```typescript
async function createAndSelect(text: string) {
  const newTodo = await addTodoCommand.createAgent().trigger({ text });
  await selectTodoCommand.createAgent().trigger({ id: newTodo.id });
}
```

Inside React, use the tuple form from `useCommandAgent()`:

```typescript
const [addTrigger] = addTodoCommand.useCommandAgent();
const [selectTrigger] = selectTodoCommand.useCommandAgent();

const handleCreate = async (text: string) => {
  const todo = await addTrigger({ text });
  await selectTrigger({ id: todo.id });
};
```

## Resetting Command State

Call `reset()` on the agent to return to `idle`:

```typescript
const agent = addTodoCommand.createAgent();
agent.reset(); // state → { status: 'idle', ... }
```

Inside React the component simply unmounts — the hook cleans up automatically.
