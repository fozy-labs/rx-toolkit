---
title: "Stage: 02-design"
date: 2026-03-23
stage: 02-design
---

# Stage: 02-design

> Phase before 42 removed to simplify redrafts

---

# Redraft Round 11

## Phase 42: Fix issues #41, #42, #43 — ResourceV2 Registry + machine generics + args field

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #41, #42, #43

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: **#41, #42, #43**.

**Issue #41 — "ResourceV2 Registry" defined erroneously**:
Search ALL design documents for the term "ResourceV2 Registry" (and variants like "Registry", "resource registry"). Investigate what purpose this concept currently serves in the design. Determine the correct concept that should replace it — this likely should be the existing `CacheMap` or `createApi`-level tracking, NOT a separate "Registry" entity. Remove or replace every occurrence so that the design is consistent and no phantom concept remains.

**Issue #42 — All machines must accept `<TArgs, TData>`**:
Audit every state machine definition across all design documents. Every machine (ResourceV2Machine, and any other machines) must accept generic parameters `<TArgs, TData>`. Check:
- `03-model.md` — all machine type definitions, interfaces, classes
- `02-dataflow.md` — all sequence/flowchart diagrams referencing machines
- `01-architecture.md` — C4 component diagrams, class diagrams
- `04-decisions.md` — ADRs referencing machine types
- `05-usecases.md` — code examples using machines
- `06-testcases.md` — test cases involving machines

**Issue #43 — All machines must contain `args: TArgs` field**:
Every machine state definition must include an `args: TArgs` field. Audit:
- `03-model.md` — all state interfaces (Idle, Pending, Success, Error, Refreshing)
- `02-dataflow.md` — any diagrams showing machine state shape
- `04-decisions.md` — ADRs describing state structure
- `06-testcases.md` — test expectations on machine state

Files to read first: ALL documents in `../02-design/` (01 through 08). Study the full design before making changes.

---

## Phase 43: Fix issues #44, #48 — Function signature audit + initialSnapshot behavior

- **Agent**: `rdpi-redraft`
- **Output**: `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`
- **Depends on**: 42
- **Retry limit**: 2
- **Review issues**: #44, #48

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: **#44, #48**.

**Issue #44 — All method/function calls must show argument types**:
Study the ENTIRE design to understand which entities exist, their generic parameters, and their method signatures. Then audit every function/method invocation across all documents. Every call must show argument types explicitly. Focus areas:
- `02-dataflow.md` — sequence diagrams, flowcharts: every arrow/call like `cacheMap.getOrCreate(...)`, `rce.query(...)`, `resource.invalidate(...)` must show typed arguments
- `05-usecases.md` — TypeScript code examples: every function call must have typed arguments visible
- `03-model.md` — method signatures in interface/class definitions must be complete with types
- `04-decisions.md` — code snippets in ADRs
- `06-testcases.md` — test case descriptions mentioning method calls

This is a comprehensive audit — do NOT skip any document. Read `03-model.md` first to build a full understanding of all entity signatures, then apply that knowledge across all other documents.

**Issue #48 — `initialSnapshot` behavior must follow specific rules**:
The `initialSnapshot` lifecycle must be reflected precisely in all documents:
1. `createApi({ initialSnapshot })` — the snapshot is **saved** (stored internally)
2. `api.createResource()` — resource is created with initial state; if data from snapshot is stale, invalidation is triggered; the snapshot slice for this resource is **consumed and deleted**
3. `api.resetAll()` — the saved snapshot is **deleted entirely**

Audit and fix:
- `03-model.md` — `ICreateApiOptions`, `IApi` interface, snapshot-related types
- `02-dataflow.md` — snapshot flow diagrams (capture/hydrate sections)
- `04-decisions.md` — ADR-8 (snapshot), ADR-12 (hydration), any other snapshot-related ADRs
- `05-usecases.md` — SSR/snapshot use cases
- `06-testcases.md` — snapshot test cases

Files to read first: ALL documents in `../02-design/` (01 through 08), with special attention to Phase 42 outputs (machines now have `<TArgs, TData>` and `args: TArgs`).

---

## Phase 44: Fix issues #45, #46, #47, Reviewer #1, Reviewer #2 — Targeted document fixes

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `04-decisions.md`
- **Depends on**: 42
- **Retry limit**: 2
- **Review issues**: #45, #46, #47, Reviewer-1, Reviewer-2

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: **#45, #46, #47, Reviewer issue #1 (useEventHandler), Reviewer issue #2 (disconnected node)**.

**Issue #45 — "1.6 Error → Retry" doesn't show how RCE returns data**:
- File: `02-dataflow.md` §1.6
- The Error → Retry diagram must show how `ResourceV2CacheEntry` returns data after a successful retry. Add the data return path to the diagram.

**Issue #46 — "NO_VALUE" still present in one ADR**:
- File: `04-decisions.md`
- Search for `NO_VALUE` across the entire file. It was previously eliminated (ADR-6 replaced it with `TPatchState.isConsistencyViolation`). Find and remove/replace any remaining occurrence.

**Issue #47 — ADR-12 reasoning incorrect**:
- File: `04-decisions.md` ADR-12 ("Snapshot Hydration — No Structural Sharing")
- Problem: The reasoning incorrectly implies resource state exists at snapshot declaration time. In reality, resource state is only created after `api.createResource()`, but the snapshot is declared in `createApi()`. Fix the ADR reasoning to be accurate — snapshot is saved at `createApi` time and consumed per-resource at `createResource` time. Do not change the decision, only correct the reasoning/context.

**Reviewer Issue #1 — `useEventHandler` leftover in C4 Level 1 and ADR-19**:
- Files: `01-architecture.md` §1 (C4 Level 1 edge label), `04-decisions.md` ADR-19
- Remove `useEventHandler` from both locations. It was previously removed from Module Dependency Diagram and Integration table but these two spots were missed.

**Reviewer Issue #2 — disconnected node in §5.2 Read Path**:
- File: `02-dataflow.md` §5.2
- Node `G` has no incoming edges. Node `H` is defined twice with different labels. Fix: connect `F --> G` and separate the duplicate `H` into distinct nodes.

Files to read: `01-architecture.md`, `02-dataflow.md`, `04-decisions.md` in `../02-design/`.

---

## Phase 45: Re-review after Redraft Round 11

- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 42, 43, 44
- **Retry limit**: 2

### Prompt

Re-review all design documents modified in Redraft Round 11 (Phases 42–44).

Read ALL documents in `../02-design/`:
- `01-architecture.md` — verify: no "ResourceV2 Registry", no `useEventHandler` in C4 L1, machines show `<TArgs, TData>`
- `02-dataflow.md` — verify: machines have `<TArgs, TData>` and `args: TArgs`, all function calls show argument types, §1.6 shows RCE data return on retry, §5.2 node connectivity fixed, initialSnapshot flow correct (save → consume+delete → delete on resetAll)
- `03-model.md` — verify: all machine generics are `<TArgs, TData>`, all states have `args: TArgs`, all method signatures show full types, initialSnapshot types correct
- `04-decisions.md` — verify: no "ResourceV2 Registry", no `NO_VALUE`, ADR-12 reasoning corrected, no `useEventHandler` in ADR-19, machine generics consistent
- `05-usecases.md` — verify: all code examples show typed arguments, initialSnapshot use cases follow save/consume-delete/delete rules
- `06-testcases.md` — verify: test cases reflect updated machine generics, args field, initialSnapshot behavior

Also read `../01-research/README.md` for research traceability check.

