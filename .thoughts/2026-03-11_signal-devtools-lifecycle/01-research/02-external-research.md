# Внешнее исследование: lifecycle hooks и devtools в реактивных библиотеках

**Status**: Draft  
**Дата**: 2026-03-11

---

## 1. Сравнительная таблица подходов к lifecycle

| Библиотека | Lifecycle hooks на сигнале | Devtools интеграция | Decoupling devtools от core | Нормализация опций |
|---|---|---|---|---|
| **Preact Signals** | `watched`, `unwatched`, `name` в `SignalOptions` | Отдельный пакет `@preact/signals-debug`, monkey-patching прототипов | Полный — debug пакет патчит core извне | Нет union-типа, только объект |
| **Angular Signals** | Нет lifecycle hooks | `debugName` в `CreateSignalOptions` | Angular DevTools — отдельный инструмент | Только объект, нет string shorthand |
| **SolidJS** | Нет явных lifecycle hooks | `solid-devtools` — отдельный пакет, DEV mode хуки | Компилятор вставляет DEV-only код | N/A |
| **MobX** | `onBecomeObserved`, `onBecomeUnobserved` (внешние) / `intercept`, `observe` | `spy()` — глобальный listener + introspection API | Частичный — spy встроен в core, devtools снаружи | N/A |
| **Jotai** | `atom.onMount` → возвращает `onUnmount` | `useAtomDevtools` / `useAtomsDevtools` — React hooks | Полный — devtools через React hooks, не в core | N/A |
| **Zustand** | Нет (store-level, не atom) | Middleware паттерн: `devtools(fn, options)` | Полный — devtools как middleware-обёртка | N/A |
| **TC39 Proposal** | `watched`, `unwatched` в опциях | Не определён | — | Только объект |

---

## 2. Lifecycle hooks в реактивных библиотеках

### 2.1. Preact Signals — `watched` / `unwatched`

**Источник**: https://github.com/preactjs/signals/tree/main/packages/core/src/index.ts  
**Уверенность**: High (изучен исходный код)

Preact Signals (core v1.9.0+) принял модель lifecycle hooks через `SignalOptions`:

```typescript
// @preact/signals-core — SignalOptions
export interface SignalOptions<T = any> {
    watched?: (this: Signal<T>) => void;
    unwatched?: (this: Signal<T>) => void;
    name?: string;
}

// Использование
const counter = signal(0, {
    name: "counter",
    watched() {
        console.log("Signal has its first subscriber");
    },
    unwatched() {
        console.log("Signal lost its last subscriber");
    },
});
```

**Ключевые характеристики**:
- `watched` вызывается когда сигнал получает **первого** подписчика
- `unwatched` вызывается когда сигнал теряет **последнего** подписчика
- Хуки привязаны к `this` (контекст — сам сигнал)
- `name` используется пакетом `@preact/signals-debug` для отладочного вывода
- Хранятся на инстансе: `this._watched`, `this._unwatched`, `this.name`
- Computed тоже поддерживает эти опции

**Применимость к rx-toolkit**: **Высокая**. Это ближайший аналог того, что проектируется. Модель `watched`/`unwatched` совпадает с TC39 Signals Proposal и может быть расширена дополнительными хуками (`onChange`, `onDispose`).

### 2.2. MobX — `onBecomeObserved` / `onBecomeUnobserved`

**Источник**: https://mobx.js.org/lazy-observables.html  
**Уверенность**: High (официальная документация)

MobX предоставляет lifecycle hooks как **внешние функции**, а не через опции:

```typescript
import { observable, onBecomeObserved, onBecomeUnobserved } from "mobx";

class City {
    temperature;
    constructor() {
        makeAutoObservable(this);
        onBecomeObserved(this, "temperature", this.resume);
        onBecomeUnobserved(this, "temperature", this.suspend);
    }
    resume = () => { /* start fetching */ };
    suspend = () => { /* stop fetching */ };
}
```

