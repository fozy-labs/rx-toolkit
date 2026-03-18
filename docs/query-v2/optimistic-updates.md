# Оптимистичные обновления — RxQuery v2

> ⚠️ **Экспериментальный модуль.** API может измениться.

Оптимистичные обновления позволяют мгновенно отобразить результат действия пользователя, не дожидаясь ответа сервера. В v2 это реализуется через механизм патчей (`createPatch` / `finishPatch`).

## Основы

В RxQuery v2 каждая запись кэша поддерживает **очередь патчей** — Immer-based мутаций, которые накладываются поверх оригинальных данных. Патч можно подтвердить (`commit`) или откатить (`abort`).

## Использование через Ref

Самый прямой способ — использовать `IResourceV2Ref`:

```typescript
import { queryV2 } from '@fozy-labs/rx-toolkit';

const api = queryV2.createApi({
    plugins: [new queryV2.ReactHooksPlugin()],
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
```

### createPatch

Создаёт оптимистичный патч. Принимает функцию-рецепт Immer — мутации `draft` применяются мгновенно к отображаемым данным.

```typescript
function ToggleTodo({ todo }: { todo: Todo }) {
    const ref = todosResource.useResourceV2Ref(undefined);

    const handleToggle = async () => {
        // 1. Создаём оптимистичный патч
        const patch = ref.createPatch((draft) => {
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
            // 4. Откатываем при ошибке (данные возвращаются к оригиналу)
            patch.abort();
        }
    };

    return <button onClick={handleToggle}>{todo.text}</button>;
}
```

### Жизненный цикл патча

1. **`createPatch(fn)`** — применяет Immer-рецепт к данным. UI мгновенно обновляется.
2. **`commit()`** — подтверждает патч. Оригинальные данные обновляются.
3. **`abort()`** — откатывает патч. Данные возвращаются к предыдущему состоянию.

### Несколько патчей

Патчи накладываются в порядке создания. Каждый патч можно подтвердить или откатить независимо:

```typescript
const patch1 = ref.createPatch(draft => { draft.items[0].text = 'Изменено 1'; });
const patch2 = ref.createPatch(draft => { draft.items[1].text = 'Изменено 2'; });

// Подтвердить первый, откатить второй
patch1?.commit();
patch2?.abort();
```

### Патч при отсутствии данных

Если запись кэша не содержит данных (статус не `success` / `refreshing`), `createPatch` вернёт `null`:

```typescript
const patch = ref.createPatch(draft => { /* ... */ });
if (!patch) {
    console.warn('Нет данных для патча');
    return;
}
```

## Паттерн: оптимистичное обновление в компоненте

```tsx
function TodoList() {
    const state = todosResource.useResourceV2Agent(undefined);
    const ref = todosResource.useResourceV2Ref(undefined);

    const toggleTodo = async (todo: Todo) => {
        const patch = ref.createPatch((draft) => {
            const item = draft.items.find(i => i.id === todo.id);
            if (item) item.completed = !item.completed;
        });
        if (!patch) return;

        try {
            await updateTodoOnServer(todo.id, { completed: !todo.completed });
            patch.commit();
        } catch {
            patch.abort();
        }
    };

    if (state.isLoading) return <div>Загрузка...</div>;
    if (!state.data) return null;

    return (
        <ul>
            {state.data.items.map(todo => (
                <li key={todo.id} onClick={() => toggleTodo(todo)}>
                    {todo.completed ? '✅' : '⬜'} {todo.text}
                </li>
            ))}
        </ul>
    );
}
```

## Сравнение с v1

| Аспект | v1 | v2 |
|--------|----|----|
| Механизм | `resourceRef.patch()` + Command link | `ref.createPatch()` → `commit/abort` |
| Привязка | Через `link()` в Command | Напрямую через Ref |
| Отмена | Автоматическая через Command | Явный `abort()` |
| Множественные патчи | Не поддерживаются | Очередь патчей |
