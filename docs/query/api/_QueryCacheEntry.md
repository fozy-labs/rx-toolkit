# Запись кэша запроса (QueryCacheEntry) — API

Расширяет [CacheEntry][cache-entry-api], 
    добавляя жизненный цикл запроса: выполнение `queryFn`, 
    дедупликация, прерывание, [патчинг][patching-concept] 
    и переходы [состояния записи][entry-state-concept]. 
Используется [ресурсом][resource-api] и [командой][command-api].


## Опции

| Опция                | Тип                                                                | По умолчанию        | Описание                                                                                                |
|----------------------|--------------------------------------------------------------------|---------------------|---------------------------------------------------------------------------------------------------------|
| `queryFn`            | `(keyedArgs: TKeyed<TArgs>, signal: AbortSignal) => Promise<TData>` | (Обязательное поле) | Функция для получения данных. Принимает аргументы и сигнал прерывания.                                  |
| `retentionTime`      | `number \| false \| ((state: TQueryEntryState<TArgs, TData>) => number \| false)` | (Обязательное поле) | Время (мс) удержания записи без удержаний. `false` — не удалять. Функция — частный случай опции [CacheEntry][cache-entry-api] с `TState` = [состоянием записи запроса][entry-state-concept]: опция уходит вниз без изменений, а вызов на каждом переходе `active → retention`, ловлю броска, [нормализацию результата][cache-normalize] и таймер выполняет базовый класс. |
| `keyedArgs`          | `TKeyed<TArgs>`                                                     | (Обязательное поле) | Аргументы для `queryFn`. Используются для дедупликации и отображения в DevTools.                        |
| `resourceKey`        | `string`                                                           | —                   | Ключ для отображения в DevTools.                                                                        |
| `mapError`           | `TMapError` — `(error: unknown, ctx: TErrorContext) => unknown`    | `identity`          | Нормализует сырую ошибку в единственной точке её входа в состояние записи. Прокидывается из [API][api-readme]. |
| `errorSource`        | `'query'` \| `'command'`                                           | `'query'`           | Провенанс, попадающий в контекст `mapError`.                                                            |
| `initialState`       | [`TQueryEntryState<TArgs, TData>`][entry-state-concept]            | —                   | Состояние, с которого запись начинает жизнь. Обычная плоская запись — например, восстановленная из снимка. Подавляет автоматический первый запуск. |
| `isInvalidated`      | `boolean`                                                          | `false`             | Родиться помеченной: перезапрос — по [правилу ревалидации](#выполнение-запроса), а не при создании. Действует только вместе с `initialState`: без него автоматический первый запуск снимает метку. С данными — так гидрируется устаревший [снимок][snapshot-usage]; с `pending` — запись без запроса в полёте, которая должна загрузиться при первом удержании. |
| `invalidateInFlight` | `TInFlightPolicy` — `'cancel' \| 'trail' \| 'join'`               | `'cancel'`          | Режим `invalidate()` при запросе в полёте, когда вызов его не задал. Прокидывается из одноимённой опции [ресурса][resource-api]. См. [инвалидация в полёте][cache-inflight]. |
| `beforeDevtoolsPush` | `TBeforeDevtoolsPushFn<TQueryEntryState<TArgs, TData>>`            | —                   | Перехватывает состояние записи перед отправкой в DevTools. Полезно для удаления чувствительных данных. `Resource` и `Command` её не пробрасывают. |


## Свойства

| Свойство    | Тип                                                                        | Описание                                                       |
|-------------|----------------------------------------------------------------------------|-----------------------------------------------------------------|
| `keyedArgs` | `TKeyed<TArgs>`                                                            | Аргументы, с которыми была создана запись.                     |
| `state$`    | `ReadonlySignal<`[`TQueryEntryState<TArgs, TData>`][entry-state-concept]`>` | Реактивный сигнал [состояния записи][entry-state-concept] — плоская запись: `entry.state$().status`. |
| `isInvalidated` | `boolean`                                                              | Запись помечена: инвалидирована тающей или с запросом в полёте либо её запрос [вышел из полёта без данных][cache-left-flight] — и перезапросится по [правилу ревалидации](#выполнение-запроса). На удерживаемой записи без запроса в полёте всегда `false`. В `state$` / `getState()` не входит. |

> `state$` унаследован от [CacheEntry][cache-entry-api], параметризованного
> `TQueryEntryState<TArgs, TData>`; там же — `completed$`, `isMelting`, `hold()`.


## Методы

| Метод         | Параметры                     | Возвращаемое значение | Описание                                                            |
|---------------|-------------------------------|-----------------------|---------------------------------------------------------------------|
| `invalidate`  | `options?: { inFlight?: TInFlightPolicy }` | `void`   | Помечает запись устаревшей. Удерживаемую перезапрашивает сразу: `success` / `invalidate-error` → `invalidating`, `error` → `pending` со снятой ошибкой. Тающую (`isMelting`) только помечает (`isInvalidated`) — перезапрос на первом удержании, до подключения подписчика. При запросе в полёте — по `options.inFlight`, иначе по опции `invalidateInFlight`: `cancel` прерывает запрос (удерживаемую перезапускает сразу, тающую помечает; `pending` / `invalidating` сохраняются; открытый в `success` стрим у удерживаемой → `invalidating`, у тающей закрывается, а статус остаётся `success`), `trail` помечает и даёт ему доработать, `join` — no-op (ни прерывания, ни метки). Нарушение консистентности патчей инвалидирует по опции записи — любой, `join` включительно. На записи команды — `console.warn` и no-op. См. [инвалидация тающей записи][cache-invalidation] и [в полёте][cache-inflight]. |
| `retry`       | —                             | `void`                | Перезапускает запрос после ошибки, сохраняя её видимой: `error` → `pending`, `invalidate-error` → `invalidating`; метку `isInvalidated` снимает. Вне этих статусов — `console.warn` и no-op. |
| `createPatch` | `patchFn: (data: TData) => void` | `IPatchHandle \| null` | Создаёт оптимистичный патч. См. [Патчинг][patching-section].             |
| `whenLoaded`  | `signal?: AbortSignal`        | `Promise<TData>`      | ⚠️ Экспериментально. Резолвится, как только у записи есть данные — включая устаревшие (`invalidating` / `invalidate-error`); реджектит на терминальной ошибке. Стоит за `Resource.ensure` / `prefetch`. |
| `whenFetched` | `signal?: AbortSignal`        | `Promise<TData>`      | ⚠️ Экспериментально. Дожидается свежих данных (`success`), реджектит на `error` / `invalidate-error`. Стоит за `Resource.fetch`. |

Оба реджектят ещё в двух случаях: `CacheEntryRemovedError`, если запись завершилась раньше подходящего состояния (`reset()` / `resetAll()` / явный `complete()`), и причиной отмены (`signal.reason`), если переданный `AbortSignal` сработал первым. Сборка по `retentionTime` таким источником **не** является: пока ожидание не завершилось, оно [удерживает][cache-holds] запись и откладывает сборку — и потому ревалидирует помеченную.


> Наследуемые `peek()`, `set()`, `complete()` — см. [CacheEntry][cache-entry-api];
> `peek()` и `set()` работают с той же плоской записью, что и `state$`.


## Выполнение запроса

При создании записи `queryFn` вызывается автоматически, если `initialState` **не** было указано.

Метка `isInvalidated` снимается перезапросом, и он происходит по одному правилу — **запись удерживается, запроса в полёте нет и стоит метка**. Правило проверяется в трёх точках: при первом удержании, при settle любого запроса и в самом `invalidate()`. `invalidate()` на удерживаемой записи без запроса в полёте — частный случай: метка ставится и снимается в одном вызове. Из `success` / `invalidate-error` / `error` перезапрос — переход машины плюс запуск; на записи, чей запрос был прерван под `cancel` и статус остался `pending` / `invalidating`, — только запуск.

Новый запуск прерывает текущий запрос через `AbortSignal` (`cancel`, `retry()`); `trail` запуск не прерывает — ждёт settle; `join` не делает ничего.

Если результат приходит от уже прерванного запроса (stale-check),
    он игнорируется — запись принимает только данные от актуального запроса.


> Запись может быть инициализирована из снапшота — например, при [кросс-табовой синхронизации][broadcast-usage] или при восстановлении состояния.


## Патчинг

Подробности — см. [патчинг][patching-concept].


## См. также

- [CacheEntry — API][cache-entry-api]
- [Состояние записи запроса][entry-state-concept]
- [Патчинг][patching-concept]
- [Ресурс — API][resource-api]
- [Команда — API][command-api]

---

[cache-entry-api]: ./_CacheEntry.md
[entry-state-concept]: ../concepts/query-entry-state.md
[patching-concept]: ../concepts/patching.md
[cache-normalize]: ../concepts/cache.md#нормализация-результата
[resource-api]: ./resource.md
[command-api]: ./command.md
[query-execution]: #выполнение-запроса
[patching-section]: #патчинг
[broadcast-usage]: ../usage/broadcast.md
[snapshot-usage]: ../usage/snapshot.md
[cache-holds]: ../concepts/cache.md#кто-удерживает-запись
[cache-invalidation]: ../concepts/cache.md#инвалидация-тающей-записи
[cache-inflight]: ../concepts/cache.md#инвалидация-в-полёте
[cache-left-flight]: ../concepts/cache.md#запрос-вышел-из-полёта-без-данных
[api-readme]: ./README.md
