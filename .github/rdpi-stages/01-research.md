# Stage: 01-Research

Research stage gathers facts about the codebase and ecosystem. No solutions, no opinions — only verifiable information.


## Available Roles

| Role | Agent | Description | Default Limit |
|------|-------|-------------|---------------|
| Codebase Analyst | `rdpi-codebase-researcher` | Traces code paths, maps dependencies, documents patterns in the repository | max 1 invocation, retry 2 |
| External Researcher | `rdpi-external-researcher` | Investigates ecosystem: comparable libraries, best practices, known pitfalls via web search | max 1 invocation, retry 1 |
| Questions Synthesizer | `rdpi-questioner` | Formulates unresolved questions, trade-offs, ambiguities and constraints | max 1 invocation, retry 1 |
| Research Reviewer | `rdpi-research-reviewer` | Synthesizes all findings into README.md, verifies cross-references and consistency | max 1 invocation, retry 2 |


## Typical Phase Structure

| Phase | Agent | Output | Depends on | Parallelizable |
|-------|-------|--------|------------|----------------|
| 1 | `rdpi-codebase-researcher` | `01-codebase-analysis.md` | — | Yes (with 2) |
| 2 | `rdpi-external-researcher` | `02-external-research.md` | — | Yes (with 1) |
| 3 | `rdpi-questioner` | `03-open-questions.md` | 1, 2 | No |
| 4 | `rdpi-research-reviewer` | Updates `README.md` | 1, 2, 3 | No |

Phases 1–2 are independent and SHOULD be parallelized. Phase 3 depends on phases 1–2 (the questioner reads research outputs to identify gaps and formulate informed questions). Phase 4 is sequential — it depends on all previous outputs.


## Phase Prompt Guidelines

### Phase 1 — Codebase Analysis

The prompt MUST specify:
- Entry points to start from (modules, files, or concepts relevant to the task)
- What aspects to trace: architecture, data flow, dependencies, patterns, public API surface
- Scope boundaries (which modules to include/exclude)

Do NOT ask the agent to propose solutions. Only facts.

### Phase 2 — External Research

The prompt MUST specify:
- What problem domain to research (the feature's domain, not the repo's tech stack)
- Which comparable libraries/frameworks to analyze
- What type of findings matter: patterns, pitfalls, performance, API ergonomics

Include a skepticism directive: cross-reference claims, annotate with confidence levels (High/Medium/Low), separate established practices from opinions.

### Phase 3 — Open Questions

The prompt MUST specify:
- Context: brief feature description + what areas were researched
- Paths to all available research outputs (codebase analysis and external research) — the questioner reads these to identify gaps
- What kind of questions to generate: technical constraints, API compatibility, performance trade-offs, scope ambiguities, risks
- Priority classification scheme (High/Medium/Low)

Each question must include: context, options (if applicable), risks, and researcher recommendation.

### Phase 4 — Research Review

The prompt MUST specify:
- Paths to all phase outputs (01, 02, 03)
- Instruction to write/update README.md with: summary, document links, key findings (5–7 bullets), next steps
- Cross-reference check: verify claims in one document against another


## Output Conventions

- Frontmatter fields: phase outputs use (title, date, stage, role); README.md uses (title, date, status, feature)
- README.md structure: Summary, Documents, Key Findings, Next Steps
- File paths referenced with `@/` alias (e.g., `@/signals/signals/State.ts`)
- Mermaid diagrams: titled, max 15–20 elements, clear node names


## Scaling Rules

- For trivial tasks (affecting < 3 files): phases 2 and 3 can be merged into a single phase with `rdpi-questioner` (questions based on TASK.md + codebase analysis)
- For broad tasks (affecting > 3 modules): phase 1 can be split into multiple parallel codebase-researcher invocations scoped to different modules
- Never exceed 5 total phases for research stage
