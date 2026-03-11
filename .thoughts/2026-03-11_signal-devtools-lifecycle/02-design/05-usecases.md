# Use Cases: Signal Devtools Lifecycle Hooks (v2 — Redraft)

**Status**: Redraft  
**Дата**: 2026-03-11

---

## UC1: State с devtools по умолчанию (devtools-хук автоматически в hooks[0])

### Описание

Пользователь создаёт state-сигнал с ключом. Devtools настроены глобально. Devtools-хук автоматически добавляется как `hooks[0]` — пользователю не нужно ничего делать.

### Код

```typescript
import { DefaultOptions, reduxDevtools } from 'rx-toolkit';
import { State } from 'rx-toolkit/signals';

// Глобальная настройка (один раз при старте)
DefaultOptions.update({ DEVTOOLS: reduxDevtools() });

// Создание сигнала — devtools подхватываются автоматически
const counter = State.create(0, { key: 'counter' });

counter.set(1);
counter.set(2);
```

### Ожидаемое поведение

1. `normalizeSignalOptions({ key: 'counter' })` → `{ key: 'counter' }`
2. `Devtools.createHooks(0, { key: 'counter', base: 'State' })` → devtools-хук
3. Формирование `hooks[]`:
   - `hooks[0]` = devtools-хук (onInit, onChange, onDispose)
   - Нет пользовательских хуков → массив из 1 элемента
4. `hooks[0].onInit(0)` → devtools регистрирует состояние с ключом `counter#i=N`
5. `counter.set(1)` → `hooks[0].onChange(1)` → devtools обновляется
6. `counter.set(2)` → `hooks[0].onChange(2)` → devtools обновляется
7. При GC → `hooks[0].onDispose()` → devtools получает `$COMPLETED`

### Что видит Redux DevTools

```
counter#i=0 → 0 → 1 → 2 → [cleared]
```

---

## UC2: State с кастомным beforeDevtoolsPush (маскирование данных)

### Описание

Пользователь хочет маскировать чувствительные данные перед отправкой в devtools. Использует `beforeDevtoolsPush` — callback, который применяется **внутри** `Devtools.createHooks()` при формировании devtools-хука.

### Код

```typescript
interface UserData {
    name: string;
    token: string;
}

const user = State.create<UserData>(
    { name: 'Alice', token: 'secret-abc-123' },
    {
        key: 'currentUser',
        beforeDevtoolsPush: (value, push) => {
            push({ ...value, token: '***' });
        },
    }
);

user.set({ name: 'Bob', token: 'secret-xyz-789' });
```

### Ожидаемое поведение

1. `normalizeSignalOptions(opts)` → `{ key: 'currentUser', beforeDevtoolsPush: fn }`
2. `Devtools.createHooks()` обнаруживает `beforeDevtoolsPush` → создаёт push-based devtools-хук:
   - `onInit(value)` → `beforeDevtoolsPush(value, push)` → `push({ name: 'Alice', token: '***' })`
   - `onChange(value)` → `beforeDevtoolsPush(value, push)` → `push({ name: 'Bob', token: '***' })`
3. Формирование `hooks[]`:
   - `hooks[0]` = devtools-хук с push-based стратегией
   - Нет пользовательских хуков → массив из 1 элемента

### Что видит Redux DevTools

```
currentUser#i=0 → { name: 'Alice', token: '***' } → { name: 'Bob', token: '***' }
```

Реальные токены **никогда** не попадают в devtools.

---

## UC3: Computed с beforeDevtoolsPush (замена _skipValues для _EMPTY)

### Описание

Computed внутренне создаёт State с начальным значением `_EMPTY` (символ). Это значение не должно попадать в devtools. Вместо `_skipValues: [_EMPTY]` Computed передаёт `beforeDevtoolsPush` — в том же слое логики, где раньше применялся `_skipValues`.

### Код

```typescript
import { Computed, State } from 'rx-toolkit/signals';

const counter = State.create(0, 'counter');
const doubled = Computed.create(() => counter() * 2, 'doubled');
```

### Внутренняя реализация (Computed.constructor)

```typescript
const normalizedOpts = normalizeSignalOptions(options);
const stateOptions: SignalOptions<symbol | T> = {
    ...normalizedOpts,
    base: 'Computed',
    beforeDevtoolsPush: (value, push) => {
        if (value !== Computed._EMPTY) {
            push(value as T);
        }
    },
};
this._state$ = State.create<symbol | T>(Computed._EMPTY, stateOptions);
```

