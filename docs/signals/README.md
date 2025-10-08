# RxSignals

RxSignals — это реактивная система управления состоянием, вдохновленная современными фреймворками типа SolidJS и Angular Signals. Она предоставляет эффективные инструменты для создания реактивных приложений.

## Основные концепции

### Signal

Базовый класс для создания реактивных сигналов.

**Пример использования:**

```typescript
const name = new Signal('John');
const age = new Signal(25);

// Подписка на изменения
const subscription = name.subscribe(newName => {
  console.log(`Name changed to: ${newName}`);
}); // Выведет: "Name changed to: John" при инициализации

name.value = 'Jane'; // Выведет: "Name changed to: Jane"

// Отписка
subscription.unsubscribe();
```

### Computed

Создает вычисляемое значение, которое автоматически обновляется при изменении зависимостей.

```typescript
const firstName = new Signal('John');
const lastName = new Signal('Doe');

const fullName = new Computed(() => `${firstName.value} ${lastName.value}`);

console.log(fullName.value); // "John Doe"

firstName.value = 'Jane';
console.log(fullName.value); // "Jane Doe"
```

### Effect

Создает эффект, который выполняется при изменении используемых сигналов.

```typescript
const count = new Signal(0);
const message = new Signal('Hello');

const sub = new Effect(() => {
    // Выведет: "Hello: 0" при инициализации
  console.log(`${message.value}: ${count.value}`);
});

count.value = 1; // Выведет: "Hello: 1"
message.value = 'Hi'; // Выведет: "Hi: 1"

// Остановка эффекта
sub.unsubscribe();
```

### LocalSignal

Сигнал, который синхронизируется с локальным хранилищем (localStorage).
// TODO убрать zod из core, добавить возможность передавать "driver".

```typescript
import { z } from 'zod/v4';
import { LocalSignal } from '@fozy-labs/rx-toolkit';

enum FILTER {
    ALL = 'all',
    CHANNELS = 'channels',
    CHATS = 'chats',
    MEETINGS = 'meetings',
}

const selectedFilter$ = new LocalSignal({
    key: 'memberships-list-selected-filter',
    defaultValue: FILTER.ALL,
    zodSchema: z.enum(FILTER),
});
```

## Operators (Операторы)

### mapSignals
// TODO: добавить описание


### signalize

Преобразует Observable в Signal.

```typescript
import { interval } from 'rxjs';
import { signalize, Effect } from '@fozy-labs/rx-toolkit';

// Создаем Observable, который эмитит значение каждую секунду
const timer$ = interval(1000).pipe(
    startWith(0),
);

// Преобразуем Observable в Signal
const tick$ = signalize(timer$);

// Теперь можно использовать timerSignal как обычный Signal
new Effect(() => {
    console.log(`Timer: ${tick$.value}`);
})
```

### filterUpdates

Фильтрует обновления сигнала.
// TODO: добавить пример использования, подумать над целесообразностью

## React Integration

См. [React интеграция](../usage/react/README.md) для подробной информации о том, как использовать RxSignals в React приложениях.
