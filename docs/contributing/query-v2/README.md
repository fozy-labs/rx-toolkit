
# Query v2 RFC

Цель Query v2 — создать более чистую, предсказуемую и расширяемую архитектуру для загрузки данных и кеширования.

Для этого мы в экспериментальном виде реализуем "Api" и "ResourceV2".

## Motivation

Есть проблемы, нужно их решить:

1. Сложности работы с внутренним API пакета, и его расширением.
2. Отсутствие надежной системы очистки кеша - текущая не сбрасывает состояние полностью.
3. Отсутствие возможности группировки разных API (ресурсов и комманд), для передачи им общих настроек, изоляции и одновременной очистки.
4. Нет поддержки SSR

## New package API

### createApi

`createApi` - это новая, никак не зависящая от старых реализаций, функция для создания группы ресурсов (в дальнейшем и операций).

| Опция                | Тип                                      | По умолчанию      | Режим         | Описание                                                                                                                                             |
|----------------------|------------------------------------------|-------------------|---------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `keyPrefix`          | `string` \| `null` \| `undefined`        | null              |               | Префикс для ключей ресурсов                                                                                                                          |
| `keyStrategy`        | `'serialize'` \| `'compare`              | `'serialize'`     |               | Режим хранения и сравнения кеша.  `serialize` хранит ключ кеша в виде строки. `compare` это старый способо, когда ключем являлось значние аргументов |
| `serializeArgs`      | `TSerializeArgsFn`                       | `stableStringify` | `'serialize'` | Функция для сериализации аргументов в строку.                                                                                                        |
| `compareArg`         | `TCompareArgsFn`                         | `shallowEqual`    | `compare`     | Функция для сравнения аргументов.                                                                                                                    |
| `initialSnapshot`    | `TApiSnapshot`  \| `null` \| `undefined` | null              | `'serialize'` | Снимок для инициализации API с набором данных.                                                                                                       |
| `cacheLifetime`      | `number`                                 | 120_000           |               | Время жизни кеша в миллисекундах. После истечения этого времени, кеш будет считаться устаревшим.                                                     |
| `plugins`            | `TApiPlugin[]`                           | []                |               | Массив плагинов для расширения функциональности API.                                                                                                 |
| `maxSnapshotDataAge` | `number`                                 | 5_000             | `'serialize'` | От какого возраста данных в спашноте необходима инвалидация.                                                                                         |
| `doCacheArgs`        | `boolean`                                | false             | `serialize`   | Кешировать ли результат сериализации аргументов.                                                                                                     |

| Свойство              | Тип                  | Описание                                                                                       |
|-----------------------|----------------------|------------------------------------------------------------------------------------------------|
| `resetAll()`          | `() => void`         | Метод для сброса всего состояния API.                                                          |
| `createResource(...)` | `TCreateResourceFn`  | Метод для создания ресурса. Принимает определение ресурса и возвращает экземпляр `ResourceV2`. |
| `getSnapshot()`       | `() => TApiSnapshot` | Метод для получения снимка текущего состояния API.                                             |

### api.createResource

`api.createResource` - это метод для создания ресурса (`ResourceV2`).

| Опция                | Тип                            | По умолчанию                           | Описание                                                                                                                     |
|----------------------|--------------------------------|----------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `key`                | `string`                       | Обязятелен для `'serialize'` стратегии | Уникальный ключ ресурса. Использует для логирования в девтулс. Если указан, то будет проверятся на уникальнось в рамках api. |
| `queryFn`            | `TQueryFn`                     | Обязателен                             | Функция для выполнения запроса. Должна возвращать промис.                                                                    |
| `onCacheEntryAdded`  | `TResourceOnCacheEntryAddedFn` |                                        | Хук, который вызывается при добавлении новой записи в кеш.                                                                   |
| `onQueryStarted`     | `TResourceOnQueryStartedFn`    |                                        | Хук, который вызывается при запуске запроса.                                                                                 |
| `serializeArgs`      | `TSerializeArgsFn`             | createApi опция (stableStringify)      | Функция для сериализации аргументов в строку.                                                                                |
| `compareArg`         | `TCompareArgsFn`               | createApi опция (shallowEqual)         | Функция для сравнения аргументов.                                                                                            |
| `cacheLifetime`      | `number`                       | createApi опция (60_000)               | Время жизни кеша для этого ресурса в миллисекундах.                                                                          |
| `beforeDevtoolsPush` | `TBeforeDevtoolsPushFn`        |                                        | Хук, который вызывается перед отправкой данных в Devtools. Позволяет модифицировать данные.                                  |
| `maxSnapshotDataAge` | `number`                       | createApi опция (5_000)                | От какого возраста данных в спашноте необходима инвалидация.                                                                 |
| `doCacheArgs`        | `boolean`                      | createApi опция (false)                | Кешировать ли результат сериализации аргументов.                                                                             |

