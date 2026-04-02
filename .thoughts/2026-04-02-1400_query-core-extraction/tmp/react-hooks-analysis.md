---
title: "React Hooks & Integration Layer — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The React integration layer is thin: two hooks (`useResourceAgent`, `useCommandAgent`), a `ReactHooksPlugin` that attaches them to entity instances, and a shared `useSignal` bridge from `@/signals/react`. Both hooks follow the same pattern — create an agent via `useConstant`, subscribe to its `state$` signal via `useSignal` — but differ in lifecycle (Resource is arg-driven SWR, Command is imperative trigger).

## Findings

### 1. Hook Inventory — `src/query/react/`

| File | Hook | Lines | Purpose |
|---|---|---|---|
| `useResourceAgent.ts` | `useResourceAgent` | 7–18 | Binds a `Resource` to React; arg-driven, SWR semantics |
| `useCommandAgent.ts` | `useCommandAgent` | 5–16 | Binds a `Command` to React; returns `[trigger, state]` tuple |
| `index.ts` | barrel | 1–2 | Re-exports both hooks |

### 2. `useResourceAgent` — Detailed Breakdown

- **Location**: `@/src/query/react/useResourceAgent.ts:7-18`
- **Signature**: `useResourceAgent<TArgs, TData>(resource, ...args: ArgsOrVoidOrSkip<TArgs>) → TResourceAgentState<TArgs, TData>`
- **Steps**:
  1. `useConstant(() => resource.createAgent())` — creates `ResourceAgent` once (no deps → never recreated)
  2. `React.useEffect(() => agent.start(...args), args)` — calls `agent.start()` on mount and when args change
  3. `useSignal(agent.state$)` — subscribes to the computed signal; returns current state
- **Key dependencies**:
  - `useConstant` from `@/common/react/useConstant.ts:8-27` — ref-based memoization with shallow deps comparison
  - `useSignal` from `@/signals/react/useSignal.ts:12-38` — `useSyncExternalStore` bridge for `SignalLike<T>` (needs `.obs` Observable + `.peek()`)
- **Supports SKIP_TOKEN**: yes — `ArgsOrVoidOrSkip<TArgs>` allows `SKIP` as first arg; agent's `start(SKIP)` clears tracking → idle state
- **No cleanup/unmount logic** in the hook itself — GC is handled by `CacheEntry`'s RxJS `share({ resetOnRefCountZero: () => timer(lifetime) })` when all subscribers drop

### 3. `useCommandAgent` — Detailed Breakdown

- **Location**: `@/src/query/react/useCommandAgent.ts:5-16`
- **Signature**: `useCommandAgent<TArgs, TResult>(command) → [trigger, state]`
- **Return type**: `[trigger: (...args: ArgsOrVoid<TArgs>) => Promise<TResult>, state: TCommandAgentState<TArgs, TResult>]`
- **Steps**:
  1. `useConstant(() => command.createAgent(), [command])` — creates `CommandAgent` once per `command` identity (recreated if `command` changes)
  2. `useSignal(agent.state$)` — subscribes to the computed signal
  3. `useEventHandler((...args) => agent.trigger(...args))` — stable callback ref that delegates to `agent.trigger()`
- **Key dependencies**:
  - `useConstant` from `@/common/react/useConstant.ts:8-27`
  - `useSignal` from `@/signals/react/useSignal.ts:12-38`
  - `useEventHandler` from `@/common/react/useEventHandler.ts:3-8` — ref-based stable callback (never triggers re-render from identity change)
- **Does NOT support SKIP_TOKEN**: uses `ArgsOrVoid<TArgs>`, not `ArgsOrVoidOrSkip`
- **No `useEffect`**: Command is imperative — no auto-initiation on mount
- **No cleanup/unmount**: same GC pattern as Resource via `CacheEntry`

### 4. State Subscription Mechanism — `useSignal`

- **Location**: `@/signals/react/useSignal.ts:12-38`
- **Pattern**: `React.useSyncExternalStore(subscribe, getSnapshot)`
  - `subscribe(update)`: subscribes to `signal$.obs` (RxJS Observable), calls `update()` via `queueMicrotask` on emission, returns unsubscribe function
  - `getSnapshot()`: calls `signal$.peek()` for non-reactive synchronous read, sets `doUpdateRef.current = false` to debounce
- **Interface requirement**: `SignalLike<T>` = `{ obs: Observable<T>; peek: () => T }`
  - Both `ResourceAgent.state$` and `CommandAgent.state$` satisfy this — they are `ComputeFn` signals which expose `.obs` and `.peek()` via the signals layer
- **Debounce detail**: `doUpdateRef.current` flag prevents redundant React re-renders when `getSnapshot` is called between microtask scheduling and execution

### 5. Shared vs Duplicated Between Resource and Command Hooks

