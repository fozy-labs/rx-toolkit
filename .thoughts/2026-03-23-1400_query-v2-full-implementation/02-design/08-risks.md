---
title: "Risk Analysis — query-v2"
date: 2026-03-23
stage: 02-design
role: rdpi-qa-designer
---

# Risk Analysis — query-v2

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R01 | State machine transition produces invalid/unexpected state | Medium | High | Mitigate | Exhaustive unit tests per transition; immutability assertions; type-level enforcement |
| R02 | Async race conditions in ResourceV2 query orchestration | High | High | Mitigate | Controllable-promise tests; explicit abort-signal verification; inflight dedup map isolation |
| R03 | Memory leaks from signal subscriptions not cleaned up | Medium | High | Mitigate | Refcount tracking; unmount cleanup verification; FinalizationRegistry checks |
| R04 | Snapshot data inconsistency with concurrent cache updates | Low | High | Mitigate | Snapshot captures via `peek()` (non-reactive, point-in-time); round-trip tests |
| R05 | Immer `applyPatches` throws on out-of-order abort (consistency violation) | Medium | High | Mitigate | try/catch in Patcher; `isConsistencyViolation` flag; auto-invalidation chain |
| R06 | Plugin error in `install`/`augmentResource` crashes entire cache creation | Low | Medium | Mitigate | Let errors propagate (fail-fast); document plugin contract; test error paths |
| R07 | Signals system compatibility — v2 depends on `Signal.state`, `Signal.compute`, `Batcher`, `DependencyTracker` internals | Low | High | Accept | Signals module is in-house, stable, well-tested; pin integration tests against known signal behavior |
| R08 | React 18/19 concurrent mode tearing via `useSyncExternalStore` | Low | High | Mitigate | Use `useSyncExternalStore` correctly (existing pattern from signals/react); component-level tearing test |
| R09 | `useSyncExternalStore` getSnapshot identity instability causing infinite re-renders | Medium | High | Mitigate | Agent state derivation must return referentially-stable objects when data unchanged; shallow-equal memoization in compute |
| R10 | Complexity explosion — too many interacting components to implement correctly at once | High | Medium | Mitigate | Layered implementation: lib → core → api → react; each layer tested before next starts |
| R11 | Scope creep beyond ResourceV2 | Medium | Medium | Avoid | Stay within ResourceV2 scope; additional entity types are out of scope for this iteration; design api/plugin interfaces to accommodate future entity types; document as constraint |
| R12 | v0.1 doc ambiguities requiring interpretation | High | Medium | Mitigate | Each ambiguity resolved via ADRs in 04-decisions.md; implementation follows ADRs, not ambiguous doc text |
| R13 | Test flakiness from async timing / microtask ordering | High | Medium | Mitigate | Controllable-promise pattern eliminates timing; `flushMicrotasks()` for deterministic async; fake timers only for GC tests |
| R14 | Coverage gaps in edge cases (abort during refresh, double-commit, etc.) | Medium | Medium | Mitigate | Dedicated edge-case test table (E01–E10); P1/P2 priority ensures they're written |
| R15 | Regression from v1 behavior differences | Medium | Medium | Mitigate | Document intentional v1→v2 differences; do not run v1 tests against v2; migration guide covers breaking changes |
| R16 | Unnecessary re-renders from signal → React bridge | Medium | Medium | Mitigate | Agent `state$` uses `distinctUntilChanged` internally; shallow-equal on derived state; integration test with render count |
| R17 | Cache memory growth — entries not GC'd due to refcount bugs | Medium | High | Mitigate | GC integration tests with fake timers; verify entry count after lifecycle; refcount = 0 assertion on unmount |
| R18 | GC timer pressure — many concurrent timers for large cache | Low | Low | Accept | Standard `setTimeout`; JS engines handle thousands of timers; consider consolidation only if production profiling shows issue |
| R19 | SWR previous/current swap defeats purpose (current v2 bug re-introduced) | Medium | High | Mitigate | Dedicated SWR test cases (AG03, AG04, AG10, AG11); regression test from known bug pattern |
| R20 | `Batcher.run()` exception leaves batch lock in dirty state | Low | High | Mitigate | Batcher uses try/finally (existing fix noted in setup.ts); verify in integration test |
| R21 | CacheEntry.complete() called multiple times causes double-cleanup | Low | Low | Mitigate | Idempotent `complete()` (CE08 test); `_isCompleted` flag prevents re-entry |
| R22 | Type system regression — `TError` removal causes downstream type errors | Low | Medium | Mitigate | TypeScript strict mode compilation as CI gate; all public types exported and consumed in test files |

---

## Detailed Mitigation Plans

### R01: State Machine Transition Produces Invalid State

**Risk**: An immutable machine class method returns a machine with incorrect status, data, or metadata — violating the state machine contract. This propagates through CacheEntry → Agent → React, showing wrong UI state.

