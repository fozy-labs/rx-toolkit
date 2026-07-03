import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Resource } from "../core/resource/Resource";
import { Syncer, type ISyncerConfig } from "../core/syncer/Syncer";
import { stableStringify } from "../lib/stableStringify";
import type { ISyncDriver, ISyncMessage } from "../types";

// ── Helpers ────────────────────────────────────────────────────────

function createMockDriver(): ISyncDriver & {
    lastSent: ISyncMessage | null;
    simulateMessage: (msg: ISyncMessage) => void;
} {
    let onMessage: ((msg: ISyncMessage) => void) | null = null;
    return {
        lastSent: null,
        connect(cb) {
            onMessage = cb;
        },
        disconnect: vi.fn(),
        send(msg) {
            this.lastSent = msg;
        },
        simulateMessage(msg) {
            onMessage?.(msg);
        },
    };
}

function createMockResource(
    entries: Array<{
        key: string;
        status: string;
        data?: unknown;
        patchState?: { originalData: unknown } | null;
    }>,
) {
    return {
        getEntries: () =>
            entries.map((e) => ({
                keyedArgs: { key: e.key },
                peek: () => ({
                    state: {
                        status: e.status,
                        data: e.data,
                        patchState: e.patchState ?? null,
                    },
                }),
            })),
        getEntryByKey: (key: string) => {
            const found = entries.find((e) => e.key === key);
            if (!found) return null;
            return {
                peek: () => ({
                    state: {
                        status: found.status,
                        data: found.data,
                        patchState: found.patchState ?? null,
                    },
                }),
            };
        },
    } as any;
}

