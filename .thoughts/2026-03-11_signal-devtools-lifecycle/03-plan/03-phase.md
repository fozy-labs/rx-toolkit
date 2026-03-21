# Фаза 3: Тесты

## Цель

Добавить тесты для `normalizeSignalOptions()` и `Devtools.createSignalHooks()`, обновить интеграционные тесты экспортов. Гарантировать прохождение полного test suite.

## Зависимости

- **Фазы 1–2** — все изменения кода завершены

## Задачи

### 3.1. Создать `src/signals/types/normalizeSignalOptions.test.ts`

Тест-кейсы:

| ID | Вход | Результат |
|----|------|-----------|
| N1 | `"counter"` | `{ key: "counter" }` |
| N2 | `{ key: "x", base: "State" }` | as-is |
| N3 | `undefined` | `{}` |
| N4 | `{ name: "counter" }` | `{ name: "counter", key: "counter" }` |
| N5 | `{ name: "old", key: "new" }` | as-is (`key` приоритетнее) |
| N6 | `{ key: "x", hooks: [{ onInit: fn }] }` | hooks сохранён |
| N7 | `{ beforeDevtoolsPush: fn }` | поле сохранено |
| N8 | `{}` | `{}` |

```typescript
import { describe, it, expect, vi } from 'vitest';
import { normalizeSignalOptions } from './normalizeSignalOptions';

describe('normalizeSignalOptions', () => {
    it('строка → { key }');
    it('объект с key — возвращается как есть');
    it('undefined → {}');
    it('deprecated name → key');
    it('name + key — key приоритетнее');
    it('объект с hooks[] сохраняется');
    it('объект с beforeDevtoolsPush сохраняется');
    it('пустой объект → {}');
});
```

### 3.2. Обновить `src/signals/base/Devtools.test.ts`

Добавить `describe('createSignalHooks()')` с тестами:

**Базовые (D1–D9)**:
- DEVTOOLS установлен → возвращает `{ onChange, onDispose }`
- DEVTOOLS `null` → `null`
- `isDisabled: true` → `null`
- init вызывает `DEVTOOLS.state()` с ключом и значением (через делегирование в `createState`)
- `onChange` вызывает devtools state function
- `onDispose` отправляет `$COMPLETED`
- Уникальные ключи через Indexer
- `{scope}` плейсхолдер
- `{base}` плейсхолдер

**`beforeDevtoolsPush` (DM1–DM5)**:
- init с `beforeDevtoolsPush` — фильтрация (если `push` не вызван → devtools lazy init)
- `onChange` — lazy init при первом push
- `onChange` — трансформация значения
- `onDispose` — работает независимо от `beforeDevtoolsPush`
- `onDispose` без предшествующего push — без ошибки

```typescript
describe('createSignalHooks()', () => {
    it('returns SignalLifecycleHook when DEVTOOLS is set');
    it('returns null when DEVTOOLS is null');
    it('returns null when isDisabled is true');
    it('init calls DEVTOOLS.state() via createState delegation');
    it('onChange calls stateDevtools function');
    it('onDispose sends $COMPLETED');
    it('generates unique keys via Indexer');
    it('replaces {scope} placeholder');
    it('replaces {base} placeholder');

    describe('with beforeDevtoolsPush', () => {
        it('init — filtering skips createState init');
        it('onChange — lazy init on first push');
        it('onChange — transforms value');
        it('onDispose works independently');
        it('onDispose without prior push — no error');
    });
});
```

Существующие тесты `createState()` — без изменений.

### 3.3. Обновить `src/__tests__/integration/signals-exports.test.ts`

Добавить проверку экспорта новых типов и утилиты:

```typescript
import {
    SignalOptions,
    SignalOptionsOrKey,
    SignalLifecycleHook,
    normalizeSignalOptions,
} from '@/signals';
```

### 3.4. Полный прогон тестов

```bash
npx vitest run
```

**Ожидание**: все тесты проходят, включая:
- `normalizeSignalOptions.test.ts` — **новый**
- `Devtools.test.ts` — обновлён
- `State.test.ts`, `Computed.test.ts`, `Signal.test.ts`, `LocalState.test.ts` — существующие
- `signals-exports.test.ts` — обновлён
- Query-тесты — без изменений (`createState()` API сохранён)

## Коммит

```
test(signals): add tests for lifecycle hooks and normalizeSignalOptions
```
