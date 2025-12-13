# RxQuery

RxQuery — система для управления асинхронными запросами и кэшированием данных в RxToolkit. Она состоит из двух основных компонентов: **Resources** и **Operations**.

## Основные концепции

### Resources (Ресурсы)

Resources предназначены для реактивного кэширования повторяемых запросов. Они автоматически управляют состоянием загрузки, кэшируют результаты и обеспечивают эффективную инвалидацию данных.

**Ключевые особенности:**
- Автоматическое кэширование по аргументам запроса
- Поддержка AbortController для отмены запросов
- Реактивные обновления состояния
- Оптимистичные обновления
- Гибкое управление временем жизни кэша

### Operations (Операции)

Operations представляют одноразовые операции или мутации. Они не кэшируются, но предоставляют состояние выполнения и могут связываться с ресурсами для их обновления.

**Ключевые особенности:**
- Отслеживание состояния выполнения
- Связывание с ресурсами для их обновления
- Поддержка оптимистичных обновлений
- Возможность блокировки связанных ресурсов
- Автоматический откат при ошибках

### Agents (Агенты)

Agents представляют собой интеллектуальные обертки над ресурсами (или операциями), которые обеспечивают более удобную работу с состояниями запросов для потребителей.

**Основная проблема, которую решают агенты:**

Кэш ресурсов содержит "сырые" состояния отдельных запросов, но потребителям нужна более высокоуровневая логика:
- `isInitialLoading` должно быть true только при первой загрузке ресурса
- При смене аргументов запроса нужно показывать данные предыдущего запроса, пока загружается новый
- Состояние загрузки должно отражать контекст использования, а не просто состояние кэша

### ResourceRef (Ссылка на ресурс)

Ref — это абстракция для взаимодействия с элементом кэша ресурса напрямую.

**Особенности:**
- Операции используют ref под капотом для управления связанным ресурсом
- Ref может ссылаться на отсутствующий элемент кэша
- Позволяет выполнять patch-транзакции для оптимистичных обновлений

---

## API

### createResource

Создает новый ресурс для кэширования данных.

```typescript
import { createResource } from '@fozy-labs/rx-toolkit';

interface User {
    id: string;
    name: string;
    email: string;
}

const userResource = createResource<{ id: string }, User>({
    async queryFn(args, tools) {
        const response = await fetch(`/api/users/${args.id}`, {
            signal: tools.abortSignal // Поддержка отмены запроса
        });
        return response.json();
    },
    
    // Опционально: трансформация данных
    select: (data) => ({
        id: data.id,
        name: data.name,
        email: data.email
    }),
    
    // Опционально: время жизни кэша (по умолчанию 60 секунд)
    cacheLifetime: 30000, // 30 секунд
    
    // Опционально: имя для devtools
    devtoolsName: 'user-resource',
    
    // Опционально: кастомное сравнение аргументов
    compareArgsFn: (args1, args2) => args1.id === args2.id,
});
```

**Параметры createResource:**

| Параметр | Тип | Описание |
|----------|-----|----------|
| `queryFn` | `(args, tools) => Promise<Result>` | Функция выполнения запроса |
| `select` | `(data) => Selected` | Опциональная функция трансформации данных |
| `cacheLifetime` | `number \| false` | Время жизни кэша в мс (default: 60000). `false` — кэш не удаляется |
| `compareArgsFn` | `(args1, args2) => boolean` | Кастомная функция сравнения аргументов |
| `onCacheEntryAdded` | `(args, tools) => void` | Хук при добавлении элемента в кэш |
| `onQueryStarted` | `(args, tools) => void` | Хук при старте запроса |
| `devtoolsName` | `string \| false` | Имя для devtools (`false` — отключить) |

**Tools в queryFn:**
- `abortSignal` — AbortSignal для отмены запроса

### createOperation

Создает новую операцию для выполнения мутаций.

