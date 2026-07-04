import { z } from "zod/v4";

import { LocalSignal } from "./LocalSignal";

const KEY_PREFIX = "__LSValue__";

function storageKey(key: string) {
    return `${KEY_PREFIX}:${key}`;
}

function seedStorage(key: string, value: unknown, userId?: string) {
    const subKey = userId ? `user:${userId}` : "common";
    const existing = localStorage.getItem(storageKey(key));
    const data = existing ? JSON.parse(existing) : {};
    data[subKey] = value;
    localStorage.setItem(storageKey(key), JSON.stringify(data));
}

/** Activate the internal Computed so peek() reads from live state */
function activate(s: { obs: any }) {
    return s.obs.subscribe(() => {});
}

describe("LocalState", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe("creation", () => {
        it("creates with defaultValue when no stored data", () => {
            const s = LocalSignal.state({ key: "test1", defaultValue: 0 });
            const sub = activate(s);
            expect(s.peek()).toBe(0);
            sub.unsubscribe();
        });

        it("loads stored value from localStorage on creation", () => {
            seedStorage("test2", 42);
            const s = LocalSignal.state({ key: "test2", defaultValue: 0 });
            const sub = activate(s);
            expect(s.peek()).toBe(42);
            sub.unsubscribe();
        });
    });

    describe("set / update / peek / clear", () => {
        it("set() updates the value", () => {
            const s = LocalSignal.state({ key: "sp1", defaultValue: 0 });
            const sub = activate(s);
            s.set(99);
            expect(s.peek()).toBe(99);
            sub.unsubscribe();
        });

        it("update() updates the value", () => {
            const s = LocalSignal.state({ key: "sp1u", defaultValue: 0 });
            const sub = activate(s);
            s.update((value) => value + 1);
            expect(s.peek()).toBe(1);
            sub.unsubscribe();
        });

        it("set() persists to localStorage", () => {
            const s = LocalSignal.state({ key: "sp2", defaultValue: 0 });
            s.set(42);

            const raw = localStorage.getItem(storageKey("sp2"));
            expect(raw).not.toBeNull();
            const data = JSON.parse(raw!);
            expect(data.common).toBe(42);
        });

        it("update() persists to localStorage", () => {
            const s = LocalSignal.state({ key: "sp2u", defaultValue: 10 });
            s.update((value) => value + 5);

            const raw = localStorage.getItem(storageKey("sp2u"));
            expect(raw).not.toBeNull();
            const data = JSON.parse(raw!);
            expect(data.common).toBe(15);
        });

        it("clear() resets to defaultValue", () => {
            const s = LocalSignal.state({ key: "sp3", defaultValue: "default" });
            const sub = activate(s);
            s.set("changed");
            expect(s.peek()).toBe("changed");

            s.clear();
            expect(s.peek()).toBe("default");
            sub.unsubscribe();
        });

        it("clear() removes entry from localStorage", () => {
            const s = LocalSignal.state({ key: "sp4", defaultValue: 0 });
            s.set(42);
            expect(localStorage.getItem(storageKey("sp4"))).not.toBeNull();

            s.clear();
            expect(localStorage.getItem(storageKey("sp4"))).toBeNull();
        });
    });

    describe("observable", () => {
        it("obs exists and can be subscribed", () => {
            const s = LocalSignal.state({ key: "obs1", defaultValue: 1 });
            expect(s.obs).toBeDefined();

            const values: number[] = [];
            const sub = s.obs.subscribe((v: number) => values.push(v));

            expect(values).toEqual([1]);

            s.set(2);
            expect(values).toEqual([1, 2]);

            sub.unsubscribe();
        });
    });

    describe("zod schema validation", () => {
        it("valid data accepted from storage", () => {
            seedStorage("zod1", 42);
            const s = LocalSignal.state({
                key: "zod1",
                zodSchema: z.number(),
                defaultValue: 0,
            });
            const sub = activate(s);
            expect(s.peek()).toBe(42);
            sub.unsubscribe();
        });

        it("invalid data in storage → uses defaultValue", () => {
            seedStorage("zod2", "not-a-number");
            const s = LocalSignal.state({
                key: "zod2",
                zodSchema: z.number(),
                defaultValue: 0,
            });
            const sub = activate(s);
            expect(s.peek()).toBe(0);
            sub.unsubscribe();
        });
    });

    describe("invalid storage data", () => {
        it("invalid JSON in storage → uses defaultValue instead of throwing", () => {
            localStorage.setItem(storageKey("bad"), "not-json!!!");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad", defaultValue: 7 });
            const sub = activate(s);
            expect(s.peek()).toBe(7);
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
            sub.unsubscribe();
        });

        it("set() over invalid JSON does not throw and rewrites storage", () => {
            localStorage.setItem(storageKey("bad-set"), "{broken");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad-set", defaultValue: 0 });
            expect(() => s.set(42)).not.toThrow();

            const data = JSON.parse(localStorage.getItem(storageKey("bad-set"))!);
            expect(data.common).toBe(42);

            warnSpy.mockRestore();
        });

        it("update() over invalid JSON does not throw", () => {
            localStorage.setItem(storageKey("bad-update"), "][");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad-update", defaultValue: 10 });
            const sub = activate(s);
            expect(() => s.update((v) => v + 1)).not.toThrow();
            expect(s.peek()).toBe(11);

            warnSpy.mockRestore();
            sub.unsubscribe();
        });

        it("clear() over invalid JSON does not throw and removes the key", () => {
            localStorage.setItem(storageKey("bad-clear"), "][");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad-clear", defaultValue: 0 });
            expect(() => s.clear()).not.toThrow();
            expect(localStorage.getItem(storageKey("bad-clear"))).toBeNull();

            warnSpy.mockRestore();
        });
    });

    describe("checkEffect option", () => {
        it("valid value passes through", () => {
            const s = LocalSignal.state({
                key: "ce1",
                defaultValue: 0,
                checkEffect: (v: number) => v >= 0,
            });
            const sub = activate(s);

            s.set(5);
            expect(s.peek()).toBe(5);
            sub.unsubscribe();
        });

        it("invalid value reverts to defaultValue", () => {
            const s = LocalSignal.state({
                key: "ce2",
                defaultValue: 0,
                checkEffect: (v: number) => v >= 0,
            });
            const sub = activate(s);

            s.set(-1);
            expect(s.peek()).toBe(0);
            sub.unsubscribe();
        });
    });
});
