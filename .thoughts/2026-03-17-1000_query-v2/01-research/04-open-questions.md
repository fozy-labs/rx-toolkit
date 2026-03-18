---
title: "Open Questions: Query v2 Module"
date: 2026-03-17
stage: 01-research
role: rdpi-questioner
---

## High Priority

### Q1: Как плагин-система должна модифицировать типы ResourceV2?

**Context**: RFC показывает, что `ReactHooksPlugin` добавляет `useResource` к ресурсу, созданному через `api.createResource()`. Это требует, чтобы `createApi({ plugins: [new ReactHooksPlugin()] })` изменил возвращаемый тип `createResource`. Внешнее исследование (раздел 4) выявило три подхода: declaration merging, generic type accumulation (builder pattern) и plugin interface с type mapping. Каждый имеет существенные компромиссы.

**Options**:
1. **Generic type accumulation** (как в tRPC) — `createApi` параметризуется массивом плагинов, тип ресурса выводится через `UnionToIntersection<PluginContributions<TPlugins[number]>>`. Pros: type-safe, плагины влияют только на конкретный экземпляр API. Cons: сложная типовая гимнастика, риск TS2589 при >2-3 плагинах, сложные сообщения об ошибках.
2. **Declaration merging** — плагин расширяет интерфейс ресурса через `declare module`. Pros: простота, нативная поддержка TS. Cons: глобальный эффект — все ресурсы получают расширенный тип, даже без плагина; хрупко с generics.
3. **Plugin interface с augment()** — плагин возвращает расширенный объект, тип выводится из возвращаемого типа `augment`. Pros: гибкость, явность. Cons: требует ручной композиции типов при нескольких плагинах.

**Risks**: Неправильный выбор приведет к хрупкой типизации, которая ломается при композиции плагинов или при обновлении TS. Исследование предупреждает о `Type instantiation is excessively deep` ошибках при >2-3 плагинах с глубоко вложенными generics.

**Researcher recommendation**: Generic type accumulation (вариант 1) даёт наилучший баланс между type-safety и scoping. Рекомендуется ограничить глубину вложенности (максимум 2-3 уровня) и использовать `Prettify<T>` для улучшения IntelliSense. Стоит создать прототип с 2 плагинами и проверить на TS2589.

---

### Q2: Как класс-машины (Machine) сериализуются для SSR-снимков и devtools?

**Context**: RFC описывает класс-машины (`MachineIdle`, `MachinePending`, `MachineSuccess`, `MachineError`, `MachineRefreshing`), методы которых реализуют переходы. Однако `getSnapshot()` должен возвращать сериализуемый `TApiSnapshot`, а devtools требует отображаемое состояние. Внешнее исследование (раздел 3.3) предупреждает: `instanceof` ломается после десериализации, требуется factory/registry для восстановления экземпляров классов из сериализованного состояния.

**Options**:
1. **Сериализация только `state` поля** — каждый Machine имеет `.state` (plain object с `status`). Снимок содержит только `.state`, при гидрации `MachineSuccess.deploy(snapshotSlice)` восстанавливает класс. Pros: простота, JSON-совместимость. Cons: нужна фабрика для каждого статуса при гидрации.
2. **Registry-паттерн** — `Machine.fromSnapshot(state)` via `switch (state.status)` возвращает нужный класс. Pros: единая точка десериализации. Cons: нарушает Open/Closed principle при добавлении новых состояний.
3. **`toJSON()` / `static fromJSON()`** — стандартный JS паттерн сериализации. Pros: интеграция с `JSON.stringify`. Cons: требует кастомного reviver'а при `JSON.parse`.

**Risks**: Без чёткого механизма десериализации SSR-гидрация будет работать только для `MachineSuccess` (RFC показывает `MachineSuccess.deploy`), оставляя другие состояния без поддержки. Devtools отображение может показывать `[Object object]` вместо полезного состояния.

