# Фаза 7 — Тесты интеграции и верификация экспортов

**Цель**: Написать кроссмодульные интеграционные тесты, проверить полноту и корректность экспортов из `index.ts`, проверить работоспособность deprecated API.

**Зависимости**: Фазы 3 и 6 (все unit-тесты должны проходить)  
**Тип выполнения**: Последовательная  
**Сложность**: Средняя

---

## Задачи

### Задача 7.1 — Интеграционные тесты сигнальной системы

**Файл**: `src/__tests__/integration/signals-integration.test.ts` (новый)  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md) — раздел «Integration тесты»):

**Diamond problem (критический):**
- `A → B (A*2)`, `A → C (A+10)`, `Effect D (B + C)` — при обновлении A, D всегда видит consistent state
- Проверка нескольких последовательных обновлений A

**Глубокая цепочка:**
- `State → C1 → C2 → C3 → Effect` — значение корректно пропагируется через всю цепочку
- Изменение State → все computed пересчитываются → Effect получает финальное значение

**Батчинг многих сигналов:**
- `Batcher.run(() => { s1.set(); s2.set(); s3.set(); })` — Effect, зависящий от всех трёх, перезапускается ровно один раз

**Ошибка в батче (критический):**
- Ошибка внутри `Batcher.run()` → система восстанавливается → следующий батч работает
- Ошибка в одном из нескольких `set()` внутри батча

**Computed: переход peek → subscribe → peek:**
- `peek()` → подписка на `.obs` → отписка → `peek()` — все возвращают корректное значение

**Effect teardown chain:**
- Effect с teardown → 3 обновления зависимости → проверка правильного порядка вызова teardowns

**Динамические зависимости:**
- Effect читает `A` или `B` в зависимости от `flag()` — при изменении flag, подписки корректно переключаются

---

### Задача 7.2 — Верификация экспортов src/signals/index.ts

**Файл**: `src/signals/index.ts`  
**Действие**: Написать тест-файл `src/__tests__/integration/signals-exports.test.ts` (новый)

Проверить что следующие сущности экспортируются из `src/signals/`:
- `Batcher`, `ComputeCache`, `DependencyTracker`, `Devtools`, `ReadonlySignal`, `SyncObservable`
- `signalize`
- `useSignal`
- `State`, `Computed`, `Effect`, `Signal`, `LocalState`, `LocalSignal`
- Типы: `ReadableSignalLike`, `WriteableSignalLike`, `ClearableSignalLike`, `StatefulSignalFn`, `SignalFn`, `ComputeFn`

**Метод проверки**: Импорт всех названных сущностей и проверка `expect(X).toBeDefined()`.

---

### Задача 7.3 — Верификация экспортов src/common/

**Файл**: `src/__tests__/integration/common-exports.test.ts` (новый)  
**Действие**: Создать тестовый файл

Проверить экспорты:
- Из `src/common/devtools/`: `reduxDevtools`, `combineDevtools`, `DevtoolsLike`, `DevtoolsStateLike`, `StateDevtoolsOptions`, `BatchStrategy`
- Из `src/common/options/`: `DefaultOptions`
- Из `src/common/react/`: `useConstant`, `useEventHandler`
- Из `src/common/utils/`: `deepEqual`, `shallowEqual`

---

### Задача 7.4 — Верификация экспортов корневого src/index.ts

**Файл**: `src/__tests__/integration/root-exports.test.ts` (новый)  
**Действие**: Создать тестовый файл

Проверить что вcё из scope доступно через корневой `src/index.ts`:
- `import { Signal, State, Computed, Effect, ... } from '@/index'`
- Все публичные API из common и signals доступны

---

### Задача 7.5 — Верификация deprecated API с предупреждениями

**Файл**: `src/__tests__/integration/deprecated-api.test.ts` (новый)  
**Действие**: Создать тестовый файл

Проверить что deprecated API работает и функционально эквивалентен замене ([ADR-4](../02-design/04-decisions.md#adr-4)):

| Deprecated | Замена | Тест |
|-----------|--------|------|
| `Signal` constructor | `State` constructor | Создание, set, peek — идентичное поведение |
| `Signal.create()` | `Signal.state()` | Создание — идентичная функциональность |
| `Effect.complete()` | `Effect.unsubscribe()` | Cleanup — идентичное поведение |
| `LocalSignal` | `LocalState` | Один и тот же класс/функция |
| `validator$` option | `checkEffect` option | Обе опции работают в LocalState |

Каждый тест помечается комментарием `// TODO(v0.6.0): remove deprecated API test`.

---

## Верификация

- [ ] `src/__tests__/integration/signals-integration.test.ts` создан с 7+ кейсами
- [ ] `src/__tests__/integration/signals-exports.test.ts` создан
- [ ] `src/__tests__/integration/common-exports.test.ts` создан
- [ ] `src/__tests__/integration/root-exports.test.ts` создан
- [ ] `src/__tests__/integration/deprecated-api.test.ts` создан
- [ ] `npm run test` — ВСЕ тесты проходят (unit + integration)
- [ ] Diamond problem тест подтверждает glitch-free
- [ ] Ошибка в батче → восстановление (интеграционная проверка фикса Phase 2)
- [ ] Все deprecated API функциональны и помечены TODO(v0.6.0)
- [ ] Все ожидаемые экспорты доступны из index.ts файлов
- [ ] Нет модификаций исходного кода

## Коммит

```
test(integration): add integration tests, export verification, deprecated API checks

- Integration: diamond problem, deep chain, multi-signal batching, error recovery
- Integration: computed peek/subscribe transition, effect teardown chain, dynamic deps
- Exports: verify src/signals/index.ts, src/common/*/index.ts, src/index.ts completeness
- Deprecated: Signal constructor, Signal.create, Effect.complete, LocalSignal, validator$
```
