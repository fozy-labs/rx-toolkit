---
title: "Signals System & Common Infrastructure — Codebase Analysis"
date: 2026-03-17
stage: 01-research
role: rdpi-codebase-researcher
---

## Summary

The rx-toolkit signals system is a fine-grained reactivity layer built on top of RxJS `BehaviorSubject`/`Observable`. It provides three core primitives — `State`, `Computed`, `Effect` — with automatic dependency tracking, batched updates, and devtools integration. The common infrastructure includes comparison utilities (`shallowEqual`, `deepEqual`), a `PromiseResolver` helper, a global options system (`SharedOptions`/`DefaultOptions`), devtools bridge to Redux DevTools, and React integration hooks (`useSignal`, `useConstant`, `useEventHandler`).

## Findings

### 1. Signal Primitives

#### 1.1 State — `@/src/signals/signals/State.ts:1-80`

Writable signal holding a single value.

- **Internal storage**: RxJS `BehaviorSubject<T>` (`this.bs$`), exposes `this.obs` as read-only `Observable<T>`.
- **`set(value)`** (line 39): Skips if `value === this.bs$.value` (referential equality). Runs inside `Batcher.run()`, fires lifecycle hooks (`hook.onChange`) before emitting via `bs$.next(value)`.
- **`get()`** (line 52): Calls `DependencyTracker.track()` to register this signal as a dependency of any running tracked context (computed/effect), then returns `bs$.getValue()`.
- **`peek()`** (line 35): Returns current value without registering a dependency.
- **`static create()`** (line 68): Factory that returns a `SignalFn<T>` — a callable function `signalFn()` (calls `get()`) augmented with `.set()`, `.peek()`, `.get()`, `.obs` properties.
- **Lifecycle hooks**: Created via `Devtools.createSignalHooks()` and custom `opts.hooks`. Hooks receive `onChange` and `onDispose` callbacks.
- **Finalization**: Uses `FinalizationRegistry` to call `hook.onDispose()` when the `State` instance is garbage-collected.
- **Rang**: `_rang = 0` — base rang used by the dependency tracker for ordering.

#### 1.2 Computed — `@/src/signals/signals/Computed.ts:1-112`

Read-only derived signal with lazy evaluation and automatic dependency tracking.

- **Lazy start**: Initialized with a sentinel `Computed._EMPTY` symbol. Actual computation only starts when the `.obs` observable gets its first subscriber (via the `map` operator in the pipe).
- **`_start()`** (line 80): Creates an internal `Effect` that runs `_computeFn`, storing computed result into an internal `State`. Effect re-runs on dependency changes, updating the internal state.
- **`_stop()`** (line 95): Unsubscribes the effect, resets state to `_EMPTY`. Called via RxJS `finalize()` when subscriber count drops to zero.
- **Observable pipe** (line 35-46): `state$.obs` → `map` (start compute if empty) → `distinctUntilChanged()` → `finalize` (stop) → `share` with `ReplaySubject(1)`, `resetOnRefCountZero: true`.
- **`get()`** (line 57): Registers dependency via `DependencyTracker.track()` with rang derived from the internal effect. Returns `peek()`.
- **`peek()`** (line 68): If not started, uses `ComputeCache.getOrCompute()` for a non-reactive snapshot with cached dependencies.
- **`static create()`** (line 102): Factory returning `ComputeFn<T>` — callable function with `.peek()`, `.get()`, `.obs`.
- **Devtools**: Uses `beforeDevtoolsPush` to filter out `_EMPTY` sentinel from devtools display.

#### 1.3 Effect — `@/src/signals/signals/Effect.ts:1-106`

Side-effect runner that re-executes when tracked dependencies change.

- **Constructor** (line 13): Immediately runs `_runInTrackedContext(effectFn)`.
- **`_runInTrackedContext()`** (line 22): 
  1. Calls previous teardown if any.
  2. Starts a `DependencyTracker.start()` context.
  3. Runs `effectFn()` — all `.get()` calls inside register dependencies.
  4. For each dependency, reuses existing subscriptions or creates new ones.
  5. On dependency emission (outside tracked context), schedules re-execution via `Batcher.scheduler(rang).schedule()`.
  6. Unsubscribes stale dependencies (those from previous run not used in current).
  7. Returns optional teardown function.
