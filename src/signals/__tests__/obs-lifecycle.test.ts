/**
 * `.obs` semantics, node lifecycle (first observer / last observer) and the
 * public API surface of the push-pull core, as described in the proposal
 * (.tmp/0.13.0/proposal/signals-core-without-rxjs.md in the main checkout).
 */
import { map, Observable, Subject } from "rxjs";

import * as api from "@/index";
import { Batcher, Computed, Signal, SignalCycleError, SourceSignal } from "@/index";

import { effectLog, record } from "./helpers";

/** An upstream that counts active subscriptions. */
function tracked<T>(inner: Observable<T>) {
    const counter = { subscribed: 0, active: 0 };
    const source = new Observable<T>((subscriber) => {
        counter.subscribed += 1;
        counter.active += 1;
        const sub = inner.subscribe(subscriber);
        return () => {
            counter.active -= 1;
            sub.unsubscribe();
        };
    });
    return { source, counter };
}

/**
 * A SourceSignal over an external value: every start emits the latest value,
 * `emit` updates it and pushes it to every running start. Counts starts and
 * stops of the producer.
 */
function producer(initial: number) {
    const counter = { started: 0, stopped: 0 };
    let latest = initial;
    const running = new Set<{ next(v: number): void }>();
    const signal = SourceSignal.create<number>((subscriber) => {
        counter.started += 1;
        running.add(subscriber);
        subscriber.next(latest);
        return () => {
            counter.stopped += 1;
            running.delete(subscriber);
        };
    });
    const emit = (v: number) => {
        latest = v;
        running.forEach((subscriber) => subscriber.next(v));
    };
    return { signal, counter, emit };
}

describe(".obs", () => {
    it("is the same observable on every access", () => {
        const s = Signal.state(1);
        const c = Signal.compute(() => s() + 1);
        const f = Signal.from(new Subject<number>(), { default: 0 });

        expect(s.obs).toBe(s.obs);
        expect(c.obs).toBe(c.obs);
        expect(f.obs).toBe(f.obs);
    });

    it("Signal.from .obs gives nothing before the source emits: the default is not a value (FromSignal.test.ts pins it)", () => {
        const hub = new Subject<number>();
        const f = Signal.from(hub, { default: -1 });
        const log = record(f.obs);

        expect(f()).toBe(-1);
        hub.next(1);

        expect(log.values).toEqual([1]);
    });

    it("gives the current value synchronously on subscribe", () => {
        const s = Signal.state(1);
        const c = Signal.compute(() => s() * 10);

        expect(record(s.obs).values).toEqual([1]);
        expect(record(c.obs).values).toEqual([10]);
        expect(record(producer(7).signal.obs).values).toEqual([7]);
    });

    it("outside a batch, set() delivers to State.obs and dependent Computed.obs synchronously", () => {
        const s = Signal.state(1);
        const c = Signal.compute(() => s() * 10);
        const sLog = record(s.obs);
        const cLog = record(c.obs);

        s.set(2);

        expect(sLog.values).toEqual([1, 2]);
        expect(cLog.values).toEqual([10, 20]);
    });

    it("delivers only changes by Object.is", () => {
        const s = Signal.state<number>(0);
        const c = Signal.compute(() => (s() > 10 ? 1 : 0));
        const sLog = record(s.obs);
        const cLog = record(c.obs);

        s.set(0);
        s.set(-0);
        s.set(NaN);
        s.set(NaN);
        s.set(5);
        s.set(20);
        s.set(30);

        expect(sLog.values).toEqual([0, -0, NaN, 5, 20, 30]);
        expect(cLog.values).toEqual([0, 1]);
    });

    it("Computed.obs gives one value per batch when nothing reads inside the batch", () => {
        const a = Signal.state(1);
        const b = Signal.state(2);
        const sum = Signal.compute(() => a() + b());
        const log = record(sum.obs);

        Batcher.run(() => {
            a.set(10);
            b.set(20);
            a.set(100);
        });

        expect(log.values).toEqual([3, 120]);
    });

    it("State.obs gives every write of a batch immediately (behavior before the rewrite is kept)", () => {
        const s = Signal.state(0);
        const log = record(s.obs);
        const duringBatch: number[][] = [];

        Batcher.run(() => {
            s.set(1);
            duringBatch.push([...log.values]);
            s.set(2);
            duringBatch.push([...log.values]);
        });

        expect(duringBatch).toEqual([
            [0, 1],
            [0, 1, 2],
        ]);
    });

    // Only State keeps immediate delivery (the open question of the proposal);
    // every other node's .obs delivers at the flush, Signal.from included.
    it("Signal.from .obs gives one value per batch, whether an external source or a State chain writes it", () => {
        const hub = new Subject<number>();
        const fromHub = Signal.from(hub, { default: 0 });
        const s = Signal.state(0);
        const fromState = Signal.from(s.obs.pipe(map((v) => v * 10)));
        const hubLog = record(fromHub.obs);
        const stateLog = record(fromState.obs);

        Batcher.run(() => {
            hub.next(1);
            hub.next(2);
            s.set(1);
            s.set(2);
        });

        expect(hubLog.values).toEqual([2]);
        expect(stateLog.values).toEqual([0, 20]);
    });

    it("an error of computeFn reaches Computed.obs as `error`", () => {
        const s = Signal.state(1);
        const boom = new Error("boom");
        const c = Signal.compute(() => {
            if (s() < 0) throw boom;
            return s();
        });
        const log = record(c.obs);

        s.set(-1);

        expect(log.values).toEqual([1]);
        expect(log.errors).toEqual([boom]);
    });

    it("a subscription made inside a batch gives the value the batch has produced so far", () => {
        const s = Signal.state(1);
        let log: ReturnType<typeof record<number>> | null = null;

        Batcher.run(() => {
            s.set(2);
            log = record(s.obs);
        });

        expect(log!.values).toEqual([2]);
    });
});