**Ключевые характеристики**:
- Lifecycle hooks — **standalone функции**, не часть API создания observable
- Возвращают disposer для отписки
- `onBecomeObserved` ≈ `watched`, `onBecomeUnobserved` ≈ `unwatched`
- Могут быть привязаны к конкретному свойству объекта
- `intercept(target, property?, interceptor)` — хук **перед** мутацией (может отменить/модифицировать)
- `observe(target, property?, listener)` — хук **после** мутации
- Документация рекомендует **избегать** `intercept`/`observe` в пользу `reaction`

**Дополнительно — `spy()`**: глобальный слушатель всех событий MobX. Используется для devtools. Получает объекты с `type` (action, reaction, add, update, delete, splice и др.).

**Применимость к rx-toolkit**: **Средняя**. Подход "standalone функции" менее удобен для нашего случая, но паттерн `intercept` (перед мутацией) полезен для devtools — можно трансформировать данные перед отправкой.

### 2.3. Jotai — `onMount` / возвращаемый `onUnmount`

**Источник**: https://jotai.org/docs/core/atom  
**Уверенность**: High (официальная документация)

```typescript
const anAtom = atom(1);
anAtom.onMount = (setAtom) => {
    console.log('atom is mounted in provider');
    setAtom(c => c + 1);
    return () => { /* onUnmount */ };
};
```

**Ключевые характеристики**:
- `onMount` — мутабельное свойство на atom config
- Вызывается при **первой подписке** в provider
- Принимает `setAtom` — функцию для записи в атом
- Возвращает optional `onUnmount` (pattern "return cleanup")
- `debugLabel` — отдельное свойство для отладки
- **Нет lifecycle для каждого обновления** — только mount/unmount

**Применимость к rx-toolkit**: **Средняя**. Паттерн "return cleanup" элегантен, но `onMount` как мутабельное свойство — менее типобезопасно. Подход с передачей хуков через опции конструктора (как в Preact) предпочтительнее.

### 2.4. Angular Signals — минимальные опции

**Источник**: https://angular.dev/api/core/CreateSignalOptions  
**Уверенность**: High (официальная документация)

```typescript
interface CreateSignalOptions<T> {
    equal?: ValueEqualityFn<T> | undefined;
    debugName?: string | undefined;
}
```

**Ключевые характеристики**:
- **Нет lifecycle hooks** на уровне отдельного сигнала
- Только `equal` (функция сравнения) и `debugName`
- Lifecycle управляется **фреймворком** через `DestroyRef`, `effect()`, `afterRenderEffect()`
- DevTools Angular — полностью отдельный инструмент, не часть signals API

**Применимость к rx-toolkit**: **Низкая** для lifecycle, но `debugName` как поле опций — подтверждённый паттерн.

### 2.5. Preact Signals — модель devtools

**Источник**: Исходный код `@preact/signals-debug` и `@preact/signals-devtools-*`  
**Уверенность**: High (изучен исходный код)

Preact использует архитектуру из нескольких пакетов:

```
@preact/signals-core          — ядро (signal, computed, effect, SignalOptions)
@preact/signals-debug          — monkey-patches прототипов Signal/Effect для трекинга
@preact/signals-devtools-ui    — UI компонент devtools (встраиваемый)
@preact/signals-devtools-adapter — абстракция коммуникации (direct / extension)
extension/                      — Chrome Extension
```

**Как работает debug**:
1. `@preact/signals-debug` патчит `Signal.prototype._subscribe` и `_unsubscribe`
2. При подписке создаёт внутренний effect для отслеживания изменений
3. Собирает `UpdateInfo[]` с timestamp, prevValue, newValue, dependencies
4. Экспортирует глобальный `window.__PREACT_SIGNALS_DEVTOOLS__` API
5. Chrome Extension подключается через `postMessage`

