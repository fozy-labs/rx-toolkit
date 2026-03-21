# Архитектурные решения (ADR): Signal Devtools Lifecycle Hooks (v2 — Redraft)

**Status**: Redraft  
**Дата**: 2026-03-11

---

## ADR-1: Массив LC-хуков в SignalOptions (hooks: SignalLifecycleHook[])

### Статус: Proposed

### Контекст

При добавлении lifecycle-хуков в `SignalOptions` возникает вопрос архитектуры: как хранить и расширять наборы хуков. Ревьюер явно указал: **hooks — это массив**.

Ключевые требования:
- Devtools-хук и пользовательские хуки — равноправные элементы одной коллекции
- Devtools-хук автоматически добавляется как `hooks[0]`
- Пользователь может передать несколько наборов хуков (логирование, метрики, и т.д.)
- Возможность расширения без изменения типа

### Рассмотренные варианты

**A) Flat `on*`-поля на верхнем уровне**:
```typescript
interface SignalOptions<T> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}
```
- (+) Соответствует TC39 Signals Proposal и Preact Signals API
- (+) Нет лишних аллокаций
- (−) Один набор хуков — нельзя подключить несколько обработчиков
- (−) Merge devtools + user хуков требует отдельной утилиты `mergeHooks()`
- (−) При расширении (больше потребителей хуков) — тупик

**B) Один вложенный объект `hooks: { onInit, onChange, onDispose }`**:
```typescript
interface SignalOptions<T> {
    hooks?: {
        onInit?: (value: T) => void;
        onChange?: (newValue: T) => void;
        onDispose?: () => void;
    };
}
```
- (+) Группировка
- (−) По-прежнему один набор — та же проблема merge

**C) Массив наборов хуков `hooks: SignalLifecycleHook<T>[]`**:
```typescript
interface SignalLifecycleHook<T = any> {
    onInit?: (value: T) => void;
    onChange?: (newValue: T) => void;
    onDispose?: () => void;
}

interface SignalOptions<T = any> {
    hooks?: SignalLifecycleHook<T>[];
}
```
- (+) Неограниченное количество наборов хуков
- (+) Devtools-хук = просто элемент массива, не special case
- (+) Не нужен `mergeHooks()` — State итерирует массив напрямую
- (+) Пользователь может подключить несколько независимых наборов
- (−) Чуть более сложный API для единственного набора хуков

### Решение

**Выбран вариант C — массив `hooks: SignalLifecycleHook<T>[]`**.

Массив решает проблему merge'а хуков: вместо слияния devtools-хуков с пользовательскими в один объект, State просто итерирует массив. `Devtools.createSignalHooks()` возвращает один элемент массива, пользовательские хуки — остальные элементы. Утилита `mergeHooks()` больше не нужна.

### Последствия

- `SignalLifecycleHook<T>` — новый интерфейс, один набор хуков
- `SignalOptions.hooks` — массив `SignalLifecycleHook<T>[]`
- Devtools-хук = `hooks[0]` (автоматически, через `Devtools.createSignalHooks()`)
- Пользовательские хуки = `hooks[1..N]` (из `opts.hooks`)
- `mergeHooks()` удалён — State итерирует массив `for...of`
- Для одного набора хуков: `{ hooks: [{ onChange: fn }] }`

---

## ADR-2: `beforeDevtoolsPush` — замена `_skipValues` (отделён от LC-хуков)

### Статус: Proposed

### Контекст

Текущий механизм `_skipValues: any[]` позволяет Computed скрывать технические значения (символ `_EMPTY`) от devtools. Проблемы:
- Underscore-prefix (`_skipValues`) в публичном типе
- Тип `any[]` — отсутствие типовой безопасности
- Жёстко ограничен — может только скрывать значения целиком, нельзя трансформировать

Ревьюер указал: `devtoolsOnChange` → `beforeDevtoolsPush`. Этот callback **не является LC-хуком** и должен применяться внутри `Devtools.createHooks()` — в том же месте, где сейчас `_skipValues`.

### Рассмотренные варианты

**A) `devtoolsOnChange(newValue, push)`** (предыдущий вариант):
- (−) Имя `onChange` создаёт путаницу с LC-хуком `onChange`
- (−) Ревьюер отклонил именование

**B) `beforeDevtoolsPush(newValue, push)`**:
```typescript
beforeDevtoolsPush?: (newValue: T, push: (v: T) => void) => void;
```
- (+) Чёткое имя — перехват перед пушем в devtools
- (+) Отделён от массива LC-хуков
- (+) Push-based — пользователь контролирует, что попадает в devtools
- (+) Применяется в `Devtools.createSignalHooks()` при создании devtools-хука

### Решение

**Выбран вариант B — `beforeDevtoolsPush` как отдельная опция в `SignalOptions`, применяемая в `Devtools.createHooks()`**.

`beforeDevtoolsPush` корректирует **только** то, что devtools-хук отправляет. Он не входит в массив `hooks[]` и не влияет на пользовательские хуки. Применяется в `Devtools.createHooks()` — в том же месте логики, где раньше был `_skipValues`.

### Последствия

