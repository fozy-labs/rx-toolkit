# Дизайн: Signal Devtools Lifecycle Hooks

- **Date**: 2026-03-11
- **Status**: Draft
- **Feature**: Lifecycle hooks для сигналов, замена _skipValues, утилита нормализации, инверсия зависимости сигналы и devtools

## Резюме

Дизайн определяет архитектуру lifecycle hooks (LC) для сигналов rx-toolkit. Ключевые решения:

1. **Новая система типов**: SignalLifecycleHook<T> + SignalOptions<T> с hooks: SignalLifecycleHook[] (массив) + SignalOptionsOrKey<T> + 
ormalizeSignalOptions()
2. **Массив LC-хуков**: devtools - один элемент hooks[], пользовательские хуки - остальные
3. **key вместо 
ame**: 
ame - @deprecated
4. **Замена _skipValues**: опция eforeDevtoolsPush - вызывается в том же месте
5. **Devtools.createHooks()**: метод объекта Devtools, возвращает SignalLifecycleHook | null
6. **QueriesLifetimeHooks**: Devtools.createState() без изменений

## Документы

- [Архитектура системы](./01-architecture.md)
- [Потоки данных](./02-dataflow.md)
- [Доменная модель](./03-model.md)
- [Архитектурные решения (ADR)](./04-decisions.md)
- [Use Cases](./05-usecases.md)
- [Тест-кейсы](./06-testcases.md)
- [Документация](./07-docs.md)
- [Риски](./08-risks.md)

## Ключевые решения

| Решение | Выбор | Обоснование |
|---------|-------|-------------|
| Формат хуков | Массив SignalLifecycleHook[] в hooks | Расширяемость |
| Набор LC-хуков | onInit, onChange, onDispose | Покрывают 3 неявных события |
| Основное поле ключа | key (
ame deprecated) | Устранение путаницы |
| Замена _skipValues | eforeDevtoolsPush - в том же месте | Прямая замена в Devtools |
| Создание devtools-хуков | Devtools.createHooks() метод объекта | Консистентность API |
| Query модуль | Без изменений | Минимизация scope |

## Связанные документы
- [Исследование](../01-research/README.md)
