---
title: "Correction Log"
date: 2026-03-29
stage: 02-design
role: rdpi-architect
---

# Correction Log

| Tier | File Modified | Section | Original | Corrected | Rationale |
|------|--------------|---------|----------|-----------|-----------|
| 3 | 01-architecture.md | §5 Fetch Lifecycle sequence diagram — Aborted branch | Showed `resolveQueryFulfilled(args, { error: AbortError, meta: "rejected" })` being called for aborted fetches, with `LH->>PR: reject(AbortError)` | Aborted (stale) fetches return early after stale check fails — no `resolveQueryFulfilled` call, no state change. The newer `_doFetch` owns the lifecycle. | `02-dataflow.md` §2 correctly identified that stale/aborted fetches should NOT settle the resolver — the stale check (`this._abortController !== controller`) causes early return in `_doFetch`. The newer `_doFetch` creates its own `fireQueryStarted` → resolver. Settling the old resolver on abort would double-settle or settle the wrong lifecycle. |
