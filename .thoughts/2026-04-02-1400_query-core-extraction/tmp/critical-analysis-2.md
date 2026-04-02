---
title: "Critical Analysis #2: Extraction Approaches & OSS Matrix"
date: 2026-04-02
stage: 01-research
role: rdpi-questioner
---

## 1. LOC Claims Are Inflated

- **ResourceCacheEntry actual**: 296 lines (file), ~256 lines (class body). Documents claim "~350 LOC" (extraction-approaches.md) and "~290 lines" (cache-entry-comparison.md). **Two different numbers across docs, both wrong.**
- **CommandCacheEntry actual**: 249 lines (file), ~223 lines (class body). Documents claim "~300 LOC" (extraction-approaches.md, command-structure.md) and "~280 lines" (cache-entry-comparison.md). **Also inconsistent, overestimated by 20%.**
- **CacheEntry**: 76 lines actual. Documents say 74. Close enough.
- **Consequence**: All LOC delta calculations in the 3 approaches are based on wrong baselines. Net savings are overstated.

## 2. The ~78 Lines Duplication Estimate Is Generous

Actual identical code verified against source:

| Pattern | Actual identical lines | Claimed |
|---------|----------------------|---------|
| Field declarations (abort + 3 resolvers) | 4 | ~6 |
| Abort block in `complete()` | 4 | ~12 (includes Resource-only `_inflightPromise`/`_patchState` cleanup — NOT shared) |
| 3× PromiseResolver cleanup in `complete()` | 9 | ~12 |
| `_fireCacheEntryAdded` core (guard + resolver creation + tools + try/catch) | 10 | ~16 |
| `_onQueryStarted` fire pattern | ~5 (resolver creation + tools + try/catch skeleton) | ~10 |
| `_queryFulfilled` reject-before-new | 3 | ~6 |
| **Realistic total** | **~35** | **~78** |

- The 78-line figure double-counts Resource-only code (hydration check in `_fireCacheEntryAdded`, `_inflightPromise`/`_patchState` cleanup in `complete()`). These are NOT duplication.
- The figure also counts "structurally similar but semantically different" code as duplication (e.g., abort stale checks — one uses controller identity, other uses `signal.aborted`).
- **Real extractable duplication is ~35-45 lines, not 78.** This changes the cost/benefit calculus significantly.

## 3. Approach Justification Assessment

### Approach A (Enrich CacheEntry): Adequately justified
- Claims ~38 lines saved → plausible given real duplication of ~35-45.
- Honest about only solving half the problem.
- Correctly identifies SRP violation risk.
- **Gap**: Doesn't discuss that `CacheEntry` is a *generic reactive container* — adding abort/lifecycle makes it query-specific. If signals module ever wanted a `CacheEntry`-like container, it would inherit dead fetch concepts.

### Approach B (FetchableCacheEntry): Over-justified
- Claims 83% extraction (65/78). **With real duplication at ~35-45 lines, the 65-line "savings" is impossible without also moving non-duplicated code into the base.** The approach secretly refactors non-duplicated code into "shared helpers" to inflate the extraction metric.
- The `_resetQueryFulfilled()`, `_resolveEntryDataLoaded()`, `_resolveQueryFulfilled()`, `_rejectQueryFulfilled()` helpers shown in the FetchableCacheEntry skeleton are **1-5 line methods wrapping single PromiseResolver calls.** This is creating abstraction for abstraction's sake — the call sites (`this._entryDataLoaded.resolve(data)` → `this._resolveEntryDataLoaded(data)`) save zero lines.
- **3-level hierarchy for 2 consumers of ~35 lines shared code is over-engineering.**

### Approach C (FetchEngine): Honestly justified but weak case
- Claims 67% (52/78). With corrected baseline, actual extraction would be ~30-35 lines into a 75-line class. **Net LOC increase.**
- Correctly identifies that wiring boilerplate largely replaces the duplication 1:1.
- FetchEngine's `resolveDataLoaded(data)` is no simpler than `this._entryDataLoaded.resolve(data)`. **Indirection without simplification.**

## 4. Missing 4th Approach: Utility Functions (No Structural Change)

None of the approaches consider the simplest option:

```typescript
// ~15 LOC total, no class, no hierarchy change
function cleanupLifecycleResolvers(resolvers: {
    entryDataLoaded: PromiseResolver | null;
    entryRemoved: PromiseResolver | null;
    queryFulfilled: PromiseResolver | null;
}): void { /* reject/resolve/null pattern */ }

function createLifecycleTools<T>(
    entryDataLoaded: PromiseResolver<T>,
    entryRemoved: PromiseResolver<void>,
): { $cacheDataLoaded: Promise<T>; $cacheEntryRemoved: Promise<void> } { ... }
```

