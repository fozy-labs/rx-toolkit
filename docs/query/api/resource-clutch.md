# Сцепление ресурса (ResourceClutch) — API

Сцепление — реактивный наблюдатель, транслирующий состояние [записи кэша][cache] в плоский сигнал с SWR-поведением. Концепция, жизненный цикл и SWR-fallback описаны в [concepts/clutch.md][clutch-concept].


## Создание

```typescript
const clutch = usersResource.createClutch();
```

Метод `createClutch()` доступен у каждого [ресурса][api-res]. Сцепление создаётся без аргументов: сначала их задают через `switch(args)`, затем `start()` запускает запрос.


## Методы

| Метод | Сигнатура | Описание                                                                                                               |
|-------|-----------|------------------------------------------------------------------------------------------------------------------------|
| `state$` | `ReadonlySignal<TResourceClutchState<TArgs, TData, TError>>` | Сигнал состояния сцепления. |
| `start` | `() => void` | Переводит сцепление в «запущенное» состояние и запускает запрос для уже установленных через `switch` аргументов. Аргументов не принимает; если их ещё нет — запрос стартует со следующего `switch`. |
| `switch` | `(args: TArgsOrVoidOrSkip<TArgs>, options?: TClutchSwitchOptions) => void` | Устанавливает наблюдаемые args. До `start()` запрос не инициирует; после — смена args сразу запускает запрос для новых аргументов. При передаче `SKIP` сцепление переходит в `idle`. Необязательный `options.markPending` (по умолчанию `false`) заставляет ещё не запущенное сцепление отдавать `pending` вместо `idle`. |
| `adoptPrevious` | `(source: IResourceClutch<TArgs, TData, TError>) => void` | Переносит SWR-fallback с другого сцепления: текущую запись `source`, если в ней есть данные (`success` / `invalidating` / `invalidate-error`), иначе его собственный предыдущий слот. Для случаев, когда сцепление не мутируют через `switch`, а заменяют новым — так работают React-хуки (одно сцепление на набор args). `source` читается один раз и не удерживается. |
| `retry` | `() => void` | Повторяет запрос после ошибки: `error → pending`, `invalidate-error → invalidating`. Загрузка помечена `isRetrying`, ошибка остаётся в `error` до завершения. Вне состояний ошибки — no-op. |
| `invalidate` | `() => void` | Помечает данные устаревшими и перезапрашивает их в фоне (`success` / `invalidate-error → invalidating`, `error: null`), при ошибке сохраняет устаревшие данные. |
| `whenSettled` | `() => Promise<void>` | Промис выхода из фазы первичной загрузки. См. [ниже](#whensettled). |
| `args` | `TArgs \| null` | Геттер: аргументы текущего наблюдения. Заполняется в `switch` (до `start`), сбрасывается в `null` при `SKIP`. |


## Состояние (TResourceClutchState)

`TResourceClutchState` — **дискриминированное объединение** по `status`: каждый статус — отдельный вариант с литеральными булевыми флагами и точными типами `data` / `error`. Проверка `status`, `isSuccess`, `isError` и т. д. сужает тип:

```typescript
const state = clutch.state$();

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
| `status` | `TClutchStatus` | Текущий статус сцепления. См. таблицу вариантов ниже. |
| `data` | `TData \| null` | Данные. При SWR-fallback содержит устаревшие данные предыдущей записи. |
| `error` | `TError \| null` | Ошибка текущего запроса. По умолчанию `unknown`; типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror). |
| `args` | `TArgs \| null` | Аргументы текущего наблюдения. `null` только в `idle`. |
| `dataArgs` | `TArgs \| null` | Аргументы, для которых загружены `data`. Совпадают с `args`, кроме SWR-fallback при смене аргументов — тогда это аргументы предыдущей записи. `null`, когда `data: null`. |
| `isLoading` | `boolean` | `true` при любой загрузке (`pending` или `invalidating`). |
| `isInitialLoading` | `boolean` | `true` только при первичной загрузке (`pending`). |
| `isRefreshing` | `boolean` | `true` при фоновом перезапросе после инвалидации (SWR). |
| `isSwitching` | `boolean` | `true`, если под `invalidating` идёт первичная загрузка новых аргументов, а `data` — от предыдущих (`dataArgs`). Отличает смену аргументов от `invalidate()` той же записи. |
| `isRetrying` | `boolean` | `true`, если загрузка (`pending` / `invalidating`) запущена через `retry()`; `error` при этом хранит повторяемую ошибку, `isError` — `false`. Первичная загрузка и `invalidate()` дают `false`. |
| `isRefreshError` | `boolean` | `true`, если фоновый перезапрос завершился ошибкой. |
| `isSuccess` | `boolean` | `true`, если данные получены успешно. |
| `isError` | `boolean` | `true`, если запрос завершился ошибкой. |
| `retry` | `() => void` | Метод для повторного запроса, при ошибке. |
| `invalidate` | `() => void` | Метод для инвалидации данных с фоновым перезапросом. |

## Варианты состояния

Типы вариантов экспортируются: `TResourceClutchIdleState`, `TResourceClutchPendingState`, `TResourceClutchSuccessState`, `TResourceClutchErrorState`, `TResourceClutchInvalidatingState`, `TResourceClutchInvalidateErrorState`.

| Статус | `data` | `error` | `dataArgs` | `isLoading` | `isInitialLoading` | `isRefreshing` | `isSwitching` | `isRetrying` | `isRefreshError` | `isSuccess` | `isError` | Описание |
|--------|:------:|:-------:|:----------:|:-----------:|:-------------------:|:--------------:|:-------------:|:------------:|:-----------------:|:-----------:|:---------:|----------|
| `idle` | `null` | `null` | `null` | — | — | — | — | — | — | — | — | Наблюдение не активно: аргументы ещё не заданы, передан `SKIP`, либо сцепление не запущено и `switch` вызывался без `markPending`. |
| `pending` | `null` | `null` / `TError`³ | `null` | ✓ | ✓ | — | — | `boolean`³ | — | — | — | Первичный запрос в процессе. |
| `success` | `TData` | `null` | `TArgs` | — | — | — | — | — | — | ✓ | — | Данные получены. |
| `error` | `TData \| null`¹ | `TError` | `TArgs \| null`¹ | — | — | — | — | — | — | — | ✓ | Запрос завершился ошибкой. |
| `invalidating` | `TData` | `null` / `TError`³ | `TArgs` | ✓ | — | ✓ | `boolean`² | `boolean`³ | — | — | — | Загрузка за устаревшими `data`: `invalidate()` текущей записи либо первичная загрузка новых аргументов (SWR). |
| `invalidate-error` | `TData` | `TError` | `TArgs` | — | — | — | — | — | ✓ | — | ✓ | Фоновый перезапрос завершился ошибкой; устаревшие данные сохранены. |

¹ Обычно `null`; при смене аргументов под SWR `data` содержит устаревшие данные предыдущей записи, а `dataArgs` — её аргументы.

² `true` при смене аргументов под SWR (`data` и `dataArgs` — от предыдущей записи, `args` — новые), `false` при `invalidate()` той же записи (`dataArgs === args`).

³ `isRetrying: true` — загрузка запущена через `retry()` (`error → pending`, `invalidate-error → invalidating`); `error` хранит повторяемую ошибку, хотя `isError: false`. Иначе `isRetrying: false`, `error: null`. `isRetrying` и `isSwitching` независимы: `retry()` после ошибки под SWR даёт оба `true`.

```typescript
if (state.isRefreshing) {
  state.isSwitching
    ? `Загружаем ${state.args.id}, показываем ${state.dataArgs.id}`
    : `Обновляем ${state.args.id}`;
}

// Не показывать данные, пока повторяется упавший перезапрос
if (state.isError || state.isRetrying) {
  return <ErrorPanel error={state.error} loading={state.isRetrying} />; // error: TError
}
```


## whenSettled

Резолвится, когда `status` перестаёт быть `idle` / `pending`.

- **Никогда не реджектится.** Ошибка читается из состояния.
- **Инстанс кэшируется** на одну фазу загрузки и сбрасывается после settle.
- **`idle` не считается settled.** На сцеплении без аргументов или после `SKIP` промис не резолвится никогда.

Используется [Suspense-хуком][suspense-hook]; в прикладном коде нужен редко.


## См. также

- [Концепция сцепления][clutch-concept] — SWR-fallback, SKIP, жизненный цикл
- [Ресурс — API][api-res] — создание ресурса и метод `createClutch()`
- [Использование ресурса][usage-res] — хук `useResource`, примеры, паттерны
- [Машина состояний][machine] — переходы между статусами записи кэша


[clutch-concept]: ../concepts/clutch.md
[api-res]: ./resource.md
[usage-res]: ../usage/resource.md
[suspense-hook]: ../../usage/react/README.md#usesuspenseresource
[machine]: ../concepts/machine.md
[cache]: ../concepts/cache.md