#### Fully shared (identical usage)

| Utility | Location | Used in Resource hook | Used in Command hook |
|---|---|---|---|
| `useConstant` | `@/src/common/react/useConstant.ts:8-27` | ✅ (no deps) | ✅ (deps: `[command]`) |
| `useSignal` | `@/signals/react/useSignal.ts:12-38` | ✅ `useSignal(agent.state$)` | ✅ `useSignal(agent.state$)` |

#### Used only in one hook

| Utility | Location | Hook |
|---|---|---|
| `useEventHandler` | `@/src/common/react/useEventHandler.ts:3-8` | Command only — wraps `trigger` callback |
| `React.useEffect` | (React built-in) | Resource only — drives `agent.start()` on args change |

#### Structural differences

| Aspect | Resource hook | Command hook |
|---|---|---|
| Agent creation deps | `[]` (never recreated) | `[command]` (recreated if command identity changes) |
| Auto-initiation | Yes — `useEffect` calls `agent.start(...args)` | No — imperative `trigger()` only |
| SKIP support | Yes — `ArgsOrVoidOrSkip<TArgs>` | No — `ArgsOrVoid<TArgs>` |
| Return shape | Single `TResourceAgentState` object | `[trigger, state]` tuple |
| Trigger exposure | None — data fetching is automatic | `trigger` function returned to caller |

#### Pattern duplication

- Both hooks follow identical internal structure: **create agent → subscribe to state$ → return state**
- The only added step is: Resource adds `useEffect` for arg-driven start; Command adds `useEventHandler` for stable trigger ref
- There is **no abstracted shared hook** (e.g., `useAgent`) — each hook directly calls the same primitives independently

### 6. ReactHooksPlugin — What It Does

- **Location**: `@/src/query/plugins/ReactHooksPlugin.ts:1-43`
- **Implements**: `IPlugin` (`@/src/query/types/plugin.types.ts:13-29`)
- **`install()`** (line 16): no-op — no global setup needed
- **`augmentResource(resource, _options)`** (lines 20-28):
  - Returns `{ useResourceAgent(...args) { return useResourceAgent(resource, ...args) } }`
  - Closes over the `resource` instance — the returned method is a bound version of the standalone hook
- **`augmentCommand(command, _options)`** (lines 30-42):
  - Returns `{ useCommandAgent() { return useCommandAgent(command) } }`
  - Same closure pattern — bound to the `command` instance
- **Plugin application** happens in `createApi.ts`:
  - For resources: `@/src/query/api/createApi.ts:131-146` — iterates plugins, calls `augmentResource`, `Object.assign` onto resource
  - For commands: `@/src/query/api/createApi.ts:176-191` — same pattern for `augmentCommand`
  - Key collision detection across plugins at both sites

#### Type-level augmentation

- `IReactHooksPluginContributions<TArgs, TData>` at `@/src/query/types/plugin.types.ts:32-34` — adds `useResourceAgent` signature to resource type
- `IReactHooksPluginCommandContributions<TArgs, TResult>` at `@/src/query/types/plugin.types.ts:56-61` — adds `useCommandAgent` signature to command type
- `PluginResourceContributions` at `@/src/query/types/plugin.types.ts:41-43` — conditional type: if plugin has `name: "ReactHooksPlugin"` → include contributions
- `PluginCommandContributions` at `@/src/query/types/plugin.types.ts:66-68` — same pattern for commands
- `PluginAugmentations` at `@/src/query/types/plugin.types.ts:49-51` — `UnionToIntersection` of all plugin contributions for resource
- `PluginCommandAugmentations` at `@/src/query/types/plugin.types.ts:74-76` — same for commands

### 7. Public API Surface — `createResource` and `createCommand`

#### Standalone factories (plugin-less)

- **`_createResource`** at `@/src/query/api/_createResource.ts:4-8`
  - `_createResource<TArgs, TData>(options: TResourceOptions) → IResource<TArgs, TData>`
  - Just `new Resource(options)` — no plugin augmentation
- **`_createCommand`** at `@/src/query/api/_createCommand.ts:4-8`
  - `_createCommand<TArgs, TResult>(options: TCommandOptions) → ICommand<TArgs, TResult>`
  - Just `new Command(options)` — no plugin augmentation

#### API-integrated factories (with plugins)

- **`apiCreateResource`** at `@/src/query/api/createApi.ts:72-147`
  - Merges API defaults (`cacheLifetime`, `doCacheArgs`, `serializeArgs`/`compareArg` based on `keyStrategy`)
  - Creates `new Resource(mergedOptions)`
  - Registers in `_resources` Map by key (for snapshot/resetAll)
  - Hydrates from `initialSnapshot` if available
  - Runs plugin `augmentResource` loop → `Object.assign` contributions onto instance
  - Returns `IResource<TArgs, TData> & PluginAugmentations<TPlugins, TArgs, TData>`