```typescript
import { createOperation } from '@fozy-labs/rx-toolkit';

const updateUser = createOperation<
    { id: string; data: Partial<User> },
    User
>({
    async queryFn(args) {
        const response = await fetch(`/api/users/${args.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args.data)
        });
        return response.json();
    },
    
    // Связывание с ресурсами
    link(add) {
        add({
            resource: userResource,
            forwardArgs: (args) => ({ id: args.id }),
            // Обновление кэша после успешного запроса
            update({ draft, args, data }) {
                Object.assign(draft, args.data);
            },
        });
    },
    
    devtoolsName: 'update-user',
});
```

**Параметры createOperation:**

| Параметр            | Тип                         | Описание                                      |
|---------------------|-----------------------------|-----------------------------------------------|
| `queryFn`           | `(args) => Promise<Result>` | Функция выполнения операции                   |
| `select`            | `(data) => Selected`        | Опциональная функция трансформации результата |
| `link`              | `(add) => void`             | Функция связывания с ресурсами                |
| `cacheLifetime`     | `number \| false`           | Время жизни кэша операции (default: 1000)     |
| `onCacheEntryAdded` | `(args, tools) => void`     | Хук при добавлении в кэш                      |
| `onQueryStarted`    | `(args, tools) => void`     | Хук при старте операции                       |
| `devtoolsName`      | `string \| false`           | Имя для devtools                              |

---

## Свойства Link

Link позволяет связывать операции с ресурсами для автоматического обновления кэша:

```typescript
type LinkOptions<D, RD> = {
    /**
     * Целевой ресурс, с которым связывается операция
     * @required
     */
    resource: ResourceInstance<RD>;

    /**
     * Функция для получения аргументов ресурса из аргументов операции.
     * Используется для определения какой элемент в кэше нужно обновить
     * @required
     */
    forwardArgs: (args: D["Args"]) => RD["Args"];

    /**
     * Инвалидация кэша после выполнения операции.
     * При true — кэш будет очищен и ресурс перезагрузится
     * @default false
     */
    invalidate?: boolean;

    /**
     * Блокировка ресурса во время выполнения операции.
     * При true — ресурс не сможет выполнять новые запросы
     * @default false
     */
    lock?: boolean;

    /**
     * Обновление кэша ПОСЛЕ успешного выполнения операции.
     * Использует Immer для иммутабельных обновлений
     */
    update?: (tools: {
        draft: RD["Data"];      // Immer draft для мутации
        args: D["Args"];        // Аргументы операции
        data: D["Data"];        // Результат операции
    }) => void | RD["Data"];

    /**
     * Оптимистичное обновление ДО выполнения операции.
     * Позволяет обновить UI немедленно
     */
    optimisticUpdate?: (tools: {
        draft: RD["Data"];      // Immer draft для мутации
        args: D["Args"];        // Аргументы операции
    }) => void | RD["Data"];

    /**
     * Создание нового элемента в кэше.
     * Используется когда операция создает новую сущность
     */
    create?: (tools: {
        args: D["Args"];
        data: D["Data"];
    }) => RD["Data"] | Promise<RD["Data"]>;
};
```

### Пример: Оптимистичные обновления

```typescript
const toggleCartItem = createOperation({
    queryFn: async (args: { id: string; enabled: boolean }) => {
        return fetch(`/api/cart/toggle`, {
            method: 'POST',
            body: JSON.stringify(args)
        }).then(r => r.json());
    },
    link(add) {
        add({
            resource: cartResource,
            forwardArgs: () => undefined, // Корзина без параметров
            
            // Оптимистичное обновление — UI обновится мгновенно
            optimisticUpdate: ({ draft, args }) => {
                const item = draft.items.find(i => i.id === args.id);
                if (item) {
                    item.enabled = args.enabled;
                }
            }
            // При ошибке изменения автоматически откатятся
        });
    }
});
```

---

## Состояния запросов

### ResourceQueryState

Состояние запроса ресурса через агента:

```typescript
type ResourceQueryState<D> = {
    /** Инициализирован ли хотя бы один запрос */
    isInitiated: boolean;
    
    /** Любая загрузка (первая или повторная) */
    isLoading: boolean;
    
    /** Первая загрузка (данных еще не было) */
    isInitialLoading: boolean;
    
    /** Перезагрузка (данные уже есть) */
    isReloading: boolean;
    
    /** Завершен ли запрос */
    isDone: boolean;
    
    /** Успешно ли завершен последний запрос */
    isSuccess: boolean;
    
    /** Произошла ли ошибка последнего запроса */
    isError: boolean;
    
    /** Заблокирован ли ресурс операцией */
    isLocked: boolean;
    
    /** Оригинал ошибки, если есть */
    error: unknown | undefined;
    
    /** Данные (или select данных) */
    data: D["Data"] | undefined;
    
    /** Аргументы последнего запроса */
    args: D["Args"] | undefined;
}
```

### OperationQueryState

Состояние выполнения операции:

```typescript
type OperationQueryState<D> = {
    isInitiated: boolean;
    isLoading: boolean;
    isDone: boolean;
    isSuccess: boolean;
    isError: boolean;
    error: unknown | undefined;
    data: D["Data"] | undefined;
}
```

---

## ResourceRef API

ResourceRef предоставляет низкоуровневый доступ к элементу кэша:

```typescript
type ResourceRefInstanse<D> = {
    /** Проверка наличия элемента в кэше */
    get has(): boolean;
    
    /** Блокировка ресурса (возвращает функцию разблокировки) */
    lock(): { unlock: () => void };
    
    /** Снятие одной блокировки */
    unlockOne(): void;
    
    /** Patch-транзакция для изменения данных */
    patch(patchFn: (data: D['Data']) => void): ResourceTransaction | null;
    
    /** Инвалидация (очистка) кэша */
    invalidate(): void;
    
    /** Создание элемента в кэше с данными */
    create(data: D['Data']): void;
}
```

### Patch-транзакции

Транзакции позволяют делать изменения с возможностью отката:

```typescript
type ResourceTransaction = {
    patches: ImmerPatch[]           // Патчи изменений
    inversePatches: ImmerPatch[]    // Патчи для отката
    status: 'pending' | 'committed' | 'aborted'
    abort(): void                   // Откатить изменения
    commit(): void                  // Подтвердить изменения
}
```

**Пример использования транзакций:**

```typescript
import { useResourceRef } from '@fozy-labs/rx-toolkit';

