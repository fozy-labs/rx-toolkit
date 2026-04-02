---
title: "Batcher Utility — Codebase Analysis"
date: 2026-04-02
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

`Batcher` is a transaction-like batching primitive defined in the signals layer (`@/signals/base/Batcher.ts`). It defers scheduled side-effects (Effect re-runs) until the outermost `Batcher.run()` call completes, ensuring multiple signal writes trigger only one wave of downstream reactions. It is used in both Resource and Command code within the query layer, as well as by the signals layer itself (`State.set`, `Effect`).

## Findings

### 1. Definition

- **Location**: `@/src/signals/base/Batcher.ts:1-56`
- **Shape**: Plain object export `Batcher` with two methods — not a class.
- **Internal state**: Module-private `Scheduled` object — a priority map (`Map<number, Set<() => void>>`) with `isLocked` flag.
- **Exported via**: `@/src/signals/base/index.ts:1` → `@/src/signals/index.ts:1` → root `@/src/index.ts`

### 2. What it does

- **`Batcher.run(fn)`** (`@/src/signals/base/Batcher.ts:42-53`)
  - Sets `isLocked = true`, executes `fn`, then flushes all scheduled callbacks by priority (rang), lowest first.
  - **Re-entrant**: nested `run()` calls execute `fn` inline without re-flushing — only the outermost call flushes.
  - **Error-safe**: `try/finally` ensures `isLocked` is reset even on throw; scheduled tasks from the failed batch are discarded (`Scheduled.done()` via `run()`).

- **`Batcher.scheduler(rang)`** (`@/src/signals/base/Batcher.ts:37-41`)
  - Returns `{ schedule(fn) }` — if batch is locked, defers `fn` at given priority; otherwise executes immediately.
  - `rang` = topological rank; lower-rank effects flush first, ensuring correct propagation order.

- **Scheduled flush algorithm** (`@/src/signals/base/Batcher.ts:22-31`):
  - Recursively drains `map` from `lowestRang` upward.
  - Special-case: if only `Infinity`-ranked tasks exist, runs them and exits.
  - Clears state via `done()` after full drain.

### 3. Usage in signals layer

- **`State.set()`** — `@/src/signals/signals/State.ts:44` — wraps hook callbacks + `bs$.next()` in `Batcher.run()`, so setting a signal always opens/joins a batch.
- **`Effect` constructor** — `@/src/signals/signals/Effect.ts:83` — creates `Batcher.scheduler(this._rang)` so that subscription notifications are deferred during batches and replayed in topological order afterward.

### 4. Usage in Resource code

- **`Resource.resetCache()`** — `@/src/signals/base/Batcher.ts` imported at `@/src/query/core/resource/Resource.ts:15`, used at `:108`
  - Wraps cache clear + `entry.complete()` loop + signal resets (`_lastEntry$.set(null)`, `status$.set("idle")`) in one batch.
- **`ResourceCacheEntry`** — does NOT import or use `Batcher` at all. Fetch lifecycle (`_doFetch`) transitions signals without explicit batching; relies on `State.set()` internally calling `Batcher.run()` per-write.

### 5. Usage in Command code

- **`Command.resetCache()`** — `@/src/query/core/command/Command.ts:25` — same pattern as Resource: wraps entry teardown in `Batcher.run()`.
- **`CommandCacheEntry._doTrigger()`** — `@/src/query/core/command/CommandCacheEntry.ts:118,148,206` — three `Batcher.run()` calls:
  - `:118` — sync-error path: wraps state transition + optimistic-patch abort.
  - `:148` — success path: wraps state transition + optimistic commit + link update patches + link invalidation.
  - `:206` — async-error path: wraps state transition + optimistic abort.
  - All three ensure the entire group of downstream effects fires once per outcome.

### 6. Asymmetry: Resource fetch vs Command trigger

| Aspect | ResourceCacheEntry._doFetch | CommandCacheEntry._doTrigger |
|--------|---------------------------|------------------------------|
| Explicit `Batcher.run` | **No** — each `State.set()` opens its own micro-batch | **Yes** — wraps multi-signal + link operations |
| Why? | Resource fetch updates a single signal per transition | Command updates multiple signals + commits patches + invalidates links |

### 7. Is it a shared extraction concern?

- **Yes.** `Batcher` is already shared: defined in `signals/base`, imported by both `query/core/resource` and `query/core/command`.
- It is a **signals-layer** primitive, not a query-layer concern. Any extraction of query-core does not need to "extract" Batcher — it just keeps the existing import dependency on `@/signals/base`.
- An extracted query-core layer would naturally depend on `Batcher` as an external dependency (same as it depends on `State`, `Computed`, `Effect`).
- The key design question is not whether to extract Batcher, but whether **`ResourceCacheEntry` should explicitly batch its fetch transitions** (like Command does) for consistency. Currently it doesn't because each fetch transition is a single `State.set()`.

## Code References

- `@/src/signals/base/Batcher.ts:1-56` — full Batcher definition
- `@/src/signals/base/Batcher.test.ts:1-89` — unit tests (run, scheduler, nesting, error recovery)
- `@/src/signals/base/index.ts:1` — re-export
- `@/src/signals/signals/State.ts:44` — `State.set()` wraps in `Batcher.run()`
- `@/src/signals/signals/Effect.ts:29,83` — Effect uses `Batcher.scheduler(rang)`
- `@/src/query/core/resource/Resource.ts:15,108` — import and `resetCache()` usage
- `@/src/query/core/command/Command.ts:2,25` — import and `resetCache()` usage
- `@/src/query/core/command/CommandCacheEntry.ts:12,118,148,206` — import and 3× fetch-lifecycle batches
- `@/docs/signals/README.md:227-251` — user-facing documentation (Russian)
- `@/src/__tests__/integration/signals-integration.test.ts:1,93,105` — integration tests
