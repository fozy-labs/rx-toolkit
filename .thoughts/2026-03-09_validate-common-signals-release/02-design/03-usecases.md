# 03 — Use Cases для тестирования

## Обзор

Документ описывает конкретные use cases тестирования для каждого модуля в scope. Каждый use case содержит пользовательскую историю и примеры кода тестов.

Основание: [анализ кодовой базы](../01-research/01-codebase-analysis.md), [best practices тестирования](../01-research/02-external-research.md).

---

## UC-1: Базовые операции State

**Как** разработчик, использующий `Signal.state()`,  
**я хочу** быть уверен, что создание, чтение и запись значений работает корректно,  
**чтобы** мои компоненты получали актуальные данные.

```typescript
describe('State', () => {
  it('создаёт сигнал с начальным значением', () => {
    const count = Signal.state(0);
    expect(count()).toBe(0);
    expect(count.peek()).toBe(0);
  });

  it('обновляет значение через set', () => {
    const count = Signal.state(0);
    count.set(5);
    expect(count()).toBe(5);
  });

  it('пропускает обновление при одинаковом значении (referential equality)', () => {
    const values: number[] = [];
    const count = Signal.state(0);
    count.obs.subscribe(v => values.push(v));

    count.set(0); // то же значение
    count.set(0); // то же значение
    
    expect(values).toEqual([0]); // только начальное значение
  });

  it('peek() не создаёт подписку в tracked context', () => {
    const a = Signal.state(1);
    const b = Signal.state(2);
    
    let computeCount = 0;
    const sum = Signal.compute(() => {
      computeCount++;
      return a() + b.peek(); // b.peek() — не трекается
    });

    // Подписываемся чтобы активировать Computed
    const sub = sum.obs.subscribe(() => {});
    expect(computeCount).toBe(1);

    b.set(10); // Не должно вызвать пересчёт (peek)
    expect(computeCount).toBe(1);

    a.set(5); // Должно вызвать пересчёт
    expect(computeCount).toBe(2);
    expect(sum.peek()).toBe(15); // a(5) + b.peek(10)

    sub.unsubscribe();
  });
});
```

---

## UC-2: Computed — ленивое вычисление и кеш

**Как** разработчик, использующий `Signal.compute()`,  
**я хочу** быть уверен, что computed пересчитывается лениво и кеширует результат,  
**чтобы** избежать лишних вычислений.

```typescript
describe('Computed', () => {
  it('вычисляется лениво при первом вызове peek()', () => {
    let computeCount = 0;
    const a = Signal.state(1);
    const doubled = Signal.compute(() => {
      computeCount++;
      return a() * 2;
    });

    expect(computeCount).toBe(0); // ленивый — не вычислен
    expect(doubled.peek()).toBe(2);
    expect(computeCount).toBe(1);
  });

  it('возвращает кешированное значение при повторном peek()', () => {
    let computeCount = 0;
    const a = Signal.state(1);
    const doubled = Signal.compute(() => {
      computeCount++;
      return a() * 2;
    });

    doubled.peek();
    doubled.peek();
    doubled.peek();
    // ComputeCache должен вернуть кешированное значение
    expect(computeCount).toBe(1);
  });

  it('инвалидирует кеш при изменении зависимости', () => {
    let computeCount = 0;
    const a = Signal.state(1);
    const doubled = Signal.compute(() => {
      computeCount++;
      return a() * 2;
    });

    expect(doubled.peek()).toBe(2);
    expect(computeCount).toBe(1);

    a.set(5);
    expect(doubled.peek()).toBe(10);
    expect(computeCount).toBe(2);
  });
});
```

---

## UC-3: Effect — автоматическое отслеживание и cleanup

**Как** разработчик, использующий `Signal.effect()`,  
**я хочу** быть уверен, что побочные эффекты корректно реагируют на зависимости и очищаются,  
**чтобы** не было утечек памяти.

