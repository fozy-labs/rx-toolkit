import { z } from "zod/v4";

import { LocalSignal } from "./LocalSignal";
import { LOCAL_STATE_GC_DEFAULTS } from "./LocalStateStorage";

const KEY_PREFIX = "__LSValue__";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Fixed fake epoch for deterministic GC tests. */
const BASE = 1_000_000_000_000;

function storageKey(key: string, userId?: string) {
    return userId ? `${KEY_PREFIX}:${key}:user:${userId}` : `${KEY_PREFIX}:${key}`;
}

function envelope(data: unknown, at = Date.now(), ttl?: number | null) {
    const env: Record<string, unknown> = { at, data };
    if (ttl !== undefined) env.ttl = ttl;
    return JSON.stringify(env);
}

function meta(v: number, nextGcAt: number) {
    return JSON.stringify({ v, nextGcAt });
}

function seedStorage(key: string, value: unknown, userId?: string) {
    localStorage.setItem(storageKey(key, userId), envelope(value));
}

type MockDriver = ReturnType<typeof createMockDriver>;

function createMockDriver(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));

    return {
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        setItem: (key: string, value: string) => void map.set(key, String(value)),
        removeItem: (key: string) => void map.delete(key),
        keys: () => [...map.keys()],
        map,
    };
}

/** A driver pre-marked with a valid meta so init neither wipes nor reschedules GC soon. */
function createMarkedDriver(entries: Record<string, string> = {}, nextGcAt = Date.now() + WEEK) {
    return createMockDriver({ [KEY_PREFIX]: meta(1, nextGcAt), ...entries });
}

function readMeta(driver: MockDriver) {
    const raw = driver.getItem(KEY_PREFIX);
    return raw === null ? null : (JSON.parse(raw) as { v: number; nextGcAt: number });
}

/** Activate the internal Computed so peek() reads from live state */
function activate(s: { obs: any }) {
    return s.obs.subscribe(() => {});
}

