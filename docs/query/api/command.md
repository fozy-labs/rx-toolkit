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
| `queryFn`            | `(args: TArgs) => Promise<TData>`            | **обязательный** | Функция выполнения мутации.                                                  |
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


## Расширения

| Метод         | Параметры           | Возвращаемое значение   | Описание                                                                     |
|---------------|---------------------|-------------------------|------------------------------------------------------------------------------|
| `useCommand`  | `key?: string`      | `[trigger, TCommandState]` | React-хук. Требует `reactHooksPlugin()`. Подписывается на состояние мутации.|


## См. также

- [Использование команды][usage] — примеры, паттерны, links, lifecycle hooks
- [Ресурс — API][resource-api] — API чтения данных
- [Машина состояний запроса][machine] — переходы между статусами
- [Агент][agent] — реактивный наблюдатель
- [Агент команды — API][agent-api] — полная таблица методов и статусов агента
- [Система кэширования][cache] — жизненный цикл записей кэша


[cache]: ../concepts/cache.md
[usage]: ../usage/command.md
[usage-links]: ../usage/links.md
[usage-lifecycle]: ../usage/lifecycle.md
[resource-api]: ./resource.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
[agent-api]: ./command-agent.md
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
