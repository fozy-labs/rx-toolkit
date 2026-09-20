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
| `retentionTime`      | `number \| false \| ((args, state) => number \| false)` | `0`   | Время (мс) удержания кэш-записи после потери подписчиков. `false` — не удалять. Функция вычисляется на каждом переходе записи в удержание; `state` — состояние записи команды (`TCommandEntryState` — [состояние сцепления][clutch-state] без `retry()`) без варианта `idle`. Первое вычисление всегда застаёт запись завершённой (`success` или `error`): `execute()` удерживает её до конца мутации. У повтора через `retry()` такого удержания нет — если последний подписчик уходит, пока повтор в полёте, функция получит строку `pending` с `hasError: true`. См. [время удержания записи][cache-retention]. Переопределяет `commandRetentionTime` из [API][api-readme]. |
| `onCacheEntryAdded`  | `TLifecycleHookOption<(args, ctx) => void>`  | —                | Вызывается при создании кэш-записи. Принимает один хук или их массив. См. [lifecycle hooks][usage-lifecycle]. |
| `onQueryStarted`     | `TLifecycleHookOption<(args, ctx) => void \| Promise<void>>` | —                | Вызывается при каждом запуске `queryFn`. Принимает один хук или их массив. См. [lifecycle hooks][usage-lifecycle]. |
| `sync`               | `boolean`                                    | `false`          | Включить/отключить [кросс-табовую синхронизацию][usage-broadcast]. По умолчанию выключена (`defaultSync: 'none'`). Для включения укажите `sync: true` на команде или `defaultSync: 'all'` на уровне API. Игнорируется, если `syncDriver` не задан в API. |


## Методы

| Метод         | Параметры           | Возвращаемое значение   | Описание                                                                     |
|---------------|---------------------|-------------------------|------------------------------------------------------------------------------|
| `execute`     | `args: TArgsOrKeyed<TArgs>, entryKey?: string` | `Promise<TData>`    | Императивный запуск мутации. Необязательный `entryKey` идентифицирует кэш-запись. Сырой промис: при ошибке реджектится (в отличие от [конверта][clutch-api-trigger] на уровне сцепления/хука). Все реджекты нормализуются через `mapError`, включая `CacheEntryRemovedError` при удалении записи до завершения (повторный `execute` с тем же ключом, `reset()`). |
| `trigger`     | `args: TArgsOrKeyed<TArgs>, entryKey?: string` | `Promise<TData>`    | **Deprecated.** Прежнее имя `execute` — контракт идентичен. Будет удалён в одном из следующих релизов. |
| `createClutch` | `entryKey?: string` | `ICommandClutch<TArgs, TData, TError>` | Создаёт реактивное [сцепление][clutch] — наблюдатель за командой. Необязательный ключ записи привязывает к кэш-записи. |
| `getEntry`    | `key: string`       | `QueryCacheEntry \| null`    | Синхронно возвращает кэш-запись.                                             |
| `getEntry$`   | `key: string`       | `QueryCacheEntry \| null`    | Реактивный аналог `getEntry` — для использования в реактивном контексте.     |
| `bind`        | `args: TArgsOrKeyed<TArgs>, entryKey?: string` | `TBoundCommand<TArgs, TData>` | Связывает команду с аргументами (и необязательным ключом записи) в инертный дескриптор `{ kind: "command", command, args, entryKey }`. Ничего не запускает. См. [bind][bind]. |


## Расширения

| Метод         | Параметры           | Возвращаемое значение   | Описание                                                                     |
|---------------|---------------------|-------------------------|------------------------------------------------------------------------------|
| `useCommand`  | `entryKey?: string` | `[trigger, TCommandClutchState]` | React-хук. Требует `reactHooksPlugin()`. Подписывается на состояние мутации. `trigger` возвращает [конверт результата][clutch-api-trigger] `TTriggerPromise<TData>` (не реджектится; `.unwrap()` — сырой промис). В `state` доступен `retry()` для повторного запуска упавшей мутации.|


## Bind

`bind` связывает команду с аргументами (и необязательным ключом кэш-записи) в инертный дескриптор — он ничего не запускает. Потребитель отдаёт дескриптор обратно библиотеке, не выполняя мутацию сам:

```typescript
const bound = addTodoCommand.bind({ text: "buy milk" }, "draft-1");
// → { kind: "command", command: addTodoCommand, args: { text: "buy milk" }, entryKey: "draft-1" }

// Позже дескриптор разворачивается:
await bound.command.execute(bound.args, bound.entryKey);
```

Все дескрипторы (`TBoundResource` и `TBoundCommand`) объединены в дискриминированный союз `TBound<TArgs, TData>` с полем-дискриминатором `kind`, поэтому один обработчик может принимать и ресурсы, и команды:

```typescript
function run(bound: TBound<unknown, unknown>) {
    if (bound.kind === "resource") {
        void bound.resource.prefetch(bound.args);
    } else {
        void bound.command.execute(bound.args, bound.entryKey).catch(() => {});
    }
}
```


## Ретраи

Упавшую мутацию можно перезапустить, не создавая новую кэш-запись: `retry()` доступен в состоянии [сцепления команды][clutch-api] и в `state`, который возвращает `useCommand`. Повтор переиспользует тот же [request id][query-fn], поэтому бэкенд может дедуплицировать запрос. Подробнее о `queryFn` и request id — в [руководстве][query-fn].


## См. также

- [Использование команды][usage] — примеры, паттерны, links, lifecycle hooks
- [Ресурс — API][resource-api] — API чтения данных
- [Состояние записи запроса][entry-state] — статусы записи кэша и переходы между ними
- [Сцепление][clutch] — реактивный наблюдатель
- [Сцепление команды — API][clutch-api] — полная таблица методов и статусов сцепления
- [Система кэширования][cache] — жизненный цикл записей кэша


[cache]: ../concepts/cache.md
[bind]: #bind
[usage]: ../usage/command.md
[query-fn]: ../usage/query-fn.md
[usage-links]: ../usage/links.md
[usage-lifecycle]: ../usage/lifecycle.md
[resource-api]: ./resource.md
[entry-state]: ../concepts/query-entry-state.md
[clutch]: ../concepts/clutch.md
[clutch-api]: ./command-clutch.md
[clutch-api-trigger]: ./command-clutch.md#результат-trigger
[clutch-state]: ./command-clutch.md#состояние-tcommandclutchstate
[cache-retention]: ../concepts/cache.md#время-удержания-записи
[api-readme]: ./README.md
[usage-broadcast]: ../usage/broadcast.md
