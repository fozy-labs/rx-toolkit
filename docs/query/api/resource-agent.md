# Агент ресурса (ResourceAgent) — API

Агент — реактивный наблюдатель, транслирующий состояние [записи кэша][cache] в плоский сигнал с SWR-поведением. Концепция, жизненный цикл и SWR-fallback описаны в [concepts/agent.md][agent-concept].


## Создание

```typescript
const agent = usersResource.createAgent();
```

Метод `createAgent()` доступен у каждого [ресурса][api-res]. Агент создаётся без аргументов: сначала их задают через `set(args)`, затем `start()` запускает запрос.


## Методы

| Метод | Сигнатура | Описание                                                                                                               |
|-------|-----------|------------------------------------------------------------------------------------------------------------------------|
| `state$` | `ReadonlySignal<TResourceAgentState<TArgs, TData, TError>>` | Сигнал состояния агента. |
| `start` | `() => void` | Переводит агент в «запущенное» состояние и запускает запрос для уже установленных через `set` аргументов. Аргументов не принимает; если их ещё нет — запрос стартует со следующего `set`. |
| `set` | `(args: ArgsOrVoidOrSkip<TArgs>, mark?: boolean) => void` | Устанавливает наблюдаемые args. До `start()` запрос не инициирует; после — смена args сразу запускает запрос для новых аргументов. При передаче `SKIP` агент переходит в `idle`. Необязательный `mark` (по умолчанию `false`) заставляет ещё не запущенный агент отдавать `pending` вместо `idle`. |
| `adoptPrevious` | `(source: IResourceAgent<TArgs, TData, TError>) => void` | Переносит SWR-fallback с другого агента: текущую запись `source`, если в ней есть данные (`success` / `refreshing` / `refresh-error`), иначе его собственный предыдущий слот. Для случаев, когда агент не мутируют через `set`, а заменяют новым — так работают React-хуки (один агент на набор args). `source` читается один раз и не удерживается. |
| `retry` | `() => void` | Повторяет последний запрос после ошибки. |
| `refresh` | `() => void` | Принудительно обновляет данные, при ошибке сохраняет устаревшие данные. |
| `whenSettled` | `() => Promise<void>` | Промис выхода из фазы первичной загрузки. См. [ниже](#whensettled). |
| `args` | `TArgs \| null` | Геттер: аргументы текущего наблюдения. Заполняется в `set` (до `start`), сбрасывается в `null` при `SKIP`. |


## Состояние (TResourceAgentState)

`TResourceAgentState` — **дискриминированное объединение** по `status`: каждый статус — отдельный вариант с литеральными булевыми флагами и точными типами `data` / `error`. Проверка `status`, `isSuccess`, `isError` и т. д. сужает тип:

```typescript
const state = agent.state$();

if (state.isError) {
  state.error; // TError — без `| null`
}
if (state.isSuccess) {
  state.data;  // TData — без `| null`
}
```

Поля (широкие типы на несуженном объединении):

| Поле | Тип | Описание |
|------|-----|----------|
| `status` | `TMachineStatus \| "idle"` | Текущий статус агента. См. таблицу вариантов ниже. |
| `data` | `TData \| null` | Данные. При SWR-fallback содержит устаревшие данные предыдущей записи. |
| `error` | `TError \| null` | Ошибка текущего запроса. По умолчанию `unknown`; типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror). |
| `args` | `TArgs \| null` | Аргументы текущего наблюдения. `null` только в `idle`. |
| `isLoading` | `boolean` | `true` при любой загрузке (`pending` или `refreshing`). |
| `isInitialLoading` | `boolean` | `true` только при первичной загрузке (`pending`). |
| `isRefreshing` | `boolean` | `true` при фоновом обновлении (SWR). |
| `isRefreshError` | `boolean` | `true`, если фоновое обновление завершилось ошибкой. |
| `isSuccess` | `boolean` | `true`, если данные получены успешно. |
| `isError` | `boolean` | `true`, если запрос завершился ошибкой. |
| `retry` | `() => void` | Метод для повторного запроса, при ошибке. |
| `refresh` | `() => void` | Метод для принудительного обновления данных. |

## Варианты состояния

Типы вариантов экспортируются: `TResourceAgentIdleState`, `TResourceAgentPendingState`, `TResourceAgentSuccessState`, `TResourceAgentErrorState`, `TResourceAgentRefreshingState`, `TResourceAgentRefreshErrorState`.

| Статус | `data` | `error` | `isLoading` | `isInitialLoading` | `isRefreshing` | `isRefreshError` | `isSuccess` | `isError` | Описание |
|--------|:------:|:-------:|:-----------:|:-------------------:|:--------------:|:-----------------:|:-----------:|:---------:|----------|
| `idle` | `null` | `null` | — | — | — | — | — | — | Наблюдение не активно: аргументы ещё не заданы, передан `SKIP`, либо агент не запущен и `set` вызывался без `mark`. |
| `pending` | `null` | `null` | ✓ | ✓ | — | — | — | — | Первичный запрос в процессе. |
| `success` | `TData` | `null` | — | — | — | — | ✓ | — | Данные получены. |
| `error` | `TData \| null`¹ | `TError` | — | — | — | — | — | ✓ | Запрос завершился ошибкой. |
| `refreshing` | `TData` | `null` | ✓ | — | ✓ | — | — | — | Фоновое обновление; устаревшие данные доступны через `data`. |
| `refresh-error` | `TData` | `TError` | — | — | — | ✓ | — | ✓ | Фоновое обновление завершилось ошибкой; устаревшие данные сохранены. |

¹ Обычно `null`; содержит устаревшие данные предыдущей записи при смене аргументов под SWR.


## whenSettled

Резолвится, когда `status` перестаёт быть `idle` / `pending`.

- **Никогда не реджектится.** Ошибка читается из состояния.
- **Инстанс кэшируется** на одну фазу загрузки и сбрасывается после settle.
- **`idle` не считается settled.** На агенте без аргументов или после `SKIP` промис не резолвится никогда.

Используется [Suspense-хуком][suspense-hook]; в прикладном коде нужен редко.


## См. также

- [Концепция агента][agent-concept] — SWR-fallback, SKIP, жизненный цикл
- [Ресурс — API][api-res] — создание ресурса и метод `createAgent()`
- [Использование ресурса][usage-res] — хук `useResource`, примеры, паттерны
- [Машина состояний][machine] — переходы между статусами записи кэша


[agent-concept]: ../concepts/agent.md
[api-res]: ./resource.md
[usage-res]: ../usage/resource.md
[suspense-hook]: ../../usage/react/README.md#usesuspenseresource
[machine]: ../concepts/machine.md
[cache]: ../concepts/cache.md
