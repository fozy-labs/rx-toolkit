---
title: "Open Questions: Query Docs Rewrite"
date: 2026-04-05
stage: 01-research
role: rdpi-questioner
---

## Part 1 — Documentation Gap Analysis

### Completely missing topics (no doc page exists)

- **Cache system** — `CacheEntry`, `CacheMap`, eviction/GC lifecycle, `resetOnRefCountZero` timer, `cacheRetentionTime` semantics. Research found a full subsystem; zero doc coverage.
- **Plugin architecture** — `IPlugin` interface, `install()` / `augmentResource()` contract, type-level augmentation pattern, writing custom plugins. Only a one-line mention in API README.
- **Snapshot / SSR hydration** — `getSnapshot()`, `hydrateSnapshot()`, `initialSnapshot`, `maxSnapshotDataAge`, version checks. API README lists the option but no usage page (link to `../usage/snapshot.md` is dead).
- **Broadcast / sync driver** — `syncDriver`, `ISyncDriver`, cross-tab sync. RFC file is a TODO stub only; linked from API README as `../usage/broadcast.md` (dead link).
- **Optimistic updates & patching** — `createPatch`, `finishPatch`, `Patcher`, `TPatchState`, consistency violation recovery. Briefly shown in command `links` examples but the underlying system is undocumented.
- **`SKIP` / `SKIP_TOKEN`** — conditional fetching. Mentioned in resource doc inline but no dedicated explanation of semantics, idle state, or typing.
- **Agent concept** — `ResourceAgent`, `CommandAgent`, `createAgent()`, `state$`, SWR cross-entry observation. Brief paragraphs in usage pages but no standalone concept doc.
- **`stableStringify`** and arg serialization — default serializer, limitations (no Date/Map/Set/RegExp), custom `serializeArgs`.
- **Error handling patterns** — retry, `lastError` on refresh-error→success, abort on unmount.
- **DevTools integration** — `key` option, devtools config, `reduxDevtools`. Exists in codebase; zero doc mention.

### Poorly covered / incomplete topics

- **Command system** — decently documented but missing: `CommandCacheEntry` internals, auto-key (sid) generation, `createAgent()` for commands, imperative key behavior.
- **Machine doc vs code mismatch** — doc shows 5 states including `refresh-error`; code has 4 states (error-on-refresh goes to `MachineSuccess` with `lastError`). `lastError` field not in doc type definitions.
- **Lifecycle hooks** — `onCacheEntryAdded` / `onQueryStarted` shown but shallow: no explanation of `PromiseResolver` semantics, rejection on supersede, error swallowing, or entry access for manual cache updates.
- **Links** — `link()` mechanism documented for commands but missing: how `forwardArgs` maps to cache keys, multi-entry invalidation, timing of optimistic rollback.
- **`getEntry` / `getEntry$`** — listed in API tables; reactive context requirements and `doInitiate` flag deserve more explanation.
- **`compareArg` strategy** — mentioned in code research; no doc coverage at all.

### Structural / cross-cutting gaps

- No **architecture overview** explaining how API → Resource → CacheMap → CacheEntry → Machine fit together.
- No **glossary** defining terms: entry, machine, agent, patch, snapshot, link, plugin.
- No **migration guide** for the rewrite (existing `docs/migrations/` covers older versions).

---

## Part 2 — Design Questions

## High Priority

### Q1: Should docs describe current implementation or target (rewritten) design?

**Context**: User stated "new docs will serve as the spec for rewriting the module itself" and "current code, tests, and examples are NOT authoritative." This means docs could freeze current behavior or define a new target.

**Options**:
1. **Document target design** — docs are the spec, code will be rewritten to match. Pros: clean slate / Cons: need design decisions _before_ writing docs.
2. **Document current behavior, then annotate changes** — capture as-is, mark sections for redesign. Pros: nothing lost / Cons: two-pass effort, reader confusion.

**Risks**: If target design, undecided questions block every doc page. If current behavior, docs become obsolete immediately after rewrite.

**Researcher recommendation**: Evidence points to option 1 (user explicitly said docs = spec). But specific design divergences need to be declared (see Q2–Q5).

---

### Q2: What is the language for the new docs — Russian or English?