### Ожидаемое поведение

1. Computed создаёт внутренний State с `_EMPTY`
2. `Devtools.createHooks()` видит `beforeDevtoolsPush` → создаёт push-based devtools-хук
3. `hooks[0].onInit(_EMPTY)` → `beforeDevtoolsPush(_EMPTY, push)` → `_EMPTY === _EMPTY` → **не пушим** → devtools не создан (lazy)
4. Первое вычисление: `state.set(0)` → `hooks[0].onChange(0)` → `beforeDevtoolsPush(0, push)` → `0 !== _EMPTY` → **push(0)** → devtools lazy init
5. `counter.set(5)` → computed = 10 → `state.set(10)` → `beforeDevtoolsPush(10, push)` → **push(10)**

### Что видит Redux DevTools

```
doubled#i=1 → 0 → 10
```

Символ `_EMPTY` **никогда** не попадает в devtools — фильтрация типобезопасна.

---

## UC4: State с пользовательскими хуками + devtools (оба в массиве)

### Описание

Пользователь подключает свои LC-хуки для логирования и метрик. Devtools-хук автоматически занимает `hooks[0]`, пользовательские хуки — `hooks[1..N]`. Все хуки итерируются в порядке массива.

### Код

```typescript
const counter = State.create(0, {
    key: 'counter',
    hooks: [
        {
            onInit: (value) => {
                console.log(`[counter] initialized with ${value}`);
            },
            onChange: (newValue) => {
                console.log(`[counter] changed to ${newValue}`);
            },
            onDispose: () => {
                console.log(`[counter] disposed`);
            },
        },
        {
            onChange: (newValue) => {
                analytics.track('counter_changed', { value: newValue });
            },
        },
    ],
});

counter.set(42);
```

### Ожидаемое поведение

1. `Devtools.createSignalHooks()` → devtools-хук
2. Формирование `hooks[]`:
   - `hooks[0]` = devtools-хук
   - `hooks[1]` = пользовательский набор (console.log)
   - `hooks[2]` = пользовательский набор (analytics)
3. В конструкторе — итерация `onInit`:
   - `hooks[0].onInit(0)` → devtools: регистрирует `counter#i=N` с `0`
   - `hooks[1].onInit(0)` → `console.log('[counter] initialized with 0')`
   - `hooks[2]` → нет `onInit` — пропуск
4. `counter.set(42)` — итерация `onChange`:
   - `hooks[0].onChange(42)` → devtools обновлён
   - `hooks[1].onChange(42)` → `console.log('[counter] changed to 42')`
   - `hooks[2].onChange(42)` → `analytics.track(...)`
5. GC — итерация `onDispose`:
   - `hooks[0].onDispose()` → devtools: `$COMPLETED`
   - `hooks[1].onDispose()` → `console.log('[counter] disposed')`
   - `hooks[2]` → нет `onDispose` — пропуск

### Порядок вызова

Всегда: **порядок массива** — `hooks[0]` (devtools) → `hooks[1]` → `hooks[2]` → ... Devtools логгирует состояние до выполнения пользовательских side effects.

---

## UC5: Сигнал без devtools (isDisabled)

### Описание

Пользователь отключает devtools для высокочастотного сигнала. Пользовательские хуки при этом работают.

### Код

```typescript
const mousePosition = State.create({ x: 0, y: 0 }, {
    key: 'mousePos',
    isDisabled: true,
    hooks: [{
        onChange: (pos) => {
            heatmap.track(pos);
        },
    }],
});

document.addEventListener('mousemove', (e) => {
    mousePosition.set({ x: e.clientX, y: e.clientY });
});
```

### Ожидаемое поведение

1. `normalizeSignalOptions(opts)` → `{ key: 'mousePos', isDisabled: true, hooks: [...] }`
2. `Devtools.createHooks(...)` → `isDisabled === true` → **return null** → devtools-хук не добавлен
3. Формирование `hooks[]`:
   - `hooks[0]` = пользовательский набор (heatmap) — devtools-хук отсутствует
4. Devtools **не** регистрируют сигнал — нет overhead
5. `onChange` пользователя вызывается при каждом `set()`
6. `FinalizationRegistry` **не** регистрируется (нет `onDispose` ни в одном хуке)

