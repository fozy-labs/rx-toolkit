import { Signal } from "./Signal";

describe("Signal (facade)", () => {
    describe("Signal.state()", () => {
        it("creates a callable StateSignal with initial value", () => {
            const s = Signal.state(42);
            expect(s()).toBe(42);
        });

        it("returns object with peek, set, update, get, obs", () => {
            const s = Signal.state(0);
            expect(typeof s.peek).toBe("function");
            expect(typeof s.set).toBe("function");
            expect(typeof s.update).toBe("function");
            expect(typeof s.get).toBe("function");
            expect(s.obs).toBeDefined();
        });

        it("set() updates the value", () => {
            const s = Signal.state(1);
            s.set(99);
            expect(s()).toBe(99);
            expect(s.peek()).toBe(99);
        });

        it("update() updates the value", () => {
            const s = Signal.state(1);
            s.update((value) => value + 1);
            expect(s()).toBe(2);
            expect(s.peek()).toBe(2);
        });
    });

    describe("Signal.compute()", () => {
        it("creates a callable DisposableSignal", () => {
            const c = Signal.compute(() => 10);
            expect(typeof c).toBe("function");
            expect(typeof c.peek).toBe("function");
            expect(typeof c.get).toBe("function");
            expect(c.obs).toBeDefined();

            const values: (number | symbol)[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([10]);
            sub.unsubscribe();
        });

        it("derives value from state signal", () => {
            const count = Signal.state(3);
            const doubled = Signal.compute(() => count() * 2);

            let value: number | undefined;
            const eff = Signal.effect(() => {
                value = doubled();
            });
            expect(value).toBe(6);
            eff.unsubscribe();
        });
    });

    describe("Signal.effect()", () => {
        it("creates a SubscriptionLike with unsubscribe", () => {
            const eff = Signal.effect(() => {});
            expect(typeof eff.unsubscribe).toBe("function");
            expect(eff.closed).toBe(false);
            eff.unsubscribe();
        });

        it("runs effectFn immediately upon creation", () => {
            const fn = vi.fn();
            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });
    });

    describe("integration: state → compute → effect", () => {
        it("effect observes computed that depends on state", () => {
            const count = Signal.state(1);
            const doubled = Signal.compute(() => count() * 2);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                values.push(doubled());
            });

            expect(values).toEqual([2]);

            count.set(5);
            expect(values).toEqual([2, 10]);

            count.set(5); // same value — no change
            expect(values).toEqual([2, 10]);

            eff.unsubscribe();
        });
    });
});
