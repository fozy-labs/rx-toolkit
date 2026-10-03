# Кросс-табовая синхронизация (Broadcast)

Кросс-табовая синхронизация позволяет новой записи ресурса взять данные из кэша другой вкладки вместо сетевого запроса.
Это однократный запрос при первой загрузке записи, а не постоянная синхронизация:
    первый запуск новой записи (не гидрированной из снимка) перед `queryFn` отправляет запрос (REQ) через `syncDriver`;
    если другая вкладка располагает данными, она отвечает (RES) — и сетевой запрос не выполняется.
Внутри это реализовано через хук `beforeQuery`, который `createApi` внедряет в каждый ресурс с `key` и включённой синхронизацией.

После первой загрузки вкладки ничего друг другу не рассылают: перезапрос, мутация, патч и инвалидация в одной вкладке не доходят до записей, уже созданных в других, — данные вкладок могут разойтись.
Ресурс без `key` в синхронизации не участвует: он не спрашивает другие вкладки и не отвечает им.
Ожидание ответа — запрос холодной записи в полёте, вместе с `queryFn`, в который оно переходит без ответа: `invalidate()`, `fetch` и `prefetch(args, { force: true })` применяют к нему режим `inFlight` ([инвалидация в полёте][cache-inflight]). `join` дожидается ответа, `cancel` бросает ожидание и отправляет свой запрос (поздний ответ игнорируется), `trail` отправляет свежий запрос, когда ожидание закончилось.

Синхронизация управляется через `syncDriver` — опцию `createApi`,
    принимающую реализацию интерфейса `ISyncDriver`.


## Подключение syncDriver

Опция `syncDriver` задаётся при вызове `createApi`:

```typescript
import { createApi, broadcastSyncDriver } from '@fozy-labs/rx-toolkit';

const api = createApi({
  keyPrefix: 'my-api',
  defaultSync: 'resources',
  syncDriver: broadcastSyncDriver(),
});
```


## broadcastSyncDriver

Встроенная реализация `ISyncDriver` на базе [BroadcastChannel API][broadcast-channel].

| Параметр  | Тип      | По умолчанию                | Описание                                                                       |
|-----------|----------|-----------------------------|--------------------------------------------------------------------|
| `channel` | `string` | `"rx-toolkit:{keyPrefix}"` | Имя `BroadcastChannel`. Если не указано, генерируется из `keyPrefix` API; без `keyPrefix` — `"rx-toolkit"`. |

```typescript
// Канал по умолчанию — "rx-toolkit:my-api"
const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: broadcastSyncDriver(),
});

// Явное имя канала
const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: broadcastSyncDriver({ channel: 'shared-state' }),
});
```


### На сервере (SSR)

`BroadcastChannel` есть и в Node.js (с версии 18): там каналы с одним именем связывают все api в одном процессе, включая `worker_threads`.
    На SSR-сервере, где api создаётся на каждый запрос ([снимок][snapshot-server]), api одного запроса ответит на REQ другого —
    и данные одного пользователя попадут в страницу и снимок другого.
Не передавайте `syncDriver` на сервере:

```typescript
const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: typeof window !== 'undefined' ? broadcastSyncDriver() : undefined,
});
```


## Управление синхронизацией

Опции, определяющие, участвует ли ресурс в синхронизации.
Команды не синхронизируются, поэтому `defaultSync: 'all'` действует так же, как `'resources'`.

| Сущность    | Опция         | Принимаемое значение           | По умолчанию        |
|-------------|---------------|--------------------------------|---------------------|
| **api**     | `defaultSync` | `resources` \| `all` \| `none` | `none`              |
| **Ресурс**  | `sync`        | `boolean`                      | **api defaultSync** |

> Если `syncDriver` не задан в `createApi`, то синхронизация работать не будет.

```typescript
const getCatalog = api.createResource({
  key: 'catalog',
  queryFn: fetchCatalog,
  sync: true,
});

// Приватные данные пользователя — отключаем sync
const getProfile = api.createResource({
  key: 'profile',
  queryFn: fetchProfile,
  sync: false,
});
```


## Что синхронизируется

Когда вкладка получает REQ и запись находится в одном из состояний ниже,
она отвечает RES с соответствующими данными:

| Состояние [записи][entry-state]                      | Данные в RES   |
|------------------------------------------------------|----------------|
| `pending`                                            | —              |
| `success`                                            | `data`         |
| `success` (с патчами)                                | `originalData` |
| `success`, помеченная инвалидацией (`isInvalidated`) | —              |
| `error`                                              | —              |
| `invalidating`                                       | —              |
| `invalidate-error`                                   | —              |

