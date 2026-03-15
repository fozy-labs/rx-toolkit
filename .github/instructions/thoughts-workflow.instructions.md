---
name: "thoughts-workflow"
description: "Use when working with .thoughts/ feature development workflow files. Covers document formatting and stage structure for the Research → Design → Plan → Implement pipeline."
applyTo: ".thoughts/**"
---

# .thoughts/ Workflow Guidelines

## Directory Structure

```
.thoughts/
└── <YYYY-MM-DD-HHmm>_<feature-name>/
    └── <stage_number>-<stage_name>/
        ├── README.md
        └── <phase_number>-<phase_name>.md
```


## Document Conventions

- **Language**: Russian (code and technical terms in English).
- **Front matter**: No YAML frontmatter. Use inline metadata bullets (Date, Status, Feature).
- **Status**: README.md containts "Status" field:
    - Inprogress: work in progress, not ready for review,
    - Draft: ready for review, awaiting feedback,
    - Review: under review, awaiting decision,
    - Approved: passed review, ready for implementation,
    - Redraft: needs significant changes, check REVIEW.md for feedback.
- **Cross-references**: reference links between documents (`../01-research/README.md`).
- **File paths**: links to source files with alias (`@/signals/signals/State.ts`).


## Mermaid Diagrams

Rules:
- Each diagram must have a meaningful title.
- Use clear node names, not abbreviations.
- For complex diagrams, add a description before the code block.
- Limit diagrams to 15–20 elements — split large ones into multiple diagrams.


## Stages

- `01-research` — gathering facts, analyzing the codebase and ecosystem.
- `02-design` — designing a solution based on the facts.
- `03-plan` — decomposing the design into implementation phases.
- `04-implement` — executing the plan.
