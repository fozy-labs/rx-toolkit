# Оптимистичные обновления — RxQuery v2

> ⚠️ **Экспериментальный модуль.**

## Основы

Каждая запись кэша поддерживает **очередь патчей** — Immer-based мутаций, которые накладываются поверх оригинальных данных. 
Патч можно подтвердить (`commit`) или откатить (`abort`).


## Поведение при нарушении консистентности

- При произвольных abort в множественных патчах одного ресурса может возникунть неконсистентное состояние.
- В этих случаях, данные ресурса будут инвалидированны.
- Пока не будут получены новые данные, в кеше будут последние валидные пропатченные данные.

Например:

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

const patch1 = entry.createPatch(draft => { // тк мы указали второмы аругемтом `true`, то ts определил, что entry не может быть null
    draft.items.push(newItem);
});
const patch2 = entry.createPatch(draft => {
    draft.items[0].text = 'Изменено';
});

// Тут будет нарушена консистентность:
patch2?.commit();
patch1?.abort();  // log: 'fetching data...'

// Или тут

patch1?.abort();  // log: 'fetching data...'
patch2?.commit();

// В обоих случаях, данные останутся в кеше, пока не придут новые
resource.getData(undefined)?.items.length;  // 2
await delay(1500);
resource.getData(undefined)?.items.length;  // 1
```

## Использование с командами

На данный момент команды не реализованы в query v2.

## Использование через Ref

### createPatch

```typescript
import { unstable_queryV2 } from '@fozy-labs/rx-toolkit';

const api = unstable_queryV2.createApi({
    plugins: [new unstable_queryV2.ReactHooksPlugin()],
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
    const { entry } = todosResource.useResourceV2Agent(undefined);

    const handleToggle = async () => {
        // 1. Создаём оптимистичный патч
        const patch = entry.createPatch((draft) => {
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

### Патч при отсутствии данных

Если запись кэша не содержит данных (статус не `success` / `refreshing`), `createPatch` вернёт `null`:

```typescript
const patch = entry.createPatch(draft => { /* ... */ });
if (!patch) {
    console.warn('Нет данных для патча');
    return;
}
```

