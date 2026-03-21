---
title: "Open Questions: Query v2 Fixes"
date: 2026-03-18
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: Should React hooks become standalone exports or remain resource methods?

**Context**: Currently hooks (`useResourceV2Agent`, `useResourceV2Ref`) are only accessible as methods on a plugin-augmented resource (e.g. `resource.useResourceV2Agent(args)`). Fix #1 requires they work without a plugin, and fix #2 requires they live in `react/`. The fundamental design question is whether hooks become top-level standalone functions (like v1's `useResourceAgent(resource, args)`) or remain attached to the resource object via a non-plugin mechanism.

**Options**:
1. **Standalone functions** (like v1) — `useResourceV2Agent(resource, args)` exported from `@/query-v2/react/`. Pros: Simple, no magic, tree-shakeable, mirrors v1 pattern. Cons: Breaking API change — consumers calling `resource.useResourceV2Agent(args)` must refactor. The resource type no longer carries hook methods.
2. **Auto-attached to resource** (no plugin required) — `createApi` always attaches hooks to every resource regardless of plugins. Pros: No consumer-facing API change. Cons: Couples core to React, adds React dependency even for non-React consumers, violates separation of concerns.
3. **Both** — Standalone exports in `react/` AND preserved resource method API via internal wiring (not plugin). Pros: Backward compatible + clean standalone path. Cons: Two ways to do the same thing, more surface area to maintain.

**Risks**: Choosing option 2 makes non-React consumers pay for React. Choosing option 1 is a breaking API change that affects all existing consumers. Choosing option 3 increases maintenance burden and may confuse users.

**Researcher recommendation**: The codebase analysis shows v1 uses standalone hooks. The research also shows `ReactHooksPlugin.augmentResource` simply returns `{ useResourceV2Agent, useResourceV2Ref }` — the hooks already receive `resource` and `options` as closure arguments from `augmentResource`, so refactoring to explicit parameters is straightforward. Option 1 aligns with v1 precedent but breaks current users; option 3 provides a migration path.

---

### Q2: What should happen to the plugin system after hooks are decoupled?

**Context**: `ReactHooksPlugin` is the only plugin in the codebase. If hooks move out, the plugin becomes either empty or unnecessary. The plugin system itself (`IPlugin`, `PluginContributionMap`, `PluginAugmentations`) has non-trivial type machinery in `plugin.types.ts`. Fix #1 specifically says hooks should work "without a plugin dependency" — but does this mean the plugin system should be removed entirely, deprecated, or kept for future extensibility?

**Options**:
1. **Remove plugin system entirely** — Delete `IPlugin`, `PluginContributionMap`, `PluginAugmentations`, `ReactHooksPlugin`, and the plugin wiring in `createApi.ts:38-76`. Pros: Less code, less complexity, no unused abstractions. Cons: Breaking change for consumers using `plugins: [ReactHooksPlugin]`; removes extensibility point.
2. **Keep plugin system, deprecate `ReactHooksPlugin`** — Hooks move to `react/`, plugin system remains for future use, `ReactHooksPlugin` gets a deprecation notice. Pros: Non-breaking for plugin infra, provides migration path. Cons: Dead code if no other plugins are planned.
3. **Keep plugin system and `ReactHooksPlugin` as thin wrapper** — `ReactHooksPlugin.augmentResource` delegates to the standalone hooks. Pros: Full backward compatibility. Cons: Extra indirection for no real benefit.

**Risks**: Removing the plugin system is a significant breaking change. Keeping it without use creates dead code. The answer also affects the `createApi` function signature (`plugins` option).

**Researcher recommendation**: The analysis confirms `ReactHooksPlugin` is the only consumer of the plugin interface, and `IPluginContext` (stored in `install()`) is currently unused. This suggests the plugin system was designed primarily for React hook attachment. Evidence leans toward removal or deprecation, but this depends on the project's extensibility roadmap.

---

