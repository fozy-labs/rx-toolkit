---
title: "Correction Log"
date: 2026-03-30
stage: 02-design
role: rdpi-architect
---

# Correction Log

| Tier | File Modified | Section | Original | Corrected | Rationale |
|------|--------------|---------|----------|-----------|-----------|
| 5 | 03-model.md | 4.3 Lifecycle Methods on Entry — `_fireCacheEntryAdded` | Code sample ends after `try/catch` with no hydration handling | Added hydration check: if `this.peek().status === "success"`, resolve `_entryDataLoaded` immediately with `machine.data` | 01-architecture.md §5.7 states "$cacheDataLoaded resolves immediately for MachineSuccess initial state" but the model's code sample did not implement this. Hydrated entries (via Snapshot) skip `_doFetch()`, so `_entryDataLoaded` would never resolve without this check. |
