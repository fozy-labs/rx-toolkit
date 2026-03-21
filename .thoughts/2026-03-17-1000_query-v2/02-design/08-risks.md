---
title: "Risk Analysis: Query v2 Module"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
---

# Risk Analysis: Query v2 Module

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R1 | TS2589 recursion limit from plugin type system | M | H | Mitigate | Limit generic depth, prototype with 2+ plugins before full implementation |
| R2 | Machine class `instanceof` breakage after SSR deserialization | H | H | Mitigate | Use `Machine.fromSnapshot()` factory, never deserialize raw JSON as class instances |
| R3 | Hanging patch regression (v1 bug reproduced in v2) | M | H | Mitigate | Three-layer defense: AbortController + machine transition cleanup + CacheEntry eviction |
| R4 | Performance degradation with `compare` key strategy at scale | M | M | Mitigate | Document 50-entry ceiling, default to `serialize`, warn in docs |
| R5 | Signals integration complexity (Effect cleanup, Batcher interaction) | M | H | Mitigate | Integration tests with real signals, verify Batcher atomicity |
| R6 | Scope creep from deferred commands/operations adding unexpected coupling | L | M | Accept | Minimal `IApi` interface, add `createCommand` as backward-compatible extension later |
| R7 | Test complexity / coverage gaps in async + reactive + state machine intersection | H | M | Mitigate | Controllable promises, fake timers, integration tests per data flow diagram |
| R8 | Breaking changes if plugin type system needs revision post-release | L | H | Mitigate | Mark v2 as experimental, keep plugin API surface minimal |
| R9 | Snapshot version mismatch goes undetected in production | L | M | Mitigate | Strict version check at hydration, log warning on mismatch |
| R10 | Immer dependency adds bundle weight and constrains patch API | L | L | Accept | Immer is already used in v1; tree-shakeable import of only needed APIs |
| R11 | `MachineRefreshing` error-to-Success transition confuses consumers | M | M | Mitigate | Clear documentation, Agent `refreshError` field, API docs emphasize semantics |
| R12 | CacheEntry ref-counting / lifetime GC edge cases (orphan entries, rapid sub/unsub) | M | M | Mitigate | Dedicated unit tests for subscribe/unsubscribe/timer interactions |

---

## Detailed Mitigation Plans

### R1: TS2589 Recursion Limit from Plugin Type System

