import '@/utils/node-setup';
import { Signal } from '@fozy-labs/rx-toolkit';

// Простой тест для проверки реальных значений времени
async function testTimeValues() {
  const { Bench } = await import('tinybench');

  const bench = new Bench({
    time: 100,
    iterations: 10,
  });

  bench.add('Simple Signal', () => {
    const s = new Signal(42);
    const v = s.value;
    s.unsubscribe();
  });

  await bench.warmup();
  await bench.run();

  const result = bench.tasks[0].result;
  const samples = result?.samples || [];

  console.log('=== РЕАЛЬНЫЕ ЗНАЧЕНИЯ ИЗ TINYBENCH ===\n');
  console.log('result.mean:', result?.mean);
  console.log('result.hz:', result?.hz);
  console.log('samples[0]:', samples[0]);
  console.log('samples (первые 5):', samples.slice(0, 5));
  console.log('\nВсе samples:', samples);

  console.log('\n=== ПРОВЕРКА ФОРМАТИРОВАНИЯ ===\n');

  const testTime = samples[0];
  console.log('Исходное время:', testTime);
  console.log('Это секунды?: ', testTime, 's');
  console.log('В наносекундах:', testTime * 1_000_000_000, 'ns');
  console.log('В микросекундах:', testTime * 1_000_000, 'µs');
  console.log('В миллисекундах:', testTime * 1_000, 'ms');
}

testTimeValues().catch(console.error);

