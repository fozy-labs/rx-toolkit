# CHANGELOG


## [Unreleased]


## [0.11.1] - 2026-08-17

[Гайд по миграции с 0.10.x](./migrations/0.11.0.md)

### Changed
- `ensure` / `fetch` / `prefetch` **стабилизированы**. `prefetch` получил опции `{ force?: boolean }`.
- Обновлён формат хранения `LocalSignal`.
- `Resource.getEntry(args, true)` типизируется как `IQueryCacheEntry` без `| null` — перегрузка, аналогичная `getEntry$`.

### Added
- **`Signal.from(source, options?)`** — read-only сигнал над RxJS Observable с общей (shared) подпиской на источник и replay-кешем. Заменяет `signalize()`.
- **Автоочистка `LocalSignal`**.

### Deprecated
- **`Command.trigger`** — переименован в **`Command.execute`** (контракт идентичен: сырой промис, реджектится, `mapError`).
- **`Resource.trigger`** — используйте **`prefetch`**: `trigger(args)` ≈ `prefetch(args)`, `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Отличие: на записи в состоянии `error` `prefetch` в обоих режимах делает ретрай, а `trigger` её не трогал. Детали — в [гайде по миграции](./migrations/0.11.0.md).
- **`signalize`** — используйте `Signal.from`; точный эквивалент старого поведения — `Signal.from(obs, { keepAlive: 'none' })`.

### Removed
- `getDevtoolsKey` — опция ресурса удалена как нерабочая: она никогда не читалась.

### Fixed
- Повреждённый соседний слот (значение другого пользователя) в `LocalSignal` ломал чтение: валидация покрывала весь рекорд, и валидный слот тоже откатывался к `defaultValue`, а `set()` поверх повреждённого рекорда молча стирал слоты всех остальных пользователей. Слоты изолированы по отдельным ключам; битая запись чинит только себя (self-heal) и не задевает соседей.
- Убрана гонка read-modify-write между вкладками в `LocalSignal`: две вкладки, писавшие разные слоты одного `key`, затирали общий рекорд друг друга целиком. Запись слота теперь — один атомарный `setItem`.
- Документация query приведена в соответствие с кодом: сигнатуры, семантика `refresh` / SWR / гидрации снапшотом, недостающие члены и опции.


## [0.10.2] - 2026-07-09

### Added
- **Типизация ошибок (`mapError`)** — опция уровня API `createApi({ mapError })` нормализует любую сырую ошибку в единый тип. Поле `error` во всех состояниях ресурсов и команд типизируется как возвращаемое значение `mapError` вместо `unknown`; См. [Типизация ошибок](./query/api/README.md#типизация-ошибок-maperror). Через `mapError` проходят и ошибки жизненного цикла мутаций: `CacheEntryRemovedError` при удалении незавершённой записи (повторный `trigger` с тем же ключом, `reset()` / `resetAll()`) попадает в реджект `Command.trigger` и конверт `TTriggerResult` уже нормализованным — типизация `TError` не нарушается; класс экспортируется публично. Сырыми (до `mapError`) остаются аборты и `$queryFulfilled` в lifecycle-хуках.
- **Дискриминированные состояния** — `TResourceAgentState`, `TCommandAgentState`, `TSuspenseResourceState` и результат `getState()` стали дискриминированными объединениями: `status` и все булевые флаги — литералы каждого варианта.

### Fixed
- Синхронный throw из не-async `queryFn` ресурса ломал контракт: на холодной записи исключение вылетало из `trigger()` / `ensure()` / `fetch()` синхронно и запись не создавалась, а при `refresh()` / `retry()` машина навсегда застревала в `refreshing` / `pending`. Теперь ошибка проходит через машину состояний как обычный провал запроса: запись создаётся и переходит в `error` / `refresh-error`, промисы штатно реджектятся, `mapError` применяется.
- Бросок в `optimisticUpdate` обходил машину состояний команды: `trigger` реджектился, но кэш-запись не создавалась, и наблюдатели состояния (`useCommand`, агент) не видели ошибку. Теперь оптимистичные патчи применяются внутри запуска записи: ошибка переводит машину в `error`, видна наблюдателям и нормализуется `mapError` на общей границе `machine.fail()`, как любой другой провал мутации.


## [0.10.1] - 2026-07-07

### Added
- **`unstable_KeyedSignal` (experimental)** — реактивная keyed-коллекция с точечной подпиской по ключу. См. [RxSignals](./signals/README.md#unstable_keyedsignal-экспериментально).
- **`unstable_ProxySignal` (experimental)** — глубокий реактивный стор с подпиской по пути. См. [RxSignals](./signals/README.md#unstable_proxysignal-экспериментально).

### Fixed
- `useSignal` мог навсегда «залипнуть» на устаревшем значении в concurrent-режиме (прерванный `startTransition`, Suspense): обновление терялось, компонент не перерисовывался. Теперь изменение всегда доходит до подписчика.
- Исключение в колбэке `Signal.effect` могло нарушить реактивность и приводило к утечке подписок при последующих чтениях сигнала. Теперь упавший эффект корректно отписывается и пробрасывает ошибку, не задевая остальные сигналы.
- `dispose()` или отписка `Signal.compute` / эффекта внутри батча не всегда останавливала его — оставалась утечка подписок от запланированного перезапуска. Закрытый эффект больше не перезапускается.
- Эффект мог выполниться дважды за один батч или сработать раньше своих `computed`-зависимостей, увидев рассогласованный снимок значений (glitch). Исправлено.
- Исключение внутри батча (например, упавший `effect`) не очищало очередь: недовыполненные реакции протекали в следующий несвязанный батч. Теперь состояние батча полностью сбрасывается и при ошибке.
- `LocalState` больше не падает на битом JSON в хранилище (обрезка при переполнении quota, ручная правка, запись от старой версии): значение откатывается к `defaultValue`, а `set()` / `update()` / `clear()` продолжают работать.
- `LocalState` больше не ломает импорт библиотеки в песочном iframe (`sandbox` без `allow-same-origin`) или при отключённом хранилище — доступ к `localStorage` бросал `SecurityError` уже при загрузке модуля. Драйвер по умолчанию безопасно откатывается к `null`.
- `LocalState.clear()` не удалял из хранилища falsy-значения (`0` / `""` / `false` / `null`) — запись оставалась, и значение «воскресало» после перезагрузки. Теперь запись удаляется независимо от её значения.
- Кросс-табовая синхронизация фактически не работала: каждая холодная запись в других вкладках ждала полный таймаут (150 мс) и всё равно шла в сеть, т.к. вкладка-владелец не отвечала. Теперь ответ приходит сразу, без лишнего запроса.
- `ensure()` / `fetch()` / `prefetch()` на ресурсе с `sync: true` мгновенно реджектились `CacheEntryRemovedError` на холодной записи (а `prefetch` резолвился, не прогрев кэш). Теперь они корректно ждут результат.
- Ресурс, гидрированный из снапшота с устаревшими данными (`isStale: true`), навсегда зависал в статусе `refreshing` — фоновое SWR-обновление не запускалось. Теперь refresh стартует автоматически, а `fetch()` на такой записи резолвится.
- `Command.trigger()` с дефолтным `retentionTime: 0` и без наблюдателей больше не реджектится `CacheEntryRemovedError` до ответа сервера — запись удерживается живой до завершения мутации.
- Долгоживущий lifecycle-хук уровня API (ожидающий `$cacheEntryRemoved` / `$queryFulfilled`) блокировал одноимённый хук уровня ресурса/команды — тот не запускался или стартовал слишком поздно. Теперь хуки обоих уровней стартуют одновременно.
- Упавший запрос давал глобальный `unhandledrejection`, если хук `onQueryStarted` не обращался к `$queryFulfilled`; то же — на каждой упавшей мутации `Command.trigger()`. Больше не течёт; сам `$queryFulfilled` реджектится как прежде.
- Кэш-запись, удалённая (`reset()` / retention GC) во время кросс-табового запроса, могла ожить — лишний сетевой запрос и `unhandledrejection`. Теперь продолжение прерывается, если запись уже завершена.
- `Resource.getEntry$` / `Command.getEntry$` не реагировали на удаление «непоследней» кэш-записи — наблюдатель залипал на завершённой записи и падал при следующем чтении (задевало `retry()` / `refresh()` / `set()`). Теперь наблюдатели корректно переходят на `null`.
- `getSnapshot()` сохранял неподтверждённые оптимистичные патчи как серверные данные: снапшот во время незавершённой мутации при гидрации принимался за подтверждённый — даже если мутация откатывалась. Теперь в снапшот идёт подтверждённая база.
- `ResourceAgent` мог отправить запрос по устаревшим аргументам: при вытеснении записи из кэша и смене аргументов (`set` / `SKIP`) в том же тике он запускал fetch для больше не отслеживаемых аргументов. Теперь запрос уходит только по актуальным аргументам.
- Запись в состоянии `refresh-error` (успешный fetch, который затем не смог обновиться) молча отбрасывалась при гидрации снапшота — последние валидные данные терялись. Теперь она гидрируется как устаревшие данные: кэш показывается сразу, refetch форсируется.
- `State` с lifecycle-хуками (devtools или пользовательскими) после явного `dispose()` мог позже повторно получить `onDispose` от сборщика мусора — лишний `$COMPLETED` в devtools, двойное освобождение ресурсов. Теперь `dispose()` снимает финализатор, и GC его не перезапускает.
- `Command.trigger()` с несколькими optimistic-ссылками: если `optimisticUpdate` одной бросал, уже применённые патчи остальных не откатывались (на ресурсах висел `pending`-патч), а `trigger` бросал синхронно. Теперь патчи откатываются, а `trigger` возвращает реджектнутый промис.
- `Resource.getState()` для записи в состоянии `refresh-error` рассогласовывал флаги с агентом: возвращал `isLoading: true` / `isError: false`, хотя обновление уже упало и на руках устаревшие данные. Теперь при `isRefreshError: true` отдаёт `isLoading: false` / `isError: true`.
- `State.set()` дедуплицировал через `===`: повторная установка `NaN` давала лишний emit подписчикам, а реальная смена `+0` → `-0` молча терялась. Теперь дедупликация идёт через `Object.is` — согласованно с остальным движком реактивности.
- `Computed` дедуплицировал выходной поток (`obs`) через `===` в обход фикса `State.set`: `Computed(() => NaN)` эмитил начальное значение дважды, а смена `+0` → `-0` терялась. Теперь сравнение идёт через `Object.is`.
- `Computed.dispose()` не освобождал внутренний `State`: `BehaviorSubject` не завершался, а записи в `FinalizationRegistry` и devtools удерживались до сборки мусора. Теперь внутренний `State` диспозится сразу.
- Сигнал с отфильтрованным начальным значением, диспозенный до появления реального значения, порождал в devtools призрачную запись со статусом `$COMPLETED`. Теперь маркер завершения не создаёт запись, если её ещё не было.
- `shallowEqual` (дефолтный `compareArgs`) сравнивал значения через `===`: объекты с `NaN` под одним ключом считались разными, и одинаковые аргументы выглядели изменившимися. Теперь сравнение идёт через `Object.is`.
- `Batcher` терял задачи, запланированные во время флаша ранга `Infinity` (например devtools-флаш, вызвавший `State.set`) — реакции молча пропадали. Теперь после `Infinity`-задач очередь перепроверяется, как в основном цикле.
- Флаш `Batcher` переведён с рекурсии на итерацию: глубокая цепочка зависимостей больше не переполняет стек вызовов при распространении изменений.
- `reduxDevtools()` без явного `driver` падал `ReferenceError: window is not defined` в SSR / Node. Теперь доступ к `window` защищён проверкой `typeof`: при его отсутствии бросается штатная ошибка «Redux Devtools extension is not installed».
- `deepEqual` теперь корректно сравнивает `NaN`, `Date`, `RegExp`, `Map`, `Set` и структуры с циклическими ссылками, а также различает массивы и обычные объекты.

### Changed
- Примитивы ожидания кэш-записи (`whenLoaded`, `whenFetched`, `whenFirstLoaded`, `currentResult`) переведены на механизм переходов машины состояний: ожидать теперь можно любую живую запись в любой момент. Уточнение семантики: при consistency violation после rebase `whenFetched` дожидается консистентного результата refresh.
- Чтение сигналов (`State`, `Computed`, `SourceSignal`) больше не аллоцирует объект-запись зависимости на каждый `get()` — меньше нагрузка на GC и заметно быстрее распространение изменений по графу (≈ −8% на синтетическом бенчмарке).


## [0.10.0] - 2026-07-03

[Гайд по миграции с 0.9.x](./migrations/0.10.0.md)

### Changed
- 💥 **Breaking.** `trigger` на уровне агента и хука (`CommandAgent.trigger`, `useCommand`) теперь возвращает `TTriggerPromise<TData>` — промис, который **не реджектится**, а резолвится конвертом `TTriggerResult<TData>`: `{ status: "success", data }` либо `{ status: "error", error }`. Для «бросающей» семантики (как раньше) у промиса есть метод `.unwrap(): Promise<TData>`. Обработка ошибок через `try/catch` вокруг `await trigger(...)` больше не срабатывает — используйте проверку `result.status` либо `.unwrap()`. См. [CommandAgent API](./query/api/command-agent.md#результат-trigger).
- `Command.trigger` (уровень ядра) не изменился — по-прежнему возвращает сырой `Promise<TData>`, реджектящийся ошибкой.

### Added
- Типы `TTriggerResult<TData>` и `TTriggerPromise<TData>`.
- Хелпер `wrapTrigger(promise)` — оборачивает сырой промис мутации (например, результат `Command.trigger`) в конверт с `.unwrap()`.


## [0.9.2] - 2026-06-29

### Added
- ⚠️ **Экспериментально.** Императивные методы ресурса для загрузчиков роутеров (TanStack Router и др.) и прогрева кэша — см. [Resource API](./query/api/resource.md#ensure--fetch--prefetch):
  - `ensure(args, { signal? })` — отдаёт кэш мгновенно либо ждёт первый запрос;
  - `fetch(args, { signal? })` — всегда перезапрашивает, дедуплицируя in-flight;
  - `prefetch(args)` — fire-and-forget прогрев, никогда не реджектит;
  - `signal` отвязывает вызывающего; общий in-flight запрос не прерывается, пока на нём есть другие потребители.
- Примитивы ожидания у кэш-записи (`IQueryCacheEntry`): `whenLoaded(signal?)` и `whenFetched(signal?)`.

### Fixed
- `Resource.getEntry$(args, { doInitiate: true })` теперь действительно создаёт и запускает кэш-запись при чтении (раньше флаг был «мёртвым» no-op); `doInitiate: false` остаётся чистым наблюдателем и не мутирует кэш.


## [0.9.1] - 2026-06-27

### Added
- Метод `pack` у ресурсов и команд — связывает ресурс/команду с аргументами в инертный дескриптор. См. [Resource API](./query/api/resource.md#pack) и [Command API](./query/api/command.md#pack).


## [0.9.0] - 2026-06-26

### Added
- Идемпотентный **request id** для команд: `queryFn` получает вторым аргументом `requestId: string` — стабильный между ретраями ключ (например, для заголовка `Idempotency-Key`). По умолчанию генерируется `crypto.randomUUID()`; переопределяется опцией команды `generateRequestId?: (args) => string | Promise<string>`. См. [гайд по queryFn](./query/usage/query-fn.md).
- `retry()` у агента команды (`CommandAgent` / `ICommandAgent`) и в состоянии `useCommand` (`TCommandAgentState.retry`) — перезапуск упавшей мутации без создания новой кэш-записи; повтор переиспользует тот же request id.
- Руководство [usage/query-fn.md](./query/usage/query-fn.md): мотивация (почему fetcher не встроен в API), различие `queryFn` ресурса и команды, пример переиспользуемого fetcher'а.

### Changed
- `Command.queryFn` теперь вызывается с двумя аргументами `(args, requestId)` (раньше — `(args)`). Существующие `queryFn`, игнорирующие второй аргумент, остаются совместимыми.

### Fixed
- `CommandAgent.trigger(args)` без явного ключа теперь начинает наблюдать за созданной кэш-записью — `useCommand` без ключа больше не «залипает» в `idle`. Ключ, переданный в `useCommand(command, key)` / `createAgent(key)`, теперь используется при `trigger`.
- Кэш-запись с `retentionTime: 0` (дефолт команд) больше не сбрасывается синхронно при обнулении числа подписчиков: агент команды успевал прочитать `state$` уже снятой записи и падал с `No value emitted`, из-за чего `useCommand` с дефолтным `retentionTime` не доходил до `success`/`error`. Сброс отложен через `timer(0)` и переживает кратковременную переподписку агента.


## [0.8.0] - 2026-06-20

[Гайд по миграции с 0.7.x](./migrations/0.8.0.md)

### Added
- Хук `useSuspenseResource` — Suspense-вариант `useResource`: первичная загрузка приостанавливает рендер (`<Suspense fallback>`), первичная ошибка пробрасывается в `ErrorBoundary`, `data` гарантированно не `null`. Фоновые обновления (SWR) не приостанавливают. Доступен как standalone-хук и как метод ресурса (`resource.useSuspenseResource(args)`) через `reactHooksPlugin`.
- Метод `whenSettled()` у `IResourceAgent` / `ResourceAgent` — промис, резолвящийся при выходе агента из фазы первичной загрузки (используется хуком Suspense).
- Тип `TSuspenseResourceState<TArgs, TData>` — состояние ресурса с не-null `data`.

### Removed
- Удалён метод `destroy()` у `Computed` и у результата `Signal.compute(...)` — используйте `dispose()`.
- Удалена статическая фабрика `LocalState.create(...)` — используйте `LocalSignal.state(...)`.
- Удалены устаревшие типы сигналов: `ReadableSignalLike`, `ReadableSignalFnLike`, `WriteableSignalLike`, `ClearableSignalLike`, `StatefulSignalFn`, `SignalFn`, `ComputeFn` — используйте `ReadonlySignal` / `DisposableSignal` / `StateSignal` / `LocalStateSignal`.


## [0.7.4] - 2026-06-17

### Added
- Новые типы сигналов: `ReadonlySignal<T>`, `DisposableSignal<T>`, `StateSignal<T>` — единая иерархия для read-only, завершаемых и записываемых сигналов.
- Метод `dispose()` для завершения сигналов (`Signal.state(...)`, `Signal.compute(...)`, `State`, `Computed`).
- Поддержка `Symbol.dispose` у сигналов — совместимость с `using` (TC39 Explicit Resource Management).
- Опциональный `defaultValue` для `signalize(observable, defaultValue?)` (и `SourceSignal.create` / `SyncObservable`).

### Changed
- Класс `ReadonlySignal` переименован в `SourceSignal` (ломающее изменение при прямом использовании `ReadonlySignal.create(...)`).

### Deprecated
- `destroy()` у результата `Signal.compute(...)` (`Computed`) — используйте `dispose()`.
- Типы `SignalFn`, `ComputeFn`, `ReadableSignalLike`, `ReadableSignalFnLike`, `WriteableSignalLike`, `ClearableSignalLike`, `StatefulSignalFn`.


## [0.7.3] - 2026-05-25

### Fixed
- `LocalState` теперь безопасно импортируется в окружение без localStorage (Например в nodejs).


## [0.7.2] - 2026-05-23

### Added
- Добавлен `Resource.getState(args)` для синхронного получения состояния ресурса без реактивной подписки.

### Fixed
- Исправлено имя метода `LocalSignal.create(...)` → `LocalSignal.state(...)` для соответствия конвенции `Signal.state` и записи в CHANGELOG 0.7.1.


## [0.7.1] - 2026-05-17

### Added
- Добавлен `LocalSignal.state(...)` для замены `LocalState.create(...)` с более последовательным названием.

### Fixed
- Исправлено SWR-поведение `ResourceAgent`: при последовательной смене аргументов (A→B→C) до завершения промежуточного запроса сохраняются stale-данные вместо перехода в initial loading.

### Deprecated
- `LocalState.create(...)` помечен как deprecated, используйте `LocalSignal.state(...)`


## [0.7.0] - 2026-05-17

### Added
- Добавлен метод `update(updater)` для writeable-сигналов (`Signal.state`, `State.create`, `LocalState.create`) как функциональная альтернатива `set(...)`
- Добавлена поддержка `actionName` в `set(value, actionName?)` и `update(updater, actionName?)` для writeable-сигналов с отображением в devtools как `UPDATE: actionName`


## [0.6.2] - 2026-05-17

### Fixed
- Исправлен вывод типов в `links` 


## [0.6.0] - 2026-04-17

[Гайд по миграции с 0.5.x](./migrations/0.6.0.md)

### Added
- `createApi()` — центральная фабрика для создания ресурсов и команд, заменяет standalone-функции
- Фабричные методы `Machine.pending()`, `Machine.fromSnapshot()`
- Система плагинов с HKT-типами для типобезопасного расширения
- SSR-гидрация кеша через опции `initialSnapshot` и `getSnapshot()`
- Кросс-табовая синхронизация через опции `syncDriver` и `defaultSync`
- Новые опции `createApi`: `keyPrefix`, `syncDriver`, `defaultSync`, `snapshotValidTime`, `initialSnapshot`, `resourceRetentionTime`, `commandRetentionTime`
- Статус `isRefreshError` в агентах ресурсов
- Статус `idle` в агентах (ресурсов и команд)
- `reactHooksPlugin()` — фабричная функция (альтернатива `new ReactHooksPlugin()`)

### Changed
- **Полностью переработанный модуль Query** — иммутабельные состояния машины, реактивные кеш-записи, SWR-поведение
- `Machine` теперь дискриминированное объединение иммутабельных подтипов: `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`, `MachineRefreshError`
- Ресурсы теперь поддерживают реактивные кеш-записи с методами `getEntry$()`, `createAgent()`, `trigger()`, `refresh()`
- Агенты ресурсов переработаны — SWR-поведение, методы `start`, `set`, `retry`, `refresh`, новый статус `idle`
- Агенты команд переработаны — методы `trigger`, `setKey`
- Команды теперь поддерживают оптимистичные обновления, патчи при успехе и инвалидацию связанных ресурсов
- `link` (callback) переименован в `links` (массив или callback): `optimisticUpdate(draft, args)`, `update(draft, args, result)`, `invalidate` — вместо обёрточного объекта
- React хуки переписаны: `useResource(resource, args)`, `useCommand(command, key)`
- Оптимистичные обновления с Immer-патчами и rebase-логикой

### Removed
- Удалены deprecated-элементы:
  - `api.createOperation()` → используйте `api.createCommand()`
  - `useOperationAgent()` → используйте `useCommand()`
  - Все Operation-типы (`OperationDefinition`, `OperationInstance`, `OperationCreateOptions`, `OperationCreateFn`, `OperationQueryState`, `OperationAgentInstanse`) → удалены (Query модуль полностью переписан, см. [гайд по миграции](./migrations/0.6.0.md))
  - `ResourceRefInstanse` — удалён (используйте `resource.getEntry()` для доступа к кеш-записям)
  - `LocalSignal` → используйте `LocalState`
  - `Signal.create()` — удалён из публичного API (технически доступен через наследование от `State`, но не рекомендуется) → используйте `Signal.state()` / `State.create()`
- Удалены standalone-функции (заменены методами `createApi()`):
  - `createResource()` → `api.createResource()`
  - `createCommand()` → `api.createCommand()`
  - `createResourceDuplicator()` → удалён без замены
  - `resetAllQueriesCache()` → `api.resetAll()`
- Удалены и заменены React-хуки:
  - `useCommandAgent()` → используйте `useCommand()`
  - `useResourceAgent()` → используйте `useResource()`
  - `useResourceRef()` → удалён (используйте `resource.getEntry()`)
- Удалён namespace `unstable_queryV2` — экспериментальный API стал основным


## [0.5.4] - 2026-03-21

### Fixed
- Removed unused `observable-hooks` dependency from `package.json`


## [0.5.3] - 2026-03-21

### Fixed
- Fixed `useResourceRef` memoization for object arguments — ref no longer recreated every render
- Fixed missing type exports from `src/query/` — consumers can now import `ResourceDefinition`, `CommandDefinition`, etc.
- Исправления в документации и демо-примерах

### Changed
- `ResourceRefInstanse` renamed to `ResourceRefInstance` (deprecated alias preserved)
- `FrowardInfo` renamed to `ForwardInfo` (internal type)
- `Opertation/` directory renamed to `Operation/`
- Replaced `any` types with proper types in `useResourceAgent` and `ResourceDuplicator`
- `LocalSignal` переименован в `LocalState`
- Все вызовы `Signal.create()` в кодовой базе заменены на `Signal.state()` (внутренний рефакторинг)

### Added
- Unit tests for query core modules
- Smoke tests for React hooks
- Integration tests for query exports
- `createCommand()` — создание команды (мутации/действия), заменяет `createOperation()`
- `useCommandAgent()` — React-хук для работы с командой
- `LocalState` — замена `LocalSignal` с новыми возможностями
- `LocalState.clear()` — метод удаления значения из хранилища и сброса к значению по умолчанию
- Опция `driver` для `LocalState` — возможность подключить кастомное хранилище (вместо `localStorage`)
- Новый примитив **State** — замена `Signal` с идентичным API
- `Signal.state()` — рекомендуемый статический метод создания сигнала

### Deprecated
- `ResourceRefInstanse` — use `ResourceRefInstance` (will be removed in v0.6.0)
- `createOperation()` → используйте `createCommand()` (будет удалён в v0.6.0)
- `useOperationAgent()` → используйте `useCommandAgent()` (будет удалён в v0.6.0)
- Все Operation-типы переименованы в Command-типы: `OperationDefinition` → `CommandDefinition`, `OperationInstance` → `CommandInstance`, `OperationCreateOptions` → `CommandCreateOptions`, `OperationCreateFn` → `CommandCreateFn`, `OperationQueryState` → `CommandQueryState`
- `OperationAgentInstanse` (с опечаткой) → `CommandAgentInstance` — исправлена опечатка в имени типа
- `LocalSignal` → используйте `LocalState`
- `Signal` помечен как `@deprecated` — используйте `State` вместо него
- `Signal.create()` помечен как `@deprecated` — используйте `Signal.state()` / `State.create()`


## [0.5.2] — 2025-12-19

### Fixed
- Исправлена работа `SKIP_TOKEN`


## [0.5.1] — 2025-12-19

### Fixed
- Исправление типизации


## [0.5.0] — 2025-12-18

[Гайд по миграции с 0.4.x](./migrations/0.5.0.md)

### Breaking Changes

- Удалены хуки `useObservable` и `useSyncObservable`
- Сигналы больше не наследуют `Observable` — используйте `.obs` для подписки
- Удалены `.value`, `.getValue()`, `.next()` — заменены на `signal()`, `.get()`, `.set()`
- Нет необходимости вызывать `complete()` для Signal и Computed

### Added

#### Signals
- **Функциональный API**: `Signal.create()`, `Signal.compute()`, `Signal.effect()`
- **Ленивый Computed**: вычисление только при наличии подписок
- Cleanup-функции в `Effect` (возврат teardown)

#### Query
- **Расширенные состояния**: `isInitialLoading`, `isReloading`, `isLocked`
- **ResourceRef API**: низкоуровневый доступ к кэшу с поддержкой транзакций (patch с commit/abort)
- **Lifecycle хуки**: `onCacheEntryAdded`, `onQueryStarted`
- `resetAllQueriesCache()` — сброс всего кэша

#### React
- `useResourceRef` — хук для работы с ResourceRef

### Changed

- **BatchStrategy**: настройка стратегии обновлений (`'sync'`, `'microtask'`, `'task'`)
- **DefaultOptions**: расширенная конфигурация (`onQueryError`, `getScopeName`)


[Unreleased]: https://github.com/fozy-labs/rx-toolkit/compare/v0.11.1...develop
[0.11.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.10.2...v0.11.1
[0.10.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.7.4...v0.8.0
[0.7.4]: https://github.com/fozy-labs/rx-toolkit/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/fozy-labs/rx-toolkit/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.6.0...v0.6.2
[0.6.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.4...v0.6.0
[0.5.4]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/fozy-labs/rx-toolkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/fozy-labs/rx-toolkit/compare/v0.4.18...v0.5.0