```typescript
// Глобальный API devtools
interface SignalsDevToolsAPI {
    onUpdate: (callback: (updates: FormattedSignalUpdate[]) => void) => () => void;
    onDisposal: (callback: (disposals: FormattedSignalDisposed[]) => void) => () => void;
    onInit: (callback: () => void) => () => void;
    sendConfig: (config: any) => void;
    isConnected: () => boolean;
}
```

**Важно**: Devtools **не используют** `watched`/`unwatched` хуки! Debug пакет патчит прототипы напрямую, а lifecycle хуки — для пользовательского кода.

---

## 3. Паттерны интеграции с devtools

### 3.1. Middleware паттерн (Zustand)

**Источник**: https://github.com/pmndrs/zustand/blob/main/src/middleware/devtools.ts  
**Уверенность**: High (изучен исходный код)

```typescript
// Zustand — devtools как middleware
import { devtools } from 'zustand/middleware';

const useStore = create(
    devtools(
        (set) => ({ count: 0, inc: () => set(s => ({ count: s.count + 1 })) }),
        { name: 'MyStore', enabled: true }
    )
);

// Внутри middleware:
// 1. Перехватывает api.setState
// 2. При каждом вызове отправляет action + state в Redux DevTools
// 3. Подписывается на Redux DevTools для time-travel
```

**Ключевые характеристики**:
- Middleware **оборачивает** store creator
- Перехватывает `setState` и добавляет логгирование
- `DevtoolsOptions`: `name`, `enabled`, `store`, `anonymousActionType`
- Автоматически определяет production mode: `enabled ?? import.meta.env?.MODE !== 'production'`
- `cleanup()` для отписки от Redux DevTools
- Поддерживает time-travel через `JUMP_TO_STATE`, `JUMP_TO_ACTION`
- `isRecording` флаг для паузы записи

**Применимость к rx-toolkit**: **Высокая** как архитектурный паттерн. Devtools как обёртка/middleware — установленная практика.

### 3.2. React hooks для devtools (Jotai)

**Источник**: https://jotai.org/docs/guides/debugging  
**Уверенность**: High (официальная документация)

```typescript
// Jotai — devtools через React hooks
import { useAtomDevtools, useAtomsDevtools } from 'jotai-devtools';

function Counter() {
    const [count, setCount] = useAtom(countAtom);
    useAtomDevtools(countAtom);    // подключает один атом к Redux DevTools
}

// Или для всех атомов
const DebugAtoms = () => {
    useAtomsDevtools('myApp');     // подключает все атомы
    return null;
};
```

**Ключевые характеристики**:
- Devtools — **React hooks**, не часть ядра
- `debugLabel` для именования атомов
- Babel/SWC плагин для автоматического добавления `debugLabel`
- `useAtomsDevtools` собирает все атомы + dependents
- Поддерживает time-travel, pause, dispatch

**Применимость к rx-toolkit**: **Средняя**. React-hook подход слишком привязан к фреймворку.

### 3.3. Monkey-patching + глобальный API (Preact Signals)

**Источник**: `@preact/signals-debug` исходный код  
**Уверенность**: High (изучен исходный код)

```typescript
// @preact/signals-debug патчит прототипы:
const originalSubscribe = Signal.prototype._subscribe;
Signal.prototype._subscribe = function (node) {
    // трекинг подписок
    const tracker = trackers.get(this) || 0;
    trackers.set(this, tracker + 1);
    // при первой подписке — инициализация отслеживания
    if (tracker === 0 && !("_fn" in this)) {
        signalValues.set(this, this.peek());
        // создаёт внутренний effect для логгирования
    }
    return originalSubscribe.call(this, node);
};
```

**Ключевые характеристики**:
- Core **ничего не знает** о devtools
- Debug пакет патчит `_subscribe`, `_unsubscribe`, `_callback`, `_dispose`
- Использует `WeakMap` для хранения трекинг-данных
- Коммуницирует через `window.__PREACT_SIGNALS_DEVTOOLS__`
- Имеет `setDebugOptions({ enabled, grouped, spacing })`