**Context**: ADR-1 selects generic type accumulation (tRPC-style) for plugin typing. `PluginAugmentations` uses `UnionToIntersection<ExtractContributions<TPlugins[number], ...>>` which risks TS2589 at depth >2-3 plugins with deeply nested generics. [ref: ../01-research/04-open-questions.md#Q1, ../01-research/03-external-research.md#4]

**Mitigation steps**:
1. Before implementing the full ResourceV2, create a standalone type prototype file (`src/query-v2/__tests__/plugin-types.typetest.ts`) with `createApi` + 2 mock plugins + `createResource` — verify it compiles without TS2589 on the project's TypeScript version.
2. Keep `ExtractPluginContributions` one level deep — each plugin contributes a flat interface (no nested generics in contribution types). Enforce via code review.
3. Use `Prettify<T>` wrapper on the final intersection to flatten for IntelliSense and reduce type instantiation depth.
4. If TS2589 occurs with 3+ plugins in the future, fallback strategy: switch to declaration merging for that specific plugin (Option A from ADR-1) while keeping generic accumulation for the primary path.

**Verification**: TypeScript compilation test in CI (`vitest` type test or `tsc --noEmit`). Tested with `ReactHooksPlugin` + one mock plugin.

---

### R2: Machine `instanceof` Breakage After SSR Deserialization

**Context**: `JSON.stringify(snapshot)` on the server → `JSON.parse(snapshot)` on the client produces plain objects. Any code using `instanceof MachineSuccess` on deserialized data will return `false`. [ref: ../01-research/03-external-research.md#6, ../01-research/04-open-questions.md#Q2]

**Mitigation steps**:
1. **Never store or transmit class instances in snapshots** — `TApiSnapshot` contains only plain `.state` objects (with `status` discriminator). This is enforced by the `TResourceV2SnapshotSlice` type which has no class properties.
2. **Single reconstruction entry point**: `Machine.fromSnapshot(state)` uses a `switch (state.status)` to call the appropriate static factory (`MachineSuccess.create(state.data, state.args)`). All hydration passes through this factory — no direct `new MachineSuccess()` from snapshot data.
3. **Test**: SSR round-trip test verifies `instanceof MachineSuccess === true` on the rehydrated machine and verifies all methods (`invalidate()`, `createPatch()`, etc.) work correctly.
4. **Documentation**: SSR guide explicitly warns against manual `JSON.parse` → cast patterns. Always use `createApi({ initialSnapshot })`.

**Verification**: Integration test S7 (snapshot round-trip) and S8 (`Machine.fromSnapshot` class check).

---

### R3: Hanging Patch Regression

**Context**: v1 has a known bug where a pending patch that is never committed or aborted blocks `originalData` cleanup indefinitely. The RFC explicitly calls this out as a problem to fix. [ref: ../01-research/01-codebase-query-v1.md#2.3, ../01-research/04-open-questions.md#Q12, ./04-decisions.md#ADR-4]

**Mitigation steps**:
1. **Layer 1 — AbortController binding**: When `onQueryStarted` creates a patch, the patch handle is linked to the request's AbortSignal. If the request aborts (new query, component unmount), the patch auto-aborts. This covers the primary "forgot to finish" scenario.
2. **Layer 2 — Machine transition cleanup**: `MachineWithData.abortAllPendingPatches()` is called on `start(newArgs)`, `reset()`, and `MachineRefreshing.successHappened()`. This covers state-change-driven orphaning.
3. **Layer 3 — CacheEntry eviction**: When a CacheEntry is cleaned up (GC after cacheLifetime), all remaining patches are aborted. This is the final safety net.
4. **Dedicated test cases**: E9 (auto-abort on reset), E10 (auto-abort on eviction), E11 (auto-abort on refresh success), P12 (abortAllPendingPatches). These tests explicitly create "orphan" patches and verify they do not hang.

**Verification**: All four test cases (E9, E10, E11, P12) pass. Additionally, `afterEach` in test setup can verify no pending patches remain (analogous to the existing Batcher lock check in `@/__tests__/setup.ts`).

---

### R5: Signals Integration Complexity

**Context**: query-v2 builds on `Signal.state`, `Signal.compute`, `Effect`, and `Batcher` from `src/signals/`. Incorrect interaction — particularly around `Batcher.run()` atomicity, `Effect` cleanup on unsubscribe, and signal dependency tracking in `query$()` — can produce glitches, stale reads, or memory leaks. [ref: ../01-research/02-codebase-signals-common.md#1-6]

**Mitigation steps**:
1. **Integration tests use real signals** — no mocking of Signal.state, Compute, Batcher. Tests verify that `state$` on the Agent re-evaluates when the underlying CacheEntry's machine signal changes (test A1, A2), and that `Batcher.run()` groups multiple signal updates atomically (test E12).
2. **`query$()` dependency tracking test** (E8): verify that calling `resource.query$(args)` inside a `Signal.compute` registers a dependency and triggers re-computation when the machine transitions.
3. **Effect cleanup test**: When an Agent is destroyed (component unmount / `stop()`), verify the Signal.effect subscription is cleaned up and no leak occurs. Use the existing `afterEach` Batcher lock check from test setup.
4. **Batcher deadlock prevention**: If a Machine transition fires a lifecycle hook that triggers another transition, ensure `Batcher.run()` does not deadlock. Test with nested transitions.

**Verification**: Integration tests in `query-flow.test.ts` exercise the full signal chain. Memory leak detection via subscription count assertions (subscribe → action → unsubscribe → verify count returns to 0).

---

### R7: Test Complexity / Coverage Gaps

**Context**: query-v2 is the intersection of three complex domains: async operations (Promises, AbortController), reactive signals (Signal.state, Computed, Effect, Batcher), and state machines (5 machine classes with ~12 transitions). The combinatorial space is large, and test design must prioritize high-value paths. [ref: ./01-architecture.md#5, ./02-dataflow.md]

**Mitigation steps**:
1. **Controllable promise pattern**: Every test that involves `queryFn` uses the controllable promise factory from the existing test suite (see `@/query/react/useResourceAgent.test.ts`). This allows deterministic control over resolve/reject timing without timeouts.
2. **Fake timers for all time-dependent behavior**: `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`. Covers `cacheLifetime`, `maxSnapshotDataAge`, and any debouncing.
3. **Test case prioritization by data flow diagrams**: Each sequence diagram in [02-dataflow.md](./02-dataflow.md) maps to at least one integration test. This ensures coverage of the documented flows rather than ad-hoc combinations.
4. **Separate unit vs. integration boundaries**: Machine and Patcher unit tests do NOT use signals (pure class tests). Integration tests do NOT mock signals. This avoids "mocking the system under test" anti-pattern.
5. **Type-level tests**: `vitest` `expectTypeOf` for plugin augmentations and machine transition types. These catch regressions in the type system without runtime tests.

**Verification**: Coverage thresholds (85%+ statements/branches/lines, 90% functions) enforced in CI via vitest config.

---

### R8: Breaking Changes if Plugin Type System Needs Revision

**Context**: The plugin type system (ADR-1) is the most novel and least-proven part of the design. If the `ExtractPluginContributions` pattern proves inadequate (e.g., for a plugin that needs access to other plugins' contributions), the type API may need redesign, affecting all consumers. [ref: ./04-decisions.md#ADR-1]

**Mitigation steps**:
1. **Mark the entire query-v2 module as experimental** — exposed under a clear experimental namespace/path. Consumers expect potential breaking changes.
2. **Minimize the plugin type API surface**: Only `IPlugin`, `IPluginContext`, and `IReactHooksPluginContributions` are public. The internal `PluginAugmentations`, `ExtractPluginContributions`, `UnionToIntersection` types are NOT exported — giving freedom to change internals.
3. **Ship only `ReactHooksPlugin` in v2 MVP** — one plugin is too few to reveal composition problems. But the type test with 2 mock plugins (R1 mitigation) validates the pattern for future extension.
4. **Versioning strategy**: If a type-breaking change is needed, increment the experimental version marker and provide a migration guide. Internal-only type changes (non-exported) are non-breaking.

**Verification**: Type test with 2 plugins compiles cleanly. `ReactHooksPlugin` augmentation works correctly at both type and runtime level.
