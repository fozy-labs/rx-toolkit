import { BehaviorSubject, ReplaySubject, type Subscriber } from "rxjs";

import { Signal } from "../signals/Signal";

import { Batcher } from "./Batcher";
import { SourceSignal } from "./SourceSignal";

describe("SourceSignal", () => {
    describe("SourceSignal.create(subscribe)", () => {
        it("creates a callable signal from subscribe function", () => {
            const signal = SourceSignal.create<number>((subscriber) => {
                subscriber.next(42);
            });

            expect(typeof signal).toBe("function");
            expect(signal()).toBe(42);
        });
    });

    describe("peek()", () => {
        it("returns current value synchronously", () => {
            const signal = SourceSignal.create<string>((subscriber) => {
                subscriber.next("hello");
            });

            expect(signal.peek()).toBe("hello");
        });
    });

    describe("obs", () => {
        it("returns Observable that emits values on subscription", () => {
            const subject = new BehaviorSubject(10);
            const signal = SourceSignal.create<number>((subscriber) => {
                subject.subscribe(subscriber);
            });

            const values: number[] = [];
            const sub = signal.obs.subscribe((v: number) => values.push(v));

            subject.next(20);
            subject.next(30);
            sub.unsubscribe();

            expect(values).toEqual([10, 20, 30]);
        });
    });

    describe("calling signal()", () => {
        it("returns the current value (equivalent to get())", () => {
            const signal = SourceSignal.create<number>((subscriber) => {
                subscriber.next(99);
            });

            expect(signal()).toBe(99);
            expect(signal.get()).toBe(99);
            expect(signal.peek()).toBe(99);
        });

        it("an unobserved computed over it reads the producer afresh", () => {
            let external = 1;
            const signal = SourceSignal.create<number>((subscriber) => {
                subscriber.next(external);
            });
            const tenfold = Signal.compute(() => signal() * 10);

            expect(tenfold.peek()).toBe(10);
            expect(tenfold.peek()).toBe(10);
            external = 2;
            expect(tenfold.peek()).toBe(20);
        });

        it("a producer that fails synchronously runs once for an .obs subscriber and its error is delivered", () => {
            let runs = 0;
            const signal = SourceSignal.create<number>((subscriber) => {
                runs += 1;
                subscriber.error(new Error(`fail${runs}`));
            });
            let caught: unknown = null;
            signal.obs.subscribe({ error: (e) => (caught = e) });

            expect(runs).toBe(1);
            expect((caught as Error).message).toBe("fail1");
        });
    });

    describe("readonly contract", () => {
        it("has no set() method", () => {
            const signal = SourceSignal.create<number>((subscriber) => {
                subscriber.next(1);
            });

            expect(signal).not.toHaveProperty("set");
        });
    });

    describe("defaultValue", () => {
        it("returns the default until the source emits", () => {
            const subject = new ReplaySubject<number>(1);
            const signal = SourceSignal.create<number>((subscriber) => {
                subject.subscribe(subscriber);
            }, 0);

            expect(signal()).toBe(0);
            expect(signal.peek()).toBe(0);

            subject.next(5);
            expect(signal()).toBe(5);
        });

        it("throws without a default when the source has no synchronous value", () => {
            const signal = SourceSignal.create<number>(() => {
                // never emits
            });

            expect(() => signal()).toThrow("No value emitted");
        });
    });

    describe("completion", () => {
        /** Logs a subscriber's values and its completion. */
        const log = (into: unknown[], tag = "") => ({
            next: (v: unknown) => into.push(`${tag}${String(v)}`),
            complete: () => into.push(`${tag}complete`),
        });

        function triggered() {
            const state = { runs: 0, subscriber: null as Subscriber<number> | null };
            const signal = SourceSignal.create<number>((subscriber) => {
                state.runs++;
                state.subscriber = subscriber;
            }, 0);
            return { signal, state };
        }

        it(".obs subscribers get the last value, then complete", () => {
            const { signal, state } = triggered();
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen, "a:"));
            signal.obs.subscribe(log(seen, "b:"));

            state.subscriber!.next(1);
            state.subscriber!.next(2);
            state.subscriber!.complete();

            expect(seen.filter((e) => String(e).startsWith("a:"))).toEqual(["a:1", "a:2", "a:complete"]);
            expect(seen.filter((e) => String(e).startsWith("b:"))).toEqual(["b:1", "b:2", "b:complete"]);
        });

        it("after completion the producer starts afresh for the next reader and subscriber", () => {
            const { signal, state } = triggered();
            signal.obs.subscribe();
            state.subscriber!.next(1);
            state.subscriber!.complete();

            expect(signal()).toBe(0);
            expect(state.runs).toBe(2);
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));
            expect(state.runs).toBe(3);
            state.subscriber!.next(7);
            expect(seen).toEqual(["7"]);
        });

        it("a synchronous producer that completes: one run, one value, then complete", () => {
            // A live bridge elsewhere: reads drain pending deliveries first.
            const keep = SourceSignal.create<number>(() => {}).obs.subscribe();
            let runs = 0;
            const signal = SourceSignal.create<number>((subscriber) => {
                runs++;
                subscriber.next(1);
                subscriber.next(2);
                subscriber.complete();
            });
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));

            expect(seen).toEqual(["2", "complete"]);
            expect(runs).toBe(1);
            expect(signal()).toBe(2);
            expect(runs).toBe(2);
            keep.unsubscribe();
        });

        it("inside a batch: one value, then complete, when the batch ends", () => {
            const { signal, state } = triggered();
            const seen: unknown[] = [];
            signal.obs.subscribe(log(seen));

            Batcher.run(() => {
                state.subscriber!.next(1);
                state.subscriber!.next(2);
                state.subscriber!.complete();
                seen.push("batch end");
            });

            expect(seen).toEqual(["batch end", "2", "complete"]);
        });
    });
});
