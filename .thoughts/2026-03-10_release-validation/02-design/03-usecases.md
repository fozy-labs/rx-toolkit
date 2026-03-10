# Юзкейсы и тестовые сценарии

## 1. Обзор

Документ описывает критические пользовательские сценарии, которые должны быть покрыты тестами. Каждый сценарий включает описание, edge-кейсы и примеры кода, отражающие предполагаемое использование публичного API.

## 2. Критические пользовательские сценарии

### UC-1: Базовый запрос данных (Resource)

**Описание**: Потребитель создаёт ресурс и использует хук для получения данных.

```typescript
import { createResource, useResourceAgent } from '@fozy-labs/rx-toolkit';

const userResource = createResource({
  queryFn: async (userId: string, { abortSignal }) => {
    const response = await fetch(`/api/users/${userId}`, { signal: abortSignal });
    return response.json();
  },
  cacheLifetime: 30_000,
});

// В React-компоненте:
function UserProfile({ userId }: { userId: string }) {
  const state = useResourceAgent(userResource, userId);

  if (state.isLoading) return <Spinner />;
  if (state.isError) return <Error error={state.error} />;
  return <div>{state.data.name}</div>;
}
```

**Edge-кейсы**:
- `userId` меняется быстрее, чем возвращается ответ → предыдущий запрос должен быть aborted
- `cacheLifetime` истекает → данные удаляются из кэша
- Один и тот же `userId` запрашивается из двух компонентов → один запрос, shared cache

---

### UC-2: Условный запрос со SKIP

**Описание**: Потребитель хочет не запускать запрос до тех пор, пока не будут готовы аргументы.

```typescript
import { useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';

function UserProfile({ userId }: { userId: string | null }) {
  const state = useResourceAgent(userResource, userId ?? SKIP);
  // При userId === null запрос не выполняется
}
```

**Edge-кейсы**:
- Переход `SKIP → args` → запрос запускается
- Переход `args → SKIP` → текущие данные остаются
- Повторный `SKIP` → ничего не происходит

---

### UC-3: Мутация с Command + Link

**Описание**: Потребитель создаёт команду, связанную с ресурсом, для оптимистичных обновлений.

```typescript
import { createCommand, useCommandAgent } from '@fozy-labs/rx-toolkit';

const updateUserCommand = createCommand({
  queryFn: async (data: { id: string; name: string }) => {
    const response = await fetch(`/api/users/${data.id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return response.json();
  },
  link: {
    resource: userResource,
    getArgs: (data) => data.id,
    optimisticUpdate: (draft, data) => {
      draft.name = data.name;
    },
    invalidate: false,
  },
});

// В React-компоненте:
function EditUser({ userId }: { userId: string }) {
  const [trigger, state] = useCommandAgent(updateUserCommand);

  const handleSave = (name: string) => {
    trigger({ id: userId, name });
  };

  return <button onClick={() => handleSave('New Name')} disabled={state.isLoading}>Save</button>;
}
```

**Edge-кейсы**:
- Оптимистичное обновление → сервер вернул ошибку → rollback к предыдущим данным
- Две мутации подряд с `optimisticUpdate` → обе применяются последовательно
- `link.invalidate: true` → ресурс перезапрашивается после успешной мутации

---

### UC-4: Прямая работа с ResourceRef (patch-транзакции)

**Описание**: Потребитель использует `useResourceRef` для low-level работы с кэшем.

```typescript
import { useResourceRef } from '@fozy-labs/rx-toolkit';

function EditableList({ listId }: { listId: string }) {
  const ref = useResourceRef(listResource, listId);

  const addItem = (item: Item) => {
    ref.patch((draft) => {
      draft.items.push(item);
    });
    // UI обновлён оптимистично

    saveToServer(item)
      .then(() => ref.commit())
      .catch(() => ref.abort());
  };
}
```

**Edge-кейсы**:
- `patch → commit → patch → commit` — последовательные транзакции
- `patch → abort` → данные откатываются к исходным
- `patch → серверное обновление → reapply` → pending-изменения переприменяются поверх новых серверных данных
- `useResourceRef` с объектным аргументом `{ listId: '1', filter: 'active' }` — **баг**: ref создаётся заново каждый рендер

---

### UC-5: Глобальный сброс кэша

**Описание**: При логауте потребитель хочет очистить все закэшированные данные.

```typescript
import { resetAllQueriesCache } from '@fozy-labs/rx-toolkit';

