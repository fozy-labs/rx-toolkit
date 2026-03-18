import { z } from "zod/v4";

import { LocalSignal, LocalState } from "./LocalState";
import { Signal } from "./Signal";

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
            const s = LocalState.create({ key: "test1", defaultValue: 0 });
            const sub = activate(s);
            expect(s.peek()).toBe(0);
            sub.unsubscribe();
        });

        it("loads stored value from localStorage on creation", () => {
            seedStorage("test2", 42);
            const s = LocalState.create({ key: "test2", defaultValue: 0 });
            const sub = activate(s);
            expect(s.peek()).toBe(42);
            sub.unsubscribe();
        });
    });

    describe("set / peek / clear", () => {
        it("set() updates the value", () => {
            const s = LocalState.create({ key: "sp1", defaultValue: 0 });
            const sub = activate(s);
            s.set(99);
            expect(s.peek()).toBe(99);
            sub.unsubscribe();
        });

        it("set() persists to localStorage", () => {
            const s = LocalState.create({ key: "sp2", defaultValue: 0 });
            s.set(42);

            const raw = localStorage.getItem(storageKey("sp2"));
            expect(raw).not.toBeNull();
            const data = JSON.parse(raw!);
            expect(data.common).toBe(42);
        });

        it("clear() resets to defaultValue", () => {
            const s = LocalState.create({ key: "sp3", defaultValue: "default" });
            const sub = activate(s);
            s.set("changed");
            expect(s.peek()).toBe("changed");

            s.clear();
            expect(s.peek()).toBe("default");
            sub.unsubscribe();
        });

        it("clear() removes entry from localStorage", () => {
            const s = LocalState.create({ key: "sp4", defaultValue: 0 });
            s.set(42);
            expect(localStorage.getItem(storageKey("sp4"))).not.toBeNull();

            s.clear();
            expect(localStorage.getItem(storageKey("sp4"))).toBeNull();
        });
    });

    describe("observable", () => {
        it("obs exists and can be subscribed", () => {
            const s = LocalState.create({ key: "obs1", defaultValue: 1 });
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
            const s = LocalState.create({
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
            const s = LocalState.create({
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
        it("invalid JSON in storage throws", () => {
            localStorage.setItem(storageKey("bad"), "not-json!!!");
            expect(() => {
                LocalState.create({ key: "bad", defaultValue: 0 });
            }).toThrow();
        });
    });

    describe("checkEffect option", () => {
        it("valid value passes through", () => {
            const s = LocalState.create({
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
            const s = LocalState.create({
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

    describe("deprecated API", () => {
        it("LocalSignal is an alias for LocalState", () => {
            expect(LocalSignal).toBe(LocalState);
        });
    });
});
