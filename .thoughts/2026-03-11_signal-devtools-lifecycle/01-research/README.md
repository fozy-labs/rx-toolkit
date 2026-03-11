# Исследование: Signal Devtools Lifecycle Hooks

- **Date**: 2026-03-11
- **Status**: Approved
- **Feature**: Doработка devtools в сигналах: lifecycle hooks, замена _skipValues, утилита нормализации options, инверсия зависимости сигналы↔devtools

## Резюме

Исследование охватывает текущую архитектуру интеграции devtools в сигналах rx-toolkit и анализ ecosystem-подходов. Ключевой инсайт: devtools жёстко вшиты в `State.set()` и `State.constructor`, а `_skipValues` — приватный хак для единственного потребителя (Computed). TC39 Signals Proposal и Preact Signals v1.9+ определяют модель lifecycle hooks (`watched`/`unwatched`) как flat-поля в `SignalOptions`, что является emerging standard. Devtools через lifecycle hooks — инновационный подход, не применённый в других библиотеках, но архитектурно обоснованный (Zustand middleware pattern аналогичен).

Критические решения впереди: сигнатура callback замены `_skipValues`, naming для полей хуков, степень decoupling сигналов от devtools, обратная совместимость `StateDevtoolsOptions`.

## Документы
- [Анализ кодовой базы](./01-codebase-analysis.md)
- [Внешнее исследование](./02-external-research.md)
- [Открытые вопросы](./03-open-questions.md)

## Ключевые находки

- **StateDevtoolsOptions** (`string | object`) определён в `src/common/devtools/types.ts` и используется в 6+ файлах. Нормализация `string → object` выполняется **трижды** (State, Computed, Devtools.createState)
- **_skipValues** — приватный хак (underscore, `any[]`), используется **только** `Computed.ts` для скрытия символа `_EMPTY` от devtools
- **Devtools вызываются напрямую** из `State.set()` и `State.constructor` — нет lifecycle-абстракции
- **FinalizationRegistry** — cleanup devtools при GC через `$COMPLETED` magic string с `as any`
- **Preact Signals + TC39** используют flat `on*` callbacks в `SignalOptions` для lifecycle — emerging standard
- **QueriesLifetimeHooks** (query модуль) — единственный внешний потребитель `Devtools.createState()`, любые изменения API затронут его
- **Devtools через lifecycle hooks** — подход не применён в других библиотеках; Preact держит debug отдельно от lifecycle; Zustand использует middleware wrapping

## Следующие шаги
После ревью человеком переходите к фазе Design: `02-design`
