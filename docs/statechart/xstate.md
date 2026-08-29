# Совместимость с XState и Stately

Конфиг, который принимает `createMachine()`, — подмножество `MachineConfig` из XState v5, а системные события носят префикс `xstate.`. Это плата за сторонний тулинг: такой конфиг читают Stately Studio («Import from code»), `@xstate/machine-extractor` и Stately Inspector. Пакет `xstate` **не является зависимостью**: в `devDependencies` он нужен только как оракул дифференциальных тестов (`xstate@5.32.5`).

Знать что-либо отсюда не обязательно. Модуль описан в [README](./README.md) в собственных терминах, диаграмму машины показывает `StatechartViz` из [fozy-labs/statechart][statechart-repo], а авторинг идёт через `.mmd` — без сторонних сервисов и без их проприетарной экосистемы. Этот документ — единственный дом фактов о совместимости; в остальной документации их нет.

## Содержание

- [Системные события](#системные-события)
- [Что отклоняется в createMachine](#что-отклоняется-в-createmachine)
- [Отличия семантики](#отличия-семантики)
- [Экспорт: toXStateSource](#экспорт-toxstatesource)
- [Правило для исходного кода](#правило-для-исходного-кода)
- [Stately Inspector](#stately-inspector)


## Системные события

Рантайм поднимает события с префиксом `xstate.` — он сохранён, чтобы инспектор и экстрактор узнавали их наравне с событиями машины XState.

| Событие | Когда |
|---|---|
| `xstate.init` | начальный макрошаг; всегда несёт ключ `input` (у нас — `undefined`, акторов нет) |
| `xstate.stop` | `stop()` инстанса |
| `xstate.done.state.<id стейт-ноды>` | `compound` дошёл до финального потомка или все регионы `parallel` финальны; несёт `output` |
| `xstate.after.<задержка>.<id стейт-ноды>` | сработал таймер `after`; `cancel()` по этому же типу снимает таймер |

Переход по `xstate.init` и `xstate.stop` объявить нельзя (см. ниже). Семейства `xstate.done.state.*` и `xstate.after.*`, как и wildcard `xstate.*`, в `on` разрешены и срабатывают.


## Что отклоняется в createMachine

Помимо общих правил валидации ([Что не поддерживается](./README.md#что-не-поддерживается)) отклоняются конструкции чужих диалектов — с `MachineConfigError`, чей `detail` называет замену.

| Категория | Ключи / конструкции |
|---|---|
| Акторная модель XState v5 | `invoke`, `spawn`, `services`, `actors`, `system`, `input`, `sendTo`, `sendParent`, `stopChild` |
| Прочее из XState v5 | `emit`, `enqueueActions`, `strict`, `onDone` на корне, `initial` в объектной форме |
| Только XState v4 | `cond` (→ `guard`), `internal` (→ `reenter: false`), `in` (→ `stateIn()`), `activities`, `predictableActionArguments`, `preserveActionOrder`, `schema`, `tsTypes` |
| Зарезервированные события в `on` | `xstate.init`, `xstate.stop` (переход по ним никогда не выбирался бы), а также события акторной системы `xstate.error.*`, `xstate.done.actor.*`, `xstate.snapshot.*`, `xstate.promise.*` |
| Креаторы из пакета `xstate` | `assign`, `raise`, `cancel`, `log`, `and`, `or`, `not`, `stateIn` (а также `sendTo`, `sendParent`, `forwardTo`, `enqueueActions`, `emit`, `spawnChild`, `stopChild`), импортированные из `xstate`: это обычные функции без нашего бренда, они выполнились бы как пустые no-op. Отклоняются и в конфиге, и в таблице реализаций — берите креаторы из `@fozy-labs/rx-toolkit` |


## Отличия семантики

Семантика переходов сверена с `xstate@5.32.5` дифференциальными тестами (`src/statechart/__tests__/differential/`). Сознательные отличия:

| Область | Отличие |
|---|---|
| Область поддержки | нет акторной модели — соответствующие ключи отклоняются |
| `initial` | только строка; объектная форма `{ target, actions }` не принимается |
| `onDone` на корне | ошибка конфига (XState принимает, но переход никогда не срабатывает) |
| `mutate` | builtin без аналога: обновление `context` через Immer-draft (см. [Builtin-действия](./README.md#builtin-действия)) |
| `source` на корне | принимается (исходный текст `.mmd`); `toXStateSource()` его не выводит |
| Повторный `raise` с тем же `id` | заменяет ещё живой таймер (XState держит оба, `cancel` достаёт только последний) |
| Именованная задержка, вернувшая не число | ошибка рантайма (XState поднял бы событие немедленно) |
| `can()` | `false` на снапшоте со `status` не `"active"` и после `dispose()` |
| `start()` после stop / done / error | переинициализация с нуля (в XState поведение перезапуска не определено) |
| Ошибки при инициализации | снапшот сохраняет пред-инициализационные `value` / `context`, throw синхронный (XState отдал бы пустой `{ status: "error", error }` асинхронно) |
| События после stop / done / error / dispose | игнорируются; `start()` после `dispose()` бросает |
| Лимит микрошагов | опция инстанса `maxMicrosteps` вместо ключа конфига `maxIterations` |
| `snapshot.tags` | массив `readonly string[]`, а не `Set` |
| `definition.config` | тот же объект, что передан в `createMachine`, глубоко заморожен после валидации (кроме объекта `context`) и типизирован как read-only |

Совпадает намеренно: `assign` — shallow-merge без Immer; порядок действий `exit` → переход → `entry`; `reenter: false` по умолчанию; `context`-объект разделяется всеми инстансами; `stop()` не выполняет `exit`-действия.


## Экспорт: toXStateSource

`definition.toXStateSource(options?)` печатает готовый к вставке модуль с вызовом `createMachine({...})` — ровно то, что понимают Stately Studio «Import from code» и `@xstate/machine-extractor`.

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

Builtin `mutate()` аналога в XState не имеет, поэтому в выводе он импортируется из `@fozy-labs/rx-toolkit`, а не из `xstate`.

### Правило для исходного кода

Экстрактор Stately и «Import from code» работают на уровне AST и не резолвят импорты. Чтобы ваш исходник читался тулингом напрямую, без `toXStateSource()`:

- вызов должен называться `createMachine` — источник импорта не проверяется, `@fozy-labs/rx-toolkit` для экстрактора неотличим от `xstate`;
- конфиг — литералом внутри вызова или переменной, объявленной **в том же файле**;
- **никакого `satisfies`** — экстрактор его не парсит и молча пропускает машину. `config as Type` допустим.


## Stately Inspector

Живой визуализатор стейт-машин от Stately: диаграмма, подсветка активного состояния, таймлайн событий и sequence-диаграмма. Встроенный адаптер `statelyInspector()` — без зависимостей, реализует протокол `@statelyai/inspect@0.7.2`; ставить `@statelyai/inspect` и `xstate` не нужно.

Альтернатива без сторонних сервисов — `StatechartViz` из [fozy-labs/statechart][statechart-repo]: та же подсветка активных состояний плюс обратный канал (отправка событий кликом по переходу), которого у инспектора нет. См. [Viz](./README.md#viz).

### Установка

Никаких пакетов ставить не требуется. Подключите адаптер глобально — все стейт-машины начнут отправлять описание, события и снапшоты:

```typescript
import { DefaultOptions, statelyInspector } from "@fozy-labs/rx-toolkit";

DefaultOptions.update({
    MACHINE_DEVTOOLS: statelyInspector(),
});
```

По умолчанию `statelyInspector()` сразу открывает `https://stately.ai/inspect` в новом окне (`window.open`). Если браузер заблокировал popup, в консоль выводится предупреждение, а события копятся в буфере до подключения.

### Опции statelyInspector

```typescript
statelyInspector({
    // URL инспектора
    url: "https://stately.ai/inspect",

    // Загрузить инспектор в iframe вместо нового окна
    iframe: document.querySelector("iframe#inspector"),

    // Открыть инспектор сразу при создании (иначе — вручную через inspector.start())
    autoStart: true,

    // Сколько событий хранить, пока инспектор не подключился (старые вытесняются)
    maxDeferredEvents: 200,

    // Фильтр событий: вернул false — событие не отправляется
    filter: (event) => event.type !== "@xstate.event",

    // Преобразование события перед отправкой (по умолчанию — serializeInspectionEvent)
    serialize: (event) => serializeInspectionEvent(event),

    // Собственный транспорт вместо окна/iframe (например, WebSocket)
    adapter: { start() {}, stop() {}, send(event) {} },
});
```

| Опция | Тип | По умолчанию | Описание |
|---|---|---|---|
| `url` | `string` | `https://stately.ai/inspect` | адрес страницы инспектора |
| `iframe` | `HTMLIFrameElement \| null` | `null` | встроить инспектор в iframe; иначе открывается окно `window.open(url, "xstateinspector")` |
| `window` | `Window` | `globalThis.window` | хост-окно (для тестов). Без `window` (SSR / Node) адаптер — тихий no-op |
| `autoStart` | `boolean` | `true` | вызвать `start()` при создании |
| `maxDeferredEvents` | `number` | `200` | размер буфера событий до хендшейка `@statelyai.connected`; буфер переигрывается при каждом (пере)подключении страницы инспектора |
| `filter` | `(event: StatelyInspectionEvent) => boolean` | `() => true` | отсекает события до сериализации |
| `serialize` | `(event) => StatelyInspectionEvent` | `serializeInspectionEvent` | JSON-раундтрип: функции → `{ type: fn.name }`, HTML-элементы → `outerHTML`, циклические ссылки → `"[Circular]"`, `bigint` → строка |
| `adapter` | `{ start?(), stop?(), send(event) }` | — | собственный транспорт. Заменяет браузерный, поэтому несовместим с `url`, `iframe` и `window` — их совместное указание бросает ошибку |

Возвращаемый объект `StatelyInspector` реализует `MachineDevtoolsLike` и дополнительно даёт `status` (`"disconnected" | "connected"`), `start()` и `stop()` (оба идемпотентны; `stop()` отправляет `@statelyai.disconnected` и снимает слушатели, `start()` после `stop()` открывает инспектор заново).

### Подключение на инстанс

Опция `inspector` у `MachineSignal.state()` / `new Statechart()` переопределяет глобальную настройку: свой адаптер или `null`, чтобы отключить инспектор для конкретной машины.

```typescript
import { MachineSignal, statelyInspector } from "@fozy-labs/rx-toolkit";

// Отдельный инспектор в iframe только для этой машины
const light$ = MachineSignal.state(trafficLight, {
    inspector: statelyInspector({ iframe: document.querySelector("iframe#inspector") }),
});

// Эта машина в инспектор не попадает, даже если задан MACHINE_DEVTOOLS
const internal$ = MachineSignal.state(trafficLight, { inspector: null });
```

Приоритет: `inspector` в опциях инстанса → `SharedOptions.MACHINE_DEVTOOLS` (задаётся через `DefaultOptions.update({ MACHINE_DEVTOOLS })`) → инспектора нет.

Адаптер — best-effort: если он бросил исключение, машина продолжает работать, ошибка один раз логируется через `console.error`, а инспектор для этого инстанса отключается.

### Что показывается

Каждый инстанс машины регистрируется как отдельный корневой актор (`rootId === sessionId`):

| Событие протокола | Когда отправляется |
|---|---|
| `@xstate.actor` | при создании инстанса: имя (`id` машины), сырой конфиг в JSON и начальный снапшот |
| `@xstate.event` | на каждое принятое событие, включая [системные](#системные-события) |
| `@xstate.snapshot` | после каждого макрошага — даже если состояние не изменилось; после `stop()` — снапшот `stopped` |

Функции в конфиге (инлайн-действия, гварды, `assign` и другие builtin'ы) сериализуются как `{ type: fn.name }` — ровно так же, как это делает `@statelyai/inspect` для машины XState, поэтому диаграмма выглядит идентично. В инспектор уходят `status`, `value`, `context`, `output`, `error` и `tags` снапшота. После `dispose()` инстанс перестаёт отправлять события.

Отсюда следствие для авторинга: инлайн-функции инспектор показывает только по имени (анонимные — как `anonymous`), поэтому для машин, которые вы собираетесь смотреть в инспекторе, предпочитайте [имена из таблицы реализаций](./README.md#реализации-actions-guards-delays).

### Ограничение: инспектор односторонний

В XState v5 протокол Stately Inspector **не имеет обратного канала**: отправить событие в работающее приложение кликом по переходу в инспекторе нельзя (в `@statelyai/inspect` входящие сообщения не обрабатываются — слушается только хендшейк подключения). Управлять машиной из devtools можно было в XState v4 (`@xstate/inspect`), в v5 эту возможность убрали. Адаптер повторяет протокол v5 и тоже работает только «из приложения в инспектор».

Обратный канал есть у `StatechartViz` — см. [Viz](./README.md#viz).

### Development-режим

Как и Redux DevTools, инспектор стоит подключать только в разработке и только в браузере — `window.open` на сервере невозможен, а без `window` адаптер всё равно молча ничего не делает:

```typescript
if (typeof window !== "undefined" && import.meta.env.DEV) {
    DefaultOptions.update({ MACHINE_DEVTOOLS: statelyInspector() });
}
```


[statechart-repo]: https://github.com/fozy-labs/statechart
