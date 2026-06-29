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
| `queryFn`            | `(args: TArgs, abortSignal: AbortSignal) => Promise<TData>` | **обязательный**  | Функция запроса данных.                                             |
| `key`                | `string`                                                    | —                 | Префикс для ключей кэша и devtools.                                 |
| `retentionTime`      | `number \| false`                                           | `60_000`          | Время (мс) удержания записи после потери подписчиков. `false` — не удалять. Переопределяет `resourceRetentionTime` из [API][api-readme]. |
| `serializeArgs`      | `(args: TArgs) => string`                                   | `stableStringify` | Сериализация аргументов в кэш-ключ.                                 |
| `onCacheEntryAdded`  | `(args, ctx) => void`                                       | —                 | Вызывается при создании кэш-записи. См. [lifecycle hooks][usage-lifecycle]. |
| `onQueryStarted`     | `(args, ctx) => void \| Promise<void>`                      | —                 | Вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][usage-lifecycle]. |
| `sync`               | `boolean`                                                   | `false`           | Включить/отключить [кросс-табовую синхронизацию][usage-broadcast]. Игнорируется, если `syncDriver` не задан в API. |
| `getDevtoolsKey`     | `(args: Keyed<TArgs>) => string`                            | —                 | Ключ аргументов для отображения в DevTools.                            |


### Опции класса (Resource)

| Опция         | Тип                                                     | По умолчанию | Описание                   |
|---------------|---------------------------------------------------------|--------------|----------------------------|
| `beforeQuery` | `(args: Keyed<TArgs>) => Promise<TData \| typeof NONE>` | —            | Вызывается перед `queryFn` |

## Методы

| Метод          | Параметры                                     | Возвращаемое значение     | Описание                                                                                                                             |
|----------------|-----------------------------------------------|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `trigger`        | `args: Args<TArgs>, doForce = false`          | `void`                    | Запускает запрос с заданными аргументами. При `doForce = false` (по умолчанию) перезапрос для существующей записи кэша не делает. |
| `refresh`      | `args: Args<TArgs>`                           | `void`                    | Помечает запись как устаревшую и запускает фоновый перезапрос (SWR).                                                                 |
| `getEntry`     | `args: ArgsOrVoid<TArgs>, doInitiate = false`       | `QueryCacheEntry \| null` | Синхронно возвращает кэш-запись.                                                                                                     |
| `getState`     | `args: ArgsOrVoid<TArgs>`                     | `IResourceLiteState<TArgs, TData>` | Синхронно возвращает упрощённое состояние ресурса (`status`, `data`, `error`, флаги) без подписки на изменения.                    |
| `getEntry$`    | `args: ArgsOrVoid<TArgs>, doInitiate = false` | `QueryCacheEntry \| null`      | Реактивный аналог `getEntry` — для использования в реактивном контексте. При `doInitiate = true` чтение сигнала создаёт и запускает запись, если её нет (лениво, при первом чтении), поэтому сигнал всегда отдаёт запись. |
| `createAgent`  | —                                             | `Agent<TArgs, TData>`     | Создаёт реактивный [агент][agent] — наблюдатель за ресурсом с SWR-поведением.                                                        |
| `serialize`    | `args: Args<TArgs>`                           | `string`                  | Возвращает строковый ключ кэша для заданных аргументов.                                                                              |
| `toKeyed`      | `args: Args<TArgs>`                           | `Keyed<TArgs>`            | Оборачивает аргументы в пару `{ value, key }` — для передачи в методы, минуя повторную сериализацию.                                 |
| `pack`         | `args: Args<TArgs>`                           | `TPackedResource<TArgs, TData>` | Связывает ресурс с аргументами в инертный дескриптор `{ kind: "resource", resource, args }`. Ничего не запускает — потребитель отдаёт дескриптор обратно библиотеке. См. [pack][pack]. |
| `ensure`       | `args: Args<TArgs>, options?: { signal? }`    | `Promise<TData>`         | Отдаёт кэшированные данные мгновенно, если они есть; иначе запускает запрос и ждёт. Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `fetch`        | `args: Args<TArgs>, options?: { signal? }`    | `Promise<TData>`         | Всегда возвращает результат свежего запроса (перезапрашивает кэш, дедуплицирует in-flight). Реджектит на ошибке/отмене. См. [ensure / fetch / prefetch][fetch-methods]. |
| `prefetch`     | `args: Args<TArgs>`                           | `Promise<void>`          | Fire-and-forget прогрев кэша: переиспользует кэш, никогда не реджектит, не abort-aware. См. [ensure / fetch / prefetch][fetch-methods]. |
| `_getOrCreate` | `args: Args<TArgs>, doForce = false`          | `CacheEntry`              | Внутренний метод. Получает существующую или создаёт новую запись кэша для аргументов.                                                |

