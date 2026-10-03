import { afterEach, describe, expect, it, vi } from "vitest";

import { randomUUID } from "./randomUUID";

describe("randomUUID", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("uses crypto.randomUUID when available", () => {
        vi.stubGlobal("crypto", { randomUUID: () => "fixed-uuid" });
        expect(randomUUID()).toBe("fixed-uuid");
    });

    it("falls back to getRandomValues", () => {
        vi.stubGlobal("crypto", {
            getRandomValues: (bytes: Uint8Array) => {
                bytes.fill(0xab);
                return bytes;
            },
        });
        expect(randomUUID()).toBe("abababab-abab-4bab-abab-abababababab");
    });

    it("falls back to Math.random without crypto and still produces a v4-shaped id", () => {
        vi.stubGlobal("crypto", undefined);
        expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(randomUUID()).not.toBe(randomUUID());
    });
});
