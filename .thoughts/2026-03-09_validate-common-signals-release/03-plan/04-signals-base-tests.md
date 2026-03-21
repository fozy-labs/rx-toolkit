# Фаза 4 — Тесты src/signals/base

**Цель**: Покрыть тестами все файлы `src/signals/base/` — Batcher (включая верификацию фикса), ComputeCache, DependencyTracker, Devtools, Indexer, ReadonlySignal, SyncObservable.

**Зависимости**: Фаза 1 (инфраструктура), Фаза 2 (фикс Batcher — тесты Batcher проверяют результат фикса)  
**Тип выполнения**: Параллельная (задачи независимы друг от друга)  
**Сложность**: Высокая

---

## Задачи

### Задача 4.1 — Тесты Batcher

**Файл**: `src/signals/base/Batcher.test.ts` (новый)  
**Исходный файл**: `src/signals/base/Batcher.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-4](../02-design/03-usecases.md)):

**Batcher.run():**
- `run(fn)` — выполняет `fn` и возвращает результат
- `run(fn)` — планирует и выполняет scheduled задачи
- Вложенный `run()` (isLocked === true) — `fn` выполняется напрямую, без повторного батчинга
- Пустой батч — `Scheduled.run()` при пустой карте корректно завершается

**Верификация фикса try/finally** ([02-dataflow.md](../02-design/02-dataflow.md#4-batcher-обработка-ошибок)):
- `fn()` бросает исключение → `isLocked` сбрасывается → следующий `run()` работает
- `fn()` бросает → исключение пробрасывается наверх
- После ошибки — батчинг сигналов продолжает работать корректно

**Batcher.scheduler():**
- `scheduler(rang)` — возвращает объект со `schedule`
- `schedule(fn)` при `isLocked === false` — `fn` выполняется немедленно
- `schedule(fn)` при `isLocked === true` — `fn` добавляется в `Scheduled`
- Порядок рангов: rang=0 выполняется раньше rang=1
- rang=Infinity — выполняется последним (devtools)

---

### Задача 4.2 — Тесты ComputeCache

**Файл**: `src/signals/base/ComputeCache.test.ts` (новый)  
**Исходный файл**: `src/signals/base/ComputeCache.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `getOrCompute()` — первый вызов (cache miss) вычисляет значение
- `getOrCompute()` — повторный вызов (cache hit) возвращает кешированное
- Инвалидация: зависимость изменилась → кеш невалиден → пересчёт
- `isValid()` — true когда зависимости не изменились
- `isValid()` — false когда зависимости изменились
- Ошибка в `computeFn` — кеш остаётся невалидным, ошибка пробрасывается

**Примечание**: Для тестирования нужен реальный `DependencyTracker` и простые сигналы (`State`) для зависимостей.

---

### Задача 4.3 — Тесты DependencyTracker

**Файл**: `src/signals/base/DependencyTracker.test.ts` (новый)  
**Исходный файл**: `src/signals/base/DependencyTracker.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `start(handler)` → `track(dep)` → `stop()`:  зависимость добавлена
- Множественные `track()` — все зависимости собраны
- Вложенные tracked contexts — внутренний context не затирает внешний
- `Stop()` возвращает корректный список зависимостей
- Без `start()` — `track()` — корректное поведение (нет активного handler)

---

### Задача 4.4 — Тесты Indexer

**Файл**: `src/signals/base/Indexer.test.ts` (новый)  
**Исходный файл**: `src/signals/base/Indexer.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- Автоинкремент — каждое обращение возвращает уникальное значение
- Уникальность — значения не повторяются

**Примечание**: Тесты НЕ зависят от конкретных значений `currentIndex` (могут расти между тестами из-за `pool: 'forks'` изоляции на уровне файла).

---

### Задача 4.5 — Тесты ReadonlySignal

**Файл**: `src/signals/base/ReadonlySignal.test.ts` (новый)  
**Исходный файл**: `src/signals/base/ReadonlySignal.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `ReadonlySignal.create(subscribe)` — создание из subscribe-функции
- `peek()` — возвращает текущее значение синхронно
- `obs` — возвращает Observable, подписка эмитит значения
- Вызов как функция `signal()` — эквивалентен `peek()` + tracking
- Нет метода `set()` — readonly контракт

---

### Задача 4.6 — Тесты SyncObservable

**Файл**: `src/signals/base/SyncObservable.test.ts` (новый)  
**Исходный файл**: `src/signals/base/SyncObservable.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-10.2](../02-design/03-usecases.md)):
- `.value` от `BehaviorSubject` — возвращает текущее значение синхронно
- `.value` от Observable без немедленного значения — бросает ошибку
- `subscribe()` — подписка работает как у обычного Observable
- `pipe()` — пайплайн работает корректно

---

### Задача 4.7 — Тесты Devtools

**Файл**: `src/signals/base/Devtools.test.ts` (новый)  
**Исходный файл**: `src/signals/base/Devtools.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `createState()` при `SharedOptions.DEVTOOLS === null` — возвращает `null`
- `createState()` при установленном devtools — создаёт и возвращает `DevtoolsStateLike`
- Проверка что используется `Indexer` для генерации уникальных ключей

**Примечание**: Для этого теста нужно мокировать `SharedOptions.DEVTOOLS` через `beforeEach`.

---

## Верификация

- [ ] 7 тестовых файлов созданы в `src/signals/base/`
- [ ] `npm run test` — все тесты проходят
- [ ] Batcher: тесты try/finally подтверждают восстановление после ошибки
- [ ] Batcher: тесты порядка рангов подтверждают приоритизацию
- [ ] ComputeCache: тесты cache hit/miss работают с реальными зависимостями
- [ ] DependencyTracker: тесты вложенных contexts подтверждают stack-based подход
- [ ] Нет модификаций исходного кода

## Коммит

```
test(signals/base): add unit tests for signals base infrastructure

- Batcher: run, nested run, scheduler, rang ordering, try/finally fix verification
- ComputeCache: cache hit/miss, invalidation, error handling
- DependencyTracker: start/stop, track, nested contexts
- Indexer: auto-increment, uniqueness
- ReadonlySignal: create, peek, obs, function wrapper
- SyncObservable: value from BehaviorSubject, error on no value, subscribe, pipe
- Devtools: createState with/without devtools, Indexer keys
```
