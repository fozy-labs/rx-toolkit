import { Worker } from 'worker_threads';
import { cpus } from 'os';
import type { WorkerBenchmarkTask, WorkerBenchmarkResult, MemoryStats } from './worker-benchmark.js';

export interface BenchmarkResult {
  name: string;
  // Агрегированные метрики из всех прогонов
  opsPerSec: number;
  opsPerSecStdDev: number;
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
  // Статистика по прогонам
  runs: number;
  // Память
  avgMemoryDelta: MemoryStats;
  maxMemoryDelta: MemoryStats;
  // Все результаты прогонов
  allRuns: WorkerBenchmarkResult[];
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  totalTime: number;
}

export interface BenchmarkOptions {
  time?: number;
  iterations?: number;
  warmupIterations?: number;
  runs?: number; // Количество прогонов каждого теста
  maxWorkers?: number; // Максимальное количество воркеров (только если useWorkers=true)
  randomizeOrder?: boolean; // Случайный порядок выполнения
  useWorkers?: boolean; // Использовать worker threads (по умолчанию false из-за ограничений с импортами)
}

interface BenchmarkTask {
  name: string;
  fn: () => void | Promise<void>;
}

export class BenchmarkRunner {
  private suiteName: string;
  private tasks: BenchmarkTask[] = [];
  private options: Required<BenchmarkOptions>;

  constructor(suiteName: string, options: BenchmarkOptions = {}) {
    this.suiteName = suiteName;
    this.options = {
      time: options.time ?? 1500,
      iterations: options.iterations ?? 8,
      warmupIterations: options.warmupIterations ?? 10,
      runs: options.runs ?? 5,
      maxWorkers: options.maxWorkers ?? Math.min(cpus().length, 4),
      randomizeOrder: options.randomizeOrder ?? true,
      useWorkers: options.useWorkers ?? false, // По умолчанию false
    };
  }

  add(name: string, fn: () => void | Promise<void>): this {
    this.tasks.push({ name, fn });
    return this;
  }

  async run(): Promise<BenchmarkSuite> {
    console.log(`\n🏃 Запуск бенчмарка: ${this.suiteName}`);
    console.log(`   Прогонов: ${this.options.runs} | Итераций: ${this.options.iterations}${this.options.useWorkers ? ` | Воркеров: ${this.options.maxWorkers}` : ''}\n`);

    const startTime = Date.now();

    // Создаем задачи для всех прогонов
    const allTasks: Array<{ task: BenchmarkTask; runId: number }> = [];
    for (let runId = 0; runId < this.options.runs; runId++) {
      for (const task of this.tasks) {
        allTasks.push({ task, runId });
      }
    }

    // Случайный порядок для уменьшения систематических ошибок
    if (this.options.randomizeOrder) {
      this.shuffleArray(allTasks);
    }

    // Запускаем задачи
    const workerResults = this.options.useWorkers
      ? await this.runWithWorkerPool(allTasks)
      : await this.runDirectly(allTasks);

    // Агрегируем результаты
    const results = this.aggregateResults(workerResults);

    const totalTime = Date.now() - startTime;

    this.printResults(results, totalTime);

    return {
      name: this.suiteName,
      results,
      totalTime,
    };
  }

