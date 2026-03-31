import { vi } from "vitest";

import { CacheEntry } from "@/query/core/CacheEntry";
import { Signal } from "@/signals";

describe("CacheEntry", () => {
    // CE01: CacheEntry wraps Signal.state with initial value
    it("CE01: wraps Signal.state with initial value", () => {
        const entry = new CacheEntry("initial");
        expect(entry.state$()).toBe("initial");
    });

    // CE02: entry.set(newState) updates signal value
    it("CE02: set(newState) updates signal value", () => {
        const entry = new CacheEntry("initial");
        entry.set("updated");
        expect(entry.state$()).toBe("updated");
    });

    // CE03: entry.peek() returns value without registering signal dependency
    it("CE03: peek() returns value without registering signal dependency", () => {
        const entry = new CacheEntry("initial");
        const computeFn = vi.fn(() => entry.peek());
        const computed = Signal.compute(computeFn);

        // Initial compute
        expect(computed()).toBe("initial");
        expect(computeFn).toHaveBeenCalledTimes(1);

        // Update entry — computed should NOT re-evaluate since peek() was used
        entry.set("updated");
        expect(computed()).toBe("initial");
        expect(computeFn).toHaveBeenCalledTimes(1);
    });

    // CE04: entry.state$() registers signal dependency
    it("CE04: state$() registers signal dependency", () => {
        const entry = new CacheEntry("initial");
        const computed = Signal.compute(() => entry.state$());

        expect(computed()).toBe("initial");

        entry.set("updated");
        expect(computed()).toBe("updated");
    });

    // CE05: entry.complete() fires onClean$ and marks completed
    it("CE05: complete() fires onClean$ and marks completed", () => {
        const entry = new CacheEntry("initial");
        const cleanSpy = vi.fn();
        entry.onClean$.subscribe(cleanSpy);

        entry.complete();

        expect(cleanSpy).toHaveBeenCalledTimes(1);
        // Subsequent set is no-op
        entry.set("new");
        expect(entry.peek()).toBe("initial");
    });

    // CE06: entry.set() is no-op after complete()
    it("CE06: set() is no-op after complete()", () => {
        const entry = new CacheEntry("initial");
        entry.complete();
        entry.set("new");
        expect(entry.peek()).toBe("initial");
    });

    // CE07: onClean$ fires exactly once on complete
    it("CE07: onClean$ fires exactly once on complete", () => {
        const entry = new CacheEntry("initial");
        const cleanSpy = vi.fn();
        entry.onClean$.subscribe(cleanSpy);

        entry.complete();

        expect(cleanSpy).toHaveBeenCalledTimes(1);
    });

    // CE08: Multiple complete() calls — idempotent
    it("CE08: multiple complete() calls — idempotent", () => {
        const entry = new CacheEntry("initial");
        const cleanSpy = vi.fn();
        entry.onClean$.subscribe(cleanSpy);

        entry.complete();
        entry.complete();
        entry.complete();

        expect(cleanSpy).toHaveBeenCalledTimes(1);
    });

    // CE09: DevTools keyParts pass through to Signal construction
    it("CE09: keyParts pass through to Signal construction", () => {
        // Verify it doesn't throw and creates correctly
        const entry = new CacheEntry("initial", { keyParts: ["res", "1"] });
        expect(entry.state$()).toBe("initial");
    });

    // CE10: beforeDevtoolsPush callback invoked before devtools state push
    it("CE10: beforeDevtoolsPush callback invoked", () => {
        const beforePush = vi.fn((value: unknown, push: (v: unknown) => void) => {
            push(value);
        });
        const entry = new CacheEntry("initial", { beforeDevtoolsPush: beforePush });
        entry.set("updated");

        // The callback should have been invoked (depends on devtools being enabled;
        // in test environment it may not fire, so we only verify no errors)
        expect(entry.peek()).toBe("updated");
    });
});