### Расширения

| Метод          | Параметры                                      | Возвращаемое значение   | Описание                                                                       |
|----------------|------------------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| `useResource`  | `args: ArgsOrVoidOrSkip<TArgs>` | `TResourceState<TData>` | React-хук. Требует `reactHooksPlugin()`. Подписывается на данные.              |


## Что запускает запрос

Выполнение `queryFn` можно инициировать несколькими способами. Они различаются по трём осям: **создаёт ли холодную запись**, **форсит ли свежие данные** и **как отдаёт результат**. Все создания записей проходят через единственную точку `_getOrCreate` (а у записи `queryFn` авто-исполняется в конструкторе, если не передан снапшот).

### Императивные методы

| Метод                      | Когда запускает запрос                                                                                  | Форсит свежие?                | Возврат                   | Abort-aware | Ошибка       |
|----------------------------|--------------------------------------------------------------------------------------------------------|-------------------------------|---------------------------|-------------|--------------|
| `trigger(args, doForce?)`  | холодная → создаёт и запускает; запись есть и `doForce = true` → фоновый `refresh`                      | только при `doForce = true`   | `void`                    | нет         | —            |
| `ensure(args, opt?)`       | холодная → создаёт; `error` → ретрай                                                                    | нет (кэш/устаревшие отдаёт сразу) | `Promise<TData>`      | да          | реджект      |
| `fetch(args, opt?)`        | холодная → создаёт; `success`/`refresh-error` → `refresh`; `error` → ретрай; in-flight → ждёт          | да                            | `Promise<TData>`          | да          | реджект      |
| `prefetch(args)`           | холодная → создаёт; `error` → ретрай                                                                    | нет                           | `Promise<void>`           | нет         | проглатывает |
| `getEntry(args, true)`     | холодная → создаёт и запускает                                                                          | нет                           | `QueryCacheEntry \| null` | нет         | —            |
| `refresh(args)`            | **только** существующая (`success`/`refresh-error`) → фоновый перезапрос; холодную **не создаёт**       | да (фоновый SWR)              | `void`                    | нет         | —            |

Тонкости, которые легко перепутать:

- `trigger(args)` без `doForce` **не перезапрашивает** уже закэшированные данные — лишь гарантирует, что запись существует и запущена (сценарий «запустить и забыть» для подписки).
- `refresh(args)` ничего **не создаёт**: на отсутствующей записи это no-op (в отличие от `fetch`, который холодную создаст).
- `getEntry(args, true)` — единственный геттер, создающий запись при отсутствии. Без флага (по умолчанию) — чистый lookup.

Детали `ensure`/`fetch`/`prefetch` (отмена, окно retention) — в разделе [ensure / fetch / prefetch][fetch-methods].

### Реактивный путь

`useResource(args)` и агент (`createAgent`) при подписке сами вызывают `trigger(args)`, инициируя холодный запрос при монтировании. Агент дополнительно отдаёт `retry()` / `refresh()`, делегирующие в одноимённые методы записи.

`getEntry$(args, true)` инициирует запрос **лениво при чтении сигнала**: первое чтение создаёт и запускает отсутствующую запись (и пересоздаёт её после удаления), поэтому само чтение имеет побочный эффект — стартует `queryFn` и вызывает хуки. `getEntry$(args)` / `getEntry$(args, false)` остаётся чистым наблюдателем (см. ниже).

### Примитивы на записи

Если на руках есть `QueryCacheEntry` (из `getEntry` / `getEntries`), `queryFn` перезапускают:

- `entry.refresh()` — из `success` / `refresh-error` (фоновый SWR-перезапуск);
- `entry.retry()` — из `error` (повтор после ошибки).

### Что НЕ запускает запрос

