# Модуль Query

Модуль Query — декларативное управление серверными данными: кеширование, инвалидация, оптимистичные обновления и SSR. Построен на RxJS и [сигналах][signals], не зависит от UI-фреймворка — React-интеграция подключается плагином. Два базовых примитива: [ресурс][resource] (чтение данных с кешем по аргументам) и [команда][command] (мутация / побочное действие).


## Быстрый старт

```typescript
import { createApi, reactHooksPlugin } from '@fozy-labs/rx-toolkit';

const api = createApi({ plugins: [reactHooksPlugin()] });

const usersResource = api.createResource({
  queryFn: async (args: { page: number }, signal) => {
    const res = await fetch(`/api/users?page=${args.page}`, { signal });
    return res.json();
  },
});

// React-компонент
function UsersList({ page }: { page: number }) {
  const { data, error, isLoading } = usersResource.useResource({ page });
  if (isLoading) return <Spinner />;
  return <ul>{data.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```


## Возможности

- **Кеширование** — автоматическое по аргументам, с настраиваемым временем жизни
- **Stale-While-Revalidate** — показ устаревших данных во время фонового обновления
- **Оптимистичные обновления** — Immer-патчи с автоматическим ребейсом при ответе сервера
- **SSR / гидрация** — снимки кеша для серверного рендеринга
- **Кросс-табовая синхронизация** — BroadcastChannel для актуальности данных между вкладками
- **Система плагинов** — расширение ресурсов и команд через `createApi({ plugins: [...] })`


## Что читать дальше

| Цель | Рекомендуемый порядок |
|------|-----------------------|
| **Быстрый старт** | [usage/resource.md][resource] → [usage/command.md][command] |
| **Понять внутреннее устройство** | [concepts/machine.md][machine] → [concepts/cache.md][cache] → [concepts/agent.md][agent] |
| **Оптимистичные обновления** | [concepts/patching.md][patching] → [usage/links.md][links] |
| **SSR / гидрация** | [usage/snapshot.md][snapshot] |
| **Кросс-табовая синхронизация** | [usage/broadcast.md][broadcast] |
| **API-справочник** | [api/README.md][api] → [api/resource.md][api-resource] → [api/command.md][api-command] → [api/types.md][api-types] |
| **Написание плагинов** | [usage/plugins.md][plugins] |
| **Контрибьютинг** | [internal/README.md][internal] |


[signals]: ../signals/README.md
[resource]: usage/resource.md
[command]: usage/command.md
[machine]: concepts/machine.md
[cache]: concepts/cache.md
[agent]: concepts/agent.md
[patching]: concepts/patching.md
[links]: usage/links.md
[snapshot]: usage/snapshot.md
[broadcast]: usage/broadcast.md
[api]: api/README.md
[api-resource]: api/resource.md
[api-command]: api/command.md
[api-types]: api/types.md
[plugins]: usage/plugins.md
[internal]: internal/README.md
