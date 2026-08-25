# Devtools

RxToolkit предоставляет интеграцию с популярными инструментами разработчика для отладки реактивных приложений в реальном времени. Вы можете отслеживать изменения сигналов, выполнение команд и состояние ресурсов.

**Отслеживает изменения:**
- Сигналов (Signal / Computed)
- Ресурсов и команд (Resource / Command)
- Стейт-машин (Statechart) — в Redux DevTools и в [Stately Inspector](#stately-inspector)

---

## Redux DevTools

Популярное браузерное расширение для отладки состояния приложений. **RxToolkit включает встроенный адаптер `reduxDevtools()`**.

### Установка

1. Установите [расширение Redux DevTools](https://github.com/reduxjs/redux-devtools) для браузера
2. Подключите в коде:

```typescript
import { DefaultOptions, reduxDevtools } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({ 
    DEVTOOLS: reduxDevtools() 
});
```

### Опции reduxDevtools

```typescript
reduxDevtools({
    // Имя приложения в DevTools
    name: 'MyApp',
    
    // Стратегия батчинга обновлений
    batchStrategy: 'microtask', // 'sync' | 'microtask' | 'task'
    
    // Задержка для стратегии 'task' (мс)
    taskDelay: 0,
})
```

**Стратегии батчинга (batchStrategy):**

| Стратегия     | Описание                                                                                                        |
|---------------|-----------------------------------------------------------------------------------------------------------------|
| `'sync'`      | Без собственного батчинга: отправка идёт немедленно, а внутри батча сигналов откладывается до его конца (`Batcher`) |
| `'microtask'` | **(default)** Пакование в микротаске. Все обновления в текущем синхронном потоке объединяются                   |
| `'task'`      | Пакование в макротаске (setTimeout) с настраиваемой задержкой                                                   |

### Типы действий и владение ключом

| Действие   | Когда отправляется                                                                    |
|------------|---------------------------------------------------------------------------------------|
| `CREATE`   | Состояние зарегистрировано под свободным ключом                                        |
| `RECREATE` | Состояние зарегистрировано под ключом, который ещё занят предыдущим состоянием          |
| `UPDATE`   | Обновление значения (`UPDATE: <actionName>`, если имя действия передано)                |
| `CLEAR`    | Состояние завершено (`dispose()` или сборка мусора) — запись удалена из дерева          |

Одна отправка может нести события сразу нескольких типов — тогда они склеиваются
через `+` (`CREATE+UPDATE`), см. [Имена действий](#имена-действий-у-ресурсов-и-команд).

Ключом владеет то состояние, которое зарегистрировалось последним. Пересоздание
сигнала или ресурса с тем же ключом — штатная ситуация: владение переходит к новому
инстансу (`RECREATE`), а запоздалые события от вытесненного (в том числе его `dispose()`
и срабатывание сборщика мусора) игнорируются и не трогают запись текущего владельца.

Поэтому вызывать `dispose()` только ради чистоты devtools не требуется.

Предупреждение в консоль выдаётся лишь при реальной коллизии — когда вытесненный
инстанс продолжает **писать** в занятый ключ, то есть два живых состояния делят одно
имя. Такое обновление игнорируется, чтобы в дереве оставались данные текущего владельца.
Лечится уникальным ключом (см. [Именование для devtools](#именование-для-devtools)).

### Имена действий у ресурсов и команд

Переходы состояния записи кэша (Resource / Command) приходят как `UPDATE: <имя>`.
Появление записи — это `CREATE` / `RECREATE`, а её удаление — `CLEAR`; они без имени.

| Имя             | Что произошло                                                            |
|-----------------|--------------------------------------------------------------------------|
| `success`       | Запрос завершился данными (первая загрузка или успешный `retry`)         |
| `error`         | Первая загрузка завершилась ошибкой — данных нет                         |
| `refresh`       | Начат фоновый SWR-рефреш (`refresh()`, `prefetch(args, { force: true })`) |
| `rebase`        | Пришли данные фонового рефреша (активные патчи переигрываются поверх них) |
| `refresh-error` | Фоновый рефреш упал — прежние данные остались                            |
| `retry`         | Повторная попытка после ошибки                                           |
| `patch`         | Создан оптимистичный патч                                                |
| `patch-settled` | Патч закоммичен или отменён — состояние пересчитано                      |
| `sync`          | Данные пришли из другой вкладки (cross-tab sync)                         |

При батчинге все обновления батча — в том числе по разным ключам — схлопываются
в одну отправку. Так работают `microtask` / `task`; для `sync` границей служит батч
сигналов — внутри `Batcher.run(...)` отправка тоже откладывается до его конца.
Поэтому тип отправки описывает её целиком: перечисляет через `+` типы всех
попавших в неё событий в фиксированном порядке `CREATE → RECREATE → UPDATE → CLEAR`,
а после двоеточия — имена действий в порядке появления ключей. Имя каждого ключа
берётся первое за батч, повторы схлопываются, список обрезается до пяти имён с хвостом `+N more`.

```
CREATE                          создание записи, имени нет
UPDATE: success                 одна запись, запрос завершился
CREATE: success                 быстрый запрос: создание и ответ в одном батче
UPDATE: refresh, patch          две записи в одном батче
CREATE+UPDATE: success          одна запись создана, другая обновилась
UPDATE+CLEAR: success           одна запись обновилась, другая вытеснена
```

Из-за этого имя никогда не попадает на чужую запись, но и не говорит, какой именно
ключ его прислал. Какие ключи изменились в отправке, видно во вкладке **Diff**
расширения.

### Statechart в Redux DevTools

Снапшот стейт-машины (`MachineSignal.state(...)`) — это обычный сигнал, поэтому он попадает
в дерево Redux DevTools наравне с остальными. Базовый ключ — `Statechart`:

- без опции `key` запись называется `Statechart/<id машины>`; одновременно живущие инстансы одного описания получают суффиксы `#2`, `#3`, …;
- с `key` — ключ используется как есть (плейсхолдер `{base}` заменяется на `Statechart`,
  `{scope}` — на имя текущего scope, см. [Именование для devtools](#именование-для-devtools)).

Каждый макрошаг даёт ровно одно обновление, имя действия — тип события:
`UPDATE: TIMER`, `UPDATE: xstate.after.3000.trafficLight.green`, `UPDATE: xstate.stop`.
Несколько инстансов одной машины без `key` делят одну запись — передавайте ключ, чтобы
их различать. Опция `isDisabled: true` отключает Redux DevTools для конкретного инстанса.

```typescript
const light$ = MachineSignal.state(trafficLight, { key: 'trafficLight' });
const hidden$ = MachineSignal.state(trafficLight, { isDisabled: true });
```

---

## Stately Inspector

Живой визуализатор стейт-машин от Stately: диаграмма, подсветка активного состояния,
таймлайн событий и sequence-диаграмма. **RxToolkit включает встроенный адаптер `statelyInspector()`** —
без зависимостей, реализует протокол `@statelyai/inspect@0.7.2`. Устанавливать `@statelyai/inspect`
и `xstate` не нужно.

### Установка

Никаких пакетов ставить не требуется. Подключите адаптер глобально — все стейт-машины
начнут отправлять в инспектор описание, события и снапшоты:

```typescript
import { DefaultOptions, statelyInspector } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({
    MACHINE_DEVTOOLS: statelyInspector(),
});
```

По умолчанию `statelyInspector()` сразу открывает `https://stately.ai/inspect`
в новом окне (`window.open`). Если браузер заблокировал popup, в консоль выводится
предупреждение, а события копятся в буфере до подключения.

### Опции statelyInspector

```typescript
statelyInspector({
    // URL инспектора
    url: 'https://stately.ai/inspect',

    // Загрузить инспектор в iframe вместо нового окна
    iframe: document.querySelector('iframe#inspector'),

    // Открыть инспектор сразу при создании (иначе — вручную через inspector.start())
    autoStart: true,

    // Сколько событий хранить, пока инспектор не подключился (старые вытесняются)
    maxDeferredEvents: 200,

    // Фильтр событий: вернул false — событие не отправляется
    filter: (event) => event.type !== '@xstate.event',

    // Преобразование события перед отправкой (по умолчанию — serializeInspectionEvent)
    serialize: (event) => serializeInspectionEvent(event),

    // Собственный транспорт вместо окна/iframe (например, WebSocket)
    adapter: { start() {}, stop() {}, send(event) {} },
})
```

| Опция               | Тип                                                  | По умолчанию                  | Описание                                                                                                                                                     |
|---------------------|------------------------------------------------------|-------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `url`               | `string`                                             | `https://stately.ai/inspect`  | Адрес страницы инспектора                                                                                                                                    |
| `iframe`            | `HTMLIFrameElement \| null`                          | `null`                        | Встроить инспектор в iframe; иначе открывается окно `window.open(url, "xstateinspector")`                                                                   |
| `window`            | `Window`                                             | `globalThis.window`           | Хост-окно (для тестов). Без `window` (SSR / Node) адаптер — тихий no-op                                                                                      |
| `autoStart`         | `boolean`                                            | `true`                        | Вызвать `start()` при создании                                                                                                                               |
| `maxDeferredEvents` | `number`                                             | `200`                         | Размер буфера событий до хендшейка `@statelyai.connected`; буфер переигрывается при каждом (пере)подключении страницы инспектора                             |
| `filter`            | `(event: StatelyInspectionEvent) => boolean`         | `() => true`                  | Отсекает события до сериализации                                                                                                                             |
| `serialize`         | `(event) => StatelyInspectionEvent`                  | `serializeInspectionEvent`    | JSON-раундтрип: функции → `{ type: fn.name }`, HTML-элементы → `outerHTML`, циклические ссылки → `"[Circular]"`, `bigint` → строка                            |
| `adapter`           | `{ start?(), stop?(), send(event) }`                 | —                             | Собственный транспорт. Заменяет браузерный, поэтому несовместим с `url`, `iframe` и `window` — их совместное указание бросает ошибку                         |

Возвращаемый объект `StatelyInspector` реализует `MachineDevtoolsLike` и дополнительно даёт
`status` (`'disconnected' | 'connected'`), `start()` и `stop()` (оба идемпотентны;
`stop()` отправляет `@statelyai.disconnected` и снимает слушатели, `start()` после `stop()`
открывает инспектор заново).

### Подключение на инстанс

Опция `inspector` у `MachineSignal.state()` / `new Statechart()` переопределяет
глобальную настройку: свой адаптер или `null`, чтобы отключить инспектор для конкретной машины.

```typescript
import { MachineSignal, statelyInspector } from '@fozy-labs/rx-toolkit';

// Отдельный инспектор в iframe только для этой машины
const light$ = MachineSignal.state(trafficLight, {
    inspector: statelyInspector({ iframe: document.querySelector('iframe#inspector') }),
});

// Эта машина в инспектор не попадает, даже если задан MACHINE_DEVTOOLS
const internal$ = MachineSignal.state(trafficLight, { inspector: null });
```

Приоритет: `inspector` в опциях инстанса → `SharedOptions.MACHINE_DEVTOOLS`
(задаётся через `DefaultOptions.update({ MACHINE_DEVTOOLS })`) → инспектора нет.

### Что показывается

Каждый инстанс машины регистрируется как отдельный корневой актор (`rootId === sessionId`):

| Событие протокола  | Когда отправляется                                                                                     |
|--------------------|--------------------------------------------------------------------------------------------------------|
| `@xstate.actor`    | При создании инстанса: имя (`id` машины), сырой конфиг в JSON и начальный снапшот                       |
| `@xstate.event`    | На каждое принятое событие, включая системные (`xstate.init`, `xstate.after.*`, `xstate.done.state.*`) |
| `@xstate.snapshot` | После каждого макрошага — даже если состояние не изменилось; после `stop()` — снапшот `stopped`         |

Функции в конфиге (inline-действия, гарды, `assign` и другие builtins) сериализуются как
`{ type: fn.name }` — ровно так же, как это делает `@statelyai/inspect` для машины XState,
поэтому диаграмма выглядит идентично. В инспектор уходят `status`, `value`, `context`,
`output`, `error` и `tags` снапшота. После `dispose()` инстанс перестаёт отправлять события.

### Ограничение: инспектор односторонний

В XState v5 протокол Stately Inspector **не имеет обратного канала**: отправить событие
в работающее приложение кликом по переходу в инспекторе нельзя (в `@statelyai/inspect`
входящие сообщения не обрабатываются — слушается только хендшейк подключения).
Управлять машиной из devtools можно было в XState v4 (`@xstate/inspect`), в v5 эту
возможность убрали. Адаптер RxToolkit повторяет протокол v5 и тоже работает
только «из приложения в инспектор».

### Development-режим

Как и Redux DevTools, инспектор стоит подключать только в разработке
и только в браузере — `window.open` на сервере невозможен, а без `window` адаптер
всё равно молча ничего не делает:

```typescript
if (typeof window !== 'undefined' && import.meta.env.DEV) {
    DefaultOptions.update({ MACHINE_DEVTOOLS: statelyInspector() });
}
```

---

## @reatom/devtools

Npm пакет с встроенным отладчиком, работающим прямо в браузере. После подключения в углу страницы появляется кнопка, которая открывает панель инструментов.

### Установка

```bash
npm install @reatom/devtools
```

### Подключение

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';
import { createDevtools } from '@reatom/devtools';

DefaultOptions.update({
    DEVTOOLS: createDevtools({ 
        initVisibility: true // Показать панель при загрузке
    })
});
```

**Может пригодиться:**
- Если в вашей среде невозможно установить браузерное расширение
- Для мобильной отладки

---

## DefaultOptions

`DefaultOptions.update()` позволяет настроить глобальные опции RxToolkit:

```typescript
import { DefaultOptions, reduxDevtools, statelyInspector } from '@fozy-labs/rx-toolkit';
import { Observable } from 'rxjs';

DefaultOptions.update({
    // Devtools интеграция
    DEVTOOLS: reduxDevtools(),

    // Stately Inspector для стейт-машин
    MACHINE_DEVTOOLS: statelyInspector(),
    
    // Глобальный обработчик ошибок запросов
    onQueryError: (error) => {
        console.error('Query error:', error);
        // Можно отправить в систему мониторинга
        errorTracker.capture(error);
    },
    
    // Функция для получения имени текущего scope (полезно для SSR)
    getScopeName: () => {
        return currentRequestId ?? null;
    },
});
```

### Параметры DefaultOptions

| Параметр | Тип | Описание |
|----------|-----|----------|
| `DEVTOOLS` | `DevtoolsLike \| null` | Интеграция с devtools |
| `MACHINE_DEVTOOLS` | `MachineDevtoolsLike \| null` | Инспектор стейт-машин ([Stately Inspector](#stately-inspector)) |
| `onQueryError` | `(error: unknown) => void` | Глобальный обработчик ошибок запросов |
| `getScopeName` | `() => string \| null` | Получение имени текущего scope |

---

## Практики

### Development-режим

Подключайте devtools только в режиме разработки:

```typescript
// Node.js / Webpack
if (process.env.NODE_ENV !== 'production') {
    DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}

// Vite
if (import.meta.env.DEV) {
    DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}

// Next.js
if (process.env.NODE_ENV === 'development') {
    DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}
```

### SSR-совместимость

Защитите от выполнения на сервере:

```typescript
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}
```

### Несколько инструментов

Можно комбинировать несколько devtools с помощью `combineDevtools`:

```typescript
import { combineDevtools, reduxDevtools, DefaultOptions } from '@fozy-labs/rx-toolkit';
import { createDevtools } from '@reatom/devtools';

DefaultOptions.update({
    DEVTOOLS: combineDevtools(
        reduxDevtools({ name: 'MyApp' }),
        createDevtools({ initVisibility: true })
    )
});
```

### Именование для devtools

При создании сигналов и запросов можно указывать имена для удобной отладки:

```typescript
// Сигналы: второй аргумент — либо строка-ключ, либо опции с полем `key`
const count$ = Signal.state(0, 'counter');
const user$ = Signal.state(null, { key: 'currentUser' });

count$.set(1); // UPDATE
count$.set(0, 'reset'); // UPDATE: reset
count$.update((value) => value + 1, 'increment'); // UPDATE: increment

// Ресурсы и команды: `key` — префикс записи в дереве, полный ключ записи
// складывается как `<key>:<сериализованные аргументы>`
const userResource = createResource({
    queryFn: fetchUser,
    key: 'user-resource',
});

const updateUser = createCommand({
    queryFn: updateUserApi,
    key: 'update-user',
});

// Отключение devtools для конкретного сигнала
const internalSignal = Signal.state(0, { isDisabled: true });
```

> Отдельной опции отключения devtools у ресурсов и команд нет: без `key` запись
> всё равно попадёт в дерево — просто под сериализованными аргументами, без префикса.

---

## DevtoolsLike интерфейс

Если вам нужно создать кастомную интеграцию с devtools:

```typescript
interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}

interface DevtoolsStateLike<T = any> {
    (newState: T | '$COMPLETED' | '$CLEANED', actionName?: string): void;
}
```

**Пример кастомного devtools:**

```typescript
const customDevtools: DevtoolsLike = {
    state(name, initState) {
        console.log(`[INIT] ${name}:`, initState);
        
        return (newState) => {
            console.log(`[UPDATE] ${name}:`, newState);
        };
    }
};

DefaultOptions.update({ DEVTOOLS: customDevtools });
```