- **Eliminates ~19 lines of the most clearly identical code** (the 9-line `complete()` cleanup + 10-line `_fireCacheEntryAdded` core).
- **Zero structural changes.** No hierarchy depth increase. No new classes. No composition wiring.
- **Zero risk.** Pure functions, tested in isolation.
- Doesn't address abort or `_onQueryStarted` duplication (which is only ~8 lines and semantically divergent anyway).
- **This is the approach TanStack/RTK would use.** Both keep helpers as standalone functions, not class methods.

## 5. Gaps and Contradictions

### 5.1 The "Phase 2 stubs" contradiction
- `command-structure.md` and `shared-infra.md` note Command machines are marked "Stub — full implementation in Phase 2."
- `critical-analysis-1.md` raises this as a question but **no approach addresses it.**
- **Risk**: If Command machines are stubs that will grow, extracting shared code now means re-extracting later when stubs are fleshed out. The extraction target is potentially unstable.

### 5.2 Batcher asymmetry is unaddressed
- Command wraps state transitions in `Batcher.run()` in 3 places. Resource does NOT use Batcher in `_doFetch`.
- **No approach discusses whether a shared fetch base should batch or not.** If `FetchableCacheEntry.complete()` or `_setupLifecycleResolvers()` ever needs to coordinate with signal updates, the Batcher question becomes critical.
- This isn't academic — `batcher-analysis.md` §6 explicitly flags the asymmetry but the extraction approaches ignore it.

### 5.3 Stale-check divergence has no resolution strategy  
- Resource: `this._abortController !== controller` (identity check, propagates stale errors)
- Command: `controller.signal.aborted` (signal check, swallows stale errors)
- Both Approach B and C "leave stale checks in subclasses" — but B *also* provides `_abortInflight()` in the base. **What happens if someone calls `_abortInflight()` THEN does a stale check? The base method nulls `_abortController`, breaking Resource's identity check.**
- This is an actual bug vector in Approach B that isn't analyzed.

### 5.4 `_onQueryStarted` "extraction" is fictional
- Resource tools: `{ $queryFulfilled, getCacheEntry: () => this }`
- Command tools: `{ $queryFulfilled }`
- The approaches claim ~8-10 lines extractable. **But the tools objects have different shapes, different types, and `getCacheEntry` requires `this` context.** The only truly shared part is creating a `PromiseResolver` for `_queryFulfilled` (~3 lines). Claiming 8-10 lines extractable is misleading.

### 5.5 DevTools impact never analyzed
- `ResourceCacheEntry` constructor receives `beforeDevtoolsPush` via `entryOptions`. Command does not.
- `resource-internals.md` notes `_beforeDevtoolsPush` on Resource. No research doc explores what happens to devtools observability under any extraction approach.
- If `FetchableCacheEntry` adds lifecycle fields, DevTools tooling that inspects `CacheEntry` instances won't see them without updates.

### 5.6 LOC inconsistency across documents
- `resource-internals.md`: "~360 lines"  
- `cache-entry-comparison.md`: "~290 lines"  
- `extraction-approaches.md`: "~350 LOC"  
- **Actual**: 296 lines
- This range of 290–360 across documents that should be analyzing the same file suggests copy-paste from different revisions or counting methods (with/without imports, blanks, etc.). The documents don't declare their counting methodology.

## 6. Mermaid Diagram Accuracy

### "Before" diagram (Current State): Mostly accurate ✓
- CacheEntry fields/methods match source.
- ResourceCacheEntry fields list is correct.
- CommandCacheEntry fields match source.
- **Issue**: LOC annotations say "~350 LOC" and "~300 LOC" — wrong per actual counts (296, 249).

### Approach A "After" diagram: Accurate ✓
- Shows protected fields moved to CacheEntry. Structurally sound.

### Approach B "After" diagram: Structurally sound but misleading
- Shows `FetchableCacheEntry<TState, TData>` with protected fields. The diagram is correct.
- **But**: The diagram makes it look clean. It doesn't show that `_fireCacheEntryAdded()` STILL lives in both subclasses, and `_onQueryStarted` STILL lives in both subclasses. The visual impression is of more unification than actually occurs.

### Approach C "After" diagram: Accurate ✓
- Correctly shows composition (diamond arrow) between entries and FetchEngine.
- Honest about what stays in subclasses.

## 7. OSS Comparison Matrix Review

### Accuracy

