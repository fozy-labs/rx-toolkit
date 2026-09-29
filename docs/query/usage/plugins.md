# Плагины

Плагины расширяют возможности API, добавляя методы к [ресурсам][resource], [командам][command] и к самому `api`. Например, встроенный плагин `reactHooksPlugin()` добавляет React-хуки прямо на экземпляры ресурсов.

Плагины передаются при создании API через опцию `plugins`:

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({
  plugins: [reactHooksPlugin()],
});
```


## reactHooksPlugin()

Встроенный плагин для интеграции с React. Добавляет хук `useResource` на каждый ресурс, созданный через API:

```tsx
const usersResource = api.createResource({
  queryFn: (args: { page: number }, signal) =>
    fetch(`/api/users?page=${args.page}`, { signal }).then(r => r.json()),
});

// Хук доступен благодаря плагину:
const { data, isPending } = usersResource.useResource({ page: 1 });
```

Подробнее о поведении хука — см. раздел «React: useResource» в документации [ресурса][resource].


## Написание собственного плагина

Плагин реализует интерфейс `IPlugin`:

```typescript
interface IPlugin {
  readonly name: string;
  install(context: IPluginContext): void;
  augmentResource?<TArgs, TData>(
    resource: IResource<TArgs, TData>,
    options: TResourceOptions<TArgs, TData>,
  ): Record<string, unknown>;
  augmentCommand?<TArgs, TData>(
    command: ICommand<TArgs, TData>,
    options: TCommandOptions<TArgs, TData>,
  ): Record<string, unknown>;
  augmentProjectionResource?<TArgs, TId, TItem, TResArgs, TResData>(
    resource: IResource<TArgs, TItem[]>,
    options: TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData>,
  ): Record<string, unknown>;
  augmentApi?(api: IApi): Record<string, unknown>;
}
```

- `name` — уникальное строковое имя плагина.
- `install(context)` — вызывается один раз при `createApi()`. Получает `IPluginContext` с метаинформацией об API.
- `augmentResource(resource, options)` — вызывается при каждом `createResource()`. Возвращает объект с методами, которые будут добавлены к ресурсу.
- `augmentCommand(command, options)` — аналогично, вызывается при каждом `createCommand()`. Возвращает объект с методами для команды.
- `augmentProjectionResource(resource, options)` — **дополнительная** аугментация только для [проекционных ресурсов](./projection-resource.md), поверх обычного прохода `augmentResource` (проекционный ресурс проходит и его). Так `reactHooksPlugin()` добавляет `useInfiniteResource` только проекциям.
- `augmentApi(api)` — вызывается один раз при `createApi()`, после `install` всех плагинов, в порядке `plugins`. Возвращает члены, которые добавляются к самому `api`; `api` уже содержит члены предыдущих плагинов. Плагин не перезаписывает члены `api`: имя, которое у `api` уже есть — собственное (`createResource`, `resetAll` и т. д.) или добавленное предыдущим плагином, — бросает ошибку в `createApi()` с именами плагина и члена.

```typescript
const loggingPlugin: IPlugin = {
  name: 'LoggingPlugin',
  install() {},
  augmentResource(resource) {
    return {
      logState(args: unknown) {
        // Упрощённый пример — getEntry$ принимает аргументы для идентификации кэш-записи
        console.log(resource.getEntry(args));
      },
    };
  },
};
```


## Типизация вкладов плагина

Форма добавляемых методов описывается HKT-протоколом: плагин объявляет интерфейс, расширяющий `IPluginHKT`, и «прикрепляет» его фантомным полем `_hkt` (существует только на уровне типов):

```typescript
import type { IPlugin, IPluginHKT } from '@fozy-labs/rx-toolkit';

// `this` доступен только прямо в члене интерфейса, не во вложенном литерале
// типа, поэтому форма вклада — отдельный generic-тип.
type LoggingResourceShape<TArgs> = { logState: (args: TArgs) => void };

interface LoggingPluginHKT extends IPluginHKT {
  // this['_TArgs'] / this['_TData'] / this['_TError'] подставляются
  // конкретными типами в точке применения (createResource и т.д.)
  readonly resourceType: LoggingResourceShape<this['_TArgs']>;
  // опциональные слоты: commandType, projectionResourceType, apiType
}

class LoggingPlugin implements IPlugin {
  readonly name = 'LoggingPlugin';
  declare readonly _hkt: LoggingPluginHKT;
  install() {}
  augmentResource(resource) { /* ...реализация logState... */ }
}
```

`createResource()` / `createCommand()` / `unstable_createProjectionResource()` собирают вклады всех плагинов из кортежа `plugins` (типы `TCombinePlugin*Augments`) и пересекают их с базовым типом. Благодаря этому `usersResource.useResource(...)` корректно типизирован, когда в `plugins` передан `reactHooksPlugin()`. Слот `projectionResourceType` описывает вклад `augmentProjectionResource` и применяется только к проекционным ресурсам.

Слот `apiType` описывает вклад `augmentApi`: `createApi()` пересекает базовый тип `api` с `apiType` всех плагинов (тип `TCombinePluginApiAugments`). В нём подставляется только `this['_TError']` — тип ошибки `api` из `mapError`; `_TArgs` и `_TData` остаются `unknown`. Без плагинов со слотом `apiType` тип `api` не меняется.

```typescript
type TasksApiShape<TError> = { defineTask: (name: string) => { onError: (error: TError) => void } };

interface TasksPluginHKT extends IPluginHKT {
  readonly apiType: TasksApiShape<this['_TError']>;
}

class TasksPlugin implements IPlugin {
  readonly name = 'TasksPlugin';
  declare readonly _hkt: TasksPluginHKT;
  install() {}
  augmentApi() {
    return { defineTask: (name: string) => ({ onError: (error: unknown) => console.error(name, error) }) };
  }
}

const api = createApi({ plugins: [new TasksPlugin()], mapError: (e) => ({ message: String(e) }) });
api.defineTask('sync'); // onError: (error: { message: string }) => void
```


## См. также

- [Ресурс][resource] — основной примитив запросов, который расширяется плагинами.
- [Команда][command] — примитив мутаций, также расширяемый через плагины.


[resource]: ./resource.md
[command]: ./command.md
