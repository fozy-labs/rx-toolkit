# DevTools

Интеграция с инструментами разработчика позволяет отслеживать состояние [ресурсов][resource] и [команд][command] в реальном времени.


## Опция key

Опция `key` задаёт человекочитаемое имя ресурса или команды. Это имя отображается в DevTools и используется для [снимков][snapshot]:

```typescript
const usersResource = api.createResource({
  key: 'users',
  queryFn: fetchUsers,
});

const deleteUserCommand = api.createCommand({
  key: 'deleteUser',
  queryFn: deleteUser,
});
```

Если у API задан `keyPrefix`, итоговый ключ будет `keyPrefix/key`. Дублирование ключей внутри одного API запрещено — будет выброшена ошибка.


## Redux DevTools

Встроенный адаптер `reduxDevtools()` транслирует изменения состояния в расширение [Redux DevTools][redux-devtools-ext]:

```typescript
import { DefaultOptions, reduxDevtools } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({
  DEVTOOLS: reduxDevtools(),
});
```

Подключайте DevTools только в dev-режиме:

```typescript
if (import.meta.env.DEV) {
  DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}
```


## Конфигурация

Полная документация по настройке DevTools — глобальный уровень (`DefaultOptions`), опции `reduxDevtools()` (стратегия батчинга, имя приложения и пр.) — в [руководстве DevTools][devtools-readme].

### devtoolsKey

Опция `devtoolsKey` на уровне ресурса/команды позволяет кастомизировать ключ аргументов, отображаемый в DevTools:

```typescript
const usersResource = api.createResource({
  key: 'users',
  queryFn: fetchUsers,
  devtoolsKey: (args) => String(args.id),
});
```


[resource]: ./resource.md
[command]: ./command.md
[snapshot]: ./snapshot.md
[devtools-readme]: ../../devtools/README.md
[redux-devtools-ext]: https://github.com/reduxjs/redux-devtools
