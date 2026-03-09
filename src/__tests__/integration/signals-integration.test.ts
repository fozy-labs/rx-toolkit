import { describe, it, expect } from 'vitest';
import { Signal, State, Effect } from '@/signals/signals';
import { Batcher } from '@/signals/base/Batcher';

describe('Signals Integration', () => {

    describe('Diamond problem', () => {
        it('Effect sees consistent state when A changes', () => {
            const a = Signal.state(1);
            const b = Signal.compute(() => a() * 2);
            const c = Signal.compute(() => a() + 10);

            const results: number[] = [];
            const effect = Signal.effect(() => {
                results.push(b() + c());
            });

            // Initial: b=2, c=11, sum=13
            expect(results).toEqual([13]);

            a.set(2); // b=4, c=12, sum=16
            expect(results).toEqual([13, 16]);

            a.set(5); // b=10, c=15, sum=25
            expect(results).toEqual([13, 16, 25]);

            effect.unsubscribe();
        });

        it('never observes inconsistent intermediate states across many updates', () => {
            const a = Signal.state(0);
            const b = Signal.compute(() => a() * 2);
            const c = Signal.compute(() => a() + 10);

            const inconsistencies: string[] = [];
            const effect = Signal.effect(() => {
                const aVal = a();
                const bVal = b();
                const cVal = c();

                if (bVal !== aVal * 2) inconsistencies.push(`b=${bVal}, expected ${aVal * 2}`);
                if (cVal !== aVal + 10) inconsistencies.push(`c=${cVal}, expected ${aVal + 10}`);
            });

            for (let i = 1; i <= 20; i++) {
                a.set(i);
            }

            expect(inconsistencies).toEqual([]);
            effect.unsubscribe();
        });
    });

    describe('Deep chain', () => {
        it('value propagates through State → C1 → C2 → C3 → Effect', () => {
            const state = Signal.state(1);
            const c1 = Signal.compute(() => state() + 1);
            const c2 = Signal.compute(() => c1() * 2);
            const c3 = Signal.compute(() => c2() + 100);

            const results: number[] = [];
            const effect = Signal.effect(() => {
                results.push(c3());
            });

            // Initial: 1→2→4→104
            expect(results).toEqual([104]);

            state.set(5); // 5→6→12→112
            expect(results).toEqual([104, 112]);

            state.set(10); // 10→11→22→122
            expect(results).toEqual([104, 112, 122]);

            effect.unsubscribe();
        });
    });

    describe('Multi-signal batching', () => {
        it('effect re-runs exactly once when multiple signals change in batch', () => {
            const s1 = Signal.state(0);
            const s2 = Signal.state(0);
            const s3 = Signal.state(0);

            let runCount = 0;
            const effect = Signal.effect(() => {
                s1(); s2(); s3();
                runCount++;
            });

            expect(runCount).toBe(1); // Initial run

            Batcher.run(() => {
                s1.set(1);
                s2.set(2);
                s3.set(3);
            });

            expect(runCount).toBe(2); // Only one re-run
            effect.unsubscribe();
        });
    });

    describe('Error recovery in batch', () => {
        it('system recovers after error inside Batcher.run()', () => {
            const s = Signal.state(0);

            expect(() => {
                Batcher.run(() => {
                    s.set(1);
                    throw new Error('batch error');
                });
            }).toThrow('batch error');

            // System should recover — new effects and batches work
            const results: number[] = [];
            const effect = Signal.effect(() => {
                results.push(s());
            });

            // s was set to 1 before the error
            expect(results).toEqual([1]);

            s.set(42);
            expect(results).toEqual([1, 42]);

            effect.unsubscribe();
        });
    });

    describe('Computed peek → subscribe → peek transition', () => {
        it('peek returns correct values while subscribed and after state changes', () => {
            const state = Signal.state(5);
            const computed = Signal.compute(() => state() * 3);

            // Subscribe via effect (primes the Computed's internal state)
            const results: number[] = [];
            const effect = Signal.effect(() => {
                results.push(computed());
            });

            expect(results).toEqual([15]);
            expect(computed.peek()).toBe(15);

            state.set(10);
            expect(computed.peek()).toBe(30);
            expect(results).toEqual([15, 30]);

            state.set(20);
            expect(computed.peek()).toBe(60);
            expect(results).toEqual([15, 30, 60]);

            effect.unsubscribe();
        });
    });

    describe('Effect teardown chain', () => {
        it('teardown runs on each dependency update in correct order', () => {
            const state = Signal.state(0);
            const teardowns: number[] = [];

            const effect = Signal.effect(() => {
                const value = state();
                return () => {
                    teardowns.push(value);
                };
            });

            // No teardown yet — first run
            expect(teardowns).toEqual([]);

            state.set(1); // Teardown from value=0
            expect(teardowns).toEqual([0]);

            state.set(2); // Teardown from value=1
            expect(teardowns).toEqual([0, 1]);

            state.set(3); // Teardown from value=2
            expect(teardowns).toEqual([0, 1, 2]);

            effect.unsubscribe(); // Final teardown from value=3
            expect(teardowns).toEqual([0, 1, 2, 3]);
        });
    });

    describe('Dynamic dependencies', () => {
        it('effect switches subscriptions when flag changes', () => {
            const flag = Signal.state(true);
            const a = Signal.state('A1');
            const b = Signal.state('B1');

            const results: string[] = [];
            const effect = Signal.effect(() => {
                if (flag()) {
                    results.push(`a:${a()}`);
                } else {
                    results.push(`b:${b()}`);
                }
            });

            expect(results).toEqual(['a:A1']);

            a.set('A2');
            expect(results).toEqual(['a:A1', 'a:A2']);

            // Switch to B
            flag.set(false);
            expect(results).toEqual(['a:A1', 'a:A2', 'b:B1']);

            // A changes should NOT trigger effect anymore
            a.set('A3');
            expect(results).toEqual(['a:A1', 'a:A2', 'b:B1']);

            // B changes should trigger effect
            b.set('B2');
            expect(results).toEqual(['a:A1', 'a:A2', 'b:B1', 'b:B2']);

            effect.unsubscribe();
        });
    });

});
