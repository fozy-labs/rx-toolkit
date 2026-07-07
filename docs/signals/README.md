# RxSignals

RxSignals — это реактивная система управления состоянием, вдохновленная современными фреймворками типа SolidJS и Angular Signals. Она предоставляет эффективные инструменты для создания реактивных приложений.

## Основные концепции

### Реактивность на основе значений

Сигналы (`State`) хранят текущее состояние, а производные сущности (`Computed`, `Effect`) автоматически отслеживают зависимости,
применяя кеширование на основе *значений*. Это приводит к тому, что в отличие от классического RxJS-подхода,  
где каждое `next()` — это событие, в RxSignals важен именно факт *изменения значения*.

### State

База для создания реактивных сигналов с изменяемым состоянием.

**Пример использования:**

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

const name = Signal.state('John');
const age = Signal.state(25);

// Чтение значения (с отслеживанием зависимостей)
console.log(name()); // "John"

// Чтение значения без отслеживания
console.log(name.peek()); // "John"

// Запись нового значения
name.set('Jane');

// Обновление значения
age.update((value) => value + 1);

// Подписка на изменения через RxJS Observable
const subscription = name.obs.subscribe(newName => {
  console.log(`Name changed to: ${newName}`);
});

// Отписка
subscription.unsubscribe();
```

**API Signal:**
- `()`|`get()` — получить значение и зарегистрировать зависимость (для использования внутри Computed/Effect)
- `peek()` — получить значение без регистрации зависимости
- `set(value, actionName?)` — установить новое значение (опционально с именем действия для devtools)
- `update(updater, actionName?)` — вычислить и установить новое значение из текущего (опционально с именем действия для devtools)
- `obs` — RxJS Observable для подписки на изменения

### Computed

Создает вычисляемое значение, которое автоматически обновляется при изменении зависимостей.

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

const firstName = Signal.state('John');
const lastName = Signal.state('Doe');

const fullName = Signal.compute(() => `${firstName()} ${lastName()}`);

console.log(fullName()); // "John Doe"

firstName.set('Jane');
console.log(fullName()); // "Jane Doe"

// Подписка на изменения
fullName.obs.subscribe(name => console.log(name));
```

**API Computed:**
- `()`|`get()` — получить вычисленное значение с регистрацией зависимости
- `peek()` — получить значение без регистрации зависимости
- `obs` — RxJS Observable для подписки на изменения
- `dispose()` — остановить вычисление и освободить ресурсы (см. раздел «Жизненный цикл сигналов»)

Computed **ленивый**: значение вычисляется только при наличии подписчиков — через `()`/`get()` внутри `Computed`/`Effect` или подписку на `obs`. Без активных подписчиков пересчёт не выполняется.

### Effect

Создает побочный эффект, который автоматически выполняется при изменении используемых сигналов.

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

const count = Signal.state(0);
const message = Signal.state('Hello');

const effect = Signal.effect(() => {
  // Выведет: "Hello: 0" при инициализации
  console.log(`${message()}: ${count()}`);
});

count.set(1); // Выведет: "Hello: 1"
message.set('Hi'); // Выведет: "Hi: 1"