Review criteria from original design review checklist:
1. Research traceability — all design decisions trace to research findings
2. Internal consistency — no contradictions between documents
3. Completeness — all user issues #41–#48 and reviewer issues addressed
4. Type consistency — `<TArgs, TData>` everywhere, `args: TArgs` in all machine states
5. No phantom concepts — no "ResourceV2 Registry", no `NO_VALUE`, no `useEventHandler` leftovers

Update `README.md` with review results. Set status to `Approved` if all issues resolved, or `Not Approved` with specific remaining issues.

---

# Redraft Round 12

## Phase 46: Fix issue #49 — ADR-12 snapshot hydration reasoning + comprehensive contamination audit

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md`, `05-usecases.md`, `06-testcases.md`, `07-docs.md`, `08-risks.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #49

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issue: **#49**.

**Core Problem**: The phrase "If a resource's cache entry already exists" in ADR-12 is fundamentally wrong. Resource state is ONLY created after `api.createResource()`. At `createApi({ initialSnapshot })` time, the snapshot is ALWAYS present because no resources have been created yet. Hydration of an already-created API (where resources already exist) is NOT a use case. The previous fix (#47) was insufficient — the agent may still carry an incorrect mental model about snapshot hydration throughout the design.

**Part 1 — Fix ADR-12 correctly**:
File: `04-decisions.md`, ADR-12 ("Snapshot Hydration — No Structural Sharing").
Rewrite the Context and Decision sections with the correct understanding:
- `createApi({ initialSnapshot })` saves the snapshot at API creation time. At this point NO resources exist yet — there is nothing to "skip" or "check if exists".
- When `api.createResource(key)` is called later, the API checks whether the saved snapshot contains data for this resource's key. If yes, the resource is initialized with that snapshot data (and the snapshot slice is consumed/deleted). If the snapshot data is stale, invalidation is triggered.
- `api.resetAll()` deletes the saved snapshot entirely.
- There is no scenario where a resource "already exists" at hydration time — hydration happens per-resource at creation time, not at API creation time.
- The decision (no structural sharing) remains the same, but the reasoning must reflect the correct lifecycle.

**Part 2 — Comprehensive contamination audit across ALL design documents**:
The incorrect "skip-if-exists" / "already exists" reasoning may have leaked into other documents. Perform an exhaustive, multi-vector audit:

1. **`01-architecture.md`**: Check all C4 diagrams, component descriptions, and dependency narratives for any mention of snapshot hydration that implies "checking if resource exists" or "skip if exists" logic. The architecture should show: snapshot saved at createApi → consumed per-resource at createResource → deleted at resetAll.

2. **`02-dataflow.md`**: Check ALL snapshot/hydration flow diagrams and sequences. Every diagram showing snapshot hydration must reflect the correct lifecycle: save at createApi, consume+delete per resource at createResource, delete-all at resetAll. No "check if exists" branching for resources. If any flowchart has a decision diamond like "cache entry exists?" in the hydration path — remove it.

3. **`03-model.md`**: Check all type definitions, interfaces, and class descriptions related to snapshots. Verify `ICreateApiOptions.initialSnapshot`, `IApi` snapshot methods, and any snapshot-related types correctly model the save/consume/delete lifecycle. No types should imply "conditional hydration based on existing state".

4. **`04-decisions.md`**: Beyond ADR-12, check ALL other ADRs (especially ADR-8 snapshot serialization, ADR-13 compare+snapshot, and any others mentioning snapshots) for incorrect hydration reasoning.

5. **`05-usecases.md`**: Check all SSR/snapshot use cases. Code examples must show the correct flow: createApi with snapshot → createResource consumes snapshot slice → no "check if exists" patterns.

6. **`06-testcases.md`**: Check all snapshot-related test cases (SN-series, AP-series). Test descriptions and expected outputs must reflect the correct lifecycle. No test should describe "skip hydration if resource already has data" behavior.

7. **`07-docs.md`**: Check documentation impact descriptions for snapshot/SSR sections.

8. **`08-risks.md`**: Check if any risk descriptions contain incorrect snapshot reasoning.

For each document, report what you found and what you changed (or confirm clean). Fix every instance of contamination. If unsure whether a phrase is problematic, err on the side of correcting it — the correct model is simple and unambiguous.

Files to read: ALL documents in `../02-design/` (01 through 08), plus `TASK.md` at `../TASK.md` for original requirements context.

---

## Phase 47: Comprehensive design re-review after Redraft Round 12 (elevated thoroughness)


- **Agent**: `rdpi-design-reviewer`
- **Output**: Updates `README.md`
- **Depends on**: 46
- **Retry limit**: 2

### Prompt

This is a **critical re-review with elevated thoroughness** (x10 depth demanded by user). The previous fix for issue #47 was insufficient, leading to issue #49. You must be extremely rigorous.

Re-review ALL design documents in `../02-design/` after Phase 46 changes:
- `01-architecture.md`
- `02-dataflow.md`
- `03-model.md`
- `04-decisions.md`
- `05-usecases.md`
- `06-testcases.md`
- `07-docs.md`
- `08-risks.md`

Also read `../01-research/README.md` for research traceability.

**Primary focus — Snapshot hydration correctness (Issue #49)**:

The ONLY correct snapshot lifecycle is:
1. `createApi({ initialSnapshot })` — snapshot is **saved** internally. No resources exist yet.
2. `api.createResource(key)` — resource is created; if snapshot has data for this key, it is **consumed and deleted** from the snapshot; if data is stale, invalidation is triggered.
3. `api.resetAll()` — the saved snapshot is **deleted entirely**.

There is NO scenario where a resource "already exists" at hydration time. There is NO "skip-if-exists" logic. There is NO "conditional hydration based on existing state".

Perform the following checks with maximum scrutiny:

1. **ADR-12 correctness**: Read ADR-12 word by word. Verify the Context, Decision, and Consequences sections all correctly describe the save/consume/delete lifecycle. No remnants of "if exists", "skip", "already created" language.

2. **Cross-document contamination scan**: For EVERY document, search for ALL of these patterns and verify they are correct or absent:
   - "already exists" / "if exists" / "skip" in any snapshot/hydration context
   - "check if" + "cache" / "entry" / "resource" in hydration flow
   - Any decision diamond or branching logic in hydration flowcharts
   - "conditional hydration" / "selective hydration"
   - Any implication that resources might exist before createResource is called
   - "hydrate" used as a verb applied to "API" rather than to individual resources at createResource time

3. **Lifecycle consistency across documents**: Verify that ALL documents tell the SAME story about snapshot lifecycle. Cross-check:
   - Architecture (01) descriptions vs. Dataflow (02) diagrams vs. Model (03) types vs. Decisions (04) ADRs vs. Use Cases (05) code vs. Tests (06) expectations
   - Any inconsistency between documents is a finding

4. **Standard design review criteria** (in addition to #49 focus):
   - Research traceability — all design decisions trace to research findings
   - Internal consistency — no contradictions between documents
   - Completeness — all 8 documents present and well-formed
   - Type consistency — `<TArgs, TData>` everywhere, `args: TArgs` in all machine states
   - No phantom concepts — no "ResourceV2 Registry", no `NO_VALUE`, no `useEventHandler`

5. **Regression check on previous rounds**: Spot-check a sample of previously resolved issues to ensure no regressions were introduced by Phase 46 changes.

Update `README.md` with detailed review results. Be explicit about every check performed and its result. Set status to `Approved` ONLY if every single check passes. If ANY ambiguity remains in snapshot hydration reasoning across ANY document, set status to `Not Approved` with precise findings.

---

# Verification Round 13 — Comprehensive per-file and cross-file audit

## Phase 48: Verify 01-architecture.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/48-verify-01-architecture.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/01-architecture.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first to get the complete list of ALL issues ever raised (49 user issues + reviewer issues across 12 redraft rounds). Then read `01-architecture.md` thoroughly.

For EVERY issue in REVIEW.md, determine whether it is relevant to `01-architecture.md`. For each relevant issue, verify that the fix is still correctly applied and no regression exists. Check:

Key issues relevant to this file:
- #1 V2 suffix consistently applied
- #2 Commands removed completely
- #3 / #3.1 Dependency chain explicit, no direct ResourceV2 → CacheEntry dependency
- #4 useOperationV2 / useResourceV2 removed
- #5 Design differentiated from legacy
- #6 ResourceV2CacheEntry inherits CacheEntry
- #7 Private fields in class diagrams
- #9 CacheMap has no knowledge of CacheEntry
- #10 GC timer uses share({resetOnRefCountZero})
- #17 Operations/OperationV2 completely removed
- #22 No SharedOptions/DefaultOptions
- #28 "Snapshot" → "CacheEntry" dependency in C4 unclear
- #29 Verify all C4 diagrams against previous feedback
- #30 common/useEventHandler has no references
- #37 TArgs typed everywhere <TArgs, TData>
- #38 CacheMap TEntry explicitly defined
- #39 useEventHandler in C4 L1
- #41 ResourceV2 Registry removed
- #42 All machines accept <TArgs, TData>
- R-1 useEventHandler removed from C4 L1
- R7-1 OperationV2 scope-exclusion mentions removed

Also check for any OTHER issues from REVIEW.md that might apply to architecture.

Write your findings to `../02-design/verification/48-verify-01-architecture.md`. Format:
```
# Verification: 01-architecture.md
## Issues Checked
| # | Issue | Relevant | Status | Evidence |
## Additional Findings
(any new issues discovered)
## Verdict: PASS / FAIL
```

---

## Phase 49: Verify 02-dataflow.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/49-verify-02-dataflow.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/02-dataflow.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first to get the complete list of ALL issues ever raised (49 user issues + reviewer issues across 12 redraft rounds). Then read `02-dataflow.md` thoroughly.

Key issues relevant to this file:
- #2 Commands removed completely
- #8 Batcher.run() optional for single changes
- #17 Operations/OperationV2 completely removed
- #21 machine$ is a signal, not a method
- #26 Resource.invalidate delegates to RCE.invalidate
- #31 Remove refreshError, onRefreshError, notifyRefreshError
- #32 Dataflow diagrams show what and when is returned
- #33 "1.3 Cache Hit" simplified
- #34 "1.7 GC Lifecycle" — abort patches justified or removed
- #35 "1.7 GC Lifecycle" — abortController.abort() presence
- #36 "3.4 ReactHooksPlugin Lifecycle" — graph connectivity
- #37 TArgs typed everywhere <TArgs, TData>
- #39 disconnected node in §5.2
- #42 All machines accept <TArgs, TData>
- #43 All machines contain args: TArgs
- #44 All function calls show argument types
- #45 §1.6 shows RCE data return on retry
- #48 initialSnapshot save/consume-delete/delete
- #49 ADR-12 snapshot contamination — no "if exists"/"skip" in hydration flows
- R-2 §5.2 Read Path node connectivity fixed

Write your findings to `../02-design/verification/49-verify-02-dataflow.md`. Format:
```
# Verification: 02-dataflow.md
## Issues Checked
| # | Issue | Relevant | Status | Evidence |
## Additional Findings
## Verdict: PASS / FAIL
```

---

## Phase 50: Verify 03-model.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/50-verify-03-model.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/03-model.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first for the complete issue list. Then read `03-model.md` thoroughly.

Key issues relevant to this file:
- #1 V2 suffix consistently applied
- #3 / #3.1 Dependency chain explicit
- #6 ResourceV2CacheEntry inherits CacheEntry
- #9 CacheMap has no knowledge of CacheEntry
- #11 ResourceV2CacheEntry has invalidate(), query()
- #12 Patcher output with isConsistencyViolation
- #13 "snapshot" variable renamed
- #14 Plugin augmentation: PluginAugmentations<TPlugin>
- #15 Pending state data typed as TData | null
- #16 Generic type inference noted
- #17 Operations/OperationV2 removed
- #18 No _inflightMap; abort at RCE level
- #19 CacheMap: serialize vs compare different implementations
- #20 Boolean "is" prefix
- #21 machine$ is a signal, not a method
- #22 No SharedOptions/DefaultOptions
- #23 getOrCreate with factory
- #24 Agent works with RCE, queryFn executed by RCE
- #25 Agent does NOT depend on Resource
- #27 No separate resetAllCacheV2(), only api.resetAll()
- #37 TArgs typed everywhere <TArgs, TData>
- #38 CacheMap TEntry explicitly defined
- #42 All machines accept <TArgs, TData>
- #43 All machines contain args: TArgs
- #44 All function calls show argument types
- #48 initialSnapshot types correct
- #49 Snapshot types reflect correct lifecycle
- R7-2 refreshError removed from IResourceV2AgentState

Write findings to `../02-design/verification/50-verify-03-model.md`. Same format as above.

---

## Phase 51: Verify 04-decisions.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/51-verify-04-decisions.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/04-decisions.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first. Then read `04-decisions.md` thoroughly.

Key issues relevant to this file:
- #2 Commands removed
- #3 Dependency chain in ADRs
- #6 CacheEntry inheritance in ADRs
- #9 CacheMap no knowledge of CacheEntry
- #10 GC via share({resetOnRefCountZero})
- #12 Patcher isConsistencyViolation in ADR-6
- #14 PluginAugmentations in ADR-9
- #17 Operations/OperationV2 removed from all ADRs
- #19 CacheMap dual implementation in ADR-19
- #22 No SharedOptions/DefaultOptions in ADRs
- #27 No resetAllCacheV2 — only api.resetAll()
- #31 refreshError removed from ADRs
- #37 TArgs typed everywhere
- #38 CacheMap TEntry in ADRs
- #39 useEventHandler in ADR-19
- #41 ResourceV2 Registry removed from ADRs
- #42 Machines <TArgs, TData> in ADRs
- #46 NO_VALUE removed from all ADRs
- #47/#49 ADR-12 reasoning correct — snapshot save/consume/delete lifecycle, no "if exists"
- R-1 useEventHandler removed from ADR-19
- R7-1 OperationV2 scope-exclusion mentions
- R7-3 "declaration merging" removed from plugin test strategy

Write findings to `../02-design/verification/51-verify-04-decisions.md`. Same format.

---

## Phase 52: Verify 05-usecases.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/52-verify-05-usecases.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/05-usecases.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first. Then read `05-usecases.md` thoroughly.

Key issues relevant to this file:
- #1 V2 suffix in code examples
- #2 Commands removed from use cases
- #4 useOperationV2 / useResourceV2 removed
- #5 Design differentiated from legacy
- #11 RCE has invalidate(), query() in examples
- #14 PluginAugmentations in plugin use cases
- #17 Operations/OperationV2 removed
- #22 No SharedOptions/DefaultOptions
- #24 Agent works with RCE in examples
- #25 Agent does NOT depend on Resource
- #26 Resource.invalidate delegates to RCE.invalidate
- #27 No resetAllCacheV2(), only api.resetAll()
- #31 refreshError removed
- #37 TArgs typed everywhere <TArgs, TData>
- #42 Machines <TArgs, TData> in examples
- #43 args: TArgs in state examples
- #44 All function calls show argument types
- #48 initialSnapshot save/consume-delete/delete in SSR use cases
- #49 No "if exists"/"skip" in snapshot use cases

Write findings to `../02-design/verification/52-verify-05-usecases.md`. Same format.

---

## Phase 53: Verify 06-testcases.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/53-verify-06-testcases.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/06-testcases.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first. Then read `06-testcases.md` thoroughly.

Key issues relevant to this file:
- #1 V2 suffix in test names
- #2 Commands removed from tests
- #4 useOperationV2 / useResourceV2 removed
- #11 RCE invalidate()/query() tested
- #12 isConsistencyViolation tested
- #15 Pending state data TData | null in test expectations
- #17 Operations/OperationV2 removed
- #22 No SharedOptions/DefaultOptions
- #25 Agent does NOT depend on Resource
- #27 No resetAllCacheV2 — tests use api.resetAll()
- #31 refreshError removed from tests
- #37 TArgs <TArgs, TData> in test descriptions
- #42 Machines <TArgs, TData> in tests
- #43 args: TArgs in test expectations
- #48 initialSnapshot lifecycle in snapshot tests
- #49 No "if exists"/"skip" in snapshot test descriptions
- R7-3 "declaration merging" removed

Write findings to `../02-design/verification/53-verify-06-testcases.md`. Same format.

---

## Phase 54: Verify 07-docs.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/54-verify-07-docs.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/07-docs.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first. Then read `07-docs.md` thoroughly.

Key issues relevant to this file:
- #1 V2 suffix in doc references
- #2 Commands removed from documentation impact
- #4 useOperationV2 / useResourceV2 removed from docs
- #5 Design differentiated from legacy in doc structure
- #17 Operations/OperationV2 removed from doc plan
- #22 No SharedOptions/DefaultOptions in docs
- #27 No resetAllCacheV2 in docs
- #31 refreshError removed from docs
- #49 Snapshot documentation reflects correct lifecycle

Write findings to `../02-design/verification/54-verify-07-docs.md`. Same format.

---

## Phase 55: Verify 08-risks.md against ALL previous remarks

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/55-verify-08-risks.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **targeted verification audit** of a single design document against ALL previously raised issues.

**Your file**: `../02-design/08-risks.md`
**Issues reference**: `../02-design/REVIEW.md`

Read REVIEW.md first. Then read `08-risks.md` thoroughly.

Key issues relevant to this file:
- #2 Commands removed from risk descriptions
- #17 Operations/OperationV2 removed from risks
- #22 No SharedOptions/DefaultOptions in risks
- #27 No resetAllCacheV2 in risks
- #31 refreshError removed from risks
- #37 TArgs consistency in risk descriptions
- #49 Snapshot risks reflect correct lifecycle

Write findings to `../02-design/verification/55-verify-08-risks.md`. Same format.

---

## Phase 56: Cross-check 01-architecture × 04-decisions

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/56-cross-01x04.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/01-architecture.md`
**Comparison file**: `../02-design/04-decisions.md`

Read BOTH files thoroughly. Find ALL inconsistencies between them:
- Entity names, types, generics that differ
- Architectural structures described differently
- ADR decisions that contradict architectural diagrams
- Dependency chains that don't match
- Features mentioned in one but absent/different in the other
- Plugin mechanisms described differently
- GC/lifecycle descriptions that conflict
- Any numbering, naming, or structural mismatches

Write findings to `../02-design/verification/56-cross-01x04.md`. Format:
```
# Cross-check: 01-architecture × 04-decisions
## Inconsistencies Found
| # | Location (file:section) | Location (file:section) | Description |
## Verdict: CONSISTENT / INCONSISTENT
```

---

## Phase 57: Cross-check 01-architecture × 06-testcases

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/57-cross-01x06.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/01-architecture.md`
**Comparison file**: `../02-design/06-testcases.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Entities/classes in architecture not covered by tests
- Test descriptions referencing entities not in architecture
- Layer boundaries in architecture vs test organization
- Component names/types that differ
- Dependency relationships that tests assume but architecture doesn't show

Write findings to `../02-design/verification/57-cross-01x06.md`. Same cross-check format.

---

## Phase 58: Cross-check 02-dataflow × 03-model

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/58-cross-02x03.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/02-dataflow.md`
**Comparison file**: `../02-design/03-model.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Method signatures in dataflow diagrams vs model definitions
- State machine transitions in dataflow vs model state types
- Entity relationships shown in diagrams vs type definitions
- Signal names/types that differ
- Return types in sequence diagrams vs interface definitions
- Generic parameters <TArgs, TData> consistency

Write findings to `../02-design/verification/58-cross-02x03.md`. Same cross-check format.

---

## Phase 59: Cross-check 02-dataflow × 05-usecases

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/59-cross-02x05.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/02-dataflow.md`
**Comparison file**: `../02-design/05-usecases.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Flows described in dataflow diagrams vs code examples in use cases
- Method call sequences that differ
- State transitions shown differently
- Data return paths that don't match
- Plugin lifecycle flows vs plugin use case code
- Snapshot flow vs SSR use case code

Write findings to `../02-design/verification/59-cross-02x05.md`. Same cross-check format.

---

## Phase 60: Cross-check 03-model × 02-dataflow

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/60-cross-03x02.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/03-model.md`
**Comparison file**: `../02-design/02-dataflow.md`

Read BOTH files thoroughly. Focus on model→dataflow direction:
- Every type/interface in model should be used consistently in dataflow diagrams
- Constructor parameters in model vs initialization sequences in dataflow
- Callback signatures in model vs callback invocations in dataflow
- CacheMap factory pattern in model vs getOrCreate usage in dataflow
- Agent callbacks in model vs Agent behavior in dataflow

Write findings to `../02-design/verification/60-cross-03x02.md`. Same cross-check format.

---

## Phase 61: Cross-check 03-model × 06-testcases

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/61-cross-03x06.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/03-model.md`
**Comparison file**: `../02-design/06-testcases.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Every public type/interface in model should have corresponding test cases
- Test assertions referencing properties not in model types
- Generic parameters in test descriptions vs model definitions
- State machine states in tests vs model state types
- Method signatures in tests vs model interfaces

Write findings to `../02-design/verification/61-cross-03x06.md`. Same cross-check format.

---

## Phase 62: Cross-check 04-decisions × 01-architecture

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/62-cross-04x01.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/04-decisions.md`
**Comparison file**: `../02-design/01-architecture.md`

Read BOTH files thoroughly. Focus on decisions→architecture direction:
- Every ADR decision should be reflected in architecture
- ADR rationale references to architectural components should be accurate
- Layer boundaries described in ADRs vs architecture diagrams
- ADR alternatives rejected should not appear in architecture
- ADR-16 (single API instance) reflected in architecture
- ADR-17 (abort at RCE level) reflected in architecture
- ADR-18 (agent independence) reflected in architecture
- ADR-19 (CacheMap dual implementation) reflected in architecture

Write findings to `../02-design/verification/62-cross-04x01.md`. Same cross-check format.

---

## Phase 63: Cross-check 04-decisions × 05-usecases

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/63-cross-04x05.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/04-decisions.md`
**Comparison file**: `../02-design/05-usecases.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Every ADR decision should be demonstrated in at least one use case
- Use case code examples should follow ADR decisions (not rejected alternatives)
- Plugin mechanism in use cases matches ADR-9 (PluginAugmentations, not declare module)
- GC behavior in use cases matches ADR-5
- Snapshot behavior matches ADR-8 and ADR-12
- Error handling matches ADR decisions

Write findings to `../02-design/verification/63-cross-04x05.md`. Same cross-check format.

---

## Phase 64: Cross-check 05-usecases × 03-model

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/64-cross-05x03.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/05-usecases.md`
**Comparison file**: `../02-design/03-model.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Use case code examples use correct types from model
- Method signatures in examples match model interface definitions
- Generic parameters in use case code match model types
- createApi/createResourceV2 option shapes match model
- Plugin hook interfaces in use cases match model
- Agent state shape in use cases matches model

Write findings to `../02-design/verification/64-cross-05x03.md`. Same cross-check format.

---

## Phase 65: Cross-check 05-usecases × 04-decisions

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/65-cross-05x04.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/05-usecases.md`
**Comparison file**: `../02-design/04-decisions.md`

Read BOTH files thoroughly. Focus on usecases→decisions direction:
- Do use case examples ever violate an ADR decision?
- Are there patterns in use cases not covered by any ADR?
- Does the use case for plugins use PluginAugmentations (ADR-9) or the old declare module approach?
- Does resetAll use case follow ADR-16 (single API instance)?
- Does SSR use case follow ADR-8/ADR-12 snapshot lifecycle?

Write findings to `../02-design/verification/65-cross-05x04.md`. Same cross-check format.

---

## Phase 66: Cross-check 06-testcases × 01-architecture

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/66-cross-06x01.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/06-testcases.md`
**Comparison file**: `../02-design/01-architecture.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Test organization mirrors architectural layer structure (lib/core/api/react/plugins)
- All architectural components have test coverage planned
- Test file paths correspond to architecture module paths
- Integration tests cover architectural boundary crossings
- No tests reference entities not in architecture

Write findings to `../02-design/verification/66-cross-06x01.md`. Same cross-check format.

---

## Phase 67: Cross-check 06-testcases × 02-dataflow

- **Agent**: `rdpi-design-reviewer`
- **Output**: `verification/67-cross-06x02.md`
- **Depends on**: —
- **Retry limit**: 1

### Prompt

You are performing a **cross-file consistency audit** between two design documents.

**Primary file**: `../02-design/06-testcases.md`
**Comparison file**: `../02-design/02-dataflow.md`

Read BOTH files thoroughly. Find ALL inconsistencies:
- Every dataflow scenario (fetch, SWR, abort, retry, GC, snapshot, plugin lifecycle) has corresponding test cases
- Test expected behaviors match dataflow diagram outcomes
- State transitions in test assertions match dataflow state machine diagrams
- Edge cases in dataflow are covered by test cases
- Optimistic update flow tested as described in dataflow

Write findings to `../02-design/verification/67-cross-06x02.md`. Same cross-check format.

---

# Redraft Round 13

## Phase 68: Fix 01-architecture.md + 04-decisions.md — issues #1, #3–#10, #13–#16

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `04-decisions.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: #1 (CRI-1, architecture side), #3, #4, #5, #6, #7, #8, #9, #10, #13, #14, #15, #16

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: #1 (CRI-1, architecture side), #3, #4, #5, #6, #7, #8, #9, #10, #13, #14, #15, #16.
Affected files: `../02-design/01-architecture.md`, `../02-design/04-decisions.md`.

**User feedback**: Fix all Critical + High + Medium issues. Low issues are skipped.

**Authoritative guidance for CRI-1** (#1): Machines are immutable — transitions return new instances. Therefore `createPatch` on `MachineWithData` must return both the new machine AND the patch handle. The correct return type is `{ machine: MachineWithData<TArgs, TData>, patchHandle: IPatchHandle } | null`. Update the §5.1 class diagram and any related ADR references to match this. Tests SM31 already expect this shape — architecture must align.

**Summary of all assigned issues** (read REVIEW.md for full details):
- **#1 (CRI-1)**: `createPatch` return type in §5.1 — see guidance above
- **#3**: plugins/ layer number: ADR-1 says Layer 3, architecture §2 says Layer 5 — make consistent
- **#4**: `_lastEntry$` type: architecture §5.2 says `ResourceV2CacheEntry`, ADR-11 says `CacheEntry` — make consistent
- **#5**: patchState double ownership between MachineWithData and RCE — clarify ownership boundary
- **#6**: ResourceV2 missing `resetCache`, `cacheEntries`, `hydrateEntry`, `hasEntry` — add to architecture §5.2
- **#7**: `createCacheMap()` factory function absent — add to architecture
- **#8**: `IResourceV2CacheEntry` public interface absent — add interface vs class distinction
- **#9**: `initialSnapshot` mechanism (`_savedSnapshot`, `initialSnapshot` option) unmodeled in §3a — add architecture diagrams
- **#10**: LifecycleHooks has no method specifications — add hook method signatures
- **#13**: "4-layer" in text but diagrams show 5 layers — fix count
- **#14**: `_signal$` vs `_state$`/`_value$` naming inconsistency — normalize
- **#15**: SKIP vs SKIP_TOKEN naming inconsistency — normalize across both files
- **#16**: Missing RxJS dependency in formal dependency diagram §4 — add edge

Also read for reference (do NOT modify): `../02-design/03-model.md`, `../02-design/06-testcases.md` — use these as source of truth for entities and types that architecture must document.

Fix only your assigned issues.

---

## Phase 69: Fix 03-model.md + 02-dataflow.md — issues #1, #11, #12, #17–#19, #24

- **Agent**: `rdpi-redraft`
- **Output**: `03-model.md`, `02-dataflow.md`
- **Depends on**: 68
- **Retry limit**: 2
- **Review issues**: #1 (CRI-1, model side), #11, #12, #17, #18, #19, #24

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: #1 (CRI-1, model side), #11, #12, #17, #18, #19, #24.
Affected files: `../02-design/03-model.md`, `../02-design/02-dataflow.md`.

**User feedback**: Fix all Critical + High + Medium issues. Low issues are skipped.

**Authoritative guidance for CRI-1** (#1): The correct return type for `MachineWithData.createPatch` is `{ machine: MachineWithData<TArgs, TData>, patchHandle: IPatchHandle } | null`. Phase 68 already updated architecture — align the model's type definitions and any dataflow diagrams that show `createPatch` invocation/return.

**Summary of all assigned issues** (read REVIEW.md for full details):
- **#1 (CRI-1, model)**: Align `createPatch` return type in model type definitions — see guidance above
- **#11**: Machine transition methods (`start`, `successHappened`, `errorHappened`) missing from model §3 — add method signatures to machine classes, not just state shapes
- **#12**: Success→Pending transition described at entry level but is actually agent-level (SWR) — fix separation of entry-level vs agent-level transitions in dataflow/model
- **#17**: ResourceV2 concrete class not in model — add it
- **#18**: `hydrateEntry()` not in model — add it
- **#19**: resetAll "abort patches" contradiction between documents — resolve: determine the correct behavior from dataflow §1.7 and fix the contradiction
- **#24**: `compareArg` typing `(a: unknown, b: unknown)` vs typed at API level — define the correct type in model and ensure consistency

Also read the updated `../02-design/01-architecture.md` (from Phase 68) for reference to ensure model aligns with updated architecture.

Fix only your assigned issues.

---

## Phase 70: Fix 06-testcases.md + 05-usecases.md — issues #2, #20–#23

- **Agent**: `rdpi-redraft`
- **Output**: `06-testcases.md`, `05-usecases.md`
- **Depends on**: 68, 69
- **Retry limit**: 2
- **Review issues**: #2 (CRI-2), #20, #21, #22, #23

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Your assigned issues: #2 (CRI-2), #20, #21, #22, #23.
Affected files: `../02-design/06-testcases.md`, `../02-design/05-usecases.md`.

**User feedback**: Fix all Critical + High + Medium issues. Low issues are skipped.

**Authoritative guidance for CRI-2** (#2): Args-change abort behavior contradiction. Tests RE11/INT12 assert that changing agent args aborts the inflight request for the old entry. Dataflow §1.5 says the old request continues independently. The reviewer recommends the dataflow position as architecturally sound: shared cache entries shouldn't be aborted by one consumer switching away — other consumers may still need that data. **Fix the tests to match the dataflow** — update RE11 and INT12 so they no longer assert abort on args-change. The old entry's request continues independently.

**Summary of all assigned issues** (read REVIEW.md for full details):
- **#2 (CRI-2)**: Fix tests RE11/INT12 to match dataflow §1.5 — see guidance above
- **#20**: SM24 test references `refreshing.patches` but model uses `patchState.patches` — fix test to use correct field path
- **#21**: AG12 test references `state$.obs` not defined on ComputeFn — fix property name to match model
- **#22**: LH06 test says "resolves with data" but type is `Promise<{data: TData}>` — fix expected type
- **#23**: UC-5 comment says patchState on machine state but it's on RCE — fix use case comment

Also read the updated `../02-design/01-architecture.md`, `../02-design/03-model.md`, `../02-design/02-dataflow.md` (from Phases 68–69) for reference to ensure tests and use cases align with updated architecture and model.

Fix only your assigned issues.

---

## Phase 71: Re-review after Redraft Round 13

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 68, 69, 70
- **Retry limit**: 2

### Prompt

Re-review all design documents modified in Redraft Round 13 (Phases 68–70).

Read ALL documents in `../02-design/`:
- `01-architecture.md` — verify: CRI-1 `createPatch` return type is `{ machine, patchHandle } | null`, plugins layer consistent with ADR-1, `_lastEntry$` type consistent with ADR-11, patchState ownership clarified, `resetCache`/`cacheEntries`/`hydrateEntry`/`hasEntry` added to ResourceV2, `createCacheMap()` factory documented, `IResourceV2CacheEntry` interface present, `initialSnapshot` mechanism modeled in §3a, LifecycleHooks has method signatures, layer count "5-layer" consistent, signal naming normalized, SKIP_TOKEN naming consistent, RxJS in dependency diagram
- `02-dataflow.md` — verify: `createPatch` return type aligned, Success→Pending at correct level (agent not entry), resetAll "abort patches" contradiction resolved, machine transition method calls consistent with model
- `03-model.md` — verify: `createPatch` return type aligned, transition methods added, ResourceV2 class present, `hydrateEntry()` present, `compareArg` correctly typed
- `04-decisions.md` — verify: plugins layer number consistent, `_lastEntry$` type consistent, SKIP_TOKEN naming consistent
- `05-usecases.md` — verify: UC-5 patchState reference correct
- `06-testcases.md` — verify: CRI-2 RE11/INT12 no longer assert abort on args-change, SM24 uses correct `patchState.patches` path, AG12 uses correct property, LH06 correct return type

Also read `../01-research/README.md` for research traceability check.

Review criteria:
1. All 24 issues (2 Critical + 10 High + 12 Medium) correctly resolved
2. Internal consistency across all documents — no new contradictions introduced
3. Type consistency — `<TArgs, TData>` everywhere
4. No regressions from previous rounds (spot-check sample of resolved issues #1–#49)

Update `README.md` with review results. Set status to `Approved` if all issues resolved, or `Not Approved` with specific remaining issues.

---

# Redraft Round 14

## Phase 72: Investigate + fix Low issues in `01-architecture.md` + `04-decisions.md`

- **Agent**: `rdpi-redraft`
- **Output**: `01-architecture.md`, `04-decisions.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: Low issues from verification files 48, 57, 62, 66

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Read ALL verification files referenced below for issue details.

**User feedback**: Исследовать ВСЮ документацию, перепроверить, спроектировать и исправить при необходимости. ALL 35 Low-severity issues must be investigated, verified, and fixed where needed.

Your assigned Low issues affecting `01-architecture.md` and `04-decisions.md`:

**LOW-A1** (from `verification/48-verify-01-architecture.md`, Finding A1):
§4 "All Internal Connections" diagram missing `Machines --> Pat` edge. §2 shows `Machines --> Patcher`, §3 shows `MWD --> Pat`, but §4 omits this connection. README.md Round 10 Fix #10 claims "§4 shows both `RCE --> Pat` and `Machines --> Pat`" but only `RCE --> Pat` is present. Investigate and add the missing edge if confirmed.

**LOW-A2** (from `verification/62-cross-04x01.md`, ADR-1 finding):
ADR-1 in `04-decisions.md` says plugins are "alongside api/" (Layer 3), but architecture correctly places plugins at Layer 5 because `ReactHooksPlugin` depends on `useResourceV2Agent` (react/, Layer 4). The architecture is structurally correct. Investigate whether ADR-1's phrasing needs to be updated to avoid ambiguity (e.g., "plugins form a separate layer above react, not alongside api").

**LOW-A3** (from `verification/66-cross-06x01.md`, Issue #3):
`initialSnapshot` option on `createApi` referenced in tests (AP08, SN07, etc.) but not explicitly documented in architecture §3a or §7.1. Phase 68 (Redraft Round 13) addressed High issue #9 about initialSnapshot mechanism — verify that architecture now fully shows `initialSnapshot` as a `createApi` option. If not, add it.

**LOW-A4** (from `verification/66-cross-06x01.md`, Issue #4):
`_savedSnapshot` internal field referenced in tests (AP05, AP08b, SN12) but absent from architecture §3a diagrams. §3a shows `_resources: Set<ResourceV2>` and `Merged Configuration` but omits `_savedSnapshot`. Investigate whether `_savedSnapshot` should be added to §3a.

**LOW-A5** (from `verification/66-cross-06x01.md`, Issue #6):
`createCacheMap()` factory function referenced in tests (CM-F04, CM-F05) but Phase 68 resolved High issue #7 about this. Verify that architecture now includes the factory. If not, add it.

**LOW-A6** (from `verification/57-cross-01x06.md`, Issue #15):
`resetCache()` is tested (RE14, RE22, RE23) and used by `api.resetAll()` delegation, but its visibility (public vs internal) is undefined in architecture. Architecture §5.2 and §7.1/§7.2 don't list it. Investigate and document its visibility.

Read ALL design documents in `../02-design/` (01 through 08) to understand full context before making changes. Fix only your assigned issues. For each issue: investigate, determine if a fix is needed, and apply the fix. If investigation concludes no fix is needed, document the rationale as a brief comment in the affected section.

---

## Phase 73: Investigate + fix Low issues in `02-dataflow.md`

- **Agent**: `rdpi-redraft`
- **Output**: `02-dataflow.md`
- **Depends on**: —
- **Retry limit**: 2
- **Review issues**: Low issues from verification files 49, 59, 60, 67

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Read ALL verification files referenced below for issue details.

**User feedback**: Исследовать ВСЮ документацию, перепроверить, спроектировать и исправить при необходимости. ALL 35 Low-severity issues must be investigated, verified, and fixed where needed.

Your assigned Low issues affecting `02-dataflow.md`:

**LOW-D1** (from `verification/49-verify-02-dataflow.md`, Additional Finding 1):
§5.4 `LifecycleHooks.fireCacheEntryRemoved` flowchart label doesn't show argument types. All other cross-component API calls in §1.x–§5.x show typed signatures (per resolved issue #44). Investigate whether this label should include argument types for consistency.

**LOW-D2** (from `verification/49-verify-02-dataflow.md`, Additional Finding 2):
Informal machine mentions in Mermaid Notes (lines ~77 "MachineSuccess with fresh data" and ~129 "MachinePending, inflight request active") omit `<TArgs, TData>` generics. All formal `set()` calls and type expressions use `<TArgs, TData>` consistently. Investigate whether these informal annotations need updating.

**LOW-D3** (from `verification/59-cross-02x05.md`, Issue #2):
Agent state `entry` field absent from all dataflow `state$` outputs. All diagrams in §1.1–§1.6 show only `{status, data, isLoading, isInitialLoading, isRefreshing}`, but `IResourceV2AgentState` (model §8.1) also includes `entry: IResourceV2CacheEntry | null`. UC-5 destructures `entry` from hook result. Investigate whether dataflow diagrams should include `entry` or add a note referencing the full state shape.

**LOW-D4** (from `verification/59-cross-02x05.md`, Issue #3):
Inconsistent agent state field selection across dataflow diagrams. Different sections show different subsets: §1.1 pending shows `isInitialLoading` but omits `isLoading`; §1.4 refreshing shows `isRefreshing` but omits `isLoading`. UC-11 (complete state table) says `isLoading=true` in all these cases. A reader might infer `isLoading` is false. Investigate whether to standardize field outputs or add a reference note.

**LOW-D5** (from `verification/67-cross-06x02.md`, Issue F-67-04):
`complete()` patch behavior nuance. Test RCE15 expects `complete()` to abort patches. Dataflow §1.7 says "Abort patches — NO" for GC. This is not a hard contradiction — GC fires at refcount=0 when no patches are possible, but `complete()` may defensively abort. `resetAll()` calls `complete()` while components may still have patches. Investigate and clarify: does `complete()` unconditionally abort patches (defensive), or only in specific paths? Update §1.7 note to be precise.

**LOW-D6** (from `verification/60-cross-03x02.md`, WARN #14):
Agent `_lastArgs` field not explicitly shown in dataflow §1.3 cache-hit scenario. The cache-hit detection via `compareArgs(a, b)` is correct, but the source of `a` (which is `_lastArgs`) is not shown. Investigate whether adding this internal state reference improves clarity.

**LOW-D7** (from `verification/60-cross-03x02.md`, WARN #20):
`resetAll()` full sequence (abort patches → reset machine → complete entries → clear cache → _savedSnapshot=null) is not consolidated in a single diagram. Pieces are scattered across §6.2, §2.1, and §5.4. Investigate whether a dedicated `resetAll` sequence diagram is needed or if a cross-reference note suffices.

Read ALL design documents in `../02-design/` (01 through 08) to understand full context before making changes. Fix only your assigned issues. For each issue: investigate, determine if a fix is needed, and apply the fix. If investigation concludes no fix is needed, document the rationale as a brief comment or note.

---

## Phase 74: Investigate + fix Low issues in `03-model.md`

- **Agent**: `rdpi-redraft`
- **Output**: `03-model.md`
- **Depends on**: 72, 73
- **Retry limit**: 2
- **Review issues**: Low issues from verification files 58, 60, 61

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Read ALL verification files referenced below for issue details.

**User feedback**: Исследовать ВСЮ документацию, перепроверить, спроектировать и исправить при необходимости. ALL 35 Low-severity issues must be investigated, verified, and fixed where needed.

Your assigned Low issues affecting `03-model.md`:

**LOW-M1** (from `verification/58-cross-02x03.md`, Issue #5):
`CacheEntry.obs` — the RxJS observable bridge for `share({resetOnRefCountZero})` is referenced in dataflow §1.7 (participant `CacheEntry.obs`) and §2.2 (signal chain `CacheEntry.obs → share() → useSignal`) but absent from model. Model §5 `ICacheEntry` has `state$()`, `peek()`, `set()`, `complete()`, `onClean$` — no `.obs` property. Investigate the signal-to-RxJS bridge mechanism and add the `.obs` property to the model if appropriate.

**LOW-M2** (from `verification/58-cross-02x03.md`, Issue #6):
`Batcher` is referenced in dataflow §1.1, §5.1, §6.1, §6.3 (`Batcher.run()` for grouping signal writes) but has ZERO presence in model. Model §15 "Internal vs Public Type Summary" table doesn't even list it. Unlike other internal components (CacheEntry, CacheMap, LifecycleHooks, Patcher) which have interface sketches, Batcher has none. Investigate whether Batcher needs a model entry.

**LOW-M3** (from `verification/58-cross-02x03.md`, Issue #7):
`LifecycleHooks` class underdefined in model. Dataflow §5.4 invokes `LifecycleHooks.fireCacheEntryRemoved` as an internal step. Model §9 defines user-facing callback types (`TOnCacheEntryAdded`, `TOnQueryStarted`) but provides NO class definition for the internal orchestrator. Model §15 lists it as Internal but gives no fields or methods, unlike CacheEntry (§5), CacheMap (§6.3), RCE (§7.3), Agent (§8.1). Investigate and add at least a minimal interface sketch.

**LOW-M4** (from `verification/61-cross-03x06.md`, WARN #27):
`stableStringify` is tested (L02–L09) but has no formal type signature in model. Model §15 lists it as Internal/lib but provides no definition. §6.3 references it as default `serializeArgs`. Investigate whether a type signature should be added to model (e.g., in a lib section or §15).

**LOW-M5** (from `verification/61-cross-03x06.md`, WARNs #31–#35):
Machine transition method interfaces absent from model. Tests define 11 transition methods across 5 classes (`start`, `successHappened`, `errorHappened`, `reset`, `invalidate`, `retry`, `createPatch→{machine,patchHandle}`, `finishPatch(type,patch)`, `abortAllPendingPatches()`). Also `LifecycleHooks.clearAll()`. Model §3 defines only state types and `TMachineInstance` union but no machine class method signatures. Redraft Round 13 Phase 69 resolved High issue #11 (transition methods) — verify that model now includes these. If not, add machine class method interfaces.

**LOW-M6** (from `verification/61-cross-03x06.md`, F4):
SN10 test says `getSnapshot()` throws for compare strategy. This behavior is not documented on `IApi.getSnapshot()` in model §12.1. Model's `TResourceSnapshot.entries` uses `Record<string, ...>` implying string keys, but no throw behavior is specified. Investigate and add throw specification if appropriate.

Read ALL design documents in `../02-design/` (01 through 08), paying particular attention to the updated `01-architecture.md` (from Phase 72) and `02-dataflow.md` (from Phase 73) to ensure model aligns with any changes. Fix only your assigned issues.

---

## Phase 75: Investigate + fix Low issues in `05-usecases.md` + `06-testcases.md`

- **Agent**: `rdpi-redraft`
- **Output**: `05-usecases.md`, `06-testcases.md`
- **Depends on**: 72, 73, 74
- **Retry limit**: 2
- **Review issues**: Low issues from verification files 57, 59, 61, 63, 66, 67

### Prompt

Read REVIEW.md at `../02-design/REVIEW.md`.
Read ALL verification files referenced below for issue details.

**User feedback**: Исследовать ВСЮ документацию, перепроверить, спроектировать и исправить при необходимости. ALL 35 Low-severity issues must be investigated, verified, and fixed where needed.

Your assigned Low issues split into two files:

**=== 05-usecases.md issues (4) ===**

**LOW-U1** (from `verification/59-cross-02x05.md`, Issue #4):
UC-4 imperative retry comment says `// resource.query() sees error state → fetches again`. Dataflow §1.6 shows the chain: `Agent.start(args) → _getEntry(args) → RCE.query()` — it's `entry.query()`, not `resource.query()`. Fix the comment.

**LOW-U2** (from `verification/63-cross-04x05.md`, Issue #2):
UC-4 has a broken cross-reference: `[ref: 04-decisions.md ADR-2 — Refreshing errorHappened returns MachineSuccess with stale data]`. ADR-2 covers immutable class-based machine decision and TError removal, NOT the "Refreshing errorHappened" transition. Investigate and fix the reference to point to the correct source (model or dataflow).

**LOW-U3** (from `verification/63-cross-04x05.md`, Issue #3):
Shared setup section (line ~53) has `plugins: [new ReactHooksPlugin()]` without `as const`. ADR-9 shows `as const` in its type-level mechanism example, and UC-10/UC-14 in the same file correctly use `as const`. Without `as const`, TypeScript widens the type and `PluginAugmentations` won't resolve contributions. Fix by adding `as const`.

**LOW-U4** (from `verification/63-cross-04x05.md`, Issue #5):
UC-3 cross-reference points to wrong file: `[ref: 01-architecture.md ADR-3 — ...]`. ADR-3 is defined in `04-decisions.md`, not `01-architecture.md`. Fix the path.

**=== 06-testcases.md issues (14) ===**

**LOW-T1** (from `verification/57-cross-01x06.md` #7 / `66-cross-06x01.md` #2):
Snapshot tests labeled "Test Cases — Snapshot" instead of "Test Cases — core Layer: Snapshot". Architecture §3 places Snapshot in core/ Layer 2. All other core subsections use "core Layer: X" format. Fix heading.

**LOW-T2** (from `verification/57-cross-01x06.md` #10 / `61-cross-03x06.md` F1):
Test ID gaps: RE17 and AP07 are missing from numbering. RE jumps RE16→RE18, AP jumps AP06→AP08. Investigate: were tests deleted without renumbering? If so, renumber to fill gaps OR add a note explaining the gap.

**LOW-T3** (from `verification/66-cross-06x01.md` #1 / `57-cross-01x06.md` #6):
Plugins test section labeled "Test Cases — core Layer: Plugins" (PL01–PL08). Architecture §2 defines plugins/ as Layer 5, NOT core. Fix heading to "Test Cases — plugins Layer" or "Test Cases — plugins Layer: ReactHooksPlugin".

**LOW-T4** (from `verification/66-cross-06x01.md` #5):
Plugin Testing Strategy section says "Verify PluginAugmentations types compile correctly (type-level tests)" but no concrete test IDs exist for this. Investigate and either add test case IDs (e.g., PL09, PL10 for type-level assertions) or clarify that type-level tests use `.test-d.ts` files outside the ID scheme.

**LOW-T5** (from `verification/67-cross-06x02.md`, F-67-05):
Dataflow §3.2 states "Later plugins can see earlier plugins' contributions." No test case verifies this cross-plugin visibility behavior. Investigate and add a test case if appropriate.

**LOW-T6** (from `verification/67-cross-06x02.md`, F-67-06):
Error state `data=null` not explicitly asserted. Dataflow §4.1 table specifies error state has `data: null`, but SM06/SM19 test error without asserting `data === null`. Investigate and add explicit assertion if needed.

**LOW-T7** (from `verification/67-cross-06x02.md`, F-67-07):
No test for `getEntry$` binding optimization (§6.2). Dataflow describes caching behavior: once bound, returns same reference without re-querying `_lastEntry$`. This is an implementation optimization — investigate whether a test is warranted.

**LOW-T8** (from `verification/61-cross-03x06.md`, WARN #9):
`ICacheMap.values()` method has no dedicated test case. Investigate and add a test if the method is in the model interface.

**LOW-T9** (from `verification/61-cross-03x06.md`, WARN #13):
`IResourceV2AgentState` fields `isRefreshing`, `isError`, `error`, `args` lack dedicated agent-level test cases. Only tested indirectly via React hooks (RH09 for isError). Investigate and add dedicated agent-level tests if appropriate.

**LOW-T10** (from `verification/61-cross-03x06.md`, WARN #20):
PluginAugmentations type-level tests — strategy mentions them but no concrete test IDs. This may overlap with LOW-T4. Investigate and add type-level test IDs if appropriate.

**LOW-T11** (from `verification/61-cross-03x06.md`, WARN #23):
Standalone `createResourceV2` function — no dedicated test for standalone-specific options (e.g., `keyStrategy`, `keyPrefix` at standalone level). Investigate whether a test case is needed.

**LOW-T12** (from `verification/61-cross-03x06.md`, WARN #26):
`IResourceV2Options.beforeDevtoolsPush` — no test case for this option's behavior. Investigate and add if appropriate.

**LOW-T13** (from `verification/61-cross-03x06.md`, F3):
RE20–RE23 section header mentions `_lastEntry$` but no test case in that section actually tests `_lastEntry$`. Investigate and fix header or add test.

**LOW-T14** (from `verification/61-cross-03x06.md`, F5):
RE08 description mixes `resetCache()` (internal) with `getEntry$` (public). Description: "Create computed using getEntry$() → resetCache()". Investigate whether this should reference `api.resetAll()` instead, or clarify it's testing internal behavior.

Read ALL design documents in `../02-design/` (01 through 08), paying particular attention to the updated `01-architecture.md` (Phase 72), `02-dataflow.md` (Phase 73), and `03-model.md` (Phase 74) to ensure use cases and tests align with any changes. Fix only your assigned issues.

---

## Phase 76: Re-review after Redraft Round 14

- **Agent**: `rdpi-design-reviewer`
- **Depends on**: 72, 73, 74, 75
- **Retry limit**: 2

### Prompt

Re-review all design documents modified in Redraft Round 14 (Phases 72–75).

This round addressed ALL 35 Low-severity issues from Verification Round 13. The issues were spread across all design documents.

Read ALL documents in `../02-design/`:
- `01-architecture.md` — verify: §4 now has `Machines --> Pat` edge, ADR-1 layer phrasing clarified in 04-decisions.md, `initialSnapshot` shown in §3a, `_savedSnapshot` in §3a, `createCacheMap()` factory present, `resetCache()` visibility documented
- `02-dataflow.md` — verify: §5.4 LifecycleHooks label has types, informal machine notes addressed, `entry` field in agent state addressed, consistent agent state fields across diagrams, `complete()` patch behavior clarified, `_lastArgs` in §1.3 addressed, `resetAll()` sequence addressed
- `03-model.md` — verify: `CacheEntry.obs` addressed, `Batcher` addressed, `LifecycleHooks` class defined, `stableStringify` signature addressed, machine transition methods present (from Round 13 + Round 14), `getSnapshot()` throw behavior documented
- `04-decisions.md` — verify: ADR-1 plugin layer phrasing clarified
- `05-usecases.md` — verify: UC-4 comment fixed ("entry.query()" not "resource.query()"), UC-4 ADR-2 reference fixed, shared setup has `as const`, UC-3 reference points to 04-decisions.md
- `06-testcases.md` — verify: Snapshot section labeled "core Layer", RE17/AP07 gaps addressed, Plugins section labeled "plugins Layer", type-level test IDs addressed, cross-plugin visibility test added, error `data=null` assertion added, binding optimization test addressed, `ICacheMap.values()` test addressed, agent state field tests addressed, `beforeDevtoolsPush` test addressed, RE20-RE23 header fixed, RE08 description fixed

Also read ALL verification files in `../02-design/verification/` (48–67 + SUMMARY.md) to verify that every Low-severity issue identified there has been addressed.

Review criteria:
1. All 35 Low-severity issues investigated and resolved (fixed or justified as not-needing-fix with documented rationale)
2. No regressions from Redraft Round 13 fixes (Critical, High, Medium issues remain resolved)
3. Internal consistency across all 8 design documents
4. No new issues introduced by the Low-issue fixes

Update `README.md` with review results. Set status to `Approved` if all issues resolved with no regressions, or `Not Approved` with specific remaining issues.

---
