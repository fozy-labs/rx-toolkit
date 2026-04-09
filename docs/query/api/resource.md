# Ресурс (Resource) — API

Ресурс — абстракция для чтения данных с кешированием и SWR. Примеры и паттерны — см. [руководство по использованию][usage].


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
| `key`                | `string`                                                    | —                 | Префикс для ключей кеша и devtools.                                 |
| `retentionTime`      | `number \| false`                                           | `60_000`          | Время (мс) удержания записи после потери подписчиков. `false` — не удалять. Переопределяет `resourceRetentionTime` из [API][api-readme]. |
| `serializeArgs`      | `(args: TArgs) => string`                                   | `stableStringify` | Сериализация аргументов в кеш-ключ.                                 |
| `onCacheEntryAdded`  | `(args, ctx) => void`                                       | —                 | Вызывается при создании кеш-записи. См. [lifecycle hooks][usage-lifecycle]. |
| `onQueryStarted`     | `(args, ctx) => void \| Promise<void>`                      | —                 | Вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][usage-lifecycle]. |
| `sync`               | `boolean`                                                   | `true`            | Включить/отключить [кросс-табовую синхронизацию][usage-broadcast]. Игнорируется, если `syncDriver` не задан в API. |
| `getDevtoolsKey`     | `(args: TArgs, stringArgs: string) => string`               | —                 | Ключ аргументов для отображения в DevTools.                            |


## Методы

| Метод         | Параметры                            | Возвращаемое значение   | Описание                                                                       |
|---------------|--------------------------------------|-------------------------|--------------------------------------------------------------------------------|
| `useResource` | `args: TArgs \| typeof SKIP`        | `TResourceState<TData>` | React-хук. Требует `reactHooksPlugin()`. Подписывается на данные.              |
| `trigger`     | `args: TArgs, doForce?: boolean`     | `Promise<TData>`        | Императивный запрос. Дедуплицирует параллельные вызовы.                        |
| `refresh`     | `args: TArgs`                        | `void`                  | Помечает запись как устаревшую и запускает фоновый перезапрос (SWR).            |
| `getEntry`    | `args: TArgs, doInitiate?: boolean`  | `CacheEntry \| null`    | Синхронно возвращает кеш-запись.                                               |
| `getEntry$`   | `args: TArgs, doInitiate?: boolean`  | `CacheEntry \| null`    | Реактивный аналог `getEntry` — для использования в реактивном контексте.       |
| `createAgent` | —                                    | `Agent<TArgs, TData>`   | Создаёт реактивный [агент][agent] — наблюдатель за ресурсом с SWR-поведением.  |


## См. также

- [Использование ресурса][usage] — примеры, паттерны, состояния
- [Команда — API][command-api] — API мутаций
- [Стейт-машина запроса][machine] — переходы между статусами
- [Агент][agent] — реактивный наблюдатель ресурса
- [Агент ресурса — API][agent-api] — полная таблица методов и статусов агента


[usage]: ../usage/resource.md
[usage-lifecycle]: ../usage/lifecycle.md
[command]: ../usage/command.md
[command-api]: ./command.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
[agent-api]: ./resource-agent.md
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
