# RxSignals

RxSignals — это реактивная система управления состоянием, вдохновленная современными фреймворками типа SolidJS и Angular Signals. Она предоставляет эффективные инструменты для создания реактивных приложений.

## Основные концепции

### Signal

Базовый класс для создания реактивных сигналов с изменяемым состоянием.

**Пример использования:**

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

const name = new Signal('John');
const age = new Signal(25);

// Чтение значения (с отслеживанием зависимостей)
console.log(name.get()); // "John"

// Чтение значения без отслеживания
console.log(name.peek()); // "John"

// Запись нового значения
name.set('Jane');

// Подписка на изменения через RxJS Observable
const subscription = name.obs.subscribe(newName => {
  console.log(`Name changed to: ${newName}`);
});

// Отписка
subscription.unsubscribe();
```

**API Signal:**
- `get()` — получить значение и зарегистрировать зависимость (для использования внутри Computed/Effect)
- `peek()` — получить значение без регистрации зависимости
- `set(value)` — установить новое значение
- `obs` — RxJS Observable для подписки на изменения

### Computed

Создает вычисляемое значение, которое автоматически обновляется при изменении зависимостей.

```typescript
import { Signal, Computed } from '@fozy-labs/rx-toolkit';

const firstName = new Signal('John');
const lastName = new Signal('Doe');

const fullName = new Computed(() => `${firstName.get()} ${lastName.get()}`);

console.log(fullName.get()); // "John Doe"

firstName.set('Jane');
console.log(fullName.get()); // "Jane Doe"

// Подписка на изменения
fullName.obs.subscribe(name => console.log(name));
```

**API Computed:**
- `get()` — получить вычисленное значение с регистрацией зависимости
- `peek()` — получить значение без регистрации зависимости
- `obs` — RxJS Observable для подписки на изменения

### Effect

Создает побочный эффект, который автоматически выполняется при изменении используемых сигналов.

```typescript
import { Signal, Effect } from '@fozy-labs/rx-toolkit';

const count = new Signal(0);
const message = new Signal('Hello');

const effect = new Effect(() => {
  // Выведет: "Hello: 0" при инициализации
  console.log(`${message.get()}: ${count.get()}`);
});

count.set(1); // Выведет: "Hello: 1"
message.set('Hi'); // Выведет: "Hi: 1"

// Остановка эффекта
effect.unsubscribe();
```

**Cleanup функция (teardown):**

Effect поддерживает возврат функции очистки, которая вызывается перед следующим выполнением или при отписке:

```typescript
const effect = new Effect(() => {
  const timer = setInterval(() => console.log(count.get()), 1000);
  
  // Cleanup - вызывается перед повторным выполнением эффекта
  return () => {
    clearInterval(timer);
  };
});
```

## Функциональный стиль API

Для более компактного синтаксиса доступны статические методы `Signal.create()`, `Signal.compute()` и `Signal.effect()`:

```typescript
import { Signal } from '@fozy-labs/rx-toolkit';

class CounterStore {
    // Создание сигнала в функциональном стиле (вызывается как функция)
    count$ = Signal.create(0);
    
    // Computed в функциональном стиле
    doubled$ = Signal.compute(() => this.count$() * 2);
    squared$ = Signal.compute(() => (this.doubled$() / 2) ** 2);

    increment = () => this.count$.set(this.count$.peek() + 1);
    decrement = () => this.count$.set(this.count$.peek() - 1);
    reset = () => this.count$.set(0);
}

const store = new CounterStore();

// Чтение значения - вызов как функции
console.log(store.count$()); // 0
console.log(store.doubled$()); // 0

store.increment();
console.log(store.count$()); // 1
console.log(store.doubled$()); // 2
console.log(store.squared$()); // 1
```

**API функциональных сигналов:**
- `signal$()` — вызов как функции возвращает значение (аналог `get()`)
- `signal$.peek()` — получить значение без отслеживания
- `signal$.set(value)` — установить значение
- `signal$.obs` — RxJS Observable

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
console.log(selectedFilter$.peek()); // Значение из localStorage или FILTER.ALL
selectedFilter$.set(FILTER.CHANNELS); // Сохраняется в localStorage
```

**Опции LocalSignal:**
- `key` — ключ для localStorage
- `defaultValue` — значение по умолчанию
- `zodSchema` — опциональная Zod-схема для валидации
- `userId` — опциональный идентификатор пользователя для изоляции данных
- `checkEffect` — функция валидации значения
- `devtoolsOptions` — настройки для devtools

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
const a = Signal.create(1);
const b = Signal.create((2);
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

const clicks = Signal.create(0);

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
const count$ = Signal.create(0, 'counter');

// Или с расширенными опциями
const user$ = Signal.create(null, {
    isDisabled: false, // Отключить отслеживание в devtools
});
```

## React интеграция

См. [React интеграция](../usage/react/README.md) для подробной информации о том, как использовать RxSignals в React приложениях.

