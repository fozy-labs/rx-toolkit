# Глобальные настройки

RxToolkit предоставляет `DefaultOptions` для настройки глобального поведения библиотеки. Все настройки опциональны и применяются ко всему приложению.

## API

### DefaultOptions.update()

Обновляет глобальные настройки библиотеки.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({
    DEVTOOLS: reduxDevtools(),
    onQueryError: (error) => console.error(error),
    getScopeName: () => MyScopeLibarary.getCurrentScopeName(),
});
```

## Параметры

### DEVTOOLS

**См.** [Документация Devtools](../devtools/README.md)

---

### onQueryError

**Тип:** `(error: unknown) => void | null`  
**По умолчанию:** `null`

Глобальный обработчик ошибок для всех запросов (Resources и Operations). Вызывается при каждой ошибке запроса.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';
import * as Sentry from '@sentry/browser';

DefaultOptions.update({
    onQueryError: (error) => {
        // Логирование
        console.error('[RxToolkit Query Error]', error);
        
        // Отправка в систему мониторинга
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

Функция для получения имени текущего scope. Полезно для SSR, изоляции данных между запросами или многопользовательских приложений.

```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';

// SSR: изоляция данных между запросами
let currentRequestId: string | null = null;

DefaultOptions.update({
    getScopeName: () => currentRequestId
});

// В middleware сервера
app.use((req, res, next) => {
    currentRequestId = req.id;
    res.on('finish', () => {
        currentRequestId = null;
    });
    next();
});
```

---
