---
title: "Architecture Decision Records — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
---

# Architecture Decision Records

## ADR-1: React Hooks Dual-Path (Standalone + Plugin)

### Status
Proposed

### Context
React hooks (`useResourceV2Agent`, `useResourceV2Ref`) are currently only accessible as methods on plugin-augmented resources. Users must register `ReactHooksPlugin` in `createApi({ plugins: [...] })` to use hooks. Without the plugin, calling `resource.useResourceV2Agent()` is `undefined` at runtime.

The user requires BOTH paths to work:
1. Standalone import: `useResourceV2Agent(resource, args)` — no plugin needed
2. Plugin method: `resource.useResourceV2Agent(args)` — via `ReactHooksPlugin` as currently

[ref: ../01-research/01-codebase-analysis.md#1-react-hooks--plugin-dependency] — hooks already receive `resource` as a closure argument from `augmentResource`; refactoring to explicit parameter is straightforward.
[ref: ../01-research/02-open-questions.md#q1] — User decision: support both paths, keep plugin system.

### Options Considered

1. **Standalone only** — Remove plugin hook attachment, export hooks from `react/` only.
   - Pros: Simple, no magic, tree-shakeable, mirrors v1 pattern
   - Cons: Breaking change for `resource.useResourceV2Agent()` consumers. Plugin system becomes orphaned.

2. **Plugin only (status quo)** — Keep hooks inside plugin, no standalone export.
   - Pros: No change needed
   - Cons: Violates fix #1 requirement. Hooks require plugin infrastructure.

3. **Both — standalone functions in `react/` with plugin as thin wrapper** — Hooks live in `react/` as standalone exports. `ReactHooksPlugin.augmentResource` delegates to them.
   - Pros: Backward compatible. Clean standalone path. Plugin becomes thin delegation. No React dependency without import.
   - Cons: Two ways to do the same thing. Marginally more surface area.

### Decision
Option 3. Standalone hook functions in `react/` directory. `ReactHooksPlugin.augmentResource` becomes a thin wrapper that imports and delegates to the standalone hooks.

Signatures:
```typescript
// react/useResourceV2Agent.ts
export function useResourceV2Agent<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs | SKIP_TOKEN,
): IResourceV2AgentState<TArgs, TData, TError>;

// react/useResourceV2Ref.ts
export function useResourceV2Ref<TArgs, TData, TError>(
    resource: ResourceV2<TArgs, TData, TError>,
    args: TArgs | SKIP_TOKEN,
): IResourceV2Ref<TArgs, TData, TError>;
```

Plugin wrapper:
```typescript
// plugins/ReactHooksPlugin.ts
augmentResource(res, _options) {
    return {
        useResourceV2Agent: (args) => useResourceV2Agent(res, args),
        useResourceV2Ref: (args) => useResourceV2Ref(res, args),
    };
}
```

### Consequences
- **Positive**: Users can use hooks without plugin registration. Plugin path remains fully backward-compatible. React dependency is only pulled when `react/` is imported.
- **Positive**: Aligns with v1 pattern (`useResourceAgent(resource, args)`).
- **Negative**: Two equivalent call paths may confuse users. Documentation must clearly explain both.
- **Risk**: Helper functions (`compareArgs`, `createRefHandle`, `createSkippedRef`) must move to `react/` as well — they are private implementation details of the hooks.

---

## ADR-2: Core Internal Split Strategy

### Status
Proposed

### Context
The `core/` directory has a flat structure. `machines/` is already a sub-folder, but `CacheEntry.ts`, `CacheMap.ts`, `LifecycleHooks.ts`, `ResourceV2.ts`, `ResourceV2Agent.ts` all sit at the root level. Fix #3 requires explicit separation into `common/`, `machines/`, `resource/`.

[ref: ../01-research/01-codebase-analysis.md#3-core-module-organization] — File-to-category mapping shows clear boundaries.
[ref: ../01-research/02-open-questions.md#q3] — User decision: internal-only restructure, no public API change.
[ref: ../01-research/02-open-questions.md#q9] — User decision: only barrel imports are public, deep imports not supported.

### Options Considered

1. **Internal restructure with barrel re-export** — Move files into sub-folders. `core/index.ts` re-exports from `./common`, `./machines`, `./resource`. Zero public API change.
   - Pros: Clean internal organization. No consumer breakage. Files can be moved freely since deep imports are unsupported.
   - Cons: Split is invisible to consumers.

2. **Expose sub-path imports** — Allow `@/query-v2/core/common`, `@/query-v2/core/resource` as public entry points.
   - Pros: Finer-grained imports.
   - Cons: Larger public API surface. More paths to maintain. Premature for an experimental module.

### Decision
Option 1. Internal restructure with updated `core/index.ts` barrel:

```typescript
// core/index.ts
export * from "./common";
export * from "./machines";
export * from "./resource";
```

Each sub-folder gets its own `index.ts`:
- `common/index.ts`: exports `CacheEntry`, `CacheEntryOptions`, `CacheMap`, `TCacheMapInstance`, `LifecycleHooks`
- `resource/index.ts`: exports `ResourceV2`, `ResourceV2Config`, `ResourceV2Agent`
- `machines/index.ts`: unchanged

### Consequences
- **Positive**: Clear responsibility zones. Easier navigation. Prepares for future extraction if needed.
- **Positive**: Zero breaking change — `@/query-v2/core` barrel is the only public contract.
- **Negative**: Internal cross-imports between sub-folders need updating (e.g., `ResourceV2` imports `CacheEntry` — path changes from `./CacheEntry` to `../common/CacheEntry`).
- **Risk**: Minimal — compiler will catch any broken internal imports immediately.

---

## ADR-3: DevTools Agent State Filtering

### Status
Proposed

### Context
`ResourceV2Agent` creates three signals:
- `_tracking$` = `Signal.state(...)` — no options
- `_refreshError$` = `Signal.state(...)` — no options
- `_state$` = `Signal.compute(...)` — no options

The signal system's `Devtools.createState` and `Devtools.createSignalHooks` register ANY signal with devtools unless `isDisabled: true` is passed. Since agent signals have no options, they register with auto-generated keys like `State/#i=N` and `Computed/#i=N`, creating noise in Redux DevTools.

[ref: ../01-research/02-open-questions.md#q5] — User corrected the research: agent state DOES leak to devtools.
[ref: ../01-research/02-open-questions.md#q10] — User decision: no change to devtools opt-out mechanism.

### Options Considered

1. **Pass `isDisabled: true` to agent signal constructors** — Use the existing `SignalOptions.isDisabled` flag.
   - Pros: Minimal change (3 lines). Uses established mechanism. No new infrastructure.
   - Cons: Must remember to set `isDisabled` on any future agent signals.

2. **Create agent signals without devtools via a new `Signal.internal()` factory** — Add a `Signal.internal()` method that auto-disables devtools.
   - Pros: Semantic intent is clear. Prevents future mistakes.
   - Cons: Changes signals module for a query-v2 concern. Over-engineering for 3 call sites.

3. **Filter at devtools level** — Add a pattern-based filter in `Devtools.createState` to ignore certain key patterns.
   - Pros: Centralized filtering.
   - Cons: Fragile pattern matching. Doesn't solve the root cause. Scope creep.

### Decision
Option 1. Pass `{ isDisabled: true }` to all three signal constructors in `ResourceV2Agent`:

```typescript
this._tracking$ = Signal.state<AgentTracking<TData, TError>>(
    { previous: null, current: null },
    { isDisabled: true },
);

this._refreshError$ = Signal.state<TError | null>(null, { isDisabled: true });

this._state$ = Signal.compute<IResourceV2AgentState<TArgs, TData, TError>>(
    () => { /* ... */ },
    { isDisabled: true },
);
```

An inline comment explains why: agent signals are internal derived state for React hook consumption; only `CacheEntry` signals represent canonical cache state that belongs in devtools.

### Consequences
- **Positive**: Removes 3 noise entries per agent from Redux DevTools. Devtools now only shows meaningful `CacheEntry` state transitions.
- **Positive**: Zero infrastructure changes. Uses existing mechanism.
- **Negative**: Debugging agent-level issues requires `console.log` or breakpoints instead of devtools inspection. This is acceptable because agent state is a computed projection of `CacheEntry` state, which IS visible in devtools.
- **Risk**: If future agent signals are added without `isDisabled`, they will leak. An inline comment on the class serves as a reminder.

---

## ADR-4: Snapshot Hydration Error Semantics

### Status
Proposed

### Context
`hydrateSnapshot` currently handles three mismatch scenarios silently:
1. Version mismatch → `return` (entire snapshot skipped)
2. Key prefix mismatch → `return` (entire snapshot skipped)
3. Unknown resource key → `continue` (single resource skipped)

Additionally, `Machine.fromSnapshot` throws on corrupt status, which propagates uncaught. Fix #5 requires explicit error handling instead of silent failures.

[ref: ../01-research/01-codebase-analysis.md#5-snapshot-loading-error-handling] — Three silent skip scenarios documented.
[ref: ../01-research/02-open-questions.md#q4] — User decision: throw on version/prefix mismatch, warn on others.

### Options Considered

1. **Throw on all mismatches** — Version, prefix, and unknown resource all throw.
   - Pros: Strictest. Nothing silently ignored.
   - Cons: Unknown resource is expected when a resource is removed between versions. Throwing would crash apps during normal evolution.

2. **Throw on version/prefix, warn on unknown resource** — Critical structural mismatches throw. Non-fatal mismatches warn.
   - Pros: Catches real bugs (wrong snapshot/wrong API). Tolerates expected evolution (resource removal).
   - Cons: Warnings may be missed.

3. **Return result object** — `hydrateSnapshot` returns `{ hydrated, skipped, errors }`. Callers decide.
   - Pros: Maximum flexibility.
   - Cons: Breaking API change (void → object). Forces all callers to handle results.

4. **Only throw on structural corruption** — Malformed data throws. Mismatches warn.
   - Pros: Safest.
   - Cons: Version/prefix mismatch is arguably a bug in deployment, not just soft mismatch.

### Decision
Option 2. Throw on version and key prefix mismatch. Warn on unknown resource key.

```typescript
export function hydrateSnapshot(snapshot, resources, apiKeyPrefix, maxSnapshotDataAge) {
    if (snapshot.version !== CURRENT_SNAPSHOT_VERSION) {
        throw new Error(
            `Snapshot version mismatch: expected ${CURRENT_SNAPSHOT_VERSION}, got ${snapshot.version}. ` +
            `The snapshot format is incompatible with the current version of query-v2.`
        );
    }

    if (snapshot.keyPrefix !== apiKeyPrefix) {
        throw new Error(
            `Snapshot keyPrefix mismatch: expected "${apiKeyPrefix}", got "${snapshot.keyPrefix}". ` +
            `Ensure the snapshot was created by the same API instance configuration.`
        );
    }

    for (const [resourceKey, resourceSnapshot] of Object.entries(snapshot.resources)) {
        const resource = resources.get(resourceKey);
        if (!resource) {
            console.warn(`[rx-toolkit] hydrateSnapshot: unknown resource key "${resourceKey}", skipping.`);
            continue;
        }
        // ... per-entry hydration
    }
}
```

Note: `Machine.fromSnapshot` already throws on corrupt status — this behavior is unchanged and the error will propagate to the caller. The `createApi` call site should be aware that `hydrateSnapshot` may now throw during `createResource`.

### Consequences
- **Positive**: Version/prefix mismatches are caught immediately with clear error messages. No more silent data loss where hydration silently does nothing.
- **Positive**: Unknown resource keys produce discoverable warnings for debugging without crashing.
- **Negative**: `createApi` with `initialSnapshot` that has a version mismatch now throws during `createResource`. Consumers need to either:
  - Ensure snapshot compatibility (typical SSR setup)
  - Wrap `createResource` in try/catch if snapshot may be stale (unlikely but possible)
- **Risk**: In SSR scenarios where the server generates a snapshot with version N and the client runs version N+1, `createResource` will throw. This is the correct behavior — it signals an incompatible deployment that should be fixed. The `initialSnapshot` should always be re-generated on the server with the same code version.

---

## ADR-5: JSDoc Scope and Style

### Status
Proposed

### Context
Types directory has ~100% JSDoc coverage. Implementation files are sparsely documented:
- `createApi()`: no JSDoc
- `ResourceV2`: 7 of 18 methods undocumented (including the most critical: `createAgent`, `query`, `query$`, `entry`)
- `CacheEntry`, `ResourceV2Agent`: no class-level or method JSDoc
- Machine classes: zero JSDoc
- Standalone hooks (new): will need JSDoc

[ref: ../01-research/01-codebase-analysis.md#6-jsdoc-coverage] — Complete inventory.
[ref: ../01-research/02-open-questions.md#q6] — User decision: public API + inline comments at magic locations.
[ref: ../01-research/02-open-questions.md#q11] — User decision: self-contained JSDoc with `@see` links for complex concepts.

### Options Considered

1. **Public API only** — `createApi`, exported functions, consumer-facing types.
   - Pros: Minimal effort, highest impact.
   - Cons: Core classes remain undocumented for contributors.

2. **Public API + class-level + critical methods** — Every exported class gets class-level JSDoc. All public/protected methods on `ResourceV2`, `CacheEntry`, `ResourceV2Agent` get JSDoc. Machine classes get class-level only.
   - Pros: Balanced coverage. Serves both consumers and contributors.
   - Cons: Moderate effort. Must maintain JSDoc accuracy.

3. **Everything** — Every function/method/class gets JSDoc.
   - Pros: Complete.
   - Cons: Noise on obvious helpers. Maintenance burden.

### Decision
Public API JSDoc + inline comments at "magic" locations (aligned with option 1 + targeted option 2 elements).

**JSDoc targets:**
- `createApi()` — parameters, return type, usage example
- `ResourceV2` class-level + undocumented public methods: `createAgent`, `query`, `query$`, `entry`, `resetCache`
- `ResourceV2Agent` class-level + `state$`, `start`
- `CacheEntry` class-level + `machine$`, `peek`, `set`, `complete`
- `ReactHooksPlugin` class-level
- `useResourceV2Agent` function — parameters, return, `@see` link to docs
- `useResourceV2Ref` function — parameters, return, `@see` link to docs

**Inline comments (not JSDoc):**
- `CacheEntry` `beforeDevtoolsPush` callback: explains intentional type mismatch
- `ResourceV2Agent` signal constructors: explains `isDisabled: true` for devtools
- `hydrateSnapshot` error logic: documents error semantics
- `ReactHooksPlugin` declaration merging: explains type-level wiring

**Style:**
- Self-contained descriptions. No external links except `@see` for complex concepts.
- `@see docs/query-v2/ssr.md` on snapshot-related functions
- `@see docs/query-v2/optimistic-updates.md` on patch-related methods

### Consequences
- **Positive**: Critical API surface is documented. Magic locations have explanatory comments. New contributors can understand the codebase without reading source of every dependency.
- **Positive**: `@see` links connect code to comprehensive docs without duplicating content.
- **Negative**: Machine classes remain without JSDoc (they are internal, well-typed, and self-documenting via status literals and type narrowing). This is acceptable given they are not part of the public API surface.
- **Risk**: JSDoc can drift from implementation. Keeping JSDoc scoped to public API reduces this risk.
