import { BehaviorSubject, Observable, ReplaySubject, Subject } from "rxjs";

import { signalize } from "./signalize";

describe("signalize", () => {
    describe("with BehaviorSubject", () => {
        it("creates a read-only signal with initial value", () => {
            const bs$ = new BehaviorSubject(42);
            const signal = signalize(bs$);

            expect(signal.peek()).toBe(42);
        });

        it("peek() returns current value without tracking", () => {
            const bs$ = new BehaviorSubject("hello");
            const signal = signalize(bs$);

            expect(signal.peek()).toBe("hello");

            bs$.next("world");
            expect(signal.peek()).toBe("world");
        });

        it("calling as function returns current value", () => {
            const bs$ = new BehaviorSubject(10);
            const signal = signalize(bs$);

            expect(signal()).toBe(10);

            bs$.next(20);
            expect(signal()).toBe(20);
        });

        it("obs emits values when source updates", () => {
            const bs$ = new BehaviorSubject(1);
            const signal = signalize(bs$);

            const values: number[] = [];
            const sub = signal.obs.subscribe((v: number) => values.push(v));

            bs$.next(2);
            bs$.next(3);

            sub.unsubscribe();

            // BehaviorSubject replays current value on subscribe, then emits updates
            expect(values).toEqual([1, 2, 3]);
        });

        it("does not expose a set method (readonly contract)", () => {
            const bs$ = new BehaviorSubject(0);
            const signal = signalize(bs$);

            expect((signal as any).set).toBeUndefined();
        });

        it("reflects source changes through peek()", () => {
            const bs$ = new BehaviorSubject("a");
            const signal = signalize(bs$);

            bs$.next("b");
            bs$.next("c");

            expect(signal.peek()).toBe("c");
        });
    });

    describe("with Observable (synchronous initial value)", () => {
        it("creates a read-only signal from a plain observable with sync value", () => {
            // An observable that emits synchronously on subscribe
            const obs$ = new Observable<number>((subscriber) => {
                subscriber.next(99);
            });
            const signal = signalize(obs$);

            expect(signal.peek()).toBe(99);
        });

        it("throws when observable emits no synchronous value", () => {
            const obs$ = new Observable<number>(() => {
                // never emits
            });

            const signal = signalize(obs$);
            expect(() => signal.peek()).toThrow("No value emitted");
        });
    });

    describe("with Subject (via BehaviorSubject)", () => {
        it("tracks multiple sequential updates", () => {
            const bs$ = new BehaviorSubject(0);
            const signal = signalize(bs$);

            for (let i = 1; i <= 5; i++) {
                bs$.next(i);
            }

            expect(signal.peek()).toBe(5);
            expect(signal()).toBe(5);
        });

        it("subscription can be unsubscribed independently", () => {
            const bs$ = new BehaviorSubject(0);
            const signal = signalize(bs$);

            const values: number[] = [];
            const sub = signal.obs.subscribe((v: number) => values.push(v));

            bs$.next(1);
            sub.unsubscribe();
            bs$.next(2);

            expect(values).toEqual([0, 1]);
            // Signal still reflects latest source value
            expect(signal.peek()).toBe(2);
        });
    });

    describe("with defaultValue", () => {
        it("returns the default until an async source emits", () => {
            const subject = new ReplaySubject<number>(1);
            const signal = signalize(subject, 0);

            expect(signal.peek()).toBe(0);

            subject.next(10);
            expect(signal.peek()).toBe(10);
        });

        it("throws without a default when the source emits no synchronous value", () => {
            const subject = new Subject<number>();
            const signal = signalize(subject);

            expect(() => signal.peek()).toThrow("No value emitted");
        });

        it("treats undefined as a valid default", () => {
            const subject = new Subject<number | undefined>();
            const signal = signalize(subject, undefined);

            expect(signal.peek()).toBeUndefined();
        });
    });
});
