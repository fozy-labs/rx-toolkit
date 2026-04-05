---
title: "Query State Machine System — Codebase Analysis"
date: 2026-04-05
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The query module uses an immutable state machine with 4 states (`pending`, `success`, `error`, `refreshing`) where every transition returns a new class instance. States that carry data (`success`, `refreshing`) inherit from abstract `MachineWithData` which provides Immer-based optimistic patching. A static `Machine` factory handles creation and SSR hydration.

## Class Hierarchy

- `Machine` — static factory object (not a class), entry points: `pending()`, `fromSnapshot()`
- `MachinePending<TArgs, TData>` — standalone class, no base
- `MachineError<TArgs, TData>` — standalone class, no base
- `MachineWithData<TArgs, TData>` — **abstract base** for data-carrying states
  - `MachineSuccess<TArgs, TData>` extends `MachineWithData`
  - `MachineRefreshing<TArgs, TData>` extends `MachineWithData`
- `Patcher` — static utility class, wraps Immer `produceWithPatches`/`applyPatches`

**Location**: `@/src/query/core/machines/`  
**Types**: `@/src/query/types/machine.types.ts`

## States & Transitions

### MachinePending (`@/src/query/core/machines/MachinePending.ts`)
- **Properties**: `status="pending"`, `args: TArgs`, `data=null`, `error=null`, `updatedAt=null`
- **Getter**: `state: TPendingState<TArgs>`
- **Transitions**:
  - `successHappened(data: TData)` → `MachineSuccess` (patchState=null, updatedAt=Date.now())
  - `errorHappened(error: unknown)` → `MachineError`

### MachineSuccess (`@/src/query/core/machines/MachineSuccess.ts`)
- **Properties**: `status="success"`, `args`, `data`, `error=null`, `updatedAt: number`, `lastError?: unknown`, `patchState`
- **Constructor**: `(args, data, patchState, updatedAt, lastError?)`
- **Getter**: `state: TSuccessState<TArgs, TData>`
- **Transitions**:
  - `invalidate()` → `MachineRefreshing` (preserves data, patchState, updatedAt)
  - `start(args: TArgs)` → `MachinePending` (new args, discards data)
- **Inherited from MachineWithData**: `createPatch()`, `finishPatch()`, `abortAllPendingPatches()`
- **Protected**: `cloneWith(updates)` → `MachineSuccess`

### MachineError (`@/src/query/core/machines/MachineError.ts`)
- **Properties**: `status="error"`, `args`, `data=null`, `error: unknown`, `updatedAt=null`
- **Getter**: `state: TErrorState<TArgs>`
- **Transitions**:
  - `retry()` → `MachinePending` (same args)
  - `start(args: TArgs)` → `MachinePending` (new args)

### MachineRefreshing (`@/src/query/core/machines/MachineRefreshing.ts`)
- **Properties**: `status="refreshing"`, `args`, `data`, `error=null`, `updatedAt: number`, `patchState`
- **Constructor**: `(args, data, patchState, updatedAt)`
- **Getter**: `state: TRefreshingState<TArgs, TData>`
- **Transitions**:
  - `successHappened(data: TData)` → `MachineSuccess`
    - If patchState exists: calls `Patcher.resolvePatches(serverData, patches)` to rebase patches onto fresh data
    - If no patchState: clean success with new data
  - `errorHappened(error: unknown)` → `MachineSuccess` (preserves stale data + patchState, stores error as `lastError`)
- **Inherited from MachineWithData**: `createPatch()`, `finishPatch()`, `abortAllPendingPatches()`
- **Protected**: `cloneWith(updates)` → `MachineRefreshing`

## Transition Diagram

```
             start(args)
 Success ─────────────────► Pending
    │                        │  │
    │ invalidate()           │  │
    ▼                        │  │
 Refreshing                  │  │
    │  │                     │  │
    │  │ successHappened()   │  │ successHappened()
    │  ├─────► Success ◄────┘  │
    │  │                       │
    │  │ errorHappened()       │ errorHappened()
    │  └─────► Success         ▼
    │                        Error
    │                         │ │
    │        retry()          │ │
    │  ◄──────────────────────┘ │
    │        start(args)        │
    └──◄────────────────────────┘
```

## MachineWithData — Abstract Base (`@/src/query/core/machines/MachineWithData.ts`)

