# Глобальные настройки

RxToolkit предоставляет `DefaultOptions` для настройки глобального поведения библиотеки. Все настройки опциональны и применяются ко всему приложению.

## API

### DefaultOptions.update()

Обновляет глобальные настройки библиотеки.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({
    DEVTOOLS: reduxDevtools(),
    MACHINE_DEVTOOLS: statelyInspector(),
    onQueryError: (error) => console.error(error),
    getScopeName: () => MyScopeLibarary.getCurrentScopeName(),
});
```

## Параметры

### DEVTOOLS

**Тип:** `DevtoolsLike | null`  
**По умолчанию:** `null`

Интеграция с devtools для сигналов, ресурсов и команд (Redux DevTools, `@reatom/devtools`, кастомный адаптер).

**См.** [Документация Devtools](../devtools/README.md)

---

### MACHINE_DEVTOOLS

**Тип:** `MachineDevtoolsLike | null`  
**По умолчанию:** `null`

Инспектор стейт-машин, общий для всех инстансов `MachineSignal.state(...)` / `new Statechart(...)`.
Отдельная опция, потому что интерфейс инспектора (`actor` → `event` / `snapshot` / `stop`) не сводится
к `DevtoolsLike`, который моделирует именованные значения. `combineDevtools` на неё не влияет.

Встроенный адаптер — `statelyInspector()`. Снапшоты машин при этом
по-прежнему попадают и в Redux DevTools через `DEVTOOLS` под базовым ключом `Statechart`.

```typescript
import { DefaultOptions, statelyInspector } from '@fozy-labs/rx-toolkit';

if (typeof window !== 'undefined' && import.meta.env.DEV) {
    DefaultOptions.update({
        MACHINE_DEVTOOLS: statelyInspector(),
    });
}
```

Опция `inspector` в настройках инстанса имеет приоритет: свой адаптер или `null`, чтобы
отключить инспектор для конкретной машины.

```typescript
const light$ = MachineSignal.state(trafficLight, { inspector: null });
```

**См.** [Инспектор стейт-машин](../devtools/README.md#инспектор-стейт-машин)

---

### onQueryError

**Тип:** `(error: unknown) => void | null`  
**По умолчанию:** `null`

Глобальный обработчик ошибок для всех запросов (Resources и Commands). Вызывается при каждой ошибке запроса.

> **Note:** Старое имя `Operations` является deprecated-алиасом для `Commands` и будет удалено в v0.6.0.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';
import * as Sentry from '@sentry/browser';

DefaultOptions.update({
    onQueryError: (error) => {
        // Логирование
        console.error('[RxToolkit Query Error]', error);
        
        // Отправка в абстакную систему мониторинга
        Sentry.captureException(error, {
            tags: { source: 'rx-toolkit-query' }
        });
        
        // Уведомление пользователя
        if (error instanceof NetworkError) {
            toast.error('Проблема с сетью. Попробуйте позже.');
        } else if (error instanceof AuthError) {
            redirectToLogin();
        }
    }
});
```

---

### getScopeName

**Тип:** `(() => string | null) | null`  
**По умолчанию:** `null`

Функция для получения имени текущего scope.
Можено, например, подключить к DI систему, для раширенного devtools нейминга.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({
    getScopeName: () => MyDiAbsractDi.getCurrentScopeName(),
});

// Объявляем класс
class Counter {
    value$ = Signal.state(0, '{scope}/Counter/value$');
}

// В другом месте приложения
function ChannelCounter() {
    const counter = MyDiAbsractDi.resolve<Counter>('Counter', 'ChannelScope');
    console.log(counter.value$()); // Devtools покажет имя сигнала как "ChannelScope/Counter/value$"
    return null;
} 
```

---