function TodoList() {
    const todoRef = useResourceRef(todoResource, undefined);
    const [pendingChanges, setPendingChanges] = useState([]);
    
    const handleToggle = (itemId: number) => {
        const transaction = todoRef.patch((draft) => {
            const item = draft.items.find(i => i.id === itemId);
            if (item) item.completed = !item.completed;
        });
        
        if (transaction) {
            setPendingChanges(prev => [...prev, {
                id: itemId,
                transaction
            }]);
        }
    };
    
    const commitChange = (id: number) => {
        const change = pendingChanges.find(c => c.id === id);
        change?.transaction.commit();
        setPendingChanges(prev => prev.filter(c => c.id !== id));
    };
    
    const abortChange = (id: number) => {
        const change = pendingChanges.find(c => c.id === id);
        change?.transaction.abort(); // Данные вернутся к исходным
        setPendingChanges(prev => prev.filter(c => c.id !== id));
    };
}
```

---

## Lifecycle хуки

### onCacheEntryAdded

Вызывается при добавлении нового элемента в кэш:

```typescript
const userResource = createResource({
    queryFn: fetchUser,
    
    onCacheEntryAdded(args, { $cacheDataLoaded, $cacheEntryRemoved, dataChanged$ }) {
        // args — аргументы запроса
        
        // Ожидание первой загрузки данных
        $cacheDataLoaded.then(() => {
            console.log('Данные загружены в кэш');
        });
        
        // Ожидание удаления из кэша
        $cacheEntryRemoved.then(() => {
            console.log('Элемент удален из кэша');
        });
        
        // Подписка на изменения данных
        const sub = dataChanged$.subscribe(data => {
            console.log('Данные изменились:', data);
        });
    }
});
```

### onQueryStarted

Вызывается при старте каждого запроса:

```typescript
const userResource = createResource({
    queryFn: fetchUser,
    
    async onQueryStarted(args, { $queryFulfilled }) {
        console.log('Запрос начат с аргументами:', args);
        
        const result = await $queryFulfilled;
        
        if (result.isError) {
            console.error('Ошибка запроса:', result.error);
        } else {
            console.log('Запрос успешен:', result.data);
        }
    }
});
```

---

## Утилиты

### resetAllQueriesCache

Сбрасывает кэш всех ресурсов в приложении:

```typescript
import { resetAllQueriesCache } from '@fozy-labs/rx-toolkit';