**Researcher recommendation**: Вариант 1 + 2 совмещённо: `.state` поле для сериализации, один `Machine.fromSnapshot()` роутер для гидрации. RFC уже показывает `MachineSuccess.deploy()` — это согласуется с вариантом 1. Для devtools достаточно передавать `.state` в `beforeDevtoolsPush`.

---

### Q3: Какова полная API и реализация `Patcher`?

**Context**: RFC упоминает `Patcher.resolvePatches(originalData, patches)`, `Patcher.finishPatch(originalData, patches, type, patch)` и `Patcher.createPatch(patchFn, data)`, но не определяет `Patcher` как класс/модуль и не описывает его полный API. В v1 логика патчей реализована inline в `ResourceRef` (строки 42-131) через Immer `produceWithPatches`/`applyPatches`. RFC указывает на проблему v1: "если race conditions все же происходит, то patch 'зависает'".

**Options**:
1. **Patcher как статический utility-класс** — аналог `ResourceQueryState` в v1 (namespace для чистых функций). Pros: простота, тестируемость, нет состояния. Cons: не инкапсулирует патч-очередь.
2. **Patcher как часть Machine** — методы `addPatch`, `finishPatch`, `createPatch` на `MachineSuccess`/`MachineRefreshing`. Pros: RFC уже показывает это (патчи на machine). Cons: дублирование кода между `MachineSuccess` и `MachineRefreshing`.
3. **Patcher + базовый класс Machine с Patches** — общий `MachineWithData` базовый класс (RFC: "Лучше, чтобы MachineSuccess и MachineRefreshing наследовались от общего класса"). Pros: DRY, одна реализация патчей. Cons: наследование добавляет сложность.

**Risks**: Без чёткого определения `Patcher` API легко воспроизвести ту же "hanging patch" багу из v1. Алгоритм разрешения патчей (RFC: committed/aborted/pending очередь) должен быть точно и полностью реализован.

**Researcher recommendation**: Вариант 3 предпочтителен — RFC явно рекомендует общий базовый класс. `Patcher` как статический utility-класс (вариант 1) для чистых функций `resolvePatches` и `finishPatch`, которые вызываются из базового `MachineWithData`. Алгоритм из v1 (`ResourceRef`, строки 42-131) — проверенная основа, но must fix "hanging patch" by adding cleanup of orphaned committed/aborted entries after the last pending is resolved.

---

### Q4: Как v1 и v2 сосуществуют без конфликтов?

**Context**: TASK.md: "New code must NOT depend on legacy query v1 implementations". Оба модуля используют `SharedOptions`, `Signal`, `Batcher`, devtools, `PromiseResolver`. Оба экспортируются из одного пакета (`src/index.ts`). `ResetAllQueriesSignal` в v1 — глобальный статический Subject, который ресетит ВСЕ ресурсы.

**Options**:
1. **Полная изоляция на уровне пакета** — v2 в `src/query-v2/`, отдельный `index.ts`, не пересекается с `src/query/`. Общие зависимости (`Signal`, `shallowEqual`, etc.) используются напрямую из `src/common/` и `src/signals/`. Pros: чистое разделение. Cons: два разных API для кеширования данных в одном пакете.
2. **Изоляция с общим namespace** — `src/query-v2/` но под тем же barrel export `src/query/index.ts` с явным ResourceV2 prefix. Pros: один import path. Cons: рискованно — случайный import v1 type вместо v2.
3. **v2 полностью заменяет v1** — не вариант, RFC: "экспериментальном виде".

**Risks**:
- `ResetAllQueriesSignal.clean()` в v1 — глобальный. Если v2 подпишется на него, reset v1 ресетнет и v2. Если не подпишется — `resetAllQueriesCache()` не затронет v2.
- Naming collisions: v1 `Resource` vs v2 `ResourceV2` — RFC naming convention решает это.
- `SharedOptions.onQueryError` — общий для v1 и v2? Или v2 получает свой error handler через `createApi`?