describe("node lifecycle", () => {
    describe("Computed", () => {
        it("does not compute until read or observed", () => {
            const fn = vi.fn(() => 1);
            Signal.compute(fn);

            expect(fn).not.toHaveBeenCalled();
        });

        it("while observed, recomputes on writes and serves reads without recomputing", () => {
            const s = Signal.state(1);
            const fn = vi.fn(() => s() * 2);
            const c = Signal.compute(fn);
            const log = record(c.obs);

            c();
            c.peek();
            s.set(2);
            c();

            expect(fn).toHaveBeenCalledTimes(2);
            expect(log.values).toEqual([2, 4]);
            log.unsubscribe();
        });

        it("without observers, a write does not recompute", () => {
            const s = Signal.state(1);
            const fn = vi.fn(() => s() * 2);
            const c = Signal.compute(fn);
            const log = record(c.obs);
            log.unsubscribe();
            fn.mockClear();

            s.set(2);
            s.set(3);

            expect(fn).not.toHaveBeenCalled();
            expect(c.peek()).toBe(6);
        });

        it("a cold read twice without a change computes once", () => {
            const s = Signal.state(1);
            const fn = vi.fn(() => s() * 2);
            const c = Signal.compute(fn);

            c.peek();
            c.peek();

            expect(fn).toHaveBeenCalledTimes(1);
            s.set(2);
            expect(c.peek()).toBe(4);
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("releases its sources when the last observer leaves", () => {
            const { source, counter } = tracked(new Subject<number>());
            const upstream = Signal.from(source, { default: 0, keepAlive: "none" });
            const c = Signal.compute(() => upstream() + 1);
            const first = record(c.obs);
            const second = record(c.obs);

            expect(counter.active).toBe(1);
            first.unsubscribe();
            expect(counter.active).toBe(1);
            second.unsubscribe();
            expect(counter.active).toBe(0);
        });

        it("an effect is an observer: its computed dependencies stay hot until it is unsubscribed", () => {
            const { source, counter } = tracked(new Subject<number>());
            const upstream = Signal.from(source, { default: 0, keepAlive: "none" });
            const mid = Signal.compute(() => upstream() + 1);
            const top = Signal.compute(() => mid() * 2);
            const log = effectLog(() => top());

            expect(counter.active).toBe(1);
            log.unsubscribe();
            expect(counter.active).toBe(0);
        });

        it("a computed that stopped reading a source releases it", () => {
            const { source, counter } = tracked(new Subject<number>());
            const upstream = Signal.from(source, { default: 5, keepAlive: "none" });
            const useUpstream = Signal.state(true);
            const c = Signal.compute(() => (useUpstream() ? upstream() : -1));
            const log = record(c.obs);

            expect(counter.active).toBe(1);
            useUpstream.set(false);
            expect(counter.active).toBe(0);
            expect(log.values).toEqual([5, -1]);
        });
    });

    describe("Signal.from", () => {
        it("does not subscribe upstream until first read or observed", () => {
            const { source, counter } = tracked(new Subject<number>());
            Signal.from(source, { default: 0 });

            expect(counter.subscribed).toBe(0);
        });

        it("subscribes upstream once for all observers: .obs, effects and observed computeds", () => {
            const hub = new Subject<number>();
            const { source, counter } = tracked(hub);
            const f = Signal.from(source, { default: 0, keepAlive: "none" });
            const c = Signal.compute(() => f() * 10);

            const obsLog = record(f.obs);
            const eff = effectLog(() => f());
            const cLog = record(c.obs);
            hub.next(1);
            f();
            f.peek();

            expect(counter.subscribed).toBe(1);
            expect(obsLog.values).toEqual([1]);
            expect(eff.values).toEqual([0, 1]);
            expect(cLog.values).toEqual([0, 10]);

            obsLog.unsubscribe();
            eff.unsubscribe();
            expect(counter.active).toBe(1);
            cLog.unsubscribe();
            expect(counter.active).toBe(0);
        });

        it("counts keepAlive from the moment the last observer leaves", () => {
            vi.useFakeTimers();
            try {
                const { source, counter } = tracked(new Subject<number>());
                const f = Signal.from(source, { default: 0, keepAlive: 100 });
                const eff = effectLog(() => f());

                vi.advanceTimersByTime(500);
                expect(counter.active).toBe(1);

                eff.unsubscribe();
                vi.advanceTimersByTime(99);
                expect(counter.active).toBe(1);
                vi.advanceTimersByTime(1);
                expect(counter.active).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it("an observer that returns within the keepAlive window reuses the upstream subscription", () => {
            vi.useFakeTimers();
            try {
                const { source, counter } = tracked(new Subject<number>());
                const f = Signal.from(source, { default: 0, keepAlive: 100 });
                const c = Signal.compute(() => f() + 1);

                const first = record(c.obs);
                first.unsubscribe();
                vi.advanceTimersByTime(50);
                const second = record(c.obs);
                vi.advanceTimersByTime(500);

                expect(counter.subscribed).toBe(1);
                expect(counter.active).toBe(1);
                second.unsubscribe();
            } finally {
                vi.useRealTimers();
            }
        });

        it("keepAlive: 'forever' keeps upstream after the last observer until dispose()", () => {
            const { source, counter } = tracked(new Subject<number>());
            const f = Signal.from(source, { default: 0, keepAlive: "forever" });
            const eff = effectLog(() => f());
            eff.unsubscribe();

            expect(counter.active).toBe(1);
            f.dispose();
            expect(counter.active).toBe(0);
        });
    });

    describe("SourceSignal.create", () => {
        it("does not start the producer at creation", () => {
            const { counter } = producer(1);

            expect(counter.started).toBe(0);
        });

        it("a cold read starts the producer and stops it", () => {
            const { signal, counter } = producer(1);

            expect(signal()).toBe(1);
            expect(counter).toEqual({ started: 1, stopped: 1 });
        });

        it("starts the producer on the first observer and stops it when the last one leaves", () => {
            const { signal, counter } = producer(1);

            const first = record(signal.obs);
            const second = record(signal.obs);
            expect(counter).toEqual({ started: 1, stopped: 0 });

            first.unsubscribe();
            expect(counter).toEqual({ started: 1, stopped: 0 });
            second.unsubscribe();
            expect(counter).toEqual({ started: 1, stopped: 1 });
        });

        it("reads while observed do not restart the producer", () => {
            const { signal, counter, emit } = producer(1);
            const log = record(signal.obs);

            emit(2);
            expect(signal()).toBe(2);
            expect(signal.peek()).toBe(2);
            expect(counter).toEqual({ started: 1, stopped: 0 });
            log.unsubscribe();
        });

        it("an effect observes the producer: one start for its lifetime, stop on unsubscribe", () => {
            const { signal, counter, emit } = producer(1);
            const eff = effectLog(() => signal());

            emit(2);
            emit(3);

            expect(eff.values).toEqual([1, 2, 3]);
            expect(counter).toEqual({ started: 1, stopped: 0 });
            eff.unsubscribe();
            expect(counter).toEqual({ started: 1, stopped: 1 });
        });

        it("later producer emissions reach observed computeds and effects", () => {
            const { signal, emit } = producer(1);
            const c = Signal.compute(() => signal() * 10);
            const cLog = record(c.obs);
            const eff = effectLog(() => c());

            emit(2);

            expect(cLog.values).toEqual([10, 20]);
            expect(eff.values).toEqual([10, 20]);
            eff.unsubscribe();
            cLog.unsubscribe();
        });
    });
});

describe("public API", () => {
    it("keeps Batcher.run, SourceSignal.create and SignalCycleError", () => {
        expect(typeof Batcher.run).toBe("function");
        expect(typeof SourceSignal.create).toBe("function");
        expect(new SignalCycleError(["A", "A"])).toBeInstanceOf(Error);
        expect(typeof Computed.create).toBe("function");
    });

    it("no longer exports the engine internals DependencyTracker, ComputeCache, SyncObservable", () => {
        expect(api).not.toHaveProperty("DependencyTracker");
        expect(api).not.toHaveProperty("ComputeCache");
        expect(api).not.toHaveProperty("SyncObservable");
    });

    it("no longer exposes Batcher.scheduler", () => {
        expect(Batcher).not.toHaveProperty("scheduler");
    });
});
