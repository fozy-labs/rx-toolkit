---
title: "Risk Analysis — Query v2 Fixes"
date: 2026-03-18
stage: 02-design
role: rdpi-qa-designer
---

# Risk Analysis

## Risk Matrix

| ID | Risk | Probability | Impact | Strategy | Mitigation |
|----|------|-------------|--------|----------|------------|
| R1 | Snapshot error throwing breaks existing SSR flows that expect silent skip | High | High | Mitigate | Wrap-or-document pattern; update existing tests |
| R2 | Core split breaks internal imports in tests and cross-module references | Medium | Medium | Mitigate | Compiler-first approach; run full test suite after every move |
| R3 | Plugin backward compatibility — `ReactHooksPlugin.augmentResource` delegation changes behavior | Low | High | Mitigate | Delegation is transparent; plugin tests verify identical output |
| R4 | Cross-fix interaction: #1/#2 + #3 simultaneous file creates/moves cause merge conflicts | Medium | Medium | Mitigate | Strict implementation order; single branch |
| R5 | Version upgrade scenario: new code + old snapshot in browser cache → immediate throw on page load | High | High | Mitigate | Document try/catch pattern; SSR best practices section |
| R6 | DevTools filtering accidentally hides useful CacheEntry data | Low | Medium | Accept | `isDisabled` only on agent signals; CacheEntry explicitly unaffected |
| R7 | Test coverage gap for integration paths between hooks + snapshot + devtools | Medium | Medium | Mitigate | Add standalone hook integration tests; verify cross-fix paths |
| R8 | Breaking change for consumers who deep-import from `core/` sub-paths | Low | Low | Accept | User decision: only barrel imports are public [ref: ../01-research/02-open-questions.md#q9] |
| R9 | New `react/` standalone hooks introduce React dependency where none existed | Low | Low | Accept | React is only pulled when `react/` module is imported; tree-shaking removes it for non-React consumers |
| R10 | Snapshot `console.warn` on unknown resource key missed during debugging | Low | Low | Accept | Warn is the correct severity for non-fatal skip; message includes resource key for traceability |

---

## Detailed Mitigation Plans

### R1: Snapshot error throwing breaks existing SSR flows

**Risk**: `hydrateSnapshot` currently returns silently on version/prefix mismatch. Existing consumers may rely on this — their SSR setup generates a snapshot, embeds it in HTML, and the client hydrates. If the server deploys new code (version N+1) but the client loads HTML cached with version N snapshot, `createResource` now throws instead of silently skipping. This is a **behavioral breaking change** for the `hydrateSnapshot` call path.

**Mitigation steps**:
1. **Update `createApi` call site documentation** to show the try/catch pattern for `initialSnapshot` when rolling deployments may produce version mismatches. The use case UC-4.6 [ref: ./05-usecases.md#uc-46-edge-case--ssr-version-upgrade] documents this pattern explicitly.
2. **Update existing snapshot tests** (S4, S5) and SSR hydration integration tests to expect `throw` instead of silent skip. This is tracked in test cases T29, T30, T37.
3. **Error messages must be descriptive**: include both expected and actual values for version and prefix so the developer can immediately diagnose the mismatch without debugger stepping.
4. **Verification**: After implementation, run the full SSR hydration integration test suite. The two tests that currently verify "no hydration" must be updated to verify `toThrow()` with specific error messages.

### R4: Cross-fix interaction — simultaneous file creates/moves

**Risk**: Fix #1/#2 creates `react/` directory with new files. Fix #3 moves files within `core/` into sub-folders. Both changes touch `index.ts` barrels and internal import paths. If implemented on separate branches or in the wrong order, merge conflicts are likely in `core/index.ts`, `query-v2/index.ts`, and any file that imports from both affected areas (e.g., `ReactHooksPlugin` imports from `core/` and needs `ResourceV2` — if that import path changes mid-work, the plugin file breaks).

**Mitigation steps**:
1. **Implementation order**: Fix #3 (core split) first, then Fix #1/#2 (hooks extraction). Rationale: the core split only moves files and updates internal paths — no behavioral change. Once the split is stable and all tests pass, hooks extraction can reference the new `core/resource/ResourceV2` path from the start.
2. **Single branch**: All 7 fixes should be implemented on one feature branch to avoid cross-branch merge conflicts. PRs can be split by fix area using stacked commits, but they merge together.
3. **Verify after each fix**: Run `vitest run src/query-v2/` after each fix is completed before starting the next. This catches broken imports immediately rather than at the end.

### R5: Version upgrade — old snapshot + new code

**Risk**: In production SSR deployments, there is a window during rolling updates where the server may serve HTML with an embedded snapshot of version N, but the client JavaScript is version N+1 (or vice versa). With the new throw behavior, this will cause a runtime error during `createApi`/`createResource`. Unlike the previous silent skip, this is a **visible failure** that may crash the app if not handled.

**Mitigation steps**:
1. **Document the recommended SSR pattern** in `docs/query-v2/ssr.md`: always generate the snapshot from the same build artifact as the client code. In typical SSR setups (Next.js, Remix), the server and client share the same build, so version mismatches don't occur.
2. **Document the try/catch fallback** for environments where version parity is not guaranteed (CDN-cached HTML, PWA service workers with stale HTML). The pattern: wrap `createApi({ initialSnapshot })` in try/catch, fall back to `createApi({})` on error.
3. **Error message includes actionable guidance**: "Snapshot version mismatch: expected N, got M. The snapshot format is incompatible with the current version of query-v2." — this tells the developer exactly what's wrong and hints at the fix (regenerate snapshot).
4. **Verification**: T37 covers this path explicitly — `createApi` with mismatched snapshot throws, consumer catches and recovers.

### R3: Plugin backward compatibility

**Risk**: `ReactHooksPlugin.augmentResource` currently defines hook functions inline. After the change, it imports and delegates to standalone functions from `react/`. If the delegation has any subtle difference (e.g., closure scope, `this` binding, argument passing), existing consumers calling `resource.useResourceV2Agent(args)` could see different behavior.

**Mitigation steps**:
1. **Delegation is a single-line pass-through**: `(args) => useResourceV2Agent(res, args)`. No intermediate logic, no `this` binding, no additional wrapping. The standalone function receives the exact same `resource` and `args` as the previous inline implementation.
2. **Existing plugin tests (PL1-PL4)** verify that `augmentResource` attaches methods, `install` is called, and augmentation happens per-resource. These tests pass without modification because the external contract is unchanged.
3. **T8 and T9** explicitly verify that plugin path and standalone path produce identical results for both hooks.
4. **Verification**: Run `ReactHooksPlugin.test.ts` and `plugin-augmentation.test.ts` after implementation. If both pass, backward compatibility is confirmed.

### R7: Test coverage gap for integration paths

**Risk**: The codebase has unit tests per module and a few integration tests (`plugin-augmentation`, `ssr-hydration`, `query-flow`), but there are no tests that exercise standalone hooks + snapshot hydration together, or devtools + resource lifecycle together. Changes across multiple fix areas could break integration paths not covered by existing tests. [ref: ../01-research/02-open-questions.md#q12]

**Mitigation steps**:
1. **New standalone hook test files** (`useResourceV2Agent.test.ts`, `useResourceV2Ref.test.ts`) cover the most critical new integration path: standalone hook → `ResourceV2.createAgent()` → `CacheEntry` → signal reactivity.
2. **Existing integration tests** cover the remaining paths: `query-flow.test.ts` (full lifecycle), `ssr-hydration.test.ts` (snapshot round-trip), `plugin-augmentation.test.ts` (plugin wiring).
3. **After all fixes are implemented**, run the full test suite as a final gate. Any untested integration path failure will surface here.
4. **DevTools integration** is not directly testable without a Redux DevTools mock. The `isDisabled: true` behavior is verified at the unit level (T23-T25) by checking signal constructor arguments. The devtools push behavior for `CacheEntry` is covered by existing tests that verify `beforeDevtoolsPush` callback invocation.

### R2: Core split breaks internal imports

**Risk**: Moving `CacheEntry.ts`, `CacheMap.ts`, `LifecycleHooks.ts` to `core/common/` and `ResourceV2.ts`, `ResourceV2Agent.ts` to `core/resource/` changes all internal import paths. Test files that use relative imports (e.g., `../CacheEntry`) will break. Cross-references between moved files (e.g., `ResourceV2` imports `CacheEntry`) need path updates.

**Mitigation steps**:
1. **TypeScript compiler is the primary safety net**: any broken import produces a compile error. Run `tsc --noEmit` after the file moves, before running tests.
2. **Systematic approach**: move files one sub-folder at a time. Move `common/` files first, update all `import` statements that reference them, verify compilation. Then move `resource/` files.
3. **Update `core/index.ts`** barrel to re-export from sub-folders. This is the only public contract — external consumers importing from `@/query-v2/core` see no change.
4. **Verification**: T14-T22 cover this comprehensively. T14 specifically validates all barrel exports resolve. T16-T21 verify all existing tests pass after the split.
