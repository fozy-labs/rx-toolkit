# queryFn — функция запроса

`queryFn` — единственная обязательная опция и [ресурса][resource], и [команды][command]. Это функция, которая
выполняет реальный ввод-вывод (HTTP, WebSocket, gRPC, чтение из IndexedDB — что угодно) и возвращает промис с данными.


## Почему fetcher не встроен в API

RxToolkit отвечает за **состояние**: кэш, реактивность, машину статусов, SWR, оптимистичные обновления, дедуп,
синхронизацию вкладок. Он сознательно **не** берёт на себя транспорт — то, _как_ вы ходите в сеть, остаётся за вами.
Причины:

- **Транспорт-агностичность.** `fetch`, `axios`, `ky`, GraphQL-клиент, gRPC-web, мок в тестах — toolkit работает с
  любым источником, потому что видит только `Promise<TData>`.
- **Никакого скрытого слоя.** Базовый URL, заголовки, авторизация, повторная аутентификация, парсинг ошибок,
  ретраи на уровне транспорта — это политика приложения. Встроенный fetcher навязал бы свои умолчания и конфигурацию.
- **Тестируемость.** `queryFn` — обычная функция. В тестах её подменяют без моков сети.
- **Явность.** В одном месте видно и аргументы, и сам запрос, и форму ответа.

Поэтому fetcher пишете вы — а toolkit оборачивает его кэшем и реактивностью.


## queryFn у ресурса и команды

Сигнатуры различаются вторым аргументом — он отражает природу операции:

| | Ресурс (чтение) | Команда (запись) |
|---|---|---|
| Сигнатура | `(args, abortSignal: AbortSignal) => Promise<TData>` | `(args, requestId: string) => Promise<TData>` |
| Второй аргумент | `AbortSignal` — отмена устаревшего/ненужного запроса | `requestId` — ключ идемпотентности для безопасных ретраев |
| Природа | Идемпотентна по сути (GET): повтор безопасен | Изменяет состояние (POST/PUT/DELETE): повтор опасен без защиты |
| Кто перезапрашивает | `refresh()` / SWR — фоновое обновление | `retry()` — повтор упавшей мутации |

**Ресурс** получает `AbortSignal`: при смене аргументов или размонтировании toolkit отменяет ещё летящий запрос —
прокиньте сигнал в `fetch`, чтобы не тратить сеть и не ловить гонки.

**Команда** получает `requestId`: повтор мутации (через `retry()`) опасен — первый запрос мог дойти до сервера, но
ответ потеряться. `requestId` стабилен между ретраями одной кэш-записи, поэтому, отправив его как ключ
идемпотентности (например, заголовок `Idempotency-Key`), вы позволяете бэкенду распознать дубль и не выполнить
операцию дважды.


## request id

- Генерируется один раз на кэш-запись и **переиспользуется при ретраях** (`retry()` не создаёт новую запись).
- Новый `trigger` создаёт новую запись → **новый** request id (это другая логическая операция).
- По умолчанию — `crypto.randomUUID()`. Переопределяется опцией `generateRequestId` (когда ключ идемпотентности
  выводится из бизнес-данных или его выдаёт бэкенд):

```typescript
const payCommand = api.createCommand({
  generateRequestId: (args) => `pay:${args.orderId}`,   // sync или Promise<string>
  queryFn: async (args, requestId) => {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
});
```

> Request id — это не [ключ кэша][cache]. Ключ кэша адресует запись внутри toolkit (состояние, агент, retention);
> request id уходит на бэкенд и обеспечивает идемпотентность. Это разные идентификаторы с разными задачами.


## Переиспользуемый fetcher

`queryFn` стоит строить поверх одной тонкой обёртки — она инкапсулирует базовый URL, заголовки и разбор ошибок,
оставляя в каждом `queryFn` только специфику запроса:

```typescript
async function api$<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// Ресурс: пробрасываем abortSignal
const userResource = api.createResource({
  queryFn: (args: { id: number }, abortSignal) =>
    api$<User>(`/users/${args.id}`, { signal: abortSignal }),
});

// Команда: requestId → Idempotency-Key
const createUserCommand = api.createCommand({
  queryFn: (args: { name: string }, requestId) =>
    api$<User>('/users', {
      method: 'POST',
      headers: { 'Idempotency-Key': requestId },
      body: JSON.stringify(args),
    }),
});
```

Тот же `api$` переиспользуется во всех ресурсах и командах: базовый URL и обработка ошибок — в одном месте, а
особенности транспорта (отмена для чтения, идемпотентность для записи) подключаются вторым аргументом `queryFn`.


## См. также

- [Ресурс][resource] — чтение данных, `abortSignal`, SWR
- [Команда][command] — мутации, `retry()`, request id
- [Ключ кэша][cache] — адресация записей внутри toolkit (не путать с request id)
- [Машина состояний][machine] — переходы между статусами запроса

[resource]: ./resource.md
[command]: ./command.md
[cache]: ../concepts/cache.md
[machine]: ../concepts/machine.md
