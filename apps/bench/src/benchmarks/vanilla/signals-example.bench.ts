import { Signal, Computed } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

/**
 * Пример использования улучшенной системы бенчмарков с:
 * - Множественными прогонами (по умолчанию 3)
 * - Многопоточным выполнением (worker threads)
 * - Замерами памяти
 * - Детальной статистикой (процентили, стандартное отклонение)
 * - Случайным порядком выполнения для уменьшения систематических ошибок
 */

export async function runSignalBench() {
  // 1. Создание и базовые операции с расширенными настройками
  await createBenchmark('Signals: Создание', {
    runs: 5,              // 5 прогонов каждого теста
    iterations: 100,      // 100 итераций в каждом прогоне
    warmupIterations: 10, // 10 прогревочных итераций
    time: 1000,          // минимум 1 секунда на тест
    maxWorkers: 4,       // максимум 4 воркера параллельно
    randomizeOrder: true // случайный порядок для устранения систематических ошибок
  })
    .add('rx-toolkit Signal - создание', () => {
      const signal = new Signal(0);
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - создание с devtools', () => {
      const signal = new Signal(0, 'counter');
      signal.unsubscribe();
    })
    .run();

  // 2. Чтение значений (можно использовать дефолтные настройки: 3 прогона)
  await createBenchmark('Signals: Чтение значений')
    .add('rx-toolkit Signal - get value', () => {
      const signal = new Signal(42);
      const value = signal.value;
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - peek', () => {
      const signal = new Signal(42);
      const value = signal.peek();
      signal.unsubscribe();
    })
    .run();

  // 3. Запись значений
  await createBenchmark('Signals: Запись значений')
    .add('rx-toolkit Signal - set value', () => {
      const signal = new Signal(0);
      signal.value = 1;
      signal.unsubscribe();
    })
    .add('rx-toolkit Signal - next', () => {
      const signal = new Signal(0);
      signal.next(1);
      signal.unsubscribe();
    })
    .run();

  // 4. Computed signals
  await createBenchmark('Signals: Computed')
    .add('rx-toolkit Computed - создание', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .add('rx-toolkit Computed - чтение', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      const value = sum.value;
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .add('rx-toolkit Computed - обновление зависимости', () => {
      const a = new Signal(1);
      const b = new Signal(2);
      const sum = new Computed(() => a.value + b.value);
      a.value = 10;
      const value = sum.value;
      sum.unsubscribe();
      a.unsubscribe();
      b.unsubscribe();
    })
    .run();

  // 5. Цепочка computed - тест памяти с большим количеством прогонов
  await createBenchmark('Signals: Цепочка Computed (5 уровней)', {
    runs: 10,  // Больше прогонов для проверки утечек памяти
  })
    .add('rx-toolkit - создание цепочки', () => {
      const s = new Signal(1);
      const c1 = new Computed(() => s.value * 2);
      const c2 = new Computed(() => c1.value * 2);
      const c3 = new Computed(() => c2.value * 2);
      const c4 = new Computed(() => c3.value * 2);
      const c5 = new Computed(() => c4.value * 2);

      c5.unsubscribe();
      c4.unsubscribe();
      c3.unsubscribe();
      c2.unsubscribe();
      c1.unsubscribe();
      s.unsubscribe();
    })
    .add('rx-toolkit - обновление через цепочку', () => {
      const s = new Signal(1);
      const c1 = new Computed(() => s.value * 2);
      const c2 = new Computed(() => c1.value * 2);
      const c3 = new Computed(() => c2.value * 2);
      const c4 = new Computed(() => c3.value * 2);
      const c5 = new Computed(() => c4.value * 2);

      s.value = 2;
      const result = c5.value; // Trigger all recomputations

      c5.unsubscribe();
      c4.unsubscribe();
      c3.unsubscribe();
      c2.unsubscribe();
      c1.unsubscribe();
      s.unsubscribe();
    })
    .run();

  // 6. Тест на массовые операции для проверки производительности и памяти
  await createBenchmark('Signals: Массовые операции (100 сигналов)', {
    runs: 3,
    iterations: 50,
  })
    .add('rx-toolkit - создание 100 сигналов', () => {
      const signals = Array.from({ length: 100 }, (_, i) => new Signal(i));
      signals.forEach(s => s.unsubscribe());
    })
    .add('rx-toolkit - создание и обновление 100 сигналов', () => {
      const signals = Array.from({ length: 100 }, (_, i) => new Signal(i));
      signals.forEach(s => s.value = s.value + 1);
      signals.forEach(s => s.unsubscribe());
    })
    .run();
}

/**
 * Результаты будут включать:
 *
 * - Операций в секунду (ops/sec) с стандартным отклонением
 * - Статистику времени выполнения (min, median, max)
 * - Процентили (p75, p99, p999) для определения выбросов
 * - Замеры памяти:
 *   - Средние изменения (avg): heap, rss
 *   - Максимальные изменения (max): heap, rss
 * - Количество прогонов
 * - Сравнение относительно самого быстрого теста
 *
 * Преимущества новой системы:
 *
 * 1. **Надежность**: Множественные прогоны уменьшают влияние случайных факторов
 * 2. **Скорость**: Параллельное выполнение на нескольких воркерах
 * 3. **Изоляция**: Каждый тест в отдельном worker thread - нет взаимного влияния
 * 4. **Память**: Автоматическая сборка мусора и замеры между тестами
 * 5. **Статистика**: Детальная информация для анализа производительности
 * 6. **Случайный порядок**: Устранение систематических ошибок
 */

