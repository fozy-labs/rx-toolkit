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

## Query хуки

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

    if (!userQuery.hasData) {
        return userQuery.hasError
            ? <div>Ошибка: {String(userQuery.error)}</div>
            : <div>Загрузка...</div>;
    }

    if (userQuery.isInvalidating) {
        // Показываем данные + индикатор инвалидации
    }
    
    return (
        <div>
            <h1>{userQuery.data?.name}</h1>
            <p>{userQuery.data?.email}</p>
        </div>
    );
}
```

**Возвращаемое значение (TResourceClutchState):**

| Поле               | Тип              | Описание                              |
|--------------------|------------------|---------------------------------------|
| `status`           | `TClutchStatus`  | `'idle'` · `'pending'` · `'success'` · `'error'` |
| `dataSource`       | `'none' \| 'placeholder' \| 'previous' \| 'current'` | Что сейчас в `data` |
| `data`             | `TData \| null`  | Данные ресурса                        |
| `error`            | `unknown`        | Ошибка последнего завершившегося запроса; живёт до следующего |
| `args`             | `TArgs \| null`  | Аргументы текущего наблюдения         |
| `dataArgs`         | `TArgs \| null`  | Аргументы, для которых загружены `data` |
| `hasData`          | `boolean`        | Есть что показать                     |
| `hasError`         | `boolean`        | Есть ошибка                           |
| `isPending`        | `boolean`        | Запрос в полёте                       |
| `isInitialLoading` | `boolean`        | Запрос в полёте: показать нечего либо только плейсхолдер |
| `isSwitching`      | `boolean`        | Запрос в полёте, на экране данные предыдущих аргументов (SWR) |
| `isInvalidating`   | `boolean`        | Запрос в полёте поверх данных текущих аргументов |
| `retry()`          | `() => void`     | Повторить упавший запрос, оставив ошибку на экране |
| `invalidate()`     | `() => void`     | Перезапросить показанное, сняв ошибку |

Полная таблица вариантов состояния — в [API сцепления ресурса](../../query/api/resource-clutch.md#варианты-состояния).

**Особенности:**
- Автоматическая подписка на состояние ресурса
- Умная инициация: не повторяет запрос для тех же аргументов
- Поддержка `SKIP` токена для условного пропуска запроса
- При смене аргументов показывает предыдущие данные во время загрузки новых
- Пока идёт повтор упавшего запроса, истинны и `isPending`, и `hasError` — отдельного флага у него нет

### useSuspenseResource

Suspense-вариант `useResource`. Вместо флагов загрузки/ошибки хук интегрируется с React Suspense и Error Boundary. Решение принимается по порядку:

1. есть что показать (`hasData`) — возвращает состояние, в котором `data` **гарантированно не `null`**;
2. `status === 'error'` и показать нечего — бросает ошибку → её ловит ближайший `ErrorBoundary`;
3. иначе приостанавливает рендер → показывается ближайший `<Suspense fallback>`.

Ошибка **за** данными предыдущих аргументов или за плейсхолдером не бросается: она приходит в возвращённом состоянии, потому что на экране есть что оставить.

```tsx
import { Suspense } from 'react';
import { userResource } from '../api/userResource';

function UserProfile({ userId }: { userId: string }) {
    // data типизирована как TData (без | null) — проверки не нужны
    const { data, isInvalidating } = userResource.useSuspenseResource({ id: userId });

    return (
        <div>
            <h1>{data.name} {isInvalidating && '🔄'}</h1>
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

**Возвращаемое значение (`TSuspenseResourceState`):** те же варианты, что у `useResource` (`TResourceClutchState`), суженные до `dataSource: 'placeholder' | 'previous' | 'current'` — поэтому `data` имеет тип `TData` вместо `TData | null`.

**Особенности и отличия от `useResource`:**

| Сценарий                                   | Поведение                                                                    |
|--------------------------------------------|------------------------------------------------------------------------------|
| Первичная загрузка, показать нечего        | Приостанавливает рендер → `<Suspense fallback>`                               |
| Первичная ошибка, показать нечего          | Бросает ошибку → `ErrorBoundary`                                              |
| Инвалидация                                | **Не** приостанавливается: устаревшие данные на экране, `isInvalidating = true` |
| Упавшая инвалидация                        | **Не** приостанавливается: `status = 'error'` при `dataSource = 'current'`     |
| Загрузка / ошибка за данными предыдущих args или плейсхолдером | **Не** приостанавливается и не бросает: состояние возвращается как есть |
| Кэш уже прогрет                            | Рендерится синхронно, без fallback                                            |

- Запрос стартует **во время рендера** (а не в эффекте) — приостановленный рендер не выполняет эффекты, иначе fallback завис бы навсегда.
- `SKIP` намеренно **не поддерживается**: компонент, который может приостановиться, всегда должен иметь аргументы. Для условных запросов используйте `useResource`.
- Хук наследует клиентское ограничение `useSignal` (без `getServerSnapshot`) — для потокового SSR используйте `useResource`.

### useCommand

Создаёт сцепление команды и возвращает кортеж `[trigger, state]`.

```tsx
import { useCommand } from '@fozy-labs/rx-toolkit';
import { updateUserCommand } from '../api/updateUserCommand';

function EditUserForm({ user }: { user: User }) {
    const [updateUser, updateState] = useCommand(updateUserCommand);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        
        const result = await updateUser({
            id: user.id,
            data: Object.fromEntries(formData)
        });
        if (result.status === 'success') {
            console.log('Обновлено:', result.data);
        } else {
            console.error('Ошибка:', result.error);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input name="name" defaultValue={user.name} />
            <input name="email" defaultValue={user.email} />
            
            <button type="submit" disabled={updateState.isPending}>
                {updateState.isPending ? 'Сохранение...' : 'Сохранить'}
            </button>
            
            {updateState.hasError && (
                <p className="error">Ошибка: {String(updateState.error)}</p>
            )}
        </form>
    );
}
```

**Возвращаемое значение:**
```typescript
[
    trigger: (args: TArgsOrKeyed<TArgs>) => TTriggerPromise<TData>,  // Функция запуска команды
    state: TCommandClutchState                // Текущее состояние
]
```

**trigger функция:**
- Возвращает `TTriggerPromise<TData>` — конверт результата, дискриминированный по `status`
- Промис не реджектится; `.unwrap()` даёт сырой промис с «бросающей» семантикой
- Функция стабильна (не меняется между рендерами)

**state объект:**

| Поле        | Тип                                          | Описание               |
|-------------|----------------------------------------------|------------------------|
| `status`    | `"idle" \| "pending" \| "success" \| "error"` | Текущий статус команды |
| `data`      | `TData \| null`                              | Результат команды      |
| `error`     | `unknown`                                    | Ошибка мутации; переживает повтор |
| `args`      | `TArgs \| null`                              | Аргументы запуска      |
| `isPending` | `boolean`                                    | Выполняется ли команда |
| `hasData`   | `boolean`                                    | Успешно ли завершена   |
| `hasError`  | `boolean`                                    | Есть ли ошибка         |
| `retry()`   | `() => void`                                 | Перезапустить упавшую мутацию |

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
    
    const hasData = userQuery.hasData && settingsQuery.hasData;
    const hasError = userQuery.hasError || settingsQuery.hasError;
    
    if (hasError) return <Error />;
    if (!hasData) return <Loader />;
    
    return (
        <div>
            <UserInfo user={userQuery.data} />
            <Settings settings={settingsQuery.data} />
        </div>
    );
}
```
