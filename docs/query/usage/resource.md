# Ресурс (Resource)

Ресурс — абстракция для **чтения данных** с автоматическим кэшированием и stale-while-revalidate (SWR). Для операций записи используйте [команду][command].

Аналог: `useQuery` в TanStack Query, `query endpoint` в RTK Query.


## Создание ресурса

```typescript
const usersResource = api.createResource({
  queryFn: async (args: { page: number }, abortSignal) => {
    const res = await fetch(`/api/users?page=${args.page}`, { signal: abortSignal });
    return res.json();
  },
});
```

`queryFn` — единственная обязательная опция. Принимает аргументы запроса и `AbortSignal`, возвращает промис с данными. При отмене запроса (смена аргументов, размонтирование) сигнал срабатывает автоматически.

Вместо промиса `queryFn` может вернуть `Observable<TData>` — запись станет «живой» и будет обновляться с каждой эмиссией (WebSocket, SSE и т. п.). См. [стриминговые запросы][stream-query].


## Опции

Полный список опций — см. [API-справочник ресурса][api-resource].


## API ресурса

Полный список методов — см. [API-справочник ресурса][api-resource].


## React: useResource

Для работы в React подключите `reactHooksPlugin()` при создании API:

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [reactHooksPlugin()],
});
```

`useResource` — метод на экземпляре ресурса, доступный после подключения плагина:

```tsx
function UsersList({ page }: { page: number }) {
  const { data, error, hasData, hasError } = usersResource.useResource({ page });

  if (!hasData) {
    return hasError ? <ErrorMessage error={error} /> : <Spinner />;
  }

  return (
    <ul>
      {data.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}
```

Поведение хука:

1. При монтировании — запускает запрос с переданными аргументами.
2. При изменении аргументов — автоматически перезапрашивает данные.
3. При размонтировании — отписывается. Кэш-запись сохраняется в течение `retentionTime`.
4. При повторном монтировании с теми же аргументами — данные берутся из кэша мгновенно.


## Условные запросы

Передайте `SKIP` вместо аргументов, чтобы отложить запрос:

```tsx
import { SKIP } from '@fozy-labs/rx-toolkit';

function UserProfile({ userId }: { userId: string | null }) {
  const { data, hasData } = userResource.useResource(
    userId ? { id: userId } : SKIP,
  );

  if (!userId) return <p>Выберите пользователя</p>;
  if (!hasData) return <Spinner />;
  return <h1>{data.name}</h1>;
}
```

`SKIP` полностью останавливает наблюдение — запрос не выполняется, состояние сбрасывается в `idle`.


## Состояния ресурса

`useResource` возвращает объект с полями `status`, `dataSource`, `data`, `error` и булевыми флагами:

| Поле | Тип | Описание |
|---|---|---|
| `status` | `TClutchStatus` | `'idle'` · `'pending'` · `'success'` · `'error'` — что происходит с запросом. |
| `dataSource` | `'none' \| 'placeholder' \| 'previous' \| 'current'` | Что на экране: ничего, [плейсхолдер][placeholder], данные предыдущих аргументов (SWR) или текущих. |
| `data` | `TData \| null` | Данные, соответствующие `dataSource`. |
| `error` | `TError \| null` | Ошибка последнего завершившегося запроса текущих аргументов; живёт до следующего. По умолчанию `unknown`; типизируется опцией API [`mapError`](../api/README.md#типизация-ошибок-maperror). |
| `hasData` | `boolean` | Есть что показать (`dataSource !== 'none'`). |
| `hasError` | `boolean` | `error !== null`. |
| `isPending` | `boolean` | Запрос в полёте. |
| `isInitialLoading` | `boolean` | Запрос в полёте: показать нечего либо только плейсхолдер. |
| `isSwitching` | `boolean` | Запрос в полёте, на экране данные предыдущих аргументов. |
| `isInvalidating` | `boolean` | Запрос в полёте поверх данных текущих аргументов. |
| `args` | `TArgs \| null` | Аргументы текущего наблюдения. |
| `dataArgs` | `TArgs \| null` | Аргументы, для которых загружены `data`. Отличаются от `args` при SWR-fallback; `null` у плейсхолдера. |
| `retry` / `invalidate` | `() => void` | Повторить упавший запрос / перезапросить показанное. |

Состояние — **дискриминированное объединение**: проверка `status`, `dataSource` или любого флага сужает типы остальных полей. `hasData` гарантирует `data: TData` (без `| null`), `hasError` — `error: TError` (без `| null`). Полная таблица вариантов — в [API сцепления ресурса][api-res-clutch].

Рендер данных гейтится по `hasData`, а не по `status`: при инвалидации на экране данные текущих аргументов, но `status` уже `pending` — `switch (status)` без `hasData` показал бы спиннер на каждом обновлении.

```tsx
const state = usersResource.useResource({ page });

if (state.hasData) {
  return <List items={state.data} stale={state.isPending} />; // data: TData, не TData | null
}
if (state.hasError) {
  return <ErrorMessage error={state.error} onRetry={state.retry} />; // error: TError, не TError | null
}
return <Spinner />;
```

Повтор упавшего запроса отдельного флага не имеет: пока он в полёте, истинны и `isPending`, и `hasError`.

### Инвалидация (invalidate)

Вызов `invalidate(args)` или `prefetch(args, { force: true })` обновляет данные **без потери текущего отображения**. Пользователь продолжает видеть прежние данные, пока выполняется новый запрос: `dataSource` остаётся `current`, `isInvalidating` — `true`. Когда ответ приходит, данные обновляются на месте; если запрос падает, прежние данные сохраняются, а состояние становится `status: 'error'` с тем же `dataSource: 'current'`.

### Плавная смена аргументов (SWR)

Когда аргументы `useResource` меняются (например, пользователь переключает страницу), компонент **не сбрасывается в пустое состояние**. Вместо этого на экране остаются данные предыдущего запроса (`dataSource: 'previous'`, `isSwitching: true`), пока загружаются новые. Как только новые данные готовы, они автоматически заменяют старые.

### Заглушка на время загрузки (placeholderData)

Когда показывать нечего — ни данных текущих аргументов, ни предыдущих — ресурс может синтезировать заглушку опцией [`placeholderData`][placeholder]: скелетон, элемент из уже загруженного списка, значение по умолчанию. Она отдаётся с `dataSource: 'placeholder'`, в кэш не попадает и перекрывает данные предыдущих аргументов.


## Императивный API

### prefetch / ensure / fetch

```typescript
// Прогреть кэш, результат не нужен (fire-and-forget, никогда не реджектит)
void usersResource.prefetch({ page: 1 });

// Дождаться данных: кэш-хит отдаётся сразу, холодный запрос запускается и ждётся
const data = await usersResource.ensure({ page: 1 });

// Всегда свежие данные
const fresh = await usersResource.fetch({ page: 1 });
```

Параллельные вызовы с одинаковыми аргументами дедуплицируются — все ждут один общий in-flight запрос. Детали (отмена, retention, `force`) — в [API ресурса][api-resource].

`void` перед `prefetch` нужен только чтобы унять `@typescript-eslint/no-floating-promises`: сам промис не реджектится, обрабатывать нечего. Как разрешить вызов в конфиге линтера и писать без `void` — в [API ресурса][prefetch-lint].

Прежний метод `trigger(args, doForce?)` объявлен **deprecated**: `trigger(args)` ≈ `prefetch(args)`, `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Отличие: на записи в состоянии `error` `prefetch` в обоих режимах делает ретрай, а `trigger` её не трогал.

### invalidate

```typescript
usersResource.invalidate({ page: 1 });
```

Помечает существующую кэш-запись устаревшей и запускает перезапрос — немедленно и независимо от того, есть ли у неё подписчики. Отсутствующую запись **не создаёт**: на неизвестных аргументах это no-op (в отличие от `fetch`). Работает из статусов `success`, `invalidate-error` и `error`; на записи с запросом в полёте (`pending` / `invalidating`) — предупреждение в консоль и no-op.

Ошибку `invalidate()` снимает, `retry()` — сохраняет до следующего ответа. Отсюда и выбор: `retry()`, когда упавший запрос повторяет пользователь и ошибку надо оставить на экране; `invalidate()`, когда данные перепроверяются сами (см. [переходы сцепления][clutch-transitions]).


### getEntry

Синхронно возвращает кэш-запись для указанных аргументов, или `null` если данные ещё не запрашивались. С флагом `doInitiate = true` — создаёт запись и запускает загрузку, если её ещё нет.

```ts
// Проверить, есть ли данные в кэше
const entry = usersResource.getEntry({ page: 1 });
if (entry) {
  console.log(entry.machine$().state.data);
}
```


### getEntry$

Реактивный аналог `getEntry`. **Возвращает сигнал** `ReadonlySignal<IQueryCacheEntry | null>` — не саму запись: вызов ничего не читает и не подписывает, зависимость возникает при чтении полученного сигнала в реактивном контексте (`Signal.compute`, `Signal.effect` и т. д.).

```ts
const entry$ = usersResource.getEntry$({ page: 1 });
Signal.effect(() => console.log(entry$()?.machine$().state.data));
```

Если аргументы реактивны, сигнал пересоздаётся на каждом вычислении — читать его нужно сразу, иначе внешний `Computed` вернёт сигнал и не подпишется на кэш:

```ts
const dynEntry$ = Signal.compute(() => usersResource.getEntry$({ page: page$() })());
//                                                                            ^^ чтение обязательно
```

Второй аргумент `doInitiate` (по умолчанию `false`). При `false` сигнал — чистый наблюдатель: чтение не меняет кэш и отдаёт `null`, пока записи нет. При `true` **чтение** сигнала создаёт и запускает запись, если её нет, поэтому сигнал всегда отдаёт запись — пересоздавая её при чтении даже после удаления. Создание ленивое: оно происходит при первом чтении сигнала, а не в момент вызова `getEntry$`, и само это чтение имеет побочный эффект — стартует запрос и вызывает хуки `onCacheEntryAdded` / `onQueryStarted`. Не используйте `doInitiate: true` там, где чтение должно оставаться чистым (например, в рендере React).

### getState

Синхронно возвращает состояние одной кэш-записи: те же поля и флаги, что у сцепления, но `dataSource` сужен до `none | current` — ни данных предыдущих аргументов, ни плейсхолдера у записи нет. Методов `retry` / `invalidate` в снимке тоже нет. Подробнее — в [API ресурса][api-getstate].

Подходит для императивной логики вне реактивного контекста, когда нужна моментальная проверка состояния без подписки:

```ts
const state = usersResource.getState({ page: 1 });

if (state.hasData) {
  console.log(state.data);
}
```

### createClutch

Сцепление — реактивный наблюдатель ресурса.
Оно отслеживает текущую и при необходимости предыдущую запись кэша,
объединяя их в плоский вычисляемый сигнал.
Сцепление является строительным блоком для React-хука `useResource` и не требует явного уничтожения — внутренние сигналы деактивируются при потере подписчиков.
Полная таблица методов и статусов — в [API сцепления ресурса][api-res-clutch].

```ts
const clutch = usersResource.createClutch();
clutch.switch({ page: 1 });
clutch.start();
// clutch.state$() → { status: "pending", dataSource: "none", data: null, isInitialLoading: true, ... }
```

При смене аргументов через `switch(newArgs)` сцепление реализует SWR-поведение:
    если предыдущая запись **уже содержит данные** (статус записи `success`, `invalidating` или `invalidate-error`),
    они остаются в `data` с `dataSource: "previous"`, пока не придёт новый ответ.
Это позволяет показывать устаревшие данные вместо пустого состояния.
Если предыдущий запрос ещё не завершился (`pending`), переносить нечего — сцепление уйдёт в `pending` с `dataSource: "none"`.

```ts
// page:1 уже загрузилась (success)
clutch.switch({ page: 2 }); // SWR: data от page:1, dataSource: "previous", isSwitching: true
clutch.switch(SKIP);        // idle: data: null, dataSource: "none"
```


## Связи (Links)

Связи позволяют декларативно связать команду с ресурсами — подробнее в [руководстве по связям][links].


## Хуки жизненного цикла

Хуки позволяют реагировать на события кэша — подробнее в [руководстве по жизненному циклу][lifecycle].


## См. также

- [Команда][command] — мутации (создание, обновление, удаление)
- [Стриминговые запросы][stream-query] — `Observable` в queryFn: живые данные
- [Машина состояний запроса][machine] — детали переходов между статусами
- [Кэш][cache] — система кэширования записей
- [Сцепление][clutch] — SWR-наблюдатель, связывающий UI с записью кэша
- [Кросс-табовая синхронизация][broadcast] — синхронизация кэша между вкладками

[command]: ./command.md
[stream-query]: ./stream-query.md
[machine]: ../concepts/machine.md
[api-resource]: ../api/resource.md
[prefetch-lint]: ../api/resource.md#prefetch-и-no-floating-promises
[lifecycle]: ./lifecycle.md
[links]: ./links.md
[cache]: ../concepts/cache.md
[clutch]: ../concepts/clutch.md
[api-res-clutch]: ../api/resource-clutch.md
[clutch-transitions]: ../api/resource-clutch.md#переходы
[api-getstate]: ../api/resource.md#getstate
[placeholder]: ../api/resource.md#placeholderdata
[broadcast]: ./broadcast.md