**Researcher recommendation**: Вариант 1 — полная изоляция. v2 в `src/query-v2/`. v2 НЕ подписывается на `ResetAllQueriesSignal` — вместо этого у `createApi` есть свой `resetAll()`. `SharedOptions.onQueryError` используется как fallback, но `createApi.onQueryError` имеет приоритет. Barrel export из `src/index.ts` добавляет v2 экспорты.

---

### Q5: Как именно `MachineRefreshing` связано с `MachinePending`, и какие переходы оно поддерживает?

**Context**: RFC упоминает `MachineRefreshing` (переход через `MachineSuccess.invalidate()`), но не показывает реализацию. В v1 аналогом является состояние `isReloading` (когда `isDone` и запущен новый запрос). `MachineRefreshing` должен хранить текущие данные (stale) пока загружаются новые.

**Options**:
1. **`MachineRefreshing` — отдельный класс с data + pending запросом** — содержит `data` (stale), `args` (новые), поддерживает `successHappened()` → `MachineSuccess` и `errorHappened()` → `MachineError` (с сохранением stale data или нет). Pros: явные переходы. Cons: дублирование с `MachinePending`.
2. **`MachineRefreshing extends MachinePending` с дополнительным `data` полем** — наследует переходы от `MachinePending`, добавляет stale data. Pros: DRY. Cons: `MachinePending` не имеет `data`, наследование может запутать типы.
3. **`MachineRefreshing` — подвид `MachineSuccess` с флагом `isRefreshing`** — не отдельный класс, а состояние внутри `MachineSuccess`. Pros: проще. Cons: теряется compile-time safety переходов.

**Risks**: Неопределённые переходы: что происходит при `MachineRefreshing.addPatch()`? Патчи применяются к stale data? Что если error во время refreshing — данные теряются или кешируются stale данные? В v1 `isReloading + isError` — каких комбинаций быть не должно?

**Researcher recommendation**: Вариант 1 с общим базовым классом для patch-логики (как рекомендовано в Q3). `MachineRefreshing` поддерживает: `successHappened()` → `MachineSuccess`, `errorHappened()` → `MachineSuccess` (возврат к stale data) или `MachineError` (потеря data). Нужно решить поведение при ошибке — это подвопрос.

---

### Q6: Что такое `NO_VALUE` и как он реализован на уровне типов?

**Context**: RFC использует `NO_VALUE` как sentinel в `MachinePending.create()`: `originalData: NO_VALUE`. В v1 аналога нет — v1 использует `null` для отсутствия данных. `NO_VALUE` нужен, чтобы отличить "данных ещё не было" от "данные === null". `Computed` в signals использует аналогичный паттерн (`Computed._EMPTY` symbol).

**Options**:
1. **`const NO_VALUE = Symbol('NO_VALUE')`** — аналогично `SKIP`. При проверке: `state.originalData === NO_VALUE`. Тип: `typeof NO_VALUE`. Pros: простота, уникальность. Cons: необходим type guard или conditional type для исключения из публичных типов (пользователь не должен видеть `NO_VALUE` в типе `data`).
2. **Tagged union** — `originalData: { hasValue: false } | { hasValue: true, value: DATA }`. Pros: type-safe без sentinel. Cons: более verbose, нарушает паттерн RFC.
3. **`undefined` с optional поле** — `originalData?: DATA`. Pros: нативный JS. Cons: не отличает "не задано" от "значение undefined".

**Risks**: Если `NO_VALUE` протечёт в публичный тип (`data: DATA | typeof NO_VALUE`), это запутает потребителей. Нужна чёткая type-level стратегия.

**Researcher recommendation**: Вариант 1 (symbol sentinel). Уже используемый паттерн в кодовой базе (`Computed._EMPTY`, `SKIP`). Для типов: internal generic с conditional type: `type Resolved<T> = T extends typeof NO_VALUE ? never : T`. В публичном API `data` всегда типизирован как `DATA | null`.

---

## Medium Priority

### Q7: `serialize` vs `compare` — должны ли обе стратегии быть реализованы в MVP, и как они влияют на архитектуру кеша?