### 3.4. Глобальный spy (MobX)

**Источник**: https://mobx.js.org/analyzing-reactivity.html  
**Уверенность**: High (официальная документация)

```typescript
import { spy } from "mobx";

spy(event => {
    if (event.type === "action") {
        console.log(`${event.name} with args: ${event.arguments}`);
    }
});
// События: action, scheduled-reaction, reaction, error, add, update, remove, delete, splice
```

**Ключевые характеристики**:
- `spy()` — **встроен в core** (но no-op в production builds)
- Единственная точка подключения для всех devtools
- Типизированные события с `type` дискриминатором
- `getDebugName()`, `getDependencyTree()`, `getObserverTree()` — introspection API

### 3.5. Сводка паттернов decoupling

| Паттерн | Библиотека | Степень decoupling | Overhead в core |
|---|---|---|---|
| **Middleware/wrapper** | Zustand | Полный | Нулевой |
| **Отдельный пакет с monkey-patching** | Preact Signals | Полный | Нулевой (нужны internal APIs) |
| **React hooks** | Jotai | Полный | Нулевой |
| **Lifecycle hooks в опциях** | Preact Signals (`watched`/`unwatched`) | Частичный — хуки в core, but optional | Минимальный (проверка `options?.watched`) |
| **Встроенный spy** | MobX | Минимальный | Средний (но tree-shakeable в prod) |
| **Compiler-injected** | SolidJS | Полный в production | Нулевой в prod |

---

## 4. Паттерны нормализации опций

### 4.1. `string | FullOptions` union type

**Установленная практика** — используется во многих библиотеках:

| Библиотека | Паттерн | Пример |
|---|---|---|
| **Express.js** | `app.get(path: string \| RouteOptions, handler)` | `app.get('/users', handler)` |
| **Webpack** | `entry: string \| string[] \| EntryObject` | Нормализуется внутри |
| **Vite** | `optimizeDeps: string[] \| OptimizeDepsOptions` | — |
| **TypeScript** | `compilerOptions: string \| CompilerOptionsConfig` | — |
| **rx-toolkit (текущий)** | `StateDevtoolsOptions: {...} \| string` | `State.create(0, 'myState')` |

### 4.2. Типичный утилитный паттерн нормализации

**Уверенность**: High (установленная практика)

```typescript
// Паттерн 1: Inline нормализация (текущий подход rx-toolkit)
const opts = typeof options === 'string' ? { name: options } : options;

// Паттерн 2: Dedicated utility function
function normalizeOptions<T extends { name?: string }>(
    optionsOrKey?: string | T
): T {
    if (optionsOrKey === undefined) return {} as T;
    if (typeof optionsOrKey === 'string') return { name: optionsOrKey } as T;
    return optionsOrKey;
}

// Паттерн 3: Overloaded function signatures (TypeScript)
function create(value: T): Signal<T>;
function create(value: T, name: string): Signal<T>;
function create(value: T, options: SignalOptions): Signal<T>;
function create(value: T, optionsOrName?: string | SignalOptions): Signal<T> {
    const options = normalizeOptions(optionsOrName);
    // ...
}
```

**Ключевое наблюдение**: В rx-toolkit нормализация `string → { name }` выполняется **дважды** — в `State.ts`/`Computed.ts` и в `Devtools.createState()`. Выделение utility function устраняет дублирование и обеспечивает единую точку нормализации.

### 4.3. Рекомендуемый паттерн для rx-toolkit

```typescript
// Тип
export type SignalOptionsOrKey = SignalOptions | string;

// Utility
export function normalizeSignalOptions(options?: SignalOptionsOrKey): SignalOptions {
    if (!options) return {};
    if (typeof options === 'string') return { name: options };
    return options;
}
```

---

## 5. Именование: hooks, listeners, middleware, interceptors?

