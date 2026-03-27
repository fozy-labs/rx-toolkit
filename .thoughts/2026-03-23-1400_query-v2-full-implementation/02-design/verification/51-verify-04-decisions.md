---
title: "Verification: 04-decisions.md"
date: 2026-03-25
file: 04-decisions.md
issues_checked: 23
---

# Targeted Verification — 04-decisions.md

## Summary

**File**: `04-decisions.md` (850 lines, 19 ADRs)
**Issues checked**: 23 (all assigned issues from REVIEW.md)
**Result**: ALL PASS — no remaining violations found.

---

## Issue-by-Issue Verification

### #2 — Commands removed
**Status**: PASS
**Evidence**: Full-text search for `Command` across the file — zero matches. No ADR references Commands, CommandV2, createCommand, or useCommandAgent as concepts in the v2 design.

### #3 — Dependency chain explicit in ADRs
**Status**: PASS
**Evidence**:
- ADR-4 (L110): `ResourceV2 → CacheMap<ResourceV2CacheEntry> → ResourceV2CacheEntry extends CacheEntry → Machine`
- ADR-18 (L730): `Agent → RCE (not Agent → Resource → CacheMap → RCE)`
- ADR-2 (L87): `Machine → CacheEntry → ResourceV2 → Agent chain without any intermediate casts`
All three chains are explicit and consistent.

### #3.1 — No direct ResourceV2 → CacheEntry dependency
**Status**: PASS
**Evidence**: ADR-4 chain shows ResourceV2 depends on CacheMap which contains ResourceV2CacheEntry (extends CacheEntry). No direct ResourceV2 → CacheEntry import implied anywhere.

### #6 — CacheEntry inheritance in ADRs
**Status**: PASS
**Evidence**: ADR-4 is entirely dedicated to this decision. Option 1 chosen: `ResourceV2CacheEntry<TArgs, TData> extends CacheEntry<TMachineInstance<TArgs, TData>>`. Explicit reference to v0.1 docs requirement (`IResourceV2CacheEntry наследуется от ICacheEntry`).

### #9 — CacheMap no knowledge of CacheEntry
**Status**: PASS
**Evidence**: ADR-19 contains a dedicated "TEntry Constraint Decision" section:
- "CacheMap never calls methods on entries"
- "TEntry unconstrained enforces separation structurally"
- "User requirement — 'CacheMap has no knowledge of CacheEntry'"
- Rejected: `TEntry extends CacheEntry` — "would leak CacheEntry into CacheMap's type signature"

### #10 — GC via share({resetOnRefCountZero})
**Status**: PASS
**Evidence**: ADR-5 is entirely dedicated to this. Decision explicitly chooses "Refcount + timer hybrid using the share({resetOnRefCountZero}) RxJS pattern from v1's ReactiveCache". Includes full code snippet with `share()` config and `_getOnRefCountZero(cacheLifetime)` helper. References `src/query/lib/ReactiveCache.ts`.

### #12 — Patcher isConsistencyViolation in ADR-6
**Status**: PASS
**Evidence**: ADR-6 Decision describes `IPatchResolution<TData>` with `{ data, patchState }`. `patchState` is `TPatchState<TData> | null` containing `originalData`, `patches`, and `isConsistencyViolation`. When violation detected, ResourceV2CacheEntry triggers `invalidate()` automatically. Sentinel type eliminated — `patchState` is `null` when no patches active.

### #14 — PluginAugmentations in ADR-9
**Status**: PASS
**Evidence**: ADR-9 Decision uses Option 2: `PluginAugmentations<TPlugin, TArgs, TData>` generic conditional type augmentation. Full code snippet shows `PluginResourceContributions<TPlugin, TArgs, TData>` conditional type and `PluginAugmentations<TPlugins, TArgs, TData>` intersection. Comparison table vs `declare module` included. Legacy anti-pattern section explicitly describes why declaration merging is replaced.

### #17 — Operations/OperationV2 removed from all ADRs
**Status**: PASS
**Evidence**: Full-text search for `OperationV2` — zero matches. No ADR mentions Operations or OperationV2 as a concept. ADR-15 naming table contains only Resource-related names (no Operation entries).

### #19 — CacheMap dual implementation in ADR-19
**Status**: PASS
**Evidence**: ADR-19 is entirely dedicated to this. Two implementations: `SerializeCacheMap` (Map<string, TEntry>, O(1)) and `CompareCacheMap` (Array, O(n)). Factory function `createCacheMap(options)`. Implementation comparison table included. Both receive `factory: (args: TArgs) => TEntry` callback.

### #22 — No SharedOptions/DefaultOptions in ADRs
**Status**: PASS
**Evidence**: ADR-19 (L802, L826) — `SharedOptions`/`DefaultOptions` mentioned only in negation:
- "there is no dependency on SharedOptions or DefaultOptions from src/common/options/"
- "No dependency on SharedOptions or DefaultOptions. The default compareArg is shallowEqual from common/utils/ (a pure utility), not from a mutable global singleton."
No positive dependency on these anywhere in the file.