**Context**: RFC определяет `keyStrategy: 'serialize' | 'compare'`. `serialize` использует `Map<string, CacheEntry>` с O(1) lookup. `compare` использует аналог `IndirectMap` из v1 с O(n) lookup. Внешнее исследование: breakeven ~50-100 entries для производительности. Ни одна major библиотека не предлагает оба подхода.

**Options**:
1. **Реализовать обе с самого начала** — двойная имплементация кеша (`StringKeyCache` и `CompareKeyCache`). Pros: полная совместимость с RFC. Cons: удвоенный объём кода и тестов для кеш-слоя.
2. **`serialize` как primary, `compare` как legacy fallback** — сначала `serialize`, `compare` добавляется позже. Pros: фокус, быстрее MVP. Cons: отступление от RFC.
3. **Абстрактный `CacheMap` интерфейс** — общий интерфейс `{ get(args), set(args, entry), delete(args), values() }`, две реализации. Pros: чистая архитектура, легко тестировать. Cons: дополнительный уровень абстракции.

**Risks**: SSR-снимки работают только с `serialize` стратегией (RFC: `initialSnapshot` — `'serialize'` mode). `compare` стратегия не может создавать снимки (ключи — произвольные объекты). Если архитектура не абстрагирована, добавление `compare` позже потребует рефакторинга.

**Researcher recommendation**: Вариант 3 — абстрактный `CacheMap` интерфейс с двумя реализациями. Реализовать обе сразу, так как TASK.md требует "Full implementation — no simplifications, no shortcuts". Абстракция минимальна (4-5 методов) и окупится в тестируемости.

---

### Q8: Как `onCacheEntryAdded` и `onQueryStarted` взаимодействуют с жизненным циклом Machine?

**Context**: В v1 `QueriesLifetimeHooks` создаёт PromiseResolver'ы для `$cacheDataLoaded`, `$cacheEntryRemoved`, `$queryFulfilled` и управляет ими извне (Resource вызывает `cacheDataLoaded()`, `fulfilledSuccess()` etc.). В v2 состояние хранится в Machine, а не в flat state object. Вопрос: кто вызывает resolve для lifecycle promises — Machine при переходе, или ResourceV2 снаружи?

**Options**:
1. **ResourceV2 вызывает resolvers при переходах Machine** — аналогично v1: `ResourceV2` делает `machine = machine.successHappened(data)`, затем вызывает `hooks.fulfilledSuccess(data)`. Pros: знакомый паттерн, hooks остаются decoupled от Machine. Cons: логика размазана между Machine и ResourceV2.
2. **Machine имеет hooks callback-и** — переход `successHappened()` вызывает callback из контекста. Pros: self-contained. Cons: Machine перестаёт быть pure state holder, усложняется тестирование.
3. **Event-based** — Machine.transition() возвращает не только новый Machine, но и список событий (events), которые ResourceV2 обрабатывает. Pros: чистая архитектура (command pattern). Cons: overengineering для данного случая.

**Risks**: Если hooks не синхронизированы с Machine переходами, возможны race conditions (hook fire до Machine update). v1 использует `Batcher.run()` для атомарности — нужен аналог в v2.

**Researcher recommendation**: Вариант 1 — ResourceV2 как оркестратор. Machine остаётся чистым state holder (легко тестируется, сериализуется). ResourceV2 вызывает hooks после применения нового Machine к кешу, внутри `Batcher.run()`.

---

### Q9: Нужен ли `ResourceDuplicator` в v2?

**Context**: v1 содержит `ResourceDuplicator` — механизм для fan-out списковых ресурсов в per-item кеши. RFC не упоминает `ResourceDuplicator`. TASK.md требует "all public APIs described in the RFC".

**Options**:
1. **Не реализовывать в v2** — RFC не упоминает, значит out of scope. Pros: меньше кода. Cons: потеря функциональности при миграции с v1.
2. **Реализовать как отдельный плагин** — `DuplicatorPlugin` добавляет `createDuplicator` к API. Pros: модульность. Cons: усложняет plugin систему до проверки в production.
3. **Отложить** — реализовать после основного MVP, если будет спрос. Pros: прагматично. Cons: может потребоваться рефакторинг кеш-слоя.

