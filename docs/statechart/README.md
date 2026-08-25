# Модуль Statechart

Модуль Statechart — конечные автоматы (стейтчарты) в формате конфигурации **XState v5**, исполняемые собственным рантаймом поверх [сигналов][signals]. Пакет `xstate` **не является зависимостью**: конфиг описывается в его формате ради совместимости со стандартным тулингом Stately (Stately Inspector, Stately Studio «import from code», `@xstate/machine-extractor`), а семантика переходов сверена с `xstate@5.32.5` дифференциальными тестами.

Что даёт модуль:

- **Описание в формате XState v5** — вложенные, параллельные, финальные и history-состояния, `entry`/`exit`, `always`, `after`, `onDone`, гварды и действия.
- **Инстанс как сигнал** — `MachineSignal.state(definition)` возвращает callable-сигнал снапшота: его можно читать в `Computed`/`Effect`, подписываться через `.obs`, использовать в React через `useSignal`.
- **Devtools** — снапшот виден в Redux DevTools как обычный сигнал, а живая диаграмма открывается в Stately Inspector.
- **Экспорт** — `toXStateSource()` для вставки в Stately Studio и `toMermaid()` для документации.
- **Строгая валидация** — всё, что рантайм не реализует, падает с понятной ошибкой в `createMachine()`, а не игнорируется молча.


## Концепция: описание и инстанс

Модуль разделяет два слоя — ровно как `createMachine()` → `createActor()` в самом XState.

| | Описание — `MachineDefinition` | Инстанс — `MachineSignal.state()` |
|---|---|---|
| Что это | чистые данные конфига + таблица реализаций | текущее состояние, очередь событий, таймеры |
| Состояние | нет | есть |
| Создаётся | один раз на модуль, через `createMachine()` | сколько угодно раз на одно описание |
| Жизненный цикл | нет | `start()` / `stop()` / `dispose()` |
| Зачем | якорь вывода типов; валидация один раз; `provide()` для подмены реализаций в тестах; `toXStateSource()` / `toMermaid()` | связка с `State` / `Batcher` / devtools |

```mermaid
flowchart LR
  subgraph author["Авторинг"]
    C["config<br/>(чистые данные)"]
    I["implementations<br/>actions / guards / delays"]
  end
  subgraph def["createMachine() → MachineDefinition"]
    V["валидация<br/>(MachineConfigError)"]
    P["provide()"]
    T["toXStateSource()<br/>toMermaid()"]
  end
  subgraph inst["MachineSignal.state() → инстанс"]
    R["интерпретатор<br/>микрошаги, таймеры, очередь"]
    S["сигнал снапшота<br/>{ status, value, context, ... }"]
  end
  subgraph view["Просмотр"]
    INS["Stately Inspector"]
    STU["Stately Studio"]
    RDX["Redux DevTools"]
  end
  C --> V
  I --> V
  V --> P
  V --> R
  R --> S
  C -->|"config как JSON"| INS
  S -->|"снапшоты"| INS
  T --> STU
  S --> RDX
```

Описание не имеет состояния, поэтому одно и то же `definition` можно безопасно передавать в любое число инстансов, в тесты и в экспортёры.


## Быстрый старт

```typescript
import { assign, createMachine, MachineSignal } from "@fozy-labs/rx-toolkit";

interface LightContext {
    ready: boolean;
    cycles: number;
}

type LightEvent = { type: "TIMER" } | { type: "SET_READY"; ready: boolean };

// Описание: конфиг в формате XState v5 + таблица реализаций по именам
export const trafficLight = createMachine(
    {
        id: "trafficLight",
        initial: "green",
        context: { ready: false, cycles: 0 },
        types: {} as { context: LightContext; events: LightEvent },
        states: {
            green: { after: { 3000: "yellow" } },
            yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
            red: {
                on: {
                    TIMER: {
                        target: "green",
                        actions: assign({ cycles: ({ context }) => context.cycles + 1 }),
                    },
                },
            },
        },
        on: {
            SET_READY: { actions: assign({ ready: ({ event }) => event.ready }) },
        },
    },
    {
        actions: {
            warn: ({ context }) => console.warn(`Switching to red after ${context.cycles} cycles`),
        },
        guards: {
            isReady: ({ context }) => context.ready,
        },
    },
);

// Инстанс: callable-сигнал снапшота, запускается сразу (autoStart: true)
const light$ = MachineSignal.state(trafficLight, { key: "trafficLight" });

light$().value; // "green"  — чтение с отслеживанием зависимостей (как у Signal.state)
light$.peek().context.cycles; // 0 — чтение без отслеживания

light$.send({ type: "SET_READY", ready: true });
light$.matches("green"); // true
light$.can({ type: "TIMER" }); // false — в green нет перехода по TIMER

// ... через 3000 мс сработает after и машина перейдёт в yellow
light$.send({ type: "TIMER" }); // yellow → red (guard isReady пропустил, warn выполнен)

const subscription = light$.obs.subscribe((snapshot) => console.log(snapshot.value));

subscription.unsubscribe();
light$.dispose(); // снять таймеры, завершить сигнал, отписаться от devtools
```

Важные моменты, которые видно уже в этом примере:

