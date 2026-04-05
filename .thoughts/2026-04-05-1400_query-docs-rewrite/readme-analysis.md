---
title: "README.md Content Analysis"
date: 2026-04-05
---

# README.md — What It Should Be

## 1. Content (based on signals/options/devtools pattern)

All three sibling READMEs are **landing pages**: a 1–2 sentence intro, a quick-start code example, and concise API/concept summaries. `docs/query/README.md` should follow the same pattern:
- One-paragraph intro (what Query solves, two primitives: Resource & Command).
- Minimal code example: `createResource` + `useResource` (≤20 lines).
- Short feature list (caching, optimistic updates, SSR, broadcast — bullet points, not diagrams).
- "Что читать дальше" navigation table (already exists, keep it).

## 2. Where architecture content should go

Move the Mermaid diagram, "Поток данных" explanation, and full glossary to `concepts/architecture.md` (new P0 file). Update `docs-toc.md` accordingly — README row becomes "Landing page / introduction", architecture row goes under `concepts/`.

## 3. Keep vs Drop from current draft

**Keep:** intro sentence, glossary table (relocate to `concepts/architecture.md`), navigation table.
**Drop from README:** Mermaid diagram, "Архитектура" section, "Поток данных" paragraph, detailed glossary.
