# Кросс-табовая синхронизация (Broadcast)

Кросс-табовая синхронизация позволяет нескольким вкладкам браузера разделять состояние кэша.
Когда вкладке нужны данные, она перед выполнением `queryFn` отправляет запрос (REQ) через `syncDriver`;
    если другая вкладка уже располагает данными, она отвечает (RES) — и сетевой запрос не выполняется.
Внутри это реализовано через хук `beforeQuery`, который `createApi` автоматически внедряет в каждый ресурс с включённой синхронизацией:
    непосредственно перед вызовом `queryFn` хук отправляет REQ через `syncDriver` и, получив RES, возвращает данные из другой вкладки, минуя сеть.
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
| `channel` | `string` | `"rx-toolkit:{keyPrefix}"` | Имя `BroadcastChannel`. Если не указано, генерируется из `keyPrefix` API. |

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


## Управление синхронизацией

Опции определяющие, участвует ли ресурс или команда в синхронизации.

| Сущность    | Опция         | Принимаемое значение           | По умолчанию        |
|-------------|---------------|--------------------------------|---------------------|
| **api**     | `defaultSync` | `resources` \| `all` \| `none` | `none`              |
| **Ресурс**  | `sync`        | `boolean`                      | **api defaultSync** |
| **Команда** | `sync`        | `boolean`                      | **api defaultSync** |

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

// Мутация, результат которой нужен всем вкладкам
const markRead = api.createCommand({
  key: 'markRead',
  queryFn: markNotificationRead,
  sync: true,
});
```


## Что синхронизируется

Когда вкладка получает REQ и запись находится в одном из состояний ниже,
она отвечает RES с соответствующими данными:

| Состояние [машины][machine] | Данные в RES   |
|-----------------------------|----------------|
| `pending`                   | —              |
| `success`                   | `data`         |
| `success` (с патчами)       | `originalData` |
| `error`                     | —              |
| `refreshing`                | —              |
| `refresh-error`             | —              |


## Кастомный syncDriver

`ISyncDriver` — транспортно-агностичный контракт. 
Встроенная реализация — `broadcastSyncDriver`, но можно создать свою (WebSocket, SharedWorker и т. д.).


### ISyncDriver

| Метод        | Сигнатура                                       | Описание                                                                |
|--------------|--------------------------------------------------|-------------------------------------------------------------------------|
| `connect`    | `(onMessage: (msg: ISyncMessage) => void) => void` | Подключиться к каналу. `onMessage` вызывается при получении внешних сообщений |
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
import { createApi, broadcastSyncDriver, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  keyPrefix: 'main-api',
  syncDriver: broadcastSyncDriver(),
  plugins: [reactHooksPlugin()],
  defaultSync: 'resources', // по умолчанию синхронизировать только ресурсы
});

// Ресурс — sync: true (наследуется от defaultSync: 'resources')
const todosResource = api.createResource({
  key: 'todos',
  queryFn: async () => {
    const res = await fetch('/api/todos');
    return res.json();
  },
});
```

```tsx
function TodoApp() {
  const { data: todos, isLoading } = todosResource.useResource();

  if (isLoading) return <p>Загрузка...</p>;

  return (
    <div>
      <ul>
        {todos.map((t: any) => <li key={t.id}>{t.text}</li>)}
      </ul>
      <button disabled={isSaving} onClick={() => trigger({ text: 'Новая задача' })}>
        Добавить
      </button>
    </div>
  );
}
```


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
[dataflows]: ../concepts/dataflows.md
[machine]: ../concepts/machine.md
[patching]: ../concepts/patching.md
[broadcast-channel]: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
