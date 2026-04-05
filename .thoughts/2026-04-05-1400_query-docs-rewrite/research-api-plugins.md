---
title: "Query Module API Layer, Plugin System & React Integration — Codebase Analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module exposes a `createApi()` factory that produces API instances capable of creating plugin-augmented resources. A plugin system (`IPlugin`) lets plugins inject methods onto resources at creation time—the only shipped plugin is `ReactHooksPlugin`, which adds a `useResourceAgent` hook per resource. React integration is thin: a single `useResourceAgent` hook creates a `ResourceAgent`, syncs its lifecycle to React effects, and reads its reactive signal state via `useSignal`.

## Findings

### 1. `createApi`

- **Location**: `@/src/query/api/createApi.ts:23-140`
- **Options** (`ICreateApiOptions` at `@/src/query/types/api.types.ts:7-18`):
  - `keyPrefix` — optional namespace prefix for snapshot isolation
  - `strategy` — `"serialize"` (default) or `"compare"` — determines how cache keys are derived from args
  - `serializeArgs` / `compareArg` — API-level default serialization/comparison functions
  - `cacheLifetime` — default `60_000` ms; forwarded to every resource
  - `plugins` — readonly tuple of `IPlugin` instances
  - `initialSnapshot` — `TApiSnapshot | null` for SSR hydration
  - `maxSnapshotDataAge` — max age (ms) before hydrated entries auto-invalidate
  - `doCacheArgs` — whether to cache args on entries
- **Returns** (`IApi<TPlugins>` at `@/src/query/types/api.types.ts:21-33`):
  - `createResource<TArgs, TData>(opts)` — factory; return type is `IResource & PluginAugmentations`
  - `resetAll()` — resets every tracked resource + clears saved snapshot
  - `getSnapshot()` — serialisable snapshot of all keyed resources
- **Orchestration flow**:
  1. Validates & clones `initialSnapshot` if provided.
  2. Calls `plugin.install(pluginContext)` once per plugin.
  3. `createResource` merges API-level defaults into resource options, instantiates `Resource`, hydrates from snapshot (with stale invalidation), then iterates plugins calling `augmentResource` and `Object.assign`-ing contributions onto the resource instance.
  4. Duplicate keys and plugin-key collisions throw.

### 2. `_createResource` (internal)

- **Location**: `@/src/query/api/_createResource.ts:1-8`
- Thin wrapper: `new Resource<TArgs, TData>(options)` → `IResource<TArgs, TData>`.
- No plugin augmentation, no snapshot hydration, no API defaults.
- Used for standalone resource creation outside of an API instance.

### 3. Plugin System

- **`IPlugin` interface**: `@/src/query/types/plugin.types.ts:11-20`
  - `name: string` — used for type-level discrimination (`TPlugin extends { name: "ReactHooksPlugin" }`)
  - `install(context: IPluginContext): void` — called once per `createApi` with `{ strategy }`
  - `augmentResource?(resource, options): Record<string, unknown>` — called per `createResource`; returned keys are `Object.assign`-ed onto the resource
- **`IPluginContext`**: `@/src/query/types/plugin.types.ts:7-9` — `{ strategy: "serialize" | "compare" }`
- **Type-level augmentation**:
  - `PluginResourceContributions<TPlugin, TArgs, TData>` — conditional per plugin name → concrete contribution interface (`@/src/query/types/plugin.types.ts:33-36`)
  - `PluginAugmentations<TPlugins, TArgs, TData>` — `Prettify<UnionToIntersection<…>>` across the plugins tuple (`@/src/query/types/plugin.types.ts:42-44`)
  - Adding a new plugin requires: implementing `IPlugin`, adding a conditional branch in `PluginResourceContributions`, and defining a contributions interface.

### 4. `ReactHooksPlugin`

- **Location**: `@/src/query/plugins/ReactHooksPlugin.ts:1-22`
- `install()` — no-op; no global setup needed.
- `augmentResource()` — returns `{ useResourceAgent(...args) }` that delegates to the standalone `useResourceAgent` hook.
- **Type contributions** (`IReactHooksPluginContributions` at `@/src/query/types/plugin.types.ts:25-27`):
  - `useResourceAgent(...args: ArgsOrVoidOrSkip<TArgs>): TResourceAgentState<TArgs, TData>`
- Exported from `@/src/query/plugins/index.ts:1`.

### 5. `useResourceAgent` (React hook)

