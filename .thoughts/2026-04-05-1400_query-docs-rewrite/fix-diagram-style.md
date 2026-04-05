---
title: "Fix component diagram edge label style"
stage: analysis
status: Done
---

# Fix: Component Diagram Edge Label Style

## Current State

The "Диаграмма компонентов" Mermaid diagram mixes two edge-label styles:

### Method-style labels (5)
| Edge | Label |
|------|-------|
| CREATE_API → RES | `.createResource(opts)` |
| CREATE_API → CMD | `.createCommand(opts)` |
| IPLUG → RES | `augmentResource()` |
| IPLUG → CMD | `augmentCommand()` |
| CMAP → ENTRY | `get(args)` |

### Abstract-style labels (5)
| Edge | Label |
|------|-------|
| REACT_PLG → HOOKS | `добавляет хуки` |
| ENTRY → MACHINE | `хранит` |
| MACHINE → PATCHER | `оптимистичные патчи` |
| HOOKS → AGENT | `создаёт` |
| AGENT → ENTRY | `наблюдает` |

### Unlabeled edges (3)
| Edge |
|------|
| REACT_PLG -.-> IPLUG |
| RES → CMAP |
| CMD → CMAP |

## Decision: Abstract-style

Reasons:
1. **This is an architecture/component diagram**, not a code walkthrough. Relationships should describe *what* components do to each other, not *how* (method signatures).
2. Method names are implementation details that can change; abstract labels stay stable.
3. The document already describes the code-level API in prose below the diagram — no need to duplicate method names in the visual.
4. Abstract labels in Russian are consistent with the surrounding document language.

## Conversion Table

| Old label | New label |
|-----------|-----------|
| `.createResource(opts)` | `создаёт ресурс` |
| `.createCommand(opts)` | `создаёт команду` |
| `augmentResource()` | `расширяет ресурс` |
| `augmentCommand()` | `расширяет команду` |
| `get(args)` | `получает запись` |
| `добавляет хуки` | *(keep)* |
| `хранит` | *(keep)* |
| `оптимистичные патчи` | *(keep)* |
| `создаёт` | *(keep)* |
| `наблюдает` | *(keep)* |
