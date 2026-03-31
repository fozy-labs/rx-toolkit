---
title: "Design Review: CommandV2 Architecture"
date: 2026-03-30
stage: 02-design
role: rdpi-design-reviewer
---

# CommandV2 Architecture — Design Review

## 1. Confirmed Decisions Coverage (Q1–Q9)

| Decision | ADR | Status | Notes |
|---|---|---|---|
| Q1: Feature scope | ADR-1 | ✅ PASS | Core + link essentials. Drops lock/create/mutate/isRepeating with rationale. |
| Q2: State machine shape | ADR-2 | ✅ PASS | Separate CommandMachine hierarchy. Patcher shared as standalone utility. |
| Q3: Link resolution | ADR-3 | ✅ PASS | ResourceV2Ref adapter with invalidate/patch/commit/abort. |
| Q4: Caching | ADR-4 | ✅ PASS | Simple `Map<symbol, CacheEntry>` per CommandV2 instance. |
| Q5: Plugin system | ADR-5 | ✅ PASS | `augmentCommand?()` on IPlugin, `PluginCommandContributions` conditional type. |
| Q6: Public API | ADR-6 | ✅ PASS | Both standalone `_createCommandV2` and `api.createCommandV2`. |
| Q7: Drop select | ADR-7 | ✅ PASS | Consistent with v2 Resource. |
| Q8: Exclude snapshots | ADR-8 | ✅ PASS | Commands start idle on every page load. |
| Q9: No previous tracking | ADR-9 | ✅ PASS | Fire-and-forget semantics. |

**Verdict**: All 9 confirmed decisions are addressed with ADRs and research traceability.

---

## 2. Architectural Consistency

| Check | Status | Notes |
|---|---|---|
| C4 diagram aligns with component responsibilities table | ✅ PASS | All components listed in both. Relationships match. |
| State machine diagram matches transition table | ✅ PASS | Idle→Loading→Success\|Error, Success/Error→Loading re-entry. |
| Data flow matches C4 component relationships | ⚠️ MINOR | Sequence diagram shows "Agent->>Agent: Create new CacheEntry" — but responsibilities table says CommandV2 owns the `Map<symbol, CacheEntry>`. Entry creation should route through CommandV2, not Agent self-delegation. |
| ADR-4 (simple Map) consistent with CacheEntry extension | ✅ PASS | CommandV2CacheEntry extends CacheEntry; Map keyed by agent symbol. |
| Plugin types mirror existing resource pattern | ✅ PASS | `PluginCommandContributions` follows identical conditional-type pattern as `PluginResourceContributions`. |
| API extension consistent with existing IApi | ✅ PASS | `createCommandV2` parallel to `createResourceV2`, same plugin augmentation merge. |
| Lifecycle hooks align with v2 resource lifecycle | ✅ PASS | `onCacheEntryAdded` and `onQueryStarted` follow same promise-tool pattern. |

---

## 3. State Machine Review

### Correctness

| Transition | Valid? | Notes |
|---|---|---|
| Idle → Loading (`start`) | ✅ | Clean entry point. |
| Loading → Success (`successHappened`) | ✅ | Sets data, clears error. |
| Loading → Error (`errorHappened`) | ✅ | Sets error, preserves args. |
| Success → Loading (`start`) | ✅ | Clears previous data/patchState. |
| Error → Loading (`start`) | ✅ | Clears previous error. |

No unreachable states. No dead transitions. Idle is terminal unless `start()` is called.

### Edge Cases

| Edge Case | Addressed? | Notes |
|---|---|---|
| Concurrent trigger while loading | ✅ | §4 Data Flow Rule #1: abort previous AbortController, new execution replaces it. |
| trigger() from Success state | ✅ | Transition table: Success → Loading clears data/patchState. |
| trigger() from Error state | ✅ | Transition table: Error → Loading clears error. |
| **Abort race condition** | ⚠️ GAP | When previous execution is aborted, the old queryFn may still resolve/reject after abort signal fires. Design doesn't specify whether stale settlements are ignored (e.g., `if (abortSignal.aborted) return`). ResourceV2CacheEntry handles this with `_inflightPromise` dedup — CommandV2CacheEntry should document the same guard. |
| **Agent.reset() during in-flight** | ⚠️ GAP | `reset()` method declared on `ICommandV2Agent` but behavior during in-flight execution is unspecified. Should it abort the AbortController? Revert to Idle silently? Fire error hooks? |
| **CacheEntry reuse vs. replacement on re-trigger** | ⚠️ GAP | Data flow says "Create new CacheEntry (or reuse)" — ambiguous. ADR-4 gives each agent one symbol key, implying reuse. If reused, the CacheEntry must internally abort previous execution and reset AbortController. If replaced, old entry needs cleanup. Behavior must be specified. |