- **Location**: `@/src/query/react/useResourceAgent.ts:1-16`
- Signature: `useResourceAgent<TArgs, TData>(resource, ...args: ArgsOrVoidOrSkip<TArgs>): TResourceAgentState<TArgs, TData>`
- Flow:
  1. `useConstant(() => resource.createAgent())` — creates `IResourceAgent` once per component lifetime.
  2. `React.useEffect(() => agent.start(...args), args)` — starts/restarts agent when args change.
  3. `useSignal(agent.state$)` — subscribes to the reactive computed signal and returns current state.
- **`TResourceAgentState`** (`@/src/query/types/agent.types.ts:8-40`): discriminated union with fields `status`, `data`, `error`, `lastError`, `args`, boolean flags (`isLoading`, `isInitialLoading`, `isRefreshing`, `isRefreshError`, `isSuccess`, `isError`), and `entry`.
- **`IResourceAgent`** (`@/src/query/types/agent.types.ts:43-49`): `state$` (computed signal), `start(...args)`, `compareArgs(a, b)`.

### 6. `SKIP_TOKEN`

- **Location**: `@/src/query/lib/SKIP_TOKEN.ts:1-2`
- `SKIP` — unique symbol (`Symbol("SKIP")`)
- `SKIP_TOKEN` — type alias `typeof SKIP`
- **Purpose**: Pass as args to `useResourceAgent` (or `agent.start`) to signal "do not fetch". Enables conditional fetching without violating the rules of hooks.
- Used in `ArgsOrVoidOrSkip<TArgs>` — args accept `TArgs | SKIP_TOKEN`.

### 7. `stableStringify`

- **Location**: `@/src/query/lib/stableStringify.ts:1-20`
- **Purpose**: Deterministic `JSON.stringify` with sorted object keys — used as the default `serializeArgs` for `strategy: "serialize"`.
- Handles plain objects (recursively sorted), arrays, primitives, null, undefined.
- Does NOT handle Date, Map, Set, RegExp (documented limitation).

### 8. Key Type Utilities

- **Location**: `@/src/query/types/shared.types.ts:1-12`
- `ArgsOrVoid<TArgs>` — `TArgs extends void ? [] : [args: TArgs]` — makes args optional when `TArgs = void`
- `ArgsOrVoidOrSkip<TArgs>` — extends `ArgsOrVoid` to additionally accept `SKIP_TOKEN`
- `Prettify<T>` — `{ [K in keyof T]: T[K] } & {}` — flattens intersection types for readable IDE tooltips
- `UnionToIntersection<U>` — standard contra-variant inference trick to convert `A | B` → `A & B`

## Code References

- `@/src/query/api/createApi.ts:23` — `createApi` function definition
- `@/src/query/api/createApi.ts:62-125` — `apiCreateResource` internal function (merge, instantiate, hydrate, augment)
- `@/src/query/api/createApi.ts:127-131` — `resetAll` implementation
- `@/src/query/api/createApi.ts:133` — `apiGetSnapshot` delegates to `getSnapshot()`
- `@/src/query/api/_createResource.ts:4-8` — standalone `_createResource` wrapper
- `@/src/query/types/api.types.ts:7-18` — `ICreateApiOptions` interface
- `@/src/query/types/api.types.ts:21-33` — `IApi` interface
- `@/src/query/types/plugin.types.ts:11-20` — `IPlugin` interface
- `@/src/query/types/plugin.types.ts:25-27` — `IReactHooksPluginContributions`
- `@/src/query/types/plugin.types.ts:33-36` — `PluginResourceContributions` conditional type
- `@/src/query/types/plugin.types.ts:42-44` — `PluginAugmentations` merger type
- `@/src/query/plugins/ReactHooksPlugin.ts:5-22` — `ReactHooksPlugin` class
- `@/src/query/react/useResourceAgent.ts:8-16` — `useResourceAgent` hook
- `@/src/query/types/agent.types.ts:8-40` — `TResourceAgentState` union type
- `@/src/query/types/agent.types.ts:43-49` — `IResourceAgent` interface
- `@/src/query/types/resource.types.ts:20-33` — `TResourceOptions` type
- `@/src/query/types/resource.types.ts:36-57` — `IResource` interface
- `@/src/query/lib/SKIP_TOKEN.ts:1-2` — `SKIP` symbol and `SKIP_TOKEN` type
- `@/src/query/lib/stableStringify.ts:10-20` — `stableStringify` function
- `@/src/query/types/shared.types.ts:3-12` — `ArgsOrVoid`, `ArgsOrVoidOrSkip`, `Prettify`, `UnionToIntersection`
- `@/src/query/types/snapshot.types.ts:2-24` — `TApiSnapshot`, `TResourceSnapshot`, `TResourceSnapshotSlice`