**Context**: All existing docs are in Russian. The codebase, types, and code comments are in English. Research files are in English.

**Options**:
1. **Russian** — continuity with existing docs.
2. **English** — matches code, broader audience, simpler for AI-assisted generation.

**Risks**: Mixed-language docs confuse contributors. Switching mid-project is expensive.

---

### Q3: Which concrete design changes are planned for the rewrite?

**Context**: Research revealed several code-vs-doc mismatches and architectural patterns that look intentional but may be targets for change. Key areas:

- **Machine states**: code has 4 states (no `refresh-error`), doc shows 5. Which is the target?
- **`lastError` field**: exists in code, absent from doc types. Keep or drop?
- **Command cache key model**: auto-generated `sid` — keep, simplify, or make explicit?
- **Plugin type augmentation**: current `Object.assign` + conditional types — keep or redesign?
- **Cache eviction**: currently RxJS `share`+`resetOnRefCountZero` — keep or switch to explicit subscription counting?

**Risks**: Writing docs without knowing planned changes wastes effort on sections that will change.

---

### Q4: Should Command have its own concept doc or stay merged with Resource?

**Context**: Research found no `CommandCacheEntry` analysis (out of scope for researchers). Commands share the same machine and cache infrastructure but with different key semantics (auto-sid vs serialized args), no `refresh`, no `SKIP`. Current docs have separate usage pages but no concept-level coverage.

**Options**:
1. **Shared concepts, separate usage** — one "cache entry" concept doc, two usage guides.
2. **Fully separate** — independent concept + usage for each.
3. **Unified with sections** — one long doc with resource/command subsections.

**Risks**: Merging too much obscures command-specific behavior; splitting too much creates repetition.

---

### Q5: What level of detail for internal vs public API?

**Context**: Research produced deep analysis of `Patcher`, `CacheEntry`, `CacheMap`, `Snapshot` internals. These are not user-facing. Docs could expose them at different depths.

**Options**:
1. **Public API only** — document `createApi`, `createResource`, `createCommand`, hooks, `link()`, lifecycle. Internals as opaque.
2. **Public + concept docs for internals** — explain machine, patcher, cache model conceptually without exposing class API.
3. **Full internal API reference** — document every class and method for contributors.

**Risks**: Option 1 leaves advanced users guessing; option 3 couples docs to implementation that will change.

**Researcher recommendation**: Option 2 aligns with existing `concepts/machine.md` pattern — explain _behavior_, not _classes_.

---

## Medium Priority

### Q6: Should the new docs cover the broadcast/sync system or defer it?

**Context**: `broadcast-RFC.md` is a TODO stub. `syncDriver` is an API option. Code may have partial implementation. It's unclear whether this feature ships in the rewrite or is deferred.

**Options**:
1. **Include in docs** — write spec for sync driver, document API surface.
2. **Defer** — remove `syncDriver` from API options doc, add to roadmap.

**Risks**: Documenting unfinished features sets wrong expectations. Omitting it means no spec if it's needed soon.

---

### Q7: What is the target doc structure / table of contents?

**Context**: Current structure is `api/README.md` + `concepts/machine.md` + `usage/{resource,command}.md`. Gap analysis shows ~10 missing topics. Need to decide organization before writing.

**Options**:
1. **Current structure + new pages**: add `concepts/cache.md`, `concepts/agent.md`, `usage/snapshot.md`, `usage/plugins.md`, etc.
2. **Flat restructure**: single-level directory, one file per major topic.
3. **Tutorial-style**: getting started → core concepts → advanced → API reference.

**Risks**: Wrong structure means reorganization later; too deep nesting hurts discoverability.

---

## Low Priority

### Q8: Should `SKIP` be renamed or documented as `SKIP_TOKEN`?

**Context**: Code exports both `SKIP` (the symbol) and `SKIP_TOKEN` (the type). Docs use `SKIP`. User-facing naming inconsistency is minor but affects import ergonomics.

**Options**:
1. **Keep both** — `SKIP` as value, `SKIP_TOKEN` as type (current).
2. **Unify naming** — e.g., export only `SKIP` as both value and type.

**Risks**: Minimal; but naming settled now avoids churn in the rewrite.
