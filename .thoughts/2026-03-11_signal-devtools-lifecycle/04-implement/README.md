# Имплементация: Signal Devtools Lifecycle Hooks

- **Date**: 2026-03-11
- **Status**: Draft
- **Plan**: [03-plan](../03-plan/README.md)

## Commits

| # | Hash | Message |
|---|------|-----------|
| 1 | `6ee032a` | `refactor(signals): add SignalOptions types and Devtools.createSignalHooks()` |
| 2 | `eed6d87` | `refactor(signals): integrate lifecycle hooks into signals` |
| 3 | `88a108c` | `test(signals): add tests for lifecycle hooks and normalizeSignalOptions` |

## Status
- Фаз завершено: 3/3
- Верификация: все пройдены (`npx tsc --noEmit` — чисто, `npx vitest run` — 425 тестов / 40 файлов)
- Проблемы: Fix в Computed.ts — `opts` не spread-ится целиком в `stateOptions` из-за несовместимости `hooks: SignalLifecycleHook<T>[]` с `SignalLifecycleHook<symbol | T>[]`; вместо spread выбраны конкретные поля.

## Рекомендации после имплементации
- [ ] Полная сборка: `npm run build`
- [ ] Ручное тестирование: devtools-интеграция с Redux DevTools (State, Computed, Signal)

## Короткий перечень изменений:
- Новые типы: `SignalLifecycleHook<T>`, `SignalOptions<T>`, `SignalOptionsOrKey<T>`
- Утилита `normalizeSignalOptions()` — нормализация `string → { key }`
- `Devtools.createSignalHooks()` — создание devtools-хука как `SignalLifecycleHook`, делегирует в `createState()`
- `Devtools.createState()` — `_skipValues` заменён на `beforeDevtoolsPush`
- `State` — `_stateDevtools` → `_hooks: SignalLifecycleHook[]`, итерация в `set()` и `FinalizationRegistry`
- `Computed` — `_skipValues: [_EMPTY]` → `beforeDevtoolsPush` callback
- `Signal`, `LocalState` — обновлены типы на `SignalOptionsOrKey`
- `StateDevtoolsOptions` удалён из `src/common/devtools/types.ts`
- Экспорт новых типов через `src/signals/index.ts`
