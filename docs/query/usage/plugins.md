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
}
```

- `name` — уникальное строковое имя плагина.
- `install(context)` — вызывается один раз при `createApi()`. Получает `IPluginContext` с метаинформацией об API.
- `augmentResource(resource, options)` — вызывается при каждом `createResource()`. Возвращает объект с методами, которые будут добавлены к ресурсу.
- `augmentCommand(command, options)` — аналогично, вызывается при каждом `createCommand()`. Возвращает объект с методами для команды.

```typescript
const loggingPlugin: IPlugin = {
  name: 'LoggingPlugin',
  install() {},
  augmentResource(resource) {
    return {
      logState(args: unknown) {
        // Упрощённый пример — getEntry$ принимает аргументы для идентификации кеш-записи
        console.log(resource.getEntry(args));
      },
    };
  },
};
```


## Типизация вкладов плагина

Чтобы TypeScript знал о методах, добавленных плагином, используется паттерн условных типов через `PluginResourceContributions`:

```typescript
type PluginResourceContributions<TPlugin, TArgs, TData> =
  TPlugin extends { name: 'ReactHooksPlugin' }
    ? IReactHooksPluginContributions<TArgs, TData>
    : Record<string, never>;
```

Тип `PluginAugmentations` объединяет вклады всех плагинов в массиве и добавляет их к возвращаемому типу `createResource()`. Благодаря этому `usersResource.useResource(...)` корректно типизирован, когда в `plugins` передан `reactHooksPlugin()`.

Для собственного плагина добавьте новую ветку в `PluginResourceContributions`, аналогичную ветке `ReactHooksPlugin`.


[resource]: ./resource.md
[command]: ./command.md
