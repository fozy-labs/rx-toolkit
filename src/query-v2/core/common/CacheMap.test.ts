import { shallowEqual } from "@/common/utils/shallowEqual";
import { stableStringify } from "@/query-v2/lib/stableStringify";

import { CacheEntry } from "./CacheEntry";
import { CacheMap } from "./CacheMap";
import type { TMachineInstance } from "../machines/Machine";
import { MachineIdle } from "../machines/MachineIdle";

function createEntry() {
    return new CacheEntry<unknown, Error>(MachineIdle.create() as TMachineInstance<unknown, Error>);
}

function createSerializeMap(overrides: Record<string, unknown> = {}) {
    return CacheMap.create({
        keyStrategy: "serialize",
        serializeArgs: stableStringify,
        compareArg: shallowEqual,
        doCacheArgs: false,
        ...overrides,
    });
}

function createCompareMap(overrides: Record<string, unknown> = {}) {
    return CacheMap.create({
        keyStrategy: "compare",
        serializeArgs: stableStringify,
        compareArg: shallowEqual,
        doCacheArgs: false,
        ...overrides,
    });
}

describe("CacheMap — Serialize strategy", () => {
    // C1: serialize set+get
    it("C1: set + get with same args returns same entry", () => {
        const map = createSerializeMap();
        const entry = createEntry();
        map.set({ id: 1 }, entry);
        expect(map.get({ id: 1 })).toBe(entry);
    });

    // C2: different key order same result (stableStringify sorts keys)
    it("C2: get with different key order returns same entry", () => {
        const map = createSerializeMap();
        const entry = createEntry();
        map.set({ a: 1, b: 2 }, entry);
        expect(map.get({ b: 2, a: 1 })).toBe(entry);
    });

    // C3: has returns false for missing
    it("C3: has returns false for missing args", () => {
        const map = createSerializeMap();
        expect(map.has({ id: 999 })).toBe(false);
    });

    // C4: delete removes entry
    it("C4: delete removes entry", () => {
        const map = createSerializeMap();
        const entry = createEntry();
        map.set({ id: 1 }, entry);
        expect(map.delete({ id: 1 })).toBe(true);
        expect(map.get({ id: 1 })).toBeUndefined();
    });

    // C8: clear empties cache
    it("C8: clear empties cache", () => {
        const map = createSerializeMap();
        map.set({ id: 1 }, createEntry());
        map.set({ id: 2 }, createEntry());
        map.clear();
        expect(map.size).toBe(0);
    });

    // C9: entries returns key-entry pairs
    it("C9: entries returns serialized-key / entry pairs", () => {
        const map = createSerializeMap();
        const entry = createEntry();
        map.set({ id: 1 }, entry);
        const result = [...map.entries()];
        expect(result).toHaveLength(1);
        expect(result[0][0]).toBe(stableStringify({ id: 1 }));
        expect(result[0][1]).toBe(entry);
    });
});

describe("CacheMap — Compare strategy", () => {
    // C5: set + get with shallowEqual (new object instance)
    it("C5: set + get with shallowEqual matches new object", () => {
        const map = createCompareMap();
        const entry = createEntry();
        map.set({ id: 1 }, entry);
        expect(map.get({ id: 1 })).toBe(entry);
    });

    // C6: compare miss with different args
    it("C6: get misses with deep-different args", () => {
        const map = createCompareMap();
        map.set({ id: 1 }, createEntry());
        expect(map.get({ id: 2 })).toBeUndefined();
    });

    // C7: values iteration
    it("C7: values() iterates all entries", () => {
        const map = createCompareMap();
        const e1 = createEntry();
        const e2 = createEntry();
        map.set({ id: 1 }, e1);
        map.set({ id: 2 }, e2);
        expect([...map.values()]).toEqual([e1, e2]);
    });
});

describe("CacheMap — doCacheArgs memoization", () => {
    // C10: doCacheArgs memoizes serialization for object args
    it("C10: doCacheArgs memoizes serialization via WeakMap", () => {
        const serializeSpy = vi.fn(stableStringify);
        const map = CacheMap.create({
            keyStrategy: "serialize",
            serializeArgs: serializeSpy,
            compareArg: shallowEqual,
            doCacheArgs: true,
        });
        const args = { id: 1 };
        map.get(args);
        map.get(args);
        expect(serializeSpy).toHaveBeenCalledTimes(1);
    });

    // C11: doCacheArgs with primitives — no caching (primitives can't be WeakMap keys)
    it("C11: doCacheArgs with primitive args calls serialize each time", () => {
        const serializeSpy = vi.fn(stableStringify);
        const map = CacheMap.create<number, unknown>({
            keyStrategy: "serialize",
            serializeArgs: serializeSpy,
            compareArg: shallowEqual,
            doCacheArgs: true,
        });
        map.get(42);
        map.get(42);
        expect(serializeSpy).toHaveBeenCalledTimes(2);
    });
});

describe("CacheMap — Edge cases", () => {
    // E3: empty cache values() returns empty iterable
    it("E3: empty cache values() returns empty iterable", () => {
        const serMap = createSerializeMap();
        expect([...serMap.values()]).toEqual([]);

        const cmpMap = createCompareMap();
        expect([...cmpMap.values()]).toEqual([]);
    });

    it("getOrCreate returns existing entry on hit", () => {
        const map = createSerializeMap();
        const entry = createEntry();
        map.set({ id: 1 }, entry);
        const result = map.getOrCreate({ id: 1 }, () => createEntry());
        expect(result).toBe(entry);
    });

    it("getOrCreate creates new entry on miss", () => {
        const map = createSerializeMap();
        const factory = vi.fn(createEntry);
        const result = map.getOrCreate({ id: 1 }, factory);
        expect(factory).toHaveBeenCalledOnce();
        expect(map.get({ id: 1 })).toBe(result);
    });

    it("compare strategy: set overwrites existing entry", () => {
        const map = createCompareMap();
        const e1 = createEntry();
        const e2 = createEntry();
        map.set({ id: 1 }, e1);
        map.set({ id: 1 }, e2);
        expect(map.get({ id: 1 })).toBe(e2);
        expect(map.size).toBe(1);
    });

    it("compare strategy: delete returns false for missing", () => {
        const map = createCompareMap();
        expect(map.delete({ id: 1 })).toBe(false);
    });

    it("compare strategy: getOrCreate with factory", () => {
        const map = createCompareMap();
        const factory = vi.fn(createEntry);
        const result = map.getOrCreate({ id: 1 }, factory);
        expect(factory).toHaveBeenCalledOnce();
        expect(map.get({ id: 1 })).toBe(result);
    });

    it("size tracks additions and deletions", () => {
        const map = createSerializeMap();
        expect(map.size).toBe(0);
        map.set({ id: 1 }, createEntry());
        expect(map.size).toBe(1);
        map.set({ id: 2 }, createEntry());
        expect(map.size).toBe(2);
        map.delete({ id: 1 });
        expect(map.size).toBe(1);
    });
});
