
# Query v2 RFC

Цель Query v2 — создать более чистую, предсказуемую и расширяемую архитектуру для загрузки данных, кеширования и синхронизации состояния.

Для этого мы в экспериментальном виде реализуем "Api" и "ResourceV2".

## Motivation

Есть проблемы, нужно их решить:

1. Сложности работы с внутренним API пакета, и его расширением.
2. Отсутствие надежной системы очистки кеша - текущая не сбрасывает состояние полностью.
3. Отсутствие возможности группировки разных API (ресурсов и комманд), для передачи им общих настроек, изоляции и одновременной очистки.
4. Нет поддержки SSR
5. Нет возможности легко синхронизировать состояние разных вкладок браузера

## New package API

### createApi

`createApi` - это новая, никак не зависящая от старых реализаций, функция для создания группы ресурсов (в дальнейшем и операций).

| Опция             | Тип                                      | По умолчанию      | Режим         | Описание                                                                                                                                             |
|-------------------|------------------------------------------|-------------------|---------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `keyPrefix`       | `string` \| `null` \| `undefined`        | null              |               | Префикс для ключей ресурсов                                                                                                                          |
| `keyStrategy`     | `'serialize'` \| `'compare`              | `'serialize'`     |               | Режим хранения и сравнения кеша.  `serialize` хранит ключ кеша в виде строки. `compare` это старый способо, когда ключем являлось значние аргументов |
| `serializeArgs`   | `TSerializeArgsFn`                       | `stableStringify` | `'serialize'` | Функция для сериализации аргументов в строку.                                                                                                        |
| `compareArg`      | `TCompareArgsFn`                         | `shallowEqual`    | `compare`     | Функция для сравнения аргументов.                                                                                                                    |
| `initialSnapshot` | `TApiSnapshot`  \| `null` \| `undefined` | null              | `'serialize'` | Снимок для инициализации API с набором данных.                                                                                                       |
| `cacheLifetime`   | `number`                                 | 60_000            |               | Время жизни кеша в миллисекундах. После истечения этого времени, кеш будет считаться устаревшим.                                                     |
| `plugins`         | `TApiPlugin[]`                           | []                |               | Массив плагинов для расширения функциональности API.                                                                                                 |

| Свойство              | Тип                  | Описание                                                                                       |
|-----------------------|----------------------|------------------------------------------------------------------------------------------------|
| `resetAll()`          | `() => void`         | Метод для сброса всего состояния API.                                                          |
| `createResource(...)` | `TCreateResourceFn`  | Метод для создания ресурса. Принимает определение ресурса и возвращает экземпляр `ResourceV2`. |
| `getSnapshot()`       | `() => TApiSnapshot` | Метод для получения снимка текущего состояния API.                                             |

### api.createResource

`api.createResource` - это метод для создания ресурса (`ResourceV2`).

| Опция                | Тип                            | По умолчанию                           | Описание                                                                                    |
|----------------------|--------------------------------|----------------------------------------|---------------------------------------------------------------------------------------------|
| `key`                | `string`                       | Обязятелен для `'serialize'` стратегии | Уникальный ключ ресурса. Использует для логирования в девтулс.                              |
| `queryFn`            | `TQueryFn`                     | Обязателен                             | Функция для выполнения запроса. Должна возвращать промис.                                   |
| `onCacheEntryAdded`  | `TResourceOnCacheEntryAddedFn` |                                        | Хук, который вызывается при добавлении новой записи в кеш.                                  |
| `onQueryStarted`     | `TResourceOnQueryStartedFn`    |                                        | Хук, который вызывается при запуске запроса.                                                |
| `serializeArgs`      | `TSerializeArgsFn`             | createApi опция (stableStringify)      | Функция для сериализации аргументов в строку.                                               |
| `compareArg`         | `TCompareArgsFn`               | createApi опция (shallowEqual)         | Функция для сравнения аргументов.                                                           |
| `cacheLifetime`      | `number`                       | createApi опция (60_000)               | Время жизни кеша для этого ресурса в миллисекундах.                                         |
| `beforeDevtoolsPush` | `TBeforeDevtoolsPushFn`        |                                        | Хук, который вызывается перед отправкой данных в Devtools. Позволяет модифицировать данные. |