- **`apiCreateCommand`** at `@/src/query/api/createApi.ts:164-195`
  - Merges `cacheLifetime: 0` as default
  - Creates `new Command(mergedOptions)`
  - Registers in `_commands` Set (for resetAll)
  - Runs plugin `augmentCommand` loop → `Object.assign` contributions onto instance
  - Returns `ICommand<TArgs, TResult> & PluginCommandAugmentations<TPlugins, TArgs, TResult>`

#### `IResource<TArgs, TData>` public interface (`@/src/query/types/resource.types.ts:36`)

| Method | Description |
|---|---|
| `createAgent()` | Returns `IResourceAgent` |
| `query(...args, doForce?)` | Triggers fetch (cached or fresh) |
| `getEntry(...args)` | Get or create cache entry |
| `getEntry$(...args)` | Reactive variant |
| `invalidate(...args)` | Invalidate specific entry |
| `subscribe(...args)` | Keep entry alive via subscription |
| `resetCache()` | Clear all entries |
| `cacheValues()` | Iterator over entries |
| `hydrateEntry(args, machine)` | SSR hydration |
| `hasEntry(args)` | Check existence |
| `status$` | Idle/ready signal |

#### `ICommand<TArgs, TResult>` public interface (`@/src/query/types/command.types.ts:44-47`)

| Method | Description |
|---|---|
| `createAgent()` | Returns `ICommandAgent` |
| `resetCache()` | Clear all entries |

- Much smaller surface than `IResource` — Command has no `query`, `getEntry`, `invalidate`, `subscribe`, or snapshot support

### 8. Test Coverage for React Layer

- **`useResourceAgent.test.ts`** at `@/src/query/react/__tests__/useResourceAgent.test.ts`
  - Tests: RH01 (pending→success), RH02 (SKIP token → idle), RH03 (args change + SWR), and more
  - Uses `@testing-library/react` `renderHook` + `act`
  - Uses `createControllableQueryFn` test helper for controlled resolve/reject
- **No `useCommandAgent.test.ts`** file exists in `@/src/query/react/__tests__/`
  - Command hook integration is tested via `@/src/query/__tests__/` integration tests (e.g., `command-agent.test.ts`)

## Code References

- `@/src/query/react/index.ts:1-2` — barrel exports for both hooks
- `@/src/query/react/useResourceAgent.ts:7-18` — `useResourceAgent` hook: useConstant + useEffect + useSignal
- `@/src/query/react/useCommandAgent.ts:5-16` — `useCommandAgent` hook: useConstant + useSignal + useEventHandler, returns tuple
- `@/src/signals/react/useSignal.ts:12-38` — `useSignal`: useSyncExternalStore bridge for SignalLike<T>
- `@/src/common/react/useConstant.ts:8-27` — `useConstant`: ref-based memoization with shallow deps
- `@/src/common/react/useEventHandler.ts:3-8` — `useEventHandler`: stable callback via ref
- `@/src/query/plugins/ReactHooksPlugin.ts:1-43` — ReactHooksPlugin: augments resource/command with bound hooks
- `@/src/query/plugins/ReactHooksPlugin.ts:20-28` — `augmentResource`: returns `{ useResourceAgent }` bound to resource
- `@/src/query/plugins/ReactHooksPlugin.ts:30-42` — `augmentCommand`: returns `{ useCommandAgent }` bound to command
- `@/src/query/types/plugin.types.ts:32-34` — `IReactHooksPluginContributions` type for resource
- `@/src/query/types/plugin.types.ts:56-61` — `IReactHooksPluginCommandContributions` type for command
- `@/src/query/types/plugin.types.ts:41-51` — `PluginResourceContributions` + `PluginAugmentations` conditional types
- `@/src/query/types/plugin.types.ts:66-76` — `PluginCommandContributions` + `PluginCommandAugmentations` conditional types
- `@/src/query/api/_createResource.ts:4-8` — standalone resource factory (no plugins)
- `@/src/query/api/_createCommand.ts:4-8` — standalone command factory (no plugins)
- `@/src/query/api/createApi.ts:72-147` — `apiCreateResource`: merged options + snapshot hydration + plugin augmentation
- `@/src/query/api/createApi.ts:164-195` — `apiCreateCommand`: merged options + plugin augmentation
- `@/src/query/types/agent.types.ts:8-46` — `TResourceAgentState` type (status union with SWR fields)
- `@/src/query/types/command.types.ts:57-91` — `TCommandAgentState` type (4-branch DU: idle/loading/success/error)
- `@/src/query/types/command.types.ts:44-47` — `ICommand` interface (createAgent + resetCache only)
- `@/src/query/react/__tests__/useResourceAgent.test.ts:1-80` — hook tests: pending→success, SKIP, SWR on args change