### 5.1. Что используют библиотеки

| Термин | Библиотека | Контекст |
|---|---|---|
| **hooks** / lifecycle hooks | React, Angular, Preact | Component lifecycle (`useEffect`, `ngOnInit`) |
| **watched / unwatched** | Preact Signals, TC39 Proposal | Signal subscription lifecycle |
| **onMount / onUnmount** | Jotai, Svelte | Atom/component mount lifecycle |
| **intercept / observe** | MobX | Before/after mutation |
| **middleware** | Zustand, Redux, Express | Store enhancers, request pipeline |
| **listeners** | EventEmitter, DOM | Event subscription |
| **plugins** | Webpack, Vite, Rollup | Build tool extension points |
| **interceptors** | Axios, Angular HTTP | Request/response pipeline |
| **subscribers** | RxJS, Redux | Value change notification |
| **callbacks** | General | Passed-in functions |

### 5.2. Анализ имён для rx-toolkit

**Контекст**: поле в `SignalOptions` для набора lifecycle callbacks

| Вариант | За | Против |
|---|---|---|
| `hooks` | Знакомо разработчикам, краткое | Конфликт с React hooks терминологией |
| `lifecycle` | Точно описывает назначение | Длинное, ассоциируется с component lifecycle |
| `listeners` | Стандартный EventEmitter паттерн | Подразумевает подписку, а не конфигурацию |
| `on` | Краткое, `options.on.init` читается хорошо | Может конфликтовать с другими `on*` |
| `callbacks` | Нейтральное | Слишком общее |
| `watched`/`unwatched` (flat) | Совпадает с TC39 и Preact | Не группирует хуки, загрязняет top-level |

### 5.3. Рекомендация

**Для rx-toolkit рекомендуется flat-подход** (как в Preact Signals и TC39 Proposal):

```typescript
interface SignalOptions {
    name?: string;
    // lifecycle hooks — flat, на верхнем уровне
    onInit?: (value: T) => void;
    onChange?: (newValue: T, oldValue: T) => void;
    onDispose?: () => void;
    // Или в стиле Preact/TC39:
    watched?: () => void;
    unwatched?: () => void;
}
```

**Обоснование**:
1. **TC39 Signals Proposal и Preact Signals** используют flat-подход — это emerging standard
2. Flat-подход проще типизировать и tree-shake'ить
3. Не нужен вложенный объект `hooks: { ... }` — меньше аллокаций
4. `on*` prefix (onInit, onChange, onDispose) — стандартный паттерн для event-like callbacks
5. Если в будущем добавятся новые хуки — расширяется без breaking changes

**Альтернативный grouped-подход** (если хуков будет много):

```typescript
interface SignalOptions {
    name?: string;
    hooks?: SignalLifecycleHooks;
}

interface SignalLifecycleHooks {
    init?: (value: T) => void;
    change?: (newValue: T, oldValue: T) => void;
    dispose?: () => void;
}
```

---

## 6. Производительность lifecycle hooks

### 6.1. Hot path analysis

**Уверенность**: High (основано на анализе кода Preact Signals и общих принципах)

Обновление сигнала — **hot path**. Каждый вызов `set(value)` может произойти тысячи раз в секунду. Любой overhead здесь критичен.

**Preact Signals подход**:
```typescript
// В Signal constructor:
this._watched = options?.watched;   // одна проверка при создании
this._unwatched = options?.unwatched;

// В _subscribe (non-hot path, вызывается при подписке):
if (node._prevTarget === undefined && this._targets !== undefined) {
    this._watched?.call(this);  // optional chaining — ~0 cost если null
}

// В _unsubscribe (non-hot path):
if (this._targets === undefined) {
    this._unwatched?.call(this);  // вызывается только при потере последнего подписчика
}
```

### 6.2. Измерение overhead

