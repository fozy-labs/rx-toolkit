# React интеграция

RxToolkit предоставляет набор React хуков для эффективной интеграции с реактивными системами библиотеки. Все хуки оптимизированы для минимальных ре-рендеров и максимальной производительности.

## Основные хуки

### useSignal

Подписывается на изменения сигнала и возвращает текущее значение.

```tsx
import { Signal, Computed, useSignal } from '@fozy-labs/rx-toolkit';

const counter$ = Signal.create(0);
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

### useObservable

Подписывается на RxJS Observable и возвращает текущее значение.

```tsx
import { useObservable } from '@fozy-labs/rx-toolkit';
import { interval, map } from 'rxjs';

const timer$ = interval(1000).pipe(
    map(count => `Timer: ${count}`)
);

function Timer() {
    const timerValue = useObservable(timer$, 'Timer: 0');
    
    return <div>{timerValue}</div>;
}
```

**Параметры:**
- `observable$` — RxJS Observable для подписки
- `initialValue` — начальное значение до первой эмиссии

**Особенности:**
- Требует начальное значение, если Observable асинхронный
- Автоматическая переподписка при смене Observable

### useSyncObservable

Синхронная версия `useObservable` для Observable, которые могут выдать значение немедленно.

```tsx
import { useSyncObservable } from '@fozy-labs/rx-toolkit';
import { BehaviorSubject } from 'rxjs';

const data$ = new BehaviorSubject('initial data');

function DataComponent() {
    const data = useSyncObservable(data$);
    
    return <div>Data: {data}</div>;
}
```

**Отличия от useObservable:**
- Не требует начального значения
- Подходит для BehaviorSubject, ReplaySubject и сигналов
- Выбросит ошибку, если Observable не эмитит значение синхронно

---

## RxQuery хуки

### useResourceAgent

Подписывается на состояние ресурса и автоматически инициирует запрос при монтировании или изменении аргументов.

```tsx
import { useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';
import { userResource } from '../api/userResource';

function UserProfile({ userId }: { userId: string | null }) {
    const userQuery = useResourceAgent(
        userResource, 
        userId ? { id: userId } : SKIP
    );

    if (userQuery.isInitialLoading) {
        return <div>Загрузка...</div>;
    }
    
    if (userQuery.isError) {
        return <div>Ошибка: {String(userQuery.error)}</div>;
    }
    
    if (userQuery.isReloading) {
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

**Возвращаемое значение (ResourceQueryState):**

| Поле               | Тип         | Описание                              |
|--------------------|-------------|---------------------------------------|
| `isLoading`        | `boolean`   | Любая загрузка (первая или повторная) |
| `isInitialLoading` | `boolean`   | Первая загрузка (данных еще нет)      |
| `isReloading`      | `boolean`   | Перезагрузка (данные уже есть)        |
| `isDone`           | `boolean`   | Завершен ли запрос                    |
| `isSuccess`        | `boolean`   | Успешно ли завершен последний запрос  |
| `isError`          | `boolean`   | Произошла ли ошибка                   |
| `isLocked`         | `boolean`   | Заблокирован ли ресурс для операцией  |
| `error`            | `unknown`   | Объект ошибки                         |
| `data`             | `D["Data"]` | Данные ресурса                        |
| `args`             | `D["Args"]` | Аргументы последнего запроса          |

**Особенности:**
- Автоматическая подписка на состояние ресурса
- Умная инициация: не повторяет запрос для тех же аргументов
- Поддержка `SKIP` токена для условного пропуска запроса
- При смене аргументов показывает предыдущие данные во время загрузки новых

### useOperationAgent

Создает агент операции и возвращает кортеж `[trigger, state]`.

```tsx
import { useOperationAgent } from '@fozy-labs/rx-toolkit';
import { updateUserOperation } from '../api/updateUserOperation';

function EditUserForm({ user }: { user: User }) {
    const [updateUser, updateState] = useOperationAgent(updateUserOperation);

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
    trigger: (args: Args) => Promise<Data>,  // Функция запуска операции
    state: OperationQueryState               // Текущее состояние
]
```

**trigger функция:**
- Возвращает Promise с результатом операции
- При ошибке Promise реджектится
- Функция стабильна (не меняется между рендерами)

**state объект:**

| Поле          | Тип         | Описание                  |
|---------------|-------------|---------------------------|
| `isInitiated` | `boolean`   | Была ли операция запущена |
| `isLoading`   | `boolean`   | Выполняется ли операция   |
| `isDone`      | `boolean`   | Завершена ли операция     |
| `isSuccess`   | `boolean`   | Успешно ли завершена      |
| `isError`     | `boolean`   | Произошла ли ошибка       |
| `error`       | `unknown`   | Объект ошибки             |
| `data`        | `D["Data"]` | Результат операции        |

### useResourceRef

Возвращает ссылку на элемент кэша ресурса для низкоуровневых операций.

```tsx
import { useResourceRef, useResourceAgent } from '@fozy-labs/rx-toolkit';
import { todoResource } from '../api/todoResource';

function TodoItem({ todo }: { todo: Todo }) {
    const todoQuery = useResourceAgent(todoResource, undefined);
    const todoRef = useResourceRef(todoResource, undefined);
    
    const [pendingTransaction, setPendingTransaction] = useState(null);
    
    const handleToggle = () => {
        // Создаем транзакцию для изменения
        const transaction = todoRef.patch((draft) => {
            const item = draft.items.find(i => i.id === todo.id);
            if (item) item.completed = !item.completed;
        });
        
        if (transaction) {
            setPendingTransaction(transaction);
        }
    };
    
    const handleSave = async () => {
        try {
            await saveToServer(todo.id, !todo.completed);
            pendingTransaction?.commit();
        } catch {
            pendingTransaction?.abort(); // Откатить изменения
        }
        setPendingTransaction(null);
    };
    
    return (
        <div>
            <input 
                type="checkbox" 
                checked={todo.completed}
                onChange={handleToggle}
            />
            {pendingTransaction && (
                <>
                    <button onClick={handleSave}>Сохранить</button>
                    <button onClick={() => {
                        pendingTransaction.abort();
                        setPendingTransaction(null);
                    }}>
                        Отмена
                    </button>
                </>
            )}
        </div>
    );
}
```

**Возвращаемое значение (ResourceRefInstanse):**

| Метод | Описание |
|-------|----------|
| `has` | Проверка наличия элемента в кэше |
| `lock()` | Блокировка ресурса, возвращает `{ unlock }` |
| `unlockOne()` | Снятие одной блокировки |
| `patch(fn)` | Создание patch-транзакции |
| `invalidate()` | Инвалидация кэша |
| `create(data)` | Создание элемента в кэше |


---

## Паттерны использования

### Store класс

```tsx
import { Signal, useSignal } from '@fozy-labs/rx-toolkit';

class CounterStore {
    count$ = Signal.create(0, 'counter');
    doubled$ = Signal.compute(() => this.count$() * 2);
    
    increment = () => this.count$.set(this.count$.peek() + 1);
    decrement = () => this.count$.set(this.count$.peek() - 1);
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
    const statsQuery = useResourceAgent(
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
    const userQuery = useResourceAgent(userResource, { id: currentUserId });
    const settingsQuery = useResourceAgent(settingsResource, undefined);
    
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