function LogoutButton() {
    const handleLogout = () => {
        // Очистить все кэшированные данные при выходе
        resetAllQueriesCache();
        navigate('/login');
    };
    
    return <button onClick={handleLogout}>Выйти</button>;
}
```

### SKIP токен

Используется для условного пропуска запроса:

```typescript
import { useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';

function UserProfile({ userId }: { userId: string | null }) {
    // Запрос будет выполнен только если userId не null
    const userQuery = useResourceAgent(
        userResource,
        userId ? { id: userId } : SKIP
    );
    
    if (!userId) return <div>Выберите пользователя</div>;
    if (userQuery.isLoading) return <div>Загрузка...</div>;
    
    return <div>{userQuery.data?.name}</div>;
}
```

---

## Примеры

### Корзина покупок с оптимистичными обновлениями

```typescript
import { createResource, createOperation, useResourceAgent, useOperationAgent } from '@fozy-labs/rx-toolkit';

const cartResource = createResource({
    queryFn: () => fetch('/api/cart').then(r => r.json()),
    devtoolsName: 'cart'
});

const toggleCartItem = createOperation({
    queryFn: (args: { id: string; enabled: boolean }) => 
        fetch('/api/cart/toggle', {
            method: 'POST',
            body: JSON.stringify(args)
        }).then(r => r.json()),
    
    link(add) {
        add({
            resource: cartResource,
            forwardArgs: () => undefined,
            optimisticUpdate: ({ draft, args }) => {
                const item = draft.items.find(i => i.id === args.id);
                if (item) item.enabled = args.enabled;
            }
        });
    }
});

function ShoppingCart() {
    const cartQuery = useResourceAgent(cartResource, undefined);
    const [toggleItem, toggleState] = useOperationAgent(toggleCartItem);
    
    return (
        <div>
            {cartQuery.data?.items.map(item => (
                <div key={item.id}>
                    <span>{item.name}</span>
                    <button onClick={() => toggleItem({ 
                        id: item.id, 
                        enabled: !item.enabled 
                    })}>
                        {item.enabled ? 'Убрать' : 'Добавить'}
                    </button>
                </div>
            ))}
        </div>
    );
}
```

### Зависимые запросы

```typescript
const userResource = createResource({
    queryFn: (args: { id: number }) => fetch(`/api/users/${args.id}`).then(r => r.json()),
});

const userStatsResource = createResource({
    queryFn: (args: { userId: number; period: string }) => 
        fetch(`/api/users/${args.userId}/stats?period=${args.period}`).then(r => r.json()),
});

function UserDashboard({ userId }: { userId: number }) {
    const [period, setPeriod] = useState('daily');
    
    const userQuery = useResourceAgent(userResource, { id: userId });
    
    // Запрос статистики выполняется только после загрузки пользователя
    const statsQuery = useResourceAgent(
        userStatsResource,
        userQuery.isSuccess ? { userId, period } : SKIP
    );
    
    // ...
}
```

## React интеграция

См. [React интеграция](../usage/react/README.md) для подробной информации о React хуках.