- **Rang calculation**: `_rang` = max(dependency rangs) + 1. Ensures effects run after their dependencies in batched execution.
- **`unsubscribe()`** (line 84): Calls teardown, unsubscribes all observables. Implements `SubscriptionLike`.
- **`static create()`** (line 103): Factory returning `Effect` instance.

#### 1.4 Signal (namespace) — `@/src/signals/signals/Signal.ts:1-36`

Convenience class that extends `State` and provides static factory methods.

- `Signal.state<T>(initialValue, options)` → `State.create()` → `SignalFn<T>`
- `Signal.compute<T>(computeFn, options)` → `Computed.create()` → `ComputeFn<T>`
- `Signal.effect(effectFn)` → `Effect.create()` → `Effect`
- `Signal.create()` — deprecated alias for `Signal.state()`.
- Constructor — deprecated, delegates to `State`.

#### 1.5 LocalState — `@/src/signals/signals/LocalState.ts:1-100+`

Persistent signal backed by localStorage/sessionStorage. Uses `State` internally plus a `Computed` with optional Zod validation and `checkEffect`. Implements `StatefulSignalFn<T>` with `.set()`, `.get()`, `.peek()`, `.clear()`, `.obs`. Not directly relevant to query-v2 but demonstrates the composition pattern (State + Computed).

#### 1.6 Public exports — `@/src/signals/index.ts:1-5`

Re-exports everything from: `./base`, `./operators`, `./react`, `./signals`, `./types`.

### 2. Signal Base Layer

#### 2.1 ReadonlySignal — `@/src/signals/base/ReadonlySignal.ts:1-37`

Base class for read-only signals built on `SyncObservable`.

- Implements `ReadableSignalLike<T>`.
- `get()`: Tracks via `DependencyTracker`, returns `this.obs.value`.
- `peek()`: Returns `this.obs.value` untracked.
- `static create()`: Returns `ReadableSignalFnLike<T>` — callable function with `.obs`, `.peek()`, `.get()`.
- `rang = 0` (protected).

#### 2.2 SyncObservable — `@/src/signals/base/SyncObservable.ts:1-20`

Extends RxJS `Observable<T>` with a synchronous `.value` getter.

- `get value()`: Subscribes synchronously, captures the first emitted value, immediately unsubscribes. Throws if no value is emitted.
- This provides synchronous access to observables that are known to emit immediately (like `BehaviorSubject`-backed ones).

#### 2.3 Batcher — `@/src/signals/base/Batcher.ts:1-54`

Batching mechanism for coordinated signal updates.

- **`Batcher.run(fn)`**: If not already locked, sets `isLocked = true`, executes `fn()`, then runs all scheduled callbacks in rang order (`Scheduled.run()`), then unlocks. If already locked (nested call), just runs `fn()` directly.
- **`Batcher.scheduler(rang)`**: Returns `{ schedule(fn) }` — if not in a batch, runs `fn()` immediately; if in a batch, queues `fn` at the given `rang`.
- **`Scheduled` object**: Internal priority queue using `Map<number, Set<() => void>>`. Runs callbacks from lowest rang upward recursively. `Infinity` rang has special handling (runs last).
- **Rang ordering**: Ensures that effects at higher rang levels (deeper in the dependency graph) execute after lower-rang signals. This prevents glitches.

#### 2.4 DependencyTracker — `@/src/signals/base/DependencyTracker.ts:1-33`

Global context for tracking signal accesses.

- **`DependencyTracker.start(handler)`**: Sets a handler function that receives `DependencyRecord` for each accessed signal. Returns a `stop` function to restore the previous handler (stack-based).
- **`DependencyTracker.track(dep)`**: Called by `State.get()`, `Computed.get()`, `ReadonlySignal.get()`. Invokes the current handler with a `DependencyRecord`.
- **`DependencyRecord`**: `{ getRang(), obs, peek(), meta? }` — provides the observable for subscription, `peek()` for snapshot, and `getRang()` for ordering.

#### 2.5 ComputeCache — `@/src/signals/base/ComputeCache.ts:1-70`

Caching for `Computed.peek()` when no active subscription exists.

- `getOrCompute(computeFn)`: If cache is valid (all dependency values match last-seen values via `Object.is()`), returns cached value. Otherwise, runs `computeFn` in a `DependencyTracker` context, captures dependencies and their current values, caches result.
- `isValid()`: Checks each captured dependency's `peek()` against stored `lastValue`.
- `clear()`: Resets cache (called when computed starts its effect-based subscription).