### Q3: Will the core split (`common/`, `machines/`, `resource/`) change public import paths?

**Context**: Fix #3 requires splitting `core/` into three sub-folders. Currently the core barrel (`core/index.ts`) re-exports everything flat. If sub-folders get their own barrel exports AND the top-level `core/index.ts` re-exports from them, external import paths don't change. But if the intent is that consumers import from sub-paths (e.g., `@/query-v2/core/resource/`), that's a new public API surface.

**Options**:
1. **Internal restructure only** — Move files into sub-folders, update `core/index.ts` to re-export from `./common`, `./machines`, `./resource`. No change to public API. Pros: Zero breaking change, cleaner internal organization. Cons: The split is invisible to consumers.
2. **Expose sub-path imports** — Allow `@/query-v2/core/common`, `@/query-v2/core/resource` as public entry points. Pros: Finer-grained imports, better tree-shaking potential. Cons: Larger public API, more paths to maintain, possible breaking if consumers currently deep-import `@/query-v2/core/CacheEntry`.

**Risks**: If consumers currently deep-import from `@/query-v2/core/CacheEntry` (bypassing the barrel), moving the file to `@/query-v2/core/common/CacheEntry` breaks those imports regardless. Need to verify if deep imports are used anywhere.

**Researcher recommendation**: The analysis shows `@/query-v2/index.ts` re-exports from `./core` barrel. Internal deep imports likely exist in tests and within the module. Option 1 is safer and still satisfies the requirement.

---

### Q4: What error behavior should `hydrateSnapshot` produce on failure?

**Context**: Fix #5 says "snapshot loading failure must produce an error." The analysis found three silent skip scenarios in `hydrateSnapshot`: version mismatch, key prefix mismatch, and unknown resource key. Currently these return/continue silently. The question is what constitutes a "failure" and what severity the error should have.

**Options**:
1. **Throw on all mismatches** — Version mismatch, prefix mismatch, unknown resource all throw. Pros: Strictest, nothing silently ignored. Cons: Version mismatch is expected during upgrades (old snapshot, new code) — throwing would crash the app on version bumps. Prefix mismatch may happen legitimately in multi-API setups.
2. **Throw on version mismatch, warn on others** — `console.warn` for prefix/resource mismatches, throw for version mismatch. Pros: Catches the most dangerous case. Cons: Version mismatch is arguably the LEAST dangerous (old data, just skip it).
3. **Return a result object with errors** — `hydrateSnapshot` returns `{ hydrated: number, skipped: number, errors: SnapshotError[] }` instead of `void`. Callers decide what to do. Pros: Most flexible, doesn't crash. Cons: Changes return type (breaking), forces callers to handle.
4. **Throw only on structural corruption** — Malformed snapshots or unrecognized machine status throw. Version/prefix/unknown resource just warn. Pros: Catches real bugs, tolerates expected mismatches. Cons: Needs definition of "structural corruption."

**Risks**: Throwing on version mismatch during normal version upgrades would cause runtime crashes in production. Not throwing on any failure means the original issue (silent failures) isn't addressed for the cases that matter.

**Researcher recommendation**: The analysis shows `Machine.fromSnapshot` already throws on unknown status (structural corruption). The silent skips are for version/prefix/resource mismatches. Option 4 seems safest: keep throws for structural issues, add warnings for skipped entries, and possibly a callback/return value for caller awareness.

---

### Q5: Does fix #4 (DevTools must not receive agent state logs) require any code change?

**Context**: The codebase analysis found that `ResourceV2Agent` does NOT push to devtools — it has zero devtools references. Agent's `_state$` is a `Signal.compute()` which is a derived signal and does not trigger `beforeDevtoolsPush`. The devtools only receive `CacheEntry` machine state transitions. This means the requirement might already be satisfied, OR the task description refers to something not captured by the analysis (e.g., `CacheEntry` logs that include agent-like state, or a future concern).

