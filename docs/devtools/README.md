# Devtools

RxToolkit предоставляет интеграцию с популярными инструментами разработчика для отладки реактивных приложений в реальном времени. Вы можете отслеживать изменения сигналов, выполнение операций и состояние ресурсов.

**Отслеживает изменения:**
- Сигналов (Signal / Computed)
- Ресурсов и операций (Resource / Operation)

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
| `'sync'`      | Синхронное выполнение без батчинга. Каждое обновление отправляется немедленно. Интегрируется с Batcher сигналов |
| `'microtask'` | **(default)** Пакование в микротаске. Все обновления в текущем синхронном потоке объединяются                   |
| `'task'`      | Пакование в макротаске (setTimeout) с настраиваемой задержкой                                                   |

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
- Если в вашей среде неудобно или проблематично установить браузерное расширение
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
// Сигналы
const count$ = new Signal(0, 'counter');
const user$ = new Signal(null, { name: 'currentUser' });

// Ресурсы и операции
const userResource = createResource({
    queryFn: fetchUser,
    devtoolsName: 'user-resource', // Имя в devtools
});

const updateUser = createOperation({
    queryFn: updateUserApi,
    devtoolsName: 'update-user',
});

// Отключение devtools для конкретного сигнала
const internalSignal = new Signal(0, { isDisabled: true });

// Отключение devtools для ресурса
const internalResource = createResource({
    queryFn: fetchInternal,
    devtoolsName: false, // Не отслеживать
});
```

---

## DevtoolsLike интерфейс

Если вам нужно создать кастомную интеграцию с devtools:

```typescript
interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}

interface DevtoolsStateLike<T = any> {
    (newState: T): void;
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

