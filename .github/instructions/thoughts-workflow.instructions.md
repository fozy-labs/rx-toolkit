---
name: "thoughts-workflow"
description: "Use when working with .thoughts/ feature development workflow files. Covers document formatting, Mermaid diagram conventions, and stage structure for the Research → Design → Plan → Implement pipeline."
applyTo: ".thoughts/**"
---

# .thoughts/ Workflow Guidelines

## Directory Structure

```
.thoughts/
└── <YYYY-MM-DD>_<feature-name>/
    ├── 01-research/
    │   ├── README.md
    │   ├── 01-codebase-analysis.md
    │   ├── 02-external-research.md
    │   ├── 03-constraints.md
    │   └── 04-open-questions.md
    ├── 02-design/
    │   ├── README.md
    │   ├── 01-architecture.md
    │   ├── 02-dataflow.md
    │   ├── 03-usecases.md
    │   ├── 04-decisions.md
    │   ├── 05-risks.md
    │   ├── 06-testcases.md
    │   └── 07-model.md
    ├── 03-plan/
    │   ├── README.md
    │   └── NN-phase.md
    └── 04-implement/
        └── README.md
```

## Document Conventions

- **Language**: Russian for all documents
- **Status**: каждый README.md содержит поле Status (Draft → Review → Approved or Redraft (check REVIEW.md))
- **Cross-references**: относительные ссылки между документами (`../01-research/README.md`)
- **File paths**: ссылки на исходные файлы от корня проекта (`src/signals/signals/State.ts`)
- **Code examples**: блоки с подсветкой синтаксиса

## Mermaid Diagrams

Используй Mermaid для:
- Архитектурных диаграмм (C4, component)
- Data flow (sequence diagrams)
- Domain models (class diagrams)
- State machines (state diagrams)
- Phase dependencies (gantt / flowchart)

Правила:
- Каждая диаграмма должна иметь осмысленный заголовок
- Используй понятные имена узлов, не аббревиатуры
- Для сложных диаграмм добавляй описание перед блоком кода
- Ограничивай диаграммы до 15–20 элементов — разбивай большие на несколько

## Stage Transitions

Каждый этап имеет точку входа — промпт:
- **Research** → `/01-research` — сбор фактов, анализ кодовой базы и экосистемы
- **Design** → `/02-design` — проектирование решения на основе фактов
- **Plan** → `/03-plan` — декомпозиция дизайна на фазы имплементации
- **Implement** → `/04-implement` — реализация плана с git-коммитами

Переход к следующему этапу — только после ревью человеком предыдущего.

