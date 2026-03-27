---
title: "Verification: 06-testcases.md"
date: 2026-03-25
file: "06-testcases.md"
issues_checked: 16
pass: 16
fail: 0
---

# Verification — 06-testcases.md

## Summary

All 16 issues verified as resolved. No regressions found.

## Issue Verification

### #1 — V2 suffix consistently applied
**Status**: PASS  
V2 suffixes used correctly throughout: `createResourceV2`, `ResourceV2`, `ResourceV2Agent`, `ResourceV2CacheEntry`, `useResourceV2Agent`, `IResourceV2CacheEntry`. These are proper class/function/interface names, not spurious tags. No bare "V2" labels in test descriptions.

### #2 — Commands removed from tests
**Status**: PASS  
Zero matches for `Command`, `createCommand`, `useCommandAgent` in 06-testcases.md. The entire test plan covers only query-v2 concepts: ResourceV2, Agent, CacheEntry, CacheMap, Patcher, Plugins, Snapshot.

### #4 — useOperationV2 / useResourceV2 removed
**Status**: PASS  
Zero matches for `useOperationV2`. All hook references use `useResourceV2Agent` (with the Agent suffix): RH01–RH10, PL06, INT02–INT04, and the React Hook Testing Strategy section (line 106).

### #11 — RCE invalidate()/query() tested
**Status**: PASS  
Comprehensively tested at two levels:
- **Resource level**: RE09 (`resource.invalidate` success→refreshing), RE10 (non-success no-op), RE01–RE05 (`resource.query` lifecycle)
- **RCE consumer level**: RCE08 (`entry.invalidate()` success→refreshing), RCE09 (non-success no-op), RCE10 (`entry.query()` idle→pending), RCE11 (dedup), RCE12 (force re-fetch)
- **Integration**: INT09 (consistency violation → auto-invalidation)

### #12 — isConsistencyViolation tested
**Status**: PASS  
Tested at three levels:
- **Patcher**: PA03, PA05 (isConsistencyViolation=false), PA10 (out-of-order abort → true), PA11 (applyPatches throw → true)
- **RCE**: RCE13 (initial false), RCE14 (violation → true + auto-invalidate)
- **Integration**: INT09 (full flow: multi-patch → violation → refetch → fresh data)

### #15 — Pending state data TData | null in test expectations
**Status**: PASS  
Pending/idle states consistently show `data=null`:
- SM01: `data=null` (idle)
- SM02: `data=null` (pending)
- RH02: `data=null` (SKIP → idle)
- AG07: idle state, no data

Success states show concrete `TData` values (SM05: `data={name:"test"}`). The pattern `TData | null` is correctly reflected by using `null` for no-data states and concrete values for data-present states.

### #17 — Operations/OperationV2 removed
**Status**: PASS  
Zero matches for `Operation`, `OperationV2`, `createOperation`, `useOperationAgent` in 06-testcases.md.

### #22 — No SharedOptions/DefaultOptions
**Status**: PASS  
One mention on line 77: "query-v2 has no global singletons like `SharedOptions`" — this is an explicit statement that SharedOptions is NOT used, explaining test isolation. No `DefaultOptions` anywhere. Test Isolation section correctly states each test creates its own `createApi()` / `createResourceV2()` instances.

### #25 — Agent does NOT depend on Resource
**Status**: PASS  
AG01: "agent.start(args) obtains entry via `_getEntry` callback" — uses injected callback, not direct Resource dependency. AG13 says "delegates to resource" which describes behavior (the compareArgs function originates from resource config), but the test mechanics use the injected callback pattern, not a class-level import dependency.

### #27 — No resetAllCacheV2 — tests use api.resetAll()
**Status**: PASS  
All reset tests use `api.resetAll()`: AP05, AP08b, SN12, INT10. Zero matches for `resetAllCacheV2`, `resetAllQueriesCache`, or any standalone reset function. Resource-level reset uses `resetCache()` (RE14, RE22, RE23, E06) which is an internal method, not a standalone export.

### #31 — refreshError removed from tests
**Status**: PASS  
Zero matches for `refreshError`, `onRefreshError`, `notifyRefreshError`. SM21 correctly tests refreshing error → stale-preserved: "refreshing.errorHappened(err) → instanceof MachineSuccess, data=staleData (not error state)" per ADR-2.

### #37 — TArgs <TArgs, TData> in test descriptions
**Status**: PASS  
Generics consistently use `<TArgs, TData>`:
- Controllable-promise helper (line 49): `createControllableResource<TArgs, TData>()`
- createResourceV2 call (line 57): `createResourceV2<TArgs, TData>({...})`
- SN03: `Machine.fromSnapshot<TArgs, TData>()`
- CacheMap tests mention `TArgs keys in entries()` (CM-F05, CM16)
- No instances of lone `<TData>` without `<TArgs>`.

### #42 — Machines <TArgs, TData> in tests
**Status**: PASS  
Machine tests verify both TArgs and TData slots with concrete values:
- Args: SM02 `args={id:1}`, SM08 `pending.args === { id: 5 }`, SM11 `args={id:2}`, SM15 `.state` includes `args`
- Data: SM05 `data={name:"test"}`, SM14 `success.data === data`, SM20 `data=newData`
- fromSnapshot: SN03 uses `Machine.fromSnapshot<TArgs, TData>()` explicitly
- SM25–SM30 test all machine states via fromSnapshot with both args and data fields.

### #43 — args: TArgs in test expectations
**Status**: PASS  
Concrete TArgs values in expectations throughout: SM02 `args={id:1}`, SM08 `{id:5}`, SM11 `{id:2}`, SM17 `{id:3}`. Helper defaults to `TArgs = { id: number }` (line 49). Agent tests: AG01 `{id:1}`, AG10 rapid arg changes. CacheMap tests use explicit `{id:N}` args. All aligned with `TArgs` typing.

### #48 — initialSnapshot lifecycle in snapshot tests
**Status**: PASS  
Full lifecycle covered across two hydration paths:
1. **Initial hydration** (save → consume+delete → delete): AP08 (save+consume), AP08a (no-match → no hydration), AP08b (resetAll deletes snapshot), SN07 (empty cache → hydrated), SN11 (slice deleted after consume), SN12 (resetAll deletes _savedSnapshot), INT04 (full SSR round-trip)
2. **maxSnapshotDataAge**: AP08c (old data → auto-invalidation), SN08 (expired entry invalidated)
3. **Round-trip**: SN09 (getSnapshot → serialize → deserialize → createApi({initialSnapshot}) → createResourceV2)

### #49 — No "if exists"/"skip" in snapshot test descriptions
**Status**: PASS  
Zero matches for "if exists", "skip hydrat", "already created", "conditional hydration" in snapshot-related tests. SN06 uses "no hydration, no warning" (unconditional). SN07 uses "populates empty cache" (unconditional). All snapshot tests describe deterministic create/populate actions.

### R7-3 — "declaration merging" removed
**Status**: PASS  
Zero matches for "declaration merging" in 06-testcases.md. Plugin testing strategy (lines 97–102) uses "Object.assign merge of contributions" and "PluginAugmentations types compile correctly (type-level tests)". PL03 tests "Contributions merged via Object.assign". No module augmentation / declaration merging language.
