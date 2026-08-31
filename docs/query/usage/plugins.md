# Плагины

Плагины расширяют возможности API, добавляя методы к [ресурсам][resource] и [командам][command]. Например, встроенный плагин `reactHooksPlugin()` добавляет React-хуки прямо на экземпляры ресурсов.

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
const { data, isLoading } = usersResource.useResource({ page: 1 });
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
  augmentBatchResource?<TArgs, TId, TItem, TResArgs, TResData>(
    resource: IResource<TArgs, TItem[]>,
    options: TBatchResourceOptions<TArgs, TId, TItem, TResArgs, TResData>,
  ): Record<string, unknown>;
}
```

- `name` — уникальное строковое имя плагина.
- `install(context)` — вызывается один раз при `createApi()`. Получает `IPluginContext` с метаинформацией об API.
- `augmentResource(resource, options)` — вызывается при каждом `createResource()`. Возвращает объект с методами, которые будут добавлены к ресурсу.
- `augmentCommand(command, options)` — аналогично, вызывается при каждом `createCommand()`. Возвращает объект с методами для команды.
- `augmentBatchResource(resource, options)` — **дополнительная** аугментация только для [batch-ресурсов](./batch-resource.md), поверх обычного прохода `augmentResource` (batch-ресурс проходит и его). Так `reactHooksPlugin()` добавляет `useInfiniteResource` только батчам.

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

Форма добавляемых методов описывается HKT-протоколом: плагин объявляет интерфейс, расширяющий `PluginHKT`, и «прикрепляет» его фантомным полем `_hkt` (существует только на уровне типов):

```typescript
import type { IPlugin, PluginHKT } from '@fozy-labs/rx-toolkit';

interface LoggingPluginHKT extends PluginHKT {
  // this['_TArgs'] / this['_TData'] / this['_TError'] подставляются
  // конкретными типами в точке применения (createResource и т.д.)
  readonly resourceType: { logState: (args: this['_TArgs']) => void };
  // опциональные слоты: commandType, batchResourceType
}

class LoggingPlugin implements IPlugin {
  readonly name = 'LoggingPlugin';
  declare readonly _hkt: LoggingPluginHKT;
  install() {}
  augmentResource(resource) { /* ...реализация logState... */ }
}
```

`createResource()` / `createCommand()` / `createBatchResource()` собирают вклады всех плагинов из кортежа `plugins` (типы `CombinePlugin*Augments`) и пересекают их с базовым типом. Благодаря этому `usersResource.useResource(...)` корректно типизирован, когда в `plugins` передан `reactHooksPlugin()`. Слот `batchResourceType` описывает вклад `augmentBatchResource` и применяется только к batch-ресурсам.


## См. также

- [Ресурс][resource] — основной примитив запросов, который расширяется плагинами.
- [Команда][command] — примитив мутаций, также расширяемый через плагины.


[resource]: ./resource.md
[command]: ./command.md
