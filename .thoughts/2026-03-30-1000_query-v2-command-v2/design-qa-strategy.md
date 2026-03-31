---
title: "CommandV2 — QA Strategy"
date: 2026-03-30
stage: 02-design
role: rdpi-qa-designer
---

# CommandV2 — QA Strategy

## Approach

- **Unit**: Each machine state, CommandV2, CommandV2Agent, CommandV2CacheEntry, ResourceV2Ref — tested in isolation with mocks.
- **Integration**: Full pipeline tests (command + linked resource invalidation, optimistic updates, plugin augmentation, resetAll). Matches existing `src/query-v2/__tests__/integration/` pattern.
- **React**: Hook tests via `@testing-library/react` — same pattern as `query-flow.test.ts` INT02.
- **Convention**: Test IDs (`T01`, `INT-C01`, `RH01`), `createControllableQueryFn`, `flushMicrotasks`, `cacheLifetime: false as never`.

## Test Cases

### Unit: CommandMachine States

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| T01 | `CommandMachine.idle()` returns CommandIdle | — | `{ status: "idle", args: null, data: null, error: null }` | High |
| T02 | CommandIdle.start(args) → CommandLoading | `start({ id: 1 })` | `{ status: "loading", args: { id: 1 } }` | High |
| T03 | CommandLoading.successHappened(data) → CommandSuccess | `successHappened({ ok: true })` | `{ status: "success", data: { ok: true }, patchState: null }` | High |
| T04 | CommandLoading.errorHappened(err) → CommandError | `errorHappened(new Error("fail"))` | `{ status: "error", error: Error("fail") }` | High |
| T05 | CommandSuccess.start(args) → CommandLoading | `start({ id: 2 })` | `{ status: "loading", args: { id: 2 }, data: null }` | High |
| T06 | CommandError.start(args) → CommandLoading | `start({ id: 3 })` | `{ status: "loading", error: null }` | High |
| T07 | CommandSuccess carries patchState from Patcher | `createPatch(draft => ...)` | `patchState !== null` | Medium |
| T08 | Invalid transitions are impossible (no methods) | CommandIdle has no `.successHappened` | TS compile error / method absent | Low |

### Unit: CommandV2

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| T10 | `createAgent()` returns ICommandV2Agent | — | Agent with `state$`, `trigger`, `reset` | High |
| T11 | Multiple agents get unique cache keys | Call `createAgent()` ×2 | Two distinct symbol keys in internal map | Medium |
| T12 | Subscribes to ResetAllQueriesSignal | Fire reset signal | All cache entries cleaned | High |
| T13 | Stores link definitions from options | Pass `link: [...]` | Links accessible during execution | Medium |

### Unit: CommandV2Agent

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| T20 | Initial `state$()` is idle | — | `{ status: "idle", isLoading: false }` | High |
| T21 | `trigger(args)` transitions to loading | `trigger({ id: 1 })` | `state$().status === "loading"` | High |
| T22 | `trigger()` returns promise that resolves on success | resolve queryFn | `await trigger()` === data | High |
| T23 | `trigger()` returns promise that rejects on error | reject queryFn | `await trigger()` rejects | High |
| T24 | `reset()` returns to idle | After success, call `reset()` | `state$().status === "idle"` | High |
| T25 | Re-trigger while loading aborts previous | trigger ×2 rapidly | First AbortSignal aborted, only second result committed | High |
| T26 | `state$` exposes flat computed fields | After success | `isLoading: false, isSuccess: true, isError: false` | Medium |

### Unit: CommandV2CacheEntry

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| T30 | Extends CacheEntry with CommandMachine state | — | `peek().status === "idle"` initially | High |
| T31 | `initiate(args)` calls queryFn with args + abortSignal | `initiate({ id: 1 })` | `queryFn` called with `({ id: 1 }, { abortSignal })` | High |
| T32 | Success → sets CommandSuccess in signal | Resolve queryFn | `peek().status === "success"` | High |
| T33 | Error → sets CommandError in signal | Reject queryFn | `peek().status === "error"` | High |
| T34 | Abort previous on re-initiate | `initiate()` ×2 | First signal aborted | High |
| T35 | Fires `onQueryStarted` with `$queryFulfilled` | Provide callback, resolve | Callback invoked, `$queryFulfilled` resolves | Medium |
| T36 | Fires `onCacheEntryAdded` lifecycle | Provide callback | `$cacheDataLoaded` resolves on first success | Medium |
| T37 | queryFn sync throw → CommandError | queryFn throws | `peek().status === "error"` | Medium |
| T38 | Link resolution: calls ResourceV2Ref per link on success | link with `invalidate: true` | `ref.invalidate()` called | High |
| T39 | Link resolution: optimistic patch applied before queryFn | link with `optimisticUpdate` | Resource entry patched before queryFn resolves | High |
| T40 | Batcher wraps settlement | — | Single batch for state + link updates | Medium |

### Unit: ResourceV2Ref

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| T50 | `invalidate()` delegates to resource | Call `invalidate()` | `resource.invalidate(forwardedArgs)` called | High |
| T51 | `patch(fn)` creates patch on resource entry | Call `patch(draft => ...)` | Returns IPatchHandle | High |
| T52 | `patch()` returns null if entry has no data | No prior fetch | Returns `null` | Medium |
| T53 | `commitPatch(handle)` / `abortPatch(handle)` delegates | Call commit/abort | Handle committed/aborted | High |