| Library | Claim | Verdict |
|---------|-------|---------|
| TanStack Query v5 | "Subscribable (~30 lines) + Removable (~35 lines)" | ✓ Accurate for v5 |
| TanStack Query v5 | "No shared observer/state/reducer base" | ✓ Correct — QueryObserver and MutationObserver are independent |
| RTK Query | "Single executeEndpoint payload creator for both thunks" | ✓ Correct |
| RTK Query | "Shared onQueryStarted callback for both queries and mutations" | ✓ Correct and **undermines the "minimal sharing consensus" conclusion** |
| Apollo | "Monolithic QueryManager" | ✓ Correct characterization |
| SWR | "No operation-kind concept" | ✓ Correct for SWR v2 |
| urql | "Operation with kind tag" | ✓ Correct |

### Bias in the "Ecosystem Consensus" conclusion
- The matrix correctly shows RTK Query shares MORE between query/mutation than any other library (shared `onQueryStarted`, shared `onCacheEntryAdded`, single `executeEndpoint`, shared middleware).
- **Yet the conclusion says "Minimal shared base is the consensus" and recommends following TanStack.** RTK Query is the strongest counter-example and it's the library whose lifecycle API (`onQueryStarted`/`onCacheEntryAdded`) rx-toolkit literally copied.
- The recommendation cherry-picks TanStack as the reference while dismissing RTK Query (which is architecturally more relevant to rx-toolkit's lifecycle model).

### Missing from the matrix
- **No version pinning.** TanStack "v5" is noted; others have no version. SWR v2 and v3 differ significantly.
- **No tree-shaking analysis.** The matrix lists what's shared but doesn't analyze bundle impact — one of the key practical reasons for extraction.
- **No mention of react-query's `QueryObserver.fetch()` vs `MutationObserver.mutate()`** — these are the actual execution paths that correspond to Resource's `_doFetch` and Command's `initiate`, and they share essentially nothing. This would strengthen the "don't share fetch" argument.

## 8. Risks Not Identified

1. **Generic param explosion in Approach B.** `FetchableCacheEntry<TState, TData>` requires callers to always specify two type params. When interacting with the base class (e.g., in utility functions or future code), the extra generic creates friction. No other file in the codebase uses dual-generic base classes.

2. **Protected field coupling.** Approaches A and B use `protected` fields. With `strictPropertyInitialization` enabled, subclasses cannot lazy-init protected fields from the base — they must be set in the base constructor. This forces constructor parameter passing patterns that may not align with current `options` bag constructors.

3. **Testing the "shared" code.** If the extracted code lives in `CacheEntry` (A) or `FetchableCacheEntry` (B), testing it requires constructing a concrete subclass. You can't unit-test a `protected _abortInflight()` directly. The FetchEngine (C) is the only approach that allows isolated testing — this advantage is understated in the document.

4. **Migration effort mismatch.** All approaches claim "no public API changes" but don't estimate internal migration effort. Approach B requires modifying constructors of both subclasses, updating all `super()` calls, and potentially restructuring field initialization order. This is non-trivial for ~35 lines of real duplication savings.

5. **Import cycle risk in Approach B.** `FetchableCacheEntry` needs `PromiseResolver` from `@/common` and lives in `@/query/core`. If it also needs any query types, it must import from `@/query/types`, creating a potential cycle or ordering constraint.

## 9. Bottom Line

- **The problem is smaller than presented.** Real duplication is ~35-45 lines, not 78. That's 6-7% of combined file LOC (545 actual), not 13%.
- **All 3 approaches over-engineer the solution.** A 90-LOC class (Approach B) or 75-LOC class (Approach C) to eliminate ~35 lines of duplication is a net negative.
- **The simplest effective solution — utility functions — is not proposed.** Extract `cleanupLifecycleResolvers()` and `createLifecycleTools()` as standalone functions. ~15 LOC, zero structural change, eliminates the clearly duplicated code.
- **If the real goal is extensibility (not DRY), say so explicitly** — and then justify it with a concrete 3rd entity type, not hypotheticals.
- **The OSS matrix is good research but the conclusion is cherry-picked** to favor TanStack's approach while ignoring that RTK Query (the more architecturally similar library) shares more between query/mutation.

## Conclusion
Status: success
Artifacts: .thoughts/2026-04-02-1400_query-core-extraction/tmp/critical-analysis-2.md
Summary:
- Real duplication is ~35-45 lines (not 78), LOC baselines are inflated by 15-20% across documents
- Missing 4th approach: pure utility functions (~15 LOC) with zero structural changes
- OSS matrix conclusion is biased toward TanStack, underweights RTK Query which is more architecturally relevant
Escalation: none
Next step: present corrected duplication numbers and utility-function approach as option for design decisions
