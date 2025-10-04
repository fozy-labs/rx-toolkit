# Devtools

RxToolkit предоставляет интеграцию с популярными инструментами разработчика для отладки реактивных приложений в реальном времени. Вы можете отслеживать изменения сигналов, выполнение операций и состояние ресурсов, анализировать граф зависимостей и исследовать поведение реактивной системы.

**Отслеживает изменения состояния:**
- Сигналов (Signal/Computed)
- Ресурсов и операций (Resource/Operation)

## Redux DevTools

Популярное браузерное расширение для отладки состояния приложений. **RxToolkit включает встроенный адаптер `reduxDevtools()`**.

**Установка:**
1. Установите [расширение](https://github.com/reduxjs/redux-devtools) для браузера
2. Подключите в коде:

```typescript
import { DefaultOptions, reduxDevtools } from '@fozy-labs/rx-toolkit';

DefaultOptions.update({ 
  DEVTOOLS: reduxDevtools() 
});
```

## @reatom/devtools

Npm пакет, содержащий отладчик, работающий прямо в браузере.
Совместим по API с `rx-toolkit`.
После подключения в углу страницы появляется кнопка,
которая открывает панель инструментов.

**Установка:**
```bash
npm install @reatom/devtools
```

**Подключение:**
```typescript
import { DefaultOptions } from '@fozy-labs/rx-toolkit';
import { createDevtools } from '@reatom/devtools';

DefaultOptions.update({
  DEVTOOLS: createDevtools({ 
    initVisibility: true 
  })
});
```

**Может пригодиться:**
- Если в вашей среде не удобно или проблематично установить браузерное расширение.
- Если вы уже работали с Reatom.

## Практики

### Development-режим

Подключайте devtools только в разработке:

```typescript
// Node.js/Webpack
if (process.env.NODE_ENV !== 'production') {
  DefaultOptions.update({ DEVTOOLS: reduxDevtools() });
}

// Vite
if (import.meta.env.DEV) {
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

Можно комбинировать несколько devtools:

```typescript
import { combineDevtools, reduxDevtools } from '@fozy-labs/rx-toolkit';
import { createDevtools } from '@reatom/devtools';

DefaultOptions.update({
  DEVTOOLS: combineDevtools(
    reduxDevtools({ name: 'MyApp' }),
    createDevtools({ initVisibility: true })
  )
});
```
