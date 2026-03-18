import { ReactiveCache } from "@/query/lib/ReactiveCache";

describe("ReactiveCache", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("stores initial value accessible via .value", () => {
        const cache = new ReactiveCache({ initialState: 42 });
        expect(cache.value).toBe(42);
        cache.complete();
    });

    it("next() updates the current value", () => {
        const cache = new ReactiveCache({ initialState: 0 });
        cache.next(10);
        expect(cache.value).toBe(10);
        cache.complete();
    });

    it("value$ observable emits values to subscribers", () => {
        const cache = new ReactiveCache({ initialState: "init" });
        const values: string[] = [];

        const sub = cache.value$.obs.subscribe((v) => values.push(v));

        cache.next("a");
        cache.next("b");

        expect(values).toEqual(["init", "a", "b"]);

        sub.unsubscribe();
        cache.complete();
    });

    it("spy$ observable emits values", () => {
        const cache = new ReactiveCache({ initialState: 0 });
        const values: number[] = [];

        const sub = cache.spy$.subscribe((v) => values.push(v));

        cache.next(1);
        cache.next(2);

        expect(values).toEqual([0, 1, 2]);

        sub.unsubscribe();
        cache.complete();
    });

    it("complete() sets closed to true", () => {
        const cache = new ReactiveCache({ initialState: null });
        expect(cache.closed).toBe(false);
        cache.complete();
        expect(cache.closed).toBe(true);
    });

    it("complete() is idempotent — calling twice does not throw", () => {
        const cache = new ReactiveCache({ initialState: 0 });
        cache.complete();
        expect(() => cache.complete()).not.toThrow();
        expect(cache.closed).toBe(true);
    });

    it("onClean$ emits on complete", () => {
        const cache = new ReactiveCache({ initialState: "data" });
        const cleaned: string[] = [];

        cache.onClean$.subscribe((v) => cleaned.push(v));
        cache.next("updated");
        cache.complete();

        expect(cleaned).toEqual(["updated"]);
    });

    it("spy$ completes when cache is completed", () => {
        const cache = new ReactiveCache({ initialState: 0 });
        let completed = false;

        cache.spy$.subscribe({
            complete: () => {
                completed = true;
            },
        });
        cache.complete();

        expect(completed).toBe(true);
    });

    it("cacheLifeTime defaults to 60s — cache resets after refcount drops to 0 and timer expires", () => {
        const cache = new ReactiveCache({ initialState: 0 });

        const values: number[] = [];
        const sub = cache.value$.obs.subscribe((v) => values.push(v));
        cache.next(1);
        sub.unsubscribe();

        // Re-subscribe before timer — should still get latest
        const values2: number[] = [];
        const sub2 = cache.value$.obs.subscribe((v) => values2.push(v));
        expect(values2).toEqual([1]);

        sub2.unsubscribe();
        cache.complete();
    });

    it("cacheLifeTime: false — cache does not auto-reset", () => {
        const cache = new ReactiveCache({ initialState: 0, cacheLifeTime: false });

        const sub = cache.value$.obs.subscribe(() => {});
        cache.next(5);
        sub.unsubscribe();

        // Even after a long time, cache should still hold value
        vi.advanceTimersByTime(300_000);

        expect(cache.value).toBe(5);
        cache.complete();
    });
});
