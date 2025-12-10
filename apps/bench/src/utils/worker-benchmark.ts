import { Bench } from 'tinybench';
import { parentPort, workerData } from 'worker_threads';

export interface WorkerBenchmarkTask {
  suiteName: string;
  benchmarkName: string;
  fnString: string; // Строка с кодом функции для передачи через workerData
  iterations: number;
  warmupIterations: number;
  time: number;
  runId: number;
}

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

export interface WorkerBenchmarkResult {
  name: string;
  opsPerSec: number;
  margin: number;
  samples: number;
  mean: number;
  median: number;
  variance: number;
  sd: number;
  min: number;
  max: number;
  p75: number;
  p99: number;
  p995: number;
  p999: number;
  runId: number;
  memoryBefore: MemoryStats;
  memoryAfter: MemoryStats;
  memoryDelta: MemoryStats;
}

// Функция для принудительной сборки мусора (опционально)
function forceGarbageCollection(): void {
  if (typeof global !== 'undefined' && global.gc) {
    // Запускаем несколько раз для полной очистки
    try {
      for (let i = 0; i < 3; i++) {
        global.gc();
      }
    } catch (e) {
      // Игнорируем ошибки, если gc недоступен
    }
  }
}

// Получение статистики памяти
function getMemoryStats(): MemoryStats {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss,
  };
}

// Вычисление дельты памяти
function calculateMemoryDelta(before: MemoryStats, after: MemoryStats): MemoryStats {
  return {
    heapUsed: after.heapUsed - before.heapUsed,
    heapTotal: after.heapTotal - before.heapTotal,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
    rss: after.rss - before.rss,
  };
}

// Вычисление процентилей
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Выполнение бенчмарка в worker thread
async function runWorkerBenchmark(task: WorkerBenchmarkTask): Promise<WorkerBenchmarkResult> {
  // Пауза перед началом для стабилизации
  await new Promise(resolve => setTimeout(resolve, 100));

  // Принудительная очистка памяти перед замером
  forceGarbageCollection();
  await new Promise(resolve => setTimeout(resolve, 50));

  const memoryBefore = getMemoryStats();

  const bench = new Bench({
    time: task.time,
    iterations: task.iterations,
    warmupIterations: task.warmupIterations,
  });

  // Воссоздаем функцию из строки
  const fn = eval(`(${task.fnString})`);
  bench.add(task.benchmarkName, fn);

  // Прогрев
  await bench.warmup();

  // Очистка после прогрева
  forceGarbageCollection();
  await new Promise(resolve => setTimeout(resolve, 50));

  // Основной запуск
  await bench.run();

  const result = bench.tasks[0].result;

  // Очистка перед замером памяти
  await new Promise(resolve => setTimeout(resolve, 50));
  forceGarbageCollection();
  await new Promise(resolve => setTimeout(resolve, 50));

  const memoryAfter = getMemoryStats();
  const memoryDelta = calculateMemoryDelta(memoryBefore, memoryAfter);

  // Получаем детальную статистику
  const samples = result?.samples || [];
  const sortedSamples = [...samples].sort((a, b) => a - b);

  return {
    name: task.benchmarkName,
    opsPerSec: result?.hz || 0,
    margin: result?.rme || 0,
    samples: samples.length,
    mean: result?.mean || 0,
    median: sortedSamples[Math.floor(sortedSamples.length / 2)] || 0,
    variance: result?.variance || 0,
    sd: result?.sd || 0,
    min: sortedSamples[0] || 0,
    max: sortedSamples[sortedSamples.length - 1] || 0,
    p75: percentile(samples, 75),
    p99: percentile(samples, 99),
    p995: percentile(samples, 99.5),
    p999: percentile(samples, 99.9),
    runId: task.runId,
    memoryBefore,
    memoryAfter,
    memoryDelta,
  };
}

// Worker thread entry point
if (parentPort && workerData) {
  runWorkerBenchmark(workerData as WorkerBenchmarkTask)
    .then(result => {
      parentPort!.postMessage({ success: true, result });
    })
    .catch(error => {
      parentPort!.postMessage({
        success: false,
        error: error.message,
        stack: error.stack
      });
    });
}

