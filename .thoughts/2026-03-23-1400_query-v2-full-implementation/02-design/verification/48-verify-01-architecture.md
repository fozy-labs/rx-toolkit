# Verification: 01-architecture.md

## Issues Checked

| # | Issue | Relevant | Status | Evidence |
|---|-------|----------|--------|----------|
| 1 | V2 suffix consistently applied | Yes | PASS | All entities carry V2 suffix: `createResourceV2`, `ResourceV2`, `ResourceV2Agent`, `ResourceV2CacheEntry`, `useResourceV2Agent`, `IResourceV2AgentState`. Exceptions per ADR-15 (`createApi`, `IApi`) correct. |
| 2 | Commands removed completely | Yes | PASS | Zero Command entity references. Only ref anchor `q3-should-command-mutation-support-be-included-in-scope` (research traceability, acceptable). |
| 3 | Dependency chain explicit | Yes | PASS | Chain `ResourceV2 → CacheMap → ResourceV2CacheEntry extends CacheEntry → Machine` shown in §2 L2, §3 L3, §5.2 class diagram. |
| 3.1 | No direct ResourceV2 → CacheEntry dependency | Yes | PASS | §4: no `Res → CE` arrow. §5.2: `ResourceV2 --> ICacheMap : owns`, `ResourceV2 --> ResourceV2CacheEntry : creates & returns`. ResourceV2 never touches CacheEntry directly. |
| 4 | useOperationV2 / useResourceV2 removed | Yes | PASS | Zero occurrences. Only `useResourceV2Agent` exists (§2, §4, §4a, §6.3, §7.1). |
| 5 | Design differentiated from legacy | Yes | PASS | §9 has 8 dedicated subsections (§9.1–§9.8) covering: type system, SWR, GC, CacheEntry, Agent.start, CacheEntry.complete, missing features, plugin augmentation. |
| 6 | ResourceV2CacheEntry inherits CacheEntry | Yes | PASS | §3 L3: `RCE -->  extends  CE`. §5.2 classDiagram: `ResourceV2CacheEntry --|> CacheEntry : extends`. §9.4: explicit inheritance description. |
| 7 | Private fields in class diagrams | Yes | PASS | §5.2: ResourceV2 (`-_cache`, `-_status$`, `-_lastEntry$`), CacheEntry (`-_signal$`, `-_isCompleted`), RCE (`-_patchState`, `-_args`, `-_queryFn`, `-_abortController`, `-_inflightPromise`), Agent (`-_tracking$`, `-_getEntry`, `-_compareArgs`, `-_lastArgs`), SerializeCacheMap (`-_map`, `-_factory`, `-_serializeArgs`), CompareCacheMap (`-_entries`, `-_factory`, `-_compareArg`). |
| 8 | Batcher.run() optional for single changes | Yes | PASS | §6.1 table: "**Optional for single changes** — a single `signal.set()` call propagates immediately without `Batcher.run()`. Use batching only when multiple signals must update atomically." |
| 9 | CacheMap has no knowledge of CacheEntry | Yes | PASS | §5.2: `ICacheMap~TArgs_TEntry~` with inline comment `%% TEntry: unconstrained — CacheMap never calls methods on entries`. Factory callback pattern (`getOrCreate`) confirmed. |
| 10 | GC timer uses share({resetOnRefCountZero}) | Yes | PASS | §9.3: explicit `share({resetOnRefCountZero: () => timer(cacheLifetime)})` description, contrasted with legacy timer approach. |
| 11 | RCE has invalidate(), query() | Yes | PASS | §5.2 class diagram: `+invalidate(): void`, `+query(doForce?): Promise~TData~` on ResourceV2CacheEntry. |
| 12 | Patcher output with isConsistencyViolation | Marginal | PASS | §5.1 MachineWithData: `+finishPatch(type, patch)` exists. Patcher shown in Machine subsystem. Detailed spec in model/decisions, not architecture's responsibility. |
| 14 | PluginAugmentations\<TPlugin\> | Yes | PASS | §9.8: explicit mention of `PluginAugmentations<TPlugin, TArgs, TData>` as generic conditional type replacing `declare module`. |
| 17 | Operations/OperationV2 completely removed | Yes | PASS | Zero "OperationV2" occurrences. §8 constraint 2: "Only ResourceV2 — scope is limited to ResourceV2 for this iteration; additional entity types are out of scope." |
| 18 | No _inflightMap; abort at RCE level | Yes | PASS | §5.2 ResourceV2 has no `_inflightMap` field. RCE has `-_abortController: AbortController \| null` and `-_inflightPromise: Promise~TData~ \| null`. |
| 22 | No SharedOptions/DefaultOptions | Yes | PASS | Zero mentions. §4 External subgraph: only `PromiseResolver`, `shallowEqual`, `useConstant`. §6.2 Common Utilities table: same three utilities only. |
| 25 | Agent does NOT depend on Resource | Yes | PASS | §4: `RA --> RCE` only (no `RA --> Res` arrow). §5.2: Agent has `_getEntry` and `_compareArgs` callbacks; no Resource reference. §9.5: explicitly states agent has no dependency on ResourceV2. |
| 27 | No separate resetAllCacheV2() | Yes | PASS | §3a: `Reset --> ResSet` via `api.resetAll()`. §7.1: public API lists only `api.resetAll()`. Zero `resetAllCacheV2` occurrences. |
| 28 | "Snapshot" → "CacheEntry" dependency in C4 unclear | Yes | PASS | §3 L3 Core: `Snap --> Res` (Snapshot depends on ResourceV2, not CacheEntry). §3a API: `GetSnap --> ResSet`. Dependency is clear. |
| 29 | Verify all C4 diagrams against previous feedback | Yes | PASS | 8 Mermaid diagrams verified (§1, §2, §3, §3a, §4, §4a, §5.1, §5.2). Arrows directional, labels descriptive, no orphaned nodes in core diagrams. One minor edge omission found in §4 (see Additional Findings). |
| 30 | common/useEventHandler has no references | Yes | PASS | §4 External subgraph: only `PR`, `SE`, `UC`. No `useEventHandler` node or edge anywhere in the document. §6.2 table: no useEventHandler row. |
| 31 | refreshError/onRefreshError/notifyRefreshError removed | Yes | PASS | Zero occurrences in the entire document. |
| 37 | TArgs typed everywhere \<TArgs, TData\> | Yes | PASS | §3 L3: all core types show `<TArgs,TData>`. §5.1: all 6 machine classes `~TArgs_TData~`. §5.2: ResourceV2, Agent, RCE, CacheEntry all have proper generics. ICacheMap uses `~TArgs_TEntry~`. |
| 38 | CacheMap TEntry explicitly defined | Yes | PASS | §5.2: `ICacheMap~TArgs_TEntry~` with explicit comment: `%% TEntry: unconstrained — CacheMap never calls methods on entries`. SerializeCacheMap/CompareCacheMap both `~TArgs_TEntry~`. Factory callback pattern cleanly decouples TEntry. |
| 39 | useEventHandler in C4 L1 | Yes | PASS | §1 C4 L1: nodes are `User`, `QV2`, `SIG`, `COM`, `EXT` only. Common edge label: `"PromiseResolver, shallowEqual, useConstant"` — no useEventHandler. |
| 41 | ResourceV2 Registry removed | Yes | PASS | Zero "Registry" occurrences. §3a uses `_resources: Set<ResourceV2>` (not a registry). |
| 42 | All machines accept \<TArgs, TData\> | Yes | PASS | §5.1: `MachineWithData~TArgs_TData~`, `MachineIdle~TArgs_TData~`, `MachinePending~TArgs_TData~`, `MachineSuccess~TArgs_TData~`, `MachineError~TArgs_TData~`, `MachineRefreshing~TArgs_TData~`. |
| 43 | All machines contain args: TArgs | Yes | PASS | §5.1: MachineIdle `+args: null`, MachinePending `+args: TArgs`, MachineSuccess `+args: TArgs`, MachineError `+args: TArgs`, MachineRefreshing `+args: TArgs`. |
| 46 | NO_VALUE removed | Yes | PASS | Zero occurrences. |
| 49 | Snapshot hydration correctness | Marginal | PASS | §3a: Snapshot in API layer consistent with save→consume+delete→delete lifecycle. No problematic "if exists" language. |
| R-1 | useEventHandler removed from C4 L1 | Yes | PASS | Identical to #30/#39 — zero useEventHandler references anywhere. |
| R7-1 | OperationV2 scope-exclusion mentions removed | Yes | PASS | §8 constraint 2 says "additional entity types are out of scope" without naming OperationV2. |
| R7-2 | refreshError missing from IResourceV2AgentState | No | N/A | Architecture §5.2 shows Agent's `state$` type but does not define IResourceV2AgentState fields (model's concern). |
| R7-4 | Research ref anchors contain "Command" | Yes | PASS (Skipped by design) | §8 constraint 2 ref anchor `q3-should-command-mutation-support-be-included-in-scope` — research anchor, acceptable per REVIEW.md decision. |

