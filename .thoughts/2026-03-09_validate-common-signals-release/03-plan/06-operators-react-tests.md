# Фаза 6 — Тесты operators и react

**Цель**: Покрыть тестами `signalize` (оператор) и `useSignal` (React хук).

**Зависимости**: Фаза 5 (тесты signals/signals — используют те же примитивы)  
**Тип выполнения**: Параллельная (задачи независимы друг от друга)  
**Сложность**: Средняя

---

## Задачи

### Задача 6.1 — Тесты signalize

**Файл**: `src/signals/operators/signalize.test.ts` (новый)  
**Исходный файл**: `src/signals/operators/signalize.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `signalize(behaviorSubject)` — создаёт read-only сигнал с начальным значением
- `signalize(observable)` — создаёт read-only сигнал
- `signal.peek()` — возвращает текущее значение
- `signal.obs` — подписка эмитит значения при обновлении source
- `signal()` — вызов как функция работает
- Нет метода `set()` — readonly контракт

---

### Задача 6.2 — Тесты useSignal

**Файл**: `src/signals/react/useSignal.test.ts` (новый)  
**Исходный файл**: `src/signals/react/useSignal.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-5](../02-design/03-usecases.md)):

**Базовые операции:**
- Возвращает текущее значение сигнала при первом рендере
- Обновляет компонент при вызове `signal.set()`
- Возвращает обновлённое значение после set

**Lifecycle:**
- Отписывается при unmount (подписка очищена)
- Переключение signal prop — подписка пересоздаётся на новый сигнал

**Batching:**
- Множественные быстрые обновления — компонент не рендерится на каждое промежуточное значение

**SSR:**
- `.skip` тест: `getServerSnapshot` не предоставлен — документация ограничения (SSR не в scope)

**Инструментарий:**
- `renderHook` из `@testing-library/react`
- `act()` для обёртки обновлений сигналов
- `flushMicrotasks()` из `src/__tests__/helpers/async-helpers.ts` при необходимости

---

## Верификация

- [ ] 2 тестовых файла созданы: `signalize.test.ts`, `useSignal.test.ts`
- [ ] `npm run test` — все тесты проходят
- [ ] signalize: readonly контракт подтверждён
- [ ] useSignal: обновление при set подтверждено
- [ ] useSignal: cleanup при unmount подтверждён
- [ ] useSignal: `.skip` тест для SSR-ограничения
- [ ] Нет модификаций исходного кода

## Коммит

```
test(signals): add tests for signalize operator and useSignal hook

- signalize: BehaviorSubject/Observable to readonly signal, peek, obs
- useSignal: initial value, update on set, unmount cleanup, signal switch
- useSignal: .skip test for SSR limitation (no getServerSnapshot)
```