| Свойство             | Тип                        | Описание                                                                           |
|----------------------|----------------------------|------------------------------------------------------------------------------------|
| `createAgent()`      | `CreateResourceV2AgentFn`  | Метод для создания агента ресурса, который позволяет управлять состоянием ресурса. |
| `query(args, forse)` | `TResourveV2QueryFn`       | Метод для выполнения запроса с заданными аргументами. Возвращает промис.           |
| `query$(args)`       | `TResourveV2QuerySignalFn` | Метод для получения сигнала состояния запроса с заданными аргументами.             |


С react плагином:

| Свойство            | Тип              | Описание                                                                                                                  |
|---------------------|------------------|---------------------------------------------------------------------------------------------------------------------------|
| `useResource(args)` | `TUseResourceV2` | Хук для выполнения запроса с заданными аргументами. Возвращает массив с состоянием запроса и функцией для его обновления. |


### TApiSnapshot

`TApiSnapshot` - это тип, представляет сериализуемый снимок состояния API, 
который может быть использован для инициализации состояния с предопределенным набором данных (например для дегидрации/гидрации).
Для гарантии совместимости содержит в себе текущую версию формата снапшотом.

### TResourveV2QueryFn

```ts
type TResourveV2QueryFn = <D extends TResourceV2Definition>(
    args: D['queryFnArgs'],
    force: boolean
) => TResourceV2Cache
```

## Naming Convention

- Все interface и type начинаются с `I` или `T`
- Все что непосредственно относится к ResourceV2, должно содежраь в названии `ResourceV2`, чтобы не путать с текущей реализацией.

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
    plugins: [new ReactHooksPlugin()] // Новое: Модифицируем типы, добавлям хуки в русурс
});

const getUserById = mainApi.createResource({
    queryFn: mainContracts.fetchUserById, // Тип getUserById определится автоматически
});


// ===

const userQuery = getUserById.useResource(userId ?? SKIP) // Типипизция допускает передачу только userId и SKIP
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
        if (!this.selectedUserId$()) return null;
        return this.getUserByIdAgent.query$(this.selectedUserId$()).data;
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
    onQueryError({ type, payload }) { /*...*/ }, // Хук ошибки
    snapshot: JSON.parse(hydrateData.mainApiSnapshot), // Снимок для инициализации API с набором данных
});

mainApi.resetAll(); // Сбросить все состояние
mainApi.createResource(/*...*/) // Содать ресурс
mainApi.snapshot(); // Получить снимок текущего состояния API
```


## Внутрянка

### Как кеш (state machine) типизируется:

```ts
type TResourceV2Machine<D extends ResourceV2Definition> =
    MachinePanding<D>
    | MachineIdle<D> //...

class MachineIdle<D extends ResourceV2Definition> {
    state: TResourceV2IdleState;
    
    constructor(state: TResourceV2IdleState) {
        this.state = state;
    }
    
    start(args: D['queryFnArgs']) {
        return new MachinePending({
            status: 'pending',
            args,
            error: null,
            data: null,
            updatedAt: null,
        });
    }
    
    /* другие методы, которые могут понадобиться для idle состояния */

    static create() {
        return new MachineIdle({
            status: 'idle',
            args: null,
            error: null,
            data: null,
            updatedAt: null,
        });
    }
}

class MachinePending<D extends ResourceV2Definition> {
    state: TResourceV2PendingState;
    
    constructor(state: TResourceV2PendingState) {
        this.state = state;
    }
    
    errorHappened(error: Error) {
        return new MachineError({
            status: 'error',
            args: this.state.args,
            error,
            data: null,
            updatedAt: null,
        });
    }
    
    successHappened(data: D['queryFnReturn']) {
        return new MachineSuccess({
            status: 'success',
            args: this.state.args,
            error: null,
            data,
            updatedAt: Date.now(),
        });
    }
    
    /* другие методы, которые могут понадобиться для pending состояния */
    
    static create(args: D['queryFnArgs']) {
        return new MachinePending({
            status: 'pending',
            args,
            error: null,
            data: null,
            updatedAt: null,
        });
    }
}

// ...
```
