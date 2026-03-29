---
title: "Risk Analysis: Query-v2 Bugfixes and Docs"
date: 2026-03-29
stage: 02-design
role: rdpi-qa-designer
---

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R1 | `lastError` on `MachineSuccess` broadens machine type surface — consumers pattern-matching on `MachineSuccess` may not handle `lastError` | Medium | Medium | Mitigate | Optional field with `undefined` default; additive change — no breaking type narrowing. Document in README error handling section. |
| R2 | `onQueryStarted` wiring changes fetch execution profile — `fireQueryStarted` + callback runs synchronously before `queryFn` | Low | Medium | Mitigate | Callback invocation is fire-and-forget (async callback, no await). `queryFn` proceeds immediately after. Existing `LifecycleHooks` unit tests validate isolation. |
| R3 | SWR semantics change: `status === "refreshing"` + `isError: true` is now possible — consumers pattern-matching on `status === "refreshing"` as "loading, no error" break | Medium | High | Mitigate | Document new state combination. Consumers should migrate from `status` checks to `isError`/`isLoading` boolean flags. |
| R4 | Existing test E07 update changes documented behavior — snapshot hydration tests relying on `queryFn` call count = 1 | Low | Low | Accept | E07 currently documents a bug as expected behavior. Update is intentional and correct per [ref: ./04-decisions.md#ADR-1]. |
| R5 | `$cacheDataLoaded` rejection is a new error path — `onCacheEntryAdded` callbacks without `try/catch` around `await $cacheDataLoaded` will get unhandled rejections | Medium | High | Mitigate | Document mandatory `try/catch` pattern (matches RTK Query). Add console warning to rejection error message. |
| R6 | Multiple rapid `_doFetch` calls overwrite `_queryResolvers` entry — orphaned `$queryFulfilled` resolvers hang until `clearAll()` | Low | Low | Accept | Matches RTK Query behavior. `clearAll()` on cache reset rejects orphans. No memory leak — resolvers are GC'd when map entry is overwritten. |
| R7 | `Patcher.resolvePatches` catch return semantics: `patchState` with empty `patches` array may confuse callers expecting `null` on failure | Low | Low | Accept | Only consumer is `_finishPatch` which checks `isConsistencyViolation` — empty `patches` is harmless. No external consumers of `resolvePatches`. |
| R8 | `initialMachine` constructor option may be misused outside snapshot hydration — bypassing `_doFetch` for entries that should fetch | Low | Medium | Mitigate | `initialMachine` is passed via internal `_entryFactory` / `hydrateEntry` only. Not exposed in public API (`createResourceV2` options). |
| R9 | `MachineSuccess.cloneWith()` propagating `lastError` through patch operations — stale `lastError` persists until next successful fetch | Low | Low | Accept | Intentional design per [ref: ./04-decisions.md#ADR-6]. `lastError` cleared on `successHappened()`. |
| R10 | Docs reference outdated `devtools.md` options — adding a note without fixing leaves partial inaccuracy | Low | Low | Accept | Devtools integration fix is out of scope. Note is sufficient to prevent developer confusion. |

---

## Detailed Mitigation Plans

### R3: SWR `status === "refreshing"` + `isError: true` Breaking Consumer Patterns

**Risk**: Consumers who pattern-match on `status === "refreshing"` as an exclusive "loading without error" state will now encounter this state combined with `isError: true`. Example: `if (status === "refreshing") return <Spinner />` will now show a spinner even when the query has errored and stale data is available.

**Probability**: Medium — any consumer checking `status` for conditional rendering is affected.

**Impact**: High — UI may display incorrect states (spinner instead of error + stale data).

**Mitigation steps**:

1. **Document the new state combination** in `docs/query-v2/README.md` error handling section. Explicitly list: `{ status: "refreshing", isError: true, data: staleData, error: Error }` as a valid state.
2. **Add migration guidance** recommending boolean flags (`isError`, `isLoading`, `isSuccess`) over raw `status` checks. Example: `if (isError) showErrorBanner()` instead of `if (status === "error") showError()`.
3. **Error/SWR interactive example** (T36) demonstrates the correct rendering pattern — stale data + error banner coexisting.
4. **Verification**: Integration test T17 covers the full SWR cycle including this state combination. Manual verification via demo example.
5. **Responsible**: Implementation stage developer (code + docs) and reviewer.

### R5: `$cacheDataLoaded` Rejection — Unhandled Promise Rejections

**Risk**: Existing `onCacheEntryAdded` callbacks that `await $cacheDataLoaded` without `try/catch` will produce unhandled promise rejections when `resetCache()` or GC triggers entry removal before data loads.

**Probability**: Medium — any user using `onCacheEntryAdded` with streaming/WebSocket patterns is affected.

**Impact**: High — unhandled rejection warnings in console; potentially crashed React error boundaries if rejection propagates.

**Mitigation steps**:

1. **Document the `try/catch` pattern** as mandatory in `docs/query-v2/README.md` lifecycle hooks section and `optimistic-updates.md`. Show the RTK Query-compatible pattern:
   ```typescript
   onCacheEntryAdded: async (args, { $cacheDataLoaded, $cacheEntryRemoved }) => {
     try {
       await $cacheDataLoaded;
       // set up subscriptions
       await $cacheEntryRemoved;
       // cleanup
     } catch {
       // entry removed before data loaded — nothing to clean up
     }
   }
   ```
2. **Use descriptive error message**: `"Promise never resolved before cacheEntryRemoved."` — clearly indicates the cause and is grep-able.
3. **Integration tests** T24/T25 verify correct rejection behavior for both `resetCache` and GC paths.
4. **Lifecycle hooks example** (optional T38-adjacent) demonstrates the `try/catch` pattern visually.
5. **Responsible**: Implementation stage developer (rejection logic + docs) and reviewer.

### R1: `lastError` Broadening `MachineSuccess` Type Surface

**Risk**: Consumers who destructure or type-narrow `MachineSuccess` may encounter `lastError` unexpectedly. TypeScript consumers using exhaustive checks on machine state properties could see new optional field.

**Probability**: Medium — any consumer reading `MachineSuccess` properties is exposed.

**Impact**: Medium — no runtime breakage (field is optional with `undefined` default), but TypeScript-level surprises if consumers have strict property checks.

**Mitigation steps**:

1. **`lastError` is optional** (`lastError?: unknown`) — defaults to `undefined`. No breaking type narrowing for existing code.
2. **`MachineSuccess.error` remains `null`** — the formal discriminant is unchanged. `lastError` is supplementary.
3. **Document in README** error handling section: `lastError` is set only via `MachineRefreshing.errorHappened()` and cleared on next success.
4. **Type-level test** verifies `lastError` is optional on `TSuccessState` and absent on other machine types.
5. **Responsible**: Implementation stage developer (type changes + docs).
