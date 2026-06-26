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
| `trigger` | `(args: TArgs, key?: string) => Promise<TData>` | Запускает мутацию и начинает наблюдать за созданной кэш-записью. Ключ берётся из аргумента, затем из привязанного ключа агента, иначе генерируется. Возвращает промис с результатом. |
| `setKey` | `(key: string) => void` | Привязывает агент к кэш-записи по ключу (используется и для наблюдения, и последующими `trigger`). |
| `retry` | `() => void` | Перезапускает отслеживаемую мутацию. No-op вне состояния `error`. Повтор переиспользует тот же [request id][query-fn]. |


## Состояние (TCommandAgentState)

| Поле | Тип                                           | Описание |
|------|-----------------------------------------------|----------|
| `status` | `"idle" \| "pending" \| "success" \| "error"` | Текущий статус агента. |
| `data` | `TData \| null`                               | Данные результата мутации. `null` до завершения. |
| `error` | `unknown`                                     | Ошибка мутации. `null` в `idle` / `pending` / `success`. |
| `args` | `TArgs \| null`                               | Аргументы последнего вызова `trigger`. `null` в `idle`. |
| `isLoading` | `boolean`                                     | `true`, пока мутация выполняется (`pending`). |
| `isSuccess` | `boolean`                                     | `true`, если мутация завершилась успешно. |
| `isError` | `boolean`                                     | `true`, если мутация завершилась ошибкой. |
| `retry` | `() => void`                                   | Перезапускает упавшую мутацию (тот же request id). No-op вне состояния `error`. |
| `entry` | `QueryCacheEntry<TArgs, TData> \| null`      | Текущая запись кэша. `null` в `idle`. |


## Статусы

| Статус | `isLoading` | `isSuccess` | `isError` | Описание |
|--------|:-----------:|:-----------:|:---------:|----------|
| `idle` | — | — | — | Мутация не запускалась или ключ не привязан. |
| `pending` | ✓ | — | — | Мутация выполняется. |
| `success` | — | ✓ | — | Мутация завершилась успешно, данные доступны в `data`. |
| `error` | — | — | ✓ | Мутация завершилась ошибкой. |


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