### Что видит Redux DevTools

Ничего — сигнал невидим для devtools.

---

## UC6: String shorthand — `Signal.state(0, 'counter')` → key

### Описание

Строковый shorthand интерпретируется как `{ key: string }` (ранее как `{ name: string }`).

### Код

```typescript
// Эквивалентные вызовы:
const a = State.create(0, 'counter');
const b = State.create(0, { key: 'counter' });

// Через deprecated Signal API:
const c = Signal.state(0, 'counter');

// Computed:
const d = Computed.create(() => a() * 2, 'doubled');
```

### Ожидаемое поведение

1. `normalizeSignalOptions('counter')` → `{ key: 'counter' }`
2. Далее — стандартный путь: `Devtools.createSignalHooks()` → формирование `hooks[]`
3. Devtools регистрируют с ключом `counter#i=N`

### Нормализация

| Вход | Результат `normalizeSignalOptions()` |
|------|--------------------------------------|
| `undefined` | `{}` |
| `'counter'` | `{ key: 'counter' }` |
| `{ key: 'counter' }` | `{ key: 'counter' }` (pass-through) |
| `{ name: 'counter' }` | `{ name: 'counter', key: 'counter' }` (миграция) |
| `{ key: 'x', hooks: [{ onChange: fn }] }` | pass-through |

---

## UC7: LocalState с devtools

### Описание

`LocalState` использует два внутренних сигнала. Devtools подключаются только к Computed-обёртке, внутренний State — с `isDisabled: true`.

### Код

```typescript
import { LocalState } from 'rx-toolkit/signals';

const theme = new LocalState({
    key: 'app-theme',
    defaultValue: 'light',
    devtoolsOptions: { key: 'theme' },
});
```

### Внутренняя реализация (LocalState.constructor)

```typescript
// Внутренний State — без devtools:
this._state$ = new State<T>(initialValue, { isDisabled: true });

// Computed-обёртка — с devtools через devtoolsOptions:
this._computed = new Computed<T>(() => {
    const value = this._state$.get();
    // ... валидация ...
    return value;
}, options.devtoolsOptions);
```

### Ожидаемое поведение

1. Внутренний State:
   - `isDisabled: true` → `Devtools.createSignalHooks()` → `null`
   - Нет devtools-хука, нет пользовательских → `_hooks = null`
2. Computed-обёртка:
   - `devtoolsOptions: { key: 'theme' }` передаётся в Computed
   - Computed добавляет `beforeDevtoolsPush` (фильтрация `_EMPTY`) и `base: 'Computed'`
   - Devtools-хук создаётся как `hooks[0]`
3. В devtools виден `theme#i=N` с актуальным значением Computed

---

## UC8: Миграция существующего кода (name → key)

### Описание

Существующий код использует `name`. После обновления `name` становится `@deprecated`, но продолжает работать через `normalizeSignalOptions()`.

### Код до миграции

```typescript
// Старый код — продолжает работать
const counter = State.create(0, { name: 'counter' });
const doubled = Computed.create(() => counter() * 2, 'doubled');
```

### Код после миграции

```typescript
// Новый код — использует key
const counter = State.create(0, { key: 'counter' });
const doubled = Computed.create(() => counter() * 2, 'doubled');
```

### Ожидаемое поведение (обратная совместимость)

1. `{ name: 'counter' }` → `normalizeSignalOptions()` → `{ name: 'counter', key: 'counter' }`
2. `Devtools.createSignalHooks()` использует `options.key` для `createKey()`
3. Devtools-ключ: `counter#i=N` — **идентичен** результату с `{ key: 'counter' }`
4. IDE показывает `@deprecated` предупреждение при использовании `name`

### Миграция `_skipValues` → `beforeDevtoolsPush`

| Старый код (Computed внутри) | Новый код (Computed внутри) |
|------------------------------|----------------------------|
| `_skipValues: [Computed._EMPTY]` | `beforeDevtoolsPush: (val, push) => val !== _EMPTY && push(val)` |

### Миграция `devtoolsOnChange` → `beforeDevtoolsPush`

Если в каком-либо промежуточном коде использовался `devtoolsOnChange`, его нужно заменить на `beforeDevtoolsPush`. Сигнатура идентична: `(newValue: T, push: (v: T) => void) => void`.
