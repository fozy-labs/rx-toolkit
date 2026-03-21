---
title: "Design: Repository Tooling Setup"
date: 2026-03-18
status: Approved
feature: "Configure test typing, linting, formatting, and AI instructions for apps/demos"
research: "../01-research/README.md"
rdpi-version: "b0.2"
---

## Overview

Design the configuration architecture for four development tooling areas: vitest test typing via `tsconfig.test.json`, ESLint flat config with separate configs for `src/` and `apps/demos/`, Prettier with `@ianvs/prettier-plugin-sort-imports` and `.editorconfig`, and a single AI instruction file for `apps/demos/`. All decisions incorporate user answers from the research stage's open questions.

## Goals

- Define exact config file layout, content specifications, and tool interaction model
- Record ADRs for all discretionary decisions (Q5, Q8, Q9, Q10)
- Specify migration paths (initial formatting pass, vitest import removal)
- Design AI instruction file content for apps/demos workflows
- Identify verification criteria and risks

## Non-Goals

- Implementation (deferred to 03-plan and 04-implement)
- Linting rule-by-rule tuning (initial config uses presets; tune post-adoption)
- CI pipeline design (out of scope for this feature)

## Documents

- [Architecture](./01-architecture.md)
- [Data Flow](./02-dataflow.md)
- [Domain Model](./03-model.md)
- [Decisions](./04-decisions.md)
- [Use Cases](./05-usecases.md)
- [Test Cases](./06-testcases.md)
- [Documentation and Examples](./07-docs.md)
- [Risks](./08-risks.md)

## Key Decisions

- **ADR-1**: Import sorting via `@ianvs/prettier-plugin-sort-imports` Prettier plugin (user decision), not ESLint rule.
- **ADR-2**: Fully independent ESLint configs for `src/` (strict) and `apps/demos/` (recommended) with no shared base.
- **ADR-3**: Prettier formatting scoped to `src/` only; `apps/demos/` excluded via `.prettierignore`.
- **ADR-4**: Single formatting commit with `.git-blame-ignore-revs` for clean git blame history.
- **ADR-5**: `typescript-eslint` `strict` preset without `stylistic` — correctness-focused for a published library.
- **ADR-6**: Skip `eslint-plugin-import-x` — TypeScript handles resolution; Prettier handles ordering.
- **ADR-7**: Remove unused `@testing-library/jest-dom` from devDependencies.
- **ADR-8**: `tsconfig.test.json` extending root tsconfig with `types: ["vitest/globals"]` for clean test typing.

## Quality Review

### Checklist

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Design decisions trace to research findings | PASS | All 8 ADRs cite specific research documents via `[ref: ...]` links. All 14 user answers from Q1–Q14 are correctly reflected in architecture, model, and decisions. |
| 2 | ADRs have Status, Context, Options, Decision, Consequences | PASS | All 8 ADRs have all required sections. Options include pros/cons for each alternative. |
| 3 | Mermaid diagrams present and conformant | PASS | 6 diagrams across architecture and dataflow. All titled, all under 15 elements. Syntactically valid (graph, sequenceDiagram). |
| 4 | Test strategy covers identified risks | PASS | All 14 risks in `08-risks.md` have corresponding test cases or verification steps in `06-testcases.md`. R01→T05, R02→T18, R04→T04/T09, R05→T20, R06→T22/T23, R07→T01, R11→T02, R12→T04/T09, R13→T21. Low-impact accept-strategy risks (R08, R09, R10) have performance criteria or are intentionally accepted. |
| 5 | docs.md is concise and proportional to existing docs/demos | PASS | Proposes ~15–20 lines added to `CONTRIBUTING.md` only. No README.md changes. Proportional to existing substantial documentation in `docs/`. |
| 6 | docs.md describes WHAT not HOW (no JSDoc, no full drafts) | PASS | Specifies three content topics (commands, editor setup, git-blame-ignore-revs) with estimated scope. No full text drafts or JSDoc. |
| 7 | No implementation details or code | PASS | Architecture and use cases are design-level. `03-model.md` contains detailed config specifications that resemble implementation (inherent for config-only tasks). A clarifying note has been added to the top of `03-model.md` stating configs are illustrative and may be adjusted during implementation. Acceptable. |
| 8 | Research open questions addressed or deferred | PASS | All 14 open questions addressed: Q1–Q4, Q6–Q7, Q11–Q14 via user decisions reflected in design; Q5, Q8, Q9, Q10 via ADRs 4–7 with rationale. No question left unresolved. |
| 9 | Risk analysis has actionable mitigations for high-impact risks | PASS | High-impact risks (R02, R04, R05) have specific multi-step mitigation plans in the "Detailed Mitigation Plans" section. Each mitigation includes concrete commands and fallback options. |
| 10 | Internal consistency (arch/dataflow/model/usecases) | PASS | Resolved in Redraft Round 1. Architecture and model now agree: test files are in global `ignores` and not linted by the root ESLint config. All cross-document references are consistent — dataflow (CI pipeline), use cases (UC-2, UC-10), test cases (T07), and risks (R01) all align with this approach. |

### Documentation Proportionality

The existing `docs/` directory is substantial: `CONTRIBUTING.md`, `CHANGELOG.md`, plus subdirectories for signals, query, query-v2, devtools, options, usage, migrations, and contributing guides. The `apps/demos/` has its own Vite app structure but no dedicated documentation beyond inline code.

`07-docs.md` proposes adding ~15–20 lines to `CONTRIBUTING.md` covering lint/format commands, editor setup, and `.git-blame-ignore-revs`. This is appropriate — adding development tooling to a project with substantial existing documentation warrants a brief contributing section, not a new standalone doc. No over-specification or under-specification detected.

### Issues Found

1. ~~**Inconsistency: test file linting strategy between architecture and model**~~ — **RESOLVED (Redraft Round 1).** Architecture section 5 updated to list test files in ignore patterns instead of describing relaxed-rule overrides. Both `01-architecture.md` and `03-model.md` now agree: test files are globally ignored by the root ESLint config, not linted. Verified consistent with `02-dataflow.md`, `05-usecases.md` (UC-2, UC-10), `06-testcases.md` (T07), and `08-risks.md`.

2. **Potentially incorrect import path: `eslint-config-prettier/flat`** — **DEFERRED to implementation.** `03-model.md` sections 5 and 6 import `eslint-config-prettier` via `from "eslint-config-prettier/flat"`. The `/flat` subpath may or may not exist in `eslint-config-prettier` v10+. This is an implementation-time verification item — verify the correct import path when installing the package. No design change needed.
   - **Where**: `03-model.md`, sections 5 and 6 — ESLint config import statements
   - **Severity**: Low

3. ~~**Model contains near-complete implementation code**~~ — **RESOLVED (Redraft Round 1).** A clarifying note added to the top of `03-model.md`: *"The configurations below are illustrative design specifications. Exact contents may be adjusted during the implementation stage."* Acceptable for a config-only task where the specification/implementation boundary is inherently thin.

## Next Steps

All critical and medium issues resolved. One low-severity issue (#2, `eslint-config-prettier/flat` import path) deferred to implementation-time verification. Design is ready to proceed to the Plan stage.
