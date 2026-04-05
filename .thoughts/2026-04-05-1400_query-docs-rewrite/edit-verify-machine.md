---
title: "Editor Verdict: machine.md"
date: 2026-04-05
stage: edit-verify
role: editor
---

# Вердикт: machine.md — PASS ✓

## Чеклист (9 пунктов из r-machine-gaps.md)

| # | Требование | Статус |
|---|-----------|--------|
| 1 | Убрать `refresh-error` как состояние машины, показать 4 класса | ✅ 4 состояния; примечание объясняет `refresh-error` как логический статус агента |
| 2 | Добавить `lastError?: unknown` в описание `success` и `TSuccessState` | ✅ Есть в таблице, в прозе, в интерфейсе |
| 3 | Удалить `TRefreshErrorState` интерфейс | ✅ Отсутствует — ровно 4 интерфейса |
| 4 | Исправить таблицу: убрать строку `refresh-error`, добавить `patchState` | ✅ 4 строки, 6 столбцов вкл. `patchState` и `lastError` |
| 5 | Исправить Mermaid: убрать `refresh_error`, `refreshing→success` через `errorHappened`, `abortAllPendingPatches` | ✅ Диаграмма корректна |
| 6 | Заменить `finishAllPatches()` → `abortAllPendingPatches()` | ✅ Везде `abortAllPendingPatches()` |
| 7 | Убрать дублирование полей (правило #4) | ✅ Таблица=обзор, проза=семантика, интерфейсы=типы — разные функции |
| 8 | Добавить ссылки reference-style | ✅ `[patching]`, `[agent]` объявлены внизу, используются в теле |
| 9 | Добавить `Machine.fromSnapshot()` | ✅ В интро + note в диаграмме |

## Common-mistakes rules

| Правило | Статус |
|---------|--------|
| #1 README ≠ Architecture | N/A |
| #2 Reference-style links | ✅ |
| #3 Без дублирования между документами | ✅ Ссылки на patching.md и agent.md |
| #4 Диаграмма ИЛИ описание | ✅ Проза добавляет семантику, не пересказывает диаграмму |
| #6 Без супер-диаграмм | ✅ Одна focused диаграмма |
| #9 Естественные формулировки | ✅ |
| #10 Архитектура ≠ usage | ✅ |

## Технические проверки

- **Mermaid-синтаксис**: корректный `stateDiagram-v2`, 4 узла, все переходы с правильными методами
- **TypeScript-интерфейсы**: совпадают с research — `TPendingState`, `TSuccessState` (с `lastError?`), `TErrorState`, `TRefreshingState`
- **Методы переходов**: `successHappened`, `errorHappened`, `invalidate`, `start`, `retry`, `createPatch`, `finishPatch`, `abortAllPendingPatches` — все корректны
- **Русский язык**: естественные формулировки, без калек

## Исправления

1. Удалена неиспользуемая ссылка `[architecture]: ./architecture.md` (объявлена, но нигде не вызвана в тексте).

Других проблем не обнаружено.
