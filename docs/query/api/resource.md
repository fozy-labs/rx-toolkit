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
| `_getOrCreate` | `args: Args<TArgs>, doForce = false`          | `CacheEntry`              | Внутренний метод. Получает существующую или создаёт новую запись кэша для аргументов.                                                |

### Расширения

| Метод          | Параметры                                      | Возвращаемое значение   | Описание                                                                       |
|----------------|------------------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| `useResource`  | `args: ArgsOrVoidOrSkip<TArgs>` | `TResourceState<TData>` | React-хук. Требует `reactHooksPlugin()`. Подписывается на данные.              |


## Pack

`pack` связывает ресурс с аргументами в инертный дескриптор — он ничего не запускает и не трогает кэш. Это удобно, когда потребитель хочет вернуть библиотеке описание «что прочитать и с какими аргументами», не выполняя запрос сам:

```typescript
const packed = getUserById.pack({ userId: 1 });
// → { kind: "resource", resource: getUserById, args: { userId: 1 } }

// Позже библиотека/потребитель разворачивает дескриптор:
packed.resource.trigger(packed.args);
```

Дескриптор дискриминируется полем `kind`, что позволяет в одном месте обрабатывать и ресурсы, и команды (см. [`TPacked`][command-pack] в API команды).


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
[command-pack]: ./command.md#pack
[command-api]: ./command.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
[agent-api]: ./resource-agent.md
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
[keyed]: ../concepts/keyed.md
