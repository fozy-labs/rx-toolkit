# Ресурс (Resource) — API

Ресурс — абстракция для чтения данных с кэшированием и SWR. Примеры и паттерны — см. [руководство по использованию][usage].


## Создание

```typescript
const usersResource = api.createResource({
    queryFn: async (args: { page: number }, abortSignal) => {
        const res = await fetch(`/api/users?page=${args.page}`, { signal: abortSignal });
        return res.json();
    },
    key: 'users',
});
```


## Опции

| Опция               | Тип                                                         | По умолчанию      | Описание                                                            |
|----------------------|-------------------------------------------------------------|-------------------|---------------------------------------------------------------------|
| `queryFn`            | `(args: TArgs, abortSignal: AbortSignal) => Promise<TData> \| Observable<TData>` | **обязательный**  | Функция запроса данных. `Observable` делает запись «живой»: она обновляется с каждой эмиссией. См. [стриминговые запросы][usage-stream]. |
| `key`                | `string`                                                    | —                 | Префикс для ключей кэша и devtools.                                 |
| `retentionTime`      | `number \| false \| ((args, state) => number \| false)`     | `60_000`          | Время (мс) удержания записи после потери подписчиков. `false` — не удалять. Функция вычисляется на каждом переходе записи в удержание; `state` — состояние записи (`TResourceEntryState`, то же, что у [`getState`](#getstate)) без варианта `idle`. См. [время удержания записи][cache-retention]. Переопределяет `resourceRetentionTime` из [API][api-readme]. |
| `invalidateInFlight` | `TInFlightPolicy` — `'cancel' \| 'trail' \| 'join'`        | `'cancel'`        | Что `invalidate` делает с запросом в полёте: `cancel` — прерывает его и перезапрашивает, `trail` — даёт доработать и перезапрашивает следом, `join` — ничего: результат текущего запроса считается ответом на инвалидацию (даже если запрос ушёл до мутации). Параметр вызова `invalidate(args, { inFlight })` и конфиг [связи][usage-links] перекрывают. См. [инвалидация в полёте][cache-inflight]. |
| `serializeArgs`      | `(args: TArgs) => string`                                   | `stableStringify` | Сериализация аргументов в кэш-ключ.                                 |
| `onCacheEntryAdded`  | `TLifecycleHookOption<(args, ctx) => void>`                 | —                 | Вызывается при создании кэш-записи. Принимает один хук или их массив. См. [lifecycle hooks][usage-lifecycle]. |
| `onQueryStarted`     | `TLifecycleHookOption<(args, ctx) => void \| Promise<void>>` | —                 | Вызывается при каждом запуске `queryFn`. Принимает один хук или их массив. См. [lifecycle hooks][usage-lifecycle]. |
| `placeholderData`    | `(args: TArgs, previous: { data, args } \| null) => { data } \| null` | —       | Данные, которые показать, пока для `args` в кэше ничего нет. См. [placeholderData](#placeholderdata). |
| `snapshotValidTime`  | `number \| false`                                           | наследуется от API | Время (мс) валидности гидрированных из снимка данных (в [API][api-readme] по умолчанию `false`). См. [снимок][usage-snapshot]. |
| `snapshotable`       | `boolean`                                                   | `true`            | При `false` ресурс не попадает в `getSnapshot()` и не гидрируется из `initialSnapshot` (даже с заданным `key`). Для производных ресурсов, чьи данные принадлежат другому ресурсу; [проекционные ресурсы][usage-projection] выставляют это автоматически. |
| `sync`               | `boolean`                                                   | `false`           | Включить/отключить [кросс-табовую синхронизацию][usage-broadcast]. Игнорируется, если `syncDriver` не задан в API. |
| `allowStreamPatches` | `boolean`                                                   | `false`           | Подавляет однократное предупреждение при `createPatch` на записи с открытым [стримом][usage-stream] (эмиссии ребейзят активные патчи, закоммиченный патч растворяется в следующей эмиссии). |


### Опции класса (Resource)

| Опция         | Тип                                                     | По умолчанию | Описание                   |
|---------------|---------------------------------------------------------|--------------|----------------------------|
| `beforeQuery` | `(resourceKey: string, entryKey: string) => Promise<{ data: TData } \| null>` | —            | Вызывается перед `queryFn`. Вернув `{ data }`, подменяет результат запроса; `null` — запрос выполняется как обычно. Внутренний хук [кросс-табовой синхронизации][usage-broadcast]. |
| `mapError`    | `TMapError`                                             | `identity`   | Нормализатор ошибок; проставляется из `createApi({ mapError })`. |
| `snapshot`    | `TResourceSnapshot`                                     | —            | Записи для гидрации из [снимка][usage-snapshot]. |


## placeholderData

```typescript
placeholderData?: (
    args: TArgs,
    previous: { data: TData; args: TArgs } | null,
) => { data: TData } | null;
```

Синтезирует данные, которые показывать, пока для `args` в кэше ничего нет. Результат отдаётся как [`dataSource: "placeholder"`][clutch-datasource] и **в кэш не попадает**: запись кэша о нём не знает.

- `{ data }` — показать `data`. Плейсхолдер приоритетнее данных предыдущих args.
- `null` — поведение без опции: данные предыдущих args, если они есть, иначе ничего.
- `previous` — SWR-fallback на момент вызова: данные предыдущих args вместе с их аргументами, либо `null`.

Опция вызывается **один раз на ключ args**. Повтор (`retry()`) и инвалидация результат не пересчитывают; `previous` берётся на момент первого вызова, поэтому фоновое обновление предыдущей записи его тоже не меняет. При попадании в кэш опция не вызывается вовсе. Запомненный результат сбрасывается при смене args, при `SKIP` и при успехе текущих args; `adoptPrevious` его не переносит.

Опция синхронная и не должна бросать: она вызывается при вычислении состояния сцепления (то есть и в рендере React), поэтому исключение из неё не проходит через `mapError` и не становится состоянием `error`, а всплывает к читателю состояния.

Что важнее — плейсхолдер или данные предыдущих args — решает сама опция:

```typescript
// Данные предыдущих args важнее: плейсхолдер только на холодном старте
placeholderData: (_args, previous) => (previous ? null : { data: SKELETON_USER }),

// Плейсхолдер важнее: частичный элемент из уже загруженного списка
placeholderData: (args) => {
    const item = usersListResource.getState().data?.find((user) => user.id === args.id);
    return item ? { data: item } : null;
},
```

[Проекционные ресурсы][usage-projection] опции не имеют — и, как следствие, её не имеют страницы `useInfiniteResource`.


## Методы

| Метод          | Параметры                                     | Возвращаемое значение     | Описание                                                                                                                             |
|----------------|-----------------------------------------------|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `invalidate`   | `args: TArgsOrKeyed<TArgs>, options?: { inFlight?: TInFlightPolicy }` | `void`  | Помечает запись устаревшей. [Удерживаемую][cache-holds] перезапрашивает в фоне (SWR) сразу, тающую — при следующем удержании; упавшую — перезапрашивает, сняв ошибку. При запросе в полёте — по `options.inFlight`, иначе по опции `invalidateInFlight`. См. [инвалидация тающей записи][cache-invalidation] и [в полёте][cache-inflight]. |
| `getEntry`     | `args: TArgsOrVoid<TArgs>, doInitiate = false`       | `IQueryCacheEntry \| null` | Синхронно возвращает кэш-запись. При `doInitiate = true` создаёт отсутствующую, и тип сужается до `IQueryCacheEntry`.                  |
| `getState`     | `args: TArgsOrVoid<TArgs>`                     | `TResourceEntryState<TArgs, TData, TError>` | Синхронно возвращает упрощённое состояние ресурса (`status`, `data`, `error`, флаги) без подписки на изменения. См. [getState](#getstate). |
| `getEntry$`    | `args: TArgsOrVoid<TArgs>, doInitiate = false` | `ReadonlySignal<IQueryCacheEntry \| null>` | Реактивный аналог `getEntry`: возвращает **сигнал**, зависимость возникает при его чтении в реактивном контексте. При `doInitiate = true` чтение сигнала создаёт и запускает запись, если её нет (лениво, при первом чтении), поэтому сигнал всегда отдаёт запись. |
| `getEntries`   | —                                             | `IterableIterator<IQueryCacheEntry>` | Итератор по всем живым кэш-записям ресурса.                                                                     |
| `createClutch` | —                                             | `IResourceClutch<TArgs, TData, TError>` | Создаёт реактивное [сцепление][clutch] — наблюдатель за ресурсом с SWR-поведением.                                                   |
| `serialize`    | `args: TArgsOrKeyed<TArgs>`                           | `string`                  | Возвращает строковый ключ кэша для заданных аргументов.                                                                              |
| `toKeyed`      | `args: TArgsOrKeyed<TArgs>`                           | `TKeyed<TArgs>`            | Оборачивает аргументы в пару `{ value, key }` — для передачи в методы, минуя повторную сериализацию.                                 |
| `bind`         | `args: TArgsOrKeyed<TArgs>`                           | `TBoundResource<TArgs, TData, TError>` | Связывает ресурс с аргументами в инертный дескриптор `{ kind: "resource", resource, args }`. Ничего не запускает — потребитель отдаёт дескриптор обратно библиотеке. См. [bind][bind]. |
| `ensure`       | `args: TArgsOrKeyed<TArgs>, options?: { signal? }`    | `Promise<TData>`         | Отдаёт кэшированные данные мгновенно, если они есть; иначе запускает запрос и ждёт. Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `fetch`        | `args: TArgsOrKeyed<TArgs>, options?: { signal?, inFlight? }` | `Promise<TData>`   | Возвращает результат свежего запроса: перезапрашивает кэш; запрос в полёте — по `options.inFlight` (по умолчанию `cancel`: прерывает и ждёт новый; `trail` — даёт доработать и ждёт следующий; `join` — ждёт его). Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `prefetch`     | `args: TArgsOrKeyed<TArgs>, options?: { force?: false } \| { force: true, inFlight? }` | `Promise<void>`   | Fire-and-forget прогрев кэша: создаёт запись синхронно, переиспользует кэш (`force: true` — форсит свежие данные, как `fetch`, вместе с `inFlight`; без `force: true` `inFlight` — ошибка типов), никогда не реджектит, не abort-aware. См. [ensure / fetch / prefetch][fetch-methods]. |

### Только на классе `Resource`

Эти члены объявлены на классе, но **не входят в `IResource`** — тип, который возвращает `api.createResource()`.

| Метод           | Параметры     | Возвращаемое значение      | Описание                                                                                        |
|-----------------|---------------|----------------------------|-------------------------------------------------------------------------------------------------|
| `getEntryByKey` | `key: string` | `IQueryCacheEntry \| null` | Прямой lookup по сериализованному ключу (как его отдаёт `serialize`), без повторной сериализации. |
| `reset`         | —             | `void`                     | Завершает и удаляет все кэш-записи ресурса. Публичного эквивалента для одного ресурса нет: `api.resetAll()` чистит весь кэш.                  |

### Расширения

| Метод          | Параметры                                      | Возвращаемое значение   | Описание                                                                       |
|----------------|------------------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| `useResource`  | `args: TArgsOrVoidOrSkip<TArgs>` | `TResourceClutchState<TArgs, TData, TError>` | React-хук. Требует `reactHooksPlugin()`. Подписывается на данные.              |
| `useSuspenseResource` | `args: TArgsOrVoid<TArgs>` | `TSuspenseResourceState<TArgs, TData, TError>` | React-хук с Suspense: возвращает состояние, как только есть что показать (`hasData`); ошибка без данных уходит в Error Boundary, остальное приостанавливает рендер. `data` всегда не `null`. `SKIP` не поддерживается. |
| `useInfiniteResource` | `initialArgs: TArgsOrVoidOrSkip<TArgs>` | `TInfiniteResourceState<TArgs, TData, TError>` | React-хук бесконечной подгрузки. **Только на [проекционных ресурсах][usage-projection]** (обычным ресурсам не добавляется). Требует `reactHooksPlugin()`. |


## Что запускает запрос

Выполнение `queryFn` можно инициировать несколькими способами. Они различаются по трём осям: **создаёт ли холодную запись**, **форсит ли свежие данные** и **как отдаёт результат**. Запись запускает `queryFn` при создании, если ей не передано начальное состояние.

### Императивные методы

| Метод                      | Когда запускает запрос                                                                                  | Форсит свежие?                | Возврат                   | Abort-aware | Ошибка       |
|----------------------------|--------------------------------------------------------------------------------------------------------|-------------------------------|---------------------------|-------------|--------------|
| `ensure(args, opt?)`       | холодная → создаёт; `error` → ретрай                                                                    | нет (кэш/устаревшие отдаёт сразу) | `Promise<TData>`      | да          | реджект      |
| `fetch(args, opt?)`        | холодная → создаёт; `success`/`invalidate-error` → `invalidate`; `error` → ретрай; `pending`/`invalidating` без запроса в полёте → запуск; in-flight (открытый стрим в `success` тоже) → по `opt.inFlight`: `cancel` (по умолчанию) прерывает и ждёт новый, `trail` даёт доработать и ждёт следующий, `join` ждёт его | да (кроме `join` на запросе в полёте) | `Promise<TData>`          | да          | реджект      |
| `prefetch(args, opt?)`     | холодная → создаёт; `error` → ретрай; с `force: true` — как `fetch`                                     | только при `force: true`      | `Promise<void>`           | нет         | проглатывает |
| `getEntry(args, true)`     | холодная → создаёт и запускает                                                                          | нет                           | `IQueryCacheEntry \| null` | нет         | —            |
| `invalidate(args, opt?)`   | **только** существующая: удерживаемая → перезапрос с очисткой ошибки, тающая → метка и перезапрос при следующем удержании; in-flight → по `inFlight` (`cancel` перезапускает, `trail` дожидается и перезапрашивает следом, `join` — no-op); холодную **не создаёт** | да (фоновый SWR)              | `void`                    | нет         | —            |

Тонкости, которые легко перепутать:

- `prefetch(args)` без `force` **не перезапрашивает** уже закэшированные данные — лишь гарантирует, что запись существует и запущена (сценарий «запустить и забыть»). Запись при этом создаётся синхронно, до разрешения промиса.
- `invalidate(args)` ничего **не создаёт**: на отсутствующей записи это no-op (в отличие от `fetch` и `prefetch(args, { force: true })`, которые холодную создадут).
- `invalidate(args)` на записи без удержаний запрос **не запускает** — только помечает её; запрос нужен сейчас — это `fetch` / `prefetch(args, { force: true })`. Кто удерживает запись — в [кэше][cache-holds].
- `getEntry(args, true)` — единственный геттер, создающий запись при отсутствии. Без флага (по умолчанию) — чистый lookup.

Детали `ensure`/`fetch`/`prefetch` (отмена, окно retention) — в разделе [ensure / fetch / prefetch][fetch-methods].

### Реактивный путь

`useResource(args)` и сцепление (`createClutch`) при подписке сами создают и запускают запись (через внутренний `_getOrCreate`), инициируя холодный запрос при монтировании. Сцепление дополнительно отдаёт `retry()` / `invalidate()`, делегирующие в одноимённые методы записи.

`getEntry$(args, true)` инициирует запрос **лениво при чтении сигнала**: первое чтение создаёт и запускает отсутствующую запись (и пересоздаёт её после удаления), поэтому само чтение имеет побочный эффект — стартует `queryFn` и вызывает хуки. `getEntry$(args)` / `getEntry$(args, false)` остаётся чистым наблюдателем (см. ниже).

### Примитивы на записи

Если на руках есть `QueryCacheEntry` (из `getEntry` / `getEntries`), `queryFn` перезапускают:

- `entry.invalidate(opt?)` — из `success` / `invalidate-error` / `error` (перезапуск с очисткой `error`; из `success` и `invalidate-error` — фоновый, с сохранением данных); на тающей записи (`entry.isMelting`) — метка `entry.isInvalidated`, перезапуск при первом удержании; при запросе в полёте — по `inFlight`, см. [инвалидация в полёте][cache-inflight];
- `entry.retry()` — из `error` / `invalidate-error` (повтор после ошибки: ошибка остаётся в `error` до следующего settle).

### Что НЕ запускает запрос

- `getState(args)` — read-only снимок состояния (внутри `getEntry(args, false)`); удержания не создаёт, помеченную запись не ревалидирует.
- `getEntry(args)` / `getEntry(args, false)` — lookup без создания.
- `getEntry$(args)` / `getEntry$(args, false)` — реактивный **read-only**: чтение не меняет кэш и отдаёт `null`, пока записи нет. (`getEntry$(args, true)` — наоборот, инициирует лениво при чтении; см. «Реактивный путь».)
- `serialize`, `toKeyed`, `getEntries`, `bind` — утилиты и связывание (а также `reset` на классе).
- Гидрация снапшотом (`createApi({ initialSnapshot })`) — создаёт запись и `queryFn` **не** запускает. Записи, помеченные устаревшими (по `snapshotValidTime`, по `isStale: true` в снимке либо со статусом `invalidate-error` — такие считаются устаревшими всегда), гидрируются в `success` с меткой `entry.isInvalidated`; перезапрос стартует при первом удержании, см. [снимок][usage-snapshot].


## getState

`getState(args)` — синхронный read-only снимок `TResourceEntryState` без подписки на изменения и без [удержания][cache-holds] (внутри `getEntry(args, false)`, кэш **не создаёт**, таймер удержания не трогает). Поля, флаги и правила сужения — те же, что у [состояния сцепления][clutch-state], с двумя отличиями:

- `dataSource` сужен до `none | current`: запись одна, данных предыдущих args и плейсхолдера у неё нет. Поэтому `isSwitching` здесь всегда `false`, а `dataArgs` при `hasData` всегда равны `args`.
- `idle` означает «записи в кэше ещё/уже нет» (у сцепления — `SKIP` или отсутствие args).

Доступны [строки][clutch-status] 1, 2, 5, 6, 7, 9, 10, 12; варианты экспортируются как `TResourceEntryIdleState`, `TResourceEntryPendingNoneState`, `TResourceEntryPendingCurrentState`, `TResourceEntrySuccessState`, `TResourceEntryErrorState`. Методов (`retry` / `invalidate`) у снимка нет — они есть у записи и у сцепления.

Упавший перезапрос (запись в `invalidate-error`) — это строка 9: `status: 'error'`, `dataSource: 'current'`, устаревшие данные остаются в `data`.

`isPending` / `isInvalidating` здесь не всегда значат запрос в полёте. `getState` не удерживает запись, поэтому видит и то, чего не застаёт работающее сцепление: запись без удержаний, чей запрос прервал `invalidate()` в режиме `cancel`. Её статус остаётся `pending` / `invalidating`, `entry.isInvalidated === true`, а запроса в полёте нет — он уйдёт при следующем удержании. Флаги в таком состоянии значат «запрос причитается», см. [инварианты сцепления][clutch-invariants].


## Bind

`bind` связывает ресурс с аргументами в инертный дескриптор — он ничего не запускает и не трогает кэш. Это удобно, когда потребитель хочет вернуть библиотеке описание «что прочитать и с какими аргументами», не выполняя запрос сам:

```typescript
const bound = getUserById.bind({ userId: 1 });
// → { kind: "resource", resource: getUserById, args: { userId: 1 } }

// Позже библиотека/потребитель разворачивает дескриптор:
void bound.resource.prefetch(bound.args);
```

Дескриптор дискриминируется полем `kind`, что позволяет в одном месте обрабатывать и ресурсы, и команды (см. [`TBound`][command-bind] в API команды).


## ensure / fetch / prefetch

> Низкоуровневые `whenLoaded` / `whenFetched` на записи остаются `@experimental`; сами `ensure` / `fetch` / `prefetch` — стабильный API.

Императивные промис-методы для кода вне реактивного контекста — прежде всего загрузчиков роутеров (TanStack Router и т.п.) и прогрева кэша. Все три при необходимости создают кэш-запись и переиспользуют существующую.

| Метод      | Кэш-хит                              | Холодный / упавший                | Возврат          | Ошибка    |
|------------|--------------------------------------|-----------------------------------|------------------|-----------|
| `ensure`   | отдаёт данные сразу (в т.ч. устаревшие) | запускает запрос и ждёт; упавший ретраит | `Promise<TData>` | реджект   |
| `fetch`    | перезапрашивает и ждёт свежий результат | запускает запрос и ждёт           | `Promise<TData>` | реджект   |
| `prefetch` | переиспользует данные; `force: true` — перезапрашивает | запускает запрос и ждёт | `Promise<void>`  | проглатывает |

`prefetch(args, { force: true })` — fire-and-forget аналог `fetch`: прогревает кэш заведомо свежими данными (существующую запись перезапрашивает, упавшую ретраит), при этом никогда не реджектит.

> При включённой [кросс-табовой синхронизации][usage-broadcast] (`sync: true`) холодная запись сначала спрашивает данные у других вкладок (`beforeQuery`): `fetch` и `prefetch({ force: true })`, создающие **холодную** запись, могут отдать данные соседней вкладки вместо собственного сетевого запроса. Ожидание ответа вкладок — запрос записи в полёте: `fetch` на такой записи идёт по своему `inFlight` — `join` дожидается ответа (а при его отсутствии — запроса, в который ожидание перешло), `cancel` (по умолчанию) отправляет свой запрос, `trail` отправляет его после ответа. «Свежесть» здесь означает «свежее содержимое кэша», а не гарантированный запрос из этой вкладки.

```typescript
// TanStack Router loader: данные нужны для рендера → ensure (abort-aware)
export const Route = createFileRoute('/users/$id')({
    loader: ({ params, abortController }) =>
        usersResource.ensure({ id: params.id }, { signal: abortController.signal }),
});

// Спекулятивный прогрев на hover → prefetch (переживает навигацию)
<Link onMouseEnter={() => usersResource.prefetch({ id })} ... />
```

### `prefetch` и `no-floating-promises`

Промис `prefetch` никогда не реджектится, поэтому игнорировать его безопасно. Но правило [`@typescript-eslint/no-floating-promises`][no-floating-promises] этого не знает и требует пометить вызов оператором `void`:

```typescript
void usersResource.prefetch({ page: 1 });
```

Пометка здесь не несёт информации — обрабатывать нечего. Если этот шум мешает, разрешите `prefetch` точечно, не отключая правило (опция доступна с `@typescript-eslint` 8.x):

```javascript
"@typescript-eslint/no-floating-promises": ["error", {
    allowForKnownSafeCalls: [
        { from: "package", name: "prefetch", package: "@fozy-labs/rx-toolkit" },
    ],
}]
```

`ensure` и `fetch` при этом продолжают требовать `await` или явной обработки — они реджектятся.

### Отмена (`signal`)

`ensure` и `fetch` принимают `AbortSignal`. Отмена **отвязывает вызывающего** от запроса: возвращённый промис реджектит причиной отмены (`signal.reason`). Сам запрос при этом **не прерывается**, если на кэш-записи есть другие потребители (подписанный компонент, другой `ensure`/`fetch`) — разделяемый in-flight запрос продолжается для них. Запрос, оставшийся без потребителей, сворачивается обычным retention-сборщиком (`retentionTime`), который при срабатывании прерывает `queryFn` через его `AbortSignal`.

`prefetch` намеренно **не** abort-aware — спекулятивный прогрев не должен отменяться при уходе с маршрута.

### Запрос в полёте (`inFlight`)

`fetch(args, { inFlight })` и `prefetch(args, { force: true, inFlight })` решают, что делать с запросом, который уже в полёте на этой записи — в том числе со [стримом][stream-query], открытым в `success`:

| `inFlight`             | Что происходит                                                                                   | Чем резолвится                  |
|------------------------|--------------------------------------------------------------------------------------------------|---------------------------------|
| `cancel` (по умолчанию) | запрос прерывается (`AbortSignal` в `queryFn`), сразу уходит новый                              | результатом нового запроса      |
| `trail`                | запрос дорабатывает, запись помечается, следом уходит новый; открытый стрим — дожидается его завершения | результатом следующего запроса — исход текущего пропускается, даже ошибка |
| `join`                 | ничего не прерывается и не помечается                                                            | результатом текущего запроса; открытый в `success` стрим — уже привезёнными данными |

По умолчанию — `cancel`, **а не** опция ресурса `invalidateInFlight`: `fetch` просит свежий результат, а опция ресурса описывает, насколько доверять запросу в полёте при инвалидации. Без запроса в полёте режим ни на что не влияет: запись перезапрашивается (или ретраится) и ожидается свежий результат. `fetch` удерживает запись, пока ждёт, поэтому под `trail` следующий запрос уходит и на записи без других удержаний. `signal` только отвязывает вызывающего: запущенное `fetch` (прерывание под `cancel`, метка под `trail`) не откатывается. У [проекционного ресурса][usage-projection] набор, чья загрузка приземлилась, запросом в полёте не считается: `fetch` перезагружает его id по `inFlight` — см. [инвалидацию проекции](../usage/projection-resource.md#инвалидация).

### Окно retention

Запись, созданная `ensure`/`prefetch`, удерживается только ожиданием промиса. После того как он разрешился, запускается отсчёт `retentionTime` (по умолчанию 60 000 мс); компонент, подписавшийся в течение этого окна (через `useResource`), отменяет сборку. Это аналог `gcTime`/`keepUnusedDataFor` в других библиотеках — при очень маленьком `retentionTime` возможен повторный запрос.


## См. также

- [Использование ресурса][usage] — примеры, паттерны, состояния
- [Команда — API][command-api] — API мутаций
- [Состояние записи запроса][entry-state] — статусы записи кэша и переходы между ними
- [Сцепление][clutch] — реактивный наблюдатель
- [Сцепление ресурса — API][clutch-api] — полная таблица методов и статусов сцепления
- [Типизация аргументов (Keyed)][keyed] — пайплайн аргументов: args → keyedArgs → key


[usage]: ../usage/resource.md
[usage-lifecycle]: ../usage/lifecycle.md
[bind]: #bind
[fetch-methods]: #ensure--fetch--prefetch
[command-bind]: ./command.md#bind
[command-api]: ./command.md
[entry-state]: ../concepts/query-entry-state.md
[clutch]: ../concepts/clutch.md
[clutch-api]: ./resource-clutch.md
[clutch-status]: ./resource-clutch.md#варианты-состояния
[clutch-state]: ./resource-clutch.md#состояние-tresourceclutchstate
[clutch-datasource]: ./resource-clutch.md#datasource
[api-readme]: ./README.md
[cache-retention]: ../concepts/cache.md#время-удержания-записи
[cache-holds]: ../concepts/cache.md#кто-удерживает-запись
[cache-invalidation]: ../concepts/cache.md#инвалидация-тающей-записи
[cache-inflight]: ../concepts/cache.md#инвалидация-в-полёте
[usage-links]: ../usage/links.md
[usage-broadcast]: ../usage/broadcast.md
[usage-snapshot]: ../usage/snapshot.md
[usage-stream]: ../usage/stream-query.md
[usage-projection]: ../usage/projection-resource.md
[stream-query]: ../usage/stream-query.md
[keyed]: ../concepts/keyed.md
[no-floating-promises]: https://typescript-eslint.io/rules/no-floating-promises/
[clutch-invariants]: ./resource-clutch.md#инварианты
