# Команда (Command)

Команда — абстракция для **операций записи** (мутаций): создание, обновление, удаление данных. Для чтения данных используйте [ресурс][resource].

Аналог: `useMutation` в TanStack Query, `mutation endpoint` в RTK Query.


## Создание команды

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

`queryFn` — единственная обязательная опция. Принимает аргументы мутации и `AbortSignal`, возвращает промис с данными. `links` — массив связей с ресурсами, которые нужно обновить после выполнения команды.


## Опции

Полный список опций — см. [API-справочник команды][api-command].


## API команды

Полный список методов — см. [API-справочник команды][api-command].


## React: useCommand

Для работы в React подключите `reactHooksPlugin()` при создании API:

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [reactHooksPlugin()],
});
```

`useCommand` — метод на экземпляре команды, доступный после подключения плагина:

```tsx
function AddTodoForm() {
  const [trigger, { data, error, isLoading }] = addTodoCommand.useCommand();
  const [text, setText] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await trigger({ text });
    setText('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={text} onChange={e => setText(e.target.value)} disabled={isLoading} />
      <button disabled={isLoading}>Добавить</button>
      {error && <p>Ошибка: {String(error)}</p>}
    </form>
  );
}
```

Поведение хука:

1. Хук не запускает запрос при монтировании — мутация выполняется только при вызове `trigger`.
2. `trigger(args)` запускает `queryFn` и возвращает `Promise<TData>`.
3. Состояние (`isLoading`, `isSuccess`, `isError`) обновляется реактивно.
4. При размонтировании — подписка отменяется, кеш-запись сохраняется.

Объект состояния содержит поля: `status`, `data`, `error`, `isLoading`, `isSuccess`, `isError`.


## Императивный API

### trigger

```typescript
// Без ключа — создаётся автоматическая кеш-запись
const data = await addTodoCommand.trigger({ text: 'Новая задача' });

// С явным ключом — привязывает результат к кеш-записи 'my-mutation-1'
const data = await addTodoCommand.trigger({ text: 'Новая задача' }, 'my-mutation-1');
```

Запускает `queryFn` и возвращает промис с результатом. Необязательный второй аргумент `key` идентифицирует кеш-запись.

### Ключ (key)

Кеш-ключ команды — это **key**.
По умолчанию `key` генерируется автоматически (sid — таймстамп + индекс),
поэтому каждый вызов создаёт отдельную кеш-запись.

Способ передачи ключа зависит от API:

- **Императивно** — ключ передаётся вторым аргументом в `trigger`:

```typescript
const data = await addTodoCommand.trigger({ text: 'Задача' }, 'my-mutation-1');
```

- **React-хук** — ключ задаётся на уровне `useCommand`, а `trigger` вызывается только с `args`:

```tsx
const [trigger, state] = addTodoCommand.useCommand('my-mutation-1');
await trigger({ text: 'Задача' });
```

- **Агент** — ключ передаётся в `createAgent`:

```typescript
const agent = addTodoCommand.createAgent({ key: 'my-mutation-1' });
```

Разные потребители могут синхронизировать состояние, используя один и тот же ключ.

### getEntry

Синхронно возвращает кеш-запись для указанного ключа, или `null` если записи нет.

```typescript
const entry = addTodoCommand.getEntry('my-mutation-1');
if (entry) {
  console.log(entry.machine$().data);
}
```

### getEntry$

Реактивный аналог `getEntry`. Вызывает сигнал внутри, поэтому должен использоваться в реактивном контексте (`Signal.compute`, `Signal.effect` и т. д.). Возвращает кеш-запись или `null`.

```ts
const entry$ = Signal.compute(() => addTodoCommand.getEntry$('my-mutation-1'));
```

### createAgent

Создаёт агент — реактивный наблюдатель за командой. Принимает опциональный `key` для привязки к конкретной кеш-записи.

```typescript
const agent = addTodoCommand.createAgent({ key: 'my-mutation-1' });

// trigger через агент
agent.trigger({ text: 'New todo' });
// agent.state$() → { status: "pending", data: null, isLoading: true, ... }
```


## Links

Links — механизм связи команды с ресурсами. Позволяет после мутации инвалидировать или обновить кеш связанных ресурсов.

`link()` — метод на целевом ресурсе. Возвращает объект конфигурации связи.

| Поле            | Тип                                 | Описание                                                                                |
|-----------------|-------------------------------------|-----------------------------------------------------------------------------------------|
| `forwardArgs`   | `(commandArgs) => resourceArgs`     | Обязательное. Преобразование аргументов команды в аргументы ресурса.                    |
| `invalidate`    | `boolean`                           | Инвалидировать кеш ресурса после выполнения команды.                                    |
| `optimisticUpdate` | `(draft, commandArgs) => void`      | Немедленно обновить кеш ресурса до получения ответа. При ошибке — автоматический откат. |
| `update`        | `(draft, commandArgs, result) => void` | Обновить кеш ресурса данными из ответа сервера.                                         |

### Инвалидация

Простейший сценарий — инвалидировать кеш ресурса после мутации. Ресурс будет перезапрошен при следующем обращении:

```typescript
links: [
  todosResource.link({
    forwardArgs: () => undefined,
    invalidate: true,
  }),
]
```

### Обновление после ответа

Обновляет кеш ресурса данными из ответа сервера:

```typescript
links: [
  userResource.link({
    forwardArgs: (args) => args.userId,
    update: (draft, _, result) => {
      Object.assign(draft, result.user);
    },
  }),
]
```

### Оптимистичное обновление

Немедленно обновляет кеш ресурса, не дожидаясь ответа сервера. При ошибке мутации — автоматический откат:

```typescript
links: [
  todosResource.link({
    forwardArgs: () => undefined,
    invalidate: true,
    optimisticUpdate: (draft, args) => {
      draft.push(args.optimisticTodo);
    },
  }),
]
```

`optimisticUpdate` и `invalidate` можно комбинировать в одном вызове `link()`.


## Хуки жизненного цикла

### onCacheEntryAdded

Вызывается один раз при создании кеш-записи:

```typescript
const command = api.createCommand({
  queryFn: executeMutation,
  onCacheEntryAdded: (args, { entry, $cacheDataLoaded, $cacheEntryRemoved }) => {
    // entry — кеш-запись
    // $cacheDataLoaded — разрешается при первом успешном ответе
    // $cacheEntryRemoved — разрешается при удалении записи из кеша
  },
});
```

### onQueryStarted

Вызывается при каждом запуске `queryFn`:

```typescript
const command = api.createCommand({
  queryFn: executeMutation,
  onQueryStarted: async (args, { entry, $queryFulfilled }) => {
    const { data } = await $queryFulfilled;
    // entry — доступ к кеш-записи
  },
});
```


## См. также

- [Ресурс][resource] — чтение данных с кешированием и SWR
- [Стейт-машина запроса][machine] — детали переходов между статусами

[resource]: ./resource.md
[machine]: ../concepts/machine.md
[api-command]: ../api/command.md
