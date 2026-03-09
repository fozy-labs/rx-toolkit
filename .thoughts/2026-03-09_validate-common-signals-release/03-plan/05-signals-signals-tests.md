# Фаза 5 — Тесты src/signals/signals

**Цель**: Покрыть тестами высокоуровневые примитивы сигнальной системы — State, Computed, Effect, Signal (фасад), LocalState. Включая diamond problem, glitch-free гарантии, lifecycle, deprecated API.

**Зависимости**: Фаза 4 (тесты signals/base — подтверждение корректности инфраструктуры)  
**Тип выполнения**: Параллельная (задачи независимы друг от друга)  
**Сложность**: Высокая

---

## Задачи

### Задача 5.1 — Тесты Signal (фасад)

**Файл**: `src/signals/signals/Signal.test.ts` (новый)  
**Исходный файл**: `src/signals/signals/Signal.ts`  
**Действие**: Создать тестовый файл

**Примечание**: Signal — основная точка входа для создания реактивных примитивов. Все тесты в этой фазе преимущественно используют `Signal.state()`, `Signal.compute()`, `Signal.effect()` для создания экземпляров.

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):

**Фасадный API (основной):**
- `Signal.state(initial)` — создаёт `StatefulSignalFn`, значение доступно через `()`, `peek()`, `set()`, `obs`
- `Signal.compute(fn)` — создаёт `ComputeFn`, ленивое вычисление с кешированием
- `Signal.effect(fn)` — создаёт `SubscriptionLike`, автотрекинг зависимостей

**Интеграция через фасад:**
- `Signal.state()` → `Signal.compute()` — computed отслеживает state
- `Signal.state()` → `Signal.effect()` — effect реагирует на изменения state
- `Signal.state()` → `Signal.compute()` → `Signal.effect()` — полная цепочка

**Deprecated API** ([ADR-4](../02-design/04-decisions.md#adr-4)):
- `new Signal(initial)` — создаёт сигнал (deprecated constructor) // TODO(v0.6.0): remove
- `Signal.create(initial)` — эквивалентен `Signal.state(initial)` // TODO(v0.6.0): remove
- Deprecated API функционально эквивалентен новому API

---

### Задача 5.2 — Тесты State

**Примечание**: Экземпляры создаются через `Signal.state()` (фасад). Raw `State.create()` тестируется для обратной совместимости.

**Файл**: `src/signals/signals/State.test.ts` (новый)  
**Исходный файл**: `src/signals/signals/State.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-1](../02-design/03-usecases.md)):

**Создание и базовые операции:**
- `Signal.state(initial)` / `State.create(initial)` — создаёт сигнал с начальным значением
- `signal()` — вызов как функция возвращает текущее значение
- `signal.peek()` — возвращает текущее значение синхронно
- `signal.set(newValue)` — обновляет значение
- `signal.set(sameValue)` — referential equality skip (не эмитит)
- `signal.clear()` — сбрасывает к начальному значению

**Observable:**
- `signal.obs` — возвращает `SyncObservable`, подписка эмитит текущее значение
- `signal.obs.subscribe()` — получает обновления при `set()`

**Tracking:**
- `signal()` в tracked context — создаёт зависимость
- `signal.peek()` в tracked context — НЕ создаёт зависимость

**Batching:**
- `signal.set()` оборачивается в `Batcher.run()` автоматически

**Крайние случаи:**
- `null` / `undefined` как значение сигнала
- Объекты: `set(newObj)` при идентичном содержимом, но разной ссылке → эмитит (referential equality)

**Devtools (опционально):**
- Создание с `options` и mock devtools — `Devtools.createState()` вызывается

---

### Задача 5.3 — Тесты Computed

**Примечание**: Экземпляры создаются через `Signal.compute()` (фасад). Raw `Computed.create()` тестируется для обратной совместимости.

**Файл**: `src/signals/signals/Computed.test.ts` (новый)  
**Исходный файл**: `src/signals/signals/Computed.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-2](../02-design/03-usecases.md)):

**Ленивое вычисление:**
- `Signal.compute(fn)` / `Computed.create(fn)` — `fn` НЕ вызывается при создании
- `peek()` — первый вызов запускает `fn` (cache miss)
- `peek()` — повторный вызов использует кеш (cache hit), `fn` не вызывается

**Инвалидация:**
- Зависимость изменилась → `peek()` вызывает `fn` заново
- Множественные зависимости — инвалидация при изменении любой

**Подписка через .obs:**
- Подписка → создаёт внутренний Effect, значение обновляется реактивно
- Все подписки закрыты → `resetOnRefCountZero` уничтожает Effect
- Повторная подписка после отписки — корректное пересоздание

