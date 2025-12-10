import '@/utils/node-setup';
import { runSignalBench } from './signals.bench';
import { runLazySignalBench } from './lazy-signals.bench';
import { runReduxBench } from './redux.bench';
import { runStoreComparisonBench } from './store-comparison.bench';
import { runQueryBench } from './query.bench';
import { runRtkQueryBench } from './rtk-query.bench';
import { runQueryComparisonBench } from './query-comparison.bench';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   RX-TOOLKIT VANILLA JS BENCHMARKS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log();

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  РАЗДЕЛ 1: РЕАКТИВНЫЕ СТОРЫ (SIGNALS)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n📦 Часть 1.1: Signals (обычные примитивы)');
    await runSignalBench();

    console.log('\n📦 Часть 1.2: LazySignals (ленивые примитивы)');
    await runLazySignalBench();

    console.log('\n📦 Часть 1.3: Redux Toolkit');
    await runReduxBench();

    console.log('\n📦 Часть 1.4: Сравнение всех подходов к управлению состоянием');
    await runStoreComparisonBench();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  РАЗДЕЛ 2: QUERY МЕНЕДЖЕРЫ');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log('\n📦 Часть 2.1: rx-toolkit Query (Resources & Operations)');
    await runQueryBench();

    console.log('\n📦 Часть 2.2: RTK Query');
    await runRtkQueryBench();

    console.log('\n📦 Часть 2.3: Сравнение Query менеджеров');
    await runQueryComparisonBench();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Все бенчмарки выполнены успешно!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('\n❌ Ошибка при выполнении бенчмарков:', error);
    process.exit(1);
  }
}

main();

