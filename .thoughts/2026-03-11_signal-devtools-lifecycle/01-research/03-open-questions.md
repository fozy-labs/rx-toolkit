# Открытые вопросы: Signal Devtools Lifecycle Hooks

**Дата**: 2026-03-11

---

## 1. Архитектура lifecycle hooks

### 1.1. Flat vs Grouped хуки в SignalOptions

**Варианты**:

| Вариант | Пример | За | Против |
|---|---|---|---|
| **A) Flat `on*`** | `{ name, onChange, onDispose }` | Совпадает с TC39/Preact; проще типизация; нет вложенности | При 5+ хуках загрязняет top-level |
| **B) Grouped `hooks`** | `{ name, hooks: { change, dispose } }` | Чистый top-level; группировка | Дополнительная аллокация; нестандартный подход |

**Рекомендация**: Вариант A (flat) — соответствует Preact Signals и TC39 Proposal, меньше аллокаций.

Ответ: название `hooks` не нравится. Не A и не B: я же указал: "нобором хухов LC", те массив

### 1.2. Набор lifecycle-хуков

Какие именно lifecycle events нужны? Текущие неявные события:

| Событие | Текущий механизм | Нужен хук? |
|---|---|---|
| **Создание** | `Devtools.createState()` в конструкторе | Да — `onInit` |
| **Обновление** | `this._stateDevtools?.(value)` в `set()` | Да — `onChange` |
| **GC/Dispose** | `FinalizationRegistry` → `$COMPLETED` | Да — `onDispose` |
| **Первая подписка** | Нет | Под вопросом — `watched` (TC39) |
| **Потеря подписчиков** | Нет | Под вопросом — `unwatched` (TC39) |

**Открытый вопрос**: нужны ли `watched`/`unwatched` сейчас, или достаточно `onInit`/`onChange`/`onDispose`?

Ответ: Да, имхго названия `watched`/`unwatched` могут быть не корректными.

### 1.3. Название поля для набора хуков LC

В задаче указано "набор хуков LC" (lifecycle). Если используется grouped-подход, как назвать поле?

**Варианты**: `hooks`, `lifecycle`, `on`, `listeners`, `observers`

**Рекомендация**: Если flat — не нужно отдельное поле. Если grouped — `hooks` (кратко, понятно).

Ответ: не знаю

---

## 2. Замена `_skipValues`

### 2.1. Сигнатура нового публичного метода

Задача: «новый публичный опциональный метод для кастомизации отправляемой в devtools информации, принимает два аргумента: новое значение и функцию push значения в devtools».

**Варианты предложенного callback**:

```typescript
// Вариант A: метод внутри onChange хука, пользователь решает пушить или нет
onChange?: (newValue: T, push: (value: T) => void) => void;

// Вариант B: отдельный метод mapDevtools рядом с onChange
mapDevtools?: (newValue: T, push: (value: T) => void) => void;

// Вариант C: onChange для devtools + onChange для общей логики
onDevtoolsChange?: (newValue: T, push: (value: T) => void) => void;
```

**Открытый вопрос**: Это именно callback в хуках LC, или это отдельная опция? Если это часть хуков LC, то devtools — один из потребителей хуков, и ему нужен свой `onChange` с `push`. Как совместить два подхода?

Ответ: никак не связан с хуками LC, те отдельная опция.

### 2.2. Как Computed заменит _skipValues?

Computed сейчас использует `_skipValues: [Computed._EMPTY]` для скрытия символа `_EMPTY` от devtools. С новым подходом:

```typescript
// Вариант: Computed передаёт кастомный onChange
onChange(newValue, push) {
    if (newValue !== Computed._EMPTY) {
        push(newValue);
    }
}
```

Но если `onChange` — это общий lifecycle hook, а не devtools-специфичный, как Computed будет фильтровать значения только для devtools?

Ответ: -

---

## 3. Инверсия зависимости: сигналы → devtools

### 3.1. Кто создаёт devtools lifecycle hooks?

**Текущий подход**: Devtools вызываются изнутри State (`this._stateDevtools?.(value)` в `set()`).

**Новый подход**: Devtools подключаются через набор хуков LC. Но кто создаёт этот набор?

| Вариант | Описание |
|---|---|
| **A) Автоматически** | `State.constructor` сам создаёт devtools hooks на основе SharedOptions.DEVTOOLS |
| **B) Явно через options** | Пользователь передаёт devtools hooks через SignalOptions |
| **C) Гибридно** | State автоматически merge'ит devtools hooks с пользовательскими |

**Если A или C**: State всё ещё знает о devtools (через фабрику хуков), но не вызывает их напрямую.

**Открытый вопрос**: допустимо ли, чтобы State знал о devtools хотя бы на уровне фабрики? Или devtools должны быть полностью внешними?

Ответ: Гибридно

### 3.2. QueriesLifetimeHooks — обратная совместимость

`QueriesLifetimeHooks` использует `Devtools.createState()` и `Devtools.hasDevtools` напрямую. Как это затронет изменения?

**Варианты**:
- Оставить `Devtools.createState()` для query-модуля (query не использует SignalOptions)
- Рефакторить query на тот же механизм lifecycle hooks (большой scope)

**Рекомендация**: Оставить `Devtools.createState()` для query — минимизация влияния.

Ответ: `Devtools.createState()` остается, от исопльзутеся в query и может использоваться под капотом хуков LC

---

## 4. Утилита нормализации SignalOptionsOrKey

### 4.1. Где определить тип SignalOptions?

**Варианты**:
- В `src/common/devtools/types.ts` (рядом с `StateDevtoolsOptions`)
- В `src/signals/types/` (рядом с типами сигналов)
- В новом файле `src/signals/types/options.types.ts`

**Открытый вопрос**: `SignalOptions` — это тип сигналов или common тип? Сейчас `StateDevtoolsOptions` лежит в `common/devtools`, но по сути это тип для сигналов.

Ответ: в `src/signals/types/`

### 4.2. Обратная совместимость `StateDevtoolsOptions`

Переименование `StateDevtoolsOptions` → `SignalOptions` — breaking change для внешних потребителей. Нужен ли deprecated alias?

Ответ: нет

---

## 5. Потенциальные риски

### 5.1. Производительность onChange хука
`onChange` на hot path (`State.set()`) — каждое обновление будет вызывать дополнительный callback. Нужно обеспечить ~0 overhead когда хуки не заданы.

### 5.2. FinalizationRegistry и dispose
Текущий `FinalizationRegistry` держит ссылку на `DevtoolsStateLike`. С lifecycle hooks нужно держать ссылку на `onDispose`. Не создаст ли это утечку, если хук замкнёт на внешние данные?

### 5.3. Scope изменений
Изменения затрагивают 6+ файлов в signals модуле + 1 файл в query. При неаккуратном рефакторинге можно сломать обратную совместимость.
