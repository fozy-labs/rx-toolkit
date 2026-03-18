# Миграция с Query v1 на Query v2

> ⚠️ Query v2 — **экспериментальный модуль**. v1 продолжает поддерживаться.

## Сосуществование v1 и v2

Оба модуля могут использоваться одновременно в одном приложении без конфликтов. Они полностью изолированы:
- v1: импорты из `@fozy-labs/rx-toolkit` (`createResource`, `createCommand`)
- v2: импорты из `@fozy-labs/rx-toolkit` через namespace `queryV2`

```typescript
// v1
import { createResource, useResourceAgent } from '@fozy-labs/rx-toolkit';

// v2
import { queryV2 } from '@fozy-labs/rx-toolkit';
const api = queryV2.createApi({ /* ... */ });
```

Кэши v1 и v2 не пересекаются. Можно мигрировать ресурсы по одному.

---

## Маппинг концепций

### createResource → createApi + api.createResource

```typescript
// v1
const userResource = createResource({
    queryFn: fetchUser,
    cacheLifetime: 30000,
    devtoolsName: 'user',
});

// v2
const api = queryV2.createApi({
    plugins: [new queryV2.ReactHooksPlugin()],
});
const userResource = api.createResource({
    key: 'user',
    queryFn: fetchUser,
    cacheLifetime: 30000,
});
```

**Ключевые отличия:**
- Ресурс создаётся через API-инстанс, а не как standalone
- `devtoolsName` заменён на `key` + `beforeDevtoolsPush`
- Общая конфигурация (cacheLifetime, serialization) задаётся на уровне API

### Resource → ResourceV2

| v1 | v2 | Примечание |
|----|----|-----------|
| `createResource(opts)` | `api.createResource(opts)` | Через API-инстанс |
| `queryFn(args, tools)` | `queryFn(args, { abortSignal })` | Та же сигнатура tools |
| `select` | — | Убрано, трансформация вне ресурса |
| `devtoolsName` | `key` + `beforeDevtoolsPush` | Ключ для snapshot и devtools |
| `compareArgsFn` | `compareArg` | Переименовано |

### Command → Вне scope v2

В v2 нет прямого аналога `createCommand`. Мутации реализуются через:
- Прямые вызовы API + `ref.createPatch()` для оптимистичных обновлений
- `ref.invalidate()` для инвалидации после мутации

```typescript
// v1: Command с link
const updateUser = createCommand({
    queryFn: updateUserApi,
    link(add) {
        add({
            resource: userResource,
            forwardArgs: (args) => ({ id: args.id }),
            update: ({ draft, args }) => { draft.name = args.name; },
        });
    },
});

// v2: Прямой вызов + патч
async function updateUser(id: string, name: string) {
    const ref = userResource.useResourceV2Ref({ id });
    const patch = ref.createPatch(draft => { draft.name = name; });
    try {
        await fetch(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        patch?.commit();
    } catch {
        patch?.abort();
    }
}
```

### Boolean flags → Machine states

```typescript
// v1
if (query.isLoading) { /* ... */ }
if (query.isSuccess) { /* ... */ }
if (query.isError) { /* ... */ }

// v2 — агент предоставляет те же флаги
if (state.isLoading) { /* ... */ }
if (state.isSuccess) { /* ... */ }
if (state.isError) { /* ... */ }

// v2 — дополнительно: машина состояний
if (state.status === 'pending') { /* ... */ }
if (state.status === 'refreshing') { /* ... */ }
if (state.isInitialLoading) { /* первая загрузка */ }
if (state.isRefreshing) { /* обновление с данными */ }
```

### useResourceAgent → useResourceV2Agent

```typescript
// v1
import { useResourceAgent } from '@fozy-labs/rx-toolkit';
const query = useResourceAgent(userResource, { id: '1' });

// v2 (через ReactHooksPlugin)
const state = userResource.useResourceV2Agent({ id: '1' });
```

**Изменения:**
- Хук вызывается на самом ресурсе (метод, добавленный плагином)
- Не нужен отдельный импорт хука
- Для пропуска запроса используется `SKIP` вместо условного вызова

### useResourceRef → useResourceV2Ref

```typescript
// v1
import { useResourceRef } from '@fozy-labs/rx-toolkit';
const ref = useResourceRef(userResource, { id: '1' });
ref.patch(draft => { draft.name = 'new'; });

// v2 (через ReactHooksPlugin)
const ref = userResource.useResourceV2Ref({ id: '1' });
const patch = ref.createPatch(draft => { draft.name = 'new'; });
patch?.commit(); // или patch?.abort();
```

**Изменения:**
- `patch()` → `createPatch()` с явным `commit/abort`
- Добавлен `ref.create(data)` для предзаполнения кэша
- `ref.lock()` возвращает `{ unlock }` для разблокировки

### resetAllQueriesCache → api.resetAll

```typescript
// v1
import { resetAllQueriesCache } from '@fozy-labs/rx-toolkit';
resetAllQueriesCache();

// v2
api.resetAll();
```

---

## Новое в v2

| Функция | Описание |
|---------|----------|
| **Плагины** | Расширяемая архитектура (`ReactHooksPlugin` и др.) |
| **Machine states** | Типизированные состояния вместо boolean-флагов |
| **SSR Snapshots** | `getSnapshot()` / `initialSnapshot` для серверного рендеринга |
| **API factory** | Единая точка конфигурации |
| **Очередь патчей** | Несколько независимых оптимистичных обновлений |
| **SKIP_TOKEN** | Пропуск запроса с типобезопасностью |
