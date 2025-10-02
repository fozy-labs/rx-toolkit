# RxToolkit

> Фреймворк агностик набор инструментов для **реактивного** управления состоянием, построенный поверх RxJS.

[![npm version](https://badge.fury.io/js/%40fozy-labs%2Frx-toolkit.svg)](https://badge.fury.io/js/%40fozy-labs%2Frx-toolkit)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![RxJS](https://img.shields.io/badge/RxJS-7.8-purple.svg)](https://rxjs.dev/)
## 📦 Установка

```bash
npm install @fozy-labs/rx-toolkit rxjs
```

## 🎯 Цель

RxJS действительно мощный инструмент реактивного программирования, 
он удобен когда мы работаем с потоком событий, но когда речь заходит о состоянии приложения,
из-за асинхронной природы rx'а, его использование становится сложным и громоздким, не говоря уже о кешировании данных
(хотя некоторые разработчики "продают" rxjs, как альтернативу Query библиотекам,
на самом деле реализация подобного функционала выльется в создание отдельной библиотеки).

RxToolkit решает эти проблемы, предоставляя свою реализацию сигналов и кеш-менеджера.

## ✨ Особенности

- 🧩 **Реактивные примитивы** — Привычные Signal, Computed и Effect.
- 🔧 **Framework-agnostic** — Стройте систему и описывайте логику в изолированном месте.
- ⚡ **Built on RxJS** — Наследует всю мощь RxJS.
- 💾 **Кеш-менеджер** — Предоставляет Query реализацию для работы с данными.
- 🔷 **TypeScript-first** — Полная типизация.
- 🔗 **Интеграция с фреймворками** — Как и RxJS напрямую работает в Angular, Svelte и SolidJS.
 Поставляется с React-хуками из коробки.

## 📚 Документация
- [**RxSignals**](./docs/signals/README.md) - реактивные примитивы
- [**RxQuery**](./docs/query/README.md) - кеш-менеджер для работы с данными
- [**React**](./docs/usage/react/README.md) - интеграция с React

## 🌟 Примеры

###### Создаем сигнал
```typescript
// Описываете логику в обычном JavaScript
const store = {
  count$: new Signal(0),
  doubled$: new Computed(() => store.count$.value * 2),
  increment: () => store.count$.next(store.count$.value + 1)
};
```

###### Подключаем к фреймворку
```typescript
// React
const count = useSignal(store.count$);

// Angular signal
count$ = toSignal(store.count$);

// Angular pipe
{{ store.count$ | async }}

// Svelte
$: count = store.count$;
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
const doubled$ = new Computed(() => clickCount$.value * 2);

console.log(doubled$.value); // Всегда актуальное значение

// Или наоборот, получаем событие из сигнала
const on10click$ = doubled$.pipe(
    filter(value => value === 10),
    take(1)
);

on10click$.subscribe(() => {
    console.log('Great! That you first reached 10 clicks!');
});

```

###### RxQuery (Корзина покупок)
```tsx
const getCart = createResource({
    queryFn: fetchCart,
});

const toggleCardItem = createOperation({
    queryFn: fetchToggleCardItem,
    link(add) {
        add({
            resource: getCart,
            forwardArgs: () => undefined,
            optimisticUpdate: ({ draft, data, args }) => {
                const item = draft.items.find(i => i.id === data.id);
                if (!item) return;
                item.enabled = args.enabled;
            }
        })
    }
});

function ShoppingCart() {
    const cartQuery = useResourceAgent(getCart);
    const [toggleItem] = useOperationAgent(toggleCardItem);
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
            <Total amount={cart?.total}/>
        </Container>
    );
}
```
