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
| `resourceRetentionTime` | `number` \| `false`       | `60_000 ms`       | Время удержания кеша ресурсов. `false` — не удалять.                                            |
| `commandRetentionTime`  | `number` \| `false`       | `0`               | Время удержания кеша команд. `false` — не удалять.                                              |
| `initialSnapshot`    | `TApiSnapshot` \| `null`  | `null`            | Начальный [снимок] состояния всех ресурсов (для SSR или гидрации).                                                              |
| `snapshotValidTime`  | `number` \| `false`       | `false`           | Время валидности данных в снимке. `false` - данные в [снимке][снимок] считаются всегда валидными.                               |
| `syncDriver`         | `ISyncDriver`             | `undefined`       | Драйвер для [синхронизации][синхронизация] состояния между несколькими экземплярами API (например, в разных вкладках браузера). |
| `onCacheEntryAdded`  | `(args, ctx) => void`     | —                 | Хук жизненного цикла уровня API — вызывается при создании любой кеш-записи. См. [lifecycle hooks][lifecycle].                  |
| `onQueryStarted`     | `(args, ctx) => void \| Promise<void>` | — | Хук жизненного цикла уровня API — вызывается при каждом запуске `queryFn`. См. [lifecycle hooks][lifecycle].                    |

## Методы API

| Метод            | Опции                                      | Возвращаемое значение                  | Описание                                                        |
|------------------|--------------------------------------------|-----------------------------------------|-----------------------------------------------------------------|
| `createResource` | `options: TResourceOptions<TArgs, TData>`  | `IApiResource<TPlugins, TArgs, TData>`  | Создаёт новый [ресурс].                                        |
| `createCommand`  | `options: TCommandOptions<TArgs, TData>`   | `IApiCommand<TPlugins, TArgs, TData>`   | Создаёт новую [команду][команда].                               |
| `getSnapshot()`  | -                                          | `TApiSnapshot`                          | Получает текущий [снимок] состояния всех [ресурсов][ресурс].    |
| `resetAll()`     | -                                          | `void`                                  | Сбрасывает все ресурсы и очищает сохранённый снимок.            |


[снимок]: ../usage/snapshot.md
[синхронизация]: ../usage/broadcast.md
[lifecycle]: ../usage/lifecycle.md
[ресурс]: ../usage/resource.md
[команда]: ../usage/command.md
