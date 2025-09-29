# React интеграция

RxToolkit предоставляет набор React хуков для эффективной интеграции с реактивными системами библиотеки. Все хуки оптимизированы для минимальных ре-рендеров и максимальной производительности.

## Основные хуки

### useSignal

Подписывается на изменения сигнала и возвращает текущее значение.

```tsx
import { useSignal } from '@fozy-labs/rx-toolkit';

function Counter() {
  const count = useSignal(countSignal);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => countSignal.value++}>
        Increment
      </button>
    </div>
  );
}
```

**Особенности:**
- Автоматическая подписка и отписка
- Использует `useSyncExternalStore` для оптимальной производительности
- Не вызывает ре-рендер, если значение не изменилось

### useObservable

Подписывается на RxJS Observable и возвращает текущее значение.

```typescript
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

### useSyncObservable

Синхронная версия `useObservable` для Observable, которые могут выдать значение немедленно.
Если Observable не может выдать значение сразу, будет выброшена ошибка.

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
- Получает значение синхронно при первом рендере
- Подходит для BehaviorSubject и других синхронных Observable

## RxQuery хуки

### useResourceAgent

Подписывается на состояние ресурса и автоматически инициирует запрос.

```tsx
import { useResourceAgent, SKIP } from '@fozy-labs/rx-toolkit';
import { userResource } from '../api/userResource.ts';

// Автоматическая инициация
function UserProfile({ userId }: { userId: string | null }) {
  const userState = useResourceAgent(userResource, userId ? { id: userId } : SKIP);

  if (userState.isLoading || !userId) return <div>Загрузка...</div>;
  if (userState.isError) return <div>Ошибка: {userState.error?.message}</div>;
  
  return (
    <div>
      <h1>{userState.data?.name}</h1>
      <p>{userState.data?.email}</p>
    </div>
  );
}
```

**Особенности:**
- Автоматическая подписка на состояние ресурса
- Умная инициация: не повторяет запрос для тех же аргументов
- Поддержка SKIP токена для ручного управления

### useOperationAgent

Подписывается на состояние операции для отслеживания выполнения мутаций.

```tsx
import { useOperationAgent } from '@fozy-labs/rx-toolkit';
import { updateUserOperation } from '../api/updateUserOperation.ts';
import { User } from '../types/user.ts';

function EditUserForm({ user }: { user: User }) {
    const [updateUser, updateUserQuery] = useOperationAgent(updateUserOperation);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        try {
            await agent.initiate({ id: user.id, data: formData });
            alert('Пользователь обновлен');
        } catch (error) {
            alert('Ошибка при обновлении пользователя');
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <input name="name" defaultValue={user.name} />
            <input name="email" defaultValue={user.email} />
            <button type="submit" disabled={updateUserQuery.isLoading}>
                {updateUserQuery.isLoading ? 'Обновление...' : 'Обновить'}
            </button>
            {updateUserQuery.isError && <p>Ошибка: {updateUserQuery.error?.message}</p>}
        </form>
    );
}
```
