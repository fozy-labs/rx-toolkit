# Фаза 1 — Инфраструктура тестирования

**Цель**: Создать полную тестовую инфраструктуру на базе Vitest с поддержкой ESM, path aliases, jsdom и изоляцией синглтонов.

**Зависимости**: Нет  
**Тип выполнения**: Последовательная (задачи зависят друг от друга)  
**Сложность**: Низкая

---

## Задачи

### Задача 1.1 — Установка зависимостей

**Файл**: `package.json`  
**Действие**: Добавить devDependencies

Установить через npm:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Ожидаемые новые записи в `package.json` → `devDependencies`:
```json
{
  "vitest": "^3.x",
  "@testing-library/react": "^16.x",
  "@testing-library/jest-dom": "^6.x",
  "jsdom": "^26.x"
}
```

**Обоснование**: [01-architecture.md](../02-design/01-architecture.md) — раздел «Зависимости тестирования».

---

### Задача 1.2 — Создание vitest.config.ts

**Файл**: `vitest.config.ts` (новый, корень проекта)  
**Действие**: Создать файл

```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/common/**', 'src/signals/**'],
      exclude: [
        'src/query/**',
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/**/*.types.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
});
```

**Обоснование**: [01-architecture.md](../02-design/01-architecture.md) — раздел «Конфигурация Vitest». Ключевые параметры:
- `environment: 'jsdom'` — нужны `window`, `localStorage`, React DOM
- `pool: 'forks'` — изоляция глобальных синглтонов ([ADR-3](../02-design/04-decisions.md#adr-3))
- `globals: true` — `describe`, `it`, `expect` без импортов
- `coverage.provider: 'v8'` — быстрее Istanbul
- Coverage thresholds 80% — ответ на Q5

---

### Задача 1.3 — Добавление тестовых скриптов в package.json

**Файл**: `package.json`  
**Действие**: Добавить секцию `scripts`

Добавить следующие скрипты:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

**Примечание**: Добавить к существующим скриптам (`build`, `build:watch`, `ts-check`), не заменять их.

**Обоснование**: [01-architecture.md](../02-design/01-architecture.md) — раздел «Интеграция с package.json».

---

### Задача 1.4 — Создание глобального setup файла

**Файл**: `src/__tests__/setup.ts` (новый)  
**Действие**: Создать файл

Содержимое:
```typescript
import { afterEach, beforeEach } from 'vitest';
import { resetSharedOptions } from './helpers/singleton-reset';

beforeEach(() => {
  resetSharedOptions();
});

afterEach(() => {
  // Проверяем что система батчинга не заблокирована
  // (после фикса Batcher try/finally это не должно случиться)
});
```

**Обоснование**: [01-architecture.md](../02-design/01-architecture.md) — раздел «Стратегия изоляции глобальных синглтонов», [ADR-3](../02-design/04-decisions.md#adr-3).

---

### Задача 1.5 — Добавление reset в SharedOptions и хелпер изоляции

**Файлы**:
- `src/common/options/SharedOptions.ts` (модификация — добавление `reset()`)
- `src/__tests__/helpers/singleton-reset.ts` (новый)

**Действие**: Добавить статический метод `reset()` в `SharedOptions` и создать хелпер

**Шаг 1 — Изменение SharedOptions.ts:**

```typescript
import { DevtoolsLike } from "@/common/devtools";
import { shallowEqual } from "@/common/utils";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null
    static onQueryError: ((error: unknown) => void) | null = null;
    static getScopeName: (() => string | null) | null = null;
    static defaultCompareArgs = shallowEqual;

    /** Сброс всех опций к значениям по умолчанию. Используется в тестах. */
    static reset(): void {
        SharedOptions.DEVTOOLS = null;
        SharedOptions.onQueryError = null;
        SharedOptions.getScopeName = null;
        SharedOptions.defaultCompareArgs = shallowEqual;
    }
}
```

**Шаг 2 — Создание хелпера singleton-reset.ts:**

```typescript
import { SharedOptions } from '@/common/options/SharedOptions';

/**
 * Сброс SharedOptions к значениям по умолчанию.
 * Вызывается в beforeEach для изоляции тестов.
 */
export function resetSharedOptions(): void {
  SharedOptions.reset();
}
```

**Обоснование**: SharedOptions — глобальный синглтон с 4 статическими полями (DEVTOOLS, onQueryError, getScopeName, defaultCompareArgs). Между тестами необходим полный reset. Метод `reset()` в ядре обеспечивает единую точку сброса, хелпер — удобный вызов из `beforeEach`.

---

### Задача 1.6 — Создание хелпера для async/microtask

**Файл**: `src/__tests__/helpers/async-helpers.ts` (новый)  
**Действие**: Создать файл

```typescript
/**
 * Ожидание выполнения всех запланированных microtasks.
 * Используется в тестах useSignal, reduxDevtools и других
 * компонентов с queueMicrotask.
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}
```

**Обоснование**: [02-dataflow.md](../02-design/02-dataflow.md) — раздел «Тестирование microtask timing», [05-risks.md](../02-design/05-risks.md#risk-2).

---

### Задача 1.7 — Создание хелперов для тестирования сигналов

**Файл**: `src/__tests__/helpers/signal-helpers.ts` (новый)  
**Действие**: Создать файл

```typescript
/**
 * Собирает все значения из сигнала в массив.
 * Возвращает массив и функцию отписки.
 */
export function collectValues<T>(signal: { obs: import('rxjs').Observable<T> }): {
  values: T[];
  unsubscribe: () => void;
} {
  const values: T[] = [];
  const sub = signal.obs.subscribe(v => values.push(v));
  return { values, unsubscribe: () => sub.unsubscribe() };
}
```

**Обоснование**: [02-dataflow.md](../02-design/02-dataflow.md) — утилиты для тестирования реактивных цепочек.

---

### Задача 1.8 — Обновление tsconfig.json

**Файл**: `tsconfig.json`  
**Действие**: Добавить исключение тестовых файлов из production build

Изменить секцию `exclude`:
```json
{
  "exclude": ["node_modules", "dist", "**/*.test.ts", "src/__tests__/**"]
}
```

**Текущее значение**: `["node_modules", "dist"]`  
**Обоснование**: [01-architecture.md](../02-design/01-architecture.md) — раздел «Исключение тестов из production build».

---

## Верификация

- [ ] `npm install` завершается без ошибок
- [ ] `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` в devDependencies
- [ ] `vitest.config.ts` создан в корне проекта
- [ ] `npm run test` запускается (может показать 0 тестов — это ОК)
- [ ] `src/__tests__/setup.ts` создан
- [ ] `src/common/options/SharedOptions.ts` содержит метод `reset()`
- [ ] `src/__tests__/helpers/singleton-reset.ts` создан
- [ ] `src/__tests__/helpers/async-helpers.ts` создан
- [ ] `src/__tests__/helpers/signal-helpers.ts` создан
- [ ] `tsconfig.json` содержит exclude для `**/*.test.ts` и `src/__tests__/**`
- [ ] `npm run build` по-прежнему работает (тестовые файлы не включены в сборку)

## Коммит

```
test(infra): add vitest test infrastructure

- Install vitest, @testing-library/react, @testing-library/jest-dom, jsdom
- Create vitest.config.ts with ESM, jsdom, path aliases, forks pool
- Add test/test:watch/test:coverage/test:ui scripts
- Add reset() method to SharedOptions for test isolation
- Create global setup with singleton isolation
- Create test helpers: singleton-reset, async-helpers, signal-helpers
- Exclude test files from production build in tsconfig.json
```