describe("LocalState", () => {
    // The very first LocalState over the default driver runs the one-time
    // namespace init (format check + wipe). Force it before any test seeds
    // data, so seeded envelopes are not swept away by that first wipe.
    beforeAll(() => {
        LocalSignal.state({ key: "__warmup__", defaultValue: 0 });
    });

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

        it("loads a user-scoped value from its own key", () => {
            seedStorage("test3", "mine", "u1");
            const s = LocalSignal.state({ key: "test3", userId: "u1", defaultValue: "def" });
            const sub = activate(s);
            expect(s.peek()).toBe("mine");
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

        it("set() persists an envelope to localStorage", () => {
            const s = LocalSignal.state({ key: "sp2", defaultValue: 0 });
            s.set(42);

            const raw = localStorage.getItem(storageKey("sp2"));
            expect(raw).not.toBeNull();
            const env = JSON.parse(raw!);
            expect(env.data).toBe(42);
            expect(typeof env.at).toBe("number");
        });

        it("update() persists to localStorage", () => {
            const s = LocalSignal.state({ key: "sp2u", defaultValue: 10 });
            s.update((value) => value + 5);

            const env = JSON.parse(localStorage.getItem(storageKey("sp2u"))!);
            expect(env.data).toBe(15);
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

        it("clear() removes the slot key from localStorage", () => {
            const s = LocalSignal.state({ key: "sp4", defaultValue: 0 });
            s.set(42);
            expect(localStorage.getItem(storageKey("sp4"))).not.toBeNull();

            s.clear();
            expect(localStorage.getItem(storageKey("sp4"))).toBeNull();
        });

        it.each([
            ["number zero", 0],
            ["empty string", ""],
            ["boolean false", false],
        ])("clear() removes a falsy value (%s) so it does not resurrect", (_label, falsy) => {
            const key = `falsy-remove-${String(falsy)}`;
            const s = LocalSignal.state<unknown>({ key, defaultValue: "def" });
            s.set(falsy);
            expect(localStorage.getItem(storageKey(key))).not.toBeNull();

            s.clear();
            expect(localStorage.getItem(storageKey(key))).toBeNull();

            const reloaded = LocalSignal.state<unknown>({ key, defaultValue: "def" });
            const sub = activate(reloaded);
            expect(reloaded.peek()).toBe("def");
            sub.unsubscribe();
        });
    });

    describe("per-user slot isolation", () => {
        it("users and common live in separate storage keys", () => {
            const common = LocalSignal.state<unknown>({ key: "iso", defaultValue: "def" });
            const u1 = LocalSignal.state<unknown>({ key: "iso", userId: "u1", defaultValue: "def" });

            common.set("common-value");
            u1.set("u1-value");

            expect(JSON.parse(localStorage.getItem(storageKey("iso"))!).data).toBe("common-value");
            expect(JSON.parse(localStorage.getItem(storageKey("iso", "u1"))!).data).toBe("u1-value");
        });

        it("a corrupted sibling slot does not affect this user's value", () => {
            seedStorage("sibling", 42, "u1");
            localStorage.setItem(storageKey("sibling", "u2"), "{broken json");

            const s = LocalSignal.state({ key: "sibling", userId: "u1", defaultValue: 0 });
            const sub = activate(s);
            expect(s.peek()).toBe(42);
            sub.unsubscribe();
        });

        it("set() does not rewrite or destroy sibling slots", () => {
            localStorage.setItem(storageKey("sibling-w", "u2"), "{broken json");
            seedStorage("sibling-w", "keep-me", "u3");

            const s = LocalSignal.state({ key: "sibling-w", userId: "u1", defaultValue: 0 });
            s.set(1);

            expect(localStorage.getItem(storageKey("sibling-w", "u2"))).toBe("{broken json");
            expect(JSON.parse(localStorage.getItem(storageKey("sibling-w", "u3"))!).data).toBe("keep-me");
        });

        it("clear() removes only own slot", () => {
            seedStorage("clear-iso", 42, "u2");
            const s = LocalSignal.state<unknown>({ key: "clear-iso", userId: "u1", defaultValue: "def" });
            s.set(0);

            s.clear();

            expect(localStorage.getItem(storageKey("clear-iso", "u1"))).toBeNull();
            expect(JSON.parse(localStorage.getItem(storageKey("clear-iso", "u2"))!).data).toBe(42);
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

        it("invalid data in storage → uses defaultValue and drops the slot", () => {
            seedStorage("zod2", "not-a-number");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({
                key: "zod2",
                zodSchema: z.number(),
                defaultValue: 0,
            });
            const sub = activate(s);
            expect(s.peek()).toBe(0);
            expect(localStorage.getItem(storageKey("zod2"))).toBeNull();
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
            sub.unsubscribe();
        });
    });

    describe("invalid storage data (self-heal)", () => {
        it("invalid JSON in storage → uses defaultValue and removes the entry", () => {
            localStorage.setItem(storageKey("bad"), "not-json!!!");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad", defaultValue: 7 });
            const sub = activate(s);
            expect(s.peek()).toBe(7);
            expect(localStorage.getItem(storageKey("bad"))).toBeNull();
            expect(warnSpy).toHaveBeenCalled();

            warnSpy.mockRestore();
            sub.unsubscribe();
        });

        it("a valid JSON that is not an envelope → defaultValue, entry removed", () => {
            localStorage.setItem(storageKey("bad-shape"), JSON.stringify({ common: 42 }));
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad-shape", defaultValue: 7 });
            const sub = activate(s);
            expect(s.peek()).toBe(7);
            expect(localStorage.getItem(storageKey("bad-shape"))).toBeNull();

            warnSpy.mockRestore();
            sub.unsubscribe();
        });

        it("set() over invalid JSON does not throw and rewrites storage", () => {
            localStorage.setItem(storageKey("bad-set"), "{broken");
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "bad-set", defaultValue: 0 });
            expect(() => s.set(42)).not.toThrow();

            const env = JSON.parse(localStorage.getItem(storageKey("bad-set"))!);
            expect(env.data).toBe(42);

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

    describe("gc option → envelope ttl", () => {
        it("default policy writes no ttl field", () => {
            const driver = createMarkedDriver();
            const s = LocalSignal.state({ key: "g1", defaultValue: 0, driver });
            s.set(1);

            const env = JSON.parse(driver.getItem(storageKey("g1"))!);
            expect("ttl" in env).toBe(false);
        });

        it("gc: false writes ttl: null (exempt)", () => {
            const driver = createMarkedDriver();
            const s = LocalSignal.state({ key: "g2", defaultValue: 0, driver, gc: false });
            s.set(1);

            expect(JSON.parse(driver.getItem(storageKey("g2"))!).ttl).toBeNull();
        });

        it("gc: { enabled: false } writes ttl: null", () => {
            const driver = createMarkedDriver();
            const s = LocalSignal.state({ key: "g3", defaultValue: 0, driver, gc: { enabled: false } });
            s.set(1);

            expect(JSON.parse(driver.getItem(storageKey("g3"))!).ttl).toBeNull();
        });

        it("gc: { maxUnreadTime } writes an explicit ttl", () => {
            const driver = createMarkedDriver();
            const s = LocalSignal.state({
                key: "g4",
                defaultValue: 0,
                driver,
                gc: { maxUnreadTime: 5 * DAY },
            });
            s.set(1);

            expect(JSON.parse(driver.getItem(storageKey("g4"))!).ttl).toBe(5 * DAY);
        });

        it("maxUnreadTime equal to the default is not persisted", () => {
            const driver = createMarkedDriver();
            const s = LocalSignal.state({
                key: "g5",
                defaultValue: 0,
                driver,
                gc: { maxUnreadTime: LOCAL_STATE_GC_DEFAULTS.maxUnreadTime },
            });
            s.set(1);

            expect("ttl" in JSON.parse(driver.getItem(storageKey("g5"))!)).toBe(false);
        });
    });

    describe("format versioning (meta key)", () => {
        it("no meta → whole namespace is wiped and re-marked", () => {
            const driver = createMockDriver({
                [storageKey("legacy")]: JSON.stringify({ common: 1, "user:u1": 2 }),
                [storageKey("legacy2", "u9")]: envelope(3),
                "unrelated-key": "keep",
            });

            const s = LocalSignal.state({ key: "legacy", defaultValue: -1, driver });
            const sub = activate(s);

            expect(s.peek()).toBe(-1);
            expect(driver.getItem(storageKey("legacy"))).toBeNull();
            expect(driver.getItem(storageKey("legacy2", "u9"))).toBeNull();
            expect(driver.getItem("unrelated-key")).toBe("keep");
            expect(readMeta(driver)?.v).toBe(1);
            sub.unsubscribe();
        });

        it("meta with an older version → wipe", () => {
            const driver = createMockDriver({
                [KEY_PREFIX]: meta(0, Date.now() + WEEK),
                [storageKey("v0-data")]: envelope(42),
            });

            LocalSignal.state({ key: "any", defaultValue: 0, driver });

            expect(driver.getItem(storageKey("v0-data"))).toBeNull();
            expect(readMeta(driver)?.v).toBe(1);
        });

        it("meta with a NEWER version → nothing is wiped, healed or collected", () => {
            const newerMeta = meta(2, Date.now() - WEEK);
            const driver = createMockDriver({
                [KEY_PREFIX]: newerMeta,
                [storageKey("future")]: '{"future-format": true}',
            });
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            const s = LocalSignal.state({ key: "future", defaultValue: "def", driver });
            const sub = activate(s);

            // Unknown envelope → defaultValue, but the entry is NOT removed:
            // it belongs to a newer format this session does not own.
            expect(s.peek()).toBe("def");
            expect(driver.getItem(storageKey("future"))).toBe('{"future-format": true}');
            expect(driver.getItem(KEY_PREFIX)).toBe(newerMeta);

            warnSpy.mockRestore();
            sub.unsubscribe();
        });

        it("valid current meta → data survives init", () => {
            const driver = createMarkedDriver({ [storageKey("kept")]: envelope(42) });

            const s = LocalSignal.state({ key: "kept", defaultValue: 0, driver });
            const sub = activate(s);
            expect(s.peek()).toBe(42);
            sub.unsubscribe();
        });
    });

    describe("GC", () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            vi.setSystemTime(BASE);
            // Deterministic jitter: schedule delay = 0.5 * randomOffset,
            // claim jitter = (0.5 * 2 - 1) * randomOffset = 0.
            vi.spyOn(Math, "random").mockReturnValue(0.5);
        });

        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        it("sweeps expired / broken slots, keeps fresh and exempt ones", () => {
            const driver = createMockDriver({
                [KEY_PREFIX]: meta(1, BASE - 1000), // overdue
                [storageKey("old")]: envelope(1, BASE - 61 * DAY),
                [storageKey("fresh")]: envelope(2, BASE - 1 * DAY),
                [storageKey("pinned")]: envelope(3, BASE - 200 * DAY, null),
                [storageKey("custom")]: envelope(4, BASE - 10 * DAY, 5 * DAY),
                [storageKey("broken")]: "not-json",
            });

            LocalSignal.state({ key: "fresh", defaultValue: 0, driver });

            // Overdue at init → sweep is postponed by random(0..randomOffset) = 30 min.
            expect(driver.getItem(storageKey("old"))).not.toBeNull();

            vi.advanceTimersByTime(30 * MINUTE);

            expect(driver.getItem(storageKey("old"))).toBeNull();
            expect(driver.getItem(storageKey("custom"))).toBeNull();
            expect(driver.getItem(storageKey("broken"))).toBeNull();
            expect(driver.getItem(storageKey("fresh"))).not.toBeNull();
            expect(driver.getItem(storageKey("pinned"))).not.toBeNull();

            // Deadline claimed: now + checkInterval (jitter mocked to 0).
            expect(readMeta(driver)?.nextGcAt).toBe(BASE + 30 * MINUTE + WEEK);
        });

        it("skips the sweep when another tab already moved the deadline", () => {
            const driver = createMockDriver({
                [KEY_PREFIX]: meta(1, BASE - 1000),
                [storageKey("old")]: envelope(1, BASE - 61 * DAY),
            });

            LocalSignal.state({ key: "unrelated", defaultValue: 0, driver });

            // "Another tab" claims the deadline before our timer fires.
            const foreignClaim = meta(1, BASE + 5 * WEEK);
            driver.setItem(KEY_PREFIX, foreignClaim);

            vi.advanceTimersByTime(30 * MINUTE);

            expect(driver.getItem(storageKey("old"))).not.toBeNull();
            expect(driver.getItem(KEY_PREFIX)).toBe(foreignClaim);
        });

        it("processes syncLimit keys per slice, the rest on a later tick", () => {
            const entries: Record<string, string> = { [KEY_PREFIX]: meta(1, BASE - 1000) };
            for (let i = 0; i < 25; i++) {
                entries[storageKey(`expired-${i}`)] = envelope(i, BASE - 61 * DAY);
            }
            const driver = createMockDriver(entries);

            LocalSignal.state({ key: "unrelated", defaultValue: 0, driver });

            const countExpired = () => driver.keys().filter((k) => k.includes("expired-")).length;

            // Fire only the due-timer: first synchronous slice of 20 keys.
            vi.advanceTimersToNextTimer();
            expect(countExpired()).toBe(5);

            // Next pending timer is the 0 ms chunk continuation.
            vi.advanceTimersToNextTimer();
            expect(countExpired()).toBe(0);
        });

        it("touch-on-read refreshes `at` no more than once per checkInterval", () => {
            const driver = createMarkedDriver(
                {
                    [storageKey("stale-read")]: envelope(1, BASE - 8 * DAY),
                    [storageKey("fresh-read")]: envelope(2, BASE - 1 * DAY),
                },
                BASE + WEEK,
            );

            LocalSignal.state({ key: "stale-read", defaultValue: 0, driver });
            LocalSignal.state({ key: "fresh-read", defaultValue: 0, driver });

            expect(JSON.parse(driver.getItem(storageKey("stale-read"))!).at).toBe(BASE);
            expect(JSON.parse(driver.getItem(storageKey("fresh-read"))!).at).toBe(BASE - 1 * DAY);
        });

        it("a driver without key enumeration works, just without GC", () => {
            const map = new Map<string, string>([[storageKey("kept"), envelope(42, BASE - 300 * DAY)]]);
            const driver = {
                getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
                setItem: (k: string, v: string) => void map.set(k, v),
                removeItem: (k: string) => void map.delete(k),
            };

            const s = LocalSignal.state({ key: "kept", defaultValue: 0, driver });
            const sub = activate(s);

            // Ancient but readable: no enumeration → no wipe, no sweep.
            expect(s.peek()).toBe(42);
            vi.advanceTimersByTime(10 * WEEK);
            expect(map.has(storageKey("kept"))).toBe(true);
            sub.unsubscribe();
        });
    });

    describe("DEFAULT_DRIVER import safety", () => {
        // `typeof localStorage` does NOT protect against a throwing getter: in a
        // sandboxed iframe (no allow-same-origin) / disabled storage the getter
        // throws SecurityError. Since DEFAULT_DRIVER is a static field, an
        // uncaught throw there aborts import of the whole module.
        it("resolves DEFAULT_DRIVER to null instead of throwing when localStorage access throws", async () => {
            const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
            Object.defineProperty(globalThis, "localStorage", {
                configurable: true,
                get() {
                    throw new DOMException("access denied", "SecurityError");
                },
            });

            try {
                vi.resetModules();
                const mod = await import("./LocalState");
                expect(mod.LocalState.DEFAULT_DRIVER).toBeNull();
            } finally {
                if (original) {
                    Object.defineProperty(globalThis, "localStorage", original);
                } else {
                    delete (globalThis as { localStorage?: unknown }).localStorage;
                }
                vi.resetModules();
            }
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