**Options**:
1. **No code change needed** — The current behavior already excludes agent state from devtools. Document this as verified. Pros: No risk of regression. Cons: The task author may have observed something the analysis missed.
2. **Add a guard** — Explicitly prevent agent-computed signals from having `beforeDevtoolsPush`, as a defensive measure. Pros: Future-proof. Cons: Unnecessary code for a non-problem.
3. **Filter CacheEntry devtools pushes** — Perhaps the intent is that certain fields of `CacheEntry` machine state (like `patches`, `originalData`) should be filtered from devtools. Pros: Cleaner devtools output. Cons: Changes what users see in devtools.

**Risks**: If the requirement refers to something not found in the analysis, implementing "no change needed" leaves a real bug unfixed. Conversely, adding unnecessary guards adds complexity.

**Researcher recommendation**: This requires clarification from the task author. The analysis is clear: agent state is NOT pushed to devtools. Either the requirement is preventative, refers to a different layer, or there's a runtime behavior not visible in static analysis.

---

## Medium Priority

### Q6: What scope of "key code locations" should receive JSDoc?

**Context**: Fix #6 says "key code locations must have JSDoc comments." The analysis catalogued JSDoc coverage — types have ~100% coverage, but implementation files (classes, methods) are sparse. The question is what the boundary of "key" is.

**Options**:
1. **Public API only** — `createApi`, exported functions from `index.ts`, and types used by consumers. Pros: Minimal effort, highest impact. Cons: Internal critical paths (machines, `CacheEntry`) remain undocumented.
2. **Public API + class-level JSDoc on all core classes** — Every class (`ResourceV2`, `CacheEntry`, `ResourceV2Agent`, all machine classes) gets at least a top-level JSDoc, plus all public methods. Pros: Good balance. Cons: Moderate effort.
3. **Everything undocumented** — Every function/method/class without JSDoc gets one. Pros: Complete. Cons: Significant effort, many JSDoc comments on obvious helpers add noise.

**Risks**: Under-documenting leaves new contributors confused. Over-documenting creates maintenance burden where JSDoc drifts from implementation.

**Researcher recommendation**: The analysis shows that `ResourceV2` is partially documented (11 of 18 methods) and the undocumented methods are the most critical ones (`createAgent`, `query`, `query$`, `entry`). Option 2 provides the best value: class-level JSDoc on all classes + JSDoc on currently-undocumented public/protected methods.

---

### Q7: Should the three documentation files describe the snapshot-during-optimistic-update behavior identically, or with different focus?

**Context**: Fix #7 requires `optimistic-updates.md`, `api-reference.md`, and `ssr.md` to document what's in a snapshot during optimistic updates. The analysis found that `ssr.md` already partially covers snapshot limitations. The question is how to distribute the information.

**Options**:
1. **Each file gets a full description** — Every file independently explains snapshot contents during optimistic updates. Pros: Each doc is self-contained. Cons: Triplication, drift risk.
2. **Canonical section in `ssr.md`, cross-references in others** — Full detail in `ssr.md` (the snapshot-focused doc), with `optimistic-updates.md` and `api-reference.md` linking to it with a brief summary. Pros: Single source of truth, DRY. Cons: Reader must follow links.
3. **Canonical section in `optimistic-updates.md`, cross-references in others** — Since the behavior is primarily about what happens during optimistic updates, that doc owns the detail. Pros: Matches the conceptual context. Cons: `ssr.md` (where snapshot details live) becomes less self-contained.

**Risks**: Duplicated content across three files will inevitably drift. But cross-references may be missed by readers consulting only one doc.

**Researcher recommendation**: The analysis shows `ssr.md` already has a limitations section mentioning patches are excluded. `optimistic-updates.md` has no snapshot mention at all. Option 3 or a hybrid (detail in `optimistic-updates.md`, enhance existing limitations in `ssr.md`, reference from `api-reference.md`) seems most natural.