#### 2.6 Devtools — `@/src/signals/base/Devtools.ts:1-78`

Bridge between signals and the devtools system.

- **`Devtools.createState(initialValue, options)`**: Returns an updater function `(newState) => void` that pushes state changes to `SharedOptions.DEVTOOLS.state()`. Uses `Indexer` for unique key generation. Returns `null` if devtools are disabled or not configured.
- **`beforeDevtoolsPush` pattern** (line 35-37): If `options.beforeDevtoolsPush` is present, calls it with `(value, push)` instead of calling `push(value)` directly. This lets the caller filter/transform values before they reach devtools. Present in both `createState()` and `createSignalHooks()`.
- **`Devtools.createSignalHooks(initialValue, options)`**: Returns a `SignalLifecycleHook<T>` with `onChange` (pushes to devtools) and `onDispose` (pushes `'$COMPLETED'`). Used by `State` constructor.
- **Key format**: `{key_with_optional_{base}_and_{scope}_replacement}#i={index}`. Uses `Indexer.getIndex()` for uniqueness.
- **`Devtools.hasDevtools`**: Boolean getter checking `SharedOptions.DEVTOOLS?.state`.

#### 2.7 Indexer — `@/src/signals/base/Indexer.ts:1-6`

Simple auto-incrementing counter. `Indexer.getIndex()` returns `currentIndex++`. Used by `Devtools` for unique signal identification.

### 3. Devtools Integration

#### 3.1 DevtoolsLike interface — `@/src/common/devtools/types.ts:1-6`

```ts
interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}
interface DevtoolsStateLike<T = any> {
    (newState: T): void;
}
```

- `state(name, initState)` registers a named state and returns an updater function.
- The updater accepts new state values (or `'$COMPLETED'`/`'$CLEANED'` for disposal).

#### 3.2 reduxDevtools — `@/src/common/devtools/reduxDevtools.ts:1-220`

Creates a `DevtoolsLike` backed by Redux DevTools Extension.

- **Options**: `name`, `driver` (custom Redux DevTools extension), `batchStrategy` (`'sync'` | `'microtask'` | `'task'`), `taskDelay`.
- **Batch scheduler** (`createBatchScheduler`): Coalesces multiple state updates into a single `connection.send()` call:
  - `'sync'`: Uses `Batcher.scheduler(Infinity)` to dispatch at end of signal batch.
  - `'microtask'`: Uses `queueMicrotask()`.
  - `'task'`: Uses `setTimeout()` with configurable delay.
- **State tree**: Maintains a flat-to-nested `state` object. Key names split by `/` to create nested structure. `applyState()` immutably sets values, `deleteState()` immutably removes with cleanup of empty parents.
- **Action types**: Tracks `pendingActionType` (`'create'` | `'update'` | `'clear'`) for meaningful devtools action labels.

#### 3.3 combineDevtools — `@/src/common/devtools/combineDevtools.ts:1-10`

Merges multiple `DevtoolsLike` instances into one. Each `state()` call registers across all devtools, updater broadcasts to all.

#### 3.4 End-to-end devtools flow

1. `DefaultOptions.update({ DEVTOOLS: reduxDevtools() })` sets `SharedOptions.DEVTOOLS`.
2. `State` constructor → `Devtools.createSignalHooks()` → `Devtools.createState()` → calls `SharedOptions.DEVTOOLS.state(key, initValue)` → gets updater function.
3. On `State.set(value)` → hook `onChange(value)` → updater function → `reduxDevtools` state tree update → batch scheduled → `connection.send()` to Redux DevTools.
4. `beforeDevtoolsPush` intercepts at step 2-3, allowing value transformation before `push()`.
5. Disposal via `FinalizationRegistry` → `onDispose()` → `push('$COMPLETED')` → removes from state tree.

### 4. Common Utilities

#### 4.1 shallowEqual — `@/src/common/utils/shallowEqual.ts:1-28`

Standard shallow equality check. Compares by reference first, then checks object keys length and value equality with `===`. Returns `boolean`. RFC specifies this as default `compareArg`.

#### 4.2 deepEqual — `@/src/common/utils/deepEqual.ts:1-28`

Recursive deep equality check. Same structure as `shallowEqual` but recurses into nested objects. No special handling for arrays, dates, or other types — uses `Object.keys()` and recursive comparison only.