function createSyncer(overrides?: Partial<ISyncerConfig>) {
    const driver = createMockDriver();
    const config: ISyncerConfig = {
        syncDriver: driver,
        keyPrefix: "test",
        defaultSync: "all",
        resourcesByKey: new Map(),
        ...overrides,
    };
    const syncer = new Syncer(config);
    return { syncer, driver, config };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Syncer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("crypto", { randomUUID: () => "mock-uuid-1" });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ── Instantiation ──────────────────────────────────────────────

    it("constructs without errors", () => {
        const { syncer } = createSyncer();
        expect(syncer).toBeInstanceOf(Syncer);
    });

    it("connect() calls syncDriver.connect", () => {
        const { syncer, driver } = createSyncer();
        const connectSpy = vi.spyOn(driver, "connect");
        syncer.connect();
        expect(connectSpy).toHaveBeenCalledOnce();
    });

    // ── isResourceSyncEnabled ──────────────────────────────────────

    it("returns explicit sync=true from options", () => {
        const { syncer } = createSyncer({ defaultSync: "none" });
        expect(syncer.isResourceSyncEnabled({ sync: true } as any)).toBe(true);
    });

    it("returns explicit sync=false from options", () => {
        const { syncer } = createSyncer({ defaultSync: "all" });
        expect(syncer.isResourceSyncEnabled({ sync: false } as any)).toBe(false);
    });

    it('falls back to true when defaultSync is "all"', () => {
        const { syncer } = createSyncer({ defaultSync: "all" });
        expect(syncer.isResourceSyncEnabled({} as any)).toBe(true);
    });

    it('falls back to true when defaultSync is "resources"', () => {
        const { syncer } = createSyncer({ defaultSync: "resources" });
        expect(syncer.isResourceSyncEnabled({} as any)).toBe(true);
    });

    it('falls back to false when defaultSync is "none"', () => {
        const { syncer } = createSyncer({ defaultSync: "none" });
        expect(syncer.isResourceSyncEnabled({} as any)).toBe(false);
    });

    // ── REQ handling (incoming) ────────────────────────────────────

    it("responds to REQ with data when entry is in success state", () => {
        const resource = createMockResource([{ key: "entry-1", status: "success", data: { id: 1 } }]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: "ns", resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "req-1",
            keys: ["ns", "res", "entry-1"],
        });

        expect(driver.lastSent).toEqual({
            type: "RES",
            reqId: "req-1",
            keys: ["ns", "res", "entry-1"],
            data: { id: 1 },
        });
    });

    it("responds with originalData when patchState exists", () => {
        const resource = createMockResource([
            {
                key: "entry-1",
                status: "success",
                data: { id: 99 },
                patchState: { originalData: { id: 1 } },
            },
        ]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: "ns", resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "req-2",
            keys: ["ns", "res", "entry-1"],
        });

        expect(driver.lastSent).toEqual({
            type: "RES",
            reqId: "req-2",
            keys: ["ns", "res", "entry-1"],
            data: { id: 1 },
        });
    });

    it("ignores REQ when keyPrefix does not match", () => {
        const resource = createMockResource([{ key: "e", status: "success", data: 1 }]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: "ns", resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "r",
            keys: ["wrong", "res", "e"],
        });

        expect(driver.lastSent).toBeNull();
    });

    it("ignores REQ for unknown resource key", () => {
        const { syncer, driver } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "r",
            keys: ["ns", "unknown-res", "e"],
        });

        expect(driver.lastSent).toBeNull();
    });

    it("ignores REQ when entry is not in success state", () => {
        const resource = createMockResource([{ key: "e", status: "loading" }]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: "ns", resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "r",
            keys: ["ns", "res", "e"],
        });

        expect(driver.lastSent).toBeNull();
    });

    it("ignores REQ when entry key does not match any entry", () => {
        const resource = createMockResource([{ key: "other", status: "success", data: 1 }]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: "ns", resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "r",
            keys: ["ns", "res", "missing"],
        });

        expect(driver.lastSent).toBeNull();
    });

    it("uses empty string as prefix when keyPrefix is null", () => {
        const resource = createMockResource([{ key: "e", status: "success", data: "ok" }]);
        const resources = new Map([["res", resource]]);
        const { syncer, driver } = createSyncer({ keyPrefix: null, resourcesByKey: resources });
        syncer.connect();

        driver.simulateMessage({
            type: "REQ",
            reqId: "r",
            keys: ["", "res", "e"],
        });

        expect(driver.lastSent).toEqual({
            type: "RES",
            reqId: "r",
            keys: ["", "res", "e"],
            data: "ok",
        });
    });

    // ── REQ handling against a real Resource ──────────────────────
    //
    // The entry key inside REQ.keys[2] is an already-serialized cache key.
    // A mock keyed by raw args cannot catch double serialization, so these
    // tests go through a real Resource with a real serializeArgs.

    describe("with a real Resource", () => {
        function createRealResource() {
            return new Resource<{ id: number }, { id: number; name: string }>({
                queryFn: async (args) => ({ id: args.id, name: "loaded" }),
                key: "res",
                retentionTime: false,
                serializeArgs: stableStringify,
            });
        }

        it("responds to REQ carrying a serialized entry key", async () => {
            const resource = createRealResource();
            await resource.ensure({ id: 1 });

            const { syncer, driver } = createSyncer({
                keyPrefix: "ns",
                resourcesByKey: new Map([["res", resource as Resource<any, any>]]),
            });
            syncer.connect();

            const entryKey = resource.serialize({ id: 1 });
            driver.simulateMessage({
                type: "REQ",
                reqId: "req-real",
                keys: ["ns", "res", entryKey],
            });

            expect(driver.lastSent).toEqual({
                type: "RES",
                reqId: "req-real",
                keys: ["ns", "res", entryKey],
                data: { id: 1, name: "loaded" },
            });
        });

        it("round-trip: requesting tab receives data instead of hitting the timeout", async () => {
            // Two syncers wired through an in-memory bus = two tabs.
            const handlers: Array<(msg: ISyncMessage) => void> = [];
            const makeBusDriver = (): ISyncDriver => {
                let self: ((msg: ISyncMessage) => void) | null = null;
                return {
                    connect(cb) {
                        self = cb;
                        handlers.push(cb);
                    },
                    disconnect() {
                        if (self) handlers.splice(handlers.indexOf(self), 1);
                        self = null;
                    },
                    send(msg) {
                        for (const handler of [...handlers]) {
                            if (handler !== self) handler(msg);
                        }
                    },
                };
            };

            const resource = createRealResource();
            await resource.ensure({ id: 7 });

            const ownerTab = new Syncer({
                syncDriver: makeBusDriver(),
                keyPrefix: "ns",
                defaultSync: "all",
                resourcesByKey: new Map([["res", resource as Resource<any, any>]]),
            });
            ownerTab.connect();

            const requestingTab = new Syncer({
                syncDriver: makeBusDriver(),
                keyPrefix: "ns",
                defaultSync: "all",
                resourcesByKey: new Map(),
            });
            requestingTab.connect();

            const promise = requestingTab.beforeQuery("res", resource.serialize({ id: 7 }));
            // With a healthy round-trip the RES lands synchronously and this
            // advance is a no-op; an unanswered REQ resolves null here instead.
            vi.advanceTimersByTime(150);

            await expect(promise).resolves.toEqual({ data: { id: 7, name: "loaded" } });
        });
    });

    // ── RES handling (incoming) ────────────────────────────────────

    it("resolves beforeQuery promise when RES arrives", async () => {
        const { syncer, driver } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        const promise = syncer.beforeQuery("res", "entry");
        driver.simulateMessage({
            type: "RES",
            reqId: "mock-uuid-1",
            keys: ["ns", "res", "entry"],
            data: { id: 42 },
        });

        const result = await promise;
        expect(result).toEqual({ data: { id: 42 } });
    });

    it("resolves with null when RES has no data", async () => {
        const { syncer, driver } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        const promise = syncer.beforeQuery("res", "entry");
        driver.simulateMessage({
            type: "RES",
            reqId: "mock-uuid-1",
            keys: ["ns", "res", "entry"],
        });

        const result = await promise;
        expect(result).toBeNull();
    });

    it("resolves with null on timeout (150ms)", async () => {
        const { syncer } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        const promise = syncer.beforeQuery("res", "entry");
        vi.advanceTimersByTime(150);

        const result = await promise;
        expect(result).toBeNull();
    });

    it("ignores RES for unknown reqId", () => {
        const { syncer, driver } = createSyncer();
        syncer.connect();

        // Should not throw
        driver.simulateMessage({
            type: "RES",
            reqId: "unknown-id",
            keys: ["", "", ""],
            data: "x",
        });
    });

    // ── beforeQuery sends REQ ──────────────────────────────────────

    it("sends REQ message via syncDriver", () => {
        const { syncer, driver } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        syncer.beforeQuery("myResource", "myEntry");

        expect(driver.lastSent).toEqual({
            type: "REQ",
            reqId: "mock-uuid-1",
            keys: ["ns", "myResource", "myEntry"],
        });
    });

    // ── cleanup ────────────────────────────────────────────────────

    it("resolves all pending requests with null and reconnects", async () => {
        const { syncer, driver } = createSyncer({ keyPrefix: "ns" });
        syncer.connect();

        const promise = syncer.beforeQuery("res", "entry");

        syncer.cleanup();

        const result = await promise;
        expect(result).toBeNull();
        expect(driver.disconnect).toHaveBeenCalledOnce();
    });
});
