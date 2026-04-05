---
stage: 01-research
phase: patching-from-code
source: codebase
---

# Patching (Optimistic Updates) — Code Structure

## TPatchState shape (`@/query/types/machine.types.ts`)

```
TPatch        = { patches: Patch[], inversePatches: Patch[], status: TPatchStatus }
TPatchStatus  = "pending" | "committed" | "aborted"
TPatchState<T>= { originalData: T, patches: TPatch[], isConsistencyViolation: boolean }
```

`patchState` lives on `TSuccessState` and `TRefreshingState` (nullable).  
When `null` — data is raw server data. When present — `data` is patched, `originalData` is the unpatched base.

## Patch lifecycle methods

| Method | Owner | Behavior |
|---|---|---|
| `createPatch(patchFn)` | `ResourceCacheEntry` + `MachineWithData` | Immer `produceWithPatches` → appends `TPatch{pending}` to stack |
| `finishPatch(type, patch)` | `MachineWithData` → `Patcher.finishPatch` | Marks target patch committed/aborted, calls `resolvePatches` |
| `abortAllPendingPatches()` | `MachineWithData` → `Patcher.abortAllPending` | Marks all pending→aborted, resolves |
| `IPatchHandle.commit/abort` | returned by `createPatch` | Closures over `_finishPatch` in `ResourceCacheEntry` |

## Patch accumulation (stacking)

- Each `createPatch` appends to `patches[]` array — stack grows.  
- `originalData` is captured once (first patch) and preserved across subsequent patches.  
- Immer `produceWithPatches` runs against current (already-patched) `data`, not `originalData`.

## Immer usage pattern (`Patcher.ts`)

- `enablePatches()` called at module level.  
- `produceWithPatches(data, patchFn)` → `[newData, patches, inversePatches]`.  
- `applyPatches(data, patches)` for replay/rebase.  
- All through static `Patcher` utility class — no Immer leakage elsewhere.

## Rebase on refresh success (`ResourceCacheEntry._doFetch`)

When refresh resolves with fresh server data AND `_patchState` exists:  
1. `Patcher.resolvePatches(freshData, _patchState.patches)` — replays patches on new base.  
2. Committed patches before first pending → baked into base data, removed from queue.  
3. Pending patches → re-applied on top of new base.  
4. Aborted patches → inverse-applied if pending follows, else dropped.  
5. If `applyPatches` throws → `isConsistencyViolation = true`, patches cleared.  
6. If no pending remain after resolve → `patchState = null` (clean state).
