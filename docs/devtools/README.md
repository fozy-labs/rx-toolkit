# Devtools

RxToolkit предоставляет интеграцию с популярными инструментами разработчика для отладки реактивных приложений в реальном времени. Вы можете отслеживать изменения сигналов, выполнение команд и состояние ресурсов.

**Отслеживает изменения:**
- Сигналов (Signal / Computed)
- Ресурсов и команд (Resource / Command)

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
import { DefaultOptions, reduxDevtools } from '@fozy-labs/rx-toolkit';
import { Observable } from 'rxjs';

DefaultOptions.update({
    // Devtools интеграция
    DEVTOOLS: reduxDevtools(),
    
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

