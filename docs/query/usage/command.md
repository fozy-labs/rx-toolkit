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
  const [trigger, { data, error, isPending }] = addTodoCommand.useCommand();
  const [text, setText] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await trigger({ text });
    setText('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={text} onChange={e => setText(e.target.value)} disabled={isPending} />
      <button disabled={isPending}>Добавить</button>
      {error && <p>Ошибка: {String(error)}</p>}
    </form>
  );
}
```

Поведение хука:

1. Хук не запускает запрос при монтировании — мутация выполняется только при вызове `trigger`.
2. `trigger(args)` запускает `queryFn` и возвращает `TTriggerPromise<TData>` — [конверт результата](#результат-trigger); промис не реджектится.
3. Состояние (`isPending`, `hasData`, `hasError`) обновляется реактивно.


## Результат trigger

`trigger` из `useCommand` (и `clutch.trigger`) возвращает промис, который **никогда не реджектится** — итог приходит конвертом, дискриминированным по `status`. Обрабатывать ошибку через try/catch не нужно:

```tsx
const result = await trigger({ text });

if (result.status === 'error') {
  console.error(result.error);
} else {
  console.log(result.data);
}
```

Когда удобнее «бросающая» семантика, у промиса есть `unwrap()` — сырой результат: данные при успехе, исключение при ошибке:

```tsx
try {
  const data = await trigger({ text }).unwrap();
} catch (err) {
  // ошибка мутации
}
```

Игнорировать результат тоже безопасно — необработанного реджекта не будет, а ошибка отразится реактивно через `state.hasError`.

## Состояния команды

`useCommand` возвращает `[trigger, state]`, где `state` содержит:

| Поле | Тип | Описание |
|---|---|---|
| `status` | `TClutchStatus` | `'idle'` · `'pending'` · `'success'` · `'error'` |
| `data` | `TData \| null` | Данные последнего успешного ответа. |
| `error` | `TError \| null` | Ошибка последней мутации; живёт до следующего ответа, поэтому переживает повтор. По умолчанию `unknown`; типизируется опцией API [`mapError`](../api/README.md#типизация-ошибок-maperror). |
| `isPending` | `boolean` | `true` при выполнении мутации. |
| `hasData` | `boolean` | `true` ⇔ `status === 'success'`. |
| `hasError` | `boolean` | `true` ⇔ `error !== null`. |
| `args` | `TArgs \| null` | Аргументы последнего запуска. |
| `retry` | `() => void` | Перезапускает упавшую мутацию (тот же request id). No-op вне состояния `error`. |

Состояние — **дискриминированное объединение**: проверка `status` или любого флага сужает типы остальных полей — `hasData` гарантирует `data: TData` (без `| null`), `hasError` — `error: TError`. Пока идёт повтор упавшей мутации, истинны и `isPending`, и `hasError`. Полная таблица вариантов — в [API сцепления команды][api-cmd-clutch].


## Ретраи и request id

`queryFn` принимает вторым аргументом **request id** — стабильный ключ идемпотентности. Он генерируется один раз на кэш-запись и переиспользуется при ретраях, поэтому повтор упавшей мутации можно безопасно дедуплицировать на бэкенде. Подробно — в [руководстве по queryFn][query-fn].

```tsx
function PayButton() {
  const [pay, { hasError, error, retry, isPending }] = payCommand.useCommand();

  if (hasError && !isPending) {
    return (
      <div>
        <p>Ошибка: {String(error)}</p>
        <button onClick={retry}>Повторить</button>
      </div>
    );
  }

  return <button disabled={isPending} onClick={() => pay({ amount: 100 })}>Оплатить</button>;
}
```

`retry()` перезапускает текущую (упавшую) кэш-запись — новая запись не создаётся, request id сохраняется, а повторяемая ошибка остаётся читаемой в `error`. Повторный вызов `trigger`, наоборот, создаёт новую запись с новым request id — в том числе с тем же ключом записи, поэтому `data` и `error` прошлого запуска в новое `pending` не переносятся.


## Императивный API

### execute

```typescript
// Без ключа — создаётся автоматическая кэш-запись
const data = await addTodoCommand.execute({ text: 'Новая задача' });