- `_skipValues` удаляется из типов и `Devtools.createState()`
- `beforeDevtoolsPush` — поле `SignalOptions`, не элемент `hooks[]`
- Computed передаёт: `beforeDevtoolsPush: (val, push) => val !== _EMPTY && push(val)`
- `Devtools.createHooks()` проверяет наличие `beforeDevtoolsPush` и при его наличии создаёт push-based обёртку
- Пользователь может маскировать данные: `beforeDevtoolsPush: (val, push) => push({ ...val, token: '***' })`

---

## ADR-3: Именование `SignalOptions` + поле `key` (deprecating `name`)

### Статус: Proposed

### Контекст

Два изменения в именовании:

1. **Тип**: `StateDevtoolsOptions` → `SignalOptions`. Текущий тип содержит `State` в имени, но используется и в Computed, Signal, LocalState. Содержит `Devtools` в имени, но теперь включает LC-хуки.

2. **Поле**: `name` → `key`. Поле `name` используется для devtools-ключа, но семантически `key` точнее передаёт назначение — это идентификатор для индексации.

Ревьюер указал: `name` → `key` с `@deprecated name`.

### Рассмотренные варианты (тип)

| Вариант | За | Против |
|---------|-----|--------|
| `SignalOptions` | Точно отражает назначение | Общее имя |
| `SignalConfig` | Отличается от Options | Не стандартно для проекта |
| `StateDevtoolsOptions` (оставить) | Обратная совместимость | Неточное имя |

### Рассмотренные варианты (поле)

| Вариант | За | Против |
|---------|-----|--------|
| `key` | Семантически точнее — идентификатор | Миграция существующего кода |
| `name` (оставить) | Обратная совместимость | `name` — слишком общее |
| `label` | Визуальное имя | Не является идентификатором |

### Решение

- **Тип**: `SignalOptions<T>`. `StateDevtoolsOptions` не является частью документированного публичного API — его замена не будет breaking change.
- **Поле**: `key` — основное, `name` — `@deprecated`, мигрируется в `normalizeSignalOptions()`.

### Последствия

- `StateDevtoolsOptions` удаляется
- `SignalOptions<T>` определяется в `src/signals/types/`
- `SignalOptionsOrKey<T>` — union с `string`
- Поле `key` — основное для devtools-ключа
- Поле `name` — сохраняется с `@deprecated`, нормализуется в `key`
- `normalizeSignalOptions()` обрабатывает миграцию `name` → `key`
- String shorthand: `'counter'` → `{ key: 'counter' }`

---

## ADR-4: `normalizeSignalOptions` — единая точка нормализации

### Статус: Proposed

### Контекст

Текущая нормализация `string → object` выполняется **трижды**:
1. В `State.constructor`: `typeof options === 'string' ? { name: options } : options`
2. В `Computed.constructor`: аналогичная логика
3. В `Devtools.createState()`: `typeof optionsDry === 'string' ? { name: optionsDry } : optionsDry`

Дублирование нарушает DRY. С добавлением миграции `name` → `key` дублирование стало бы ещё хуже.

### Рассмотренные варианты

**A) Оставить как есть** (тройная нормализация):
- (−) Дублирование кода
- (−) Миграция `name` → `key` нужна в каждой точке

**B) Утилита `normalizeSignalOptions()`** — единая точка:
```typescript
function normalizeSignalOptions<T>(
    options?: SignalOptionsOrKey<T>
): SignalOptions<T> {
    if (!options) return {};
    if (typeof options === 'string') return { key: options };
    if (options.name && !options.key) {
        return { ...options, key: options.name };
    }
    return options;
}
```
- (+) Одна реализация — одна точка изменения
- (+) Миграция `name` → `key` в одном месте
- (+) Чистая функция без side effects

### Решение

**Выбран вариант B — утилита `normalizeSignalOptions()`**.

Определяется в `src/signals/types/`. Вызывается в `State.constructor` и `Computed.constructor`. `Devtools.createState()` сохраняет внутреннюю нормализацию для обратной совместимости с query-модулем.

### Последствия

- Новая утилита `normalizeSignalOptions()` в `src/signals/types/`
- State и Computed вызывают её как первую операцию в конструкторе
- `Devtools.createState()` не затронут — query-модуль не мигрируется
- Миграция `name` → `key` реализуется в одном месте

---

## ADR-5: `Devtools.createSignalHooks()` — метод объекта (не standalone функция)

### Статус: Proposed

### Контекст

В первоначальном дизайне devtools-хуки создавались standalone функцией `createDevtoolsHooks()`. Ревьюер указал: это должен быть **метод объекта `Devtools`**, аналогично существующему `Devtools.createState()`.

### Рассмотренные варианты

**A) Standalone функция `createDevtoolsHooks()`**:
```typescript
export function createDevtoolsHooks<T>(...): SignalLifecycleHook<T> | null
```
- (+) Чистая функция, легко тестировать
- (−) Разрозненность — devtools-логика в двух местах (объект + функция)
- (−) Ревьюер отклонил