#### 4.3 PromiseResolver — `@/src/common/utils/PromiseResolver.ts:1-16`

Deferred promise pattern. Creates a `Promise<T>` and exposes `.resolve(value)` and `.reject(reason)` methods. Useful for externally-controlled promise resolution (e.g., lifecycle hooks like `onCacheEntryAdded`, `onQueryStarted`).

#### 4.4 SharedOptions — `@/src/common/options/SharedOptions.ts:1-14`

Global singleton with static properties:

- `DEVTOOLS: DevtoolsLike | null` — global devtools instance.
- `onQueryError: ((error: unknown) => void) | null` — global error handler.
- `getScopeName: (() => string | null) | null` — scope name provider for keyed contexts.
- `defaultCompareArgs` — defaults to `shallowEqual`.
- `reset()` — resets all to defaults.

#### 4.5 DefaultOptions — `@/src/common/options/DefaultOptions.ts:1-14`

Setter for `SharedOptions`. `DefaultOptions.update(part)` applies partial updates to `SharedOptions` static fields. Only exposes `DEVTOOLS`, `onQueryError`, `getScopeName` for external configuration.

#### 4.6 Common exports

- `@/src/common/utils/index.ts` exports: `PromiseResolver`, `deepEqual`, `shallowEqual`.
- `@/src/common/options/index.ts` exports: `DefaultOptions` (not `SharedOptions` — internal).
- `@/src/common/devtools/index.ts` exports: `reduxDevtools`, `combineDevtools`, types.
- `@/src/common/react/index.ts` exports: `useConstant`, `useEventHandler`.

### 5. Common React Hooks

#### 5.1 useConstant — `@/src/common/react/useConstant.ts:1-27`

Persistent memoization hook. Creates a value once via `fn()`, re-creates only when `deps` change (shallow reference comparison per element). Unlike `useMemo`, guarantees referential stability — React's `useMemo` does not guarantee this. Uses `useRef` internally.

#### 5.2 useEventHandler — `@/src/common/react/useEventHandler.ts:1-8`

Stable callback reference hook. Stores `fn` in a ref (updated every render), returns a stable `useCallback`-wrapped function that always delegates to `ref.current`. Avoids stale closures while maintaining referential identity.

### 6. Signal Operators

#### 6.1 signalize — `@/src/signals/operators/signalize.ts:1-8`

Converts an RxJS `Observable<T>` into a `ReadableSignalFnLike<T>`. Uses `ReadonlySignal.create()` with a subscribe function that pipes from the source observable. Enables using arbitrary observables in the signal dependency graph.

This is the only operator currently available in `@/src/signals/operators/index.ts`.

### 7. Signal React Integration

#### 7.1 useSignal — `@/src/signals/react/useSignal.ts:1-33`

React hook for subscribing to any signal-like object `{ obs, peek() }`.

- Uses `React.useSyncExternalStore(subscribe, getSnapshot)`.
- **subscribe**: Subscribes to `signal$.obs`. On emission, sets `doUpdateRef.current = true`, then `queueMicrotask(() => update())`.  The microtask batching prevents redundant synchronous re-renders.
- **getSnapshot**: Calls `signal$.peek()` (untracked read). Sets `doUpdateRef.current = false` to prevent double-trigger if microtask fires after snapshot read.
- **Dependencies**: Re-subscribes when `signal$` reference changes (via `useCallback` dep).
- Uses `useEventHandler` for stable `getSnapshot` reference.

This is the only export from `@/src/signals/react/index.ts`.

### 8. Type Definitions — `@/src/signals/types/`

#### 8.1 signals.types.ts — `@/src/signals/types/signals.types.ts:1-23`

Core signal type interfaces:

| Interface | Extends | Members |
|-----------|---------|---------|
| `ReadableSignalLike<T>` | — | `obs: Observable<T>`, `peek(): T`, `get(): T` |
| `ReadableSignalFnLike<T>` | `ReadableSignalLike<T>` | `(): T` (callable) |
| `WriteableSignalLike<T>` | — | `set(value: T): void` |
| `ClearableSignalLike<T>` | — | `clear(): void` |
| `StatefulSignalFn<T>` | `ReadableSignalFnLike<T>`, `WriteableSignalLike<T>`, `ClearableSignalLike<T>` | combined |
| `SignalFn<T>` | `ReadableSignalFnLike<T>`, `WriteableSignalLike<T>` | combined |
| `ComputeFn<T>` | `ReadableSignalFnLike<T>` | read-only callable |

