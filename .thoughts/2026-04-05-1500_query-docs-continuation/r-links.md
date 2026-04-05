---
stage: 01-research
type: fact-sheet
topic: resource/command links
sources: docs + source code
---

# Links — Facts

## What is a Link
- Declarative connection between a **Command** (mutation) and one or more **Resources** (queries)
- Defined on the Command via `links: [resource.link(config), ...]`
- `link()` is a method on the **Resource** instance that returns a `TLinkDeclaration`
- Glossary definition: "declarative connection between resource/command: refresh, optimistic update"

## Link Configuration Options (from docs/query/usage/command.md)
| Option | Type | Required | Description |
|---|---|---|---|
| `forwardArgs` | `(commandArgs) => resourceArgs` | **yes** | Maps command args → resource cache-key args |
| `invalidate` | `boolean` | no | Mark resource cache stale after command succeeds |
| `optimisticUpdate` | `(draft, commandArgs) => void` | no | Immer-style patch applied **before** server responds; auto-rollback on error |
| `update` | `(draft, commandArgs, result) => void` | no | Immer-style patch applied **after** server responds (uses result data) |

## forwardArgs Details
- Required in every link config
- `() => undefined` means "target every cache entry" (e.g. list invalidation)
- `(args) => args.userId` means "target the specific cache entry keyed by userId"

## Trigger Timing (from docs)
- `invalidate` — fires after command **succeeds** (entry re-fetched on next access)
- `optimisticUpdate` — fires **immediately** when command starts (before server response)
- `optimisticUpdate` rollback — automatic on command **error**
- `update` — fires after command **succeeds**, receives `result`
- `optimisticUpdate` + `invalidate` can be combined in one link (optimistic first, invalidate after success)

## Multi-Entry Invalidation Patterns (from docs)
- `forwardArgs: () => undefined` targets all existing cache entries of the resource
- Multiple links can target different resources in one command
- Example: addTodo command links to todosResource with `forwardArgs: () => undefined, invalidate: true`

## Code-Based Findings [CODE-ONLY]
- **Command class does NOT exist in source** — only Resource is implemented (`src/query/core/resource/`)
- **`link()` method not found in source code** — not on Resource, not in types
- `IResource` interface has no `link` method; `TResourceOptions` has no `links` field
- `createApi` only exposes `createResource`, not `createCommand`
- API types (`api.types.ts`) define `IApi` with only `createResource`, `resetAll`, `getSnapshot`
- The docs describe `link()` as an existing API method on Resource (api/resource.md "Methods" table)
- **Conclusion: links/commands are documented but not yet implemented in code**

## Existing Related Primitives [CODE-ONLY]
- `resource.invalidate(args)` — exists, transitions success → refreshing
- `entry.createPatch(fn)` — exists, returns `IPatchHandle` with `abort()`/`commit()`
- Patcher system is implemented (Immer-based optimistic patches with rollback)
- These are the building blocks that links will likely compose

## Ordering / Timing Notes
- Docs don't specify ordering when multiple links fire for the same command
- No mention of abort-triggered link actions — links appear to fire only on success/error
- `cacheRetentionTime` for commands defaults to `0` (vs `60_000` for resources)

## Open Gaps
- No `links.md` doc exists (referenced in glossary as `../usage/links.md` but file missing)
- No type definition for `TLinkDeclaration` or `LinkEntry` in source
- No docs on what happens when `forwardArgs` returns args that have no cache entry yet
- No docs on link behavior during concurrent commands to the same resource
