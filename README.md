# RxToolkit

> Фреймворк-агностик набор инструментов для **реактивного** управления состоянием, построенный поверх RxJS.

[![npm version](https://badge.fury.io/js/%40fozy-labs%2Frx-toolkit.svg)](https://badge.fury.io/js/%40fozy-labs%2Frx-toolkit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![RxJS](https://img.shields.io/badge/RxJS-7.8-purple.svg)](https://rxjs.dev/)
## 📦 Установка

```bash
npm install @fozy-labs/rx-toolkit rxjs
```

## 🎯 Цель

RxJS действительно мощный инструмент реактивного программирования,
он удобен, когда мы работаем с потоком событий, но когда речь заходит о состоянии приложения,
из-за асинхронной природы rx'а, его использование становится сложным и громоздким, не говоря уже о кешировании данных
(хотя некоторые разработчики "продают" rxjs, как альтернативу Query библиотекам,
на самом деле реализация подобного функционала выльется в создание отдельной библиотеки).

RxToolkit решает эти проблемы, предоставляя свою реализацию сигналов и кеш-менеджера.

## ✨ Особенности

- 🧩 **Реактивные примитивы** — Привычные Signal, Computed и Effect.
- 🔧 **Framework-agnostic** — Стройте систему и описывайте логику в изолированном месте.
- ⚡ **Built on RxJS** — Наследует всю мощь RxJS.
- 💾 **Кеш-менеджер** — Предоставляет Query реализацию для работы с данными.
- 🧪 **Query** — Кеш-менеджер с machine states, плагинами и SSR snapshots.
- 🔷 **TypeScript-first** — Полная типизация.
- 🔗 **Интеграция с фреймворками** — Как и RxJS напрямую работает в Angular, Svelte и SolidJS.
  Поставляется с React-хуками из коробки.

## 📚 Документация
- [**RxSignals**](./docs/signals/README.md) - реактивные примитивы
- [**RxQuery**](./docs/query/README.md) - кеш-менеджер для работы с данными
- [**React**](./docs/usage/react/README.md) - интеграция с React
- [**Devtools**](./docs/devtools/README.md) - инструменты разработчика
- [**DefaultOptions**](./docs/options/README.md) - глобальные настройки


[**CHANGELOG**](./docs/CHANGELOG.md)

[**CONTRIBUTING**](./docs/CONTRIBUTING.md)

## 🌟 Примеры

###### Создаем сигнал
```typescript
// Описываем логику в обычном JavaScript
const count$ = Signal.state(0);
const doubled$ = Signal.compute(() => count$() * 2);
const increment = () => count$.set(count$() + 1);
```

###### Подключаем к фреймворку
```typescript
// React
const count = useSignal(count$);

// Angular signal
public readonly count = toSignal(count$.obs);

// Angular pipe
{{ count$.obs | async }}

// SolidJS
const count = from(count$.obs)

// Svelte
$: count = count$.obs;
```

###### Работаем с RxJS

```typescript
// Создаем Observable
const clicker$ = fromEvent(document, 'click').pipe(
    debounceTime(300),
    scan(count => count + 1, 0),
    startWith(0),
);

// Получаем сигнал из Observable
const clickCount$ = signalize(clicker$);
const doubled$ = Signal.compute(() => clickCount$() * 2);

console.log(doubled$()); // Всегда актуальное значение

// Или наоборот, получаем событие из сигнала
const on10click$ = doubled$.obs.pipe(
    filter(value => value === 10),
    take(1)
);

const sub = on10click$.subscribe(() => {
    console.log('Great! You first reached 10 clicks!');
});
// Не забываем отписаться
sub.unsubscribe();
```

###### RxQuery (Корзина покупок)
```tsx
import {
    createApi,
    reactHooksPlugin,
} from '@fozy-labs/rx-toolkit';

const api = createApi({
    plugins: [reactHooksPlugin()],
});

const getCart = api.createResource({
    key: 'cart',
    queryFn: fetchCart,
});

const toggleCartItem = api.createCommand({
    queryFn: fetchToggleCartItem,
    links(link) {
        link({
            resource: getCart,
            forwardArgs: () => undefined,
            optimisticUpdate: (draft, args) => {
                const item = draft.items.find(i => i.id === args.id);
                if (!item) return;
                item.enabled = args.enabled;
            }
        })
    }
});

function ShoppingCart() {
    const cartQuery = getCart.useResource();
    const [toggleItem] = toggleCartItem.useCommand();
    const cart = cartQuery.data;

    return (
        <Container isLoading={cartQuery.isLoading}>
            {cart?.items.map(item => (
                <CartItem
                    key={item.id}
                    item={item}
                    onToggle={() => toggleItem({ id: item.id, enabled: !item.enabled })}
                />
            ))}
        </Container>
    );
}
```
