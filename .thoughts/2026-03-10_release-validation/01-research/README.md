# Исследование: Release Validation

- **Date**: 2026-03-10
- **Status**: Draft
- **Feature**: Предрелизная валидация оставшихся модулей (`src/query`, корневые экспорты, интеграционные тесты)

## Резюме

Проведён глубокий анализ оставшихся неваженных модулей библиотеки rx-toolkit перед публичным релизом. Основной фокус — модуль `src/query/` (система управления асинхронными запросами и кэшированием), корневой `src/index.ts`, интеграционные тесты `src/__tests__/`, конфигурационные файлы и документация.

Модуль `src/query/` представляет собой зрелую архитектуру для data-fetching с поддержкой Resource (кэшируемые запросы), Command (мутации с link к ресурсам), Agent (умные обёртки для React), ResourceRef (low-level доступ к кэшу с patch-транзакциями) и ResourceDuplicator (агрегация нескольких ресурсов). Однако весь модуль **полностью лишён unit-тестов** — coverage конфигурация в vitest.config.ts явно исключает `src/query/**`. Это главная критическая проблема.

Обнаружено несколько дополнительных проблем: опечатка в имени директории (`Opertation` вместо `Operation`), опечатка в публичном типе (`ResourceRefInstanse` вместо `ResourceRefInstance`), типы query-модуля не реэкспортируются для потребителей, наличие `any`-типов в публичных API, TODO-комментарии указывающие на нерешённые архитектурные вопросы, мёртвый код (`experimental/resource_de_god/` — пустая директория) и отсутствие тестов для query-экспортов в интеграционных тестах.

## Документы

- [Анализ кодовой базы](./01-codebase-analysis.md)
- [Внешнее исследование](./02-external-research.md)
- [Ограничения и требования](./03-constraints.md)
- [Открытые вопросы](./04-open-questions.md)

## Ключевые находки

1. **Нулевое тестовое покрытие `src/query/`** — ни один файл не имеет unit-тестов; vitest coverage явно исключает query-модуль. Для библиотеки, идущей в продакшн, это критический риск регрессий.
2. **Типы query-модуля не экспортируются** — `src/query/index.ts` не содержит `export * from './types'`, что делает невозможным импорт `ResourceDefinition`, `CommandDefinition`, `ResourceQueryState` и прочих типов потребителями.
3. **Опечатки в публичном API** — тип `ResourceRefInstanse` (должно быть `ResourceRefInstance`); директория `Opertation` (должно быть `Operation`); тип `FrowardInfo` (должно быть `ForwardInfo`).
4. **`any`-типы в публичном коде** — `compare()` в `useResourceAgent.ts`, `d: any[]` в `ResourceDuplicator`, `as any` в `QueriesLifetimeHooks`.
5. **Отсутствие интеграционных тестов для query** — `root-exports.test.ts` не проверяет ни один экспорт из query-модуля (createResource, createCommand, useResourceAgent, useCommandAgent, SKIP и т.д.).
6. **TODO-комментарии указывают на нерешённые вопросы** — блокировка ресурсов (`isLocked`), типизация `args: undefined`, архитектура `dataChanged$` в lifecycle hooks.
7. **Мёртвый код / экспериментальные артефакты** — пустая директория `src/query/experimental/resource_de_god/`; метод `d_init` помечен `@deprecated` но активно используется.

## Следующие шаги

После ревью человеком переходите к фазе Design: `/02-design`
