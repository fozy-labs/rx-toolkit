# Оптимистичные обновления

## Основы

Каждая запись кэша поддерживает **очередь патчей** — Immer-based мутаций, которые накладываются поверх оригинальных данных.
Патч можно подтвердить (`commit`) или откатить (`abort`).

Патч создаётся через `entry.createPatch(patchFn)` и возвращает `IPatchHandle | null`:

```typescript
interface IPatchHandle {
    commit(): void;
    abort(): void;
}
```

Если запись не содержит данных (состояние не `success` / `refreshing`), `createPatch` вернёт `null`.

---

## Использование через Agent

`useResourceAgent` возвращает `entry` — handle кэш-записи для оптимистичных патчей:

```typescript
import { query } from '@fozy-labs/rx-toolkit';

const api = createApi({
    plugins: [new ReactHooksPlugin()],
});

interface Todo {
    id: number;
    text: string;
    completed: boolean;
}

const todosResource = api.createResource<void, { items: Todo[] }>({
    key: 'todos',
    queryFn: async (_args, { abortSignal }) => {
        const res = await fetch('/api/todos', { signal: abortSignal });
        return res.json();
    },
});

function ToggleTodo({ todo }: { todo: Todo }) {
    const { entry } = todosResource.useResourceAgent(undefined);

    const handleToggle = async () => {
        // 1. Создаём оптимистичный патч
        const patch = entry?.createPatch((draft) => {
            const item = draft.items.find(i => i.id === todo.id);
            if (item) item.completed = !item.completed;
        });
        if (!patch) return;

        try {
            // 2. Отправляем на сервер
            await fetch(`/api/todos/${todo.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !todo.completed }),
            });

            // 3. Подтверждаем патч (данные остаются)
            patch.commit();
        } catch {
            // 4. Откатываем при ошибке
            patch.abort();
        }
    };

    return <button onClick={handleToggle}>{todo.text}</button>;
}
```

---

## Rollback-логика

При вызове `abort()`:

1. Immer применяет `inversePatches` для отмены изменений
2. Если reverse-применение невозможно (например, после abort другого патча в очереди), возникает **нарушение консистентности**
3. При нарушении консистентности ресурс автоматически инвалидируется — запускается свежий запрос
4. Пока не придут новые данные, в кэше остаются последние валидные пропатченные данные

---

## Нарушение консистентности

При наличии нескольких патчей на одной записи, произвольный порядок `commit`/`abort` может привести к неконсистентности:

```typescript
const resource = api.createResource({
    key: 'items',
    queryFn: async () => {
        console.log('fetching data...');
        await delay(1000);
        return { items: [{ id: 1, text: 'Исходный текст' }] };
    },
});

const entry = resource.getEntry(undefined, true);

const patch1 = entry.createPatch(draft => {
    draft.items.push({ id: 2, text: 'Новый элемент' });
});
const patch2 = entry.createPatch(draft => {
    draft.items[0].text = 'Изменено';
});

// Нарушение консистентности:
patch2?.commit();
patch1?.abort();  // log: 'fetching data...' (auto-invalidation)

// Или:
patch1?.abort();  // log: 'fetching data...' (auto-invalidation)
patch2?.commit();

// В обоих случаях данные остаются, пока не придут свежие
resource.getEntry(undefined)?.peek().data?.items.length;  // 2
await delay(1500);
resource.getEntry(undefined)?.peek().data?.items.length;  // 1
```

---

## Использование через onQueryStarted

Хук `onQueryStarted` позволяет автоматически создавать патчи при запросе. Хук вызывается при каждом запуске `queryFn` и предоставляет `$queryFulfilled` для отслеживания результата.

```typescript
const resource = api.createResource({
    key: 'todos',
    queryFn: updateTodo,
    onQueryStarted: async (args, { $queryFulfilled, getCacheEntry }) => {
        const entry = getCacheEntry();
        const patch = entry.createPatch(draft => {
            const item = draft.items.find(i => i.id === args.id);
            if (item) item.text = args.text;
        });

        try {
            await $queryFulfilled;
            patch?.commit();
        } catch {
            patch?.abort();
        }
    },
});
```

---

## Патч при отсутствии данных

Если у записи нет данных (статус `idle`, `pending`, `error`), `createPatch` возвращает `null`:

```typescript
const patch = entry?.createPatch(draft => { /* ... */ });
if (!patch) {
    console.warn('Нет данных для патча');
    return;
}
```

---

## Patch State

Состояния `success` и `refreshing` содержат `patchState`:

```typescript
interface TPatchState<TData> {
    originalData: TData;          // Исходные (серверные) данные
    patches: TPatch[];            // Очередь патчей
    isConsistencyViolation: boolean;
}

interface TPatch {
    patches: Patch[];             // Immer forward patches
    inversePatches: Patch[];      // Immer inverse patches
    status: 'pending' | 'committed' | 'aborted';
}
```

Когда `patchState` не `null`, `.data` — пропатченная версия, а `patchState.originalData` — оригинальные серверные данные.
