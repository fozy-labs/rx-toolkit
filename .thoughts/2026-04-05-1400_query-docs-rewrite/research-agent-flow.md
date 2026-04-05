---
title: "ResourceAgent Entry Creation Flow — Codebase Analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

ResourceAgent does NOT eagerly create cache entries. On first render, the component sees `{ status: "idle", entry: null }`. After paint, `React.useEffect` fires `agent.start(args)`, which stores a lazy `Signal.compute` wrapping `_getEntry$(args)`. When `state$` is next evaluated, the computed signal calls `Resource._getEntry$(args, true)` → `_cache.getOrCreate(args)` → creates `ResourceCacheEntry` → constructor calls `_doFetch()` → query starts.

**Note:** The codebase uses `React.useEffect` (not `useImmediateEffect`) and `agent.start(args)` (not `agent.set(args)`).

## Findings

### Q1: What does `getEntry$(args)` return when there's no cache entry?

**It depends on `doInitiate` parameter.**

In `Resource.createAgent()` (`@/src/query/core/resource/Resource.ts:63-66`):
```ts
createAgent(): ResourceAgent<TArgs, TData> {
    return new ResourceAgent<TArgs, TData>(
        (args) => this._getEntry$(args, true),  // ← doInitiate = true always
        ...
    );
}
```

In `Resource._getEntry$()` (`@/src/query/core/resource/Resource.ts:130-137`):
```ts
private _getEntry$(args: TArgs, doInitiate?: boolean): ResourceCacheEntry<TArgs, TData> | null {
    const status = this.status$();

    if (status === "idle" && !doInitiate) return null;   // ← returns null only when not initiating

    if (doInitiate) {
        return this._cache.getOrCreate(args);             // ← CREATES entry if missing
    }

    return this._cache.get(args) ?? null;                 // ← returns null if no entry
}
```

**Result:** When called from the Agent, `doInitiate=true` is hardcoded → `getOrCreate` always creates an entry. The public `getEntry$()` without `doInitiate` reads `status$()` reactively and returns `null` when resource is `"idle"` and no entry exists.

### Q2: What state does the agent expose when entry is null?

Before `agent.start()` is called, `_tracking$` is `null`. The `_deriveState$()` method (`@/src/query/core/resource/ResourceAgent.ts:95-100`):
```ts
private _deriveState$(): TResourceAgentState<TArgs, TData> {
    const tracking = this._tracking$();

    if (tracking === null) {
        return this._idleState();
    }
    ...
```

`_idleState()` (`@/src/query/core/resource/ResourceAgent.ts:85-97`):
```ts
private _idleState(): TResourceAgentState<TArgs, TData> {
    return {
        status: "idle",
        data: null,
        error: null,
        args: null,
        isLoading: false,
        isInitialLoading: false,
        isRefreshing: false,
        isRefreshError: false,
        isSuccess: false,
        isError: false,
        entry: null,           // ← entry is null
    };
}
```

**Result:** User sees `{ status: "idle", entry: null }` before `start()`. After `start()` triggers entry creation, user sees `{ status: "pending", entry: <ResourceCacheEntry>, data: null }`.

### Q3: What triggers the actual entry creation and query start?

**Trigger chain:** `React.useEffect` → `agent.start(args)` → `Signal.compute(() => _getEntry$(...))` stored in tracking → `state$` re-evaluation → `current$()` evaluated → `_getEntry$(args, true)` → `_cache.getOrCreate(args)` → `_entryFactory()` → `new ResourceCacheEntry(...)` → constructor calls `_doFetch()`.

In `ResourceCacheEntry` constructor (`@/src/query/core/resource/ResourceCacheEntry.ts:61-73`):
```ts
constructor(options: IResourceCacheEntryOptions<TArgs, TData>) {
    super(options.initialMachine ?? new MachinePending<TArgs, TData>(options.args), options.entryOptions);
    ...
    this._fireCacheEntryAdded();

    if (!options.initialMachine) {
        this._doFetch().catch(() => {});     // ← query starts HERE
    }
}
```

### Q4: EXACT sequence: component mount → hook → agent → resource → entry creation → query

```
1. Component renders
   └─ useResourceAgent(resource, args)

2. useConstant(() => resource.createAgent())
   └─ Creates ResourceAgent with getEntry$ = (args) => resource._getEntry$(args, true)
   └─ ResourceAgent._tracking$ = null
   └─ ResourceAgent.state$ = Signal.compute(() => _deriveState$(), { isDisabled: true })

3. useSignal(agent.state$) — useSyncExternalStore
   └─ getSnapshot calls agent.state$.peek()
   └─ _deriveState$(): _tracking$ is null → returns { status: "idle", entry: null }
   └─ Component renders with IDLE state

4. React.useEffect fires (AFTER paint)
   └─ agent.start(args)
   └─ Creates: current$ = Signal.compute(() => this._getEntry$(args), { isDisabled: true })
   └─ Sets: _tracking$.set({ args, current$ })

5. _tracking$ change notifies state$ subscribers
   └─ state$ re-evaluates _deriveState$()
   └─ Reads tracking$() → non-null
   └─ Reads current$() → TRIGGERS lazy computation

6. current$() calls Resource._getEntry$(args, true)
   └─ doInitiate=true → _cache.getOrCreate(args)
   └─ Cache miss → calls _entryFactory(args, argsKey)

7. _entryFactory creates new ResourceCacheEntry
   └─ super(new MachinePending(args)) — initial state is "pending"
   └─ _fireCacheEntryAdded() — lifecycle callback
   └─ _doFetch() — QUERY STARTS (calls queryFn, returns Promise)

8. _deriveState$() continues with the new entry
   └─ currentMachine = currentEntry.machine$() → MachinePending
   └─ Returns { status: "pending", entry: currentEntry, data: null, isLoading: true, isInitialLoading: true }

9. useSyncExternalStore triggers re-render
   └─ Component renders with PENDING state, entry is NOT null
```

## Code References

- `@/src/query/react/useResourceAgent.ts:7-19` — useResourceAgent hook, uses `React.useEffect` + `agent.start()`
- `@/src/query/core/resource/ResourceAgent.ts:14-25` — ResourceAgent constructor, creates `state$` computed signal
- `@/src/query/core/resource/ResourceAgent.ts:44-83` — `agent.start()`: creates lazy `current$` signal, sets `_tracking$`
- `@/src/query/core/resource/ResourceAgent.ts:85-97` — `_idleState()`: returned before `start()`, has `entry: null`
- `@/src/query/core/resource/ResourceAgent.ts:99-147` — `_deriveState$()`: reads tracking, evaluates `current$()`, derives full state
- `@/src/query/core/resource/Resource.ts:63-66` — `createAgent()`: passes `(args) => _getEntry$(args, true)` with doInitiate hardcoded
- `@/src/query/core/resource/Resource.ts:126-137` — `_getEntry$()`: returns null when idle+!doInitiate, creates entry when doInitiate=true
- `@/src/query/core/resource/Resource.ts:139-165` — `_entryFactory()`: constructs `ResourceCacheEntry`
- `@/src/query/core/resource/ResourceCacheEntry.ts:61-73` — constructor: initial state=MachinePending, calls `_doFetch()`
- `@/src/query/core/resource/ResourceCacheEntry.ts:197-234` — `_doFetch()`: aborts previous, creates AbortController, calls queryFn
- `@/src/query/core/CacheMap/SerializeCacheMap.ts:48-55` — `getOrCreate()`: creates entry via factory if not in map
- `@/src/signals/react/useSignal.ts:12-42` — `useSignal`: wraps signal with `useSyncExternalStore`
