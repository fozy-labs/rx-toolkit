# RxQuery API

API — центральный объект, управляющий ресурсами и командами.


## Создание API

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
    keyPrefix: 'my-app', // (опционально) префикс для всех ключей ресурсов
    plugins: [
        reactHooksPlugin(), // (опционально) подключаем React Hooks плагин для удобного использования в React-приложениях
    ],
});
```


## Опции API

| Опция                | Тип                       | По умолчанию      | Описание                                                                                                                        |
|----------------------|---------------------------|-------------------|---------------------------------------------------------------------------------------------------------------------------------|
| `keyPrefix`          | `string` \| `null`        | `undefined`       | Префикс, который добавляется ко всем ключам ресурсов и команд, создаваемых через этот API.                                      |
| `plugins`            | `IPlugin[]`               | `[]`              | Массив плагинов, которые будут использоваться этим API.                                                                         |
| `serializeArgs`      | `(args: TArgs) => string` | `stableStringify` | Функция сериализации аргументов в строку.                                                                                       |
| `resourceRetentionTime` | `number` \| `false`       | `60_000 ms`       | Время удержания кэша ресурсов. `false` — не удалять.                                            |
| `commandRetentionTime`  | `number` \| `false`       | `0`               | Время удержания кэша команд. `false` — не удалять.                                              |
| `initialSnapshot`    | `TApiSnapshot` \| `null`  | `null`            | Начальный [снимок] состояния всех ресурсов (для SSR или гидрации).                                                              |
| `snapshotValidTime`  | `number` \| `false`       | `false`           | Время валидности данных в снимке. `false` - данные в [снимке][снимок] считаются всегда валидными.                               |
| `defaultSync`        | `'none'` \| `'resources'` \| `'all'` | `'none'`          | Режим синхронизации по умолчанию для ресурсов. `'none'` — выключена, `'resources'` / `'all'` — включена. Команды не поддерживают синхронизацию. |
| `syncDriver`         | `ISyncDriver`             | `undefined`       | Драйвер для [синхронизации][синхронизация] состояния между несколькими экземплярами API (например, в разных вкладках браузера). |
| `onCacheEntryAdded`  | `(args, ctx) => void`     | —                 | Хук жизненного цикла уровня API — вызывается при создании любой кэш-записи. См. [lifecycle hooks][lifecycle].                  |
| `onQueryStarted`     | `(args, ctx) => void \| Promise<void>` | — | Хук жизненного цикла уровня API — вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][lifecycle].                    |
| `mapError`           | `(error: unknown, ctx: TErrorContext) => TError` | `identity` | Нормализует любую сырую ошибку запроса/мутации в типизированную. Тип возвращаемого значения становится `TError` — типом поля `error` во всех состояниях ресурсов и команд. См. [Типизация ошибок](#типизация-ошибок-maperror). |

## Методы API

| Метод            | Опции                                      | Возвращаемое значение                  | Описание                                                        |
|------------------|--------------------------------------------|-----------------------------------------|-----------------------------------------------------------------|
| `createResource` | `options: TResourceOptions<TArgs, TData>`  | `IApiResource<TPlugins, TArgs, TData>`  | Создаёт новый [ресурс].                                        |
| `createCommand`  | `options: TCommandOptions<TArgs, TData>`   | `IApiCommand<TPlugins, TArgs, TData>`   | Создаёт новую [команду][команда].                               |
| `getSnapshot()`  | -                                          | `TApiSnapshot`                          | Получает текущий [снимок] состояния всех [ресурсов][ресурс].    |
| `resetAll()`     | -                                          | `void`                                  | Сбрасывает все ресурсы и очищает сохранённый снимок.            |


## Типизация ошибок (`mapError`)

По умолчанию поле `error` в состояниях ресурсов и команд имеет тип `unknown` — так же, как ловится любая ошибка в JS. Опция `mapError` уровня API позволяет привести любую сырую ошибку к единому типизированному виду. Функция вызывается **ровно один раз** на каждый провал — в тот момент, когда ошибка входит в машину состояний, — поэтому один и тот же нормализованный экземпляр видят все потребители: состояние агента/хука, реджект `ensure()` / `fetch()`, бросок в Error Boundary у Suspense-хука и конверт `TTriggerResult` у мутаций. Тип, который возвращает `mapError`, автоматически выводится в `TError`.

```typescript
import { createApi } from '@fozy-labs/rx-toolkit';
import { NetError } from 'foundation/net';

class NetUnknownError extends Error {
    constructor(readonly original: unknown) {
        super('net unknown');
    }
}

const api = createApi({
    mapError: (error) => (NetError.is(error) ? error : new NetUnknownError(error)),
    // Итоговый TError: NetError | NetUnknownError
});

const user = api.createResource({ queryFn: fetchUser });

// error типизирован как NetError | NetUnknownError | null
const { error } = user.useResource(userId);
if (error && NetError.is(error)) {
    // error сужен до NetError
}
```

### Контекст (`TErrorContext`)

Вторым аргументом `mapError` получает провенанс ошибки — метаданные, а не обёртку:

| Поле        | Тип                        | Описание                                                         |
|-------------|----------------------------|-----------------------------------------------------------------|
| `source`    | `'query'` \| `'command'`   | Что породило ошибку — запрос ресурса или мутация команды.        |
| `args`      | `unknown`                  | Аргументы, с которыми выполнялась упавшая операция.              |
| `entryKey`  | `string`                   | Сериализованный ключ кэш-записи.                                 |
| `key`       | `string` \| `undefined`    | Ключ ресурса/команды, если он задан.                            |

### Гарантии

- **Идентичность по умолчанию.** Без `mapError` поведение не меняется, `TError` остаётся `unknown` — полная обратная совместимость.
- **Один вызов, один экземпляр.** Маппинг происходит на границе `machine.fail()`; downstream все видят один и тот же экземпляр.
- **Прерванные запросы не мапятся.** Отменённый ран — это управление потоком, а не провал запроса; он не доходит до машины и не попадает в `mapError`.
- **Бросок в `mapError` не ломает машину.** Если сам `mapError` бросит — падение логируется в `console.error`, а в состояние идёт исходная (сырая) ошибка.
- **Дискриминированные состояния.** Состояния ресурсов и команд — дискриминированные объединения: `state.isError` сужает `error` до `TError` (без `| null`), `state.isSuccess` — `data` до `TData`. См. [агент ресурса](./resource-agent.md#состояние-tresourceagentstate) и [агент команды](./command-agent.md#состояние-tcommandagentstate).
- **Низкоуровневый `$queryFulfilled`** (контекст `onQueryStarted`) реджектится **сырой** ошибкой — он отражает необработанный исход запроса; нормализованная ошибка появляется на состоянии и в конверте мутации.


## См. также

- [Ресурс](../usage/resource.md)
- [Команда](../usage/command.md)
- [Снимок (SSR / гидрация)](../usage/snapshot.md)
- [Синхронизация между вкладками](../usage/broadcast.md)
- [Lifecycle hooks](../usage/lifecycle.md)


[снимок]: ../usage/snapshot.md
[синхронизация]: ../usage/broadcast.md
[lifecycle]: ../usage/lifecycle.md
[ресурс]: ../usage/resource.md
[команда]: ../usage/command.md
