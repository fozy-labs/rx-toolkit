---
title: "Research: refresh vs invalidate method naming"
date: 2026-04-05
stage: research
role: problem-analyst
---

# Issue: `invalidate` → `refresh` в секции "Обновление (refresh)"

## Заявление пользователя

Метод на Resource называется `refresh(args)`, а НЕ `invalidate(args)`.

## Текущий код (факты)

| Слой            | Метод / класс                       | Файл                                    | Строка |
|-----------------|--------------------------------------|------------------------------------------|--------|
| Public API      | `Resource.invalidate(...args)`       | `src/query/core/resource/Resource.ts`    | 91     |
| CacheEntry      | `ResourceCacheEntry.invalidate()`    | `src/query/core/resource/ResourceCacheEntry.ts` | 109 |
| Machine         | `MachineSuccess.invalidate()` → `MachineRefreshing` | `src/query/core/machines/MachineSuccess.ts` | 42 |

**Вывод**: в текущем коде метод называется `invalidate` на всех трёх уровнях.

## Противоречие

Пользователь утверждает, что целевое имя — `refresh(args)`. Текущий код использует `invalidate`. Документация (docs = spec) должна описывать **целевой** дизайн, поэтому в разделе "### Обновление (refresh)" нужно использовать `refresh`.

## Найденные вхождения в `docs/query/concepts/architecture.md`

### Внутри секции "### Обновление (refresh)" (строки 124–152)

| # | Строка | Текущий текст (oldText) | Замена (newText) | Тип |
|---|--------|-------------------------|------------------|-----|
| 1 | 126 | `Инвалидация существующей записи.` | `Обновление существующей записи.` | Prose |
| 2 | 136 | `UI->>Res: invalidate(args)` | `UI->>Res: refresh(args)` | Mermaid diagram |
| 3 | 137 | `Res->>Entry: invalidate()` | `Res->>Entry: refresh()` | Mermaid diagram |

### Вне секции (глоссарий, строка 164)

| # | Строка | Текущий текст (oldText) | Замена (newText) | Тип |
|---|--------|-------------------------|------------------|-----|
| 4 | 164 | `инвалидация, оптимистичное обновление` | `обновление (refresh), оптимистичное обновление` | Glossary |

## Нужно ли переименовывать Machine transition?

Строка 138 диаграммы: `Entry->>Entry: Success → MachineRefreshing` — здесь указан не метод, а **переход состояния** (имя класса `MachineRefreshing`). Имя класса `MachineRefreshing` уже корректно соответствует концепции refresh.

Однако внутренний метод `MachineSuccess.invalidate()` в коде тоже использует имя `invalidate`. Если пользователь планирует переименовать public API (`Resource.invalidate` → `Resource.refresh`), логично переименовать и:
- `MachineSuccess.invalidate()` → `MachineSuccess.refresh()`
- `ResourceCacheEntry.invalidate()` → `ResourceCacheEntry.refresh()`

**Но это вопрос о коде, а не о документации.** В текущей диаграмме Machine transition не отображает имя метода `invalidate()` — он отображает переход `Success → MachineRefreshing`, который корректен.

## Точные пары oldText → newText для правки документа

```
oldText: Инвалидация существующей записи. Ключевое отличие от первого запроса:
newText: Обновление существующей записи. Ключевое отличие от первого запроса:
```

```
oldText: UI->>Res: invalidate(args)
newText: UI->>Res: refresh(args)
```

```
oldText: Res->>Entry: invalidate()
newText: Res->>Entry: refresh()
```

```
oldText: инвалидация, оптимистичное обновление
newText: обновление (refresh), оптимистичное обновление
```

## Открытый вопрос

Пользователь говорит о target design. В текущем коде метод — `invalidate`. Нужно уточнить:
- Планируется ли переименование метода в коде `Resource.invalidate` → `Resource.refresh`?
- Или docs описывают будущий API, а код будет обновлён отдельно?
