# Запись кэша запроса (QueryCacheEntry) — API

Расширяет [CacheEntry][cache-entry-api], 
    добавляя жизненный цикл запроса: выполнение `queryFn`, 
    дедупликация, прерывание, [патчинг][patching-concept] 
    и интеграция с [машиной состояний][machine-concept]. 
Используется [ресурсом][resource-api] и [командой][command-api].


## Опции

| Опция                | Тип                                                                | По умолчанию        | Описание                                                                                                |
|----------------------|--------------------------------------------------------------------|---------------------|---------------------------------------------------------------------------------------------------------|
| `queryFn`            | `(keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData>` | (Обязательное поле) | Функция для получения данных. Принимает аргументы и сигнал прерывания.                                  |
| `retentionTime`      | `number \| false`                                                  | (Обязательное поле) | Время (мс) удержания записи после отписки последнего подписчика. `false` — не удалять.                  |
| `keyedArgs`          | `Keyed<TArgs>`                                                     | (Обязательное поле) | Аргументы для `queryFn`. Используются для дедупликации и отображения в DevTools.                        |
| `resourceKey`        | `string`                                                           | —                   | Ключ для отображения в DevTools.                                                                        |
| `mapError`           | `TMapError` — `(error: unknown, ctx: TErrorContext) => unknown`    | `identity`          | Нормализует сырую ошибку в точке входа в машину (`machine.fail`). Прокидывается из [API][api-readme].    |
| `errorSource`        | `'query'` \| `'command'`                                           | `'query'`           | Провенанс, попадающий в контекст `mapError`.                                                            |
| `initialMachine`     | `Machine<TArgs, TData>`                                            | —                   | Машина состояний для инициализации записи.                                                              |
| `beforeDevtoolsPush` | `(machine: Machine<TArgs, TData>) => any`                          | —                   | Функция для изменения состояния перед отправкой в DevTools. Полезно для удаления чувствительных данных. `Resource` и `Command` её не пробрасывают. |


## Свойства

| Свойство   | Тип                                          | Описание                                                    |
|------------|----------------------------------------------|-------------------------------------------------------------|
| `keyedArgs` | `Keyed<TArgs>`                              | Аргументы, с которыми была создана запись.                  |
| `machine$` | `ReadonlySignal<Machine<TArgs, TData>>`   | Реактивный сигнал состояния [машины][machine-concept]. |

> Наследуемые свойства `state$`, `completed$` — см. [CacheEntry][cache-entry-api].


## Методы

| Метод         | Параметры                     | Возвращаемое значение | Описание                                                            |
|---------------|-------------------------------|-----------------------|---------------------------------------------------------------------|
| `refresh`     | —                             | `void`                | Переводит запись в `refreshing` и перезапрашивает данные. |
| `retry`       | —                             | `void`                | Перезапускает запрос после ошибки.                                         |
| `createPatch` | `patchFn: (data: TData) => void` | `IPatchHandle \| null` | Создаёт оптимистичный патч. См. [Патчинг][patching-section].             |
| `whenLoaded`  | `signal?: AbortSignal`        | `Promise<TData>`      | ⚠️ Экспериментально. Резолвится, как только у записи есть данные — включая устаревшие (`refreshing` / `refresh-error`); реджектит на терминальной ошибке. Стоит за `Resource.ensure` / `prefetch`. |
| `whenFetched` | `signal?: AbortSignal`        | `Promise<TData>`      | ⚠️ Экспериментально. Дожидается свежих данных (`success`), реджектит на `error` / `refresh-error`. Стоит за `Resource.fetch`. |

Оба реджектят ещё в двух случаях: `CacheEntryRemovedError`, если запись завершилась раньше подходящего состояния (`reset()` / `resetAll()` / явный `complete()`), и причиной отмены (`signal.reason`), если переданный `AbortSignal` сработал первым. Сборка по `retentionTime` таким источником **не** является: пока ожидание не завершилось, оно удерживает refcount записи и откладывает сборку.


> Наследуемые `peek()`, `set()`, `complete()` — см. [CacheEntry][cache-entry-api].


## Выполнение запроса

При создании записи `queryFn` вызывается автоматически, если `initialMachine` **не** была указана — либо если указанная машина находится в статусе `refreshing` (гидрация устаревшего снимка сразу запускает перезапрос).

Принудительный запрос (`refresh()`) прерывает текущий запрос через `AbortSignal` и запускает новый.

Если результат приходит от уже прерванного запроса (stale-check),
    он игнорируется — запись принимает только данные от актуального запроса.


> Запись может быть инициализирована из снапшота — например, при [кросс-табовой синхронизации][broadcast-usage] или при восстановлении состояния.


## Патчинг

Подробности — см. [патчинг][patching-concept].


## См. также

- [CacheEntry — API][cache-entry-api]
- [Машина состояний][machine-concept]
- [Патчинг][patching-concept]
- [Ресурс — API][resource-api]
- [Команда — API][command-api]

---

[cache-entry-api]: ./_CacheEntry.md
[machine-concept]: ../concepts/machine.md
[patching-concept]: ../concepts/patching.md
[resource-api]: ./resource.md
[command-api]: ./command.md
[query-execution]: #выполнение-запроса
[patching-section]: #патчинг
[broadcast-usage]: ../usage/broadcast.md
[api-readme]: ./README.md
