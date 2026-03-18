---
title: "Documentation Impact"
date: 2026-03-18
stage: 02-design
role: rdpi-architect
workflow: b0.2
---

# Documentation Impact

## `docs/CONTRIBUTING.md` — Updates Required

The existing `CONTRIBUTING.md` covers project structure, testing, and conventions but has **no section on development tools** (linting, formatting, editor setup) [ref: ../01-research/01-codebase-analysis.md#2-linting-status].

**Add a new section "Инструменты разработки"** (after "Тесты", before "Соглашения") covering:

1. **Lint/format commands** — `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`; brief note that `apps/demos/` has its own ESLint (`cd apps/demos && npx eslint src/`)
2. **Editor setup** — recommend Prettier + ESLint VS Code extensions; mention `editor.formatOnSave: true` for automatic formatting
3. **`.git-blame-ignore-revs`** — one-liner explaining the file exists and how to configure locally: `git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub handles it automatically)

Scope: ~15-20 lines of Markdown. Match the existing doc style (Russian language, command blocks, tables where appropriate).

## `README.md` — No Changes

`README.md` is user-facing (installation, features, usage). Tooling is internal to development — no changes needed.

## `package.json` Scripts — Self-Documenting

New scripts (`lint`, `lint:fix`, `format`, `format:check`) have conventional names. No extra documentation needed beyond the `CONTRIBUTING.md` section above.