- `createMachine` — это **обязательное** имя вызова: экстрактор Stately ищет вызовы именно по нему (см. [Экспорт в Stately Studio](#экспорт-в-stately-studio-toxstatesource)).
- Действия и гварды в конфиге — **строковые имена**, реализации лежат отдельно. Конфиг остаётся сериализуемым, что нужно и инспектору, и экспорту.
- `types: {} as { context: ...; events: ... }` — идиома XState v5 для вывода типов; в рантайме ключ игнорируется.
- Сам `send()` синхронный: один вызов — один макрошаг — одна публикация снапшота внутри `Batcher.run`.


## Формат конфигурации

Поддерживается подмножество `MachineConfig` из XState v5. Всё, что в таблицах ниже не перечислено, **отклоняется** в `createMachine()` (см. [Что не поддерживается](#что-не-поддерживается)).

### Ключи стейт-ноды

| Ключ | Значение | Примечания |
|---|---|---|
| `id` | `string` | уникальный id для таргетов `#id`; по умолчанию `<machineId>.<путь>` |
| `type` | `"atomic" \| "compound" \| "parallel" \| "final" \| "history"` | выводится из `states` / `history`, если не указан |
| `initial` | `string` | ключ начального дочернего состояния (только `compound`); только строка, объектная форма XState не принимается |
| `states` | `Record<string, StateNodeConfig>` | вложенные состояния; ключи без `.` |
| `on` | `Record<EventDescriptor, Transition>` | переходы по событиям |
| `always` | `Transition` | eventless-переходы, перепроверяются после каждого микрошага |
| `after` | `Record<number \| string, Transition>` | отложенные переходы: миллисекунды или именованная задержка из `delays` |
| `entry` / `exit` | `Actions` | действия при входе / выходе |
| `onDone` | `Transition` | для `compound` (достигнут финальный потомок) и `parallel` (все регионы финальны); на корне запрещён |
| `history` | `"shallow" \| "deep" \| true` | только для history-нод; `true` = `"shallow"` |
| `target` | `string` | таргет history-ноды по умолчанию, если история ещё не записана |
| `output` | значение или `({ context, event }) => value` | только для `final` и корня |
| `tags` | `string \| string[]` | попадают в `snapshot.tags` |
| `description`, `meta` | `string`, plain object | данные для тулинга, в рантайме не используются |

Корень дополнительно принимает:

| Ключ | Значение | Примечания |
|---|---|---|
| `context` | объект или `() => объект` | объект **разделяется всеми инстансами** (как в XState); для объектов на инстанс используйте фабрику |
| `types` | `{ context?, events?, output?, tags?, meta? }` | только для вывода типов, в рантайме игнорируется |
| `output` | значение или `({ context, event }) => value` | результат машины при входе в финальное состояние верхнего уровня |

Корень должен быть `compound` (есть `states` и `initial`) или `parallel`.

### Переходы

Значение перехода в `on` / `after` / `always` / `onDone`:

- строка-таргет: `TIMER: "red"`;
- объект: `{ target?, actions?, guard?, reenter?, description?, meta? }`;
- массив объектов — **выигрывает первый с прошедшим гвардом**;
- `target` может быть массивом только для одновременного входа в несколько регионов одного `parallel`-состояния;
- без `target` — targetless-переход: действия выполняются, состояние не меняется (`exit`/`entry` не срабатывают);
- `reenter: true` — выйти и заново войти в исходное состояние, даже если цель — его потомок (по умолчанию `false`, как в XState v5).

Форматы таргетов:

| Таргет | Разрешается как |
|---|---|
| `"sibling"` | ключ соседнего состояния (относительно родителя); `"sibling.child"` спускается в потомков |
| `".child"` | относительно самого исходного состояния |
| `"#id"` | по id стейт-ноды |
| `"#id.child.path"` | по id и дальше по ключам потомков |

Ключи `on`: точный тип события (`"TIMER"`), частичный wildcard (`"user.*"`) и catch-all `"*"`.

```typescript
import { createMachine } from "@fozy-labs/rx-toolkit";

type PlayerEvent =
    | { type: "PLAY" }
    | { type: "PAUSE" }
    | { type: "RESUME" }
    | { type: "SPEED" }
    | { type: "STOP" }
    | { type: "log.info"; message: string }
    | { type: "log.error"; message: string };

export const player = createMachine({
    id: "player",
    initial: "idle",
    types: {} as { events: PlayerEvent },
    states: {
        idle: { on: { PLAY: "playing" } },
        playing: {
            initial: "normal",
            states: {
                normal: { on: { SPEED: "fast" } },
                fast: { on: { SPEED: "normal" } },
                // history-нода: RESUME возвращает в последний активный подрежим
                hist: { type: "history", history: "shallow" },
            },
            on: {
                PAUSE: "paused",
                STOP: { target: "#player.stopped", reenter: true },
            },
        },
        paused: { on: { RESUME: "playing.hist" } },
        stopped: { type: "final" },
    },
    on: {
        // wildcard по префиксу — обработать любое событие log.*
        "log.*": { actions: ({ event }) => console.log(event.message) },
    },
});
```

### Параллельные и финальные состояния, `onDone`, `output`

```typescript
import { createMachine } from "@fozy-labs/rx-toolkit";

type WizardEvent = { type: "NEXT" } | { type: "TOGGLE" } | { type: "RESET" };

export const wizard = createMachine({
    id: "wizard",
    type: "parallel",
    types: {} as { events: WizardEvent },
    states: {
        form: {
            initial: "step1",
            states: {
                step1: { on: { NEXT: "step2" } },
                step2: { on: { NEXT: "done" } },
                done: { type: "final", output: { submitted: true } },
            },
            // сработает, когда регион form дойдёт до финального потомка
            onDone: { actions: ({ event }) => console.log(event.output) },
        },
        theme: {
            initial: "light",
            states: {
                light: { on: { TOGGLE: "dark" } },
                dark: { on: { TOGGLE: "light" } },
            },
        },
    },
});
```

Событие `onDone` имеет тип `xstate.done.state.<id>` и несёт `output` финального потомка. Вход в финальное состояние **верхнего уровня** завершает машину: `snapshot.status` становится `"done"`, `snapshot.output` — результат корневого `output`, таймеры снимаются, дальнейшие события игнорируются.

### Типизация

- `createMachine<TContext, TEvent, TOutput>(config, implementations?)`. `TContext` выводится из `context` / `types.context`, `TEvent` — из `types.events` (по умолчанию `AnyEventObject` — любой `{ type: string }` с `unknown`-полями), `TOutput` — из `types.output`.
- Внутри `on.<EVENT>` тип `event` сужается до соответствующего члена объединения (как `ExtractEvent` в XState); в `entry`/`exit`/`always`/`after` `event` — всё объединение целиком.
- Экспортируемые типы: `MachineConfig`, `StateNodeConfig`, `TransitionConfig`, `EventObject`, `AnyEventObject`, `StateValue`, `MachineSnapshot`, `MachineImplementations`, `StatechartOptions`, `MachineStateSignal` и др. — все из корня пакета.

### Что не поддерживается

Любой из следующих ключей роняет `createMachine()` с `MachineConfigError`, чей `message` содержит путь до проблемного объекта (`states.foo.on.BAR[0]: 'invoke' is not supported`):

| Категория | Ключи / конструкции |
|---|---|
| Акторная модель | `invoke`, `spawn`, `services`, `actors`, `system`, `input`, `sendTo`, `sendParent`, `stopChild` |
| Прочее XState v5 | `emit`, `enqueueActions`, `strict`, `onDone` на корне, `initial` в объектной форме |
| Зарезервированные события в `on` | `xstate.init` и `xstate.stop` (переход по ним никогда не выбирается), `xstate.error.*`, `xstate.done.actor.*`, `xstate.snapshot.*`, `xstate.promise.*` (события акторной системы). Wildcard `xstate.*` и семейства `xstate.done.state.*` / `xstate.after.*` разрешены — они срабатывают, как в XState |
| Только XState v4 | `cond` (→ `guard`), `internal` (→ `reenter: false`), `in` (→ `stateIn()`), `activities`, `predictableActionArguments`, `preserveActionOrder`, `schema`, `tsTypes` |
| Неизвестные ключи | любые другие ключи стейт-ноды, перехода, объекта `{ type, params }` или таблицы реализаций |
| Builtin-объекты вручную | `{ type: "xstate.assign", ... }` — используйте экспортируемые `assign()` и т. д. |
| Креаторы из пакета `xstate` | `assign`, `raise`, `cancel`, `log`, `and`, `or`, `not`, `stateIn`, импортированные из `xstate` (а также `sendTo`, `sendParent`, `forwardTo`, `enqueueActions`, `emit`, `spawnChild`, `stopChild`) — это обычные функции без нашего бренда, которые выполнились бы как пустые no-op; отклоняются и в конфиге, и в таблице реализаций. Используйте креаторы из `@fozy-labs/rx-toolkit` |

```typescript
import { createMachine, MachineConfigError } from "@fozy-labs/rx-toolkit";

try {
    createMachine({
        initial: "a",
        states: {
            a: { on: { GO: { target: "b", cond: "isOk" } } } as never,
            b: {},
        },
    });
} catch (error) {
    if (error instanceof MachineConfigError) {
        console.log(error.path); // "states.a.on.GO[0]"
        console.log(error.detail); // "'cond' has been renamed to 'guard'"
    }
}
```

Имена действий / гвардов / задержек, которых нет в таблице реализаций, проверяются **лениво** — при создании инстанса (`MachineSignal.state()` / `new Statechart()`), чтобы `definition.provide()` мог дополнить таблицу после `createMachine()`.


## Реализации: actions, guards, delays

Второй аргумент `createMachine` (и аргумент `provide()`):

```typescript
interface MachineImplementations<TContext, TEvent> {
    actions?: Record<string, ActionImplementation>; // (args, params) => void  |  builtin-действие
    guards?: Record<string, GuardImplementation>; // (args, params) => boolean |  builtin-гвард
    delays?: Record<string, DelayImplementation>; // number | (args, params) => number
}
```

`args` — всегда `{ context, event }`. Реализации из таблицы получают `params` из ссылки `{ type, params }` в конфиге; их тип на уровне таблицы не выводится, поэтому объявляйте параметр явно.

### Формы действий и гвардов в конфиге

| Форма | Действие | Гвард |
|---|---|---|
| Имя из таблицы | `"warn"` | `"isReady"` |
| Ссылка с параметрами | `{ type: "notify", params: { level: "info" } }` | `{ type: "isAbove", params: { limit: 10 } }` |
| Параметры из аргументов | `{ type: "notify", params: ({ event }) => ({ ... }) }` | аналогично |
| Инлайн-функция | `({ context, event }) => { ... }` | `({ context }) => boolean` |
| Builtin | `assign(...)`, `raise(...)`, `cancel(...)`, `log(...)` | `and([...])`, `or([...])`, `not(...)`, `stateIn(...)` |

Инлайн-функции удобны в прототипах, но в инспекторе и экспорте они видны только по имени функции (анонимные — как `anonymous`). Для машин, которые вы собираетесь смотреть в Stately, предпочитайте имена из таблицы.

```typescript
import { createMachine } from "@fozy-labs/rx-toolkit";

interface CounterContext {
    count: number;
}

type CounterEvent = { type: "INC"; by: number } | { type: "RESET" };

export const counter = createMachine(
    {
        id: "counter",
        initial: "active",
        context: { count: 0 },
        types: {} as { context: CounterContext; events: CounterEvent },
        states: {
            active: {
                on: {
                    INC: [
                        // первый переход с прошедшим гвардом выигрывает
                        { guard: { type: "isAbove", params: { limit: 100 } }, target: "overflow" },
                        { actions: { type: "notify", params: ({ event }) => ({ text: `+${event.by}` }) } },
                    ],
                    RESET: { actions: "reset" },
                },
            },
            overflow: { type: "final" },
        },
    },
    {
        actions: {
            notify: (_args, params: { text: string }) => console.log(params.text),
            reset: ({ context }) => console.log(`reset from ${context.count}`),
        },
        guards: {
            isAbove: ({ context }, params: { limit: number }) => context.count > params.limit,
        },
    },
);
```

Порядок выполнения действий — как в XState v5: `exit` исходных состояний → действия перехода → `entry` целевых; `assign` применяется в том же порядке, и последующие действия уже видят обновлённый `context`. Пользовательские действия исполняются синхронно внутри макрошага, **до** публикации нового снапшота — `peek()` изнутри действия вернёт ещё предыдущий снапшот.

### Builtin-действия

Импортируются из корня пакета. Это декларативные объекты (технически — замороженные функции с брендом, как в XState); **вызывать их напрямую нельзя**, только класть в `entry` / `exit` / `actions` или в таблицу `actions`.

| Builtin | Описание |
|---|---|
| `assign(partial \| ({ context, event }) => partial)` | обновляет `context` shallow-merge'ем; в объектной форме каждое поле — значение или функция `({ context, event }) => value` |
| `raise(event \| ({ context, event }) => event, { delay?, id? }?)` | отправляет событие самой машине: без `delay` — во внутреннюю очередь текущего макрошага, с `delay` — по таймеру (`delay` — миллисекунды, имя из `delays` или функция) |
| `cancel(id \| ({ context, event }) => id)` | отменяет отложенный `raise` по его `id` (или `after`-таймер по типу его события `xstate.after.<delay>.<id>`) |
| `log(value? \| ({ context, event }) => value, label?)` | пишет в `logger` инстанса (по умолчанию `console.log`); без аргументов — `{ context, event }` |

```typescript
import { assign, cancel, createMachine, log, raise } from "@fozy-labs/rx-toolkit";

interface SearchContext {
    query: string;
}

type SearchEvent = { type: "TYPE"; value: string } | { type: "SEARCH" } | { type: "RESULTS" };

export const search = createMachine(
    {
        id: "search",
        initial: "idle",
        context: { query: "" },
        types: {} as { context: SearchContext; events: SearchEvent },
        states: {
            idle: {
                on: {
                    TYPE: {
                        actions: [
                            assign({ query: ({ event }) => event.value }),
                            // дебаунс: перезапланировать SEARCH, отменив предыдущий
                            cancel("debounce"),
                            raise({ type: "SEARCH" }, { delay: "debounce", id: "debounce" }),
                        ],
                    },
                    SEARCH: { target: "searching", guard: "hasQuery" },
                },
            },
            searching: {
                entry: log(({ context }) => `searching: ${context.query}`, "search"),
                on: { RESULTS: "idle" },
            },
        },
    },
    {
        guards: { hasQuery: ({ context }) => context.query.length > 0 },
        delays: { debounce: 300 },
    },
);
```

### Builtin-гварды

| Builtin | Описание |
|---|---|
| `and([g1, g2, ...])` | все гварды истинны |
| `or([g1, g2, ...])` | хотя бы один истинен |
| `not(g)` | отрицание |
| `stateIn(stateValue)` | машина находится в состоянии: `"#id"` проверяет членство ноды, любая другая строка/объект — семантика `matches()` |

Аргументы комбинаторов — те же формы гвардов: имена, `{ type, params }`, инлайн-предикаты, другие builtin'ы. Builtin-гвард можно положить и в таблицу `guards` под именем; именованные гварды не должны ссылаться друг на друга по кругу — это проверяется при создании инстанса.

```typescript
import { and, createMachine, not, or, stateIn } from "@fozy-labs/rx-toolkit";

interface DoorContext {
    locked: boolean;
    alarmArmed: boolean;
}

type DoorEvent = { type: "OPEN" } | { type: "TOGGLE_LIGHT" };

export const house = createMachine(
    {
        id: "house",
        type: "parallel",
        context: { locked: true, alarmArmed: false },
        types: {} as { context: DoorContext; events: DoorEvent },
        states: {
            door: {
                initial: "closed",
                states: {
                    closed: {
                        on: {
                            OPEN: {
                                target: "open",
                                guard: and([not("isLocked"), or([stateIn("#house.light.on"), "isDaytime"])]),
                            },
                        },
                    },
                    open: {},
                },
            },
            light: {
                initial: "off",
                states: {
                    off: { on: { TOGGLE_LIGHT: "on" } },
                    on: { on: { TOGGLE_LIGHT: "off" } },
                },
            },
        },
    },
    {
        guards: {
            isLocked: ({ context }) => context.locked,
            isDaytime: () => new Date().getHours() < 20,
            // builtin-гвард под именем
            canOpen: not("isLocked"),
        },
    },
);
```

### Задержки

`after`-ключи и `delay` у `raise` могут быть числом (миллисекунды) или именем из `delays`. Реализация задержки — число либо функция `({ context, event }, params) => number`; результат, не являющийся числом, приводит к ошибке рантайма (XState в таком случае поднял бы событие немедленно).


## MachineSignal.state

```typescript
MachineSignal.state(definition, options?): MachineStateSignal<TContext, TEvent, TOutput>
```

`options` — объект `StatechartOptions` или просто строка-ключ для devtools (как `Signal.state(value, "key")`).

### Опции

| Опция | По умолчанию | Описание |
|---|---|---|
| `key` | `"Statechart/<machine id>"` | ключ в Redux DevTools; семантика как у `SignalOptions.key` с `base: "Statechart"` (`{base}` → `Statechart`). Без ключа первый живой инстанс описания получает `Statechart/<machine id>`, одновременно живущие с ним инстансы того же описания — `Statechart/<machine id>#2`, `#3`, … (наименьший свободный номер; освобождается в `dispose()`). Для стабильного осмысленного имени задавайте ключ |
| `isDisabled` | `undefined` | отключить Redux DevTools для инстанса |
| `inspector` | `SharedOptions.MACHINE_DEVTOOLS` | адаптер Stately Inspector; `null` отключает |
| `autoStart` | `true` | вызвать `start()` в конструкторе. При `false` начальный снапшот всё равно вычисляется, но его эффекты и очередь событий ждут первого `start()` |
| `clock` | `globalThis` | `{ setTimeout, clearTimeout }` для `after` и отложенных `raise`; подменяется в тестах |
| `onError` | `undefined` | приёмник ошибок рантайма; без него ошибка бросается из `send()` / `start()` |
| `logger` | `console.log` | приёмник builtin'а `log()` |
| `maxMicrosteps` | `10000` | защита от бесконечных `always` / `raise`-циклов в одном макрошаге |

### Члены callable-сигнала

| Член | Описание |
|---|---|
| `()` / `get()` | текущий снапшот с регистрацией зависимости (внутри `Computed` / `Effect`) |
| `peek()` | снапшот без регистрации зависимости |
| `obs` | `Observable<MachineSnapshot>` — публикация раз в макрошаг, только при изменении |
| `definition` | исходное `MachineDefinition` |
| `status` | статус **движка**: `"idle"` до `start()`, `"running"`, `"stopped"` после `stop()` / done / error, `"disposed"` |
| `send(event)` | синхронно обработать событие (один макрошаг). До `start()` — в очередь; после stop / done / error / dispose — игнорируется |
| `matches(stateValue)` | находится ли машина в состоянии (семантика XState `matches`) |
| `can(event)` | выберет ли событие хотя бы один незапрещённый переход на текущем снапшоте |
| `start()` | запустить (после `stop()` / done / error — переинициализация с нуля); после `dispose()` бросает |
| `stop()` | обработать `xstate.stop`: снапшот со `status: "stopped"`, таймеры сняты, очередь очищена; `exit`-действия **не** выполняются (как в XState) |
| `dispose()` / `[Symbol.dispose]` | остановить, завершить сигнал (убрать из DevTools), отпустить инспектор. Идемпотентно |

### Снапшот

```typescript
type MachineSnapshot<TContext, TOutput> = {
    readonly status: "active" | "done" | "error" | "stopped";
    readonly value: StateValue; // "green" | { playing: "fast" } | { form: "step1", theme: "dark" }
    readonly context: TContext;
    readonly tags: readonly string[]; // теги всех активных нод
    readonly output: TOutput | undefined; // только при status: "done"
    readonly error: unknown; // только при status: "error"
};
```

Снапшот — неизменяемый объект; новый создаётся только когда макрошаг что-то изменил, иначе ссылка стабильна (`Object.is`), и производные сигналы не пересчитываются. Тип — размеченное объединение по `status`, поэтому после проверки `snapshot.status === "done"` поле `output` имеет тип `TOutput`.

Не путайте два статуса: `light$.status` описывает движок (запущен / остановлен / освобождён), `light$().status` — состояние самой машины по XState.

### matches и can

```typescript
import { MachineSignal } from "@fozy-labs/rx-toolkit";

const player$ = MachineSignal.state(player);
player$.send({ type: "PLAY" });

player$.matches("playing"); // true — частичное совпадение по родителю
player$.matches("playing.normal"); // true — путь строкой
player$.matches({ playing: "normal" }); // true — вложенный объект
player$.matches("paused"); // false

player$.can({ type: "PAUSE" }); // true
player$.can({ type: "RESUME" }); // false
```

`can()` — чистый запрос к текущему снапшоту: работает и на незапущенном (`autoStart: false`) инстансе. На снапшоте со `status` отличным от `"active"` и после `dispose()` всегда `false`.

### Жизненный цикл движка

```mermaid
stateDiagram-v2
    [*] --> idle : конструктор (начальный макрошаг вычислен, эффекты отложены)
    idle --> running : start()
    running --> stopped : stop() / status done / status error
    stopped --> running : start() — переинициализация с нуля
    idle --> disposed : dispose()
    running --> disposed : dispose()
    stopped --> disposed : dispose()
```

При `autoStart: true` (по умолчанию) инстанс сразу оказывается в `running`. `send()` из действия (реентерабельный вызов) ставится в очередь и обрабатывается после текущего макрошага — поведение XState; все снапшоты такой серии публикуются в одном `Batcher.run`.

То же относится к вызовам из синхронных подписчиков `obs` и из `Signal.effect` / `Computed`, реагирующих на новый снапшот: события, отправленные во время серии, дообрабатываются, пока очередь не опустеет (каждый раунд — свой `Batcher.run`, так что эффекты видят каждый снапшот). `stop()` и `dispose()` изнутри серии откладываются до её конца. `start()` изнутри серии (например, эффект, перезапускающий машину по `done` / `error` / `stopped`) выполняется после серии — и после `onError`; если ошибка серии не обработана (нет `onError`), она бросается из `send()`, а запрошенный перезапуск отбрасывается: машина остаётся в состоянии `error`, согласованном с исключением.

### Таймеры

- `after: { 3000: "yellow" }` планирует событие `xstate.after.3000.<id ноды>` через `clock.setTimeout`; выход из состояния снимает таймер.
- `raise(event, { delay, id })` — отложенное событие; `cancel(id)` его отменяет. Повторный `raise` с тем же `id` при ещё живом таймере **заменяет** его (XState оставил бы оба таймера).
- `stop()`, `dispose()`, вход в финальное состояние верхнего уровня и ошибка снимают все таймеры.
- Отложенные события доставляются через ту же очередь, что и `send()`, поэтому таймер, сработавший во время обработки другого события, не вклинивается в середину макрошага.

Для тестов подменяйте `clock` или используйте `vi.useFakeTimers()`: клок по умолчанию обращается к `globalThis.setTimeout` в момент вызова, так что фейковые таймеры, установленные после импорта, работают.

### Ошибки

Ошибка, брошенная действием, гвардом, задержкой, `output`-маппером или защитой от бесконечного цикла:

1. публикуется снапшот со `status: "error"` и полем `error` поверх последнего корректного состояния (`value` / `context` сохраняются);
2. таймеры снимаются, очередь очищается, движок переходит в `stopped`, последующие события игнорируются;
3. если задан `options.onError` — он вызывается после завершения батча; иначе ошибка бросается из `send()` / `start()` (или из конструктора при `autoStart`). Ошибка из таймерного события без `onError` всплывает как необработанное исключение колбэка таймера.

Ошибка на начальном макрошаге (например, бросающий начальный `assign`) даёт снапшот `status: "error"` с пред-инициализационными `value` / `context` и синхронный throw из конструктора / `start()`; XState в этой ситуации отдал бы пустой `{ status: "error", error }` асинхронно.

После ошибки машину можно перезапустить: `start()` переинициализирует её с нуля — в том числе из `onError` или из `Signal.effect`, реагирующего на снапшот со `status: "error"` (перезапуск из эффекта выполняется после `onError`; без `onError` ошибка бросается из `send()`, а перезапуск отбрасывается).

```typescript
import { MachineSignal } from "@fozy-labs/rx-toolkit";

const counter$ = MachineSignal.state(counter, {
    key: "counter",
    onError: (error) => console.error("machine failed", error),
});

if (counter$().status === "error") {
    counter$.start(); // свежий context, начальное состояние
}
```

### Класс Statechart

`MachineSignal.state()` — тонкий фасад над движком `Statechart`; тот экспортируется для продвинутой композиции (например, когда движок нужно хранить как поле класса). Это те же опции и те же методы, но снапшот лежит в поле `state: ReadonlySignal<MachineSnapshot>`, а не в самом объекте; дополнительно есть `getSnapshot()` (алиас `state.peek()`) и `sessionId` (id сессии в инспекторе).

```typescript
import { Statechart } from "@fozy-labs/rx-toolkit";

const engine = new Statechart(trafficLight, { key: "trafficLight/engine" });

engine.state(); // MachineSnapshot — чтение с отслеживанием
engine.state.peek().value;
engine.send({ type: "TIMER" });
engine.status; // "running"
engine.dispose();
```

Соотношение `MachineSignal` / `Statechart` такое же, как `Signal.state` / `State` и `LocalSignal.state` / `LocalState` в [сигналах][signals].


## Интеграция с сигналами и React

Снапшот машины — обычный сигнал: его можно читать в `Computed` / `Effect`, комбинировать через RxJS и передавать в `useSignal`.

```typescript
import { Signal } from "@fozy-labs/rx-toolkit";

const light$ = MachineSignal.state(trafficLight, "trafficLight");

const isStopSignal$ = Signal.compute(() => light$.matches("red") || light$.matches("yellow"));

const dispose = Signal.effect(() => {
    console.log(`light: ${JSON.stringify(light$().value)}, cycles: ${light$().context.cycles}`);
});
```

Обратите внимание: `matches()` / `can()` читают текущий снапшот **без** регистрации зависимости. Чтобы `Computed` пересчитывался, прочитайте сигнал явно (`light$()`) или вычисляйте из его значения (`light$().value`).

В React:

```tsx
import { useSignal } from "@fozy-labs/rx-toolkit";

function TrafficLight() {
    const snapshot = useSignal(light$);

    return (
        <div>
            <span>{String(snapshot.value)}</span>
            <button onClick={() => light$.send({ type: "TIMER" })} disabled={!light$.can({ type: "TIMER" })}>
                Далее
            </button>
        </div>
    );
}
```

Отдельного React-хука у модуля нет; `useSignal` достаточно, поскольку `MachineStateSignal` реализует `obs` / `peek`.

Инстанс на время жизни компонента создавайте через ленивый инициализатор `useState(() => MachineSignal.state(...))`.
Callable-сигнал — это функция, поэтому в `useState` / `setState` его нужно передавать **только через thunk**:
`setMachine$(() => MachineSignal.state(def))`. Прямой вызов `setMachine$(MachineSignal.state(def))` React воспримет как
updater, вызовет его и сохранит возвращённый снапшот вместо сигнала (симптом — `signal$.peek is not a function` в `useSignal`). Про правила использования сигналов в React — [React интеграция][react].


## Devtools

Подробности — в [документации по devtools][devtools].

- **Redux DevTools.** Снапшот живёт в `State` с `base: "Statechart"`: без ключа запись называется `Statechart/<machine id>` (одновременно живущие инстансы того же описания — `Statechart/<machine id>#2`, `#3`, …), с ключом — как вы указали. Каждый макрошаг публикуется с именем действия, равным типу события (`TIMER`, `xstate.init`, `xstate.after.3000.trafficLight.green`, `xstate.stop`). `dispose()` убирает запись.
- **Stately Inspector.** Адаптер `statelyInspector()` без зависимостей воспроизводит протокол `@statelyai/inspect`: открывает `https://stately.ai/inspect` в окне или iframe, регистрирует каждый инстанс, отправляет события и снапшоты. Инспектор получает JSON конфига (функции — как `{ type: fn.name }`), поэтому именованные реализации выглядят в нём осмысленно. Канал односторонний: отправлять события в приложение из инспектора нельзя. Адаптер — best-effort: если он бросил исключение, машина продолжает работать, ошибка один раз логируется через `console.error`, а инспектор для этого инстанса отключается.

```typescript
import { DefaultOptions, statelyInspector } from "@fozy-labs/rx-toolkit";

// глобально — для всех машин
DefaultOptions.update({ MACHINE_DEVTOOLS: statelyInspector() });

// или на конкретный инстанс
const inspected$ = MachineSignal.state(trafficLight, {
    key: "trafficLight/inspected",
    inspector: statelyInspector({ iframe: document.querySelector("iframe") }),
});

// выключить для инстанса
const silent$ = MachineSignal.state(trafficLight, { key: "trafficLight/silent", inspector: null });
```


## Экспорт в Stately Studio: toXStateSource

`definition.toXStateSource(options?)` печатает готовый к вставке модуль с вызовом `createMachine({...})` — ровно то, что понимает Stately Studio «Import from code» и `@xstate/machine-extractor`.

```typescript
console.log(trafficLight.toXStateSource());
```

```typescript
import { createMachine, assign } from "xstate";

export const trafficLight = createMachine({
    id: "trafficLight",
    initial: "green",
    context: {
        ready: false,
        cycles: 0,
    },
    states: {
        green: {
            after: {
                3000: "yellow",
            },
        },
        yellow: {
            on: {
                TIMER: {
                    target: "red",
                    guard: "isReady",
                    actions: "warn",
                },
            },
        },
        red: {
            on: {
                TIMER: {
                    target: "green",
                    actions: assign({
                        cycles: cycles,
                    }),
                },
            },
        },
    },
    on: {
        SET_READY: {
            actions: assign({
                ready: ready,
            }),
        },
    },
});
```

Опции `ToXStateSourceOptions`:

| Опция | По умолчанию | Описание |
|---|---|---|
| `exportName` | id машины как идентификатор (`"machine"`, если id нет) | имя экспортируемой константы |
| `includeImport` | `true` | строка `import { createMachine, ... } from "xstate"` с фактически использованными builtin'ами |
| `includeImplementations` | `false` | вторым аргументом печатается таблица реализаций; функции — идентификаторами по своему `name` |
| `indent` | `4` | пробелов на уровень |

Функции в конфиге (инлайн-действия, гварды, функции внутри builtin'ов, `context`-фабрика) печатаются **идентификаторами по своему `name`** — в примере выше стрелки из `assign({ cycles: ... })` стали `cycles`, анонимные функции печатаются как `anonymous`. Такой модуль пригоден для импорта диаграммы, но не для исполнения без доопределения этих идентификаторов. Ключ `types` не печатается; `satisfies` никогда не печатается.

### Правило для исходного кода

Экстрактор Stately и «Import from code» работают на уровне AST и не резолвят импорты. Чтобы ваш исходник читался тулингом напрямую (без `toXStateSource()`):

- вызов должен называться `createMachine` — источник импорта не проверяется, `@fozy-labs/rx-toolkit` для экстрактора неотличим от `xstate`;
- конфиг — литералом внутри вызова или переменной, объявленной **в том же файле**;
- **никакого `satisfies`** — экстрактор его не парсит и молча пропускает машину. `config as Type` допустим.


## Экспорт в Mermaid: toMermaid

`definition.toMermaid(options?)` возвращает `stateDiagram-v2`: вложенные состояния — блоками, регионы `parallel` — через `--`, `[*]` для начальных и финальных, переходы с подписью `EVENT [guard] / action`, history-ноды с `default`-стрелкой, `entry` / `exit` — заметками.

```typescript
console.log(trafficLight.toMermaid({ direction: "LR" }));
```

```mermaid
stateDiagram-v2
    direction LR
    state "trafficLight" as trafficLight
    state trafficLight {
        state "green" as trafficLight_green
        state "yellow" as trafficLight_yellow
        state "red" as trafficLight_red
        [*] --> trafficLight_green
    }
    trafficLight --> trafficLight : SET_READY / assign
    trafficLight_green --> trafficLight_yellow : after 3000
    trafficLight_yellow --> trafficLight_red : TIMER [isReady] / warn
    trafficLight_red --> trafficLight_green : TIMER / assign
```

Корень обычно не рисуется (его дети лежат на верхнем уровне); он становится отдельным составным состоянием только когда к нему нужно что-то привязать — как здесь, из-за перехода `SET_READY` на корне.

Опции `ToMermaidOptions`:

| Опция | По умолчанию | Описание |
|---|---|---|
| `direction` | `"TB"` | `"TB"` или `"LR"` |
| `includeActions` | `true` | `/ action1, action2` в подписях переходов, заметки для `entry` / `exit` |
| `includeGuards` | `true` | `[guard]` в подписях переходов |

Вывод детерминирован (порядок документа), поэтому диаграмму можно хранить в репозитории и проверять снапшот-тестом.


## Тестирование

### provide(): подмена реализаций

`definition.provide({ actions?, guards?, delays? })` возвращает **новое** описание с объединёнными таблицами (новые значения побеждают). Форма реализаций проверяется сразу, соответствие именам из конфига — при создании инстанса. Это позволяет описывать машину с пустой таблицей и заполнять её в тестах, либо подменять побочные эффекты.

```typescript
import { MachineSignal } from "@fozy-labs/rx-toolkit";

it("switches to red only when ready", () => {
    const warn = vi.fn();
    const testLight = trafficLight.provide({
        actions: { warn },
        guards: { isReady: () => true },
    });

    const light$ = MachineSignal.state(testLight, { key: "test", isDisabled: true, inspector: null });
    light$.send({ type: "TIMER" }); // green: перехода по TIMER нет
    expect(light$.peek().value).toBe("green");
    expect(warn).not.toHaveBeenCalled();

    light$.dispose();
});
```

### Таймеры и часы

Для детерминированных тестов `after` / отложенных `raise` либо используйте `vi.useFakeTimers()` до создания инстанса, либо передайте собственный `clock`:

```typescript
import { MachineSignal, type MachineClock } from "@fozy-labs/rx-toolkit";

it("goes yellow after the delay", () => {
    vi.useFakeTimers();
    const light$ = MachineSignal.state(trafficLight, { isDisabled: true, inspector: null });

    vi.advanceTimersByTime(3000);
    expect(light$.peek().value).toBe("yellow");

    light$.dispose();
    vi.useRealTimers();
});

// ручные часы: таймеры срабатывают по вызову flush()
function createManualClock(): MachineClock & { flush(): void } {
    const pending = new Map<number, () => void>();
    let id = 0;
    return {
        setTimeout: (callback) => {
            pending.set(++id, callback);
            return id;
        },
        clearTimeout: (handle) => {
            pending.delete(handle as number);
        },
        flush: () => {
            const callbacks = [...pending.values()];
            pending.clear();
            callbacks.forEach((callback) => callback());
        },
    };
}
```

### Что ещё полезно в тестах

- `isDisabled: true` и `inspector: null` отключают devtools для инстанса, чтобы тесты не зависели от глобальных `DefaultOptions`.
- `autoStart: false` позволяет проверить начальный снапшот и `can()` до запуска, а затем накопить события в очереди и запустить `start()`.
- `onError` превращает ошибки действий в проверяемые вызовы вместо исключений из `send()`.
- `MachineConfigError` имеет поля `path` и `detail` — удобно для точечных проверок валидации.


## Отличия от XState v5

Семантика переходов сверена с `xstate@5.32.5` дифференциальными тестами; сознательные отличия перечислены здесь.

| Область | Отличие |
|---|---|
| Область поддержки | нет акторной модели (`invoke`, `spawn`, `system`, `input`, `emit`, `sendTo` и т. д.) — такие ключи отклоняются в `createMachine()` |
| `initial` | только строка; объектная форма `{ target, actions }` не принимается |
| `onDone` на корне | ошибка конфига (XState принимает, но переход никогда не срабатывает) |
| `assign` | shallow-merge, как в XState; Immer не используется |
| Повторный `raise` с тем же `id` | заменяет ещё живой таймер (XState держит оба, `cancel` достаёт только последний) |
| Именованная задержка, вернувшая не число | ошибка рантайма (XState поднимает событие немедленно) |
| `can()` | `false` на снапшоте со `status` не `"active"` и после `dispose()` |
| `start()` после stop / done / error | переинициализация с нуля (в XState поведение перезапуска не определено) |
| Ошибки при инициализации | снапшот сохраняет пред-инициализационные `value` / `context`, throw синхронный |
| События после stop / done / error / dispose | игнорируются; `start()` после `dispose()` бросает |
| Лимит микрошагов | опция инстанса `maxMicrosteps` вместо ключа конфига `maxIterations` |
| `snapshot.tags` | массив `readonly string[]`, а не `Set` |
| `xstate.init` / `xstate.stop` / события акторной системы в `on` | ошибка конфига (XState принимает, но переход никогда не срабатывает) |
| Креаторы `assign` и др., импортированные из пакета `xstate` | ошибка конфига (у нас они выполнились бы как пустые no-op) |
| `definition.config` | тот же объект, что передан в `createMachine`, глубоко заморожен после валидации (кроме объекта `context`) и типизирован как read-only |


[signals]: ../signals/README.md
[react]: ../usage/react/README.md
[devtools]: ../devtools/README.md
