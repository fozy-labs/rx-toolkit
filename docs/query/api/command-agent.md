# Агент команды (CommandAgent) — API

Агент команды — реактивный наблюдатель, транслирующий состояние [записи кэша][cache] команды в плоский сигнал. В отличие от [агента ресурса][resource-agent], агент команды не поддерживает SKIP и SWR-fallback — мутации запускаются явно через `trigger`. Концепция и жизненный цикл описаны в [concepts/agent.md][agent-concept].


## Создание

```typescript
const agent = addTodoCommand.createAgent({ key: 'my-mutation-1' });
```

Метод `createAgent()` доступен у каждой [команды][api-cmd]. Принимает опциональный объект с полем `key` — строковый идентификатор кэш-записи, за которой агент будет наблюдать.


## Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `state$` | `() => TCommandAgentState<TArgs, TData>` | Вычисляемый сигнал. Возвращает текущее состояние агента. |
| `trigger` | `(args: TArgs, key?: string) => Promise<TData>` | Запускает мутацию и начинает наблюдать за созданной кэш-записью. Ключ берётся из аргумента, затем из привязанного ключа агента, иначе генерируется. Возвращает [нативный промис результата](#результат-trigger). |
| `setKey` | `(key: string) => void` | Привязывает агент к кэш-записи по ключу (используется и для наблюдения, и последующими `trigger`). |
| `retry` | `() => void` | Перезапускает отслеживаемую мутацию. No-op вне состояния `error`. Повтор переиспользует тот же [request id][query-fn]. |


## Результат trigger

`trigger` возвращает **нативный** `Promise<TData>`: при успехе резолвится данными мутации, при ошибке реджектится нормализованной через [`mapError`](./README.md#типизация-ошибок-maperror) ошибкой (`TError`, по умолчанию `unknown`).

Реджект заранее обработан внутри агента: на возвращаемый промис навешан внутренний no-op catch, поэтому fire-and-forget вызов не порождает unhandled rejection — ошибка при этом всё равно отражается в `state$`:

```typescript
// Fire-and-forget: результат не нужен, ошибка придёт через state$.
void agent.trigger({ text: 'Задача' });
```

Ожидающий вызов видит реджект как обычно:

```typescript
try {
  const data = await agent.trigger({ text: 'Задача' });
  console.log(data);
} catch (error) {
  console.error(error); // TError после mapError
}
```

Тот же контракт — у `trigger` из хука `useCommand`.


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
