# Кросс-табовая синхронизация (Broadcast)

Кросс-табовая синхронизация позволяет разделять состояние кеша между вкладками браузера. 
Если одна вкладка уже загрузила или загружает данные, другая получит их без повторного сетевого запроса. 
Функция доступна как для [ресурсов][resource], так и для [команд][command].


## syncDriver

Опция `syncDriver` задаётся при вызове `createApi` и принимает реализацию интерфейса `ISyncDriver`:

```typescript
import { createApi } from '@fozy-labs/rx-toolkit';

const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: /* реализация ISyncDriver */,
});
```

Если `syncDriver` не указан (по умолчанию `undefined`), синхронизация между вкладками отключена.


## broadcastSyncDriver

Встроенная реализация `ISyncDriver` на основе [BroadcastChannel API][broadcast-channel]. Принимает объект конфигурации:

| Параметр | Тип | Описание                                                                                             |
|---|---|------------------------------------------------------------------------------------------------------|
| `channel` | `string` | Не обязательное поле. Имя канала `BroadcastChannel`, через который вкладки обмениваются сообщениями. |

```typescript
import { createApi, broadcastSyncDriver } from '@fozy-labs/rx-toolkit';

const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: broadcastSyncDriver(),
});
```

## Поток данных

1. Вкладка открывается и подписывается на канал.
2. При запросе данных вкладка рассылает сообщение остальным вкладкам о потребности в данных.
3. Если другая вкладка:
   - уже имеет закешированный успешный ответ (`success`, без патчей) — она передает эти данные
   - во всех остальных случаях — игнорирует запрос
4. Вкладка-получатель использует полученные данные вместо повторного сетевого запроса.

## Управление синхронизацией

По умолчанию:
- **Ресурсы** — `sync: true` (синхронизация включена)
- **Команды** — `sync: false` (синхронизация отключена)

Опция `sync` задаётся на уровне отдельного ресурса или команды и переопределяет поведение по умолчанию:

```typescript
const privateResource = api.createResource({
    key: 'private',
    queryFn: fetchPrivateData,
    sync: false, // отключить синхронизацию для этого ресурса
});

const sharedCommand = api.createCommand({
    key: 'shared',
    queryFn: executeSharedMutation,
    sync: true, // включить синхронизацию для этой команды
});
```

Опция игнорируется, если `syncDriver` не задан в [API][api-readme].


## Пример

```typescript
const api = createApi({
  keyPrefix: 'my-api',
  syncDriver: broadcastSyncDriver({
    channel: 'my-api-channel',
  }),
});

const getUser = api.createResource({
  key: 'getUser',
  queryFn: (args: { id: string }) => fetch(`/api/users/${args.id}`).then(r => r.json()),
});

// В React-компоненте:
getUser.useResource({ id: '1' });
// → рассылка запроса о наличии данных в других вкладках
```


## См. также

- [API-справочник][api-readme] — полная таблица опций `createApi`
- [Кеш][cache] — управление кеш-записями и их жизненным циклом
- [Потоки данных][dataflows] — диаграмма кросс-табовой синхронизации

---

[resource]: ./resource.md
[command]: ./command.md
[api-readme]: ../api/README.md
[cache]: ../concepts/cache.md
[dataflows]: ../concepts/dataflows.md
[broadcast-channel]: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
