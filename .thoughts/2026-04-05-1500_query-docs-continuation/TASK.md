---
title: "Query Docs Rewrite — Continuation"
date: 2026-04-05
stage: 04-implement
status: Active
parent: 2026-04-05-1400_query-docs-rewrite
---

# Query Docs Continuation

Continuation of the query module documentation rewrite. Previous task completed P0 files and started P1.

## Completed (previous task)
- [x] docs/query/README.md (landing page)
- [x] docs/query/concepts/architecture.md
- [x] docs/query/concepts/machine.md (user-edited to 4 states, refresh-error → agent-level)
- [x] docs/query/concepts/cache.md (Resource + Command)
- [x] docs/query/api/README.md (createApi ref)
- [x] docs/query/api/resource.md
- [x] docs/query/api/command.md
- [x] docs/query/usage/resource.md (dedup)
- [x] docs/query/usage/command.md (dedup)

## Remaining P1
- [ ] docs/query/concepts/agent.md
- [ ] docs/query/concepts/patching.md
- [ ] docs/query/usage/links.md
- [ ] docs/query/usage/lifecycle.md
- [ ] docs/query/usage/snapshot.md
- [ ] docs/query/usage/broadcast.md

## Remaining P2
- [ ] docs/query/usage/plugins.md
- [ ] docs/query/usage/devtools.md

## Key references
- Common mistakes: `../.thoughts/2026-04-05-1400_query-docs-rewrite/common-mistakes.md` (12 rules)
- User decisions: `../.thoughts/2026-04-05-1400_query-docs-rewrite/user-decisions.md`
- Docs ToC: `../.thoughts/2026-04-05-1400_query-docs-rewrite/docs-toc.md`
- Moved flow diagrams (for agent.md): `../.thoughts/2026-04-05-1400_query-docs-rewrite/moved-flow-diagrams.md`
- Agent quota: `../.thoughts/2026-04-05-1400_query-docs-rewrite/agent-quota.md`

## Agent quota
Continued from 57. Min: 60, Max: 250.