**Risks**: Минимальные — `ResourceDuplicator` упоминается только в v1, не в RFC.

**Researcher recommendation**: Вариант 1 — out of scope для v2 MVP. RFC не упоминает его. При необходимости может быть добавлен позже как plugin или отдельный API.

---

### Q10: `doCacheArgs` — какой механизм мемоизации использовать и для каких типов аргументов?

**Context**: RFC: `doCacheArgs: boolean` — "кешировать ли результат сериализации аргументов". Внешнее исследование указывает на `WeakMap<object, string>` как стандартный подход, но `WeakMap` не поддерживает примитивные ключи.

**Options**:
1. **`WeakMap<object, string>` только для объектных аргументов** — примитивы сериализуются каждый раз (дёшево). Pros: автоматический GC, простота. Cons: не кеширует примитивы — но стоимость `JSON.stringify(42)` пренебрежима.
2. **`WeakMap` + `Map<string, string>` для примитивов** — кеширует всё. Pros: полное покрытие. Cons: `Map` для примитивов не GC'ится автоматически, потенциальная утечка памяти.
3. **Всегда на уровне `createApi`** — единый кеш для всех ресурсов API. Pros: переиспользование между ресурсами. Cons: больший scope, потенциально больше коллизий.

**Risks**: Утечка памяти при варианте 2 (Map для примитивов растёт неограниченно). Неверная мемоизация при мутабельных объектах (объект изменился, но кеш вернул старый результат).

**Researcher recommendation**: Вариант 1 — `WeakMap` только для объектов. Стоимость сериализации примитивов пренебрежима. Кеш на уровне ресурса (не API), так как `serializeArgs` может отличаться per resource.

---

### Q11: Как `beforeDevtoolsPush` интегрируется с Machine-based state?

**Context**: В signals-слое `beforeDevtoolsPush` — это `(newValue: T, push: (v: T) => void) => void`, которая перехватывает значение перед отправкой в devtools (`Devtools.ts:35-37`). `Computed` использует его для фильтрации `_EMPTY` sentinel. RFC указывает `beforeDevtoolsPush` как опцию `createResource`. Вопрос: что именно пушится в devtools — Machine instance, `.state` поле, или кастомная проекция?

**Options**:
1. **Push `.state` plain object** — Machine не сериализуется, пушится только `machine.state`. Pros: JSON-совместимо, читаемо в Redux DevTools. Cons: теряется информация о типе Machine.
2. **Push кастомный объект** — `{ machineType: 'success', ...machine.state }`. Pros: informative. Cons: дополнительная трансформация.
3. **`beforeDevtoolsPush` трансформирует per-resource** — пользователь решает, что пушить. Pros: гибкость. Cons: без дефолта devtools бесполезен.

**Risks**: Если по умолчанию в devtools приходит Machine class instance, Redux DevTools Extension (ожидает JSON) может крашнуться или показать `{}`.

**Researcher recommendation**: По умолчанию push `machine.state` (plain object с `status`, `data`, `args`, etc.). `beforeDevtoolsPush` позволяет пользователю модифицировать. Это согласуется с текущим паттерном в `Computed` (фильтрация `_EMPTY`).

---

### Q12: Как решается "hanging patch" баг из v1?

**Context**: RFC: "у V1 проблема: если race conditions все же происходит, то patch 'зависает'". В v1 `ResourceRef` (строки 42-131) реализует patch queue с pending/committed/aborted статусами. "Зависание" может происходить, когда pending транзакция никогда не коммитится и не абортится (например, из-за unhandled error в Command).

