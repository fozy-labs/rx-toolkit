# Агент ресурса (ResourceAgent) — API

Агент — реактивный наблюдатель, транслирующий состояние [записи кеша][cache] в плоский сигнал с SWR-поведением. Концепция, жизненный цикл и SWR-fallback описаны в [concepts/agent.md][agent-concept].


## Создание

```typescript
const agent = usersResource.createAgent();
```

Метод `createAgent()` доступен у каждого [ресурса][api-res]. Агент создаётся без аргументов — наблюдение начинается после вызова `start()`.


## Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `state$` | `() => TResourceAgentState<TArgs, TData>` | Вычисляемый сигнал. Возвращает текущее состояние агента. |
| `start` | `(args: TArgs \| SKIP) => void` | Начинает или переключает наблюдение за ресурсом с указанными аргументами. При передаче `SKIP` агент переходит в `idle`. |
| `compareArgs` | `(a: TArgs, b: TArgs) => boolean` | Сравнивает аргументы стратегией, заданной для ресурса (`serializeArgs`). |


## Состояние (TResourceAgentState)

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `TMachineStatus \| "idle"` | Текущий статус агента. См. таблицу статусов ниже. |
| `data` | `TData \| null` | Данные. При SWR-fallback содержит устаревшие данные предыдущей записи. |
| `error` | `unknown` | Ошибка текущего запроса. `null` в `idle` / `success` / `pending`. |
| `lastError` | `unknown \| undefined` | Последняя известная ошибка (сохраняется после перехода в `success`). |
| `args` | `TArgs \| null` | Аргументы текущего наблюдения. `null` в `idle`. |
| `isLoading` | `boolean` | `true` при любой загрузке (`pending` или `refreshing`). |
| `isInitialLoading` | `boolean` | `true` только при первичной загрузке (`pending`). |
| `isRefreshing` | `boolean` | `true` при фоновом обновлении (SWR). |
| `isRefreshError` | `boolean` | `true`, если фоновое обновление завершилось ошибкой. |
| `isSuccess` | `boolean` | `true`, если данные получены успешно. |
| `isError` | `boolean` | `true`, если запрос завершился ошибкой. |
| `entry` | `IResourceCacheEntry<TArgs, TData> \| null` | Текущая запись кеша. `null` в `idle`. |


## Статусы

| Статус | `isLoading` | `isInitialLoading` | `isRefreshing` | `isRefreshError` | `isSuccess` | `isError` | Описание |
|--------|:-----------:|:-------------------:|:--------------:|:-----------------:|:-----------:|:---------:|----------|
| `idle` | — | — | — | — | — | — | Передан `SKIP`, наблюдение не активно. |
| `pending` | ✓ | ✓ | — | — | — | — | Первичный запрос в процессе. |
| `success` | — | — | — | — | ✓ | — | Данные получены. |
| `error` | — | — | — | — | — | ✓ | Запрос завершился ошибкой. |
| `refreshing` | ✓ | — | ✓ | — | — | — | Фоновое обновление; устаревшие данные доступны через `data`. |
| `refresh-error` | — | — | — | ✓ | — | ✓ | Фоновое обновление завершилось ошибкой; устаревшие данные сохранены. |


## См. также

- [Концепция агента][agent-concept] — SWR-fallback, SKIP, жизненный цикл
- [Ресурс — API][api-res] — создание ресурса и метод `createAgent()`
- [Использование ресурса][usage-res] — хук `useResource`, примеры, паттерны
- [Стейт-машина][machine] — переходы между статусами записи кеша


[agent-concept]: ../concepts/agent.md
[api-res]: ./resource.md
[usage-res]: ../usage/resource.md
[machine]: ../concepts/machine.md
[cache]: ../concepts/cache.md
