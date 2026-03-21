import { BehaviorSubject } from "rxjs";

import { Effect, LocalSignal, LocalState, Signal, State } from "@/signals/signals";

// TODO(v0.6.0): remove deprecated API test

describe("Deprecated API compatibility", () => {
    describe("Signal constructor (deprecated) vs State constructor", () => {
        // TODO(v0.6.0): remove deprecated API test
        it("Signal and State instances behave identically", () => {
            const signal = new Signal(10);
            const state = new State(10);

            expect(signal.peek()).toBe(10);
            expect(state.peek()).toBe(10);

            signal.set(20);
            state.set(20);

            expect(signal.peek()).toBe(20);
            expect(state.peek()).toBe(20);

            expect(signal.get()).toBe(20);
            expect(state.get()).toBe(20);

            expect(signal.obs).toBeDefined();
            expect(state.obs).toBeDefined();
        });
    });

    describe("Signal.create() (deprecated) vs Signal.state()", () => {
        // TODO(v0.6.0): remove deprecated API test
        it("both return identical SignalFn", () => {
            const created = Signal.create(1);
            const stated = Signal.state(1);

            expect(typeof created).toBe("function");
            expect(typeof stated).toBe("function");

            expect(created()).toBe(1);
            expect(stated()).toBe(1);

            created.set(5);
            stated.set(5);

            expect(created()).toBe(5);
            expect(stated()).toBe(5);

            expect(created.peek()).toBe(5);
            expect(stated.peek()).toBe(5);
        });
    });

    describe("Effect.complete() (deprecated) vs Effect.unsubscribe()", () => {
        // TODO(v0.6.0): remove deprecated API test
        it("both stop the effect and set closed=true", () => {
            const s = Signal.state(0);
            let count1 = 0;
            let count2 = 0;

            const e1 = Signal.effect(() => {
                s();
                count1++;
            });
            const e2 = Signal.effect(() => {
                s();
                count2++;
            });

            expect(count1).toBe(1);
            expect(count2).toBe(1);

            e1.complete(); // deprecated
            e2.unsubscribe(); // current

            s.set(1);

            // Neither should re-run
            expect(count1).toBe(1);
            expect(count2).toBe(1);

            expect(e1.closed).toBe(true);
            expect(e2.closed).toBe(true);
        });
    });

    describe("LocalSignal (deprecated) vs LocalState", () => {
        // TODO(v0.6.0): remove deprecated API test
        it("LocalSignal is the same reference as LocalState", () => {
            expect(LocalSignal).toBe(LocalState);
        });
    });

    describe("validator$ (deprecated) vs checkEffect in LocalState", () => {
        // TODO(v0.6.0): remove deprecated API test

        function createMockStorage() {
            const store = new Map<string, string>();
            return {
                getItem: (key: string) => store.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    store.set(key, value);
                },
                removeItem: (key: string) => {
                    store.delete(key);
                },
            };
        }

        it("both reject invalid values and fall back to defaultValue", () => {
            const validator$ = new BehaviorSubject((v: number) => v >= 0);

            const lsWithValidator = LocalState.create<number>({
                key: "dep-test-validator",
                defaultValue: 0,
                validator$,
                driver: createMockStorage(),
            });

            const lsWithCheck = LocalState.create<number>({
                key: "dep-test-check",
                defaultValue: 0,
                checkEffect: (v: number) => v >= 0,
                driver: createMockStorage(),
            });

            // Subscribe to prime the Computed inside LocalState
            const sub1 = lsWithValidator.obs.subscribe(() => {});
            const sub2 = lsWithCheck.obs.subscribe(() => {});

            // Both accept valid values
            lsWithValidator.set(5);
            lsWithCheck.set(5);
            expect(lsWithValidator.peek()).toBe(5);
            expect(lsWithCheck.peek()).toBe(5);

            // Both reject invalid values → fall back to default
            lsWithValidator.set(-1);
            lsWithCheck.set(-1);
            expect(lsWithValidator.peek()).toBe(0);
            expect(lsWithCheck.peek()).toBe(0);

            sub1.unsubscribe();
            sub2.unsubscribe();
        });
    });
});
