# Документация: Signal Devtools Lifecycle Hooks (v3 — Redraft 2)

**Status**: Redraft  
**Дата**: 2026-03-11

---

## 1. Changelog

Записи для `docs/CHANGELOG.md` при релизе.

### Новое

- **`SignalOptions<T>`** — единый тип конфигурации сигналов (State, Computed, Signal, LocalState)
- **`SignalLifecycleHook<T>`** — интерфейс набора lifecycle-хуков (`onInit`, `onChange`, `onDispose`)
- **`SignalOptionsOrKey<T>`** — union-тип: строка-shorthand или `SignalOptions<T>`
- **`normalizeSignalOptions()`** — утилита нормализации опций сигнала
- **`hooks: SignalLifecycleHook<T>[]`** — массив lifecycle-хуков в `SignalOptions`
- **`beforeDevtoolsPush`** — callback для кастомизации значений перед отправкой в devtools
- **`Devtools.createHooks()`** — метод создания devtools LC-хука для сигналов

### Deprecated

- **`name`** в `SignalOptions` — используйте `key`. Автоматическая миграция через `normalizeSignalOptions()`

---

## 2. Документация сигналов

Обновить `docs/signals/README.md`.

### 2.1. `SignalOptions<T>`

Единый объект конфигурации для всех сигналов.

| Поле | Тип | Описание |
|------|-----|----------|
| `key` | `string` | Ключ сигнала для devtools |
| `name` | `string` | **@deprecated** — используйте `key` |
| `base` | `string` | Префикс ключа (устанавливается автоматически) |
| `isDisabled` | `boolean` | Отключить devtools для сигнала |
| `beforeDevtoolsPush` | `(v: T, push: (v: T) => void) => void` | Кастомизация devtools-вывода |
| `hooks` | `SignalLifecycleHook<T>[]` | Массив наборов lifecycle-хуков |

Строковый shorthand: 'counter' эквивалентен `{ key: 'counter' }`.

### 2.2. `SignalLifecycleHook<T>`

Один набор lifecycle-хуков — элемент массива `hooks[]`.

| Callback | Когда вызывается |
|----------|-----------------|
| `onInit(value)` | При создании сигнала (синхронно в конструкторе) |
| `onChange(newValue)` | При изменении значения (не при одинаковом) |
| `onDispose()` | При GC сигнала (FinalizationRegistry) |

Порядок итерации: `hooks[0]` (devtools, автоматически) → `hooks[1..N]` (пользовательские).

### 2.3. `beforeDevtoolsPush`

Callback `(newValue, push) => void`. Контролирует, что попадает в devtools. Если `push()` не вызван — значение не отправляется. Не является lifecycle-хуком — влияет только на devtools.

### 2.4. `normalizeSignalOptions()`

Утилита нормализации: строка → `{ key }`, миграция `name` → `key`. Экспортируется для авторов библиотек.