// Остановка эффекта
effect.unsubscribe();
```

**Cleanup функция (teardown):**

Effect поддерживает возврат функции очистки, которая вызывается перед следующим выполнением или при отписке:

```typescript
const effect = Signal.effect(() => {
  count(); // Создаем подписку на count (тк не работает при асинхронных операциях)
  const timer = setInterval(() => count(), 1000);
  
  // Cleanup - вызывается перед повторным выполнением эффекта
  return () => {
    clearInterval(timer);
  };
});
```

## Типы сигналов

Возвращаемые значения фабрик образуют иерархию по возможностям:

| Тип | Возможности | Откуда |
|---|---|---|
| `ReadonlySignal<T>` | `()`, `get()`, `peek()`, `obs` | `signalize(...)`, `SourceSignal.create(...)` |
| `DisposableSignal<T>` | `ReadonlySignal<T>` + `dispose()` / `[Symbol.dispose]` | `Signal.compute(...)` |
| `StateSignal<T>` | `DisposableSignal<T>` + `set()`, `update()` | `Signal.state(...)` |

`DisposableSignal<T>` расширяет `ReadonlySignal<T>`, а `StateSignal<T>` — `DisposableSignal<T>`.

## Жизненный цикл сигналов

`State` и `Computed` (а также результаты `Signal.state` / `Signal.compute`) можно завершить методом `dispose()` — он отписывает внутренние подписки и освобождает ресурсы. Для `Computed` это останавливает вычисление и очищает кеш.

```ts
const count = Signal.state(0);
// ...
count.dispose(); // сигнал больше не нужен — ручное освобождение ресурсов
```

Сигналы реализуют `[Symbol.dispose]`, поэтому совместимы с `using` (TC39 Explicit Resource Management):

```ts
function calc() {
    using doubled = Signal.compute(() => count() * 2);
    return doubled(); // dispose() будет вызван автоматически на выходе из scope
}
```

> Чаще всего явный `dispose()` не нужен: сигналы ленивые и не удерживает подписок без подписчиков.

## Функциональный vs классовый стиль

RxSignals поддерживает как функциональный, так и классовый стили создания сигналов, позволяя выбрать подход в зависимости от предпочтений и архитектуры приложения.
#### Функциональный стиль (рекомендуемый)

Используйте статические методы `Signal.state`,`Signal.compute` и `Signal.effect` для создания сигналов. 
Этот стиль лаконичен, похож на SolidJS и подходит для большинства случаев:

```ts
import { Signal } from '@fozy-labs/rx-toolkit';

const count = Signal.state(0);
const doubled = Signal.compute(() => count() * 2);
const logEffect = Signal.effect(() => console.log(doubled()));
```

#### Классовый стиль

Создавайте экземпляры классов Signal, Computed и Effect напрямую.
Этот стиль более явный, похож на RxJs и полезен для наследования или сложной логики,
учтите, что вызов `()` недоступен и нужно использовать `get()`:

```ts
import { State, Computed, Effect } from '@fozy-labs/rx-toolkit';

const count = new State(0);
const doubled = new Computed(() => count.get() * 2);
const logEffect = new Effect(() => console.log(doubled.get()));
```

### SourceSignal

Базовый класс для сигналов только для чтения, оборачивающий произвольную логику подписки. Используется внутри `signalize` и для создания кастомных read-only сигналов. Возвращает `ReadonlySignal<T>`.

```typescript
import { SourceSignal } from '@fozy-labs/rx-toolkit';

const customSignal = SourceSignal.create<number>((subscriber) => {
    // Логика подписки
    subscriber.next(initialValue);
    return () => {
        // Cleanup
    };
});
```

> Ранее этот класс назывался `ReadonlySignal`. Теперь имя `ReadonlySignal` занято публичным **типом** (см. раздел «Типы сигналов»), а класс переименован в `SourceSignal`.

### LocalSignal

Сигнал, который автоматически синхронизируется с `localStorage`.

```typescript
import { z } from 'zod/v4';
import { LocalSignal } from '@fozy-labs/rx-toolkit';

enum FILTER {
    ALL = 'all',
    CHANNELS = 'channels',
    CHATS = 'chats',
    MEETINGS = 'meetings',
}

const selectedFilter$ = LocalSignal.state({
    key: 'memberships-list-selected-filter',
    defaultValue: FILTER.ALL,
    zodSchema: z.nativeEnum(FILTER), // Опционально: валидация через Zod
});

// Использование
console.log(selectedFilter$()); // Значение из localStorage или FILTER.ALL
selectedFilter$.set(FILTER.CHANNELS); // Сохраняется в localStorage

