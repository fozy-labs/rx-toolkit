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
  links: [
    todosResource.link({
      forwardArgs: () => undefined,
      invalidate: true,
    }),
  ],
});
```


## Опции

| Опция               | Тип                                          | По умолчанию     | Описание                                                                     |
|----------------------|----------------------------------------------|------------------|------------------------------------------------------------------------------|
| `queryFn`            | `(args: TArgs) => Promise<TData>`            | **обязательный** | Функция выполнения мутации.                                                  |
| `key`                | `string`                                     | —                | Префикс для ключей кеша и devtools.                                          |
| `links`              | `LinkEntry[]`                                | —                | Массив связей с ресурсами. См. [links][usage-links].                         |
| `cacheRetentionTime` | `number \| false`                            | `0`              | Время (мс) удержания кеш-записи после потери подписчиков. `false` — не удалять. |
| `onCacheEntryAdded`  | `(args, lifecycle) => void`                  | —                | Вызывается при создании кеш-записи. См. [lifecycle hooks][usage-lifecycle].  |
| `onQueryStarted`     | `(args, lifecycle) => void \| Promise<void>` | —                | Вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][usage-lifecycle]. |


## Методы

| Метод         | Параметры              | Возвращаемое значение   | Описание                                                                     |
|---------------|------------------------|-------------------------|------------------------------------------------------------------------------|
| `useCommand`  | `key?: string`         | `[trigger, TCommandState]` | React-хук. Требует `reactHooksPlugin()`. Подписывается на состояние мутации. |
| `trigger`     | `args: TArgs, key?: string` | `Promise<TData>`    | Императивный запуск мутации. Необязательный `key` идентифицирует кеш-запись.  |
| `createAgent` | `opts?: { key }`       | `Agent`                 | Создаёт реактивный [агент][agent] — наблюдатель за командой.                 |
| `getEntry`    | `key: string`          | `CacheEntry \| null`    | Синхронно возвращает кеш-запись.                                             |
| `getEntry$`   | `key: string`          | `CacheEntry \| null`    | Реактивный аналог `getEntry` — для использования в реактивном контексте.     |


## См. также

- [Использование команды][usage] — примеры, паттерны, links, lifecycle hooks
- [Ресурс — API][resource-api] — API чтения данных
- [Стейт-машина запроса][machine] — переходы между статусами
- [Агент][agent] — реактивный наблюдатель


[usage]: ../usage/command.md
[usage-links]: ../usage/command.md#links
[usage-lifecycle]: ../usage/command.md#хуки-жизненного-цикла
[resource-api]: ./resource.md
[machine]: ../concepts/machine.md
[agent]: ../concepts/agent.md