---

### Q8: What are the cross-dependencies between fixes #1, #2, and the plugin system?

**Context**: Fixes #1 (hooks without plugin), #2 (hooks in `react/`), and potentially #Q2 (plugin system fate) are tightly coupled. The implementation order and scope of each affects the others. For example, if hooks are first moved to `react/` (fix #2) and then made standalone (fix #1), the intermediate state matters for the PR structure.

**Options**:
1. **Merge fixes #1 and #2 into a single change** — Move hooks to `react/` as standalone functions in one step. Pros: No awkward intermediate state. Cons: Larger single change, harder to review.
2. **Fix #2 first (move to `react/`), then fix #1 (decouple from plugin)** — First physical move, then logical decoupling. Pros: Each step is reviewable. Cons: Intermediate state may have hooks in `react/` but still plugin-dependent.
3. **Fix #1 first (make standalone), then fix #2 (move to `react/`)** — First make hooks standalone functions, then move them. Pros: Decoupling is the harder logic change, move is trivial after. Cons: Hooks might briefly live in `plugins/` as standalone exports (odd location).

**Risks**: Choosing the wrong order creates confusing intermediate states that may ship if the work is split across PRs. Merged fixes risk a too-large PR.

**Researcher recommendation**: Given the hooks file is only 130 lines, option 1 (single change) is practical and avoids intermediate states. If PRs must be granular, option 3 is logical: decouple first (the meaningful change), move second (the trivial rename).

---

### Q9: Do existing consumers deep-import from `@/query-v2/core/` sub-paths?

**Context**: Fix #3 moves files inside `core/` into sub-folders. If any code outside `query-v2` imports directly from `@/query-v2/core/CacheEntry` (bypassing the barrel), the file move would be a breaking change. The analysis lists internal references but doesn't exhaustively verify external deep imports.

**Options**:
1. **Only barrel re-exports are public** — Treat any deep import as unsupported. Move files freely. Pros: Clean boundary. Cons: May break users who deep-import anyway.
2. **Verify and preserve all existing deep import paths** — Search the full codebase (including apps, tests) for deep imports. Re-export from old paths if needed. Pros: No breakage. Cons: Legacy path maintenance.

**Risks**: Undetected deep imports in monorepo apps or tests would break at build time. If this library is published, external consumers may also deep-import.

**Researcher recommendation**: A workspace-wide search for `query-v2/core/` imports (excluding the barrel) should resolve this question definitively before implementation.

---

## Low Priority

### Q10: Should `CacheEntry`'s `beforeDevtoolsPush` have a filtering/opt-out mechanism?

**Context**: Related to fix #4. Currently every `CacheEntry` pushes machine state to devtools via `beforeDevtoolsPush`. For large applications with many resources, this could be noisy. The analysis shows a user-provided `beforeDevtoolsPush` can compose with the default, but there's no built-in way to disable devtools per-resource.

**Options**:
1. **No change** — Current opt-in composition via `ResourceV2Config.beforeDevtoolsPush` is sufficient. Pros: Simple. Cons: No opt-out.
2. **Add `devtools: false` option to `ResourceV2Config`** — Allows disabling devtools per-resource. Pros: Useful for noisy resources. Cons: Scope creep beyond fix #4.

**Risks**: This is a nice-to-have that could be deferred. Adding it now alongside fix #4 muddies the fix scope.

**Researcher recommendation**: Defer unless explicitly requested. The current composition mechanism allows `beforeDevtoolsPush: () => undefined` as a workaround to suppress pushes.

---

### Q11: Should JSDoc comments reference the RFC or design docs?

**Context**: Fix #6 adds JSDoc. Some teams link JSDoc to external design documents or RFCs for deeper context. The query-v2 module has associated RFC documentation in `docs/query-v2/`.

