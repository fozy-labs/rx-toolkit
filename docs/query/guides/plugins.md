# Plugins

Plugins extend resources and commands with additional methods. The plugin system is the mechanism through which React integration is provided — it's not hard-coded into the core. This keeps the query runtime framework-agnostic while allowing first-class React (or any other framework) support.

## The `IPlugin` Interface

Every plugin implements `IPlugin`:

```typescript
interface IPlugin {
  readonly name: string;
  install(context: IPluginContext): void;
  augmentResource?<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    options: TResourceOptions<TArgs, TData>,
  ): Record<string, unknown>;
  augmentCommand?<TArgs, TResult>(
    command: ICommand<TArgs, TResult>,
    options: TCommandOptions<TArgs, TResult>,
  ): Record<string, unknown>;
}
```

| Method | When it runs | Purpose |
|--------|-------------|---------|
| `install(context)` | Once, during `createApi()` | Global setup. Receives `IPluginContext` with `keyStrategy` info |
| `augmentResource(resource, options)` | Per `createResource()` call | Return an object of methods to mix into the resource |
| `augmentCommand(command, options)` | Per `createCommand()` call | Return an object of methods to mix into the command |

## Built-in: `ReactHooksPlugin`

The library ships `ReactHooksPlugin` which adds React hooks to every resource and command:

```typescript
import { createApi, ReactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [new ReactHooksPlugin()],
});

const userResource = api.createResource<{ id: string }, User>({
  key: 'users',
  queryFn: fetchUser,
});

// `useResourceAgent` is now available on the resource
function Profile({ id }: { id: string }) {
  const state = userResource.useResourceAgent({ id });
  return <div>{state.data?.name}</div>;
}

// `useCommandAgent` is available on commands
const updateCmd = api.createCommand<UpdateArgs, void>({ queryFn: updateUser });

function EditForm() {
  const [trigger, state] = updateCmd.useCommandAgent();
  // ...
}
```

### What ReactHooksPlugin Adds

| Target | Method | Signature |
|--------|--------|-----------|
| Resource | `useResourceAgent` | `(...args: ArgsOrVoidOrSkip<TArgs>) => TResourceAgentState<TArgs, TData>` |
| Command | `useCommandAgent` | `() => [trigger, TCommandAgentState<TArgs, TResult>]` |

> You can also use the standalone hooks `useResourceAgent(resource, args)` and `useCommandAgent(command)` without the plugin — the plugin simply makes the API more ergonomic.

## Creating a Custom Plugin

Implement `IPlugin` and return contributed methods from `augmentResource` / `augmentCommand`:

```typescript
class LoggingPlugin implements IPlugin {
  readonly name = 'LoggingPlugin';

  install(context: IPluginContext): void {
    console.log('API created with keyStrategy:', context.keyStrategy);
  }

  augmentResource<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    options: TResourceOptions<TArgs, TData>,
  ): Record<string, unknown> {
    return {
      debugQuery(...args: unknown[]) {
        console.log(`[${options.key}] query called with`, args);
        return (resource as any).query(...args);
      },
    };
  }
}
```

Register it alongside other plugins:

```typescript
const api = createApi({
  plugins: [new ReactHooksPlugin(), new LoggingPlugin()],
});
```

## Type-level Augmentation

Plugin contributions are automatically typed via `PluginAugmentations` and `PluginCommandAugmentations`. For built-in plugins this works out of the box. For custom plugins, add a conditional branch to `PluginResourceContributions` / `PluginCommandContributions`:

```typescript
// Extend the contribution mapping
declare module '@anthropic-ai/rx-toolkit' {
  interface PluginResourceContributions<TPlugin, TArgs, TData> {
    // when TPlugin extends { name: 'MyPlugin' } → add methods
  }
}
```

This ensures that `api.createResource(...)` returns an object whose type includes your custom methods, with full IntelliSense support.

## Plugin Execution Order

- `install` is called in array order during `createApi()`.
- `augmentResource` / `augmentCommand` are called in array order for each created resource/command.
- If two plugins contribute a method with the same name, the last plugin wins.