function logout() {
    selectedFilter$.clear(); // Удаляет значение из localStorage (сбрасывает на defaultValue)
}
```

**Опции `LocalSignal.state(...)` (`LocalStateOptions`):**
- `key` — ключ для localStorage
- `defaultValue` — значение по умолчанию
- `zodSchema` — опциональная Zod-схема для валидации
- `userId` — опциональный идентификатор пользователя для изоляции данных
- `checkEffect` — функция валидации значения
- `devtoolsOptions` — настройки для devtools
- `driver` — драйвер для хранения (по умолчанию localStorage, можно заменить на кастомный драйвер)

### unstable_ProxySignal (экспериментально)

> ⚠️ **Экспериментальный API.**

Глубокий реактивный стор: держит одно дерево состояния (обычные объекты + массивы) и отдаёт его как ленивое дерево пер-путевых сигналов. Подписка идёт **точечно, на конкретный путь**, а не на весь стор целиком — то, чего не хватает при использовании одного общего сигнала-версии.

```typescript
import { unstable_ProxySignal as ProxySignal, Signal } from '@fozy-labs/rx-toolkit';

const ps = ProxySignal.state({
    user: { name: 'Ann', age: 20 },
    tags: ['a', 'b'],
});

// Чтение + подписка ровно на этот путь (в реактивном контексте)
Signal.effect(() => {
    console.log(ps.root.user.name()); // проснётся только при изменении user.name
});

// Запись через copy-on-write черновик — будятся только затронутые пути
ps.mutate((draft) => {
    draft.user.age += 1;
});

// Замена всего дерева целиком (диффится по ссылкам, пер-узловой Object.is-дедуп)
ps.set({ user: { name: 'Bob', age: 30 }, tags: [] });

ps.peek();   // нереактивный снимок всего дерева
ps.dispose(); // освобождение (после этого чтения бросают)
```

**Чтение.** `ps.root` — корень реактивного прокси-дерева. Навигация (`ps.root.user`) ничего не подписывает и не аллоцирует — это просто путь. Подписка возникает только при **вызове** узла:

- `ps.root.user.name()` — читает значение по пути и (в контексте `Signal.effect` / `Signal.compute`) подписывается ровно на него.
- `'name' in ps.root.user`, `Object.keys(ps.root.user)` — реагируют только на **изменение набора ключей** (добавление/удаление), но не на смену значения существующего ключа.
- Вне реактивного контекста вызов узла просто возвращает текущее значение, ничего не подписывая.

**Запись.** Мутации идут только через `mutate` (черновик с copy-on-write, в стиле immer) или `set` (замена корня). Оба варианта диффят дерево по ссылкам поузлово и применяют дедупликацию через `Object.is`, поэтому no-op-запись не будит никого. Возвращаемое из рецепта значение игнорируется (`draft.k = v` — это выражение присваивания). Само дерево `ps.root` строго read-only: любая прямая мутация прокси — присваивание, `delete`, `Object.defineProperty`, `Object.setPrototypeOf`, `Object.freeze`/`preventExtensions` — бросает ошибку.

**Семантика реактивности:**

- Подписка на узел (`node()`) срабатывает при любом изменении его значения, **включая глубокие** — обновления copy-on-write, поэтому глубокая мутация заменяет ссылку у всех предков (подписчик `ps.root.user()` проснётся и при изменении `user.name`).
- Соседние пути изолированы: изменение `ps.root.tags` не будит подписчика `ps.root.user.name`.
- Глубоко вложаются только массивы и обычные объекты. `Map` / `Set` / `Date` / инстансы классов / функции / примитивы — **непрозрачные листья**: реактивность по замене всей ссылки, внутрь навигация не идёт, `produce` их не клонирует.
- Узлы создаются лениво и удаляются, когда на них не остаётся подписчиков (нет утечки при ротации ключей — например, в кэше).

**Интеграция с RxJS / React.** У контроллера есть `obs` — Observable всего дерева. Он же совместим по форме с `useSignal` (`{ obs, peek }`), поэтому в React можно писать `const snapshot = useSignal(ps)` для подписки на весь стор, либо обернуть конкретный путь в `Signal.compute(() => ps.root.user.name())` для точечной перерисовки.

**Известные ограничения:** прямые `JSON.stringify` / `` `${ps.root}` `` / `for..of` по прокси не поддерживаются (используйте `peek()` и `Object.keys(...)`); ключи данных с именами `then` / `toString` / `constructor` и т.п. не навигируются реактивно (читайте через `peek()`); символьные ключи и внутренности `Map`/`Set` нереактивны; циклические структуры в `produce` не поддерживаются.

## Операторы

### signalize

Преобразует RxJS Observable в Signal. Позволяет использовать любой Observable как реактивный сигнал.

```typescript
import { interval, startWith } from 'rxjs';
import { signalize, Effect } from '@fozy-labs/rx-toolkit';

