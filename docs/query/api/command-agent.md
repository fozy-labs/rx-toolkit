# Агент команды (CommandAgent) — API

Агент команды — реактивный наблюдатель, транслирующий состояние [записи кэша][cache] команды в плоский сигнал. В отличие от [агента ресурса][resource-agent], агент команды не поддерживает SKIP и SWR-fallback — мутации запускаются явно через `trigger`. Концепция и жизненный цикл описаны в [concepts/agent.md][agent-concept].


## Создание

```typescript
const agent = addTodoCommand.createAgent('my-mutation-1');
```

Метод `createAgent()` доступен у каждой [команды][api-cmd]. Принимает необязательный строковый ключ — идентификатор кэш-записи, за которой агент будет наблюдать. Без ключа каждый `trigger` генерирует новый ключ, и агент переключается на запись **последнего** вызова; постоянная привязка возможна только через `createAgent(key)` или `setKey`.


## Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `state$` | `ReadonlySignal<TCommandAgentState<TArgs, TData, TError>>` | Сигнал состояния агента. |
| `trigger` | `(args: Args<TArgs>, key?: string) => TTriggerPromise<TData, TError>` | Запускает мутацию и начинает наблюдать за созданной кэш-записью. Ключ берётся из `Keyed`-аргументов (если args обёрнуты), затем из параметра `key`, затем из привязанного ключа агента, иначе генерируется. Возвращает [конверт результата](#результат-trigger). |
| `setKey` | `(key: string) => void` | Привязывает агент к кэш-записи по ключу (используется и для наблюдения, и последующими `trigger`). |
| `retry` | `() => void` | Перезапускает отслеживаемую мутацию. No-op вне состояния `error`. Повтор переиспользует тот же [request id][query-fn]. |


## Результат trigger

`trigger` возвращает `TTriggerPromise<TData, TError>` — промис, который **никогда не реджектится**. Итог мутации приходит конвертом `TTriggerResult<TData, TError>`, дискриминированным по полю `status` (`TError` типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror), по умолчанию `unknown`):

```typescript
type TTriggerResult<TData, TError = unknown> =
  | { status: "success"; data: TData; error?: undefined }
  | { status: "error"; data?: undefined; error: TError };
```

```typescript
const result = await agent.trigger({ text: 'Задача' });
if (result.status === 'error') {
  console.error(result.error);
} else {
  console.log(result.data);
}
```

Когда нужна «бросающая» семантика (сырые данные при успехе, исключение при ошибке — как у `Command.trigger`), используйте `unwrap()`:

```typescript
const data = await agent.trigger({ text: 'Задача' }).unwrap();
```


## Состояние (TCommandAgentState)

`TCommandAgentState` — **дискриминированное объединение** по `status`: каждый статус — отдельный вариант с литеральными булевыми флагами и точными типами `data` / `error`. Проверка `status`, `isSuccess`, `isError` сужает тип:

```typescript
const state = agent.state$();

if (state.isError) {
  state.error; // TError — без `| null`
  state.data;  // null
}
if (state.isSuccess) {
  state.data;  // TData — без `| null`
}
```

Поля (широкие типы на несуженном объединении):

| Поле | Тип                                           | Описание |
|------|-----------------------------------------------|----------|
| `status` | `"idle" \| "pending" \| "success" \| "error"` | Текущий статус агента. |
| `data` | `TData \| null`                               | Данные результата мутации. `null` до завершения. |
| `error` | `TError \| null`                              | Ошибка мутации. По умолчанию `unknown`; типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror). |
| `args` | `TArgs \| null`                               | Аргументы последнего вызова `trigger`. `null` только в `idle`. |
| `isLoading` | `boolean`                                     | `true`, пока мутация выполняется (`pending`). |
| `isSuccess` | `boolean`                                     | `true`, если мутация завершилась успешно. |
| `isError` | `boolean`                                     | `true`, если мутация завершилась ошибкой. |
| `retry` | `() => void`                                   | Перезапускает упавшую мутацию (тот же request id). No-op вне состояния `error`. |


## Варианты состояния

Типы вариантов экспортируются: `TCommandAgentIdleState`, `TCommandAgentPendingState`, `TCommandAgentSuccessState`, `TCommandAgentErrorState`.

| Статус | `data` | `error` | `isLoading` | `isSuccess` | `isError` | Описание |
|--------|:------:|:-------:|:-----------:|:-----------:|:---------:|----------|
| `idle` | `null` | `null` | — | — | — | Мутация не запускалась или ключ не привязан. |
| `pending` | `TData \| null`¹ | `TError \| null`¹ | ✓ | — | — | Мутация выполняется. |
| `success` | `TData` | `null` | — | ✓ | — | Мутация завершилась успешно, данные доступны в `data`. |
| `error` | `null` | `TError` | — | — | ✓ | Мутация завершилась ошибкой. |

¹ Обычно `null`; несут устаревшие значения только при защитном ремаппинге вручную обновлённой (`refresh`) кэш-записи команды в `pending`.


## См. также

- [Концепция агента][agent-concept] — жизненный цикл, SWR-fallback (только ресурсы)
- [Агент ресурса — API][resource-agent] — аналог для операций чтения
- [Команда — API][api-cmd] — создание команды и метод `createAgent()`
- [Использование команд][usage-cmd] — хук `useCommand`, примеры, паттерны


[agent-concept]: ../concepts/agent.md
[resource-agent]: ./resource-agent.md
[api-cmd]: ./command.md
[usage-cmd]: ../usage/command.md
[query-fn]: ../usage/query-fn.md
[cache]: ../concepts/cache.md
