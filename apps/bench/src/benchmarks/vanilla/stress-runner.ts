import '@/utils/node-setup';
import { runSignalsStressBench } from './signals-stress.bench.ts';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                   RX-TOOLKIT VANILLA JS BENCHMARKS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log();

  try {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  РАЗДЕЛ 1: Signals Stress Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await runSignalsStressBench();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Все бенчмарки выполнены успешно!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (error) {
    console.error('\n❌ Ошибка при выполнении бенчмарков:', error);
    process.exit(1);
  }
}

main();

