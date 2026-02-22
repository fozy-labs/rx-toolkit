import { Computed, Effect, Signal, } from '@fozy-labs/rx-toolkit';
import { createBenchmark } from '@/utils/benchmark';

export async function runSignalsStressBench() {
    console.log('\n📊 Стресс-тесты для сигналов (Computed Hell)\n');

    // 1. Computed Hell - простая цепочка (глубина 100)
    await createBenchmark('Computed Hell: Простая цепочка (глубина 100)')
        .add('Signal + Computed + Effect', () => {
            const source = Signal.state(0);

            // Создаем цепочку из 100 computed
            let current: ReturnType<typeof Signal.state<number>> | ReturnType<typeof Computed.create<number>> = source;
            const computeds: ReturnType<typeof Computed.create<number>>[] = [];

            for (let i = 0; i < 100; i++) {
                const prev = current;
                const computed = Computed.create(() => prev() + 1);
                computeds.push(computed);
                current = computed;
            }

            // Подписываемся через Effect
            let callCount = 0;
            const sub = new Effect(() => {
                callCount = current();
            });

            // Обновляем источник 50 раз
            for (let i = 0; i < 50; i++) {
                source.set(i);
            }

            sub.unsubscribe();
        })
        .run();

    // 2. Computed Hell - Diamond pattern (1 -> 10 -> 100 -> 10 -> 1)
    await createBenchmark('Computed Hell: Diamond pattern (1→10→100→10→1)')
        .add('Signal + Computed + Effect', () => {
            const source = Signal.state(0);

            // Слой 1: 10 computed от источника
            const layer1 = Array.from({ length: 10 }, () =>
                Computed.create(() => source() * 2)
            );

            // Слой 2: 100 computed (по 10 от каждого из layer1)
            const layer2 = layer1.flatMap(parent =>
                Array.from({ length: 10 }, () =>
                    Computed.create(() => parent() + 1)
                )
            );

            // Слой 3: 10 computed (каждый читает 10 из layer2)
            const layer3 = Array.from({ length: 10 }, (_, i) =>
                Computed.create(() => {
                    let sum = 0;
                    for (let j = 0; j < 10; j++) {
                        sum += layer2[i * 10 + j]();
                    }
                    return sum;
                })
            );

            // Финальный computed
            const final = Computed.create(() => {
                let sum = 0;
                for (const c of layer3) {
                    sum += c();
                }
                return sum;
            });

            let callCount = 0;
            const effect = new Effect(() => {
                callCount = final();
            });

            // Обновляем источник 20 раз
            for (let i = 0; i < 20; i++) {
                source.set(i);
            }

            effect.unsubscribe();
        })
        .run();

    // 3. Computed Hell - Grid pattern (10x10 матрица с зависимостями)
    await createBenchmark('Computed Hell: Grid 10x10 (100 взаимосвязанных computed)')
        .add('Signal + Computed + Effect', () => {
            const size = 10;
            const sources = Array.from({ length: size }, () => Signal.state(0));

            // Создаем матрицу computed, где каждый зависит от соседей
            const grid: ReturnType<typeof Computed.create<number>>[][] = [];

            for (let i = 0; i < size; i++) {
                grid[i] = [];
                for (let j = 0; j < size; j++) {
                    if (i === 0 && j === 0) {
                        grid[i][j] = Computed.create(() => sources[0]());
                    } else if (i === 0) {
                        grid[i][j] = Computed.create(() => grid[i][j - 1]() + 1);
                    } else if (j === 0) {
                        grid[i][j] = Computed.create(() => grid[i - 1][j]() + sources[i]());
                    } else {
                        grid[i][j] = Computed.create(() =>
                            grid[i - 1][j]() + grid[i][j - 1]()
                        );
                    }
                }
            }

            // Финальное значение - сумма последней строки
            const final = Computed.create(() => {
                let sum = 0;
                for (let j = 0; j < size; j++) {
                    sum += grid[size - 1][j]();
                }
                return sum;
            });

            let callCount = 0;
            const effect = new Effect(() => {
                callCount = final();
            });

            // Обновляем первый источник 30 раз
            for (let i = 0; i < 30; i++) {
                sources[0].set(i);
            }

            effect.unsubscribe();
        })
        .run();

    // 4. Computed Hell - Wide dependencies (1 источник -> 200 computed)
    await createBenchmark('Computed Hell: Wide (1 источник → 200 computed → 1 финал)')
        .add('Signal + Computed + Effect', () => {
            const source = Signal.state(0);

            // 200 computed от одного источника
            const computeds = Array.from({ length: 200 }, (_, i) =>
                Computed.create(() => source() * (i + 1))
            );

            // Финальный computed суммирует все
            const final = Computed.create(() => {
                let sum = 0;
                for (const c of computeds) {
                    sum += c();
                }
                return sum;
            });

            let callCount = 0;
            const effect = new Effect(() => {
                callCount = final();
            });

            // Обновляем источник 50 раз
            for (let i = 0; i < 50; i++) {
                source.set(i);
            }

            effect.unsubscribe();
        })
        .run();

    // 5. Computed Hell - Multiple sources (10 источников, 100 computed зависят от случайных)
    await createBenchmark('Computed Hell: Multiple sources (10 источников, 100 mixed computed)')
        .add('Signal + Computed + Effect', () => {
            const sources = Array.from({ length: 10 }, () => Signal.state(0));

            // 100 computed с случайными зависимостями от источников
            const computeds = Array.from({ length: 100 }, (_, i) => {
                const idx1 = i % 10;
                const idx2 = (i + 1) % 10;
                return Computed.create(() => sources[idx1]() + sources[idx2]());
            });

            // Финальный computed
            const final = Computed.create(() => {
                let sum = 0;
                for (const c of computeds) {
                    sum += c();
                }
                return sum / computeds.length;
            });

            let callCount = 0;
            const effect = new Effect(() => {
                callCount = final();
            });

            // Обновляем все источники по 10 раз
            for (let i = 0; i < 10; i++) {
                for (let j = 0; j < 10; j++) {
                    sources[j].set(i);
                }
            }

            effect.unsubscribe();
        })
        .run();

    // 6. Computed Hell - Extreme (глубокая цепочка 150)
    await createBenchmark('Computed Hell: Extreme chain (глубина 150)')
        .add('Signal + Computed + Effect', () => {
            const source = Signal.state(0);

            // Создаем цепочку из 150 computed
            let current: ReturnType<typeof Signal.state<number>> | ReturnType<typeof Computed.create<number>> = source;
            const computeds: ReturnType<typeof Computed.create<number>>[] = [];

            for (let i = 0; i < 150; i++) {
                const prev = current;
                const computed = Computed.create(() => prev() + 1);
                computeds.push(computed);
                current = computed;
            }

            // Подписываемся через Effect
            let callCount = 0;
            const effect = new Effect(() => {
                callCount = current();
            });

            // Обновляем источник 10 раз
            for (let i = 0; i < 10; i++) {
                source.set(i);
            }

            effect.unsubscribe();
        })
        .run();
}

