import { BehaviorSubject, Observable, of } from "rxjs";
import { map } from "rxjs/operators";

import { SyncObservable } from "./SyncObservable";

describe("SyncObservable", () => {
    describe(".value", () => {
        it("returns synchronous current value from BehaviorSubject-like subscribe", () => {
            const bs = new BehaviorSubject(42);
            const sync$ = new SyncObservable<number>((subscriber) => {
                bs.subscribe(subscriber);
            });

            expect(sync$.value).toBe(42);
        });

        it("throws when no value is emitted immediately", () => {
            const sync$ = new SyncObservable<number>(() => {
                // never emits
            });

            expect(() => sync$.value).toThrow("No value emitted");
        });

        it("reflects the latest emitted value", () => {
            const bs = new BehaviorSubject("a");
            const sync$ = new SyncObservable<string>((subscriber) => {
                bs.subscribe(subscriber);
            });

            expect(sync$.value).toBe("a");
            bs.next("b");
            expect(sync$.value).toBe("b");
        });
    });

    describe("subscribe()", () => {
        it("works like a normal Observable", () => {
            const values: number[] = [];
            const bs = new BehaviorSubject(1);
            const sync$ = new SyncObservable<number>((subscriber) => {
                bs.subscribe(subscriber);
            });

            const sub = sync$.subscribe((v) => values.push(v));
            bs.next(2);
            bs.next(3);
            sub.unsubscribe();

            expect(values).toEqual([1, 2, 3]);
        });
    });

    describe("pipe()", () => {
        it("supports RxJS pipe operators", () => {
            const bs = new BehaviorSubject(5);
            const sync$ = new SyncObservable<number>((subscriber) => {
                bs.subscribe(subscriber);
            });

            const values: number[] = [];
            const sub = sync$.pipe(map((x) => x * 10)).subscribe((v) => values.push(v));

            bs.next(10);
            sub.unsubscribe();

            expect(values).toEqual([50, 100]);
        });
    });
});
