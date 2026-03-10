# Фаза 7: Интеграционные тесты и конфигурация coverage

## Цель

Расширить существующие интеграционные тесты охватом query-экспортов. Обновить конфигурацию vitest для включения `src/query/` в coverage.

## Зависимости

- **Requires**: Phase 1 (типы экспортируются), Phase 6 (hooks протестированы)
- **Blocks**: Phase 8

## Тип выполнения

Последовательная.

---

## Задачи

### Задача 7.1: Расширить `root-exports.test.ts` query-экспортами

**Файл**: `src/__tests__/integration/root-exports.test.ts`

**Текущее состояние**: файл содержит тесты для `common/devtools`, `common/options`, `common/react`, `common/utils`, `signals` — но полностью отсутствуют тесты для query-экспортов.

**Добавить секцию** `describe('query re-exports', ...)` со следующими тест-кейсами:

| # | Кейс | Экспорт | Приоритет |
|---|------|---------|-----------|
| TC-078 | createResource | `mod.createResource` | 🔴 |
| TC-079 | createCommand | `mod.createCommand` | 🔴 |
| TC-080 | useResourceAgent | `mod.useResourceAgent` | 🔴 |
| TC-081 | useCommandAgent | `mod.useCommandAgent` | 🔴 |
| TC-082 | useResourceRef | `mod.useResourceRef` | 🔴 |
| TC-083 | SKIP | `mod.SKIP` | 🔴 |
| TC-084 | createResourceDuplicator | `mod.createResourceDuplicator` | 🟡 |
| TC-085 | resetAllQueriesCache | `mod.resetAllQueriesCache` | 🟡 |
| TC-086 | createOperation (deprecated) | `mod.createOperation` | 🟡 |
| TC-087 | useOperationAgent (deprecated) | `mod.useOperationAgent` | 🟡 |

**Паттерн** (аналогичен существующим тестам в файле):
```typescript
describe('query re-exports', () => {
    it('exports createResource', async () => {
        const mod = await import('@/index');
        expect(mod.createResource).toBeDefined();
    });

    it('exports createCommand', async () => {
        const mod = await import('@/index');
        expect(mod.createCommand).toBeDefined();
    });

    // ... остальные экспорты
});
```

---

### Задача 7.2: Добавить тесты экспорта типов

**Файл**: `src/__tests__/integration/root-exports.test.ts` (та же секция или отдельная)

**Тест-кейсы для типов** (type-level проверка):

| # | Кейс | Тип |
|---|------|-----|
| TC-088 | ResourceDefinition | type export |
| TC-089 | CommandDefinition | type export |
| TC-090 | ResourceQueryState | type export |
| TC-091 | CommandQueryState | type export |
| TC-092 | ResourceRefInstance | type export (исправленное имя) |

**Подход к тестированию типов**: since TypeScript types are erased at runtime, use `expectTypeOf` из vitest или compile-time проверку:

```typescript
describe('query type re-exports', () => {
    it('exports ResourceDefinition type', async () => {
        // Type-level check: if this compiles, the type is exported
        const mod = await import('@/index');
        type RD = typeof mod extends { ResourceDefinition: any } ? never : true;
        // Альтернативно: проверяем что тип используется без ошибки компиляции
    });
});
```

**Альтернативный подход**: создать вспомогательный файл `.test-d.ts` с `import type` проверками. Если `tsc --noEmit` проходит — типы экспортируются корректно.

**Простейший вариант**: inline type assertion в обычном тесте:
```typescript
it('exports query types (compile-time check)', async () => {
    // Этот тест проверяется компилятором — если типы недоступны, tsc --noEmit упадёт
    const _typeCheck = () => {
        type _RD = import('@/index').ResourceDefinition;
        type _CD = import('@/index').CommandDefinition;
        type _RQS = import('@/index').ResourceQueryState<_RD>;
        type _CQS = import('@/index').CommandQueryState<_CD>;
        type _RRI = import('@/index').ResourceRefInstance<_RD>;
    };
    expect(true).toBe(true);
});
```

---

### Задача 7.3: Обновить `vitest.config.ts` — включить query в coverage

**Файл**: `vitest.config.ts`

**Текущее состояние**:
```typescript
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
```

**Изменения**:
1. Добавить `'src/query/**'` в `include`
2. Убрать `'src/query/**'` из `exclude`
3. Установить отдельные пороги для query (начальный 50%) через `perFile` или переопределение:

```typescript
coverage: {
    provider: 'v8',
    include: ['src/common/**', 'src/signals/**', 'src/query/**'],
    exclude: [
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
```

**Примечание**: пороги 80% сохраняются глобальные. Если query-coverage ниже 80%, можно понизить глобальный порог или использовать per-file thresholds (если vitest поддерживает). Проверить актуальную документацию vitest coverage.

**Альтернатива**: если понижение глобального порога нежелательно, оставить query в exclude до достижения 80% покрытия и убрать только в финальном коммите.

---

## Верификация

```bash
# 1. TypeScript компилируется
npx tsc --noEmit

# 2. Новые тесты проходят
npx vitest run src/__tests__/integration/root-exports.test.ts

# 3. Все тесты проходят
npx vitest run

# 4. Coverage отчёт включает query
npx vitest run --coverage
```

## Conventional commit

```
test(query): add integration tests for query exports and update coverage config

- Extend root-exports.test.ts with query API exports (createResource, createCommand, etc.)
- Add type export verification (ResourceDefinition, CommandDefinition, etc.)
- Include src/query/** in vitest coverage configuration
```
