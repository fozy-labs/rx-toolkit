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

Также на данный момент Computed 

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

## Функциональный vs классовый стиль

RxSignals поддерживает как функциональный, так и классовый стили создания сигналов, позволяя выбрать подход в зависимости от предпочтений и архитектуры приложения.
#### Функциональный стиль (рекомендуемый)

Используйте статические методы `Signal.state`,`Signal.compute` и `Signal.effect` для создания сигналов. 
Этот стиль лаконичен, похож на SolidJS и подходит для большинства случаев:

```tszz
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

### ReadonlySignal

Базовый класс для сигналов только для чтения. Используется внутри `signalize` и для создания кастомных сигналов.

```typescript
import { ReadonlySignal } from '@fozy-labs/rx-toolkit';

const customSignal = new ReadonlySignal((subscriber) => {
    // Логика подписки
    subscriber.next(initialValue);
    return () => {
        // Cleanup
    };
});
```

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

const selectedFilter$ = LocalSignal.create({
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

**Опции `LocalSignal.create(...)` (`LocalStateOptions`):**
- `key` — ключ для localStorage
- `defaultValue` — значение по умолчанию
- `zodSchema` — опциональная Zod-схема для валидации
- `userId` — опциональный идентификатор пользователя для изоляции данных
- `checkEffect` — функция валидации значения
- `devtoolsOptions` — настройки для devtools
- `driver` — драйвер для хранения (по умолчанию localStorage, можно заменить на кастомный драйвер)

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
    isDisabled: false, // Отключить отслеживание в devtools
});
```

## React интеграция

См. [React интеграция](../usage/react/README.md) для подробной информации о том, как использовать RxSignals в React приложениях.
