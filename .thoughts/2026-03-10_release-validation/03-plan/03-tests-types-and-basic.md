# Фаза 3: Unit-тесты — типы и базовые модули

## Цель

Создать unit-тесты для фундаментальных модулей query: `SKIP_TOKEN`, `IndirectMap`, `ReactiveCache`. Эти модули не имеют зависимостей от React и являются основой для более сложных модулей.

## Зависимости

- **Requires**: Phase 1 (типы экспортируются корректно)
- **Blocks**: Phase 4

## Тип выполнения

Последовательная. Задачи внутри фазы независимы друг от друга.

---

## Задачи

### Задача 3.1: Тест `SKIP_TOKEN`

**Новый файл**: `src/query/SKIP_TOKEN.test.ts`

**Исходный файл**: `src/query/SKIP_TOKEN.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-069 | SKIP является Symbol | `typeof SKIP === 'symbol'` |
| TC-070 | SKIP уникален | `SKIP !== Symbol('SKIP')` — каждый `Symbol()` создаёт уникальный символ |

**Паттерн теста**:
```typescript
import { describe, it, expect } from 'vitest';
import { SKIP } from './SKIP_TOKEN';

describe('SKIP_TOKEN', () => {
    it('SKIP is a symbol', () => {
        expect(typeof SKIP).toBe('symbol');
    });

    it('SKIP is unique (not equal to another Symbol with same description)', () => {
        expect(SKIP).not.toBe(Symbol('SKIP'));
    });
});
```

---

### Задача 3.2: Тест `IndirectMap`

**Новый файл**: `src/query/lib/IndirectMap.test.ts`

**Исходный файл**: `src/query/lib/IndirectMap.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-001 | Примитивный ключ: set/get | `map.set('key', value)` → `map.get('key')` возвращает value |
| TC-002 | Объектный ключ: shallow equal | `map.set({a:1}, v1)` → `map.get({a:1})` возвращает v1 |
| TC-003 | Объектные ключи: разные значения | `map.set({a:1}, v1)` → `map.get({a:2})` возвращает undefined |
| TC-004 | WeakMap кэш: повторные обращения | Второй `get({a:1})` использует кэш |
| TC-005 | delete: удаление по ключу | `map.delete({a:1})` → `map.get({a:1})` возвращает undefined |
| TC-006 | has: проверка существования | `map.has({a:1})` = true/false |
| TC-007 | values: итерация | `[...map.values()]` содержит все значения |
| TC-008 | Кастомный compare function | `new IndirectMap(deepEqual)` |
| TC-009 | Примитивные edge-case ключи | `number`, `null`, `undefined` |

**Зависимости для теста**:
- Import: `IndirectMap` из `@/query/lib/IndirectMap`
- Import: `shallowEqual` из `@/common/utils/shallowEqual` (для reference, если нужен кастомный compare)
- Import: `deepEqual` из `@/common/utils/deepEqual` (для TC-008)

---

### Задача 3.3: Тест `ReactiveCache`

**Новый файл**: `src/query/lib/ReactiveCache.test.ts`

**Исходный файл**: `src/query/lib/ReactiveCache.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-010 | Создание с initial value | `new ReactiveCache(initialState)` → `.value` возвращает initialState |
| TC-011 | next(): обновление значения | `.next(newState)` → подписчики получают newState |
| TC-012 | value$ Observable: подписка | `cache.value$.obs.subscribe()` получает текущее и новые |
| TC-013 | Cache lifetime: таймер при refCount=0 | Отписка всех → таймер → `complete()` |
| TC-014 | Cache lifetime: таймер отменяется | Отписка → подписка до истечения → кэш жив |
| TC-015 | complete(): idempotent | Двойной `complete()` не бросает |
| TC-016 | closed: флаг | `cache.closed` = true после complete |
| TC-017 | signalized value$ | `value$` — SyncObservable с `.value` доступом |

**Зависимости для теста**:
- Import: `ReactiveCache` из `@/query/lib/ReactiveCache`
- `vi.useFakeTimers()` — для контроля `cacheLifetime` таймера
- `rxjs` `Subscription` — для управления подписками

**Важно**: необходимо изучить конструктор `ReactiveCache` чтобы определить точные параметры инициализации и доступные методы.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Новые тесты проходят
npx vitest run src/query/SKIP_TOKEN.test.ts src/query/lib/IndirectMap.test.ts src/query/lib/ReactiveCache.test.ts

# 3. Все остальные тесты не сломаны
npx vitest run
```

## Conventional commit

```
test(query): add unit tests for SKIP_TOKEN, IndirectMap and ReactiveCache

- SKIP_TOKEN: symbol type and uniqueness
- IndirectMap: primitive/object keys, shallow equal, delete, has, values, custom compare
- ReactiveCache: lifecycle, timers, subscriptions, signalized value$
```