  private async runDirectly(
    allTasks: Array<{ task: BenchmarkTask; runId: number }>
  ): Promise<WorkerBenchmarkResult[]> {
    const { Bench } = await import('tinybench');
    const results: WorkerBenchmarkResult[] = [];
    let completed = 0;
    const total = allTasks.length;

    for (const item of allTasks) {
      // Агрессивный GC перед тестом для чистоты измерений
      if (global.gc) {
        for (let i = 0; i < 3; i++) {
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      // Пауза для стабилизации
      await new Promise(resolve => setTimeout(resolve, 250));

      const memoryBefore = this.getMemoryStats();

      const bench = new Bench({
        time: this.options.time,
        iterations: this.options.iterations,
        warmupIterations: this.options.warmupIterations,
      });

      bench.add(item.task.name, item.task.fn);
      await bench.warmup();
      await bench.run();

      const result = bench.tasks[0].result;
      const samples = result?.samples || [];
      const sortedSamples = [...samples].sort((a, b) => a - b);

      // Пауза и GC для точного замера памяти
      await new Promise(resolve => setTimeout(resolve, 150));
      if (global.gc) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const memoryAfter = this.getMemoryStats();

      results.push({
        name: item.task.name,
        opsPerSec: result?.hz || 0,
        margin: result?.rme || 0,
        samples: samples.length,
        mean: result?.mean || 0,
        median: sortedSamples[Math.floor(sortedSamples.length / 2)] || 0,
        variance: result?.variance || 0,
        sd: result?.sd || 0,
        min: sortedSamples[0] || 0,
        max: sortedSamples[sortedSamples.length - 1] || 0,
        p75: this.percentile(samples, 75),
        p99: this.percentile(samples, 99),
        p995: this.percentile(samples, 99.5),
        p999: this.percentile(samples, 99.9),
        runId: item.runId,
        memoryBefore,
        memoryAfter,
        memoryDelta: this.calculateMemoryDelta(memoryBefore, memoryAfter),
      });

      completed++;
      const progress = ((completed / total) * 100).toFixed(1);
      process.stdout.write(`\r   Прогресс: ${completed}/${total} (${progress}%) - ${item.task.name} [прогон ${item.runId + 1}]`);
    }

    console.log(); // Новая строка после прогресса
    return results;
  }

  private getMemoryStats(): MemoryStats {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
    };
  }

  private calculateMemoryDelta(before: MemoryStats, after: MemoryStats): MemoryStats {
    return {
      heapUsed: after.heapUsed - before.heapUsed,
      heapTotal: after.heapTotal - before.heapTotal,
      external: after.external - before.external,
      arrayBuffers: after.arrayBuffers - before.arrayBuffers,
      rss: after.rss - before.rss,
    };
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (lower === upper) return sorted[lower];
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  private async runWithWorkerPool(
    allTasks: Array<{ task: BenchmarkTask; runId: number }>
  ): Promise<WorkerBenchmarkResult[]> {
    const results: WorkerBenchmarkResult[] = [];
    const queue = [...allTasks];
    const activeWorkers = new Set<Worker>();

    let completed = 0;
    const total = allTasks.length;

    return new Promise((resolve) => {
      const startNextTask = () => {
        if (queue.length === 0 && activeWorkers.size === 0) {
          resolve(results);
          return;
        }

        while (queue.length > 0 && activeWorkers.size < this.options.maxWorkers) {
          const item = queue.shift()!;
          const worker = this.createWorker(item.task, item.runId);

          activeWorkers.add(worker);

          worker.on('message', (message: { success: boolean; result?: WorkerBenchmarkResult; error?: string }) => {
            if (message.success && message.result) {
              results.push(message.result);
              completed++;

              const progress = ((completed / total) * 100).toFixed(1);
              process.stdout.write(`\r   Прогресс: ${completed}/${total} (${progress}%) - ${item.task.name} [прогон ${item.runId + 1}]`);
            } else {
              console.error(`\n❌ Ошибка в ${item.task.name}: ${message.error}`);
            }

            activeWorkers.delete(worker);
            worker.terminate();
            startNextTask();
          });

          worker.on('error', (error) => {
            console.error(`\n❌ Worker error в ${item.task.name}:`, error);
            activeWorkers.delete(worker);
            worker.terminate();
            startNextTask();
          });

          worker.on('exit', (code) => {
            if (code !== 0 && activeWorkers.has(worker)) {
              console.error(`\n❌ Worker stopped with exit code ${code}`);
              activeWorkers.delete(worker);
              startNextTask();
            }
          });
        }
      };

      startNextTask();
    });
  }

  private createWorker(task: BenchmarkTask, runId: number): Worker {
    const workerTask: WorkerBenchmarkTask = {
      suiteName: this.suiteName,
      benchmarkName: task.name,
      fnString: task.fn.toString(), // Конвертируем функцию в строку
      iterations: this.options.iterations,
      warmupIterations: this.options.warmupIterations,
      time: this.options.time,
      runId,
    };

    // Создаем воркер для изолированного выполнения теста
    return new Worker(
      new URL('./worker-benchmark.js', import.meta.url),
      {
        workerData: workerTask,
      }
    );
  }

  private aggregateResults(workerResults: WorkerBenchmarkResult[]): BenchmarkResult[] {
    // Группируем по имени теста
    const grouped = new Map<string, WorkerBenchmarkResult[]>();

    for (const result of workerResults) {
      if (!grouped.has(result.name)) {
        grouped.set(result.name, []);
      }
      grouped.get(result.name)!.push(result);
    }

    // Агрегируем статистику для каждого теста
    const aggregated: BenchmarkResult[] = [];

    for (const [name, runs] of grouped) {
      const opsPerSecValues = runs.map(r => r.opsPerSec);
      const meanOps = this.mean(opsPerSecValues);
      const stdDevOps = this.stdDev(opsPerSecValues);

      // Объединяем все сэмплы (безопасно)
      const allSamples = runs.flatMap(r => {
        const count = Math.min(r.samples || 0, 10000); // Ограничение для предотвращения переполнения
        return Array(count).fill(r.mean);
      });

      aggregated.push({
        name,
        opsPerSec: meanOps,
        opsPerSecStdDev: stdDevOps,
        margin: (stdDevOps / meanOps) * 100,
        samples: allSamples.length,
        mean: this.mean(runs.map(r => r.mean)),
        median: this.mean(runs.map(r => r.median)),
        variance: this.mean(runs.map(r => r.variance)),
        sd: this.mean(runs.map(r => r.sd)),
        min: Math.min(...runs.map(r => r.min)),
        max: Math.max(...runs.map(r => r.max)),
        p75: this.mean(runs.map(r => r.p75)),
        p99: this.mean(runs.map(r => r.p99)),
        p995: this.mean(runs.map(r => r.p995)),
        p999: this.mean(runs.map(r => r.p999)),
        runs: runs.length,
        avgMemoryDelta: this.avgMemoryStats(runs.map(r => r.memoryDelta)),
        maxMemoryDelta: this.maxMemoryStats(runs.map(r => r.memoryDelta)),
        allRuns: runs,
      });
    }

    return aggregated;
  }

  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    const avg = this.mean(values);
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  private avgMemoryStats(stats: MemoryStats[]): MemoryStats {
    return {
      heapUsed: this.mean(stats.map(s => s.heapUsed)),
      heapTotal: this.mean(stats.map(s => s.heapTotal)),
      external: this.mean(stats.map(s => s.external)),
      arrayBuffers: this.mean(stats.map(s => s.arrayBuffers)),
      rss: this.mean(stats.map(s => s.rss)),
    };
  }

  private maxMemoryStats(stats: MemoryStats[]): MemoryStats {
    return {
      heapUsed: Math.max(...stats.map(s => s.heapUsed)),
      heapTotal: Math.max(...stats.map(s => s.heapTotal)),
      external: Math.max(...stats.map(s => s.external)),
      arrayBuffers: Math.max(...stats.map(s => s.arrayBuffers)),
      rss: Math.max(...stats.map(s => s.rss)),
    };
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private printResults(results: BenchmarkResult[], totalTime: number): void {
    console.log(`\n\n📊 Результаты: ${this.suiteName}`);
    console.log(`⏱️  Время выполнения: ${(totalTime / 1000).toFixed(2)}s\n`);
    console.log('═'.repeat(120));

    const sorted = results.sort((a, b) => b.opsPerSec - a.opsPerSec);
    const fastest = sorted[0];

    sorted.forEach((result, index) => {
      const isFirst = index === 0;
      const icon = isFirst ? '🏆' : '  ';
      const ratio = fastest.opsPerSec / result.opsPerSec;
      const ratioText = isFirst ? '' : ` (${ratio.toFixed(2)}x медленнее)`;

      console.log(`${icon} ${result.name.padEnd(45)}`);
      console.log(`   ${this.formatOps(result.opsPerSec)} ops/sec ±${result.opsPerSecStdDev.toFixed(2)} (${result.runs} прогонов)${ratioText}`);
      console.log(`   Время: min=${this.formatTime(result.min)} median=${this.formatTime(result.median)} max=${this.formatTime(result.max)}`);
      console.log(`   Процентили: p75=${this.formatTime(result.p75)} p99=${this.formatTime(result.p99)} p999=${this.formatTime(result.p999)}`);
      console.log(`   Память (avg): heap=${this.formatBytes(result.avgMemoryDelta.heapUsed)} rss=${this.formatBytes(result.avgMemoryDelta.rss)}`);
      console.log(`   Память (max): heap=${this.formatBytes(result.maxMemoryDelta.heapUsed)} rss=${this.formatBytes(result.maxMemoryDelta.rss)}`);
      console.log('─'.repeat(120));
    });

    console.log('═'.repeat(120));
    console.log();
  }

  private formatOps(ops: number): string {
    if (ops >= 1_000_000_000) {
      return `${(ops / 1_000_000_000).toFixed(2)}B`.padStart(12);
    } else if (ops >= 1_000_000) {
      return `${(ops / 1_000_000).toFixed(2)}M`.padStart(12);
    } else if (ops >= 1_000) {
      return `${(ops / 1_000).toFixed(2)}K`.padStart(12);
    }
    return ops.toFixed(2).padStart(12);
  }

  private formatTime(time: number): string {
    // time в секундах (от tinybench), конвертируем в удобный формат
    if (!isFinite(time) || time <= 0) {
      return '0.00ns';
    }

    // Конвертируем в наносекунды для точного определения единицы
    const ns = time * 1_000_000_000;

    if (ns < 1000) {
      return `${ns.toFixed(2)}ns`;
    }

    // Микросекунды
    const us = ns / 1000;
    if (us < 1000) {
      return `${us.toFixed(2)}µs`;
    }

    // Миллисекунды
    const ms = us / 1000;
    if (ms < 1000) {
      return `${ms.toFixed(2)}ms`;
    }

    // Секунды
    const s = ms / 1000;
    return `${s.toFixed(2)}s`;
  }

  private formatBytes(bytes: number): string {
    const abs = Math.abs(bytes);
    const sign = bytes < 0 ? '-' : '+';

    if (abs >= 1024 * 1024) {
      return `${sign}${(abs / (1024 * 1024)).toFixed(2)}MB`;
    } else if (abs >= 1024) {
      return `${sign}${(abs / 1024).toFixed(2)}KB`;
    }
    return `${sign}${abs.toFixed(0)}B`;
  }
}

export function createBenchmark(name: string, options?: BenchmarkOptions): BenchmarkRunner {
  return new BenchmarkRunner(name, options);
}