---

## 4. Link / ResourceV2Ref Error Scenarios

| Scenario | Addressed? | Notes |
|---|---|---|
| Linked resource has valid entry | ✅ | Data flow shows full happy path: patch → queryFn → commit/invalidate. |
| **Linked resource has NO entry for forwarded args** | ❌ GAP | `ResourceV2Ref` wraps `IResourceV2 + IResourceV2CacheEntry`, but if `resource.getEntry(forwardedArgs)` returns nothing (resource never queried for those args), `optimisticUpdate` and `update` cannot apply. Design must specify: skip silently? Create entry on resource via `getOrCreate`? Throw? In v1, `ResourceRef.patch()` gets-or-creates the cache entry. |
| optimisticUpdate abort triggers consistency violation | ✅ | §4 Rule #4: Patcher detects violation → linked resource auto-invalidates. Traces to `ResourceV2CacheEntry._finishPatch()`. |
| **Linked resource entry in error/pending state** | ⚠️ GAP | `createPatch` on `MachineWithData` only exists on Success/Refreshing states. If the linked resource is in Pending or Error state, `entry.createPatch()` is undefined. Design should specify behavior — likely skip optimistic update and fall through to invalidation. |
| queryFn success but linked resource was invalidated externally | ✅ | Patcher resolves patches on commit. If resource state changed, Patcher's consistency detection handles it. |
| Multiple links — partial failure | ⚠️ MINOR | Links processed in order (§4 Rule #2), but if link N fails during resolution, should links N+1… still execute? V1 processes all links unconditionally. Design should clarify. |

---

## 5. Plugin Type System Feasibility

| Aspect | Feasible? | Notes |
|---|---|---|
| `augmentCommand?()` optional method on IPlugin | ✅ | Optional interface member — existing plugins won't break. |
| `PluginCommandContributions` conditional type | ✅ | Exact same `TPlugin extends { name: "..." }` pattern as resources. Proven in codebase. |
| `PluginCommandAugmentations` union→intersection merge | ✅ | Reuses existing `UnionToIntersection<U>` utility type. |
| `IApi.createCommandV2` return type with augmentations | ✅ | `ICommandV2<A,R> & PluginCommandAugmentations<P,A,R>` — same intersection pattern as resource. |
| Third-party plugin extensibility | ✅ | New plugins add a conditional branch to `PluginCommandContributions`. Module augmentation also possible. |

**Verdict**: Fully feasible. No novel type-level patterns required.

---

## 6. Missing Components or Flows

| # | Missing Item | Severity | Details |
|---|---|---|---|
| 1 | **Agent state type narrowing** | **Medium** | `TCommandV2AgentState` groups `"loading" \| "success" \| "error"` into one union branch with `data: TResult \| null`. This prevents TypeScript narrowing on `status === "success"` → `data: TResult`. Should be a proper 4-branch discriminated union (idle / loading / success / error) like the machine types already define. |
| 2 | **ResourceV2Ref: no-entry handling** | **Medium** | See §4. Must specify behavior when linked resource has no cache entry for forwarded args. |
| 3 | **CacheEntry reuse semantics** | **Medium** | See §3. Ambiguous whether re-trigger reuses or replaces the CacheEntry. Affects abort handling, GC, and lifecycle hooks. |
| 4 | **Agent.reset() specification** | **Low** | Must define: abort in-flight? Clean entry from Map? Fire lifecycle hooks? |
| 5 | **trigger() promise on concurrent calls** | **Low** | If trigger() is called while previous is in-flight, does the old promise reject with AbortError? Resolve never? This affects consumer `try/catch` patterns. |
| 6 | **Component unmount abort policy** | **Low** | When the component unmounts (agent unsubscribes), should the in-flight command be aborted? V1 does NOT abort on unmount. Design should state this explicitly. |
| 7 | **cacheLifetime for commands** | **Low** | Default 1000ms. For fire-and-forget commands with one entry per agent, the only purpose is cleanup delay after unmount. The motivation and interaction with agent lifecycle unclear — worth a sentence of clarification. |
| 8 | **Stale settlement guard** | **Low** | See §3 abort race condition. Aborted queryFn may still resolve — must ignore stale settlements. |

---

## Summary

**Q1–Q9 coverage**: ✅ Complete — all 9 decisions have ADRs with research refs.
**Architecture quality**: Strong overall; 3 medium-severity gaps (agent state type narrowing, ResourceV2Ref no-entry behavior, CacheEntry reuse semantics) and 5 low-severity underspecifications need resolution before planning stage.
