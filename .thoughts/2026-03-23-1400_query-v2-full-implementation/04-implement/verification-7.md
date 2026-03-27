---
title: "Verification: Phase 7"
date: 2026-03-26
stage: 04-implement
role: rdpi-tester
---

## Results

| Check | Status | Details |
|-------|--------|---------|
| ts-check (src/query-v2/) | PASS | No TS errors in `src/query-v2/`. All errors are in `src/query-v2-legacy/` (out of scope). |
| RH01–RH10 (useResourceV2Agent) | FAIL | Tests never complete — infinite re-render loop causes OOM (1,290,555 errors when run with `-t "RH02"` filter; heap limit allocation failure when run unfiltered). Root cause: `useResourceV2Agent` calls `startAgent(agent, effectiveArg)` during render (not in `useEffect`). For SKIP case: `agent.start(SKIP)` unconditionally calls `this._tracking$.set({ previous: null, current: null })` creating a new object each render → signal change → `useSyncExternalStore` re-render → infinite loop. For non-SKIP case: first render's `start()` sets `_tracking$` with a new entry, triggers signal → re-render → second render hits same-args early return and settles. However `_deriveState` uses `queueMicrotask(() => this._tracking$.set(...))` to clear `previous`, which may cause additional re-render cycles. |
| PL01–PL08, PL11 (ReactHooksPlugin) | PASS | 9/9 tests passed in `src/query-v2/plugins/__tests__/ReactHooksPlugin.test.ts` (1.21s). |
| PL09–PL10 type-level (plugins) | PASS | 2/2 tests passed in `src/query-v2/plugins/__tests__/ReactHooksPlugin.type.test.ts` (1.39s). |
| PL09–PL10 type-level (types) | PARTIAL | In `src/query-v2/types/__tests__/type-level.test.ts`: PL09 PASS, PL10 FAIL — test invokes `resource.useResourceV2Agent({ id: 1 })` at runtime (outside React component context), causing `TypeError: Cannot read properties of null (reading 'useRef')`. This test file is a duplicate of tests already passing in `ReactHooksPlugin.type.test.ts` and has a design flaw (invokes hook at runtime instead of type-only assertion). |
| Barrel: `src/query-v2/react/index.ts` | PASS | Exports `useResourceV2Agent`. |
| Barrel: `src/query-v2/plugins/index.ts` | PASS | Exports `ReactHooksPlugin`. |
| Module barrel: `src/query-v2/index.ts` | PASS | Includes react layer (`useResourceV2Agent`) and plugins layer (`ReactHooksPlugin`) re-exports alongside existing types, lib, and api exports. |
| No upward imports (react/) | PASS | `useResourceV2Agent.ts` imports only from `react`, `@/common/react`, `@/query-v2/lib/SKIP_TOKEN`, `@/query-v2/types` (type-only). No imports from `api/` or `plugins/`. |
| `useSyncExternalStore` usage | PASS | Hook uses `React.useSyncExternalStore(subscribe, getSnapshot)`. No `useState` or `useEffect`. |
| Plugin augmentation via conditional types | PASS | `PluginAugmentations` uses conditional types (`PluginResourceContributions`) — no `declare module` augmentation anywhere in `src/query-v2/`. |

## Summary

9/11 checks passed.

### Failures

1. **RH01–RH10 (useResourceV2Agent tests)** — infinite re-render loop. The hook calls `agent.start()` during render which mutates a signal, triggering `useSyncExternalStore` to re-render, which calls `start()` again. The SKIP branch is unconditionally mutating (`_tracking$.set(...)` with a new object every time), causing a guaranteed infinite loop. The non-SKIP branch has a same-args guard but the initial render-time side effect pattern is fragile.

2. **PL10 in `type-level.test.ts`** — invokes `useResourceV2Agent` outside React context at runtime. This is a test design issue (already correctly covered in `ReactHooksPlugin.type.test.ts` which passes).
