---
title: "Agent/ResourceAgent — Code Extraction"
date: 2026-04-05
stage: research
role: rdpi-codebase-researcher
---

# ResourceAgent — Structural Patterns from Code

## IResourceAgent interface (`@/query/types/agent.types.ts`)
- `state$: ComputeFn<TResourceAgentState>` — reactive computed signal
- `start(...args: ArgsOrVoidOrSkip<TArgs>): void` — begin observing
- `compareArgs(a, b): boolean` — delegated args equality

## TResourceAgentState (`@/query/types/agent.types.ts`)
- Discriminated union: **idle** | **active** (keyed on `status`)
- Idle branch: all fields nulled, booleans false, `status: "idle"`
- Active branch fields: `status`, `data`, `error`, `lastError?`, `args`, `isLoading`, `isInitialLoading`, `isRefreshing`, `isRefreshError`, `isSuccess`, `isError`, `entry`
- `entry` exposes underlying `IResourceCacheEntry` (full machine access)

## SKIP mechanism
- `SKIP` is a unique symbol (`Symbol("SKIP")`)
- `ArgsOrVoidOrSkip<TArgs>` — union allows `TArgs | SKIP_TOKEN` (or empty tuple when void)
- `start(SKIP)` → clears `_previous$`, sets `_tracking$` to `null` → state$ emits idle
- Idempotent: no entry created, no fetch triggered

## SWR fallback logic (`ResourceAgent._deriveState$`)
- Tracks two slots: `_tracking$` (current) and `_previous$` (stale)
- On args change: old `current$` moves to `_previous$` only if its status was `success` or `refreshing`
- During derive: if current status is `pending` or `error` AND `_previous$` exists with `success`/`refreshing` → uses previous data, overrides status to `"refreshing"`
- `_previous$` cleared when current's **original** status reaches `success` or `error`

## How agent observes CacheEntry
- Constructor receives `getEntry$: (args) => ResourceCacheEntry` (factory from Resource)
- `current$` is a `Signal.compute(() => getEntry$(args))` — reactive lookup
- Reads `currentEntry.machine$()` to get machine state (status, data, error)
- All signals created with `isDisabled: true` (lazy activation)

## createAgent() surface (`IResource.createAgent`)
- `IResource.createAgent(): IResourceAgent<TArgs, TData>` — no parameters
- Agent receives `getEntry$` + `compareArgs` from the resource at construction

## useResourceAgent hook (`@/query/react/useResourceAgent.ts`)
- `useResourceAgent(resource, ...args)` → `TResourceAgentState`
- Creates agent once via `useConstant(() => resource.createAgent())`
- Calls `agent.start(...args)` inside `React.useEffect` (deps = args)
- Reads state via `useSignal(agent.state$)`