**B) Метод объекта `Devtools.createSignalHooks()`**:
```typescript
export const Devtools = {
    createState<T>(...) { ... },
    createHooks<T>(...): SignalLifecycleHook<T> | null { ... },
    get hasDevtools() { ... },
};
```
- (+) Вся devtools-логика в одном объекте
- (+) Согласованность с `Devtools.createState()`
- (+) Доступ к приватным `createKey()` через замыкание модуля

### Решение

**Выбран вариант B — `Devtools.createSignalHooks()` как метод объекта `Devtools`**.

Объект `Devtools` уже содержит `createState()` и `hasDevtools`. Добавление `createSignalHooks()` — естественное расширение. Оба метода используют общие внутренние функции (`createKey()`).

### Последствия

- `Devtools.createSignalHooks()` добавляется в объект `Devtools` в `src/signals/base/Devtools.ts`
- `createDevtoolsHooks()` не создаётся как standalone функция
- `State` импортирует `Devtools` и вызывает `Devtools.createSignalHooks()`
- `Devtools.createState()` — без изменений (query-модуль)
- `Devtools.hasDevtools` — без изменений
- Общие функции (`createKey()`) используются обоими методами

---

## ADR-6: Сохранение `Devtools.createState()` для QueriesLifetimeHooks

### Статус: Proposed

### Контекст

`QueriesLifetimeHooks` использует `Devtools.createState()` и `Devtools.hasDevtools` напрямую для отслеживания query-состояний. Query-модуль имеет собственный lifecycle (cache entry add → data changes → cache entry removed), который не совпадает с lifecycle сигналов (init → change → dispose).

### Рассмотренные варианты

**A) Рефакторить query на LC-хуки**:
- (+) Единообразие
- (−) Значительный scope — query lifecycle отличается от signal lifecycle
- (−) Риск регрессии в query-модуле

**B) Сохранить `Devtools.createState()` для query, `Devtools.createSignalHooks()` для сигналов**:
- (+) Минимальный scope изменений
- (+) Query-модуль не затронут
- (−) Два способа взаимодействия с devtools в одном объекте

### Решение

**Выбран вариант B — сохранить `Devtools.createState()` для query**.

Оба метода живут в объекте `Devtools`. `createState()` — для прямого управления devtools (query). `createSignalHooks()` — для создания LC-хука (сигналы). Рефакторинг query — отдельная задача.

### Последствия

- `Devtools` содержит оба метода: `createState()` и `createSignalHooks()`
- `Devtools.hasDevtools` — без изменений
- `QueriesLifetimeHooks` — 0 изменений
- При будущем рефакторинге query можно мигрировать отдельно

---

## ADR-7: FinalizationRegistry → `onDispose` через массив хуков

### Статус: Proposed

### Контекст

Текущая реализация `FinalizationRegistry` в `State.ts`:

```typescript
private static _finalizationRegistry = new FinalizationRegistry(
    (heldValue: DevtoolsStateLike) => {
        heldValue('$COMPLETED' as any);
    }
);
```

Проблемы:
- `heldValue` — `DevtoolsStateLike` — жёсткая привязка к devtools
- Magic string `$COMPLETED` и каст `as any` в коде State
- Регистрируется только при наличии devtools — пользовательский cleanup невозможен

### Рассмотренные варианты

**A) Оставить DevtoolsStateLike в FinalizationRegistry**:
- (−) Нет расширяемости для пользовательских cleanup
- (−) Magic strings в State

**B) Хранить массив `hooks[]` в FinalizationRegistry, итерировать `onDispose`**:
```typescript
private static _finalizationRegistry = new FinalizationRegistry(
    (hooks: SignalLifecycleHook<any>[]) => {
        for (const hook of hooks) {
            hook.onDispose?.();
        }
    }
);
// В конструкторе:
const hasDispose = hooks.some(h => h.onDispose);
if (hasDispose) {
    State._finalizationRegistry.register(this, hooks);
}
```
- (+) Единый FR — единый cleanup для всех хуков
- (+) `$COMPLETED` инкапсулирован в devtools-хуке (hooks[0].onDispose)
- (+) Пользовательский cleanup через hooks[1..N].onDispose
- (+) State.ts не содержит `$COMPLETED` и `as any`
- (−) Замыкание массива хуков в FR может продлить жизнь объектов

### Решение

**Выбран вариант B — хранить массив `hooks[]` в FinalizationRegistry**.

FR хранит ссылку на массив хуков. При GC итерирует массив и вызывает `onDispose()` для каждого элемента. Devtools `$COMPLETED` — внутри `hooks[0].onDispose()`, пользовательский cleanup — `hooks[1..N].onDispose()`.

### Последствия

- `FinalizationRegistry` хранит `SignalLifecycleHook<any>[]` вместо `DevtoolsStateLike`
- State.ts не содержит `$COMPLETED` и `as any`
- Регистрация: `if (hooks.some(h => h.onDispose))` вместо `if (this._stateDevtools)`
- Пользовательский `onDispose` работает через тот же FR
- Риск: замыкание массива хуков может продлить жизнь объектов. Митигация: массив содержит только лёгкие callback-объекты, не данные сигнала