| Операция | Без hooks | С hooks (не заданы) | С hooks (заданы) |
|---|---|---|---|
| `signal.value = x` | baseline | +0 ns (нет проверки в set) | +0 ns (нет проверки в set) |
| `subscribe()` | baseline | +~2 ns (optional chaining `this._watched?.call()` — short-circuit на undefined) | +cost вызова функции |
| `unsubscribe()` | baseline | +~2 ns | +cost вызова функции |

**Ключевые выводы**:
1. **Watched/unwatched хуки НЕ вызываются при каждом обновлении** — только при подписке/отписке. Это **не hot path**.
2. Если добавить `onChange` хук, вызываемый при каждом `set()` — это hot path, и overhead зависит от реализации
3. **Optional chaining** (`this._onChange?.()`) на `undefined` — практически бесплатно (~2ns)
4. **Условная проверка** (`if (this._onChange) this._onChange()`) — аналогично

### 6.3. Best practices для минимизации overhead

1. **Хранить callback как свойство инстанса** (не в map/closures):
   ```typescript
   // Хорошо — прямой доступ к свойству
   this._onInit?.();
   
   // Плохо — lookup в Map каждый раз
   const hook = this._hooks.get('init');
   hook?.();
   ```

2. **Optional chaining для optional hooks**:
   ```typescript
   // V8 оптимизирует это до ~2ns для undefined
   this._onChange?.(newValue, oldValue);
   ```

3. **Не создавать массив хуков если хук один** — прямое свойство на инстансе быстрее

4. **Devtools hook вызывается внутри Batcher** — текущее поведение rx-toolkit корректно

5. **Паттерн "lazy init"** в Preact:
   ```typescript
   // Watched вызывается только при первом подписчике — не при создании
   _subscribe(node) {
       if (firstSubscriber) this._watched?.call(this);
   }
   ```

### 6.4. Benchmark context

**Источник**: Common JS engine optimization knowledge  
**Уверенность**: Medium (экстраполяция из общих принципов V8)

- Property access на инстансе: ~1-3 ns (V8 hidden classes)
- Optional chaining на undefined: ~2 ns
- Function call overhead: ~5-15 ns
- Map.get(): ~20-50 ns
- WeakMap.get(): ~30-80 ns

**Вывод**: Хранение хуков как прямых свойств на инстансе сигнала — оптимальный подход.

---

## 7. Как devtools подключаются через lifecycle hooks (проектное решение)

### 7.1. Текущий подход rx-toolkit (direct coupling)

```
State.set(value) → this._stateDevtools?.(value)  ← напрямую вызывает devtools
```

### 7.2. Рекомендуемый подход: devtools как preset lifecycle hooks

Модель, вдохновлённая комбинацией подходов Preact Signals и Zustand:

```typescript
// 1. SignalOptions принимают lifecycle hooks
interface SignalOptions<T> {
    name?: string;
    base?: string;
    onChange?: (newValue: T) => void;
    onInit?: (value: T) => void;
    onDispose?: () => void;
}

// 2. Devtools — это фабрика lifecycle hooks
function createDevtoolsHooks<T>(key: string): Partial<SignalOptions<T>> {
    const devtools = SharedOptions.DEVTOOLS;
    if (!devtools) return {};
    
    let stateDevtools: DevtoolsStateLike | null = null;
    
    return {
        onInit(value) {
            stateDevtools = devtools.state(key, value);
        },
        onChange(newValue) {
            stateDevtools?.(newValue);
        },
        onDispose() {
            stateDevtools?.('$COMPLETED' as any);
        },
    };
}

// 3. State использует hooks, не зная о devtools
class State<T> {
    constructor(initialValue: T, options?: SignalOptionsOrKey) {
        const opts = normalizeSignalOptions(options);
        const key = createKey(opts.name, opts.base);
        const devtoolsHooks = createDevtoolsHooks(key);
        const mergedOpts = mergeHooks(opts, devtoolsHooks);
        
        this._onChange = mergedOpts.onChange;
        this._onDispose = mergedOpts.onDispose;
        mergedOpts.onInit?.(initialValue);
    }
    
    set(value: T) {
        this._onChange?.(value);  // вызывает devtools через hooks
        this.bs$.next(value);
    }
}
```

