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
  links: (link) => link({
    resource: todosResource,
    forwardArgs: () => undefined,
    invalidate: true,
  }),
});
```

`queryFn` — единственная обязательная опция. Принимает аргументы мутации, возвращает промис с данными. 
`links` — колбэк, описывающий связи с ресурсами, которые нужно обновить после выполнения команды.


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

## Состояния команды

`useCommand` возвращает `[trigger, state]`, где `state` содержит:

| Поле | Тип | Описание |
|---|---|---|
| `status` | `string` | `'idle'` · `'pending'` · `'success'` · `'error'` |
| `data` | `TData \| null` | Данные последнего успешного ответа. |
| `error` | `unknown` | Ошибка последнего запроса. |
| `isLoading` | `boolean` | `true` при выполнении мутации. |
| `isSuccess` | `boolean` | `true` когда мутация завершилась успешно. |
| `isError` | `boolean` | `true` при ошибке мутации. |
| `retry` | `() => void` | Перезапускает упавшую мутацию (тот же request id). No-op вне состояния `error`. |


## Ретраи и request id

`queryFn` принимает вторым аргументом **request id** — стабильный ключ идемпотентности. Он генерируется один раз на кэш-запись и переиспользуется при ретраях, поэтому повтор упавшей мутации можно безопасно дедуплицировать на бэкенде. Подробно — в [руководстве по queryFn][query-fn].

```tsx
function PayButton() {
  const [pay, { isError, error, retry, isLoading }] = payCommand.useCommand();

  if (isError) {
    return (
      <div>
        <p>Ошибка: {String(error)}</p>
        <button onClick={retry}>Повторить</button>
      </div>
    );
  }

  return <button disabled={isLoading} onClick={() => pay({ amount: 100 })}>Оплатить</button>;
}
```

`retry()` перезапускает текущую (упавшую) кэш-запись — новая запись не создаётся, request id сохраняется. Повторный вызов `trigger` без явного ключа, наоборот, создаёт новую запись с новым request id.


## Императивный API

### trigger

```typescript
// Без ключа — создаётся автоматическая кэш-запись
const data = await addTodoCommand.trigger({ text: 'Новая задача' });

// С явным ключом — привязывает результат к кэш-записи 'my-mutation-1'
const data = await addTodoCommand.trigger({ text: 'Новая задача' }, 'my-mutation-1');
```

Запускает `queryFn` и возвращает промис с результатом. Необязательный второй аргумент `key` идентифицирует кэш-запись.

### getEntry

Синхронно возвращает кэш-запись для указанного ключа, или `null` если записи нет.

```typescript
const entry = addTodoCommand.getEntry('my-mutation-1');
if (entry) {
  console.log(entry.machine$().data);
}
```

### getEntry$

Реактивный аналог `getEntry`. Вызывает сигнал внутри, поэтому должен использоваться в реактивном контексте (`Signal.compute`, `Signal.effect` и т. д.). Возвращает кэш-запись или `null`.

```ts
const entry$ = Signal.compute(() => addTodoCommand.getEntry$('my-mutation-1'));
```

### createAgent

Создаёт агент — реактивный наблюдатель за командой. Принимает опциональный `key` для привязки к конкретной кэш-записи.
Полная таблица методов и статусов — в [API агента команды][api-cmd-agent].

```typescript
const agent = addTodoCommand.createAgent('my-mutation-1');

// trigger через агент
agent.trigger({ text: 'New todo' });
// agent.state$() → { status: "pending", data: null, isLoading: true, ... }
```


## Кэш-ключ команды

Кэш-ключ команды — это строка.
По умолчанию ключ генерируется автоматически (таймстамп + индекс при нескольких вызовах в одном таймстампе),
поэтому каждый вызов создаёт отдельную кэш-запись.

Способ указания ключа зависит от API:

- **Императивно** — ключ передаётся вторым аргументом в метод `trigger`:

```typescript
const data = await addTodoCommand.trigger({ text: 'Задача' }, 'my-mutation-1');
```

- **React-хук** — ключ задаётся на уровне `useCommand`, а функция `trigger` вызывается только с `args`:

```tsx
const [trigger, state] = addTodoCommand.useCommand('my-mutation-1');
await trigger({ text: 'Задача' });
```

- **Агент** — ключ передаётся в `createAgent` и может меняться с помощью методов `trigger` или `setKey`:

```typescript
const agent = addTodoCommand.createAgent('my-mutation-1');
agent.trigger({ text: 'Задача' }, 'my-mutation-2');
agent.setKey('my-mutation-3');
```

Разные потребители могут синхронизировать состояние, используя один и тот же ключ.


## Связи (Links)

Связи позволяют декларативно связать команду с ресурсами — подробнее в [руководстве по связям][links].


## Хуки жизненного цикла

Хуки позволяют реагировать на события кэша — подробнее в [руководстве по жизненному циклу][lifecycle].


## См. также

- [Ресурс][resource] — чтение данных с кэшированием и SWR
- [Машина состояний][machine] — детали переходов между статусами
- [Система кэширования][cache] — жизненный цикл записей кэша
- [Агент][agent] — реактивный наблюдатель, транслирующий состояние в UI
- [Broadcast][broadcast] — синхронизация между вкладками; команды поддерживают опцию `sync: true`

[resource]: ./resource.md
[machine]: ../concepts/machine.md
[cache]: ../concepts/cache.md
[agent]: ../concepts/agent.md
[broadcast]: ./broadcast.md
[api-command]: ../api/command.md
[api-cmd-agent]: ../api/command-agent.md
[lifecycle]: ./lifecycle.md
[links]: ./links.md
[query-fn]: ./query-fn.md