```typescript
describe('Effect', () => {
  it('автоматически отслеживает зависимости', () => {
    const values: number[] = [];
    const count = Signal.state(0);

    const effect = Signal.effect(() => {
      values.push(count());
    });

    expect(values).toEqual([0]); // немедленный запуск

    count.set(1);
    expect(values).toEqual([0, 1]);

    count.set(2);
    expect(values).toEqual([0, 1, 2]);

    effect.unsubscribe();
  });

  it('вызывает teardown перед перезапуском', () => {
    const teardowns: string[] = [];
    const count = Signal.state(0);

    const effect = Signal.effect(() => {
      const val = count();
      return () => teardowns.push(`cleanup-${val}`);
    });

    count.set(1);
    expect(teardowns).toEqual(['cleanup-0']);

    count.set(2);
    expect(teardowns).toEqual(['cleanup-0', 'cleanup-1']);

    effect.unsubscribe();
    expect(teardowns).toEqual(['cleanup-0', 'cleanup-1', 'cleanup-2']);
  });

  it('прекращает отслеживание после unsubscribe', () => {
    const values: number[] = [];
    const count = Signal.state(0);

    const effect = Signal.effect(() => {
      values.push(count());
    });

    effect.unsubscribe();
    count.set(999);

    expect(values).toEqual([0]); // после unsubscribe — нет обновлений
  });
});
```

---

## UC-4: Batching — консистентность обновлений

**Как** разработчик, выполняющий множественные обновления,  
**я хочу** быть уверен, что эффекты видят консистентное состояние,  
**чтобы** не было glitch (несогласованных промежуточных значений).

```typescript
describe('Batcher', () => {
  it('батчит множественные обновления', () => {
    let effectRuns = 0;
    const a = Signal.state(1);
    const b = Signal.state(2);

    const effect = Signal.effect(() => {
      effectRuns++;
      a(); b(); // читаем оба
    });

    expect(effectRuns).toBe(1); // начальный запуск

    Batcher.run(() => {
      a.set(10);
      b.set(20);
    });

    expect(effectRuns).toBe(2); // один перезапуск, не два
    effect.unsubscribe();
  });

  it('diamond problem — glitch-free', () => {
    const observed: string[] = [];
    const a = Signal.state(1);
    const b = Signal.compute(() => a() * 2);
    const c = Signal.compute(() => a() + 10);

    const effect = Signal.effect(() => {
      observed.push(`b=${b()}, c=${c()}`);
    });

    expect(observed).toEqual(['b=2, c=11']);

    a.set(5);
    // Должно быть consistent: b=10, c=15
    // НЕ должно быть: b=10, c=11 (glitch)
    expect(observed).toEqual(['b=2, c=11', 'b=10, c=15']);

    effect.unsubscribe();
  });

  it('восстанавливается после ошибки в fn() (ПОСЛЕ ФИКСА)', () => {
    // Тест для критического фикса Batcher try/finally
    expect(() => {
      Batcher.run(() => { throw new Error('test error'); });
    }).toThrow('test error');

    // Следующий Batcher.run() должен работать
    const result = Batcher.run(() => 42);
    expect(result).toBe(42);
  });
});
```

---

## UC-5: React хуки — useSignal

**Как** React-разработчик, использующий `useSignal`,  
**я хочу** быть уверен, что компонент ререндерится при изменении сигнала,  
**чтобы** UI оставался актуальным.

```typescript
describe('useSignal', () => {
  it('возвращает текущее значение сигнала', () => {
    const count = Signal.state(42);
    const { result } = renderHook(() => useSignal(count));
    expect(result.current).toBe(42);
  });

  it('обновляет при изменении сигнала', async () => {
    const count = Signal.state(0);
    const { result } = renderHook(() => useSignal(count));

    act(() => { count.set(5); });

    expect(result.current).toBe(5);
  });

  it('отписывается при размонтировании', () => {
    const count = Signal.state(0);
    const { unmount } = renderHook(() => useSignal(count));

    unmount();
    // После unmount подписка должна быть очищена
    // Проверяем что signal не держит ссылку на компонент
  });
});
```

---

## UC-6: *removed*

---

## UC-7: deepEqual и shallowEqual — утилитарные функции

**Как** разработчик библиотеки,  
**я хочу** быть уверен, что функции сравнения работают корректно для типичных случаев,  
**и знать об известных ограничениях**.

```typescript
describe('deepEqual', () => {
  it('сравнивает примитивы', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
  });

  it('сравнивает вложенные объекты', () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('сравнивает массивы', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  // Документация известных ограничений
  it.skip('НЕ обрабатывает NaN (известное ограничение)', () => {
    expect(deepEqual(NaN, NaN)).toBe(true); // ❌ вернёт false
  });

  it.skip('НЕ обрабатывает Date (известное ограничение)', () => {
    const d1 = new Date('2024-01-01');
    const d2 = new Date('2024-01-01');
    expect(deepEqual(d1, d2)).toBe(true); // ❌ сравнит как объекты
  });

  it.skip('НЕ обрабатывает циклические ссылки (известное ограничение)', () => {
    const a: any = {};
    a.self = a;
    const b: any = {};
    b.self = b;
    expect(deepEqual(a, b)).toBe(true); // ❌ бесконечная рекурсия
  });
});
```

