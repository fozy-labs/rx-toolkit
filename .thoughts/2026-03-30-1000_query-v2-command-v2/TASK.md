---
title: "Develop CommandV2 for query-v2"
created: 2026-03-30
---

# Task

Develop CommandV2 for the query-v2 module.

CommandV2 is the mutation/command abstraction for query-v2, analogous to what `createCommand` / `CommandAgent` is for query-v1. The v1 Command system includes link-based invalidation, optimistic updates, lock mechanisms, and a React hook (`useCommandAgent`). Currently query-v2 has zero Command infrastructure — only ResourceV2 (read-side) is implemented.

This task covers:
- Full CommandV2 design aligned with v2's architecture (state machines, CacheEntry, plugin system, snapshot, etc.)
- Implementation: core CommandV2Agent, state machine, API (`createCommand` on `createApi`), React hook (`useCommandV2Agent`)
- Integration with existing v2 systems: cache invalidation, optimistic updates, lifecycle hooks, devtools
- Tests (unit + integration)
- Alignment with v2 patterns (no boolean flags, machine states, signals-based reactivity)