// Создаем Observable, который эмитит значение каждую секунду
const timer$ = interval(1000).pipe(
    startWith(0),
);

// Преобразуем Observable в Signal
const tick$ = signalize(timer$);

// Теперь можно использовать tick$ как обычный Signal
new Effect(() => {
    console.log(`Timer: ${tick$.get()}`);
});

// Доступ к значению без подписки
console.log(tick$.peek());
```

**Значение по умолчанию (`defaultValue`):**

Если источник эмитит асинхронно (`Subject`, `interval`, HTTP-запрос и т.п.), то до первой эмиссии у сигнала нет значения, и чтение через `()`/`peek()`/`get()` выбросит `"No value emitted"`. Передайте `defaultValue`, чтобы вернуть его до первой эмиссии:

```ts
import { Subject } from 'rxjs';
import { signalize } from '@fozy-labs/rx-toolkit';

const source$ = new Subject<number>();
const value$ = signalize(source$, 0); // 0 — значение до первой эмиссии

console.log(value$()); // 0 (источник ещё ничего не эмитил)
```

## Батчинг обновлений (Batcher)

RxSignals автоматически группирует множественные обновления сигналов в один цикл обновления. Это обеспечивает:
- Консистентность состояния
- Оптимальную производительность
- Предсказуемый порядок выполнения эффектов

```typescript
const a = Signal.state(1);
const b = Signal.state(2);
const sum = Signal.compute(() => a() + b());

new Effect(() => {
    console.log(`Sum: ${sum()}`);
});

// Оба изменения обрабатываются в одном батче
Batcher.run(() => {
    a.set(10);
    b.set(20);
});
// Effect выведет: "Sum: 30" (один раз, а не два)
```

## Интеграция с RxJS

Сигналы полностью совместимы с RxJS. Каждый сигнал предоставляет `obs` — стандартный RxJS Observable:

```typescript
import { filter, take, debounceTime } from 'rxjs';
import { Signal, Computed, signalize } from '@fozy-labs/rx-toolkit';

const clicks = Signal.state(0);

// Используем RxJS операторы
const tenClicks$ = clicks.obs.pipe(
    filter(value => value === 10),
    take(1)
);

tenClicks$.subscribe(() => {
    console.log('Reached 10 clicks!');
});

// Или наоборот - превращаем Observable в Signal
const debouncedClicks$ = signalize(
    clicks.obs.pipe(
        debounceTime(300)
    )
);

// Теперь debouncedClicks$ можно использовать в Computed/Effect
const doubled = Signal.compute(() => debouncedClicks$() * 2);
```

## Devtools

Сигналы поддерживают интеграцию с Redux DevTools для отладки:

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

// С именем для devtools
const count$ = Signal.state(0, 'counter');

count$.set(1); // Action type: "UPDATE"
count$.set(0, 'reset'); // Action type: "UPDATE: reset"
count$.update((value) => value + 1, 'increment'); // Action type: "UPDATE: increment"

// Или с расширенными опциями
const user$ = Signal.state(null, {
    isDisabled: true, // Отключить отслеживание в devtools
});
```

## React интеграция

См. [React интеграция](../usage/react/README.md) для подробной информации о том, как использовать RxSignals в React приложениях.