**Options**:
1. **Self-contained JSDoc** — Each JSDoc explains the API without external links. Pros: No broken links, standalone. Cons: Can't convey full design rationale.
2. **JSDoc with `@see` links** — Reference `docs/query-v2/README.md` or specific sections. Pros: Rich context. Cons: Links may break if docs move.

**Risks**: Minimal — this is a stylistic choice.

**Researcher recommendation**: Use self-contained JSDoc with `@see` references only for complex concepts like snapshot hydration or optimistic update flow where the docs provide essential context.

---

### Q12: Are there integration tests that span multiple fix areas?

**Context**: The analysis mentions unit tests per area (e.g., `Snapshot.test.ts`, `ReactHooksPlugin.test.ts`, `plugin-augmentation.test.ts`) but does not catalogue integration tests that might exercise multiple systems together (e.g., hooks + snapshot hydration, or devtools + resource lifecycle). Changes across multiple fix areas could break integration paths not covered by unit tests.

**Options**:
1. **Verify existing integration test coverage before implementation** — Run the test suite, identify integration tests, map them to fix areas. Pros: Prevents surprises. Cons: Research cost.
2. **Implement fixes and rely on CI** — Let the test suite catch regressions. Pros: Faster. Cons: Missing integration tests won't catch regressions.

**Risks**: Low — the fixes are mostly additive (JSDoc, docs) or structural (file moves), with the snapshot error handling being the most logic-change-heavy item.

**Researcher recommendation**: The test file at `@/query-v2/__tests__/integration/plugin-augmentation.test.ts` is directly affected by fixes #1 and #2. It should be reviewed before implementation. Other integration tests (if any) in `@/__tests__/integration/` should be checked for query-v2 coverage.

---

## User Answers

### Q1: Should React hooks become standalone exports or remain resource methods?
**Decision**: Основной вариант — плагин (`resource.useResourceV2Agent`), но импорт и использование хука без плагина ТАКЖЕ должен поддерживаться (standalone export). Плагин не всегда нужен, а правка минимальна.

### Q2: What should happen to the plugin system after hooks are decoupled?
**Decision**: НЕ удалять plugin system. Оставить как есть.

### Q3: Will the core split change public import paths?
**Decision**: Внутренний рефактор. Public import paths не меняются — `core/index.ts` реэкспортирует из поддиректорий.

### Q4: What error behavior should `hydrateSnapshot` produce on failure?
**Decision**: Throw на version/key несовпадении. Warn для остальных кейсов, если они есть.

### Q5: Does fix #4 (DevTools must not receive agent state logs) require any code change?
**Decision**: ДА, код нужен. Agent state ПОПАДАЕТ в devtools — `ResourceV2Agent` содержит `Signal.state` и `Signal.compute`, в которых нужно отключить логгирование. Исследование ошиблось в выводе по этому пункту.

### Q6: What scope of "key code locations" should receive JSDoc?
**Decision**: Public API + обычные комментарии в ключевых местах (где происходит магия).

### Q7: Should the three documentation files describe snapshot-during-optimistic-update behavior identically?
**Decision**: Найти существующее место в документации, где описывается поведение snapshot (но не упоминается optimistic update), и дополнить его информацией об optimistic update поведении.

### Q8: What are the cross-dependencies between fixes #1, #2, and the plugin system?
**Decision**: На усмотрение — порядок выполнения определить на этапе дизайна/плана.

### Q9: Do existing consumers deep-import from `@/query-v2/core/` sub-paths?
**Decision**: Только barrel публичный. Deep imports не поддерживаются — перемещаем свободно.

### Q10: Should `CacheEntry`'s `beforeDevtoolsPush` have a filtering/opt-out mechanism?
**Decision**: Без изменений. Текущего механизма достаточно.

### Q11: Should JSDoc comments reference the RFC or design docs?
**Decision**: JSDoc + `@see` ссылки на docs для сложных концепций.

### Q12: Are there integration tests that span multiple fix areas?
**Decision**: Проверить заранее перед имплементацией.
