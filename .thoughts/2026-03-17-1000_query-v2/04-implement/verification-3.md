---
title: "Verification: Phase 3"
date: 2026-03-18
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check | PASS | `tsc --noEmit` completed with no errors |
| C1: serialize set+get | PASS | Test passes |
| C2: different key order same result | PASS | Test passes (stableStringify sorts keys) |
| C3: has returns false for missing | PASS | Test passes |
| C4: delete removes entry | PASS | Test passes |
| C5: compare set+get with shallowEqual | PASS | Test passes |
| C6: compare miss with different args | PASS | Test passes |
| C7: compare values iteration | PASS | Test passes |
| C8: clear empties cache | PASS | Test passes |
| C9: entries returns key-entry pairs | PASS | Test passes |
| C10: doCacheArgs memoization (WeakMap) | PASS | serializeSpy called once for two gets on same object ref |
| C11: doCacheArgs with primitives — no caching | PASS | serializeSpy called twice for two gets on primitive 42 |
| E3: empty cache values() | PASS | Both serialize and compare strategies return empty iterable |
| CacheEntry: peek() returns initial | PASS | Test passes |
| CacheEntry: set() updates machine | PASS | Test passes |
| CacheEntry: machine$ reactive signal | PASS | Signal.compute re-evaluates on set() (evalCount 1→2) |
| CacheEntry: set() no-op after complete() | PASS | Test passes |
| CacheEntry: complete() idempotent | PASS | Test passes |
| CacheEntry: complete() calls abortAllPendingPatches on MachineWithData (ADR-4 L3) | PASS | Spy confirms call on MachineWithData.prototype.abortAllPendingPatches |
| CacheEntry: complete() sets machine to idle | PASS | Test passes |
| CacheEntry: complete() skips abort on non-MachineWithData | PASS | Spy confirms no call on MachinePending |
| CacheEntry: onClean$ fires on complete() | PASS | Test passes |
| CacheEntry: onClean$ idempotent on double complete | PASS | Callback fires once |
| D4: all 5 machine types JSON-serializable | PASS | JSON.stringify succeeds for Idle, Pending, Success, Error, Refreshing |
| CacheEntry: beforeDevtoolsPush composes with user callback | PASS | Test passes |
| CacheEntry: keyParts builds key | PASS | Test passes |
| doCacheArgs WeakMap implementation | PASS | `_argsMemo` typed as `WeakMap<object, string> \| null`, initialized with `new WeakMap()` when `doCacheArgs=true` |
| No imports from src/query/ | PASS | grep for `from '@/query/'`, `from "../query/"`, `from './query/'` across `src/query-v2/**` — zero matches |

## Summary

28/28 checks passed.

All 31 tests pass (18 CacheMap, 13 CacheEntry). TypeScript compilation clean. Dual-strategy CacheMap (SerializedCacheMap + CompareCacheMap) implemented with factory. CacheEntry uses Signal.state with `beforeDevtoolsPush` projecting `machine.state`. `complete()` correctly invokes `abortAllPendingPatches()` on MachineWithData instances (ADR-4 Layer 3). `doCacheArgs` memoization uses WeakMap for object args, bypasses for primitives. No cross-module imports from `src/query/`.
