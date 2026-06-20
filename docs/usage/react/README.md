# React интеграция

RxToolkit предоставляет набор React хуков для эффективной интеграции с реактивными системами библиотеки. Все хуки оптимизированы для минимальных ре-рендеров и максимальной производительности.

## Основные хуки

### useSignal

Подписывается на изменения сигнала и возвращает текущее значение.

```tsx
import { Signal, useSignal } from '@fozy-labs/rx-toolkit';

const counter$ = Signal.state(0);
const doubled$ = Signal.compute(() => counter$() * 2);

function Counter() {
    const count = useSignal(counter$);
    const doubled = useSignal(doubled$);

    return (
        <div>
            <p>Count: {count}</p>
            <p>Doubled: {doubled}</p>
            <button onClick={() => counter$.set(counter$.peek() + 1)}>
                Increment
            </button>
        </div>
    );
}
```

**Особенности:**
- Автоматическая подписка и отписка при размонтировании
- Не вызывает ре-рендер, если значение не изменилось

---

## RxQuery хуки

### useResource

Подписывается на состояние ресурса и автоматически инициирует запрос при монтировании или изменении аргументов.

```tsx
import { useResource, SKIP } from '@fozy-labs/rx-toolkit';
import { userResource } from '../api/userResource';

function UserProfile({ userId }: { userId: string | null }) {
    const userQuery = useResource(
        userResource, 
        userId ? { id: userId } : SKIP
    );

    if (userQuery.isInitialLoading) {
        return <div>Загрузка...</div>;
    }
    
    if (userQuery.isError) {
        return <div>Ошибка: {String(userQuery.error)}</div>;
    }
    
    if (userQuery.isRefreshing) {
        // Показываем данные + индикатор перезагрузки
    }
    
    return (
        <div>
            <h1>{userQuery.data?.name}</h1>
            <p>{userQuery.data?.email}</p>
        </div>
    );
}
```

**Возвращаемое значение (TResourceAgentState):**

| Поле               | Тип              | Описание                              |
|--------------------|------------------|---------------------------------------|
| `status`           | `TAgentStatus`   | Текущий статус агента                 |
| `data`             | `TData \| null`  | Данные ресурса                        |
| `error`            | `unknown`        | Объект ошибки                         |
| `args`             | `TArgs \| null`  | Аргументы последнего запроса          |
| `isLoading`        | `boolean`        | Любая загрузка (первая или повторная) |
| `isInitialLoading` | `boolean`        | Первая загрузка (данных еще нет)      |
| `isRefreshing`     | `boolean`        | Перезагрузка (данные уже есть)        |
| `isRefreshError`   | `boolean`        | Ошибка при перезагрузке               |
| `isSuccess`        | `boolean`        | Успешно ли завершен последний запрос  |
| `isError`          | `boolean`        | Произошла ли ошибка                   |
| `retry()`          | `() => void`     | Повторить последний запрос            |
| `refresh()`        | `() => void`     | Принудительно обновить данные         |

**Особенности:**
- Автоматическая подписка на состояние ресурса
- Умная инициация: не повторяет запрос для тех же аргументов
- Поддержка `SKIP` токена для условного пропуска запроса
- При смене аргументов показывает предыдущие данные во время загрузки новых

### useSuspenseResource

Suspense-вариант `useResource`. Вместо флагов загрузки/ошибки хук интегрируется с React Suspense и Error Boundary:

- пока идёт **первичная** загрузка — бросает промис → показывается ближайший `<Suspense fallback>`;
- если первичный запрос **упал** (и нет данных для отката) — бросает ошибку → её ловит ближайший `ErrorBoundary`;
- иначе возвращает состояние, в котором `data` **гарантированно не `null`**.

```tsx
import { Suspense } from 'react';
import { userResource } from '../api/userResource';

function UserProfile({ userId }: { userId: string }) {
    // data типизирована как TData (без | null) — проверки не нужны
    const { data, isRefreshing } = userResource.useSuspenseResource({ id: userId });

    return (
        <div>
            <h1>{data.name} {isRefreshing && '🔄'}</h1>
            <p>{data.email}</p>
        </div>
    );
}

function Page({ userId }: { userId: string }) {
    return (
        <ErrorBoundary fallback={<p>Не удалось загрузить профиль</p>}>
            <Suspense fallback={<Spinner />}>
                <UserProfile userId={userId} />
            </Suspense>
        </ErrorBoundary>
    );
}
```

> Если ресурс подключён через `reactHooksPlugin`, хук доступен как метод: `userResource.useSuspenseResource(args)`. Standalone-форма `useSuspenseResource(resource, args)` тоже экспортируется.

**Возвращаемое значение (`TSuspenseResourceState`):** то же, что у `useResource` (`TResourceAgentState`), но поле `data` имеет тип `TData` вместо `TData | null`.

**Особенности и отличия от `useResource`:**

| Сценарий                          | Поведение                                                                 |
|-----------------------------------|---------------------------------------------------------------------------|
| Первичная загрузка                | Бросает промис → `<Suspense fallback>`                                     |
| Первичная ошибка (нет данных)     | Бросает ошибку → `ErrorBoundary`                                           |
| Фоновое обновление (SWR)          | **Не** приостанавливается: показывает stale-данные, `isRefreshing = true`  |
| Ошибка при обновлении (SWR)       | **Не** приостанавливается: stale-данные остаются, `isRefreshError = true`  |
| Кэш уже прогрет                   | Рендерится синхронно, без fallback                                         |

