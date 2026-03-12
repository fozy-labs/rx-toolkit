
# Query v2 RFC

Цель Query v2 — создать более чистую, предсказуемую и расширяемую архитектуру для загрузки данных, кеширования и синхронизации состояния.

## Motivation

Текущая реализация RxQuery развивалась постепенно и решила множество практических задач.
Однако со временем появились архитектурные ограничения, накопился технический долг, остались не закрытые проблемы:

1. Отсутствие надежной системы очистки кеша - текущая не сбрасывает состояние полностью.
2. Отсутствие группировки разныз API (ресурсов и комманд), для задачи им общих настроек, изоляции и одновременной очистки.
3. Сложности работы с внутренним API пакета, и его расширением.


## Api

Для решения этих проблем предлагается новая архитектура, которая будет включать, следующие публичное и внутреннее API:

1. `createApi` - функция для создания API (группы русурсов, а в дольнейшем и операций), возвращает объект с методом `createResource` 
2. `ResourceV2` - полностью переработанный
3. `ResourceV2HooksManager` - управляет хуками
4. `IResourceV2Hook` - интерфейс для хуков
5. `Devtools.createResourceV2Hooks` - метод создания хуков для Devtools интеграции
6. `TResourceV2Cache` - union тип всех возсожных кешей, его сотояний и возможных методов (те полностью типизированый конечный автомат)
7. `TResourceV2CacheState` - union тип всех возможных состояний кеша
8. `TResourceV2Definition` - тип для передачи свойств ресурса
9. `TApiQueryErrorContext` - union тип для обработки ошибки (пока только type: 'resource')

## Примеры

### Пример создания API используя публичное API пакета:

```ts
const mainApi = createApi({
    keyPrefix: 'main',
    onQueryError(ctx) {
        // ...
    }
});

// ===

import { mainContracts } from '@/my-shared/contracts';

const getUserById = mainApi.createResource({
    queryFn: mainContracts.fetchUserById,
    key: 'getUserById',
});

```


### Strong typing

Важно, сохрнить сильные стороны текущей реализации, в том числе сильную типизацию:

```ts
const mainApi = createApi({
    plugin: [new ReactHooksPlugin()] // Новое: Модифицируем типы, добавлям хуки в русурс
});

const getUserById = mainApi.createResource({
    queryFn: mainContracts.fetchUserById, // Тип getUserById определится автоматически
});


// ===

const userQuery = getUserById.useQuery(userId ?? SKIP_TOKEN) // Типипизция допускает передачу только userId и SKIP_TOKEN
```

### Пример вне фреймворка:


```ts

// Используем агента
class UserStore {
    private getUserByIdAgent = getUserById.createAgent();
    selectedUserId$ = Signal.compute(() => this.getUserByIdAgent.state$().args);

    selectedUser$ = Signal.compute(() => this.getUserByIdAgent.state$().data);
    
    selectUserId(userId: number) {
        this.getUserByIdAgent.start(userId);
    }
}


// Или используем "query select"

class UserStore {
    private getUserByIdAgent = getUserById.createAgent();
    selectedUserId$ = Signal.state<number | null>(null);

    selectedUser$ = Signal.compute<User | null>(() => {
        return this.getUserByIdAgent.query$(this.selectedUserId$() ?? SKIP_TOKEN).data;
    });

    selectUserId(userId: number) {
        this.selectedUserId$.set(userId);
    }
}
```

Разница между `start` и `query$`:
1) `start` устанавливает fresh аргументы, напрямую и возвращает промис
2) `query$` тоже устанавливает fresh аргументы, но `query$` - это сигнал, он возращает текущее состояние запроса.

Прямой доступ к ResourceV2 vs agent:
1) Agent может хранить fresh и stale аргументы.
2) Agent реализует Stale-While-Revalidate стратегию, позволяя получать не актуальные данные, пока новые загружаются.
3) Agent предоставляет более удобное API.


### Пример опций createApi

```ts
const mainApi = createApi({
    keyPrefix: 'main', // Префикс ключа
    mode: 'serialize', // Режим хранения хранения и сравнения кеша
    serializeFn: (args) => fastJson(args), // Функция сериализации аргументов
    compareFn: (a, b) => Object.is(a, b), // Функция сравнения аргументов
    onQueryError({ type, payload }) { /*...*/ }, // Хук ошибки
});

mainApi.resetAll(); // Сбросить все состояние
mainApi.createResource(/*...*/) // Содать ресурс
```


## Внутрянка

### Как 

```ts
type TResourceV2Machine<D extends ResourceV2Definition> =
    (MachineIdleMethods<D> & { state: TResourceV2IdleState, status: 'idle' })
    | (MachinePendingMethods<D> & { state: TResourceV2PendingState, status: 'pending' })
    | (MachineSuccessMethods<D> & { state: TResourceV2SuccessState<D>, status: 'success' })
    | (MachineErrorMethods<D> & { state: TResourceV2ErrorState, status: 'error' })
    | (MachineRefreshingMethods<D> & { state: TResourceV2RefreshingState<D>, status: 'refreshing' })
    | (MachineRetryingMethods<D> & { state: TResourceV2RetryingState, status: 'retrying' })

// Или, если нам нужно будет работать с определенным состоянием машины отдлено, можно определеть их так:

type TResourceV2Machine<D extends ResourceV2Definition> =
    TResourceV2MachineIdle<D>
    | TResourceV2MachinePending<D>
    | TResourceV2MachineSuccess<D>
    | TResourceV2MachineError<D>
    | TResourceV2MachineRefreshing<D>
    | TResourceV2MachineRetrying<D>

type TResourceV2MachineIdle = MachineIdleMethods<D> & { state: TResourceV2IdleState, status: 'idle' };
// и тд
```
