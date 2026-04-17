# Ресурс (Resource)

Ресурс — абстракция для **чтения данных** с автоматическим кэшированием и stale-while-revalidate (SWR). Для операций записи используйте [команду][command].

Аналог: `useQuery` в TanStack Query, `query endpoint` в RTK Query.


## Создание ресурса

```typescript
const usersResource = api.createResource({
  queryFn: async (args: { page: number }, abortSignal) => {
    const res = await fetch(`/api/users?page=${args.page}`, { signal: abortSignal });
    return res.json();
  },
});
```

`queryFn` — единственная обязательная опция. Принимает аргументы запроса и `AbortSignal`, возвращает промис с данными. При отмене запроса (смена аргументов, размонтирование) сигнал срабатывает автоматически.


## Опции

Полный список опций — см. [API-справочник ресурса][api-resource].


## API ресурса

Полный список методов — см. [API-справочник ресурса][api-resource].


## React: useResource

Для работы в React подключите `reactHooksPlugin()` при создании API:

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [reactHooksPlugin()],
});
```

`useResource` — метод на экземпляре ресурса, доступный после подключения плагина:

```tsx
function UsersList({ page }: { page: number }) {
  const { data, error, isLoading } = usersResource.useResource({ page });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <ul>
      {data.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}
```

Поведение хука:

1. При монтировании — запускает запрос с переданными аргументами.
2. При изменении аргументов — автоматически перезапрашивает данные.
3. При размонтировании — отписывается. Кэш-запись сохраняется в течение `retentionTime`.
4. При повторном монтировании с теми же аргументами — данные берутся из кэша мгновенно.


## Условные запросы

Передайте `SKIP` вместо аргументов, чтобы отложить запрос:

```tsx
import { SKIP } from '@fozy-labs/rx-toolkit';

function UserProfile({ userId }: { userId: string | null }) {
  const { data, isLoading } = userResource.useResource(
    userId ? { id: userId } : SKIP,
  );

  if (!userId) return <p>Выберите пользователя</p>;
  if (isLoading) return <Spinner />;
  return <h1>{data.name}</h1>;
}
```

`SKIP` полностью останавливает наблюдение — запрос не выполняется, состояние сбрасывается в `idle`.


## Состояния ресурса

`useResource` возвращает объект с полями `status`, `data`, `error` и булевыми флагами:

| Поле | Тип | Описание |
|---|---|---|
| `status` | `string` | `'idle'` · `'pending'` · `'success'` · `'error'` · `'refreshing'` · `'refresh-error'` |
| `data` | `TData \| null` | Данные последнего успешного ответа. Сохраняются при `refreshing`. |
| `error` | `unknown` | Ошибка последнего запроса. |
| `isLoading` | `boolean` | `true` при любом незавершённом запросе. |
| `isInitialLoading` | `boolean` | `true` только при первой загрузке (данных ещё нет). |
| `isSuccess` | `boolean` | `true` когда данные получены. |
| `isError` | `boolean` | `true` при ошибке. |
| `isRefreshing` | `boolean` | `true` при фоновом обновлении (SWR). |
| `isRefreshError` | `boolean` | `true` при ошибке фонового обновления. |

### Фоновое обновление (refresh)

Вызов `refresh(args)` или `trigger(args, true)` обновляет данные **без потери текущего отображения**. Пользователь продолжает видеть прежние данные, пока в фоне выполняется новый запрос. Когда ответ приходит — данные обновляются на месте; если запрос падает с ошибкой, прежние данные сохраняются, а статус переходит в `refresh-error`.

### Плавная смена аргументов (SWR)

Когда аргументы `useResource` меняются (например, пользователь переключает страницу), компонент **не сбрасывается в пустое состояние**. Вместо этого на экране остаются данные предыдущего запроса, пока загружаются новые. Как только новые данные готовы, они автоматически заменяют старые.


## Императивный API

### trigger

```typescript
const data = await usersResource.trigger({ page: 1 });
```

Запускает `queryFn` и возвращает промис с результатом. Параллельные вызовы с одинаковыми аргументами дедуплицируются — возвращается один и тот же промис.

### refresh

```typescript
usersResource.refresh({ page: 1 });
```

Запускает повторный запрос для кэш-записи. Если у записи есть активные подписчики — запрос выполняется немедленно. Без подписчиков — данные будут перезапрошены при следующем обращении.


### getEntry

Синхронно возвращает кэш-запись для указанных аргументов, или `null` если данные ещё не запрашивались. С флагом `doInitiate = true` — создаёт запись и запускает загрузку, если её ещё нет.

```ts
// Проверить, есть ли данные в кэше
const entry = usersResource.getEntry({ page: 1 });
if (entry) {
  console.log(entry.machine$().data);
}
```


### getEntry$

Реактивный аналог `getEntry`. Вызывает сигнал внутри, поэтому должен использоваться в реактивном контексте (`Signal.compute`, `Signal.effect` и т. д.). Возвращает кэш-запись или `null`.

```ts
const entry$ = Signal.compute(() => usersResource.getEntry$({ page: page$() }));
```

### createAgent

Агент — реактивный наблюдатель ресурса.
Он отслеживает текущую и при необходимости предыдущую запись кэша,
объединяя их в плоский вычисляемый сигнал.
Агент является строительным блоком для React-хука `useResource` и не требует явного уничтожения — внутренние сигналы деактивируются при потере подписчиков.
Полная таблица методов и статусов — в [API агента ресурса][api-res-agent].

```ts
const agent = usersResource.createAgent();
agent.start({ page: 1 });
// agent.state$() → { status: "pending", data: null, isInitialLoading: true, ... }
```

При смене аргументов через `start(newArgs)` агент реализует SWR-поведение:
    если предыдущий запрос содержит данные (статус `success` или `refreshing`),
    они сохраняются в `data`, а `status` переключается на `"refreshing"` до получения нового ответа.
Это позволяет показывать устаревшие данные вместо пустого состояния.

```ts
agent.start({ page: 2 }); // SWR: data от page:1, status: "refreshing"
agent.start(SKIP);        // idle: data: null, status: "idle"
```


## Связи (Links)

Связи позволяют декларативно связать команду с ресурсами — подробнее в [руководстве по связям][links].


## Хуки жизненного цикла

Хуки позволяют реагировать на события кэша — подробнее в [руководстве по жизненному циклу][lifecycle].


## См. также

- [Команда][command] — мутации (создание, обновление, удаление)
- [Машина состояний запроса][machine] — детали переходов между статусами
- [Кэш][cache] — система кэширования записей
- [Агент][agent] — SWR-наблюдатель, связывающий UI с записью кэша
- [Кросс-табовая синхронизация][broadcast] — синхронизация кэша между вкладками

[command]: ./command.md
[machine]: ../concepts/machine.md
[api-resource]: ../api/resource.md
[lifecycle]: ./lifecycle.md
[links]: ./links.md
[cache]: ../concepts/cache.md
[agent]: ../concepts/agent.md
[api-res-agent]: ../api/resource-agent.md
[broadcast]: ./broadcast.md