- `getState(args)` — read-only снимок состояния (внутри `getEntry(args, false)`).
- `getEntry(args)` / `getEntry(args, false)` — lookup без создания.
- `getEntry$(args)` / `getEntry$(args, false)` — реактивный **read-only**: чтение не меняет кэш и отдаёт `null`, пока записи нет. (`getEntry$(args, true)` — наоборот, инициирует лениво при чтении; см. «Реактивный путь».)
- `serialize`, `toKeyed`, `getEntries`, `pack`, `reset` — утилиты, упаковка и очистка.
- Гидрация снапшотом (`config.snapshot`) — создаёт запись, но `queryFn` **не** запускает: данные уже есть. Запрос пойдёт лишь при последующем `refresh` / `fetch` / `trigger(force)`.


## Pack

`pack` связывает ресурс с аргументами в инертный дескриптор — он ничего не запускает и не трогает кэш. Это удобно, когда потребитель хочет вернуть библиотеке описание «что прочитать и с какими аргументами», не выполняя запрос сам:

```typescript
const packed = getUserById.pack({ userId: 1 });
// → { kind: "resource", resource: getUserById, args: { userId: 1 } }

// Позже библиотека/потребитель разворачивает дескриптор:
packed.resource.trigger(packed.args);
```

Дескриптор дискриминируется полем `kind`, что позволяет в одном месте обрабатывать и ресурсы, и команды (см. [`TPacked`][command-pack] в API команды).


## ensure / fetch / prefetch

Императивные промис-методы для кода вне реактивного контекста — прежде всего загрузчиков роутеров (TanStack Router и т.п.) и прогрева кэша. Все три при необходимости создают кэш-запись и переиспространяют существующую.

| Метод      | Кэш-хит                              | Холодный / упавший                | Возврат          | Ошибка    |
|------------|--------------------------------------|-----------------------------------|------------------|-----------|
| `ensure`   | отдаёт данные сразу (в т.ч. устаревшие) | запускает запрос и ждёт; упавший ретраит | `Promise<TData>` | реджект   |
| `fetch`    | перезапрашивает и ждёт свежий результат | запускает запрос и ждёт           | `Promise<TData>` | реджект   |
| `prefetch` | переиспользует данные                 | запускает запрос и ждёт            | `Promise<void>`  | проглатывает |

```typescript
// TanStack Router loader: данные нужны для рендера → ensure (abort-aware)
export const Route = createFileRoute('/users/$id')({
    loader: ({ params, abortController }) =>
        usersResource.ensure({ id: params.id }, { signal: abortController.signal }),
});

// Спекулятивный прогрев на hover → prefetch (переживает навигацию)
<Link onMouseEnter={() => usersResource.prefetch({ id })} ... />
```

### Отмена (`signal`)

`ensure` и `fetch` принимают `AbortSignal`. Отмена **отвязывает вызывающего** от запроса: возвращённый промис реджектит причиной отмены (`signal.reason`). Сам запрос при этом **не прерывается**, если на кэш-записи есть другие потребители (подписанный компонент, другой `ensure`/`fetch`) — разделяемый in-flight запрос продолжается для них. Запрос, оставшийся без потребителей, сворачивается обычным retention-сборщиком (`retentionTime`), который при срабатывании прерывает `queryFn` через его `AbortSignal`.

`prefetch` намеренно **не** abort-aware — спекулятивный прогрев не должен отменяться при уходе с маршрута.

### Окно retention

Запись, созданная `ensure`/`prefetch`, не имеет подписчиков до монтирования компонента. После того как промис разрешился, запускается отсчёт `retentionTime` (по умолчанию 60 000 мс); компонент, подписавшийся в течение этого окна (через `useResource`), отменяет сборку. Это аналог `gcTime`/`keepUnusedDataFor` в других библиотеках — при очень маленьком `retentionTime` возможен повторный запрос.


## См. также

- [Использование ресурса][usage] — примеры, паттерны, состояния
- [Команда — API][command-api] — API мутаций
- [Машина состояний запроса][machine] — переходы между статусами
- [Агент][agent] — реактивный наблюдатель
- [Агент ресурса — API][agent-api] — полная таблица методов и статусов агента
- [Типизация аргументов (Keyed)][keyed] — пайплайн аргументов: Args → Keyed → key


[usage]: ../usage/resource.md
[usage-lifecycle]: ../usage/lifecycle.md
[pack]: #pack
[fetch-methods]: #ensure--fetch--prefetch
[command-pack]: ./command.md#pack
[command-api]: ./command.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
[agent-api]: ./resource-agent.md
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
[keyed]: ../concepts/keyed.md