// С явным ключом — привязывает результат к кэш-записи 'my-mutation-1'
const data = await addTodoCommand.execute({ text: 'Новая задача' }, 'my-mutation-1');
```

Запускает `queryFn` и возвращает промис с результатом. Необязательный второй аргумент `entryKey` идентифицирует кэш-запись.

В отличие от `trigger` на уровне сцепления и хука, `Command.execute` возвращает **сырой** `Promise<TData>` — при ошибке мутации он реджектится. Чтобы получить [конверт результата](#результат-trigger) вручную, оберните промис хелпером `wrapTrigger`:

```typescript
import { wrapTrigger } from '@fozy-labs/rx-toolkit';

const result = await wrapTrigger(addTodoCommand.execute({ text: 'Задача' }));
if (result.status === 'error') { /* ... */ }
```

Прежнее имя `Command.trigger` объявлено **deprecated** (контракт идентичен `execute`) и будет удалено в одном из следующих релизов.

### getEntry

Синхронно возвращает кэш-запись для указанного ключа, или `null` если записи нет.

```typescript
const entry = addTodoCommand.getEntry('my-mutation-1');
if (entry) {
  console.log(entry.state$().data);
}
```

### getEntry$

Реактивный аналог `getEntry`. Вызывает сигнал внутри, поэтому должен использоваться в реактивном контексте (`Signal.compute`, `Signal.effect` и т. д.). Возвращает кэш-запись или `null`.

```ts
const entry$ = Signal.compute(() => addTodoCommand.getEntry$('my-mutation-1'));
```

### createClutch

Создаёт сцепление — реактивный наблюдатель за командой. Принимает опциональный `entryKey` для привязки к конкретной кэш-записи.
Полная таблица методов и статусов — в [API сцепления команды][api-cmd-clutch].

```typescript
const clutch = addTodoCommand.createClutch('my-mutation-1');

// trigger через сцепление
clutch.trigger({ text: 'New todo' });
// clutch.state$() → { status: "pending", data: null, isPending: true, ... }
```


## Кэш-ключ команды

Кэш-ключ команды — это строка.
По умолчанию ключ генерируется автоматически (таймстамп + индекс при нескольких вызовах в одном таймстампе),
поэтому каждый вызов создаёт отдельную кэш-запись.

Способ указания ключа зависит от API:

- **Императивно** — ключ передаётся вторым аргументом в метод `execute`:

```typescript
const data = await addTodoCommand.execute({ text: 'Задача' }, 'my-mutation-1');
```

- **React-хук** — ключ задаётся на уровне `useCommand`, а функция `trigger` вызывается только с `args`:

```tsx
const [trigger, state] = addTodoCommand.useCommand('my-mutation-1');
await trigger({ text: 'Задача' });
```

- **Сцепление** — ключ передаётся в `createClutch` и может меняться с помощью методов `trigger` или `setEntryKey`:

```typescript
const clutch = addTodoCommand.createClutch('my-mutation-1');
clutch.trigger({ text: 'Задача' }, 'my-mutation-2');
clutch.setEntryKey('my-mutation-3');
```

Разные потребители могут синхронизировать состояние, используя один и тот же ключ.


## Связи (Links)

Связи позволяют декларативно связать команду с ресурсами — подробнее в [руководстве по связям][links].


## Хуки жизненного цикла

Хуки позволяют реагировать на события кэша — подробнее в [руководстве по жизненному циклу][lifecycle].


## См. также

- [Ресурс][resource] — чтение данных с кэшированием и SWR
- [Состояние записи запроса][entry-state] — детали переходов между статусами
- [Система кэширования][cache] — жизненный цикл записей кэша
- [Сцепление][clutch] — реактивный наблюдатель, транслирующий состояние в UI
- [Broadcast][broadcast] — синхронизация между вкладками; команды поддерживают опцию `sync: true`

[resource]: ./resource.md
[entry-state]: ../concepts/query-entry-state.md
[cache]: ../concepts/cache.md
[clutch]: ../concepts/clutch.md
[broadcast]: ./broadcast.md
[api-command]: ../api/command.md
[api-cmd-clutch]: ../api/command-clutch.md
[lifecycle]: ./lifecycle.md
[links]: ./links.md
[query-fn]: ./query-fn.md
