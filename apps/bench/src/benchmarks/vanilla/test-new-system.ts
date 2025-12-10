import '@/utils/node-setup';
import { Signal, Computed } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║           ТЕСТ НОВОЙ СИСТЕМЫ БЕНЧМАРКОВ RX-TOOLKIT                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('✨ Особенности:');
  console.log('   • Многопоточное выполнение (worker threads)');
  console.log('   • Множественные прогоны (по умолчанию 3)');
  console.log('   • Замеры памяти (heap, rss)');
  console.log('   • Детальная статистика (процентили, std dev)');
  console.log('   • Случайный порядок для устранения систематических ошибок');
  console.log();

  try {
    // Простой тест для проверки работы системы
    await createBenchmark('Проверка работы системы', {
      runs: 3,
      iterations: 50,
      warmupIterations: 5,
      time: 500,
      maxWorkers: 2,
    })
      .add('Signal - создание', () => {
        const signal = new Signal(0);
        signal.unsubscribe();
      })
      .add('Signal - чтение', () => {
        const signal = new Signal(42);
        const value = signal.value;
        signal.unsubscribe();
      })
      .add('Signal - запись', () => {
        const signal = new Signal(0);
        signal.value = 1;
        signal.unsubscribe();
      })
      .run();

    // Тест Computed
    await createBenchmark('Computed Signals', {
      runs: 3,
      iterations: 50,
    })
      .add('Computed - создание', () => {
        const a = new Signal(1);
        const b = new Signal(2);
        const sum = new Computed(() => a.value + b.value);
        sum.unsubscribe();
        a.unsubscribe();
        b.unsubscribe();
      })
      .add('Computed - обновление', () => {
        const a = new Signal(1);
        const b = new Signal(2);
        const sum = new Computed(() => a.value + b.value);
        a.value = 10;
        const result = sum.value;
        sum.unsubscribe();
        a.unsubscribe();
        b.unsubscribe();
      })
      .run();

    // Тест на память с большим количеством прогонов
    await createBenchmark('Проверка памяти (10 прогонов)', {
      runs: 10,
      iterations: 30,
    })
      .add('Цепочка из 5 Computed', () => {
        const s = new Signal(1);
        const c1 = new Computed(() => s.value * 2);
        const c2 = new Computed(() => c1.value * 2);
        const c3 = new Computed(() => c2.value * 2);
        const c4 = new Computed(() => c3.value * 2);
        const c5 = new Computed(() => c4.value * 2);

        s.value = 2;
        const result = c5.value;

        c5.unsubscribe();
        c4.unsubscribe();
        c3.unsubscribe();
        c2.unsubscribe();
        c1.unsubscribe();
        s.unsubscribe();
      })
      .run();

    console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ ВСЕ ТЕСТЫ ВЫПОЛНЕНЫ УСПЕШНО!                                        ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════╝');
    console.log('\n📚 Подробнее см. BENCHMARK_GUIDE.md');
  } catch (error) {
    console.error('\n❌ Ошибка при выполнении тестов:', error);
    process.exit(1);
  }
}

main();

