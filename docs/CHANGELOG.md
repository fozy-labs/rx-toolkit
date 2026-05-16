# CHANGELOG

## [0.6.2] - 2026-05-17

### Fixed
- Исправлен вывод типов в `links` 

## [0.6.0] - 2026-04-17

[Гайд по миграции с 0.5.x](./migrations/0.6.0.md)

### Added
- `createApi()` — центральная фабрика для создания ресурсов и команд, заменяет standalone-функции
- Фабричные методы `Machine.pending()`, `Machine.fromSnapshot()`
- Система плагинов с HKT-типами для типобезопасного расширения
- SSR-гидрация кеша через опции `initialSnapshot` и `getSnapshot()`
- Кросс-табовая синхронизация через опции `syncDriver` и `defaultSync`
- Новые опции `createApi`: `keyPrefix`, `syncDriver`, `defaultSync`, `snapshotValidTime`, `initialSnapshot`, `resourceRetentionTime`, `commandRetentionTime`
- Статус `isRefreshError` в агентах ресурсов
- Статус `idle` в агентах (ресурсов и команд)
- `reactHooksPlugin()` — фабричная функция (альтернатива `new ReactHooksPlugin()`)

### Changed
- **Полностью переработанный модуль Query** — иммутабельные состояния машины, реактивные кеш-записи, SWR-поведение
- `Machine` теперь дискриминированное объединение иммутабельных подтипов: `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineRefreshError`
- Ресурсы теперь поддерживают реактивные кеш-записи с методами `getEntry$()`, `createAgent()`, `trigger()`, `refresh()`
- Агенты ресурсов переработаны — SWR-поведение, методы `start`, `set`, `retry`, `refresh`, новый статус `idle`
- Агенты команд переработаны — методы `trigger`, `setKey`
- Команды теперь поддерживают оптимистичные обновления, патчи при успехе и инвалидацию связанных ресурсов
- `link` (callback) переименован в `links` (массив или callback): `optimisticUpdate(draft, args)`, `update(draft, args, result)`, `invalidate` — вместо обёрточного объекта
- React хуки переписаны: `useResource(resource, args)`, `useCommand(command, key)`
- Оптимистичные обновления с Immer-патчами и rebase-логикой

### Removed
- Удалены deprecated-элементы:
  - `api.createOperation()` → используйте `api.createCommand()`
  - `useOperationAgent()` → используйте `useCommand()`
  - Все Operation-типы (`OperationDefinition`, `OperationInstance`, `OperationCreateOptions`, `OperationCreateFn`, `OperationQueryState`, `OperationAgentInstanse`) → удалены (Query модуль полностью переписан, см. [гайд по миграции](./migrations/0.6.0.md))
  - `ResourceRefInstanse` — удалён (используйте `resource.getEntry()` для доступа к кеш-записям)
  - `LocalSignal` → используйте `LocalState`
  - `Signal.create()` — удалён из публичного API (технически доступен через наследование от `State`, но не рекомендуется) → используйте `Signal.state()` / `State.create()`
- Удалены standalone-функции (заменены методами `createApi()`):
  - `createResource()` → `api.createResource()`
  - `createCommand()` → `api.createCommand()`
  - `createResourceDuplicator()` → удалён без замены
  - `resetAllQueriesCache()` → `api.resetAll()`
- Удалены и заменены React-хуки:
  - `useCommandAgent()` → используйте `useCommand()`
  - `useResourceAgent()` → используйте `useResource()`
  - `useResourceRef()` → удалён (используйте `resource.getEntry()`)
- Удалён namespace `unstable_queryV2` — экспериментальный API стал основным

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

[0.6.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.4...v0.6.0
[0.5.4]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.4.18...v0.5.0