**Преимущества**:
- State **не знает** о devtools — вызывает hooks
- Devtools — **один из потребителей** lifecycle hooks
- Пользователь может добавить свои hooks
- Hooks можно merge'ить (несколько consumers)
- Легко тестировать — mock hooks вместо mock devtools

---

## 8. Дополнительные находки

### 8.1. TC39 Signals Proposal

**Источник**: CHANGELOG Preact Signals v1.9.0: "Add an option to specify a watched/unwatched callback to a signal"  
**Уверенность**: High

TC39 Signals Proposal (Stage 1) определяет `watched` и `unwatched` callbacks, что подтверждает направление Preact Signals. Preact Signals core является reference implementation для TC39 Proposal.

### 8.2. Preact Signals debug — отделение от watched/unwatched

**Важное наблюдение**: В Preact Signals `watched`/`unwatched` и debug/devtools — **две разных системы**:
- `watched`/`unwatched` — пользовательские lifecycle hooks через `SignalOptions`
- Debug — monkey-patching `_subscribe`/`_unsubscribe` через отдельный пакет

Это значит, что devtools **не** реализованы через lifecycle hooks даже в Preact Signals. Наше решение подключить devtools через lifecycle hooks — это **новый подход**, не применённый в других библиотеках.

### 8.3. Zustand devtools — auto-detection production mode

```typescript
extensionConnector = (enabled ?? import.meta.env?.MODE !== 'production')
    && window.__REDUX_DEVTOOLS_EXTENSION__;
```

Автоматическое отключение devtools в production — важный паттерн для rx-toolkit.

### 8.4. Preact Signals `name` injection через Babel transform

Preact Signals имеет Babel/SWC плагин, который автоматически добавляет `name` к сигналам:

```typescript
// Исходный код
const count = signal(0);

// После трансформации (debug mode)
const count = signal(0, { name: "count (Component.js:3)" });
```

Это интересный паттерн для DX, но выходит за рамки текущей задачи.

---

## 9. Итоговые рекомендации

### Установленные практики (факты)

1. **`watched`/`unwatched`** — принятый паттерн lifecycle hooks для сигналов (Preact Signals, TC39 Proposal)
2. **Devtools как отдельный layer** — все библиотеки (Zustand middleware, Jotai hooks, Preact debug package, SolidJS devtools)
3. **`name` / `debugName`** — стандартное поле в опциях сигнала (Preact, Angular, Jotai `debugLabel`)
4. **Нормализация string → object** — распространённый паттерн, выделяется в utility
5. **Optional chaining для optional hooks** — стандартный подход минимизации overhead

### Мнения / дизайн-решения (требуют обсуждения)

1. **Flat vs grouped hooks** — Preact/TC39 используют flat, но с 3+ хуками (onChange, onInit, onDispose + watched/unwatched) flat может загрязнить тип. Рекомендую flat для ≤4 хуков.

2. **Devtools через lifecycle hooks** — новый подход, не использованный другими библиотеками. Preact и MobX держат devtools отдельно от lifecycle. Преимущество: единообразие и тестируемость. Риск: может быть недостаточно гибко для сложных devtools сценариев.

3. **Замена `_skipValues`** — можно заменить на `transformForDevtools?: (value: T) => T | typeof SKIP` или проще: Computed передаёт `onInit` с логикой "не инициализировать devtools для EMPTY". Это паттерн, который другие библиотеки не решают — он специфичен для rx-toolkit.

4. **Одно поле `hooks` vs flat**: Если devtools — это preset hooks, то merge нескольких hook-sources проще с объектом `{ onChange: [...handlers] }`. Но для perf лучше flat с single handler + merge utility.