**Options**:
1. **Timeout для pending патчей** — если патч pending дольше N секунд, автоматически abort. Pros: self-healing. Cons: arbitrary timeout, может false-positive.
2. **Привязка патча к AbortController запроса** — если запрос abort'ится, patch автоматически abort'ится. Pros: deterministic. Cons: не все патчи связаны с запросами.
3. **Cleanup при переходе Machine** — при `successHappened()` или `errorHappened()` все pending патчи, не привязанные к текущему запросу, abort'ятся. Pros: привязка к lifecycle. Cons: нужен механизм привязки патчей к запросам.
4. **Explicit lifecycle** — `createPatch()` возвращает handle с `commit()`, `abort()`, и `[Symbol.dispose]()` для `using` statement. Pros: deterministic cleanup. Cons: требует дисциплины от потребителя.

**Risks**: Без fix'а "hanging patch" — прямое повторение бага v1. Патч в pending состоянии навечно блокирует очистку оригинальных данных.

**Researcher recommendation**: Комбинация вариантов 2 и 3 — привязка к lifecycle Machine. При переходе Machine к новому состоянию (success/error after refresh) orphaned pending патчи abort'ятся. Дополнительно: `createPatch()` возвращает handle, и `ResourceV2` при reset/cleanup abort'ит все pending патчи.

---

### Q13: Входят ли операции/команды в scope v2?

**Context**: RFC: "createApi - это новая функция для создания группы ресурсов (в дальнейшем и операций)". Фраза "в дальнейшем" неоднозначна — это "в будущем" или "далее в документе"? TASK.md не упоминает `createCommand` или операции для v2.

**Options**:
1. **Только ресурсы в v2 MVP** — команды/операции остаются в v1 или добавляются позже. Pros: фокус, меньше scope. Cons: неполная API isolation (v2 resources + v1 commands = cross-dependency risk).
2. **Ресурсы + команды в v2** — полная замена v1. Pros: полная изоляция, `createApi.resetAll()` ресетит всё. Cons: значительно больший scope.

**Risks**: Если команды не входят в v2, `link` механизм (Command → Resource optimistic updates) должен работать cross-version (v1 Command → v2 ResourceV2), что нарушает изоляцию.

**Researcher recommendation**: RFC ("в дальнейшем") указывает на будущую работу. TASK.md описывает только RFC scope. Рекомендуется реализовать только ресурсы, но спроектировать `createApi` с расчётом на добавление `createCommand` позже (зарезервировать API surface).

---

## Low Priority

### Q14: Как именно работает `entry(args, doInitiate)` vs `query(args, doForce)`?

**Context**: RFC показывает четыре метода на ResourceV2: `query`, `query$`, `entry`, `entry$`. `query` возвращает кеш и инициирует запрос. `entry` возвращает объект кеша. Различие между ними не полностью ясно — какой именно объект возвращает `entry`? Это аналог `ResourceRef` из v1?

**Options**:
1. **`entry` возвращает `ICacheEntry` (Machine holder)** — прямой доступ к реактивной единице кеша. `query` — это `entry` + initiate. Pros: гранулярность. Cons: ICacheEntry — internal abstraction, экспозиция наружу может быть leaky.
2. **`entry` возвращает snapshot текущего состояния** — non-reactive: `{ data, status, error, ... }`. Pros: простота. Cons: теряется реактивность, зачем тогда `entry$`?

**Risks**: Минимальные — это вопрос API design, не blocking.

**Researcher recommendation**: RFC `entry$` подразумевает реактивный доступ → `entry` возвращает `ICacheEntry` (reactive cache unit, содержащий Machine). `doInitiate` flag определяет, создавать ли cache entry если её нет.

---

### Q15: Нужен ли `select` transform в v2?

**Context**: v1 `createResource` поддерживает `select` — трансформация `Result → Selected` (или `Data = FallbackOnNever<Selected, Result>`). RFC не упоминает `select` явно. TASK.md не упоминает `select`.

**Options**:
1. **Не включать** — пользователь может трансформировать данные через computed signals. Pros: проще, меньше generics. Cons: потеря удобства v1.
2. **Включить как опцию** — аналогично v1. Pros: обратная совместимость концепции. Cons: добавляет generic parameter.

