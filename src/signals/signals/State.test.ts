import { Signal } from "./Signal";
import { State } from "./State";

describe("State", () => {
    describe("creation", () => {
        it("Signal.state(initial) creates signal with initial value", () => {
            const s = Signal.state(42);
            expect(s()).toBe(42);
            expect(s.peek()).toBe(42);
        });

        it("State.create(initial) creates signal with initial value", () => {
            const s = State.create("hello");
            expect(s()).toBe("hello");
            expect(s.peek()).toBe("hello");
        });
    });

    describe("reading values", () => {
        it("signal() returns current value via get()", () => {
            const s = Signal.state(10);
            expect(s()).toBe(10);
        });

        it("signal.peek() returns current value synchronously", () => {
            const s = Signal.state(10);
            expect(s.peek()).toBe(10);
        });

        it("signal.get() returns current value", () => {
            const s = Signal.state(10);
            expect(s.get()).toBe(10);
        });
    });

    describe("writing values", () => {
        it("set(newValue) updates the value", () => {
            const s = Signal.state(1);
            s.set(2);
            expect(s()).toBe(2);
        });

        it("set(sameValue) with === equality is skipped (no emission)", () => {
            const s = Signal.state(1);
            const values: number[] = [];
            const sub = s.obs.subscribe((v: number) => values.push(v));

            expect(values).toEqual([1]); // BehaviorSubject initial

            s.set(1); // same value
            expect(values).toEqual([1]); // no new emission

            sub.unsubscribe();
        });

        it("set(newObj) with same content but different reference emits", () => {
            const s = Signal.state({ a: 1 });
            const values: Array<{ a: number }> = [];
            const sub = s.obs.subscribe((v: { a: number }) => values.push(v));

            expect(values).toHaveLength(1);

            s.set({ a: 1 }); // new reference
            expect(values).toHaveLength(2); // emits because !== reference

            sub.unsubscribe();
        });
    });

    describe("observable (obs)", () => {
        it("emits current value immediately on subscribe", () => {
            const s = Signal.state(5);
            const values: number[] = [];
            const sub = s.obs.subscribe((v: number) => values.push(v));

            expect(values).toEqual([5]);
            sub.unsubscribe();
        });

        it("emits on subsequent set() calls", () => {
            const s = Signal.state(0);
            const values: number[] = [];
            const sub = s.obs.subscribe((v: number) => values.push(v));

            s.set(1);
            s.set(2);
            expect(values).toEqual([0, 1, 2]);

            sub.unsubscribe();
        });
    });

    describe("dependency tracking", () => {
        it("signal() in tracked context (effect) creates dependency", () => {
            const s = Signal.state(0);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                values.push(s());
            });

            expect(values).toEqual([0]);

            s.set(1);
            expect(values).toEqual([0, 1]);

            eff.unsubscribe();
        });

        it("signal.peek() in tracked context does NOT create dependency", () => {
            const s = Signal.state(0);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                values.push(s.peek());
            });

            expect(values).toEqual([0]);

            s.set(1);
            // No re-run — peek doesn't track
            expect(values).toEqual([0]);

            eff.unsubscribe();
        });
    });

    describe("edge cases", () => {
        it("handles null as a signal value", () => {
            const s = Signal.state<string | null>(null);
            expect(s()).toBeNull();
            s.set("hello");
            expect(s()).toBe("hello");
            s.set(null);
            expect(s()).toBeNull();
        });

        it("handles undefined as a signal value", () => {
            const s = Signal.state<number | undefined>(undefined);
            expect(s()).toBeUndefined();
            s.set(42);
            expect(s()).toBe(42);
            s.set(undefined);
            expect(s()).toBeUndefined();
        });
    });
});