Помеченная запись ждёт перезапроса ([инвалидация тающей записи][cache-invalidation]) — её данные не заселяют холодную запись другой вкладки как свежие.


## Кастомный syncDriver

`ISyncDriver` — транспортно-агностичный контракт. 
Встроенная реализация — `broadcastSyncDriver`, но можно создать свою (WebSocket, SharedWorker и т. д.).


### ISyncDriver

| Метод        | Сигнатура                                       | Описание                                                                |
|--------------|--------------------------------------------------|-------------------------------------------------------------------------|
| `connect`    | `(onMessage: (msg: ISyncMessage) => void, context: { keyPrefix: string }) => void` | Подключиться к каналу. `onMessage` вызывается при получении внешних сообщений; `context.keyPrefix` — `keyPrefix` api, `""` если его нет |
| `disconnect` | `() => void`                                     | Отключиться от канала и освободить ресурсы                              |
| `send`       | `(message: ISyncMessage) => void`                | Отправить сообщение                |


### ISyncMessage

| Поле        | Тип                              | Описание                                  |
|-------------|----------------------------------|-------------------------------------------|
| `type`      | `REQ` \| `RES`                   | Тип сообщения: запрос, ответ или ошибка   |
| `reqId`     | `string`                         | Идентификатор запроса (для связи REQ-RES) |
| `keys`      | `[<prefix>, <key>, <entry_key>]` | Ключи                                     |
| `data`      | `any`                            | Данные (для RES)                          |


## Полный пример

Пример демонстрирует `createApi` с `broadcastSyncDriver`,
    ресурс и команду со связями — и поведение на двух вкладках.

```typescript
import { createApi, broadcastSyncDriver } from '@fozy-labs/rx-toolkit';
import { reactHooksPlugin } from '@fozy-labs/rx-toolkit/react';

const api = createApi({
  keyPrefix: 'main-api',
  syncDriver: broadcastSyncDriver(),
  plugins: [reactHooksPlugin()],
  defaultSync: 'resources', // синхронизировать ресурсы по умолчанию
});

// Ресурс — sync: true (наследуется от defaultSync: 'resources')
const todosResource = api.createResource({
  key: 'todos',
  queryFn: async () => {
    const res = await fetch('/api/todos');
    return res.json();
  },
});

// Команда не синхронизируется. Её связь инвалидирует ресурс только в этой вкладке:
// другие вкладки об инвалидации не узнают.
const addTodoCommand = api.createCommand({
  key: 'add-todo',
  queryFn: async (args: { text: string }) => {
    const res = await fetch('/api/todos', { method: 'POST', body: JSON.stringify(args) });
    return res.json();
  },
  links: (link) => link({
    resource: todosResource,
    forwardArgs: () => undefined,
    invalidate: true,
  }),
});
```

```tsx
function TodoApp() {
  const { data: todos, hasData } = todosResource.useResource();
  const [addTodo, { isPending }] = addTodoCommand.useCommand();

  if (!hasData) return <p>Загрузка...</p>;

  return (
    <div>
      <ul>
        {todos.map((t: any) => <li key={t.id}>{t.text}</li>)}
      </ul>
      <button disabled={isPending} onClick={() => addTodo({ text: 'Новая задача' })}>
        Добавить
      </button>
    </div>
  );
}
```

Вторая вкладка, открытая после первой, получает список задач из её кэша без запроса к серверу.
Задача, добавленная в одной вкладке, в другой не появится, пока та сама не перезапросит список.


## См. также

- [API-справочник][api-readme] — полная таблица опций `createApi`
- [Связи (Links)][links] — декларативное соединение команд и ресурсов
- [Патчинг][patching] — механизм оптимистичных обновлений и отката
- [Ресурс (API)][api-resource] — опции ресурса, включая `sync`
- [Кэш][cache] — управление кэш-записями и их жизненным циклом
- [Потоки данных][dataflows] — диаграммы кросс-табовой синхронизации



[links]: ./links.md
[api-readme]: ../api/README.md
[api-resource]: ../api/resource.md
[cache]: ../concepts/cache.md
[cache-invalidation]: ../concepts/cache.md#инвалидация-тающей-записи
[cache-inflight]: ../concepts/cache.md#инвалидация-в-полёте
[dataflows]: ../concepts/dataflows.md
[entry-state]: ../concepts/query-entry-state.md
[snapshot-server]: ./snapshot.md#api-на-сервере
[patching]: ../concepts/patching.md
[broadcast-channel]: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
