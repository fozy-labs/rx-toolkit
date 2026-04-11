import { describe, expect, it } from "vitest";

import { KEYED_BRAND } from "../../constants";
import type { Args, Keyed } from "../../types";
import { stableStringify } from "../stableStringify";
import { isKeyed, toKeyed } from "../toKeyed";

describe("isKeyed", () => {
    it("returns true for a Keyed object", () => {
        const keyed: Keyed<number> = { value: 42, key: "42", [KEYED_BRAND]: true };
        expect(isKeyed(keyed)).toBe(true);
    });

    it("returns true for an object produced by toKeyed", () => {
        const keyed = toKeyed(42);
        expect(isKeyed(keyed)).toBe(true);
    });

    it("returns false for a plain object with value and key fields", () => {
        expect(isKeyed({ value: "something", key: "cache-key" } as unknown as Args<string>)).toBe(false);
    });

    it("returns false for a raw primitive", () => {
        expect(isKeyed(42)).toBe(false);
    });

    it("returns false for null", () => {
        expect(isKeyed(null as unknown)).toBe(false);
    });

    it("returns false for an object without key/value shape", () => {
        expect(isKeyed({ a: 1, b: 2 })).toBe(false);
    });

    it("returns false for an object with value but no key", () => {
        expect(isKeyed({ value: 1 } as unknown as Args<number>)).toBe(false);
    });

    it("returns false for an object with key as non-string", () => {
        expect(isKeyed({ value: 1, key: 123 } as unknown as Args<number>)).toBe(false);
    });
});

describe("toKeyed", () => {
    it("wraps raw args with default serializer", () => {
        const result = toKeyed({ id: 1 });
        expect(result.value).toEqual({ id: 1 });
        expect(result.key).toBe(stableStringify({ id: 1 }));
        expect(result[KEYED_BRAND]).toBe(true);
    });

    it("passes through already-keyed args", () => {
        const keyed: Keyed<{ id: number }> = { value: { id: 1 }, key: "custom-key", [KEYED_BRAND]: true };
        const result = toKeyed(keyed);
        expect(result).toBe(keyed); // same reference
    });

    it("uses a custom serialize function when provided", () => {
        const custom = (v: { id: number }) => `id-${v.id}`;
        const result = toKeyed({ id: 5 }, custom);
        expect(result.value).toEqual({ id: 5 });
        expect(result.key).toBe("id-5");
        expect(result[KEYED_BRAND]).toBe(true);
    });

    it("wraps primitive args", () => {
        const result = toKeyed(42);
        expect(result.value).toBe(42);
        expect(result.key).toBe("42");
        expect(result[KEYED_BRAND]).toBe(true);
    });

    it("wraps string args", () => {
        const result = toKeyed("hello");
        expect(result.value).toBe("hello");
        expect(result.key).toBe('"hello"');
        expect(result[KEYED_BRAND]).toBe(true);
    });

    it("wraps null args", () => {
        const result = toKeyed(null as unknown);
        expect(result.value).toBe(null);
        expect(result.key).toBe("null");
        expect(result[KEYED_BRAND]).toBe(true);
    });
});
