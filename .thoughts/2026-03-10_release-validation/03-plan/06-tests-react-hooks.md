# Фаза 6: Smoke-тесты React hooks

## Цель

Создать smoke-тесты для React hooks query-модуля: `useResourceAgent`, `useCommandAgent`, `useResourceRef`. Тесты верифицируют корректность React-обёрток поверх уже протестированного core. Включает верификацию bugfix из Phase 2.

## Зависимости

- **Requires**: Phase 2 (bugfix useResourceRef), Phase 5 (core протестирован)
- **Blocks**: Phase 7

## Тип выполнения

Последовательная.

---

## Задачи

### Задача 6.1: Smoke-тест `useResourceAgent`

**Новый файл**: `src/query/react/useResourceAgent.test.ts`

**Исходный файл**: `src/query/react/useResourceAgent.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-071 | Рендер без ошибок | `renderHook(() => useResourceAgent(res, args))` — не бросает |
| TC-072 | SKIP не вызывает initiate | `renderHook(() => useResourceAgent(res, SKIP))` — queryFn не вызван |
| TC-073 | Смена args → re-initiate | rerender с новыми args → queryFn вызван повторно |

**Зависимости для теста**:
- `@testing-library/react` — `renderHook`, `act` (уже в devDependencies)
- `createResource()` из `@/query/api/createResource`
- `SKIP` из `@/query/SKIP_TOKEN`
- Mock `queryFn` с controlable promise

**Паттерн теста**:
```typescript
import { renderHook, act } from '@testing-library/react';
import { useResourceAgent } from './useResourceAgent';
import { createResource } from '@/query/api/createResource';
import { SKIP } from '@/query/SKIP_TOKEN';

const mockQueryFn = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });

const testResource = createResource({
    queryFn: mockQueryFn,
});

describe('useResourceAgent', () => {
    it('renders without throwing', () => {
        const { result } = renderHook(() => useResourceAgent(testResource, 'arg1'));
        expect(result.current).toBeDefined();
    });

    it('does not call queryFn when SKIP is passed', () => {
        mockQueryFn.mockClear();
        renderHook(() => useResourceAgent(testResource, SKIP));
        expect(mockQueryFn).not.toHaveBeenCalled();
    });
});
```

**Примечание**: может потребоваться `cleanup()` между тестами и reset Resource state. Проверить, как существующие тесты в `src/signals/react/` обрабатывают cleanup.

---

### Задача 6.2: Smoke-тест `useCommandAgent`

**Новый файл**: `src/query/react/useCommandAgent.test.ts`

**Исходный файл**: `src/query/react/useCommandAgent.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-074 | trigger вызывает initiate | `const [trigger, state] = result.current; trigger(args)` |

**Зависимости для теста**:
- `@testing-library/react` — `renderHook`, `act`
- `createCommand()` из `@/query/api/createCommand`
- Mock `queryFn`

**Паттерн теста**:
```typescript
import { renderHook, act } from '@testing-library/react';
import { useCommandAgent } from './useCommandAgent';
import { createCommand } from '@/query/api/createCommand';

const mockQueryFn = vi.fn().mockResolvedValue({ success: true });

const testCommand = createCommand({
    queryFn: mockQueryFn,
});

describe('useCommandAgent', () => {
    it('trigger calls initiate', async () => {
        const { result } = renderHook(() => useCommandAgent(testCommand));
        const [trigger] = result.current;

        await act(async () => {
            trigger({ data: 'test' });
        });

        expect(mockQueryFn).toHaveBeenCalled();
    });
});
```

---

### Задача 6.3: Smoke-тест `useResourceRef` (включая верификацию bugfix)

**Новый файл**: `src/query/react/useResourceRef.test.ts`

**Исходный файл**: `src/query/react/useResourceRef.ts`

**Тест-кейсы** (из [06-testcases.md](../02-design/06-testcases.md)):

| # | Кейс | Описание |
|---|------|----------|
| TC-075 | Создание ref | `renderHook(() => useResourceRef(res, args))` — ref создан |
| TC-076 | Объектные args — ref стабилен (BUGFIX) | rerender с `{id:1}` → тот же ref |
| TC-077 | Примитивные args — ref стабилен | rerender с `'id1'` → тот же ref |

**Зависимости для теста**:
- `@testing-library/react` — `renderHook`
- `createResource()` — нужен Resource с предзаполненными данными (через `createWithData` или mock)
- Проверка стабильности: `result.current` после rerender должен быть `===` предыдущему

**Критический тест — TC-076**:
```typescript
it('returns stable ref for object args (bugfix)', () => {
    const { result, rerender } = renderHook(
        ({ args }) => useResourceRef(testResource, args),
        { initialProps: { args: { id: 1 } } }
    );

    const firstRef = result.current;

    // Rerender с новым объектом, но те же значения
    rerender({ args: { id: 1 } });

    expect(result.current).toBe(firstRef); // Та же ссылка
});
```

Этот тест **верифицирует bugfix из Phase 2**.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Новые тесты проходят
npx vitest run src/query/react/useResourceAgent.test.ts src/query/react/useCommandAgent.test.ts src/query/react/useResourceRef.test.ts

# 3. Все тесты проходят
npx vitest run
```

## Conventional commit

```
test(query): add smoke tests for React hooks

- useResourceAgent: render, SKIP token, args change
- useCommandAgent: trigger calls initiate
- useResourceRef: ref creation, stable ref for object args (bugfix verification)
```
