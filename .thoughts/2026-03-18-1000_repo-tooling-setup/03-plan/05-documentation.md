---
title: "Phase 5: Documentation"
date: 2026-03-18
stage: 03-plan
role: rdpi-planner
---

## Goal

Update `docs/CONTRIBUTING.md` to document the new development tooling (lint/format commands, editor setup, `.git-blame-ignore-revs`). After this phase, contributors have clear guidance on using the new tools.

## Dependencies

- **Requires**: Phase 2 (ESLint — lint commands are accurate), Phase 4 (Formatting Migration — `.git-blame-ignore-revs` is set up)
- **Blocks**: None (final functional phase)

## Execution

Sequential — last because documented commands must reflect the actual final state.

## Tasks

### Task 5.1: Add "Инструменты разработки" section to `docs/CONTRIBUTING.md`

- **File**: `docs/CONTRIBUTING.md`
- **Action**: Modify
- **Description**: Add a new section "Инструменты разработки" between the existing "Тесты" section (line ~125) and "Соглашения" section (line ~140). The section documents lint/format commands, editor setup recommendations, and `.git-blame-ignore-revs` usage. Content is in Russian, matching existing documentation style.
- **Details**:
  - **Subsection 1: Commands** — document `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`; note that `apps/demos/` has separate linting: `cd apps/demos && npx eslint src/`
  - **Subsection 2: Editor setup** — recommend VS Code extensions: Prettier (`esbenp.prettier-vscode`) and ESLint (`dbaeumer.vscode-eslint`); mention `editor.formatOnSave: true` for automatic formatting on save
  - **Subsection 3: Git blame** — explain `.git-blame-ignore-revs` exists to skip the initial formatting commit in blame; document the local config: `git config blame.ignoreRevsFile .git-blame-ignore-revs`; note GitHub handles this automatically
  - Scope: ~15–20 lines of Markdown
  - Style: Russian language, command blocks with `bash` syntax highlighting, match existing section formatting
  - [ref: ../02-design/07-docs.md]

## Verification

- [ ] `docs/CONTRIBUTING.md` contains the new "Инструменты разработки" section
- [ ] All four commands (`lint`, `lint:fix`, `format`, `format:check`) are documented
- [ ] `.git-blame-ignore-revs` usage instruction is present
- [ ] Section is placed between "Тесты" and "Соглашения" in the document structure
- [ ] `npm run ts-check` still passes (compilability invariant — no code changed)
