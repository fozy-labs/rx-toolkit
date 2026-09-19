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
| `retentionTime`      | `number \| false`                                           | `60_000`          | Время (мс) удержания записи после потери подписчиков. `false` — не удалять. Переопределяет `resourceRetentionTime` из [API][api-readme]. |
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

Синтезирует данные, которые показывать, пока для `args` в кэше ничего нет. Результат отдаётся как [`dataSource: "placeholder"`][clutch-datasource] и **в кэш не попадает**: ни машина состояний, ни запись кэша о нём не знают.

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
| `trigger`        | `args: TArgsOrKeyed<TArgs>, doForce = false`          | `void`                    | **Deprecated.** Используйте `prefetch`: `trigger(args)` ≈ `prefetch(args)`, `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Отличие: на записи в состоянии `error` `prefetch` в обоих режимах делает ретрай, а `trigger` её не трогал. Будет удалён в одном из следующих релизов. |
| `invalidate`   | `args: TArgsOrKeyed<TArgs>`                           | `void`                    | Помечает запись устаревшей и перезапрашивает её в фоне (SWR); упавшую — перезапрашивает, сняв ошибку.                                |
| `getEntry`     | `args: TArgsOrVoid<TArgs>, doInitiate = false`       | `IQueryCacheEntry \| null` | Синхронно возвращает кэш-запись. При `doInitiate = true` создаёт отсутствующую, и тип сужается до `IQueryCacheEntry`.                  |
| `getState`     | `args: TArgsOrVoid<TArgs>`                     | `TResourceEntryState<TArgs, TData, TError>` | Синхронно возвращает упрощённое состояние ресурса (`status`, `data`, `error`, флаги) без подписки на изменения. См. [getState](#getstate). |
| `getEntry$`    | `args: TArgsOrVoid<TArgs>, doInitiate = false` | `ReadonlySignal<IQueryCacheEntry \| null>` | Реактивный аналог `getEntry`: возвращает **сигнал**, зависимость возникает при его чтении в реактивном контексте. При `doInitiate = true` чтение сигнала создаёт и запускает запись, если её нет (лениво, при первом чтении), поэтому сигнал всегда отдаёт запись. |
| `getEntries`   | —                                             | `IterableIterator<IQueryCacheEntry>` | Итератор по всем живым кэш-записям ресурса.                                                                     |
| `createClutch` | —                                             | `IResourceClutch<TArgs, TData, TError>` | Создаёт реактивное [сцепление][clutch] — наблюдатель за ресурсом с SWR-поведением.                                                   |
| `serialize`    | `args: TArgsOrKeyed<TArgs>`                           | `string`                  | Возвращает строковый ключ кэша для заданных аргументов.                                                                              |
| `toKeyed`      | `args: TArgsOrKeyed<TArgs>`                           | `TKeyed<TArgs>`            | Оборачивает аргументы в пару `{ value, key }` — для передачи в методы, минуя повторную сериализацию.                                 |
| `bind`         | `args: TArgsOrKeyed<TArgs>`                           | `TBoundResource<TArgs, TData, TError>` | Связывает ресурс с аргументами в инертный дескриптор `{ kind: "resource", resource, args }`. Ничего не запускает — потребитель отдаёт дескриптор обратно библиотеке. См. [bind][bind]. |
| `ensure`       | `args: TArgsOrKeyed<TArgs>, options?: { signal? }`    | `Promise<TData>`         | Отдаёт кэшированные данные мгновенно, если они есть; иначе запускает запрос и ждёт. Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `fetch`        | `args: TArgsOrKeyed<TArgs>, options?: { signal? }`    | `Promise<TData>`         | Всегда возвращает результат свежего запроса (перезапрашивает кэш, дедуплицирует in-flight). Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `prefetch`     | `args: TArgsOrKeyed<TArgs>, options?: { force? }`     | `Promise<void>`          | Fire-and-forget прогрев кэша: создаёт запись синхронно, переиспользует кэш (`force: true` — форсит свежие данные), никогда не реджектит, не abort-aware. См. [ensure / fetch / prefetch][fetch-methods]. |

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

Выполнение `queryFn` можно инициировать несколькими способами. Они различаются по трём осям: **создаёт ли холодную запись**, **форсит ли свежие данные** и **как отдаёт результат**. Запись запускает `queryFn` при создании, если ей не передана начальная машина.

### Императивные методы

| Метод                      | Когда запускает запрос                                                                                  | Форсит свежие?                | Возврат                   | Abort-aware | Ошибка       |
|----------------------------|--------------------------------------------------------------------------------------------------------|-------------------------------|---------------------------|-------------|--------------|
| `trigger(args, doForce?)` *(deprecated)* | холодная → создаёт и запускает; запись есть и `doForce = true` → фоновая `invalidate`                   | только при `doForce = true`   | `void`                    | нет         | —            |
| `ensure(args, opt?)`       | холодная → создаёт; `error` → ретрай                                                                    | нет (кэш/устаревшие отдаёт сразу) | `Promise<TData>`      | да          | реджект      |
| `fetch(args, opt?)`        | холодная → создаёт; `success`/`invalidate-error` → `invalidate`; `error` → ретрай; in-flight → ждёт    | да                            | `Promise<TData>`          | да          | реджект      |
| `prefetch(args, opt?)`     | холодная → создаёт; `error` → ретрай; с `force: true` — как `fetch`                                     | только при `force: true`      | `Promise<void>`           | нет         | проглатывает |
| `getEntry(args, true)`     | холодная → создаёт и запускает                                                                          | нет                           | `IQueryCacheEntry \| null` | нет         | —            |
| `invalidate(args)`         | **только** существующая (`success`/`invalidate-error`/`error`) → перезапрос с очисткой ошибки; холодную **не создаёт** | да (фоновый SWR)              | `void`                    | нет         | —            |

Тонкости, которые легко перепутать:

- `prefetch(args)` без `force` **не перезапрашивает** уже закэшированные данные — лишь гарантирует, что запись существует и запущена (сценарий «запустить и забыть»). Запись при этом создаётся синхронно, до разрешения промиса.
- `invalidate(args)` ничего **не создаёт**: на отсутствующей записи это no-op (в отличие от `fetch` и `prefetch(args, { force: true })`, которые холодную создадут).
- `getEntry(args, true)` — единственный геттер, создающий запись при отсутствии. Без флага (по умолчанию) — чистый lookup.

Детали `ensure`/`fetch`/`prefetch` (отмена, окно retention) — в разделе [ensure / fetch / prefetch][fetch-methods].

### Реактивный путь

`useResource(args)` и сцепление (`createClutch`) при подписке сами создают и запускают запись (через внутренний `_getOrCreate`), инициируя холодный запрос при монтировании. Сцепление дополнительно отдаёт `retry()` / `invalidate()`, делегирующие в одноимённые методы записи.

`getEntry$(args, true)` инициирует запрос **лениво при чтении сигнала**: первое чтение создаёт и запускает отсутствующую запись (и пересоздаёт её после удаления), поэтому само чтение имеет побочный эффект — стартует `queryFn` и вызывает хуки. `getEntry$(args)` / `getEntry$(args, false)` остаётся чистым наблюдателем (см. ниже).

### Примитивы на записи

Если на руках есть `QueryCacheEntry` (из `getEntry` / `getEntries`), `queryFn` перезапускают:

- `entry.invalidate()` — из `success` / `invalidate-error` / `error` (перезапуск с очисткой `error`; из `success` и `invalidate-error` — фоновый, с сохранением данных);
- `entry.retry()` — из `error` / `invalidate-error` (повтор после ошибки: ошибка остаётся в `error` до следующего settle).

### Что НЕ запускает запрос

- `getState(args)` — read-only снимок состояния (внутри `getEntry(args, false)`).
- `getEntry(args)` / `getEntry(args, false)` — lookup без создания.
- `getEntry$(args)` / `getEntry$(args, false)` — реактивный **read-only**: чтение не меняет кэш и отдаёт `null`, пока записи нет. (`getEntry$(args, true)` — наоборот, инициирует лениво при чтении; см. «Реактивный путь».)
- `serialize`, `toKeyed`, `getEntries`, `bind` — утилиты и связывание (а также `reset` на классе).
- Гидрация снапшотом (`createApi({ initialSnapshot })`) — создаёт запись и `queryFn` **не** запускает, пока данные считаются валидными. Исключение — записи, помеченные устаревшими: по `snapshotValidTime` либо со статусом `invalidate-error` (такие считаются устаревшими всегда). Они гидрируются в статусе `invalidating`, и перезапрос стартует сразу.


## getState

`getState(args)` — синхронный read-only снимок `TResourceEntryState` без подписки на изменения (внутри `getEntry(args, false)`, кэш **не создаёт**). Поля, флаги и правила сужения — те же, что у [состояния сцепления][clutch-state], с двумя отличиями:

- `dataSource` сужен до `none | current`: запись одна, данных предыдущих args и плейсхолдера у неё нет. Поэтому `isSwitching` здесь всегда `false`, а `dataArgs` при `hasData` всегда равны `args`.
- `idle` означает «записи в кэше ещё/уже нет» (у сцепления — `SKIP` или отсутствие args).

Доступны [строки][clutch-status] 1, 2, 5, 6, 7, 9, 10, 12; варианты экспортируются как `TResourceEntryIdleState`, `TResourceEntryPendingNoneState`, `TResourceEntryPendingCurrentState`, `TResourceEntrySuccessState`, `TResourceEntryErrorState`. Методов (`retry` / `invalidate`) у снимка нет — они есть у записи и у сцепления.

Упавший перезапрос (машина в `invalidate-error`) — это строка 9: `status: 'error'`, `dataSource: 'current'`, устаревшие данные остаются в `data`.


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

> При включённой [кросс-табовой синхронизации][usage-broadcast] (`sync: true`) холодная запись сначала спрашивает данные у других вкладок (`beforeQuery`): `fetch` и `prefetch({ force: true })` на **холодной** записи могут отдать данные соседней вкладки вместо собственного сетевого запроса. «Свежесть» здесь означает «свежее содержимое кэша», а не гарантированный запрос из этой вкладки.

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

### Окно retention

Запись, созданная `ensure`/`prefetch`, не имеет подписчиков до монтирования компонента. После того как промис разрешился, запускается отсчёт `retentionTime` (по умолчанию 60 000 мс); компонент, подписавшийся в течение этого окна (через `useResource`), отменяет сборку. Это аналог `gcTime`/`keepUnusedDataFor` в других библиотеках — при очень маленьком `retentionTime` возможен повторный запрос.


## См. также

- [Использование ресурса][usage] — примеры, паттерны, состояния
- [Команда — API][command-api] — API мутаций
- [Машина состояний запроса][machine] — переходы между статусами
- [Сцепление][clutch] — реактивный наблюдатель
- [Сцепление ресурса — API][clutch-api] — полная таблица методов и статусов сцепления
- [Типизация аргументов (Keyed)][keyed] — пайплайн аргументов: args → keyedArgs → key


[usage]: ../usage/resource.md
[usage-lifecycle]: ../usage/lifecycle.md
[bind]: #bind
[fetch-methods]: #ensure--fetch--prefetch
[command-bind]: ./command.md#bind
[command-api]: ./command.md
[machine]: ../concepts/machine.md
[clutch]: ../concepts/clutch.md
[clutch-api]: ./resource-clutch.md
[clutch-status]: ./resource-clutch.md#варианты-состояния
[clutch-state]: ./resource-clutch.md#состояние-tresourceclutchstate
[clutch-datasource]: ./resource-clutch.md#datasource
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
[usage-snapshot]: ../usage/snapshot.md
[usage-stream]: ../usage/stream-query.md
[usage-projection]: ../usage/projection-resource.md
[keyed]: ../concepts/keyed.md
[no-floating-promises]: https://typescript-eslint.io/rules/no-floating-promises/