### #27 — No resetAllCacheV2 — only api.resetAll()
**Status**: PASS
**Evidence**: Full-text search for `resetAllCacheV2` — zero matches. `resetAll()` appears in ADR-8 (`api.resetAll(): void`), ADR-11, ADR-16, ADR-17 — always as `api.resetAll()` or `resetAll()` method, never as a standalone export.

### #31 — refreshError removed from ADRs
**Status**: PASS
**Evidence**: Full-text search for `refreshError`, `onRefreshError`, `notifyRefreshError` — zero matches. No ADR references these concepts.

### #37 — TArgs typed everywhere
**Status**: PASS
**Evidence**: Generics consistently use `<TArgs, TData>` throughout:
- ADR-4: `ResourceV2CacheEntry<TArgs, TData>`, `CacheEntry<TMachineInstance<TArgs, TData>>`
- ADR-8: `Machine.fromSnapshot<TArgs, TData>(slice: TMachineState<TArgs, TData>): TMachineInstance<TArgs, TData>`, `MachineSuccess<TArgs, TData>`
- ADR-9: `PluginAugmentations<TPlugins, TArgs, TData>`, `IReactHooksPluginContributions<TArgs, TData>`
- ADR-12: `TMachineInstance<TArgs, TData>`
- ADR-17: `ResourceV2CacheEntry<TArgs, TData>`
- ADR-18: `_getEntry: (args: TArgs) => ResourceV2CacheEntry<TArgs, TData>`
- ADR-19: `ICacheMap<TArgs, TEntry>`, `factory: (args: TArgs) => TEntry`
No instances of `<TData>` alone where `<TArgs, TData>` is expected.

### #38 — CacheMap TEntry in ADRs
**Status**: PASS
**Evidence**: ADR-19 "TEntry Constraint Decision" section explicitly addresses this. TEntry is intentionally unconstrained (no `extends` bound). Rationale: CacheMap never calls methods on entries, GC cleanup is external, consistent with Issue #9. Rejected `TEntry extends CacheEntry` and `TEntry extends IDisposable`.

### #39 / R-1 — useEventHandler removed from ADR-19
**Status**: PASS
**Evidence**: Full-text search for `useEventHandler` — zero matches in the entire file. ADR-19 lists acceptable common/ dependencies as `shallowEqual`, `PromiseResolver`, `useConstant` — no `useEventHandler`.

### #41 — ResourceV2 Registry removed from ADRs
**Status**: PASS
**Evidence**: Full-text search for `Registry` — zero matches. ADR-16 describes resource tracking via `internal Set<ResourceV2>`, not a "ResourceV2 Registry" concept.

### #42 — Machines <TArgs, TData> in ADRs
**Status**: PASS
**Evidence**: Machine types consistently carry `<TArgs, TData>`:
- ADR-4: `TMachineInstance<TArgs, TData>`
- ADR-8: `Machine.fromSnapshot<TArgs, TData>`, `MachineSuccess<TArgs, TData>`, `TMachineState<TArgs, TData>`
- ADR-12: `Machine.fromSnapshot()` creating `TMachineInstance<TArgs, TData>`
ADR-2 lists machine class names without inline generics (shorthand in option listing) but the Decision section discusses dropping `TError` and references the `<TArgs, TData>` type chain. Cross-ADR usage is consistent.

### #46 — NO_VALUE removed from all ADRs
**Status**: PASS
**Evidence**: Full-text search for `NO_VALUE` — zero matches.

### #47/#49 — ADR-12 reasoning correct (snapshot lifecycle)
**Status**: PASS
**Evidence**: ADR-12 Context section explicitly states:
- "no resources exist yet — the API instance has just been created and its _resources set is empty"
- "CacheMap is always empty — there are no pre-existing entries"
- Decision: "Each createResourceV2() creates a fresh resource with an empty CacheMap, then populates it from the saved snapshot slice"
- 3-phase lifecycle: save → consume+delete → delete
- No "if exists", "skip", "already created" language in ADR-12.

### R7-1 — OperationV2 scope-exclusion mentions
**Status**: PASS
**Evidence**: Full-text search for `OperationV2` — zero matches. No scope-exclusion or scope-inclusion mentions of OperationV2 anywhere.

### R7-3 — "declaration merging" removed from plugin test strategy
**Status**: PASS (N/A for this file)
**Evidence**: R7-3 targets 06-testcases.md, not 04-decisions.md. In 04-decisions.md, "declaration merging" appears 9 times — all in ADR-9 and ADR-15, exclusively as: (a) historical context describing the legacy approach being replaced, (b) the rejected Option 1, (c) the "Legacy anti-pattern resolved" section, (d) a comparison table showing why generic augmentation is preferred. This is correct usage — describing what's being replaced, not proposing it.

---

## Conclusion

All 23 issues verified as resolved. No violations, phantom concepts, or regressions found in `04-decisions.md`. The 19 ADRs are internally consistent and aligned with issue requirements.
