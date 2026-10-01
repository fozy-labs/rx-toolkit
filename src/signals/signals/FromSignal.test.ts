import {
    BehaviorSubject,
    defer,
    lastValueFrom,
    map,
    Observable,
    of,
    retry,
    scan,
    startWith,
    Subject,
    take,
    throwError,
} from "rxjs";

import type { DisposableSignal } from "@/signals/types";

import { Batcher } from "../base/Batcher";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";
import { SignalCycleError } from "../base/SignalCycleError";

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

        it("a read gets a synchronous source error, not the default", () => {
            const signal = Signal.from(
                throwError(() => new Error("boom")),
                { keepAlive: "none", default: 1 },
            );

            expect(() => signal()).toThrow("boom");
            expect(() => signal.peek()).toThrow("boom");
        });

        it("a source that reads the signal while it subscribes throws SignalCycleError to the reader", () => {
            const signal: DisposableSignal<number> = Signal.from(
                defer(() => of(signal() + 1)),
                { keepAlive: "none", default: 0 },
            );

            expect(() => signal()).toThrow(SignalCycleError);
        });

        it("a source that peeks the signal while it subscribes throws SignalCycleError to the reader", () => {
            const signal: DisposableSignal<number> = Signal.from(
                defer(() => of(signal.peek() + 1)),
                { keepAlive: "none", default: 0 },
            );

            expect(() => signal.peek()).toThrow(SignalCycleError);
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

        it('an unobserved computed reads a fresh value after the upstream changed unseen (keepAlive "none")', () => {
            const source$ = new BehaviorSubject(1);
            const signal = Signal.from(source$, { keepAlive: "none" });
            const tenfold = Signal.compute(() => signal() * 10);

            expect(tenfold.peek()).toBe(10);
            expect(tenfold.peek()).toBe(10);
            source$.next(2);
            expect(tenfold.peek()).toBe(20);
        });

        it("an unobserved computed reads a fresh value once the grace window is over", async () => {
            const source$ = new BehaviorSubject(1);
            const signal = Signal.from(source$);
            const tenfold = Signal.compute(() => signal() * 10);

            expect(tenfold.peek()).toBe(10);
            expect(tenfold.peek()).toBe(10);
            await Promise.resolve();
            source$.next(2);
            expect(tenfold.peek()).toBe(20);
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

        describe("a source that fails synchronously is subscribed once and its error delivered", () => {
            function failing() {
                const counter = { subscriptions: 0 };
                const source = defer(() => {
                    counter.subscriptions += 1;
                    return throwError(() => new Error(`fail${counter.subscriptions}`));
                });
                return { signal: Signal.from(source), counter };
            }

            it("to an .obs subscriber", () => {
                const { signal, counter } = failing();
                let caught: unknown = null;
                signal.obs.subscribe({ error: (e) => (caught = e) });

                expect(counter.subscriptions).toBe(1);
                expect((caught as Error).message).toBe("fail1");
            });

            it("to a reading effect", () => {
                const { signal, counter } = failing();
                expect(() => Signal.effect(() => signal())).toThrow("fail1");
                expect(counter.subscriptions).toBe(1);
            });

            it("to an .obs subscriber of a computed over it", () => {
                const { signal, counter } = failing();
                const doubled = Signal.compute(() => signal() * 2);
                let caught: unknown = null;
                doubled.obs.subscribe({ error: (e) => (caught = e) });

                expect(counter.subscriptions).toBe(1);
                expect((caught as Error).message).toBe("fail1");
            });
        });

        describe("an error raised from an .obs callback that is no bridge of the signal is a source error", () => {
            function fresh() {
                const subjects: Subject<number>[] = [];
                const source = defer(() => {
                    const subject = new Subject<number>();
                    subjects.push(subject);
                    return subject;
                });
                return { subjects, signal: Signal.from(source, { default: 0, keepAlive: "forever" }) };
            }

            it("from a State.obs subscriber of an unrelated state: the next read retries", () => {
                const { subjects, signal } = fresh();
                signal();
                subjects[0].next(5);
                const logout = Signal.state(false);
                const sub = logout.obs.subscribe((v) => {
                    if (v) subjects[0].error(new Error("x"));
                });

                logout.set(true);

                expect(signal()).toBe(0);
                expect(subjects).toHaveLength(2);
                sub.unsubscribe();
            });

            it("from a Computed.obs subscriber of an unrelated computed: the next read retries", () => {
                const { subjects, signal } = fresh();
                signal();
                subjects[0].next(5);
                const s = Signal.state(0);
                const sub = Signal.compute(() => s() > 0).obs.subscribe((v) => {
                    if (v) subjects[0].error(new Error("x"));
                });

                s.set(1);

                expect(signal()).toBe(0);
                expect(subjects).toHaveLength(2);
                sub.unsubscribe();
            });

            it("from its own .obs subscriber: the subscriber gets the error, the next read retries", () => {
                const { subjects, signal } = fresh();
                const got: unknown[] = [];
                signal.obs.subscribe({
                    next: (v) => {
                        got.push(v);
                        if (v === 3) subjects[0].error(new Error("stop"));
                    },
                    error: (e) => got.push(`E:${(e as Error).message}`),
                });

                subjects[0].next(3);

                expect(got).toEqual([3, "E:stop"]);
                expect(subjects).toHaveLength(1);
                expect(signal()).toBe(0);
                expect(subjects).toHaveLength(2);
            });
        });

        describe.each(["microtask", "forever", "none"] as const)(
            'an unobserved computed that catches the error retries the source on each read (keepAlive "%s")',
            (keepAlive) => {
                it("and gets the value once the source recovers", () => {
                    let subscriptions = 0;
                    const signal = Signal.from(
                        new Observable<number>((subscriber) => {
                            subscriptions++;
                            if (subscriptions <= 3) subscriber.error(new Error("down"));
                            else subscriber.next(42);
                        }),
                        { keepAlive },
                    );
                    const safe = Signal.compute(() => {
                        try {
                            return signal();
                        } catch {
                            return -1;
                        }
                    });

                    const reads = Array.from({ length: 5 }, () => safe.peek());

                    expect(reads).toEqual([-1, -1, -1, 42, 42]);
                    signal.dispose();
                });
            },
        );

        describe("an error of an observed source: the reactions it wakes read it, a later read retries", () => {
            it("an effect sees the error once and retries on its next run", () => {
                let subject = new Subject<number>();
                let subscriptions = 0;
                const signal = Signal.from(
                    defer(() => {
                        subscriptions++;
                        return subject.pipe(startWith(subscriptions));
                    }),
                    { keepAlive: "forever" },
                );
                const tick = Signal.state(0);
                const seen: unknown[] = [];
                const effect = Signal.effect(() => {
                    tick();
                    try {
                        seen.push(signal());
                    } catch (error) {
                        seen.push(`E:${(error as Error).message}`);
                    }
                });

                subject.error(new Error("late"));
                expect(seen).toEqual([1, "E:late"]);
                expect(subscriptions).toBe(1);

                subject = new Subject<number>();
                tick.set(1);
                expect(seen).toEqual([1, "E:late", 2]);
                effect.unsubscribe();
            });

            it("a new .obs subscription (retry) subscribes the source again; the other subscribers get the error", () => {
                let subject = new Subject<number>();
                let subscriptions = 0;
                const signal = Signal.from(
                    defer(() => {
                        subscriptions++;
                        return subject;
                    }),
                );
                const retried: unknown[] = [];
                const plain: unknown[] = [];
                signal.obs.pipe(retry(1)).subscribe({
                    next: (v) => retried.push(v),
                    error: () => retried.push("E"),
                });
                signal.obs.subscribe({ next: (v) => plain.push(v), error: () => plain.push("E") });
                subject.next(1);

                const failed = subject;
                subject = new Subject<number>();
                failed.error(new Error("x"));
                subject.next(2);

                expect(subscriptions).toBe(2);
                expect(retried).toEqual([1, 2]);
                expect(plain).toEqual([1, "E"]);
            });

            it("a source that replays a value, then fails at once, does not loop the effect", () => {
                const subject = new Subject<number>();
                const signal = Signal.from(subject.pipe(startWith(0)), { keepAlive: "forever" });
                let runs = 0;
                const effect = Signal.effect(() => {
                    runs++;
                    try {
                        signal();
                    } catch {
                        // shown as an error state
                    }
                });

                subject.error(new Error("down"));

                expect(runs).toBe(2);
                effect.unsubscribe();
            });
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

        /** Logs a subscriber's values and its completion. */
        const log = (into: unknown[], tag = "") => ({
            next: (v: unknown) => into.push(`${tag}${String(v)}`),
            complete: () => into.push(`${tag}complete`),
        });

        it("lastValueFrom(.obs) resolves with the last value", async () => {
            await expect(lastValueFrom(Signal.from(of(1, 2, 3)).obs)).resolves.toBe(3);
        });

        it("current .obs subscribers get the last value, then complete; reads keep the last value", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$);
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));

            source$.next(1);
            source$.next(2);
            source$.complete();

            expect(seen).toEqual(["1", "2", "complete"]);
            expect(signal()).toBe(2);
        });

        it("a subscriber arriving while the completed value is retained gets it, then complete", async () => {
            const { source, counter } = counting(of(42));
            const signal = Signal.from(source, { keepAlive: "forever" });
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen, "a:"));
            signal.obs.subscribe(log(seen, "b:"));
            await macrotask();
            signal.obs.subscribe(log(seen, "c:"));

            expect(seen).toEqual(["a:42", "a:complete", "b:42", "b:complete", "c:42", "c:complete"]);
            expect(signal()).toBe(42);
            expect(counter.subscriptions).toBe(1);
        });

        it("once keepAlive releases the completed source, a subscriber restarts it cold", async () => {
            const { source, counter } = counting(of(42));
            const signal = Signal.from(source);
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen, "a:"));
            signal.obs.subscribe(log(seen, "b:"));
            expect(counter.subscriptions).toBe(1);

            await macrotask();
            signal.obs.subscribe(log(seen, "c:"));

            expect(seen).toEqual(["a:42", "a:complete", "b:42", "b:complete", "c:42", "c:complete"]);
            expect(counter.subscriptions).toBe(2);
        });

        it('keepAlive "none": the completed source restarts cold for the next reader', () => {
            let subject!: Subject<number>;
            const { source, counter } = counting(defer(() => (subject = new Subject<number>())));
            const signal = Signal.from(source, { keepAlive: "none", default: -1 });
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));

            subject.next(1);
            subject.complete();

            expect(seen).toEqual(["1", "complete"]);
            expect(signal()).toBe(-1);
            expect(counter.subscriptions).toBe(2);
        });

        it("a completion without a value completes the subscribers; reads serve the default", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$, { default: 0, keepAlive: "forever" });
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen, "a:"));

            source$.complete();
            signal.obs.subscribe(log(seen, "b:"));

            expect(seen).toEqual(["a:complete", "b:complete"]);
            expect(signal()).toBe(0);
        });

        it("inside a batch: one value, then complete, when the batch ends", () => {
            const source$ = new Subject<number>();
            const signal = Signal.from(source$);
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));

            Batcher.run(() => {
                source$.next(1);
                source$.next(2);
                source$.complete();
                seen.push("batch end");
            });

            expect(seen).toEqual(["batch end", "2", "complete"]);
            expect(signal()).toBe(2);
        });

        it("through a bridge chain: each bridge completes after its last value, readers keep the values", () => {
            const s = Signal.state(0);
            const b1 = Signal.from(s.obs.pipe(take(3)), { keepAlive: "forever" });
            const b2 = Signal.from(b1.obs.pipe(map((v) => v * 10)), { keepAlive: "forever" });
            const c = Signal.compute(() => b2() + 1);
            const seen: unknown[] = [];
            b1.obs.subscribe(log(seen, "b1:"));
            b2.obs.subscribe(log(seen, "b2:"));
            c.obs.subscribe(log(seen, "c:"));

            s.set(1);
            s.set(2);
            s.set(3);

            const of_ = (tag: string) => seen.filter((e) => String(e).startsWith(tag));
            expect(of_("b1:")).toEqual(["b1:0", "b1:1", "b1:2", "b1:complete"]);
            expect(of_("b2:")).toEqual(["b2:0", "b2:10", "b2:20", "b2:complete"]);
            expect(of_("c:")).toEqual(["c:1", "c:11", "c:21"]);
            expect([b1(), b2(), c()]).toEqual([2, 20, 21]);
            const late: unknown[] = [];
            b2.obs.subscribe(log(late));
            expect(late).toEqual(["20", "complete"]);
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

    describe("connect guards", () => {
        it("a computed revalidated while its receiver reconnects reads it as still connecting", () => {
            const subject = new Subject<number>();
            const w = Signal.state(0);
            let connects = 0;
            let midConnect: unknown;
            const signal: DisposableSignal<number> = Signal.from(
                new Observable<number>((subscriber) => {
                    connects++;
                    if (connects === 2) {
                        // A write of another source marks the dependent; reading
                        // it now revalidates against a receiver still connecting.
                        w.set(1);
                        try {
                            dependent();
                        } catch (error) {
                            midConnect = error;
                        }
                        subscriber.next(10);
                        subscriber.complete();
                        return;
                    }
                    const sub = subject.subscribe(subscriber);
                    return () => sub.unsubscribe();
                }),
                { default: 0 },
            );
            const driver = Signal.compute(() => signal());
            // w is read on the error path too, so it stays a dependency — the
            // write of it inside the second connect marks this computed.
            const dependent: DisposableSignal<number> = Signal.compute(() => {
                try {
                    return signal() + w();
                } catch (error) {
                    w();
                    throw error;
                }
            });
            const readout = (read: () => number): number | string => {
                try {
                    return read();
                } catch (error) {
                    return error instanceof SignalCycleError ? "cycle" : (error as Error).message;
                }
            };
            const seen: Array<[number | string, number | string]> = [];
            const effect = Signal.effect(() => {
                seen.push([readout(driver), readout(dependent)]);
            });
            subject.next(5);
            subject.error(new Error("down"));
            expect(seen).toEqual([
                [0, 0],
                [5, 5],
                ["down", "down"],
            ]);

            // A read after the failure retries the upstream: the second connect.
            expect(signal()).toBe(10);

            expect(midConnect).toBeInstanceOf(SignalCycleError);
            // The dependent that read the receiver mid-connect keeps the cycle
            // error until an external change re-triggers it.
            expect(seen[3]).toEqual([10, "cycle"]);
            w.set(2);
            expect(seen[4]).toEqual([10, 12]);
            effect.unsubscribe();
        });

        it("a read after dispose serves the frozen value, and observing the signal does not reconnect the upstream", () => {
            const inner$ = new Subject<number>();
            const { source, counter } = counting(inner$);
            const signal = Signal.from(source, { default: 0 });

            signal();
            inner$.next(5);
            expect(signal()).toBe(5);
            signal.dispose();
            expect(counter.subscriptions).toBe(1);

            const seen: number[] = [];
            const effect = Signal.effect(() => {
                seen.push(signal());
            });
            expect(seen).toEqual([5]);
            expect(counter.subscriptions).toBe(1);
            inner$.next(10);
            expect(seen).toEqual([5]);
            effect.unsubscribe();
        });
    });
});