### Issues not relevant to 01-architecture.md

| # | Issue | Reason |
|---|-------|--------|
| 13 | "snapshot" variable renamed | Code examples, not architecture diagrams |
| 15 | data: TData \| null | Type detail, model-level concern |
| 16 | Generic inference noted | Use case code examples |
| 19 | CacheMap serialize vs compare | Shown in §5.2 (verified as part of #38) |
| 20 | Boolean "is" prefix | Naming convention, verified in §5.2 (`_isCompleted`) |
| 21 | machine$ is a signal, not a method | Verified in §5.2 (`+machine$ : ReadableSignalFnLike~...~`) |
| 23 | getOrCreate with factory | Verified in §5.2 ICacheMap (`+getOrCreate(args): TEntry`) |
| 24 | Agent works with RCE, queryFn at RCE | Verified as part of #25 |
| 26 | Resource.invalidate delegates to RCE | Dataflow/model concern |
| 32–36 | Dataflow-specific issues | 02-dataflow.md concerns |
| 40 | Aggressive re-check of all design | Meta-issue, not specific to a file |
| 44 | Function calls show argument types | Dataflow diagrams |
| 45 | §1.6 RCE data return on retry | Dataflow diagrams |
| 47 | ADR-12 reasoning corrected | 04-decisions.md concern |
| 48 | initialSnapshot lifecycle | Cross-document, architecture verified in #49 |
| R7-3 | "declaration merging" in plugin test | 06-testcases.md concern |

## Additional Findings

### Finding A1 — §4 "All Internal Connections" missing `Machines --> Pat` edge (Low)

- **What's wrong**: §4 Module Dependency Diagram ("All Internal Connections") shows `Machines["Machine classes"]` as a node with only one incoming edge (`RCE --> Machines`) but no outgoing edges. The `Machines --> Pat` (Patcher) dependency is absent. However, §2 L2 explicitly shows `Machines --> Patcher`, and §3 L3 shows `MWD --> Pat`.
- **Where**: §4 Mermaid diagram, lines ~191–215
- **What's expected**: `Machines --> Pat` edge should be present in §4 to be consistent with §2 and §3.
- **Impact**: README.md Redraft Round 10 Fix #10 claims "§4 shows both `RCE --> Pat` and `Machines --> Pat`" but only `RCE --> Pat` is actually present. The verification claim is incorrect.
- **Severity**: Low — correct information exists in §2 and §3; §4 is just an incomplete summary.

## Verdict: FAIL

One Low-severity issue found (§4 missing `Machines --> Pat` edge, contradicting §2/§3 and its own Round 10 verification claim). All tracked issues from REVIEW.md are correctly resolved with no regressions.