- Запрос стартует **во время рендера** (а не в эффекте) — приостановленный рендер не выполняет эффекты, иначе fallback завис бы навсегда.
- `SKIP` намеренно **не поддерживается**: компонент, который может приостановиться, всегда должен иметь аргументы. Для условных запросов используйте `useResource`.
- Хук наследует клиентское ограничение `useSignal` (без `getServerSnapshot`) — для потокового SSR используйте `useResource`.

### useCommand

Создает агент команды и возвращает кортеж `[trigger, state]`.

```tsx
import { useCommand } from '@fozy-labs/rx-toolkit';
import { updateUserCommand } from '../api/updateUserCommand';

function EditUserForm({ user }: { user: User }) {
    const [updateUser, updateState] = useCommand(updateUserCommand);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        
        try {
            const result = await updateUser({ 
                id: user.id, 
                data: Object.fromEntries(formData) 
            });
            console.log('Обновлено:', result);
        } catch (error) {
            console.error('Ошибка:', error);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input name="name" defaultValue={user.name} />
            <input name="email" defaultValue={user.email} />
            
            <button type="submit" disabled={updateState.isLoading}>
                {updateState.isLoading ? 'Сохранение...' : 'Сохранить'}
            </button>
            
            {updateState.isError && (
                <p className="error">Ошибка: {String(updateState.error)}</p>
            )}
        </form>
    );
}
```

**Возвращаемое значение:**
```typescript
[
    trigger: (args: Args) => Promise<Data>,  // Функция запуска команды
    state: TCommandAgentState                // Текущее состояние
]
```

**trigger функция:**
- Возвращает Promise с результатом команды
- При ошибке Promise реджектится
- Функция стабильна (не меняется между рендерами)

**state объект:**

| Поле        | Тип                                          | Описание               |
|-------------|----------------------------------------------|------------------------|
| `status`    | `"idle" \| "pending" \| "success" \| "error"` | Текущий статус команды |
| `data`      | `TData \| null`                              | Результат команды      |
| `error`     | `unknown`                                    | Объект ошибки          |
| `args`      | `TArgs \| null`                              | Аргументы запуска      |
| `isLoading` | `boolean`                                    | Выполняется ли команда |
| `isSuccess` | `boolean`                                    | Успешно ли завершена   |
| `isError`   | `boolean`                                    | Произошла ли ошибка    |

### useResourceRef (удалён в v0.6.0)

> **Удалён:** Хук `useResourceRef` был удалён в v0.6.0. Для низкоуровневых операций с кэшем используйте `resource.getEntry(args, true)` или `resource.createAgent()` напрямую.

```tsx
import { useResource } from '@fozy-labs/rx-toolkit';
import { todoResource } from '../api/todoResource';

function TodoItem({ todo }: { todo: Todo }) {
    const todoQuery = useResource(todoResource, undefined);
    
    // Вместо useResourceRef — получаем entry напрямую:
    const entry = todoResource.getEntry(undefined, true);
    
    const handleToggle = () => {
        const transaction = entry.createPatch((draft) => {
            const item = draft.items.find(i => i.id === todo.id);
            if (item) item.completed = !item.completed;
        });
        // ...
    };
}
```


---

## Паттерны использования

### Store класс

```tsx
import { Signal, useSignal } from '@fozy-labs/rx-toolkit';

class CounterStore {
    count$ = Signal.state(0, 'counter');
    doubled$ = Signal.compute(() => this.count$() * 2);
    
    increment = () => this.count$.set(this.count$() + 1);
    decrement = () => this.count$.set(this.count$() - 1);
    reset = () => this.count$.set(0);
}

// Singleton
const counterStore = new CounterStore();

function Counter() {
    const count = useSignal(counterStore.count$);
    const doubled = useSignal(counterStore.doubled$);
    
    return (
        <div>
            <p>{count} × 2 = {doubled}</p>
            <button onClick={counterStore.increment}>+</button>
            <button onClick={counterStore.decrement}>-</button>
            <button onClick={counterStore.reset}>Reset</button>
        </div>
    );
}
```

### Условные запросы

```tsx
function UserStats({ userId, showStats }) {
    const statsQuery = useResource(
        statsResource,
        showStats && userId ? { userId } : SKIP
    );
    
    if (!showStats) return null;
    
    return <StatsDisplay data={statsQuery.data} />;
}
```

### Комбинирование ресурсов

```tsx
function Dashboard() {
    const userQuery = useResource(userResource, { id: currentUserId });
    const settingsQuery = useResource(settingsResource, undefined);
    
    const isLoading = userQuery.isLoading || settingsQuery.isLoading;
    const isError = userQuery.isError || settingsQuery.isError;
    
    if (isLoading) return <Loader />;
    if (isError) return <Error />;
    
    return (
        <div>
            <UserInfo user={userQuery.data} />
            <Settings settings={settingsQuery.data} />
        </div>
    );
}
```
