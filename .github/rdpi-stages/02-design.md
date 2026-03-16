# Stage: 02-Design

Design stage transforms research findings into a comprehensive, reviewable technical design. Every decision must trace back to facts from `01-research/`.


## Available Roles

| Role | Agent | Description | Default Limit |
|------|-------|-------------|---------------|
| Architect | `rdpi-architect` | Designs architecture, data flow, domain model, decisions, use cases, and documentation impact | max 2 invocations (split if complex), retry 2 |
| QA Designer | `rdpi-qa-designer` | Designs test strategy, verification criteria, and risk analysis | max 1 invocation, retry 1 |
| Design Reviewer | `rdpi-design-reviewer` | Reviews all design documents for consistency, completeness, and research traceability | max 1 invocation, retry 2 |


## Typical Phase Structure

| Phase | Agent | Outputs | Depends on | Parallelizable |
|-------|-------|---------|------------|----------------|
| 1 | `rdpi-architect` | `01-architecture.md`, `02-dataflow.md`, `03-model.md`, `04-decisions.md` | — | No |
| 2 | `rdpi-architect` | `05-usecases.md`, `07-docs.md` | 1 | No (needs architecture) |
| 3 | `rdpi-qa-designer` | `06-testcases.md`, `08-risks.md` | 1, 2 | No (needs architecture + use cases) |
| 4 | `rdpi-design-reviewer` | Updates `README.md` | 1, 2, 3 | No |

Phases are sequential by default. For simple features (< 3 components), phases 1 and 2 can be merged into a single architect phase (see Scaling Rules). Phase 4 is always last.


## Phase Prompt Guidelines

### Phase 1 — Core Architecture

The prompt MUST specify:
- Path to all research documents (../01-research/)
- What to design: system architecture (C4 Level 2–3), component boundaries, module responsibility zones, data flow for key scenarios, domain model (entities + types), ADR decisions
- Mermaid diagrams required: C4 container/component, module dependency, class/interface hierarchy, sequence diagrams, state diagrams
- ADR format: Status, Context, Options (with pros/cons), Decision, Consequences
- Reference: design choices must cite research findings

### Phase 2 — Use Cases & Documentation Impact

The prompt MUST specify:
- Path to architecture outputs from phase 1
- Use cases with TypeScript code examples and React integration patterns
- Edge cases and migration paths
- Documentation impact: what concepts need docs, what existing docs need updates, what examples to create
- Strict scope: describe WHAT needs documentation, not HOW. No JSDoc. Match existing rx-toolkit doc style.

<critical>
Warn the agent explicitly: docs.md must be SHORT and focused. Large docs.md is an anti-pattern. Only high-impact documentation changes.
</critical>

### Phase 3 — QA Strategy & Risks

The prompt MUST specify:
- Path to architecture and use case outputs
- Test strategy: unit, integration, e2e approach
- Test case table format: ID, Category, Description, Input, Expected Output, Priority
- Risk analysis table: ID, Risk, Probability (H/M/L), Impact (H/M/L), Strategy (Accept/Mitigate/Avoid), Mitigation
- Detailed mitigation plans for high-impact risks
- Performance test criteria (if applicable)

### Phase 4 — Design Review

The prompt MUST specify:
- Paths to ALL design documents (01 through 08)
- Path to research documents (for traceability check)
- Review criteria: research traceability, internal consistency, completeness, feasibility
- Quality review requirements: verify research traceability, ADR completeness, Mermaid conformance, test-risk coverage, docs proportionality, docs describe WHAT not HOW, no implementation code, research open questions addressed or deferred, risk analysis has actionable mitigations, internal consistency
- Write/update README.md with: overview, goals, non-goals, document links, key decisions summary, quality review checklist, next steps


## Output Conventions

- Frontmatter fields: phase outputs use (title, date, stage, role); README.md uses (title, date, status, feature, research)
- README.md structure: Overview, Goals, Non-Goals, Documents, Key Decisions, Quality Review, Next Steps
- ADR numbering: `ADR-1`, `ADR-2`, etc.
- Mermaid diagrams: titled, max 15–20 elements, split large diagrams
- All design choices must reference research documents via relative links


## Scaling Rules

- For simple features (< 3 components): phases 1 and 2 can be merged into a single architect phase
- For features without external API changes: `05-usecases.md` may be minimal, `07-docs.md` can be omitted
- If the feature is purely internal refactoring: `08-risks.md` and `06-testcases.md` can be combined into one phase
- Never exceed 6 total phases for design stage
