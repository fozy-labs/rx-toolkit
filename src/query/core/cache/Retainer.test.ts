import { BehaviorSubject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Retainer, type TRetainerOptions } from "./Retainer";

// ==================== Helpers ====================

function createRetainer(overrides: Partial<TRetainerOptions> = {}) {
    const source = new BehaviorSubject<number>(0);
    const opts = {
        retentionTime: vi.fn((): number | null => 1000),
        key: "test:1",
        onActive: vi.fn(),
        onMelting: vi.fn(),
        onExpire: vi.fn(),
        ...overrides,
    };
    const retainer = new Retainer<number>(source, opts);
    return { source, retainer, opts };
}

// ==================== Tests ====================

describe("Retainer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ==================== Birth ====================

    it("is born melting, without a timer: the policy runs on the active → retention transition only", () => {
        const { retainer, opts } = createRetainer();

        expect(retainer.isMelting).toBe(true);
        expect(opts.retentionTime).not.toHaveBeenCalled();

        vi.advanceTimersByTime(60_000);
        expect(opts.onExpire).not.toHaveBeenCalled();
        expect(opts.onActive).not.toHaveBeenCalled();
    });

    // ==================== hold / release ====================

    it("hold() makes it active, the release makes it melting again", () => {
        const { retainer, opts } = createRetainer();

        const release = retainer.hold();
        expect(retainer.isMelting).toBe(false);
        expect(opts.onActive).toHaveBeenCalledTimes(1);
        expect(opts.onMelting).not.toHaveBeenCalled();

        release();
        expect(retainer.isMelting).toBe(true);
        expect(opts.onMelting).toHaveBeenCalledTimes(1);
    });

    it("the hooks fire on the 0 ↔ 1 edges only", () => {
        const { retainer, opts } = createRetainer();

        const releaseA = retainer.hold();
        const releaseB = retainer.hold();
        expect(opts.onActive).toHaveBeenCalledTimes(1);

        releaseA();
        expect(retainer.isMelting).toBe(false);
        expect(opts.onMelting).not.toHaveBeenCalled();

        releaseB();
        expect(retainer.isMelting).toBe(true);
        expect(opts.onMelting).toHaveBeenCalledTimes(1);
    });

    it("a repeated release is a no-op", () => {
        const { retainer, opts } = createRetainer();

        const release = retainer.hold();
        release();
        release();

        expect(opts.onMelting).toHaveBeenCalledTimes(1);
        expect(opts.retentionTime).toHaveBeenCalledTimes(1);

        // The count did not go negative: the next hold is a real 0 → 1 edge.
        retainer.hold();
        expect(retainer.isMelting).toBe(false);
        expect(opts.onActive).toHaveBeenCalledTimes(2);
    });

    // ==================== Retention timer ====================

    it("the last release arms the policy's delay; expiry fires onExpire once", () => {
        const { retainer, opts } = createRetainer({ retentionTime: () => 5000 });

        retainer.hold()();

        vi.advanceTimersByTime(4999);
        expect(opts.onExpire).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(opts.onExpire).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(60_000);
        expect(opts.onExpire).toHaveBeenCalledTimes(1);
    });

    it("a hold before expiry disarms the timer", () => {
        const { retainer, opts } = createRetainer({ retentionTime: () => 5000 });

        retainer.hold()();
        vi.advanceTimersByTime(3000);

        const release = retainer.hold();
        vi.advanceTimersByTime(10_000);
        expect(opts.onExpire).not.toHaveBeenCalled();

        // The next release starts a fresh cycle with the full delay.
        release();
        vi.advanceTimersByTime(4999);
        expect(opts.onExpire).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(opts.onExpire).toHaveBeenCalledTimes(1);
    });

    it("the policy runs once per melting cycle, after onMelting", () => {
        const order: string[] = [];
        const { retainer, opts } = createRetainer({
            retentionTime: vi.fn(() => {
                order.push("retentionTime");
                return 1000;
            }),
            onMelting: vi.fn(() => {
                order.push("onMelting");
            }),
        });

        retainer.hold()();
        expect(order).toEqual(["onMelting", "retentionTime"]);

        retainer.hold()();
        expect(opts.retentionTime).toHaveBeenCalledTimes(2);
    });

    it("a null delay arms no timer", () => {
        const { retainer, opts } = createRetainer({ retentionTime: () => null });

        retainer.hold()();
        expect(retainer.isMelting).toBe(true);

        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
        expect(opts.onExpire).not.toHaveBeenCalled();
    });

    it("a throwing policy is logged with the key and read as an immediate eviction", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { retainer, opts } = createRetainer({
            key: "users:1",
            retentionTime: () => {
                throw new Error("retention boom");
            },
        });

        // The throw must not escape the release (a consumer's teardown).
        expect(() => retainer.hold()()).not.toThrow();

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0]?.[0])).toContain("users:1");

        vi.advanceTimersByTime(0);
        expect(opts.onExpire).toHaveBeenCalledTimes(1);
    });

    // ==================== obs ====================

    it("subscribing to obs is a hold for the life of the subscription", () => {
        const { retainer, opts } = createRetainer();

        const subscription = retainer.obs.subscribe();
        expect(retainer.isMelting).toBe(false);
        expect(opts.onActive).toHaveBeenCalledTimes(1);

        subscription.unsubscribe();
        expect(retainer.isMelting).toBe(true);
        expect(opts.onMelting).toHaveBeenCalledTimes(1);
    });

    it("obs relays the source, replaying its current value", () => {
        const { source, retainer } = createRetainer();
        const seen: number[] = [];

        const subscription = retainer.obs.subscribe((value) => seen.push(value));
        source.next(1);
        subscription.unsubscribe();
        source.next(2);

        expect(seen).toEqual([0, 1]);
    });

    it("onActive runs before the subscriber attaches: a value set there is its first value", () => {
        const source = new BehaviorSubject<number>(0);
        const retainer = new Retainer<number>(source, {
            retentionTime: () => null,
            key: "test:1",
            onActive: () => source.next(1),
            onMelting: () => {},
            onExpire: () => {},
        });
        const seen: number[] = [];

        retainer.obs.subscribe((value) => seen.push(value));

        expect(seen).toEqual([1]);
    });

    it("onMelting runs after the subscriber detached: a value set there is not delivered to it", () => {
        const source = new BehaviorSubject<number>(0);
        const retainer = new Retainer<number>(source, {
            retentionTime: () => null,
            key: "test:1",
            onActive: () => {},
            onMelting: () => source.next(1),
            onExpire: () => {},
        });
        const seen: number[] = [];

        retainer.obs.subscribe((value) => seen.push(value)).unsubscribe();

        expect(seen).toEqual([0]);
        expect(source.getValue()).toBe(1);
    });

    it("subscribers and explicit holds share one count", () => {
        const { retainer, opts } = createRetainer();

        const subscription = retainer.obs.subscribe();
        const release = retainer.hold();
        expect(opts.onActive).toHaveBeenCalledTimes(1);

        subscription.unsubscribe();
        expect(retainer.isMelting).toBe(false);

        release();
        expect(retainer.isMelting).toBe(true);
        expect(opts.onMelting).toHaveBeenCalledTimes(1);
    });

    // ==================== onActive throwing ====================

    it("a throwing onActive hands the hold back and rethrows", () => {
        const failure = new Error("active boom");
        const { retainer, opts } = createRetainer({
            onActive: vi.fn(() => {
                throw failure;
            }),
        });

        expect(() => retainer.hold()).toThrow(failure);
        expect(retainer.isMelting).toBe(true);
        expect(opts.onMelting).toHaveBeenCalledTimes(1);
    });

    // ==================== dispose ====================

    it("dispose() disarms the timer", () => {
        const { retainer, opts } = createRetainer({ retentionTime: () => 5000 });

        retainer.hold()();
        retainer.dispose();

        vi.advanceTimersByTime(60_000);
        expect(opts.onExpire).not.toHaveBeenCalled();
    });

    it("dispose() with live holds: their later release is a no-op", () => {
        const { retainer, opts } = createRetainer();

        const release = retainer.hold();
        retainer.dispose();
        release();

        expect(opts.onMelting).not.toHaveBeenCalled();
        expect(opts.retentionTime).not.toHaveBeenCalled();
    });

    it("hold() after dispose() is a no-op returning a no-op release", () => {
        const { retainer, opts } = createRetainer();
        retainer.dispose();

        const release = retainer.hold();
        expect(retainer.isMelting).toBe(true);
        expect(opts.onActive).not.toHaveBeenCalled();

        release();
        expect(opts.onMelting).not.toHaveBeenCalled();
    });

    it("a subscription after dispose() does not hold but still relays the source", () => {
        const { source, retainer, opts } = createRetainer();
        retainer.dispose();
        source.complete();

        let isCompleted = false;
        retainer.obs.subscribe({ complete: () => (isCompleted = true) });

        expect(isCompleted).toBe(true);
        expect(opts.onActive).not.toHaveBeenCalled();
    });
});
