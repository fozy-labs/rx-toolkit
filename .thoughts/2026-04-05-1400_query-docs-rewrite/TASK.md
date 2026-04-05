# Task: Query Module Documentation Rewrite

## Goal
Write modern, comprehensive documentation (including architecture/design) for the `query` module of rx-toolkit. This documentation will serve as the specification from which the module itself will be rewritten in the future.

**Important**: The current query module code, tests, and examples are NOT authoritative — the new docs define the target state.

## Scope
- Architecture & design docs (state machine, cache, resource lifecycle, plugin system)
- API reference (createApi, createResource, command, agent, snapshot, etc.)
- Usage guides (resource, command, lifecycle hooks, links, SSR/snapshot, broadcast sync)
- Concept docs (machine states, cache retention, serialization, SWR, patching)
- Migration / changelog notes as needed

## Existing State
- `docs/query/` has partial Russian-language docs: api/README.md, concepts/machine.md, usage/command.md, usage/resource.md, broadcast-RFC.md
- Source in `src/query/` — core (Machine, CacheEntry, CacheMap, Resource, ResourceAgent, Snapshot), api (createApi, _createResource), types (10 type files), plugins (ReactHooksPlugin), react (useResourceAgent), lib (SKIP_TOKEN, stableStringify)
- User removed old docs and is drafting new ones — existing docs are partial new drafts

## Approach
- Work in micro-pipelines (research → draft → review → adjust)
- Ask user for clarifications at each milestone via vscode_askQuestions
- Track common mistakes in `common-mistakes.md`
- Store working files in this task directory

## Constraints
- Docs language: Russian (matching existing docs)
- `.thoughts/` files: English
- User I/O: Russian
- Subagent quota: 60–250
