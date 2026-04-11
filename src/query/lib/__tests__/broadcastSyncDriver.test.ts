import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ISyncMessage } from "../../types";
import { broadcastSyncDriver } from "../broadcastSyncDriver";

// ── BroadcastChannel mock ──────────────────────────────────────────
class MockBroadcastChannel {
    static instances: MockBroadcastChannel[] = [];
    name: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    closed = false;

    constructor(name: string) {
        this.name = name;
        MockBroadcastChannel.instances.push(this);
    }

    postMessage(data: unknown) {
        if (this.closed) throw new DOMException("Channel is closed");
        // Deliver to other instances on the same channel
        for (const ch of MockBroadcastChannel.instances) {
            if (ch !== this && ch.name === this.name && !ch.closed) {
                ch.onmessage?.(new MessageEvent("message", { data }));
            }
        }
    }

    close() {
        this.closed = true;
    }
}

beforeEach(() => {
    MockBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────
function validMessage(overrides?: Partial<ISyncMessage>): ISyncMessage {
    return {
        type: "REQ",
        reqId: "abc-123",
        keys: ["ns", "resource", "key"],
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────
describe("broadcastSyncDriver", () => {
    it("returns an object with connect, disconnect, and send methods", () => {
        const driver = broadcastSyncDriver();
        expect(driver).toHaveProperty("connect");
        expect(driver).toHaveProperty("disconnect");
        expect(driver).toHaveProperty("send");
        expect(typeof driver.connect).toBe("function");
        expect(typeof driver.disconnect).toBe("function");
        expect(typeof driver.send).toBe("function");
    });

    it("connect() and send() deliver valid messages between drivers", () => {
        const driverA = broadcastSyncDriver();
        const driverB = broadcastSyncDriver();

        const received: ISyncMessage[] = [];
        driverA.connect((msg) => received.push(msg));
        driverB.connect(() => {});

        const msg = validMessage();
        driverB.send(msg);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(msg);
    });

    it("filters out malformed messages", () => {
        const driver = broadcastSyncDriver();
        const received: ISyncMessage[] = [];
        driver.connect((msg) => received.push(msg));

        const bc = MockBroadcastChannel.instances.find((ch) => ch.onmessage !== null)!;

        // null
        bc.onmessage!(new MessageEvent("message", { data: null }));
        // missing type
        bc.onmessage!(
            new MessageEvent("message", {
                data: { reqId: "x", keys: ["a", "b", "c"] },
            }),
        );
        // wrong keys length
        bc.onmessage!(
            new MessageEvent("message", {
                data: { type: "REQ", reqId: "x", keys: ["a", "b"] },
            }),
        );
        // non-string key
        bc.onmessage!(
            new MessageEvent("message", {
                data: { type: "REQ", reqId: "x", keys: ["a", "b", 3] },
            }),
        );
        // primitive
        bc.onmessage!(new MessageEvent("message", { data: "garbage" }));

        expect(received).toHaveLength(0);
    });

    it("disconnect() is idempotent", () => {
        const driver = broadcastSyncDriver();
        driver.connect(() => {});

        expect(() => {
            driver.disconnect();
            driver.disconnect();
            driver.disconnect();
        }).not.toThrow();
    });

    it("send() before connect() does not throw", () => {
        const driver = broadcastSyncDriver();
        expect(() => driver.send(validMessage())).not.toThrow();
    });
});
