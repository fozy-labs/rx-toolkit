# Фаза 3 — Тесты src/common

**Цель**: Покрыть тестами все файлы модуля `src/common/` — utils, options, react хуки, devtools.

**Зависимости**: Фаза 1 (инфраструктура тестирования)  
**Тип выполнения**: Параллельная (задачи независимы друг от друга)  
**Сложность**: Средняя

---

## Задачи

### Задача 3.1 — Тесты deepEqual

**Файл**: `src/common/utils/deepEqual.test.ts` (новый)  
**Исходный файл**: `src/common/utils/deepEqual.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md), [03-usecases.md UC-7](../02-design/03-usecases.md)):
- Примитивы: числа, строки, boolean, null, undefined — равенство и неравенство
- Объекты: плоские, вложенные, с разным количеством ключей
- Массивы: одинаковые, разной длины, вложенные
- Смешанные: объект с массивами, массив объектов
- Крайние случаи: пустой объект, пустой массив, оба null, оба undefined
- `.skip` тесты для известных ограничений ([ADR-5](../02-design/04-decisions.md#adr-5)):
  - `NaN` — `deepEqual(NaN, NaN)` вернёт `false` (должен `true`)
  - `Date` — `deepEqual(new Date(x), new Date(x))` сравнит как объекты
  - `RegExp` — `deepEqual(/a/, /a/)` сравнит как объекты
  - Циклические ссылки — бесконечная рекурсия

---

### Задача 3.2 — Тесты shallowEqual

**Файл**: `src/common/utils/shallowEqual.test.ts` (новый)  
**Исходный файл**: `src/common/utils/shallowEqual.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- Примитивы: числа, строки, boolean, null, undefined
- Плоские объекты: одинаковые ключи и значения, различие по ключам, различие по значениям
- Ссылочное равенство: один и тот же объект
- Один аргумент null/undefined, другой — объект
- Массивы как аргументы (shallow сравнение элементов)

---

### Задача 3.3 — Тесты PromiseResolver

**Файл**: `src/common/utils/PromiseResolver.test.ts` (новый)  
**Исходный файл**: `src/common/utils/PromiseResolver.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([03-usecases.md UC-10.3](../02-design/03-usecases.md)):
- `resolve()` — promise разрешается с переданным значением
- `reject()` — promise отклоняется с ошибкой
- Доступ к `promise` — возвращает один и тот же Promise
- Типизация: generics корректно работают

---

### Задача 3.4 — Тесты SharedOptions

**Файл**: `src/common/options/SharedOptions.test.ts` (новый)  
**Исходный файл**: `src/common/options/SharedOptions.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- Значения по умолчанию: `DEVTOOLS === null`, `defaultCompareArgs === shallowEqual`
- Установка `DEVTOOLS` — значение сохраняется
- Reset между тестами — после `beforeEach` значения сброшены (проверка изоляции)

---

### Задача 3.5 — Тесты DefaultOptions

**Файл**: `src/common/options/DefaultOptions.test.ts` (новый)  
**Исходный файл**: `src/common/options/DefaultOptions.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- `update()` с partial объектом — обновляет `SharedOptions`
- `update()` с `devtools` — устанавливает `SharedOptions.DEVTOOLS`
- Проверка что `DefaultOptions.update()` делегирует к `SharedOptions`

---

### Задача 3.6 — Тесты combineDevtools

**Файл**: `src/common/devtools/combineDevtools.test.ts` (новый)  
**Исходный файл**: `src/common/devtools/combineDevtools.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([03-usecases.md UC-8](../02-design/03-usecases.md)):
- Один devtools адаптер — updater корректно вызывается
- Несколько devtools — все updaters вызываются при обновлении
- Пустой набор devtools (если применимо)

---

### Задача 3.7 — Тесты reduxDevtools

**Файл**: `src/common/devtools/reduxDevtools.test.ts` (новый)  
**Исходный файл**: `src/common/devtools/reduxDevtools.ts`  
**Действие**: Создать тестовый файл

**Тест-кейсы** ([06-testcases.md](../02-design/06-testcases.md)):
- Создание адаптера с mock `window.__REDUX_DEVTOOLS_EXTENSION__`
- `state()` вызывает `connect()` и `init()`
- Updater вызывает `send()` с action и state
- Ошибка при отсутствии extension (throw)
- Batch strategies: sync, microtask, task — документация поведения
- Мокирование: `vi.stubGlobal('__REDUX_DEVTOOLS_EXTENSION__', mockExtension)` на объекте `window`

**Примечание**: Этот файл зависит от `Batcher` из `src/signals` (циклическая зависимость). Тестировать через реальный import, без мокирования Batcher ([05-risks.md R6](../02-design/05-risks.md#risk-6)).

---

## Верификация

- [ ] 7 тестовых файлов созданы в `src/common/`
- [ ] `npm run test` — все тесты проходят
- [ ] deepEqual: `.skip` тесты для NaN, Date, RegExp, циклических ссылок
- [ ] reduxDevtools тесты используют `vi.stubGlobal` для mock browser API
- [ ] Нет модификаций исходного кода

## Коммит

```
test(common): add unit tests for src/common module

- deepEqual: basic cases + .skip for known limitations (NaN, Date, RegExp, cycles)
- shallowEqual: primitives, objects, edge cases
- PromiseResolver: resolve, reject, promise access
- SharedOptions/DefaultOptions: defaults, update, reset isolation
- combineDevtools: single/multiple adapters
- reduxDevtools: mock extension, batch strategies, error handling
```
