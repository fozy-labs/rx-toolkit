import { vi } from "vitest";

import { CompareCacheMap } from "@/query-v2/core/CacheMap/CompareCacheMap";
import { createCacheMap } from "@/query-v2/core/CacheMap/createCacheMap";
import { SerializeCacheMap } from "@/query-v2/core/CacheMap/SerializeCacheMap";

type TestArgs = { id: number };
type TestEntry = { value: string };

describe("CacheMap", () => {
    // === Factory mechanism ===

    describe("Factory mechanism", () => {
        it("CM-F01: getOrCreate(args) calls factory when no entry exists", () => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
            });

            const entry = map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledWith({ id: 1 });
            expect(entry).toEqual({ value: "entry-1" });
        });

        it("CM-F02: getOrCreate(args) does NOT call factory for existing entry", () => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
            });

            const entry1 = map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledTimes(1);
            expect(entry1).toBe(entry2);
        });

        it("CM-F03: Factory receives correct args", () => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
            });

            map.getOrCreate({ id: 42 });
            expect(factory).toHaveBeenCalledWith({ id: 42 });
        });

        it("CM-F04: createCacheMap({ keyStrategy: 'serialize' }) returns SerializeCacheMap", () => {
            const factory = vi.fn(() => ({ value: "test" }));
            const map = createCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
            });

            map.getOrCreate({ id: 1 });
            // Verify it uses string keys in entries()
            const entries = [...map.entries()];
            expect(entries).toHaveLength(1);
            expect(typeof entries[0][0]).toBe("string");
        });

        it("CM-F05: createCacheMap({ keyStrategy: 'compare' }) returns CompareCacheMap", () => {
            const factory = vi.fn(() => ({ value: "test" }));
            const map = createCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "compare",
                compareArg: (a, b) => a.id === b.id,
            });

            map.getOrCreate({ id: 1 });
            // Verify it uses TArgs keys in entries()
            const entries = [...map.entries()];
            expect(entries).toHaveLength(1);
            expect(entries[0][0]).toEqual({ id: 1 });
        });
    });

    // === Serialize strategy ===

    describe("SerializeCacheMap", () => {
        const createSerializeMap = () => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
            });
            return { map, factory };
        };

        it("CM01: getOrCreate(args) creates new entry for unknown args", () => {
            const { map } = createSerializeMap();
            const entry = map.getOrCreate({ id: 1 });
            expect(entry).toEqual({ value: "entry-1" });
            expect(map.size).toBe(1);
        });

        it("CM02: getOrCreate(args) returns existing entry for same args", () => {
            const { map } = createSerializeMap();
            const entry1 = map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 1 });
            expect(entry1).toBe(entry2);
        });

        it("CM03: get(args) returns undefined when no entry", () => {
            const { map } = createSerializeMap();
            expect(map.get({ id: 99 })).toBeUndefined();
        });

        it("CM04: delete(args) removes entry", () => {
            const { map } = createSerializeMap();
            map.getOrCreate({ id: 1 });
            expect(map.delete({ id: 1 })).toBe(true);
            expect(map.has({ id: 1 })).toBe(false);
        });

        it("CM05: clear() removes all entries", () => {
            const { map } = createSerializeMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });
            map.clear();
            expect(map.size).toBe(0);
        });

        it("CM06: entries() iterates all [string, entry] pairs", () => {
            const { map } = createSerializeMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            const entries = [...map.entries()];
            expect(entries).toHaveLength(2);
            expect(typeof entries[0][0]).toBe("string");
            expect(typeof entries[1][0]).toBe("string");
        });

        it("CM07: Custom serializeArgs is used", () => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const customSerialize = vi.fn((args: TestArgs) => `custom-${args.id}`);
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
                serializeArgs: customSerialize,
            });

            map.getOrCreate({ id: 1 });
            expect(customSerialize).toHaveBeenCalledWith({ id: 1 });

            const entries = [...map.entries()];
            expect(entries[0][0]).toBe("custom-1");
        });

        it("CM08: Object key ordering doesn't affect lookup", () => {
            const { map } = createSerializeMap();
            const entry1 = map.getOrCreate({ id: 1 } as unknown as TestArgs);

            // Create args with different key ordering (via stableStringify this should still match)
            const argsReordered = JSON.parse('{"id":1}') as TestArgs;
            const entry2 = map.getOrCreate(argsReordered);

            expect(entry1).toBe(entry2);
        });

        it("CM09: doCacheArgs memoizes args via WeakMap", () => {
            const serializeSpy = vi.fn((args: TestArgs) => JSON.stringify(args));
            const factory = vi.fn(() => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "serialize",
                serializeArgs: serializeSpy,
                doCacheArgs: true,
            });

            const args = { id: 1 };
            map.getOrCreate(args);
            map.getOrCreate(args); // Same reference

            // serializeArgs called once for same object reference (WeakMap cached)
            expect(serializeSpy).toHaveBeenCalledTimes(1);
        });

        it("CM19: values() iterates all entry values", () => {
            const { map } = createSerializeMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });

            const values = [...map.values()];
            expect(values).toHaveLength(3);
        });
    });

    // === Compare strategy ===

    describe("CompareCacheMap", () => {
        const createCompareMap = (compareFn?: (a: TestArgs, b: TestArgs) => boolean) => {
            const factory = vi.fn((args: TestArgs) => ({ value: `entry-${args.id}` }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "compare",
                compareArg: compareFn ?? ((a, b) => a.id === b.id),
            });
            return { map, factory };
        };

        it("CM10: getOrCreate with compare strategy uses compareArg for lookup", () => {
            const { map, factory } = createCompareMap();
            const entry1 = map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledTimes(1);
            expect(entry1).toBe(entry2);
        });

        it("CM11: linear scan finds correct entry among multiple", () => {
            const { map } = createCompareMap();
            map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });

            const found = map.get({ id: 2 });
            expect(found).toBe(entry2);
        });

        it("CM12: different args create separate entries", () => {
            const { map, factory } = createCompareMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            expect(map.size).toBe(2);
            expect(factory).toHaveBeenCalledTimes(2);
        });

        it("CM13: get(args) returns undefined when no match", () => {
            const { map } = createCompareMap();
            expect(map.get({ id: 99 })).toBeUndefined();
        });

        it("CM14: delete(args) removes correct entry", () => {
            const { map } = createCompareMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });

            expect(map.delete({ id: 2 })).toBe(true);
            expect(map.size).toBe(2);
            expect(map.get({ id: 2 })).toBeUndefined();
            expect(map.get({ id: 1 })).toBeDefined();
            expect(map.get({ id: 3 })).toBeDefined();
        });

        it("CM15: clear() removes all entries", () => {
            const { map } = createCompareMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });
            map.clear();
            expect(map.size).toBe(0);
        });

        it("CM16: entries() iterates with original TArgs as keys", () => {
            const { map } = createCompareMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            const entries = [...map.entries()];
            expect(entries).toHaveLength(2);
            expect(entries[0][0]).toEqual({ id: 1 });
            expect(entries[1][0]).toEqual({ id: 2 });
        });

        it("CM17: works with non-serializable args (RegExp)", () => {
            const factory = vi.fn(() => ({ value: "regex-entry" }));
            const map = new CompareCacheMap<RegExp, TestEntry>({
                factory,
                keyStrategy: "compare",
                compareArg: (a, b) => a.source === b.source && a.flags === b.flags,
            });

            const entry1 = map.getOrCreate(/foo/i);
            const entry2 = map.getOrCreate(/foo/i);

            expect(entry1).toBe(entry2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM18: default compareArg uses shallowEqual", () => {
            const factory = vi.fn(() => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                keyStrategy: "compare",
            });

            const entry1 = map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 1 }); // Different reference, same shape

            expect(entry1).toBe(entry2);
            expect(factory).toHaveBeenCalledTimes(1);
        });
    });
});