| Свойство                   | Тип                           | Описание                                                                           |
|----------------------------|-------------------------------|------------------------------------------------------------------------------------|
| `createAgent()`            | `CreateResourceV2AgentFn`     | Метод для создания агента ресурса, который позволяет управлять состоянием ресурса. |
| `query(args, doForse)`     | `TResourveV2QueryFn`          | Метод для выполнения запроса с заданными аргументами. Возвращает промис.           |
| `query$(args, doForse)`    | `TResourveV2QuerySignalFn`    | Метод для получения сигнала состояния запроса с заданными аргументами.             |
| `entry(args, doInitiate)`  | `TGetResourceV2EntryFn`       | Метод для получения объекта кеша.                                                  | 
| `entry$(args, doInitiate)` | `TGetResourceV2EntrySignalFn` | Метод для получения сигнала объекта кеша.                                          |


С react плагином:

| Свойство            | Тип              | Описание                                                                                                                  |
|---------------------|------------------|---------------------------------------------------------------------------------------------------------------------------|
| `useResource(args)` | `TUseResourceV2` | Хук для выполнения запроса с заданными аргументами. Возвращает массив с состоянием запроса и функцией для его обновления. |


### TApiSnapshot

`TApiSnapshot` - это тип, представляет сериализуемый снимок состояния API, 
который может быть использован для инициализации состояния с предопределенным набором данных (например для дегидрации/гидрации).
Для гарантии совместимости содержит в себе текущую версию формата, `keyPrefix` и тип.

### TResourveV2QueryFn

```ts
type TResourveV2QueryFn = <D extends TResourceV2Definition>(
    args: D['queryFnArgs'],
    force: boolean
) => TResourceV2Cache
```

### ICacheEntry
`ICacheEntry` - представляет собой реактивную единицу кеша, хранит Machine.


## Махиники

### Machine
`Machine` - это класс, который хранит state и инкапсулирует логику управление state. `Machine` содержит методы для перехода к другим `Machine`.

### Patch'es

`Patch` - это абстрактное представление изменений, которые могут быть применены к данным ресурса.
Патчи позволяют реализовать оптимистичные обновления.
В отличие от некоторых других реализаций, патчи в ResourceV2 (как и в V1), защищены от ряда race conditions, благодаря `originalData`.

```
// Все валидные committed - пропускаем и убираем из очереди
// Все aborted - применяем и убираем из очереди
// Все pending - применяем и оставляем в очереди
// Все commited (которые после pending) - применяем, но оставляем в очереди
// Все aborted (которые после pending) - откатываем, но оставляем в очереди
// Если после aborted нет pending - пропускаем и убираем из очереди
// Те после применения всех транзакций, очередь должна начинаться с первой pending транзакции (если есть), включая все, что после неё.
// (Подробнее в коде V1) (у V1 проблема: если race conditions все же происходит, то patch "зависает")
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
mainApi.getSnapshot(); // Получить снимок текущего состояния API
```


## Внутрянка

### Как кеш (state machine) типизируется:

```ts
type TMachine<ARGS, DATA> =
    MachinePanding<ARGS, DATA>
    | MachineIdle<ARGS, DATA> //...

class MachineIdle<ARGS, DATA> {
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

class MachinePending<ARGS, DATA> {
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
    
    successHappened(data: DATA) {
        return new MachineSuccess({
            status: 'success',
            args: this.state.args,
            error: null,
            data,
            updatedAt: Date.now(),
        });
    }
    
    /* другие методы, которые могут понадобиться для pending состояния */
    
    static create(args: ARGS) {
        return new MachinePending({
            status: 'pending',
            args,
            originalData: NO_VALUE,
        });
    }
}

// Лучше, чтобы MachineSuccess и MachineRefreshing наследовались от общего класса (чтобы не дублировать код связанный с патчами)
class MachineSuccess<ARGS, DATA> {
    state: TResourceV2SuccessState;

    constructor(state: TResourceV2SuccessState) {
        this.state = state;
    }

    invalidate() {
        return new MachineRefreshing({
            status: 'refreshing',
            args: this.state.args,
            data: this.state.data,
            updatedAt: this.state.updatedAt,
        });
    }

    addPatch(patch: TResourceV2Patch) {
        const originalData = this.state.originalData === NO_VALUE
            ? this.state.data
            : this.state.originalData;
        
        const patches = (this.state.patches ?? []).concat(tr);
        
        return new MachineSuccess({
            status: 'success',
            args: this.state.args,
            data: Patcher.resolvePatches(originalData, patches),
            updatedAt: Date.now(),
            originalData,
            patches,
        });
    }
    
    finishPatch(type: 'commit' | 'abort', patch: TResourceV2Patch) {
        const { originalData, patches } = Patcher.finishPatch(
            this.state.originalData,
            this.state.patches,
            type,
            patch
        );
        
        const machine = new MachineSuccess({
            status: 'success',
            args: this.state.args,
            data: !!originalData?.length 
                ? Patcher.resolvePatches(originalData, patches) 
                : originalData,
            updatedAt: Date.now(),
            originalData,
            patches,
        });
    }
    
    createPatch(patchFn: TPatchFn<D['queryFnReturn']>) {
        const patch = Patcher.createPatch(patchFn, this.state.data);
        
        const state = this.addPatch(patch);
        
        return { state, patch };
    }

    /* другие методы, которые могут понадобиться для pending состояния */

    static deploy(snapshotSlice: TResourceV2SnapshotSlice<D>) {
        return new MachineSuccess({
            status: 'success',
            args: snapshotSlice.args,
            data: snapshotSlice.data,
            updatedAt: snapshotSlice.updatedAt,
        });
    }
    
}


// ...
```