function LogoutButton() {
  const handleLogout = () => {
    resetAllQueriesCache();
    // Все ресурсы получают reset, активные агенты автоматически перезапрашивают
  };
}
```

**Edge-кейсы**:
- Агент с активной подпиской автоматически инициирует re-fetch после reset
- Агент без подписчиков — кэш просто очищается
- `resetAllQueriesCache()` во время pending-запроса → запрос не отменяется, но результат записывается в свежий кэш

---

### UC-6: ResourceDuplicator (агрегация)

**Описание**: Потребитель агрегирует данные из нескольких ресурсов в один.

```typescript
import { createResourceDuplicator, useResourceAgent } from '@fozy-labs/rx-toolkit';

const dashboardResource = createResourceDuplicator({
  resources: [userResource, ordersResource, statsResource],
  getArgs: (dashboardId: string) => [dashboardId, dashboardId, dashboardId],
});

function Dashboard({ id }: { id: string }) {
  const state = useResourceAgent(dashboardResource, id);
  // state.data содержит агрегированные данные всех ресурсов
}
```

**Edge-кейсы**:
- Один из ресурсов вернул ошибку → общее состояние isError
- Ресурсы загружаются с разной скоростью → isLoading пока все не загружены
- `args` меняются → все ресурсы перезапрашиваются

---

### UC-7: Типизация потребительского кода

**Описание**: Потребитель хочет создать generic-обёртку с типами из библиотеки.

```typescript
import type { ResourceDefinition, ResourceQueryState } from '@fozy-labs/rx-toolkit';

// Сейчас ❌ — типы не экспортируются
// После фикса ✅ — типы доступны

function createTypedResource<A, R>(
  def: ResourceDefinition<A, R>
) {
  // ...
}

function renderState<D extends ResourceDefinition>(
  state: ResourceQueryState<D>
) {
  // ...
}
```

**Edge-кейсы**:
- Все экспортированные типы должны быть компилируемы при импорте
- Generic constraints должны работать с `extends`
- Deprecated типы (`OperationDefinition`) должны показывать JSDoc-предупреждение

---

### UC-8: Использование deprecated API

**Описание**: Потребитель мигрирует с Operation на Command API.

```typescript
// Старый код (deprecated):
import { createOperation, useOperationAgent } from '@fozy-labs/rx-toolkit';
const op = createOperation({ queryFn: ... });

// Новый код:
import { createCommand, useCommandAgent } from '@fozy-labs/rx-toolkit';
const cmd = createCommand({ queryFn: ... });
```

**Edge-кейсы**:
- `createOperation` должен работать идентично `createCommand`
- `useOperationAgent` должен работать идентично `useCommandAgent`
- TypeScript должен показывать `@deprecated` warning

---

## 3. Сценарии обнаруженные в исследовании

### SC-1: Race condition при быстрой смене args

Исследование (`01-codebase-analysis.md`) выявило, что `Resource.initiate()` корректно вызывает `prevAbortController?.abort()` при повторном запросе. Тест должен верифицировать, что:
1. Первый запрос отменяется
2. Результат первого запроса не записывается в кэш
3. Только второй запрос определяет финальное состояние

### SC-2: enablePatches() side effect

`ResourceRef.ts` вызывает `enablePatches()` из immer на уровне модуля. При `sideEffects: false` в package.json bundler может удалить этот вызов. Тест должен убедиться что patch-транзакции работают корректно.

### SC-3: IndirectMap с объектными ключами

`IndirectMap` использует `shallowEqual` для сравнения ключей. Тест должен проверить:
1. Два объекта `{ a: 1 }` считаются одним ключом
2. `{ a: 1 }` и `{ a: 2 }` — разные ключи
3. WeakMap-кэш корректно работает для повторных обращений

### SC-4: ReactiveCache timer и подписчики

Если все подписчики отписались, ReactiveCache запускает таймер. Если новый подписчик появится до истечения — таймер отменяется. Тест должен проверить оба пути.

### SC-5: QueriesLifetimeHooks вызовы

`onQueryStarted` вызывается с `$queryFulfilled` — Promise, который резолвится при success или reject-ится при error. Тест должен проверить оба исхода.
