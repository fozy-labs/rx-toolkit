# React интеграция

RxToolkit предоставляет набор React хуков для эффективной интеграции с реактивными системами библиотеки. Все хуки оптимизированы для минимальных ре-рендеров и максимальной производительности.

## Основные хуки

### useSignal

Подписывается на изменения сигнала и возвращает текущее значение.

```tsx
import { Signal } from '@fozy-labs/rx-toolkit';
import { useSignal } from '@fozy-labs/rx-toolkit/react';

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
- Сигнал в состоянии ошибки (например, упавший `Computed`) бросает её при чтении в ближайший `ErrorBoundary`; после сброса boundary компонент работает как обычно

---

## Query хуки

### useResource

Подписывается на состояние ресурса и автоматически инициирует запрос при монтировании или изменении аргументов.

```tsx
import { SKIP } from '@fozy-labs/rx-toolkit';
import { useResource } from '@fozy-labs/rx-toolkit/react';
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
| `invalidate()`     | `(options?: { inFlight?: 'cancel' \| 'trail' \| 'join' }) => void` | Перезапросить показанное, сняв ошибку; `inFlight` — что делать с запросом в полёте, см. [инвалидацию в полёте](../../query/concepts/cache.md#инвалидация-в-полёте) |

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
| Ремонт после сброса `ErrorBoundary`        | Повторный запрос вместо повторного броска закэшированной ошибки: брошенная ошибка считается показанной, и запись ревалидируется при следующем удержании |

- Приостановившийся рендер запускает запрос сразу после себя, а не в эффекте: приостановленный рендер эффекты не выполняет, и fallback завис бы навсегда. Сам рендер запись кэша не создаёт и `queryFn` не вызывает.
- `SKIP` намеренно **не поддерживается**: компонент, который может приостановиться, всегда должен иметь аргументы. Для условных запросов используйте `useResource`.

### useResources

Несколько ресурсов в одном хуке: именованные слоты (объект) или массив привязанных ресурсов (`resource.bind(args)`). Слот может быть `SKIP`. Хук подписывается один раз при любом числе слотов, поэтому подходит и для массива динамической длины, где `useResource` в цикле вызвать нельзя.

```tsx
import { SKIP } from '@fozy-labs/rx-toolkit';
import { useResources } from '@fozy-labs/rx-toolkit/react';

function UserCard({ id, withStats }: { id: string; withStats: boolean }) {
    // объект — именованные слоты
    const card = useResources({
        user: userApi.getUser.bind({ id }),
        stats: withStats ? statsApi.getStats.bind({ id }) : SKIP,
    });

    card.states.user; // TResourceClutchState — состояние слота, как у useResource

    if (card.status === 'error') return <Error error={card.error} onRetry={card.retry} />;
    if (!card.hasData) return <Loader />;

    // card.data: { user: TUser; stats: TStats | null } — у SKIP-слота null
    return <Card user={card.data.user} stats={card.data.stats} />;
}

function Orders({ ids }: { ids: string[] }) {
    // массив — длина динамическая; литерал-кортеж [a, b] типизируется как кортеж
    const rows = useResources(ids.map((id) => orderApi.getOrder.bind({ id })));

    return rows.states.map((row, i) => <OrderRow key={ids[i]} state={row} />);
}
```

**Возвращаемое значение (`TResourcesState`):**

| Поле | Значение |
|------|----------|
| `states` | Состояние каждого слота в форме входа (объект или массив) — `TResourceClutchState`, как у `useResource`; у `SKIP`-слота — `idle` |
| `status` | Первое подходящее: `idle` — все слоты `SKIP`; `pending` — у какого-то слота запрос в полёте; `error` — какой-то слот упал; иначе `success` |
| `hasData` / `data` | Данные есть у каждого задействованного слота. `data` — в форме входа, у `SKIP`-слота `null`; иначе `data = null` |
| `isIdle` | Все слоты `SKIP` |
| `isPending`, `isInitialLoading`, `isSwitching`, `isInvalidating` | «Какой-то слот такой» — истинными могут быть несколько сразу |
| `hasError` / `error` | Первая ошибка в порядке слотов (ключи объекта, индексы массива) |
| `retry()` | Повторяет упавшие слоты |
| `invalidate(opts?)` | Инвалидирует каждый задействованный слот; слот, упавший без данных, перезапускается |

- `pending` проверяется раньше `error`: упавший слот рядом с загружающимся даёт `status = 'pending'` при `hasError = true` — как повтор запроса у одного ресурса.
- `[]` и `{}` сразу дают `status = 'success'`, `hasData = true`. Вход из одних `SKIP` — `idle`, как `useResource(resource, SKIP)`.
- `SKIP`-слот данные не блокирует: `hasData` смотрит только на задействованные слоты.
- `data` сохраняет ссылку, пока не изменились данные слотов, — `useMemo` поверх неё не пересчитывается зря. Опции `combine` нет: преобразуйте `data` сами.
- Именованный слот при смене args показывает данные прежних args, пока грузятся новые (SWR), как `useResource`. Слот массива — нет: индекс не идентичность, и строка `i` не должна показать данные другой строки. Слот, чьи ресурс и args уже были в наборе, переиспользуется без нового запроса — и при сдвиге индекса.
- Слоты с одинаковыми ресурсом и args делят одно сцепление и один запрос.

**`useResources` или проекционный ресурс.** Пересекаются, только когда все слоты читают один ресурс:

| | Проекционный ресурс | `useResources` |
|---|---|---|
| Когда | Есть batch-эндпоинт | Есть только эндпоинт на элемент, или слоты из разных ресурсов |
| Запросы | Один запрос только за недостающими id, общий кэш элементов | Запрос на слот |
| Состояние | Одно на весь набор: упал — упал весь набор | Своё у каждого слота: одна упавшая строка не убирает остальные |
| SWR при смене набора | Прежний набор целиком | Только у именованных слотов |

Проекционный ресурс — обычный `IResource`, поэтому `projection.bind(ids)` может быть одним слотом `useResources` рядом с другими ресурсами. См. [проекционные ресурсы](../../query/usage/projection-resource.md).

### useSuspenseResources

Suspense-вариант `useResources`. Все слоты стартуют в одном приостановленном рендере — без водопада: при нескольких `useSuspenseResource` подряд первый приостановившийся хук не даёт следующим даже начать запрос. Решение принимается по порядку:

1. у каждого слота есть что показать — возвращает состояние, `data` **гарантированно не `null`**;
2. какой-то слот упал и показать ему нечего — бросает первую такую ошибку в порядке слотов → `ErrorBoundary`, не дожидаясь остальных. Каждый такой слот помечается на ревалидацию, поэтому ремонт после сброса `ErrorBoundary` перезапрашивает его;
3. иначе приостанавливает рендер → `<Suspense fallback>`, пока не выполнится 1 или 2.

```tsx
function UserCard({ id }: { id: string }) {
    const { data } = useSuspenseResources({
        user: userApi.getUser.bind({ id }),
        stats: statsApi.getStats.bind({ id }),
    });

    return <Card user={data.user} stats={data.stats} />;
}
```

- `SKIP` **не принимается** — ни в типах, ни в рантайме (`TypeError`). Для условных слотов используйте `useResources`.
- Ожидание удерживает записи всех слотов, пока не дождётся последнего, — быстрый слот не вытесняется короткой `retentionTime`, пока грузится медленный.
- Как и у `useSuspenseResource`, фоновая инвалидация и ошибка за показанными данными рендер не приостанавливают: они приходят в состоянии.

**Возвращаемое значение (`TSuspenseResourcesState`):** `TResourcesState`, суженное до `hasData = true`; состояния слотов — `TSuspenseResourceState`.

### useCommand

Создаёт сцепление команды и возвращает кортеж `[trigger, state]`.

```tsx
import { useCommand } from '@fozy-labs/rx-toolkit/react';
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

## Хуки времени

### useDebouncedArgs

Задерживает аргументы запроса до паузы в их изменениях. Сырые объектные аргументы сравниваются по структурному ключу, а keyed-аргументы — по `.key`, поэтому создание `{ q }` при каждом рендере не перезапускает таймер:

```tsx
const [args, isDebouncing, flush] = useDebouncedArgs(search ? { q: search } : SKIP, { delay: 300 });
const state = useResource(searchResource, args);
```

| Опция   | Тип      | Значение по умолчанию | Назначение |
|---------|----------|-----------------------|------------|
| `delay` | `number` | —                     | Задержка в миллисекундах, неотрицательное конечное число |

Хук возвращает `[args, isDebouncing, flush]`. `SKIP` применяется сразу и отменяет ожидание; следующие за ним аргументы снова задерживаются. `flush()` немедленно применяет последние зафиксированные аргументы.

### useDebouncedValue

Применяет произвольное значение после паузы в изменениях:

```tsx
const [debouncedSearch, isDebouncing, flush] = useDebouncedValue(search, { delay: 300 });
```

| Опция       | Тип                       | Значение по умолчанию | Назначение |
|-------------|---------------------------|-----------------------|------------|
| `delay`     | `number`                  | —                     | Задержка в миллисекундах, неотрицательное конечное число |
| `equals`    | `(a: T, b: T) => boolean` | `Object.is`           | Сравнение значений |
| `immediate` | `(value: T) => boolean`   | —                     | Значения, которые применяются без задержки |

Хук возвращает `[value, isDebouncing, flush]`. При монтировании входное значение применяется сразу. Равное уже применённому значению отменяет таймер. Остальные изменения ждут `delay` миллисекунд; новое изменение перезапускает таймер, если оно не равно запланированному значению. `isDebouncing` показывает, отличается ли вход от применённого значения.

Значения с `immediate(value) === true` и все изменения при `delay: 0` применяются в том же рендере. `flush()` сразу применяет последний зафиксированный вход и отменяет таймер; функцию удобно вызывать, например, при нажатии Enter. Изменение `delay` не перезапускает уже идущий таймер. Для аргументов ресурса используйте [useDebouncedArgs](#usedebouncedargs). Для объектов задайте `equals`, если равные по содержимому значения должны считаться одинаковыми. Чтобы очистка применялась сразу, используйте `immediate: (v) => v === ""`. Во время набора `isDebouncing` помогает не показывать прежнее «По запросу “ab” ничего не найдено».

### useDelayedFlag

Задерживает показ булевого флага `active` и удерживает его включённым минимум заданное время. Это помогает избежать мигания индикаторов загрузки:

```tsx
const [showSkeleton, isDelaying] = useDelayedFlag(state.isInitialLoading && !state.hasError, { delay: 150, minDuration: 400 });
const [showSwitching] = useDelayedFlag(state.isSwitching, { delay: 150 });
```

| Опция         | Тип      | Значение по умолчанию | Назначение |
|---------------|----------|-----------------------|------------|
| `delay`       | `number` | —                     | Задержка показа флага в миллисекундах, неотрицательное конечное число |
| `minDuration` | `number` | `0`                   | Минимальное время показа с момента появления, неотрицательное конечное число |

Хук возвращает `[shown, isDelaying]`. При `active: false` выход становится `false` сразу, кроме времени удержания после показа. Если `active` снова становится `true` во время удержания, флаг включается сразу и таймер удержания отменяется.

| Фаза      | Поведение |
|-----------|-----------|
| `off`     | `shown` — `false`; `active: true` запускает ожидание (`delay: 0` включает флаг сразу) |
| `waiting` | `shown` — `false`; `active: false` отменяет ожидание |
| `on`      | `shown` — `true`; при `active: false` флаг скрывается после минимального времени |
| `holding` | `shown` остаётся `true` до конца минимального времени |

Во время `isDelaying` `active` может быть `true`, а `shown` — `false`: не показывайте в этот момент ветку пустого состояния. Значения `delay` и `minDuration` должны быть неотрицательными конечными числами; при изменении опций запущенные таймеры не перезапускаются.

---

## Формы

`unstable_formsReactPlugin()` добавляет определениям форм `useForm` и `useFormContext`, а инстансам — `<form.Provide>`; узлы формы читаются через `useSignal`. См. [Формы в React](../../form/react.md).

---

## Паттерны использования

### Store класс

```tsx
import { Signal } from '@fozy-labs/rx-toolkit';
import { useSignal } from '@fozy-labs/rx-toolkit/react';

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
    const dashboard = useResources({
        user: userResource.bind({ id: currentUserId }),
        settings: settingsResource.bind(),
    });

    if (dashboard.status === 'error') return <Error />;
    if (!dashboard.hasData) return <Loader />;

    return (
        <div>
            <UserInfo user={dashboard.data.user} />
            <Settings settings={dashboard.data.settings} />
        </div>
    );
}
```

См. [useResources](#useresources).
