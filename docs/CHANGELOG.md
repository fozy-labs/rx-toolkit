# CHANGELOG

## Что нового в 0.5.0

[Гайд по миграции](./migrations/0.5.0.md)

### RxSignals

- **Функциональный API (рекомендуется)**: `Signal.create()`, `Signal.compute()`, `Signal.effect()`
- **Cleanup функции в Effect**: поддержка возврата teardown функции
- **Без complete()**: теперь нет необходимости вызывать `complete()` для Signal и Computed
- **Ленивый Computed**: вычисление только при наличии подписок

### RxQuery

- **Расширенные состояния**: `isInitialLoading`, `isReloading`, `isLocked`
- **ResourceRef API**: низкоуровневый доступ к кэшу с поддержкой транзакций
- **Patch транзакции**: изменения с возможностью commit/abort
- **Lifecycle хуки**: `onCacheEntryAdded`, `onQueryStarted`
- **resetAllQueriesCache()**: сброс всего кэша

### React

- **useResourceRef**: хук для работы с ResourceRef

### Devtools

- **BatchStrategy**: настройка стратегии обновлений (`'sync'`, `'microtask'`, `'task'`)

### Конфигурация

- **DefaultOptions**: расширенная конфигурация (`onQueryError`, `getScopeName`)
