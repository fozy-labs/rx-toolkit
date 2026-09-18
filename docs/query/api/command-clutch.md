# Сцепление команды (CommandClutch) — API

Сцепление команды — реактивный наблюдатель, транслирующий состояние [записи кэша][cache] команды в плоский сигнал. В отличие от [сцепления ресурса][resource-clutch], сцепление команды не поддерживает SKIP и SWR-fallback — мутации запускаются явно через `trigger`. Концепция и жизненный цикл описаны в [concepts/clutch.md][clutch-concept].


## Создание

```typescript
const clutch = addTodoCommand.createClutch('my-mutation-1');
```

Метод `createClutch()` доступен у каждой [команды][api-cmd]. Принимает необязательный строковый ключ записи — идентификатор кэш-записи, за которой сцепление будет наблюдать. Без ключа каждый `trigger` генерирует новый ключ, и сцепление переключается на запись **последнего** вызова; постоянная привязка возможна только через `createClutch(entryKey)` или `setEntryKey`.


## Методы

| Метод | Сигнатура | Описание |
|-------|-----------|----------|
| `state$` | `ReadonlySignal<TCommandClutchState<TArgs, TData, TError>>` | Сигнал состояния сцепления. |
| `trigger` | `(args: TArgsOrKeyed<TArgs>, entryKey?: string) => TTriggerPromise<TData, TError>` | Запускает мутацию и начинает наблюдать за созданной кэш-записью. Ключ берётся из `TKeyed`-аргументов (если args обёрнуты), затем из параметра `entryKey`, затем из привязанного ключа сцепления, иначе генерируется. Возвращает [конверт результата](#результат-trigger). |
| `setEntryKey` | `(entryKey: string) => void` | Привязывает сцепление к кэш-записи по ключу (используется и для наблюдения, и последующими `trigger`). |
| `retry` | `() => void` | Перезапускает отслеживаемую мутацию. No-op вне состояния `error`. Повтор переиспользует тот же [request id][query-fn]. |


## Результат trigger

`trigger` возвращает `TTriggerPromise<TData, TError>` — промис, который **никогда не реджектится**. Итог мутации приходит конвертом `TTriggerResult<TData, TError>`, дискриминированным по полю `status` (`TError` типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror), по умолчанию `unknown`):

```typescript
type TTriggerResult<TData, TError = unknown> =
  | { status: "success"; data: TData; error?: undefined }
  | { status: "error"; data?: undefined; error: TError };
```

```typescript
const result = await clutch.trigger({ text: 'Задача' });
if (result.status === 'error') {
  console.error(result.error);
} else {
  console.log(result.data);
}
```

Когда нужна «бросающая» семантика (сырые данные при успехе, исключение при ошибке — как у `Command.execute`), используйте `unwrap()`:

```typescript
const data = await clutch.trigger({ text: 'Задача' }).unwrap();
```

Тот же контракт — у `trigger` из хука `useCommand`.


## Состояние (TCommandClutchState)

`TCommandClutchState` — **дискриминированное объединение** по `status` и `hasError`: каждый вариант несёт литеральные значения флагов и точные типы `data` / `error`. Сужение работает по любому из них:

```typescript
const state = clutch.state$();

if (state.hasError) {
  state.error; // TError — без `| null`
}
if (state.hasData) {
  state.data;  // TData — без `| null`
}
```

У сцепления команды нет ни данных предыдущих args, ни смены args, ни плейсхолдера: повторный `trigger()` с тем же ключом записи создаёт **новую** запись, поэтому `data` и `error` прошлого запуска в `pending` не переносятся.

| Поле | Тип                                           | Описание |
|------|-----------------------------------------------|----------|
| `status` | `"idle" \| "pending" \| "success" \| "error"` | Текущий статус сцепления. |
| `data` | `TData \| null`                               | Данные результата мутации. `null` до завершения. |
| `error` | `TError \| null`                              | Ошибка мутации; живёт до следующего settle, поэтому переживает повтор. По умолчанию `unknown`; типизируется опцией API [`mapError`](./README.md#типизация-ошибок-maperror). |
| `args` | `TArgs \| null`                               | Аргументы последнего вызова `trigger`. `null` только в `idle`. |
| `isPending` | `boolean`                                | `true`, пока мутация выполняется. |
| `hasData` | `boolean`                                  | `true` ⇔ `status === "success"`. |
| `hasError` | `boolean`                                 | `true` ⇔ `error !== null`. |
| `retry` | `() => void`                                   | Перезапускает упавшую мутацию (тот же request id). No-op вне состояния `error`. |


## Варианты состояния

Типы вариантов экспортируются: `TCommandClutchIdleState`, `TCommandClutchPendingState`, `TCommandClutchSuccessState`, `TCommandClutchErrorState`.

| #  | Случай                                        | status  | `data` | `error` | isPending | hasData | hasError |
|----|-----------------------------------------------|---------|:------:|:-------:|:---------:|:-------:|:--------:|
| К1 | мутация не запускалась, запись не привязана   | idle    | `null` | `null`  | ✗         | ✗       | ✗        |
| К2 | выполняется (первый или повторный `trigger`)  | pending | `null` | `null`  | ✓         | ✗       | ✗        |
| К3 | успех                                         | success | `TData` | `null` | ✗         | ✓       | ✗        |
| К4 | ошибка                                        | error   | `null` | `TError` | ✗        | ✗       | ✓        |
| К5 | повтор из К4 (`retry()`)                      | pending | `null` | `TError` | ✓        | ✗       | ✓        |

`pending` никогда не несёт данных: `data` типизирован строго `null`. Статусы `invalidating` / `invalidate-error` для команды недостижимы — `invalidate()` на записи команды выводит `console.warn` и ничего не делает.


## См. также

- [Концепция сцепления][clutch-concept] — жизненный цикл, SWR-fallback (только ресурсы)
- [Сцепление ресурса — API][resource-clutch] — аналог для операций чтения
- [Команда — API][api-cmd] — создание команды и метод `createClutch()`
- [Использование команд][usage-cmd] — хук `useCommand`, примеры, паттерны


[clutch-concept]: ../concepts/clutch.md
[resource-clutch]: ./resource-clutch.md
[api-cmd]: ./command.md
[usage-cmd]: ../usage/command.md
[query-fn]: ../usage/query-fn.md
[cache]: ../concepts/cache.md
