# CHANGELOG

## [Unreleased]

### 💥 Breaking Changes

- **Removed Query v1**: The entire `query` v1 module has been removed. All v1 APIs (`createResource`, `createCommand`, `useResourceAgent`, `useCommandAgent`, `useResourceRef`, `resetAllQueriesCache`, `createResourceDuplicator`, `SKIP`, `createOperation`, `useOperationAgent`) from the original query module are no longer available.
- **Renamed Query v2 → Query**: The `unstable_queryV2` namespace has been removed. All query v2 APIs are now exported directly from the package root.
- **Removed V2 suffix from all symbols**: All types, interfaces, classes, and functions have been renamed to drop the "V2" suffix (e.g., `ResourceV2` → `Resource`, `IResourceV2Agent` → `IResourceAgent`, `useResourceV2Agent` → `useResourceAgent`).
- **Removed `unstable_queryV2` namespace export**: Import directly from `@fozy-labs/rx-toolkit` instead.
- **Removed deprecated signals API**: `Signal.create()`, `LocalSignal`, `Effect.complete()`, `SignalOptions.name`, `LocalState` option `validator$`.

### ✨ New Features

- **Pokémon Demo**: New interactive demo showcasing pseudo-authentication, data fetching with `createApi`, `createResource`, `SKIP` token, and `createCommand` with `commandLink` for resource invalidation.
- **TanStack-style Documentation**: Complete documentation rewrite with guides for Resources, Commands, SKIP Token, Plugins, State Machines, SSR, Optimistic Updates, and DevTools.

### ️ Removed

- `src/query/` (v1) — 44 files deleted
- `docs/query/` (v1 docs) — Replaced with new v2 docs
- `apps/demos/src/examples/query/` (v1 demos) — Replaced with v2 demos
- `sideEffects` entry for `./dist/query/core/Resource/ResourceRef.js`

## [0.5.4] - 2026-03-21

### Fixed
- Removed unused `observable-hooks` dependency from `package.json`

## [0.5.3] - 2026-03-21

### Fixed
- Fixed `useResourceRef` memoization for object arguments — ref no longer recreated every render
- Fixed missing type exports from `src/query/` — consumers can now import `ResourceDefinition`, `CommandDefinition`, etc.
- Исправления в документации и демо-примерах

### Changed
- `ResourceRefInstanse` renamed to `ResourceRefInstance` (deprecated alias preserved)
- `FrowardInfo` renamed to `ForwardInfo` (internal type)
- `Opertation/` directory renamed to `Operation/`
- Replaced `any` types with proper types in `useResourceAgent` and `ResourceDuplicator`
- `LocalSignal` переименован в `LocalState`
- Все вызовы `Signal.create()` в кодовой базе заменены на `Signal.state()` (внутренний рефакторинг)

### Added
- Unit tests for query core modules
- Smoke tests for React hooks
- Integration tests for query exports
- `createCommand()` — создание команды (мутации/действия), заменяет `createOperation()`
- `useCommandAgent()` — React-хук для работы с командой
- `LocalState` — замена `LocalSignal` с новыми возможностями
- `LocalState.clear()` — метод удаления значения из хранилища и сброса к значению по умолчанию
- Опция `driver` для `LocalState` — возможность подключить кастомное хранилище (вместо `localStorage`)
- Новый примитив **State** — замена `Signal` с идентичным API
- `Signal.state()` — рекомендуемый статический метод создания сигнала


### Deprecated
- `ResourceRefInstanse` — use `ResourceRefInstance` (will be removed in v0.6.0)
- `createOperation()` → используйте `createCommand()` (будет удалён в v0.6.0)
- `useOperationAgent()` → используйте `useCommandAgent()` (будет удалён в v0.6.0)
- Все Operation-типы переименованы в Command-типы: `OperationDefinition` → `CommandDefinition`, `OperationInstance` → `CommandInstance`, `OperationCreateOptions` → `CommandCreateOptions`, `OperationCreateFn` → `CommandCreateFn`, `OperationQueryState` → `CommandQueryState`
- `OperationAgentInstanse` (с опечаткой) → `CommandAgentInstance` — исправлена опечатка в имени типа
- `LocalSignal` → используйте `LocalState`
- `Signal` помечен как `@deprecated` — используйте `State` вместо него
- `Signal.create()` помечен как `@deprecated` — используйте `Signal.state()` / `State.create()`


## [0.5.2] — 2025-12-19

### Fixed

- Исправлена работа `SKIP_TOKEN`

## [0.5.1] — 2025-12-19

### Fixed

- Исправление типизации

## [0.5.0] — 2025-12-18

[Гайд по миграции с 0.4.x](./migrations/0.5.0.md)

### Breaking Changes

- Удалены хуки `useObservable` и `useSyncObservable`
- Сигналы больше не наследуют `Observable` — используйте `.obs` для подписки
- Удалены `.value`, `.getValue()`, `.next()` — заменены на `signal()`, `.get()`, `.set()`
- Нет необходимости вызывать `complete()` для Signal и Computed

### Added

#### Signals
- **Функциональный API**: `Signal.create()`, `Signal.compute()`, `Signal.effect()`
- **Ленивый Computed**: вычисление только при наличии подписок
- Cleanup-функции в `Effect` (возврат teardown)

#### Query
- **Расширенные состояния**: `isInitialLoading`, `isReloading`, `isLocked`
- **ResourceRef API**: низкоуровневый доступ к кэшу с поддержкой транзакций (patch с commit/abort)
- **Lifecycle хуки**: `onCacheEntryAdded`, `onQueryStarted`
- `resetAllQueriesCache()` — сброс всего кэша

#### React
- `useResourceRef` — хук для работы с ResourceRef

### Changed

- **BatchStrategy**: настройка стратегии обновлений (`'sync'`, `'microtask'`, `'task'`)
- **DefaultOptions**: расширенная конфигурация (`onQueryError`, `getScopeName`)

[0.5.4]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.4.18...v0.5.0
