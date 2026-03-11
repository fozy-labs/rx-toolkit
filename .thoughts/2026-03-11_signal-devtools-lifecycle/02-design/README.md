# Дизайн: Signal Devtools Lifecycle Hooks

- **Date**: 2026-03-11
- **Status**: Draft
- **Feature**: Lifecycle hooks для сигналов, замена `_skipValues`, утилита нормализации, инверсия зависимости сигналы↔devtools

## Резюме

Дизайн определяет архитектуру lifecycle hooks (LC) для сигналов rx-toolkit. Ключевые решения:

1. **Новая система типов**: `SignalOptions<T>` с flat `on*`-хуками + `SignalOptionsOrKey<T>` union + `normalizeSignalOptions()` утилита
2. **Инверсия зависимости**: сигналы вызывают **только** LC-хуки, devtools подключаются через дефолтный набор хуков из `SharedOptions.DEVTOOLS`
3. **Замена `_skipValues`**: отдельная опция `onChange` для кастомизации отправки в devtools (не часть LC-хуков)
4. **Гибридный подход**: `State` конструктор автоматически merge'ит devtools-хуки с пользовательскими
5. **QueriesLifetimeHooks**: оставляет `Devtools.createState()` — минимизация scope

## Документы

- [Архитектура системы](./01-architecture.md) — компонентная архитектура, типы, API, диаграммы зависимостей
- [Потоки данных](./02-dataflow.md) — sequence-диаграммы создания, обновления, GC, merge хуков

## Ключевые решения

| Решение | Выбор | Обоснование |
|---------|-------|-------------|
| Формат хуков | Flat `on*` в `SignalOptions` | TC39/Preact стандарт, минимум аллокаций |
| Набор LC-хуков | `onInit`, `onChange`, `onDispose` | Покрывают 3 текущих неявных события |
| Замена `_skipValues` | Отдельная опция `onChange` с `push()` | Не связан с LC, ответ из open-questions |
| Кто создаёт devtools hooks | Гибридно (State + user) | Ответ из open-questions |
| Расположение типов | `src/signals/types/` | Ответ из open-questions |
| Query модуль | Без изменений | Минимизация scope |

## Связанные документы
- [Исследование](../01-research/README.md)