**Mitigation steps**:
1. **Exhaustive transition matrix**: Test cases SM01–SM36 cover every valid transition for all 5 machine classes. Each asserts:
   - `instanceof` check on returned machine
   - `.status` matches expected value
   - `.data`, `.error`, `.args`, `.updatedAt` match expected values
   - Original machine instance not mutated (immutability check)
2. **Type-level enforcement**: Transitions return specific types (e.g., `MachineIdle.start()` returns `MachinePending`, not `TMachineInstance`). Invalid transitions are compile errors.
3. **fromSnapshot round-trip**: SM30 verifies `instance → .state → fromSnapshot() → equivalent instance` for all states.

**Verification**: All SM tests pass; TypeScript compilation succeeds with `strict: true`; no `as unknown as` casts in machine code.

---

### R02: Async Race Conditions in ResourceV2 Query Orchestration

**Risk**: Concurrent `query()` calls, rapid arg changes, and abort/re-query sequences can leave the inflight map, cache entries, or GC timers in inconsistent states. This is the highest-probability high-impact risk.

**Mitigation steps**:
1. **Controllable promises**: Every async test uses externally resolvable promises — no real timers, no `setTimeout`. Tests control exactly when each queryFn resolves/rejects. [ref: ../01-research/02-codebase-query-v1.md#6.3]
2. **Inflight dedup verification**: RE02 tests that two concurrent `query()` calls for same args produce one `queryFn` call. RE03 tests force=true bypasses dedup.
3. **Abort signal verification**: RE11, INT12, E08 verify abort signals are fired on args change, and that aborted queryFn responses are ignored (no state transition).
4. **Rapid arg change tests**: AG10, AG11 verify only the latest args are tracked, no previous accumulation.
5. **Reset-during-inflight**: E06 verifies `resetCache()` during inflight properly aborts and clears without error propagation.
6. **`flushMicrotasks()`**: After every `resolve()`/`reject()`, `await flushMicrotasks()` ensures deterministic promise chain resolution.

**Verification**: All RE, AG, and E race-condition tests pass deterministically across 100 repeated runs.

---

### R03: Memory Leaks from Signal Subscriptions

**Risk**: `CacheEntry` wraps `Signal.state`; `ResourceV2Agent` creates `Signal.compute`. If these aren't cleaned up on component unmount or GC, subscriptions accumulate → memory grows indefinitely.

**Mitigation steps**:
1. **React unmount tests**: RH04 verifies that `useResourceV2Agent` cleanup runs on unmount — agent destroyed, signal unsubscribed, refcount decremented.
2. **GC lifecycle tests**: GC01–GC05 verify entries are cleaned up when refcount=0 and timer expires. CE05 verifies `complete()` fires `onClean$` and resets state.
3. **Signal subscriber count**: After each integration test, assert that the resource's cache map is empty or that entries have zero subscribers.
4. **No-op after complete**: CE06 verifies that `set()` after `complete()` is a no-op — prevents zombie signal updates.

**Verification**: Integration tests include teardown assertions checking `cache.size === 0` or expected entry count.

---

### R05: Immer applyPatches Throws on Out-of-Order Abort

**Risk**: When multiple optimistic patches exist and one is aborted out of order, `applyPatches(data, inversePatches)` can throw because the inverse patches reference array indices or object paths that no longer exist. Without catch, this crashes the application.

**Mitigation steps**:
1. **Patcher wraps `applyPatches` in try/catch**: Returns `{ isConsistencyViolation: true }` instead of throwing. [ref: ./04-decisions.md#ADR-6]
2. **PA10, PA11**: Dedicated test cases for out-of-order abort and `applyPatches` internal throw — verify flag is set, no unhandled exception.
3. **INT09**: Integration test verifying the full chain: multi-patch → out-of-order abort → consistency violation detected → resource auto-invalidates → fresh data arrives.
4. **ResourceV2 checks the flag**: After every `finishPatch`/`abortAllPending` call, ResourceV2 checks `isConsistencyViolation` and calls `invalidate(args)`.

**Verification**: PA10, PA11, INT09 all pass. Manual test: create 3 patches, commit middle, abort first → verify auto-invalidation fires.

---

### R08: React Concurrent Mode Tearing

**Risk**: In React 18/19 concurrent mode, external stores can "tear" — two components reading the same signal during a single render tree can see different values.

**Mitigation steps**:
1. **`useSyncExternalStore`**: The `useSignal` hook (from `signals/react`) already uses `useSyncExternalStore`, which is React's official solution for tearing prevention. [ref: ../01-research/03-external-research.md#6.3]
2. **RH08**: Component test that simulates concurrent updates — verify both components see consistent state.
3. **Batcher integration**: `Batcher.run()` batches all signal updates atomically, reducing the window for mid-render inconsistency.

**Verification**: RH08 passes; no tearing observed in concurrent StrictMode rendering.

---

### R09: useSyncExternalStore getSnapshot Identity Instability

**Risk**: If `agent.state$()` returns a new object reference on every call (even with same data), `useSyncExternalStore` triggers infinite re-renders. This is subtle and manifests as performance degradation or React errors.

**Mitigation steps**:
1. **Agent `state$` is a `Signal.compute`**: Computed signals use `distinctUntilChanged` internally — same input data → same output reference.
2. **Shallow-equal memoization**: The agent's computed function should check if the derived flat state object is shallow-equal to the previous one before creating a new object reference.
3. **Render count test**: Integration test (within RH05) that re-renders with same args and asserts render count does not increase beyond expected.
4. **Signal.compute caching**: `ComputeCache` memoizes computed values when dependencies haven't changed.

**Verification**: RH05 verifies same-args rerender causes no additional fetch and at most 1 re-render (from initial mount).

---

### R10: Complexity Explosion

**Risk**: The module has ~15 core classes/abstractions with dense interdependencies. Implementing everything simultaneously risks compounding bugs that are hard to diagnose.

**Mitigation steps**:
1. **Layered implementation order**: lib/ (pure, zero deps) → core/machines (no cache deps) → core/CacheEntry+CacheMap → core/Resource (orchestrator) → core/Agent → api/ (factory) → react/ (hooks). Each layer tested before next starts, per test pyramid.
2. **Test-driven development**: Write SM tests, run green, then CE tests, run green, etc. Catching regressions immediately.
3. **ADR-1 layering enforcement**: No upward or lateral imports. Verifiable via lint rule or import analysis.
4. **Incremental PRs**: If working in branches, one PR per layer keeps reviews manageable.

**Verification**: Each layer's test suite passes independently. Full integration suite passes after all layers are complete.

---

### R13: Test Flakiness from Async Timing

**Risk**: Tests that depend on microtask ordering, timer-based GC, or signal propagation timing can flake in CI (different event loop behavior).

**Mitigation steps**:
1. **Controllable promises**: All queryFn-based tests use externally resolvable promises. No `setTimeout` in queryFn. No real network. [ref: ../01-research/04-open-questions.md#q15]
2. **`flushMicrotasks()`**: Explicit microtask flush after every `resolve()`/`reject()`. No implicit "wait for things to settle".
3. **Fake timers only for GC**: `vi.useFakeTimers()` scoped to GC describe blocks only. `vi.advanceTimersByTime(cacheLifetime)` for deterministic timer testing.
4. **No `setTimeout` in non-GC tests**: `cacheLifetime: false` eliminates timer interference.
5. **No `waitFor` polling**: Prefer explicit `flushMicrotasks()` over `waitFor(() => expect(...))` which introduces timing sensitivity.

**Verification**: Full test suite passes 100/100 repeated runs in CI. No `retry` annotations needed.

---

### R17: Cache Memory Growth

**Risk**: If GC refcount tracking has a bug (e.g., increment without decrement on error paths), entries accumulate indefinitely. Users with long-running SPAs see growing memory.

**Mitigation steps**:
1. **GC integration tests**: INT05/INT06 test component mount→data→unmount→timer lifecycle. Verify entry exists during mount, deleted after lifetime.
2. **Refcount symmetry**: Every `lockEntry()` returns an `unlock()` function — tests verify calling unlock decrements count.
3. **Agent lifecycle**: Agent creation increments refcount, agent destruction (unmount) decrements. RH04 tests this.
4. **resetCache kills all**: RE14, INT10 verify reset aborts everything and clears the map to size 0.
5. **Stress test (optional P3)**: Create 1000 resources, query each, unmount all, advance timers — verify all entries GC'd.

**Verification**: INT05, INT06, RE14, RCE15, GC04 pass. Cache map size is 0 after all agents unmounted and timers advanced.

---

### R19: SWR Previous/Current Swap Bug Re-introduction

**Risk**: The existing v2 code has a known bug: `previous` is cleared immediately after setting, defeating SWR. This exact bug must not be re-introduced in the rewrite.

**Mitigation steps**:
1. **ADR-3 defines correct behavior**: Keep previous entry until current resolves (success or error). [ref: ./04-decisions.md#ADR-3]
2. **Dedicated SWR tests**: AG03 (previous data shown during loading), AG04 (previous cleared on resolve), AG10 (rapid changes), AG11 (chain protection).
3. **Integration SWR test**: INT02 verifies full pipeline: React hook → args change → SWR data visible → new data after resolve.
4. **Regression guard**: Test comment explicitly references the known bug pattern in current v2 agent code.

**Verification**: AG03, AG04, RH03, INT02 all pass. Manual verification: args change shows stale data while loading.

---

### R20: Batcher.run() Exception Leaves Batch Lock Dirty

**Risk**: If code inside `Batcher.run()` throws, the batch lock might not be released, blocking all subsequent signal updates. This would freeze the entire reactive system.

**Mitigation steps**:
1. **Batcher uses try/finally**: Existing fix noted in `@/__tests__/setup.ts` comments. The `finally` block releases the batch lock.
2. **E01 test**: queryFn that throws synchronously — verify state transitions still work after the error.
3. **afterEach guard**: Global test teardown (in setup.ts) verifies batch lock is not held.

**Verification**: E01 passes; afterEach in setup.ts doesn't flag batch lock issues.
