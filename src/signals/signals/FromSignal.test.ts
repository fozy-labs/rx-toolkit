import { defer, Observable, of, scan, startWith, Subject, throwError } from "rxjs";

import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

import { FromSignal } from "./FromSignal";
import { Signal } from "./Signal";

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Wraps a source so tests can count how many times upstream was subscribed. */
function counting<T>(inner: Observable<T>) {
    const counter = { subscriptions: 0 };
    const source = defer(() => {
        counter.subscriptions += 1;
        return inner;
    });
    return { source, counter };
}

describe("Signal.from", () => {
    describe("signal protocol", () => {
        it("returns a callable DisposableSignal", () => {
            const signal = Signal.from(of(1));

            expect(typeof signal).toBe("function");
            expect(typeof signal.peek).toBe("function");
            expect(typeof signal.get).toBe("function");
            expect(typeof signal.dispose).toBe("function");
            expect(typeof signal[SYMBOL_DISPOSE]).toBe("function");
            expect(signal.obs).toBeInstanceOf(Observable);
        });

        it("reads a synchronously emitting source", () => {
            const signal = Signal.from(of(42));

            expect(signal()).toBe(42);
            expect(signal.peek()).toBe(42);
            expect(signal.get()).toBe(42);
        });
    });

    describe("hot reads (the signalize fix)", () => {
        it("sees emissions that happen while the subscription is held", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });

            expect(signal()).toBe(0);

            source$.next(10);
            expect(signal()).toBe(10);
        });

        it("does not restart a stateful cold pipeline between reads", () => {
            const clicks$ = new Subject<void>();
            const counter = Signal.from(
                clicks$.pipe(
                    scan((n) => n + 1, 0),
                    startWith(0),
                ),
            );

            expect(counter()).toBe(0);

            clicks$.next();
            clicks$.next();
            expect(counter()).toBe(2);
        });
    });

    describe('keepAlive: "microtask" (default)', () => {
        it("shares a single upstream subscription within one synchronous burst", () => {
            const { source, counter } = counting(new Subject<number>());
            const signal = Signal.from(source, { default: 0 });

            signal();
            signal();
            signal();

            expect(counter.subscriptions).toBe(1);
        });

        it("goes cold after the microtask boundary: cache dropped, upstream re-subscribed", async () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0 });

            signal();
            inner$.next(5);
            expect(signal()).toBe(5);
            expect(counter.subscriptions).toBe(1);

            await Promise.resolve();

            expect(signal()).toBe(0);
            expect(counter.subscriptions).toBe(2);
        });
    });

    describe('keepAlive: "none"', () => {
        it("reproduces the legacy signalize behavior: emissions between reads are lost", () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0, keepAlive: "none" });

            expect(signal()).toBe(0);
            inner$.next(10);
            expect(signal()).toBe(0);
            expect(counter.subscriptions).toBe(2);
        });
    });

    describe('keepAlive: "task"', () => {
        it("stays hot across microtasks and goes cold after a macrotask", async () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0, keepAlive: "task" });

            signal();
            inner$.next(7);

            await Promise.resolve();
            expect(signal()).toBe(7);
            expect(counter.subscriptions).toBe(1);

            await macrotask();
            expect(signal()).toBe(0);
            expect(counter.subscriptions).toBe(2);
        });
    });

    describe("keepAlive: number (ms)", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("each read renews the grace window; an idle window expires to cold", () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0, keepAlive: 50 });

            signal();
            inner$.next(10);

            vi.advanceTimersByTime(30);
            expect(signal()).toBe(10); // renewed at t=30

            vi.advanceTimersByTime(49);
            expect(signal()).toBe(10); // renewed again at t=79

            vi.advanceTimersByTime(51);
            expect(signal()).toBe(0); // idle > 50ms — cold restart
            expect(counter.subscriptions).toBe(2);
        });
    });

    describe('keepAlive: "forever"', () => {
        it("holds the upstream subscription from first read until dispose", async () => {
            const clicks$ = new Subject<void>();
            const { source, counter } = counting(
                clicks$.pipe(
                    scan((n) => n + 1, 0),
                    startWith(0),
                ),
            );
            const signal = Signal.from(source, { keepAlive: "forever" });

            expect(signal()).toBe(0);

            clicks$.next();
            await macrotask();
            clicks$.next();

            expect(signal()).toBe(2); // scan state survived the macrotask gap
            expect(counter.subscriptions).toBe(1);

            signal.dispose();
            expect(clicks$.observed).toBe(false);
        });

        it("serves a completed source from cache indefinitely", async () => {
            const { source, counter } = counting(of(42));
            const signal = Signal.from(source, { keepAlive: "forever" });

            expect(signal()).toBe(42);
            await macrotask();
            expect(signal()).toBe(42);
            expect(counter.subscriptions).toBe(1);

            signal.dispose();
        });
    });

    describe("default value", () => {
        it("throws without a default when the source has not emitted", () => {
            const signal = Signal.from(new Subject<number>());

            expect(() => signal.peek()).toThrow("No value emitted");
        });

        it("treats an explicit undefined as a valid default", () => {
            const signal = Signal.from(new Subject<number | undefined>(), { default: undefined });

            expect(signal.peek()).toBeUndefined();
        });
    });

    describe(".obs", () => {
        it("an active subscriber keeps the upstream hot across macrotasks", async () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: -1 });

            const seen: number[] = [];
            const sub = signal.obs.subscribe((v) => seen.push(v));

            inner$.next(1);
            await macrotask();
            inner$.next(2);

            expect(signal.peek()).toBe(2);
            expect(seen).toEqual([1, 2]);
            expect(counter.subscriptions).toBe(1);

            sub.unsubscribe();
            await macrotask();

            expect(signal.peek()).toBe(-1); // grace expired — cold again
            expect(counter.subscriptions).toBe(2);
        });

        it("replays the cached value to a late subscriber while hot", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });

            signal();
            source$.next(3);

            const seen: number[] = [];
            signal.obs.subscribe((v) => seen.push(v));

            expect(seen).toEqual([3]);
        });

        it("deduplicates consecutive identical values via Object.is", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$);

            const seen: number[] = [];
            const sub = signal.obs.subscribe((v) => seen.push(v));

            source$.next(1);
            source$.next(1);
            source$.next(2);

            expect(seen).toEqual([1, 2]);
            sub.unsubscribe();
        });
    });

    describe("reactivity integration", () => {
        it("an effect re-runs on emissions and reads the fresh value", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });

            const seen: number[] = [];
            const effect = Signal.effect(() => {
                seen.push(signal());
            });

            expect(seen).toEqual([0]);

            source$.next(5);
            expect(seen).toEqual([0, 5]);

            source$.next(5); // duplicate — no re-run
            expect(seen).toEqual([0, 5]);

            effect.unsubscribe();
        });

        it("a computed over the signal stays in sync", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });
            const doubled = Signal.compute(() => signal() * 2);

            const seen: number[] = [];
            const sub = doubled.obs.subscribe((v) => seen.push(v));

            source$.next(3);
            expect(seen).toEqual([0, 6]);

            sub.unsubscribe();
            doubled.dispose();
        });
    });

    describe("errors", () => {
        it("rethrows a synchronous source error to the reader and retries on the next read", () => {
            let attempts = 0;
            const source = defer(() => {
                attempts += 1;
                return attempts === 1 ? throwError(() => new Error("boom")) : of(42);
            });
            const signal = Signal.from(source);

            expect(() => signal.peek()).toThrow("boom");
            expect(signal.peek()).toBe(42);
            expect(attempts).toBe(2);
        });

        it("delivers an asynchronous error to .obs subscribers, then resets to cold", () => {
            let attempt$ = new Subject<number>();
            let attempts = 0;
            const source = defer(() => {
                attempts += 1;
                return attempt$;
            });
            const signal = Signal.from(source, { default: 0 });

            let caught: unknown = null;
            signal.obs.subscribe({
                error: (e) => {
                    caught = e;
                },
            });

            attempt$.error(new Error("late boom"));
            expect(caught).toBeInstanceOf(Error);

            attempt$ = new Subject<number>(); // a dead Subject replays its error; give the retry a live upstream
            expect(signal.peek()).toBe(0); // reset — the next read retries upstream
            expect(attempts).toBe(2);
        });
    });

    describe("completion", () => {
        it("serves a completed source from cache within the keepAlive window, then restarts cold", async () => {
            const { source, counter } = counting(of(42));
            const signal = Signal.from(source);

            expect(signal()).toBe(42);
            expect(signal()).toBe(42);
            expect(counter.subscriptions).toBe(1);

            await macrotask();

            expect(signal()).toBe(42);
            expect(counter.subscriptions).toBe(2);
        });
    });

    describe("dispose()", () => {
        it("freezes the last value and tears down the upstream", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0, keepAlive: "forever" });

            signal();
            source$.next(9);
            expect(signal()).toBe(9);

            signal.dispose();

            expect(source$.observed).toBe(false);
            expect(signal.peek()).toBe(9);

            source$.next(11);
            expect(signal.peek()).toBe(9);
        });

        it("freezes the value cached during the grace window", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });

            signal();
            source$.next(4);
            signal.dispose();

            expect(signal.peek()).toBe(4);
        });

        it("falls back to the default when disposed while cold, without re-subscribing", async () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0 });

            signal();
            inner$.next(8);
            await macrotask(); // grace expired — cache dropped

            signal.dispose();

            expect(signal.peek()).toBe(0);
            expect(counter.subscriptions).toBe(1);
        });

        it("throws after dispose when cold and no default was given", async () => {
            const signal = Signal.from(new Subject<number>());

            expect(() => signal.peek()).toThrow("No value emitted");
            await macrotask();
            signal.dispose();

            expect(() => signal.peek()).toThrow("No value emitted");
        });

        it("completes active .obs subscribers and new ones immediately", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0 });

            let completedActive = false;
            signal.obs.subscribe({
                complete: () => {
                    completedActive = true;
                },
            });

            signal.dispose();
            expect(completedActive).toBe(true);

            let completedLate = false;
            const seen: number[] = [];
            signal.obs.subscribe({
                next: (v) => seen.push(v),
                complete: () => {
                    completedLate = true;
                },
            });

            expect(completedLate).toBe(true);
            expect(seen).toEqual([]);
        });

        it("is idempotent", () => {
            const signal = Signal.from(of(1));

            signal();
            signal.dispose();
            expect(() => signal.dispose()).not.toThrow();
            expect(signal.peek()).toBe(1);
        });
    });

    describe("FromSignal class", () => {
        it("exposes a static create matching Signal.from", () => {
            const signal = FromSignal.create(of(7));

            expect(signal()).toBe(7);
            signal.dispose();
        });
    });
});
