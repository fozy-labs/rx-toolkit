import { Signal } from './Signal';

describe('Signal (facade)', () => {

    describe('Signal.state()', () => {
        it('creates a callable SignalFn with initial value', () => {
            const s = Signal.state(42);
            expect(s()).toBe(42);
        });

        it('returns object with peek, set, get, obs', () => {
            const s = Signal.state(0);
            expect(typeof s.peek).toBe('function');
            expect(typeof s.set).toBe('function');
            expect(typeof s.get).toBe('function');
            expect(s.obs).toBeDefined();
        });

        it('set() updates the value', () => {
            const s = Signal.state(1);
            s.set(99);
            expect(s()).toBe(99);
            expect(s.peek()).toBe(99);
        });
    });

    describe('Signal.compute()', () => {
        it('creates a callable ComputeFn', () => {
            const c = Signal.compute(() => 10);
            expect(typeof c).toBe('function');
            expect(typeof c.peek).toBe('function');
            expect(typeof c.get).toBe('function');
            expect(c.obs).toBeDefined();

            const values: (number | symbol)[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([10]);
            sub.unsubscribe();
        });

        it('derives value from state signal', () => {
            const count = Signal.state(3);
            const doubled = Signal.compute(() => count() * 2);

            let value: number | undefined;
            const eff = Signal.effect(() => { value = doubled(); });
            expect(value).toBe(6);
            eff.unsubscribe();
        });
    });

    describe('Signal.effect()', () => {
        it('creates a SubscriptionLike with unsubscribe', () => {
            const eff = Signal.effect(() => {});
            expect(typeof eff.unsubscribe).toBe('function');
            expect(eff.closed).toBe(false);
            eff.unsubscribe();
        });

        it('runs effectFn immediately upon creation', () => {
            const fn = vi.fn();
            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });
    });

    describe('integration: state → compute → effect', () => {
        it('effect observes computed that depends on state', () => {
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

    describe('deprecated API', () => {
        it('new Signal(initial) creates a State-like instance', () => {
            const s = new Signal(42) as any;
            expect(s.peek()).toBe(42);
            expect(s.obs).toBeDefined();
            s.set(100);
            expect(s.peek()).toBe(100);
        });

        it('Signal.create(initial) returns a SignalFn', () => {
            const s = Signal.create(7);
            expect(s()).toBe(7);
            s.set(14);
            expect(s()).toBe(14);
        });
    });
});