**Diamond problem (glitch-free)** ([02-dataflow.md](../02-design/02-dataflow.md#3-diamond-problem)):
- `A → B (A*2)`, `A → C (A+10)`, `Effect D (B + C)` — при изменении A, D видит consistent B и C
- Промежуточное состояние {B=new, C=old} НЕ наблюдается

**Ошибки:**
- Ошибка в `computeFn` — пробрасывается наверх
- Ошибка в `computeFn` — кеш невалиден, следующий `peek()` пересчитывает

**Режимы работы:**
- Переход: peek → подписка → peek — все возвращают корректное значение

---

### Задача 5.4 — Тесты Effect

**Примечание**: Экземпляры создаются через `Signal.effect()` (фасад). Raw `Effect.create()` тестируется для обратной совместимости.

**Файл**: `src/signals/signals/Effect.test.ts` (новый)  
**Исходный файл**: `src/signals/signals/Effect.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-3](../02-design/03-usecases.md)):

**Автотрекинг:**
- `Signal.effect(fn)` / `Effect.create(fn)` — `fn` выполняется немедленно
- При чтении сигнала внутри `fn` — зависимость отслеживается
- При изменении зависимости — `fn` перезапускается
- Динамические зависимости: при разных условиях читаются разные сигналы

**Teardown:**
- Возврат функции из `effectFn` — вызывается ПЕРЕД перезапуском
- Цепочка teardown: каждый перезапуск вызывает предыдущий cleanup
- Последний teardown при `unsubscribe()`

**Lifecycle:**
- `unsubscribe()` — полная очистка подписок, дальнейшие изменения игнорируются
- Двойной `unsubscribe()` — не бросает ошибку

**Deprecated API** ([ADR-4](../02-design/04-decisions.md#adr-4)):
- `effect.complete()` — эквивалентен `effect.unsubscribe()` // TODO(v0.6.0): remove

**Batching:**
- Множественные обновления внутри `Batcher.run()` → Effect перезапускается ОДИН раз

**Крайние случаи:**
- Effect без зависимостей (не читает сигналы) — `fn` выполняется один раз, не перезапускается
- Ошибка в `effectFn` — документация текущего поведения

---

### Задача 5.5 — Тесты LocalState

**Файл**: `src/signals/signals/LocalState.test.ts` (новый)  
**Исходный файл**: `src/signals/signals/LocalState.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-9](../02-design/03-usecases.md)):

**Создание и базовые операции:**
- `LocalState.create({ key, schema, defaultValue })` — создаёт сигнал с default
- `set()` — сохраняет значение в localStorage
- `peek()` — возвращает текущее значение
- `clear()` — сбрасывает к defaultValue, очищает localStorage

**Синхронизация с localStorage:**
- Данные корректно сериализуются в localStorage
- Данные загружаются из localStorage при создании
- Невалидный JSON в storage — документация поведения (бросает ошибку, текущее ограничение)

**Валидация:**
- Zod-схема: валидные данные принимаются
- Zod-схема: невалидные данные — используется defaultValue + console.warn

**Deprecated API** ([ADR-4](../02-design/04-decisions.md#adr-4)):
- `validator$` option — deprecated в пользу `checkEffect` // TODO(v0.6.0): remove
- `LocalSignal` alias — deprecated в пользу `LocalState` // TODO(v0.6.0): remove

**Setup:**
- `beforeEach(() => localStorage.clear())` — изоляция тестов

---

## Верификация

- [ ] 5 тестовых файлов созданы в `src/signals/signals/`
- [ ] `npm run test` — все тесты проходят
- [ ] Signal: фасад `Signal.state/compute/effect` — основная точка входа для тестов
- [ ] Signal: интеграция через фасад (state → compute → effect)
- [ ] Signal: deprecated constructor и `create()` тесты с TODO(v0.6.0)
- [ ] State: referential equality skip подтверждён (через `Signal.state()`)
- [ ] Computed: ленивое вычисление и кеширование подтверждены (через `Signal.compute()`)
- [ ] Computed: diamond problem / glitch-free тест проходит
- [ ] Effect: автотрекинг и teardown подтверждены (через `Signal.effect()`)
- [ ] Effect: `complete()` deprecated тест с TODO(v0.6.0)
- [ ] LocalState: синхронизация с localStorage подтверждена
- [ ] LocalState: `LocalSignal` и `validator$` deprecated тесты с TODO(v0.6.0)
- [ ] Нет модификаций исходного кода

## Коммит

```
test(signals): add unit tests for Signal facade, State, Computed, Effect, LocalState

- Signal facade: state/compute/effect API, integration chain, deprecated constructor/create
- State: create via Signal.state(), set/peek/call, referential equality, obs, clear, tracking
- Computed: create via Signal.compute(), lazy evaluation, cache hit/miss, diamond problem (glitch-free)
- Effect: create via Signal.effect(), auto-tracking, teardown chain, unsubscribe, dynamic deps, batching
- LocalState: localStorage sync, zod validation, clear, deprecated validator$/LocalSignal
```
