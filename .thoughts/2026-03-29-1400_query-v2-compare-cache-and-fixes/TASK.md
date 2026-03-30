---
title: "query-v2 CompareCacheMap, devtools key extraction, lifecycle hooks, and demo fixes"
created: 2026-03-29
---

# Task

Problems (more complex than they seem):

1) `CompareCacheMap` MUST NOT use Array (`find/findIndex` is nonsense), it needs to use Map/WeakMap for instant access.
2) `CompareCacheMap` does not support a caching option (for instant lookup).
3) For the comparison strategy, serialization is used when determining the devtools key (need to add an option to specify a function for extracting the devtools key from arguments, default — indices).
4) For the serialization strategy, when determining the devtools key, an extra (redundant) serialization call is made.
5) `LifecycleHooks` should belong to ResourceEntry, not the resource.
6) In query-v2 interactive examples, the agent incorrectly implemented cases with "isError: false" (in these examples `isError` will always be false).
