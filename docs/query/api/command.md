# Команда (Command) — API

Команда — абстракция для операций записи (мутаций). Примеры и паттерны — см. [руководство по использованию][usage].


## Создание

```typescript
const addTodoCommand = api.createCommand({
  queryFn: async (args: { text: string }) => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    return res.json();
  },
  links: (link) => link({
    resource: todosResource,
    forwardArgs: () => undefined,
    invalidate: true,
  }),
});
```


## Опции

| Опция               | Тип                                          | По умолчанию     | Описание                                                                     |
|----------------------|----------------------------------------------|------------------|------------------------------------------------------------------------------|
| `queryFn`            | `(args: TArgs, requestId: string) => Promise<TData>` | **обязательный** | Функция выполнения мутации. Второй аргумент — [request id][query-fn]: ключ идемпотентности, стабильный между ретраями. |
| `generateRequestId` | `(args: TArgs) => string \| Promise<string>` | `crypto.randomUUID` | Генерирует request id. Вызывается один раз на кэш-запись (результат переиспользуется при ретраях). См. [queryFn][query-fn]. |
| `key`                | `string`                                     | —                | Префикс для ключей кэша и devtools.                                          |
| `links`              | `(link) => void`                             | —                | Колбэк для описания связей с ресурсами. См. [links][usage-links].                        |
| `retentionTime`      | `number \| false`                            | `0`              | Время (мс) удержания кэш-записи после потери подписчиков. `false` — не удалять. Переопределяет `commandRetentionTime` из [API][api-readme]. |
| `onCacheEntryAdded`  | `(args, ctx) => void`                        | —                | Вызывается при создании кэш-записи. См. [lifecycle hooks][usage-lifecycle].  |
| `onQueryStarted`     | `(args, ctx) => void \| Promise<void>`       | —                | Вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][usage-lifecycle]. |
| `sync`               | `boolean`                                    | `false`          | Включить/отключить [кросс-табовую синхронизацию][usage-broadcast]. По умолчанию выключена (`defaultSync: 'none'`). Для включения укажите `sync: true` на команде или `defaultSync: 'all'` на уровне API. Игнорируется, если `syncDriver` не задан в API. |


## Методы

| Метод         | Параметры           | Возвращаемое значение   | Описание                                                                     |
|---------------|---------------------|-------------------------|------------------------------------------------------------------------------|
| `trigger`     | `args: Args<TArgs>` | `Promise<TData>`    | Императивный запуск мутации. Необязательный `key` идентифицирует кэш-запись.  |
| `createAgent` | `key?: string`      | `Agent`                 | Создаёт реактивный [агент][agent] — наблюдатель за командой. Необязательный ключ привязывает к кэш-записи. |
| `getEntry`    | `key: string`       | `QueryCacheEntry \| null`    | Синхронно возвращает кэш-запись.                                             |
| `getEntry$`   | `key: string`       | `QueryCacheEntry \| null`    | Реактивный аналог `getEntry` — для использования в реактивном контексте.     |
| `pack`        | `args: Args<TArgs>, key?: string` | `TPackedCommand<TArgs, TData>` | Связывает команду с аргументами (и необязательным ключом) в инертный дескриптор `{ kind: "command", command, args, key }`. Ничего не запускает. См. [pack][pack]. |


## Расширения

| Метод         | Параметры           | Возвращаемое значение   | Описание                                                                     |
|---------------|---------------------|-------------------------|------------------------------------------------------------------------------|
| `useCommand`  | `key?: string`      | `[trigger, TCommandState]` | React-хук. Требует `reactHooksPlugin()`. Подписывается на состояние мутации. В `state` доступен `retry()` для повторного запуска упавшей мутации.|


## Pack

`pack` связывает команду с аргументами (и необязательным ключом кэш-записи) в инертный дескриптор — он ничего не запускает. Потребитель отдаёт дескриптор обратно библиотеке, не выполняя мутацию сам:

```typescript
const packed = addTodoCommand.pack({ text: "buy milk" }, "draft-1");
// → { kind: "command", command: addTodoCommand, args: { text: "buy milk" }, key: "draft-1" }

// Позже дескриптор разворачивается:
await packed.command.trigger(packed.args, packed.key);
```

Все дескрипторы (`TPackedResource` и `TPackedCommand`) объединены в дискриминированный союз `TPacked<TArgs, TData>` с полем-дискриминатором `kind`, поэтому один обработчик может принимать и ресурсы, и команды:

```typescript
function run(packed: TPacked<unknown, unknown>) {
    if (packed.kind === "resource") {
        packed.resource.trigger(packed.args);
    } else {
        void packed.command.trigger(packed.args, packed.key);
    }
}
```


## Ретраи

Упавшую мутацию можно перезапустить, не создавая новую кэш-запись: `retry()` доступен в состоянии [агента команды][agent-api] и в `state`, который возвращает `useCommand`. Повтор переиспользует тот же [request id][query-fn], поэтому бэкенд может дедуплицировать запрос. Подробнее о `queryFn` и request id — в [руководстве][query-fn].


## См. также

- [Использование команды][usage] — примеры, паттерны, links, lifecycle hooks
- [Ресурс — API][resource-api] — API чтения данных
- [Машина состояний запроса][machine] — переходы между статусами
- [Агент][agent] — реактивный наблюдатель
- [Агент команды — API][agent-api] — полная таблица методов и статусов агента
- [Система кэширования][cache] — жизненный цикл записей кэша


[cache]: ../concepts/cache.md
[pack]: #pack
[usage]: ../usage/command.md
[query-fn]: ../usage/query-fn.md
[usage-links]: ../usage/links.md
[usage-lifecycle]: ../usage/lifecycle.md
[resource-api]: ./resource.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
[agent-api]: ./command-agent.md
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
