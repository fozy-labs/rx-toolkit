---
title: "Fix: Annotations section overlaps with diagram"
target: docs/query/concepts/architecture.md
rule: "#4 — prefer diagram over prose when both say the same thing"
status: Done
---

# Analysis: Annotations vs Diagram

## Per-annotation breakdown

### createApi
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "принимает `plugins`, `initialSnapshot`, `cacheLifetime`…" | **KEEP** | Diagram only shows `createApi(options)` — no detail on which options |
| ".createResource() / .createCommand() применяют эти опции" | **REMOVE** | Diagram arrows `CREATE_API -- ".createResource(opts)" --> RES` already show this |
| "вызывают augmentResource() / augmentCommand() у каждого плагина" | **REMOVE** | Diagram edge labels `IPLUG -. "augmentResource()" .-> RES` show exactly this |
| "`.getSnapshot()` и `.resetAll()`" | **KEEP** | Not in diagram |

### CacheMap
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "две стратегии индексации: serialize / compare" | **KEEP** | Diagram only shows a box labeled `CacheMap` |
| "стратегия выбирается при создании ресурса" | **KEEP** | Not in diagram |
| "пассивный контейнер; вытеснение через onClean$" | **KEEP** | Not in diagram |

→ Entirely NEW. Keep as-is.

### CacheEntry
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "публикует через Signal + RxJS Observable" | **KEEP** | Not in diagram |
| "GC: refcount-таймер, 60 с по умолчанию" | **KEEP** | Not in diagram |

→ Entirely NEW. Keep as-is.

### Machine
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "иммутабельна: каждый переход → новый экземпляр" | **KEEP** | Not in diagram |
| "success/refreshing поддерживают Immer-патчи через Patcher" | **REMOVE** | Diagram edge `Machine -- "оптимистичные патчи" --> PATCHER` already shows this |
| "Подробнее — machine.md" | **KEEP** | Cross-ref link |

### Agent
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "SWR-наблюдатель" | **REMOVE** | Glossary already defines Agent as "SWR-наблюдатель" |
| "при смене аргументов: предыдущие данные как fallback" | **KEEP** | Not in diagram |
| "SKIP → агент переходит в idle" | **KEEP** | Not in diagram |

### Плагины
| Fragment | Verdict | Reason |
|----------|---------|--------|
| "применяются при создании, а не в рантайме" | **KEEP** | Timing nuance not in diagram |
| "augmentResource/augmentCommand возвращают объект, Object.assign" | **PARTIAL** | augment methods shown in diagram; Object.assign detail is new — keep only the mechanism |
| "единственный поставляемый — ReactHooksPlugin" | **REMOVE** | Diagram only contains ReactHooksPlugin, making this obvious |

## Summary of changes

1. **createApi** — trim to options list + `.getSnapshot()` / `.resetAll()`.
2. **CacheMap** — keep as-is.
3. **CacheEntry** — keep as-is.
4. **Machine** — remove Immer/Patcher sentence; keep immutability + link.
5. **Agent** — remove "SWR-наблюдатель"; keep fallback + SKIP semantics.
6. **Плагины** — trim to timing + Object.assign mechanism only.