**Risks**: Минимальные. `select` — convenience feature.

**Researcher recommendation**: Отложить. RFC не упоминает `select`, TASK.md требует реализовать "all public APIs described in the RFC". Если select не в RFC — out of scope.

---

### Q16: Нужна ли поддержка `staleTime` отдельно от `cacheLifetime`?

**Context**: Внешнее исследование: TanStack Query разделяет `staleTime` (когда refetch) и `gcTime` (когда evict). RFC имеет только `cacheLifetime` (= `gcTime`). Staleness управляется неявно через Machine states.

**Options**:
1. **Только `cacheLifetime`** как в RFC. Pros: проще, согласуется с RFC. Cons: нет explicit staleTime control.
2. **Добавить `staleTime`**. Pros: лучший UX. Cons: выход за рамки RFC, усложнение.

**Risks**: Минимальные — можно добавить позже без breaking changes.

**Researcher recommendation**: Следовать RFC — только `cacheLifetime`. `staleTime`-like поведение реализуется через `MachineRefreshing` (данные есть, но запущен новый запрос).

---

### Q17: Формат версии в `TApiSnapshot`

**Context**: RFC: "Для гарантии совместимости содержит в себе текущую версию формата, keyPrefix и тип". Внешнее исследование: ни одна major библиотека не реализует explicit snapshot versioning. Но это описано в RFC.

**Options**:
1. **Semver string** — `version: '1.0.0'`. Pros: стандартно. Cons: нужна логика semver comparison.
2. **Integer counter** — `version: 1`. Pros: просто, строгое равенство. Cons: нет backward-compat granularity.
3. **Hash** — `version: hash(schema)`. Pros: автоматическая детекция несовместимости. Cons: сложно, тяжело debug.

**Risks**: Минимальные, но без версии невозможно безопасно гидрировать снимки при обновлении формата.

**Researcher recommendation**: Вариант 2 — integer counter. Простота, достаточно для экспериментального API. Increment при изменении формата snapshot.

---

## User Answers

### Q1: Как плагин-система должна модифицировать типы ResourceV2?
**Decision**: Решить на этапе design

### Q2: Как класс-машины (Machine) сериализуются для SSR-снимков и devtools?
**Decision**: .state + Machine.fromSnapshot()

### Q3: Какова полная API и реализация Patcher?
**Decision**: Utility + MachineWithData base class

### Q4: Как v1 и v2 сосуществуют без конфликтов?
**Decision**: Полная изоляция (src/query-v2/)

### Q5: Как именно MachineRefreshing связано с MachinePending?
**Decision**: Решить на этапе design

### Q6: Что такое NO_VALUE и как он реализован?
**Decision**: Symbol sentinel

### Q7: serialize vs compare — обе стратегии в MVP?
**Decision**: Обе реализации

### Q8: Как onCacheEntryAdded и onQueryStarted взаимодействуют с lifecycle Machine?
**Decision**: Вариант 1 или 3 — на усмотрение design stage

### Q9: Нужен ли ResourceDuplicator в v2?
**Decision**: Out of scope

### Q10: doCacheArgs — механизм мемоизации?
**Decision**: WeakMap для объектов, примитивы без кеша

### Q11: Как beforeDevtoolsPush интегрируется с Machine-based state?
**Decision**: machine.state (через beforeDevtoolsPush)

### Q12: Как решается "hanging patch" баг из v1?
**Decision**: Решить на этапе design

### Q13: Входят ли операции/команды в scope v2?
**Decision**: Только ресурсы и createApi (и всё для их реализации)

### Q14: Как именно работает entry(args) vs query(args)?
**Decision**: entry(args): ICacheEntry (не reactive)

### Q15: Нужен ли select transform в v2?
**Decision**: Out of scope

### Q16: Нужна ли поддержка staleTime?
**Decision**: Только cacheLifetime (по RFC)

### Q17: Формат версии в TApiSnapshot?
**Decision**: Integer counter
