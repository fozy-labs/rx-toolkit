# Фаза 2 — Критический фикс Batcher

**Цель**: Исправить критический баг в `Batcher.run()` — добавить `try/finally` для гарантии разблокировки `Scheduled.isLocked` при ошибке.

**Зависимости**: Фаза 1 (инфраструктура тестирования)  
**Тип выполнения**: Последовательная  
**Сложность**: Низкая

---

## Контекст

Исследование ([01-codebase-analysis.md](../01-research/01-codebase-analysis.md)) выявило критический баг: если `fn()` внутри `Batcher.run()` бросит исключение, `Scheduled.isLocked` останется `true` навсегда, что заблокирует всю систему батчинга.

Дизайн ([ADR-2](../02-design/04-decisions.md#adr-2)) классифицирует это как **единственный критический фикс** в рамках данной задачи.

---

## Задача

### Задача 2.1 — Добавить try/finally в Batcher.run()

**Файл**: `src/signals/base/Batcher.ts`  
**Действие**: Модифицировать метод `run()` объекта `Batcher`

**Текущий код** (строки 47–53):
```typescript
run<T>(fn: () => T) {
    if (Scheduled.isLocked) return fn();
    Scheduled.isLocked = true;
    const v = fn();
    Scheduled.run();
    Scheduled.isLocked = false;
    return v;
},
```

**Новый код**:
```typescript
run<T>(fn: () => T) {
    if (Scheduled.isLocked) return fn();
    Scheduled.isLocked = true;
    try {
        const v = fn();
        Scheduled.run();
        return v;
    } finally {
        Scheduled.isLocked = false;
    }
},
```

**Что изменяется**:
- `fn()`, `Scheduled.run()` и `return v` обёрнуты в `try`
- `Scheduled.isLocked = false` перемещён в `finally`
- При ошибке в `fn()` или `Scheduled.run()` — `isLocked` гарантированно сбрасывается
- Исключение пробрасывается наверх (без подавления)

**Что НЕ изменяется**:
- Логика `if (Scheduled.isLocked) return fn()` — без изменений
- Порядок выполнения при успешном сценарии — идентичен
- Публичный API — без изменений

**Обоснование**: [02-dataflow.md](../02-design/02-dataflow.md) — раздел «Batcher: обработка ошибок», [05-risks.md](../02-design/05-risks.md#risk-1).

---

## Верификация

- [ ] `Batcher.run()` содержит `try/finally`
- [ ] `Scheduled.isLocked = false` находится в блоке `finally`
- [ ] `npm run build` проходит без ошибок
- [ ] `npm run ts-check` проходит без ошибок
- [ ] Ручная проверка: код идентичен описанному выше

## Коммит

```
fix(signals): add try/finally to Batcher.run() to prevent lock on error

Batcher.run() did not use try/finally, so if fn() threw an exception,
Scheduled.isLocked would remain true forever, blocking all subsequent
batching operations. This fix ensures isLocked is always reset in the
finally block, regardless of whether fn() or Scheduled.run() throws.
```