#### 8.2 SignalOptions.ts — `@/src/signals/types/SignalOptions.ts:1-20`

```ts
interface SignalLifecycleHook<T> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}

type TBeforeDevtoolsPushFn<T> = (newValue: T, push: (v: T) => void) => void;

interface SignalOptions<T> {
    key?: string;
    name?: string;       // deprecated, use key
    base?: string;
    isDisabled?: boolean;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<T>;
    hooks?: SignalLifecycleHook<T>[];
}

type SignalOptionsOrKey<T> = SignalOptions<T> | string;
```

#### 8.3 normalizeSignalOptions.ts — `@/src/signals/types/normalizeSignalOptions.ts:1-10`

Converts `SignalOptionsOrKey<T>` to `SignalOptions<T>`. If string, treats as `{ key }`. If `name` is set but `key` is not, copies `name` to `key`.

## Code References

- `@/src/signals/signals/State.ts:39-50` — `State.set()` with batching and hooks
- `@/src/signals/signals/State.ts:52-58` — `State.get()` with dependency tracking
- `@/src/signals/signals/State.ts:68-80` — `State.create()` factory producing `SignalFn<T>`
- `@/src/signals/signals/Computed.ts:35-46` — Observable pipe with lazy start, `distinctUntilChanged`, `share`
- `@/src/signals/signals/Computed.ts:57-65` — `Computed.get()` with dependency tracking
- `@/src/signals/signals/Computed.ts:68-76` — `Computed.peek()` with `ComputeCache` fallback
- `@/src/signals/signals/Computed.ts:80-95` — `_start()`/`_stop()` lifecycle
- `@/src/signals/signals/Effect.ts:22-80` — `_runInTrackedContext()` — core effect execution
- `@/src/signals/signals/Effect.ts:84-90` — `unsubscribe()` cleanup
- `@/src/signals/signals/Signal.ts:23-35` — Static factory methods (`state`, `compute`, `effect`)
- `@/src/signals/base/Batcher.ts:1-54` — Entire batching system with rang-ordered execution
- `@/src/signals/base/DependencyTracker.ts:1-33` — Stack-based dependency tracking context
- `@/src/signals/base/ComputeCache.ts:1-70` — Cache for unsubscribed computed peek
- `@/src/signals/base/Devtools.ts:1-78` — Devtools bridge with `beforeDevtoolsPush` pattern
- `@/src/signals/base/Devtools.ts:35-37` — `beforeDevtoolsPush` invocation pattern
- `@/src/signals/base/ReadonlySignal.ts:1-37` — Read-only signal base class
- `@/src/signals/base/SyncObservable.ts:1-20` — Synchronous value access for observables
- `@/src/signals/base/Indexer.ts:1-6` — Auto-incrementing index
- `@/src/common/devtools/types.ts:1-6` — `DevtoolsLike`, `DevtoolsStateLike` interfaces
- `@/src/common/devtools/reduxDevtools.ts:119-158` — `reduxDevtools()` factory and state management
- `@/src/common/devtools/reduxDevtools.ts:46-108` — `createBatchScheduler()` with three strategies
- `@/src/common/devtools/combineDevtools.ts:1-10` — Multi-devtools combiner
- `@/src/common/utils/shallowEqual.ts:1-28` — Shallow equality (default `compareArg` per RFC)
- `@/src/common/utils/deepEqual.ts:1-28` — Recursive deep equality
- `@/src/common/utils/PromiseResolver.ts:1-16` — Deferred promise utility
- `@/src/common/options/SharedOptions.ts:1-14` — Global options singleton
- `@/src/common/options/DefaultOptions.ts:1-14` — Public options setter
- `@/src/common/react/useConstant.ts:1-27` — Stable memoization hook
- `@/src/common/react/useEventHandler.ts:1-8` — Stable callback hook
- `@/src/signals/operators/signalize.ts:1-8` — Observable-to-signal adapter
- `@/src/signals/react/useSignal.ts:1-33` — `useSyncExternalStore`-based signal subscription
- `@/src/signals/types/signals.types.ts:1-23` — Core signal type hierarchy
- `@/src/signals/types/SignalOptions.ts:1-20` — Signal options and lifecycle hook types
- `@/src/signals/types/normalizeSignalOptions.ts:1-10` — Options normalization
