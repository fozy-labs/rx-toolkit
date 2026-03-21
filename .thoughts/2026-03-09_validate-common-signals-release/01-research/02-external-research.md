# 02 — Внешнее исследование: best practices и типичные ошибки

## 1. Типичные баги в реализациях сигналов

### 1.1 Glitch (алмазная проблема / Diamond Problem)

**Суть:** при изменении одного State, от которого зависят два Computed, а от них обоих — третий Computed или Effect, промежуточный наблюдатель может увидеть inconsistent состояние (одна зависимость обновлена, вторая ещё нет).

```
    State A
   /       \
Computed B  Computed C
   \       /
   Effect D   ← может получить {B=new, C=old} 
```

**Применимость к rx-toolkit:**
Система `Batcher` + ранги (`rang`) решает эту проблему через приоритезированную очередь: эффекты с более высоким рангом выполняются после всех зависимостей с меньшим рангом. Однако это **необходимо протестировать**, т.к. `rang` вычисляется динамически в `Effect._runInTrackedContext()`.

### 1.2 Утечки памяти (Memory Leaks)

**Типичные причины:**
- Подписки не отписываются при уничтожении наблюдателя
- Циклические ссылки между сигналами
- Замыкания удерживают большие объекты

**Применимость к rx-toolkit:**
- `State` использует `FinalizationRegistry` для cleanup devtools — но FinalizationRegistry НЕ гарантирует timing
- `Computed` использует `resetOnRefCountZero: true` в `share()` + `finalize(() => this._stop())` — корректный подход
- `Effect` требует явного `unsubscribe()` — если пользователь забудет, утечка гарантирована. Нет предупреждений
- `SyncObservable.value` — subscribe/unsubscribe в одном стеке. Если Observable не cleanup при unsubscribe (например, добавляет event listener), это может утечь

### 1.3 Бесконечные циклы

**Суть:** эффект изменяет сигнал, от которого сам зависит.

**Применимость к rx-toolkit:**
- `Effect._runInTrackedContext` подписывается на зависимости и при изменении перезапускается
- Если `effectFn` пишет в сигнал, который читает → бесконечный цикл
- Нет защиты от максимального числа итераций (в отличие от Angular Signals, где есть лимит)

### 1.4 Stale closures

**Суть:** callback захватывает старые значения через замыкание.

**Применимость к rx-toolkit:**
- `useSignal` использует `useEventHandler` для стабилизации `getSnapshot` — это правильный подход
- `useConstant` с deps — замыкание `fn` всегда свежее (пересоздаётся при изменении)

---

## 2. Best practices тестирования reactive/signal библиотек

### 2.1 Категории тестов

| Категория | Что тестировать | Примеры |
|-----------|----------------|---------|
| **Unit** | Каждый примитив изолированно | State: set/get/peek, identity check |
| **Integration** | Взаимодействие примитивов | Computed + State, Effect + State |
| **Glitch-free** | Diamond problem, consistency | Многоуровневые зависимости |
| **Lifecycle** | Подписка/отписка, cleanup | Effect teardown, Computed lazy init |
| **Edge cases** | Граничные условия | NaN, undefined, circular references |
| **Memory** | Утечки | WeakRef проверки, subscription count |
| **React integration** | Хуки | useSignal рендеринг, concurrent mode |
| **Performance** | Регрессии | Батчинг, ненужные обновления |

### 2.2 Тестирование batching

Из исследования Angular Signals и SolidJS:
- Батч должен гарантировать, что промежуточные состояния НЕ наблюдаются конечными подписчиками
- Проверять что `effect` внутри `Batcher.run()` выполняется ровно один раз при множественных обновлениях
- Проверять приоритеты: сначала rang=0, потом rang=1 и т.д.
- Проверять что ошибка в одном эффекте не блокирует остальные

### 2.3 Тестирование React хуков

Из документации `useSyncExternalStore`:
- `getSnapshot` **ДОЛЖЕН** возвращать кешированное значение если store не изменился
- `subscribe` должен вернуть функцию отписки
- При SSR необходим `getServerSnapshot`
- Тестировать с `@testing-library/react` + `act()` для корректной работы с microtasks

### 2.4 Тестирование lazy computed

Ленивые computed-сигналы (как в rx-toolkit) имеют два режима:
1. **Без подписки** — значение вычисляется через cache при `peek()`
2. **С подпиской** — создаётся Effect, значение обновляется реактивно

Нужно тестировать переходы между режимами и корректность кеша.

---

## 3. TypeScript strict mode

Проект использует `"strict": true` в tsconfig.json. Это включает:
- `strictNullChecks` — все nullable типы должны быть явными
- `strictFunctionTypes` — контравариантные параметры функций
- `noImplicitAny` — нет неявных `any`

**Найденные нарушения:**
- `@ts-ignore` в `deepEqual.ts` (строка 22) и `shallowEqual.ts` (строка 22)
- `as any` в `State.ts` (строка 56: `heldValue('$COMPLETED' as any)`)
- `(window as any).__REDUX_DEVTOOLS_EXTENSION__` в `reduxDevtools.ts`

---

## 4. Выбор тестового фреймворка

### Vitest vs Jest

| Критерий | Vitest | Jest |
|----------|--------|------|
| ESM поддержка | ✅ Нативная | ⚠️ Экспериментальная |
| TypeScript | ✅ Через Vite/esbuild | ✅ Через ts-jest/babel |
| Скорость | ✅ Быстрее (Vite-based) | ✅ Зрелый, стабильный |
| React testing | ✅ @testing-library/react | ✅ @testing-library/react |
| Совместимость с проектом | ✅ `"type": "module"` | ⚠️ ESM-конфиг сложнее |
| Наличие в demos/ | ✅ Vite уже используется | ❌ Нет |

**Рекомендация**: Vitest — проект использует ESM (`"type": "module"`), уже есть Vite в demos/, Vitest нативно поддерживает ESM и TypeScript path aliases.

---

## 5. Паттерны из экосистемы

### SolidJS Signals
- `createSignal` возвращает [getter, setter] — разделение чтения и записи
- Tracking scope — аналогично `DependencyTracker`
- `batch()` — аналогично `Batcher.run()`
- Встроенная защита от бесконечных циклов в effects

### Angular Signals
- `signal()`, `computed()`, `effect()` — аналогичный набор примитивов
- `untracked()` — чтение без отслеживания (аналог `peek()`)
- Equality functions настраиваемы — в rx-toolkit используется `===` (referential)
- `assertNotInReactiveContext` — защита от неправильного использования
- Deep mutation не отслеживается (аналогично, `State.set()` требует новый объект)

### Preact Signals
- Автоматическое отслеживание через `.value` getter
- Glitch-free через topological sort
- Встроенный `batch()` со stack-based approach

### Ключевые отличия rx-toolkit
- Основан на RxJS Observable — мост между двумя парадигмами
- `SyncObservable` как ключевая абстракция для синхронного доступа к значению
- Двойной API: функциональный (`Signal.state()`) и классовый (`new State()`)
- Ранги вместо topological sort для ordering
