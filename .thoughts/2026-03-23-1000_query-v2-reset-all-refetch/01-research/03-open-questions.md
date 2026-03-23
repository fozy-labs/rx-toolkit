---
title: "Open Questions: query-v2 resetAll() → Refetch Active Agents"
date: 2026-03-23
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: What mechanism should agents use to detect a reset — push (notification) or pull (state detection)?

**Context**: After `resetAll()`, the agent holds a stale reference to a `complete()`-d `CacheEntry` whose signal is frozen at `MachineIdle`. The agent has no mechanism to distinguish "idle because never started" from "idle because reset happened." Two fundamentally different architectures exist in the ecosystem:
- TanStack Query uses **push**: `query.setState()` triggers `onQueryUpdate()` on all attached observers, then `queryClient` explicitly calls `refetchQueries({ type: 'active' })`.
- RTK Query uses **pull**: hooks detect `uninitialized` state on the next React render and re-initiate.

The codebase analysis shows query-v1 used a **push** model via `ResetAllQueriesSignal` (global RxJS Subject), while query-v2 has no equivalent signal/event bus.

**Options**:
1. **Push — Resource emits a reset signal, agent subscribes** — Pros: deterministic, agent reacts immediately, no render dependency / Cons: new pub/sub infrastructure needed, agents must manage subscription lifecycle
2. **Push — Resource directly calls a method on tracked agents** — Pros: simpler than pub/sub, no event bus / Cons: resource must track agents (currently doesn't), tighter coupling
3. **Pull — Agent detects `CacheEntry.completed` flag on next `start()` call** — Pros: minimal new code / Cons: requires something to trigger `start()` again (React re-render), same pitfall as RTK Query ("hooks stuck in loading state"), won't work outside React

**Risks**: Choosing pull (Option 3) replicates RTK Query's documented pitfall where hooks can get stuck if no re-render occurs. Choosing push requires deciding on a notification channel (Q2).

**Researcher recommendation**: Push aligns with query-v2's signal-based reactivity model and avoids the RTK pitfall. Option 1 (signal-based) is most consistent with existing architecture.

---

### Q2: How should the system define and track "active" agents?

**Context**: To refetch only active agents (not destroyed or idle ones), the system needs a definition of "active." Currently, `ResourceV2Agent` has no subscriber count, no mounted/unmounted state, and does not register itself with the resource. The React hook `useResourceV2Agent` creates the agent once via `useConstant` and never informs the resource of its existence.

Both RTK Query and TanStack Query use subscriber/observer count as the canonical "active" indicator:
- RTK: `subscriptionCount > 0` in middleware internal state
- TanStack: `query.observers.length > 0` with `enabled !== false`

The existing `ResourceV2` has a GC mechanism using `lockEntry`/`scheduleGc` that tracks cache entry subscribers — but agents are not part of this tracking.

**Options**:
1. **Agent registers with Resource on `start()`, deregisters on `destroy()`** — Pros: Resource knows all active agents, can enumerate and notify / Cons: new lifecycle contract, existing agents don't call `destroy()`
2. **Agent registers with CacheEntry (like the existing GC lock)** — Pros: reuses existing subscriber tracking pattern / Cons: after `resetCache()` cache entries are destroyed, so the registration is lost before refetch can happen
3. **Agent self-tracks via `_currentArgs !== null` as "active"** — Pros: zero infrastructure change / Cons: agent can have args set but no React subscriber (zombie agent), may refetch unnecessarily
4. **React hook registers/deregisters agent as active** — Pros: accurate reflection of mounted UI / Cons: ties "active" concept to React, non-React consumers must implement their own registration

**Risks**: If "active" is defined too broadly (Option 3), unnecessary refetches fire for agents that no one is observing. If too narrow (Option 4), non-React consumers are excluded from refetch-on-reset.

**Researcher recommendation**: Option 1 provides a clean lifecycle. The `start()`/`destroy()` boundary already conceptually exists (agents have `start()`, hooks clean up on unmount). Formalizing it aligns with TanStack's observer pattern.

---

### Q3: How should the agent re-bind to a new CacheEntry after reset?

**Context**: `resetCache()` calls `entry.complete()` (which permanently locks the entry) and then `_cache.clear()` (which removes it from the map). The agent's `_tracking$` still holds a reference to the old, dead entry. A subsequent `resource.query(args)` would create a **new** `CacheEntry`, but the agent doesn't know about it.

Additionally, `agent.start(args)` has a same-args guard (`this._currentArgs !== null && compareArgs(...)`) that skips execution when called with identical arguments. This guard must be bypassed for re-fetch to work.

**Options**:
1. **Agent receives reset notification → nullifies `_currentArgs` → re-calls `start()` with last args** — Pros: reuses existing `start()` flow, same-args guard bypassed naturally / Cons: agent must store "last args" separately from `_currentArgs`
2. **Agent receives reset notification → calls a new `forceStart(args)` that skips same-args check** — Pros: explicit intent / Cons: new API surface, duplication with `start()`
3. **Resource re-creates cache entries instead of destroying them (reset entry state, don't `complete()` it)** — Pros: agent's reference remains valid, no re-binding needed / Cons: changes reset semantics, `complete()` contract is violated, may leak old state
4. **Agent's `start()` adds a `force` parameter** — Pros: minimal API change / Cons: changes public method signature of `start()`

**Risks**: Option 3 changes the fundamental `CacheEntry.complete()` contract and could introduce subtle bugs where old state leaks. Option 1 requires careful ordering to avoid the agent reading stale data between nullification and re-start.

**Researcher recommendation**: Option 1 is the least invasive. If the reset notification sets `_currentArgs = null` and then calls `start(lastArgs)`, the existing flow handles everything — new CacheEntry creation, signal binding, and query execution. The "last args" are already known from the value of `_currentArgs` before nullification.

---

### Q4: Should `resetAll()` clear data immediately (loading state) or preserve stale data during refetch (SWR)?

**Context**: TanStack Query distinguishes two operations:
- `resetQueries` → clears data, status becomes `pending`, user sees loading state during refetch
- `invalidateQueries` → keeps stale data visible, background refetch, user sees stale-while-revalidate

The current `resetAll()` clears data (via `complete()` → `MachineIdle`). The task description says "agents should re-fetch their data" but doesn't specify UX during refetch.

query-v2's `resource.invalidate(args)` already implements SWR: it transitions `MachineSuccess → MachineRefreshing` preserving stale data.

**Options**:
1. **Clear data, show loading** — `resetAll()` clears data completely, agents re-fetch from scratch, UI shows loading/skeleton. Pros: clean slate, matches TanStack's `resetQueries` / Cons: user sees flash of loading state
2. **Preserve stale data, background refetch (SWR)** — After reset, agents keep previous data visible and refetch in background. Pros: smoother UX / Cons: contradicts "reset" semantics (user expects data to be gone), more complex (must preserve data while resetting other state)
3. **Both behaviors via option parameter** — `resetAll({ preserveData: boolean })`. Pros: flexible / Cons: added complexity, must maintain two code paths

**Risks**: For auth/logout use cases (the primary scenario in TASK.md), preserving stale data is a **security risk** — the user may see data from the previous session. Clear-and-reload is the safer default.

**Researcher recommendation**: Option 1 (clear data, show loading) is the correct default for the logout use case. This matches TanStack's `resetQueries` design and avoids the security risk. If SWR-on-reset is needed later, it can be added as `invalidateAll()` separately.

---

## Medium Priority

### Q5: Should `resetAll()` return a `Promise` that resolves when refetches complete?

**Context**: TanStack's `resetQueries` returns a `Promise` that resolves when all active refetches complete. The current `resetAll(): void` is synchronous. Changing the return type from `void` to `Promise<void>` is technically non-breaking (callers ignoring the return value are unaffected), but it changes the API contract.

**Options**:
1. **Keep `void` return** — Pros: no API change, simpler implementation / Cons: callers can't await reset completion (e.g., for navigation after logout)
2. **Return `Promise<void>`** — Pros: enables `await api.resetAll()` for sequencing (e.g., reset → navigate), matches TanStack / Cons: introduces async semantics to a currently synchronous operation
3. **Add separate `resetAllAsync()` method** — Pros: backward compatible, explicit / Cons: API surface bloat

**Risks**: If kept as `void`, consumers who need to wait for refetches (e.g., to show a global loading indicator during logout) have no programmatic way to do so.

**Researcher recommendation**: Option 2 is a non-breaking change (returning a Promise from a previously-void function is backward-compatible). It can be deferred to a follow-up if it complicates the initial implementation.

---

### Q6: Should refetches be batched to avoid thundering-herd effects?

**Context**: If many agents are active (e.g., dashboard with 10+ resources), a simultaneous `resetAll()` would fire all refetches at once. TanStack Query addresses this with `notifyManager.batch()` to coalesce state notifications. query-v2 has `Batcher.run` for atomic signal updates.

**Options**:
1. **No batching — fire all refetches immediately** — Pros: simplest implementation, agents react as fast as possible / Cons: potential network storm, server load spike
2. **Batch signal notifications only** — Wrap reset + refetch-trigger in `Batcher.run` to prevent intermediate renders, but fire all network requests simultaneously. Pros: prevents UI flicker, similar to TanStack / Cons: doesn't address network concurrency
3. **Batch signal notifications + stagger network requests** — Pros: full protection against thundering herd / Cons: significantly more complex, adds latency to some refetches

**Risks**: For most applications (< 20 active queries), simultaneous refetches are not a problem. Over-engineering batching adds complexity with minimal practical benefit.

**Researcher recommendation**: Option 2 (batch signal notifications via `Batcher.run`, but don't stagger network requests). This matches TanStack's approach and is sufficient for the common case. Network-level throttling can be a separate concern.

---

### Q7: Should the notification mechanism be global (like query-v1's `ResetAllQueriesSignal`) or per-resource?

**Context**: query-v1 used a global RxJS `Subject<void>` (`ResetAllQueriesSignal`) that all resources subscribed to. query-v2 has no equivalent. The question is whether to introduce:
- A global signal that all agents subscribe to (simpler for `resetAll`, but agents must filter for their resource)
- A per-resource signal that only that resource's agents subscribe to (more granular, supports potential future `resource.reset()` with agent-refetch)

**Options**:
1. **Global reset signal on `api`** — Pros: single subscription point, trivial `resetAll()` implementation / Cons: agents can't distinguish "my resource was reset" from "some other resource was reset", no per-resource reset support
2. **Per-resource reset signal** — Pros: granular, supports `resource.resetCache()` also triggering agent refetch, aligns with the fact that `resetAll()` iterates resources / Cons: each agent subscribes to its resource's signal (more subscriptions)
3. **Callback on CacheEntry (extend `_onClean$`)** — Pros: reuses existing infrastructure / Cons: `_onClean$` completes after `complete()`, can't carry "refetch" semantic without rework

**Risks**: A global signal (Option 1) prevents future granularity. A per-resource signal (Option 2) scales better but requires agents to subscribe to their resource's lifecycle.

**Researcher recommendation**: Option 2. Since `resetAll()` already iterates per-resource (`resource.resetCache()`), a per-resource signal is natural. It also unlocks per-resource reset-with-refetch for free.

---

### Q8: What is the scope of agent types affected — only `ResourceV2Agent`, or also future agent types?

**Context**: The codebase analysis confirms query-v2 has only **one agent type**: `ResourceV2Agent`. There are no Operation or Command agents (unlike query-v1). However, the `IResourceV2Agent` interface and the architecture suggest future agent types are possible.

**Options**:
1. **Implement only for `ResourceV2Agent`** — Pros: solves the stated problem, no speculative design / Cons: if new agent types are added later, they'll need the same treatment
2. **Design a generic "resettable agent" interface** — Pros: future-proof / Cons: over-engineering for a single concrete type, YAGNI

**Risks**: Minimal. If only one agent type exists, designing for generality adds complexity without benefit.

**Researcher recommendation**: Option 1. Implement for `ResourceV2Agent` only. Generalization can happen if/when new agent types are introduced.

---

## Low Priority

### Q9: Should the auth demo use a mock backend or inline mock functions?

**Context**: TASK.md requires "an interactive demo example with an authentication use-case (single API, logout using `api.resetAll()`)." The existing demo infrastructure uses inline `setTimeout`-based mock functions in `apps/demos/src/utils/fetches.ts` (e.g., `getUser`, `getItems`). The demo uses `react-live` for live editing.

**Options**:
1. **Inline mocks only** — Add `login`/`logout`/`getProfile` functions to `fetches.ts`, toggle auth state via a module-level variable. Pros: zero external deps, works in `react-live` sandbox / Cons: less realistic
2. **MSW (Mock Service Worker)** — Pros: realistic network behavior / Cons: MSW requires service worker setup, doesn't work in `react-live` sandbox, heavy dependency for a demo
3. **Simple state-based mock with token** — A function that returns user data only if a mock "token" is set, simulating auth. Pros: demonstrates the logout→reset→refetch flow clearly, works in `react-live` / Cons: not a real HTTP request

**Risks**: Over-engineering the demo adds maintenance burden. The demo's purpose is to demonstrate `resetAll()` behavior, not auth architecture.

**Researcher recommendation**: Option 3. A simple token-gated mock function is sufficient to demonstrate: login → fetch user data → logout (clear token + `api.resetAll()`) → agents re-fetch → get "unauthorized" or refetch with loading state.

---

### Q10: What test helpers are needed for simulating active agent subscriptions?

**Context**: Existing tests for `ResourceV2Agent` (`ResourceV2Agent.test.ts`) create agents directly and call `start()` without simulating React subscriptions. React hook tests (`useResourceV2Agent.test.ts`) use `renderHook` from `@testing-library/react` but have no `resetAll` scenarios. The integration tests (`query-flow.test.ts`) test `resetAll` only for cache clearing, not agent behavior.

**Options**:
1. **Test at agent level directly** — Call `agent.start(args)`, then `api.resetAll()`, then assert agent re-fetches. Don't need React infrastructure. Pros: fast, isolated / Cons: doesn't test the React hook path
2. **Test at React hook level with `renderHook`** — Use `renderHook` + `act()` to simulate mount → reset → verify re-fetch. Pros: tests real user flow / Cons: slower, more setup
3. **Both** — Unit tests for agent reset behavior + integration tests for React hook. Pros: comprehensive / Cons: more test code

**Risks**: Testing only at agent level (Option 1) may miss issues in the React hook integration path (where the existing RTK pitfall of "stuck loading" manifests).

**Researcher recommendation**: Option 3. Agent-level tests verify the core mechanism; React-level tests verify the hook correctly bridges the reset to the UI. The existing test infrastructure supports both.

---

### Q11: Should `resetAll()` also trigger refetch for resources without a `key` (unregistered resources)?

**Context**: The codebase analysis shows resources are added to the registry only when `key` is not null (`createApi.ts:92`). Resources without a key are local/anonymous and are NOT affected by `resetAll()`. This is by design — but the question is whether agents of unregistered resources should also have a refetch mechanism.

**Options**:
1. **No — only registered resources participate in `resetAll()`** — Pros: consistent with current design, keyless resources are local by intent / Cons: none for current use cases
2. **Yes — provide a separate `resource.reset()` method that triggers agent refetch** — Pros: covers edge case / Cons: separate from `resetAll`, different API surface

**Risks**: Minimal. Unregistered resources without a key are uncommon and local by design.

**Researcher recommendation**: Option 1. `resetAll()` affects only registered resources. Per-resource reset (if implemented via Q7 Option 2) would cover keyless resources separately.