### Integration: Command + Resource Invalidation

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| INT-C01 | Command success invalidates linked resource | Trigger command → success | Resource re-fetches | High |
| INT-C02 | Command success applies `update` patch to resource | link.update defined, resolve | Resource data updated without refetch | High |
| INT-C03 | Optimistic update applied, committed on success | link.optimisticUpdate + resolve | Resource shows optimistic data immediately, keeps it | High |
| INT-C04 | Optimistic update rolled back on error | link.optimisticUpdate + reject | Resource data reverts to original | High |
| INT-C05 | Multiple links processed in definition order | 2 links | First link processed before second | Medium |
| INT-C06 | `update` + `invalidate` on same link | Both defined | Patch applied then invalidation fires | Medium |
| INT-C07 | Consistency violation on abort → auto-invalidate | Out-of-order abort | Resource auto-invalidates | Medium |

### Integration: Plugin Augmentation

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| INT-C10 | `api.createCommandV2()` returns augmented command | ReactHooksPlugin installed | `.useCommandV2Agent` exists on returned object | High |
| INT-C11 | `augmentCommand` called with command + options | Create via api | Plugin's `augmentCommand` invoked | Medium |
| INT-C12 | `resetAll()` clears command caches | Create commands, trigger, resetAll | All agents back to idle | High |

### React Hook: useCommandV2Agent

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| RH01 | Returns `[trigger, state]` tuple | Render hook | `trigger` is function, `state.status === "idle"` | High |
| RH02 | `trigger()` → loading → success renders | Call trigger, resolve | Re-renders show loading then success | High |
| RH03 | `trigger()` → loading → error renders | Call trigger, reject | Re-renders show loading then error | High |
| RH04 | Stable trigger reference across renders | Re-render | `trigger` ref unchanged | Medium |
| RH05 | Multiple triggers — only latest result | trigger ×2 rapidly | Final state reflects second result only | High |
| RH06 | Unmount cleans up (no stale updates) | Unmount while loading | No console errors post-unmount | Medium |

## Edge Cases

- **T37**: Sync-throwing queryFn — must not leave entry in loading state forever.
- **T25/RH05**: Rapid re-trigger race — only latest AbortController survives.
- **INT-C04**: Optimistic rollback on reject — resource must return to pre-command state.
- **INT-C07**: Consistency violation from out-of-order abort — auto-invalidation path.
- **Void args**: `TArgs = void` — `trigger()` called with no arguments compiles and works.
- **Null data**: `TResult = null` — null stored as valid success data.

## Performance Criteria

- No applicable perf thresholds for command execution (network-bound).
- **Batcher batching**: Verify ≤1 re-render per trigger settlement (unit: count `state$` emissions).
- **GC**: CacheEntry cleanup after `cacheLifetime` — no leaked subscriptions (covered by existing GC lifecycle tests pattern).

## Correctness Verification

End-to-end validation: create an API with ReactHooksPlugin → `api.createCommandV2()` with linked resource → render `useCommandV2Agent` + `useResourceV2Agent` → trigger command → verify resource UI updates optimistically → resolve → verify final state. This mirrors the optimistic-updates integration test pattern. [ref: ./01-architecture.md#4. Data Flow]

## Test Utilities Needed

- **`createControllableCommandQueryFn<TArgs, TResult>`** — Same as existing `createControllableQueryFn` but typed for command signature. Can likely reuse existing one since signature is identical (`(args, { abortSignal }) => Promise`).
- **`createMockResourceV2<TArgs, TData>`** — Factory returning a pre-populated resource with controllable queryFn + initial data. Needed for link integration tests.
- **`createTestCommand(overrides?)`** — Shorthand: creates `_createCommandV2()` with defaults + controllable queryFn. Returns `{ command, queryFn, calls }`.
- **`createTestCommandApi(overrides?)`** — Creates API + resource + command with links. Returns all handles.

## Coverage Targets

| Module | Target | Notes |
|--------|--------|-------|
| `core/machines/Command*.ts` | 100% | Pure state machines, all transitions testable |
| `core/command/CommandV2.ts` | ≥95% | Agent creation, reset subscription |
| `core/command/CommandV2Agent.ts` | ≥95% | state$, trigger, reset, abort |
| `core/command/CommandV2CacheEntry.ts` | ≥90% | Complex: queryFn execution + link resolution + lifecycle hooks |
| `core/command/ResourceV2Ref.ts` | 100% | ~30 LOC adapter, fully testable |
| `api/_createCommandV2.ts` | 100% | Simple factory |
| `react/useCommandV2Agent.ts` | ≥90% | Hook logic |
| **Overall command code** | **≥95%** | Consistent with existing v2 coverage standards |

## File Placement

```
src/query-v2/__tests__/
├── command-machine.test.ts          # T01–T08
├── command-v2.test.ts               # T10–T13
├── command-v2-agent.test.ts         # T20–T26
├── command-v2-cache-entry.test.ts   # T30–T40
├── resource-v2-ref.test.ts          # T50–T53
├── helpers/
│   └── index.ts                     # ADD: createTestCommand, createMockResourceV2
└── integration/
    ├── command-invalidation.test.ts  # INT-C01–INT-C07
    ├── command-plugin.test.ts        # INT-C10–INT-C12
    └── command-react-hook.test.ts    # RH01–RH06
```

## Conclusion
Status: success
Artifacts: .thoughts/2026-03-30-1000_query-v2-command-v2/design-qa-strategy.md
Summary:
- 53 test cases across unit (33), integration (10), react hook (6), edge cases (4)
- Test utilities reuse existing controllable-promise pattern; 2 new helpers needed
- Coverage target ≥95% overall, 100% for pure state machines and small adapters
Escalation: none
Next step: proceed to plan stage