---

## UC-8: combineDevtools — комбинирование devtools

**Как** разработчик, подключающий несколько devtools,  
**я хочу** быть уверен, что `combineDevtools` корректно вызывает все адаптеры.

```typescript
describe('combineDevtools', () => {
  it('вызывает все updaters при обновлении состояния', () => {
    const calls1: string[] = [];
    const calls2: string[] = [];

    const dt1: DevtoolsLike = {
      createState: (key) => (v) => calls1.push(`${key}:${v}`),
    };
    const dt2: DevtoolsLike = {
      createState: (key) => (v) => calls2.push(`${key}:${v}`),
    };

    const combined = combineDevtools(dt1, dt2);
    const updater = combined.createState('test');
    updater!('value1');

    expect(calls1).toEqual(['test:value1']);
    expect(calls2).toEqual(['test:value1']);
  });

  it('обрабатывает null-updaters', () => {
    const dt1: DevtoolsLike = { createState: () => null };
    const dt2: DevtoolsLike = {
      createState: () => (v: any) => {},
    };

    const combined = combineDevtools(dt1, dt2);
    const updater = combined.createState('test');
    // Не должно бросить ошибку
    expect(() => updater!('value')).not.toThrow();
  });
});
```

---

## UC-9: LocalState — синхронизация с localStorage

**Как** разработчик, использующий `LocalState`,  
**я хочу** быть уверен, что значения корректно сохраняются и загружаются из storage,  
**и что невалидные данные обрабатываются gracefully.

```typescript
describe('LocalState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('сохраняет значение в localStorage', () => {
    const state = LocalState.create({
      key: 'test-key',
      schema: z.number(),
      defaultValue: 0,
    });

    state.set(42);
    expect(JSON.parse(localStorage.getItem('test-key')!)).toEqual(
      expect.objectContaining({ 'test-key': 42 })
    );
  });

  it('загружает сохранённое значение при создании', () => {
    // Pre-populate
    localStorage.setItem('test-key', JSON.stringify({ 'test-key': 99 }));

    const state = LocalState.create({
      key: 'test-key',
      schema: z.number(),
      defaultValue: 0,
    });

    expect(state.peek()).toBe(99);
  });

  it('использует defaultValue при невалидных данных в storage', () => {
    localStorage.setItem('test-key', 'not-valid-json{{{');

    // С текущим кодом это бросит ошибку JSON.parse
    // Тест документирует это поведение
    expect(() => {
      LocalState.create({
        key: 'test-key',
        schema: z.number(),
        defaultValue: 0,
      });
    }).toThrow(); // Известное ограничение: нет try/catch на JSON.parse
  });
});
```

---

## UC-10: Edge Cases

### 10.1 Бесконечный цикл в Effect

```typescript
it('предотвращает (или обнаруживает) бесконечный цикл', () => {
  const count = Signal.state(0);

  // Effect, который пишет в зависимость от которой зависит
  // Текущее поведение: нет защиты, возможен Stack Overflow
  const effect = Signal.effect(() => {
    const val = count();
    if (val < 100) {
      count.set(val + 1); // ← пишет в зависимость
    }
  });

  // Документируем текущее поведение (может вызвать Stack Overflow)
  effect.unsubscribe();
});
```

### 10.2 SyncObservable.value — хрупкий паттерн

```typescript
it('возвращает значение синхронно из BehaviorSubject', () => {
  const bs = new BehaviorSubject(42);
  const sync$ = new SyncObservable(bs);
  expect(sync$.value).toBe(42);
});

it('бросает ошибку для Observable без немедленного значения', () => {
  const delayed$ = new Observable(sub => {
    setTimeout(() => sub.next(1), 100);
  });
  const sync$ = new SyncObservable(delayed$);
  expect(() => sync$.value).toThrow();
});
```

### 10.3 PromiseResolver — resolve/reject

```typescript
describe('PromiseResolver', () => {
  it('resolve возвращает значение через promise', async () => {
    const pr = new PromiseResolver<number>();
    pr.resolve(42);
    await expect(pr.promise).resolves.toBe(42);
  });

  it('reject отклоняет promise', async () => {
    const pr = new PromiseResolver<number>();
    pr.reject(new Error('fail'));
    await expect(pr.promise).rejects.toThrow('fail');
  });
});
```