- **Properties**: `args: TArgs`, `data: TData`, `patchState: TPatchState<TData> | null`
- **Methods**:
  - `createPatch(patchFn: (draft: TData) => void)` → `CreatePatchResult<TArgs, TData> | null`
    - Returns `null` if patchFn produces zero Immer patches
    - Returns `{ machine, patchHandle: { commit, abort } }`
    - Accumulates patches: preserves `originalData` from first patch, appends new `TPatch` to array
  - `finishPatch(type: "committed" | "aborted", patch: TPatch)` → `TMachineInstance`
    - Delegates to `Patcher.finishPatch()`, returns cloned machine with resolved state
  - `abortAllPendingPatches()` → `TMachineInstance`
    - Marks all pending patches as aborted, delegates to `Patcher.abortAllPending()`
- **Abstract**: `cloneWith(updates: Record<string, unknown>)` — implemented by Success and Refreshing

## Patcher System (`@/src/query/core/machines/Patcher.ts`)

Built on **Immer** (`enablePatches()` called at module level).

### Types (`@/src/query/types/machine.types.ts:7-30`)
- `TPatchStatus` = `"pending" | "committed" | "aborted"`
- `TPatch` = `{ patches: Patch[], inversePatches: Patch[], status: TPatchStatus }`
- `TPatchState<TData>` = `{ originalData: TData, patches: TPatch[], isConsistencyViolation: boolean }`
- `IPatchHandle` = `{ commit: () => void, abort: () => void }`

### Static Methods

- **`createPatch<TData>(patchFn, data)`** → `{ patch: TPatch, data: TData }`
  - Uses `produceWithPatches` to get patches + inversePatches
  - New patch has `status: "pending"`

- **`resolvePatches<TData>(originalData, patches)`** → `IPatchResolution<TData>`
  - Core reconciliation algorithm — replays all patches on original data
  - **Before first pending**: committed → bake into base; aborted → drop
  - **Pending**: apply patches, keep in remaining
  - **After first pending**: committed → apply + keep; aborted → apply inverse if more pending follow, else drop
  - **Error handling**: on `applyPatches` throw → consistency violation, returns current data + empty patches + `isConsistencyViolation: true`
  - **Result**: if no pending remain → `patchState=null`; else → updated `patchState` with `originalData=baseData`

- **`finishPatch<TData>(originalData, patches, type, patch)`** → `IPatchResolution<TData>`
  - Finds the target patch by reference equality (`===`), updates its status, delegates to `resolvePatches()`

- **`abortAllPending<TData>(originalData, patches)`** → `IPatchResolution<TData>`
  - Maps all `status:"pending"` → `"aborted"`, delegates to `resolvePatches()`

### Patch Lifecycle Flow
1. `createPatch(fn)` → Immer produces patches, stored as `status:"pending"`, optimistic data applied immediately
2. Server confirms → `finishPatch("committed", patch)` → patch baked into base on next resolve
3. Server rejects → `finishPatch("aborted", patch)` → inverse patches applied, patch dropped
4. On refresh `successHappened()` → `resolvePatches(freshServerData, existingPatches)` rebases pending patches onto new server data

## Machine Factory (`@/src/query/core/machines/Machine.ts`)

- `Machine.pending<TArgs, TData>(args)` → `MachinePending`
- `Machine.fromSnapshot<TArgs, TData>(state)` → `TMachineInstance` — switch on `state.status`, reconstructs correct class

## Key Design Decisions

- **Full immutability**: every transition returns a new instance; all properties are `readonly`
- **No idle state**: machine starts at `pending` (first fetch is always required)
- **Error on refresh preserves data**: `Refreshing.errorHappened()` → `Success` with `lastError`, not `Error` (stale-while-revalidate)
- **Structural cloning via `cloneWith()`**: abstract method avoids constructor coupling between base and subclasses
- **Patch accumulation**: multiple patches stack; `originalData` captured at first patch only
- **Consistency violation safety**: if Immer `applyPatches` throws, machine falls back to last valid data and clears all patches
- **Reference equality for patch identity**: `finishPatch` uses `===` to find target patch — patches must be kept by reference
- **IPatchHandle placeholders**: `createPatch()` returns `{ commit: () => {}, abort: () => {} }` — actual wiring happens at caller level

## Code References

- `@/src/query/core/machines/Machine.ts:1-33` — static factory
- `@/src/query/core/machines/MachinePending.ts:1-41` — pending state class
- `@/src/query/core/machines/MachineSuccess.ts:1-63` — success state class
- `@/src/query/core/machines/MachineError.ts:1-38` — error state class
- `@/src/query/core/machines/MachineRefreshing.ts:1-63` — refreshing state class
- `@/src/query/core/machines/MachineWithData.ts:1-97` — abstract base with patch methods
- `@/src/query/core/machines/Patcher.ts:1-134` — Immer-based patch resolution engine
- `@/src/query/core/machines/index.ts:1-8` — barrel exports
- `@/src/query/types/machine.types.ts:1-96` — all type definitions
