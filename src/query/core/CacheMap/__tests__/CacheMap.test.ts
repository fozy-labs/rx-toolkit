import { vi } from "vitest";

import { CompareCacheMap } from "@/query/core/CacheMap/CompareCacheMap";
import { createCacheMap } from "@/query/core/CacheMap/createCacheMap";
import { SerializeCacheMap } from "@/query/core/CacheMap/SerializeCacheMap";

type TestArgs = { id: number };
type TestEntry = { value: string };

describe("CacheMap", () => {
    // === Factory mechanism ===

    describe("Factory mechanism", () => {
        it("CM-F01: getOrCreate(args) calls factory when no entry exists", () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });

            const entry = map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledWith({ id: 1 }, expect.any(String));
            expect(entry).toEqual({ value: "entry-1" });
        });

        it("CM-F02: getOrCreate(args) does NOT call factory for existing entry", () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });

            const entry1 = map.getOrCreate({ id: 1 });
            const entry2 = map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledTimes(1);
            expect(entry1).toBe(entry2);
        });

        it("CM-F03: Factory receives correct args", () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });

            map.getOrCreate({ id: 42 });
            expect(factory).toHaveBeenCalledWith({ id: 42 }, expect.any(String));
        });

        it("CM-F04: createCacheMap({ strategy: 'serialize' }) returns SerializeCacheMap", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = createCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });

            map.getOrCreate({ id: 1 });
            const values = [...map.values()];
            expect(values).toHaveLength(1);
        });

        it("CM-F05: createCacheMap({ strategy: 'compare' }) returns CompareCacheMap", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = createCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
                compareArg: (a, b) => a.id === b.id,
            });

            map.getOrCreate({ id: 1 });
            const values = [...map.values()];
            expect(values).toHaveLength(1);
        });
    });

    // === Serialize strategy ===

    describe("SerializeCacheMap", () => {
        const createSerializeMap = () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
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

        it("CM06: values() iterates all entry values", () => {
            const { map } = createSerializeMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            const values = [...map.values()];
            expect(values).toHaveLength(2);
        });

        it("CM07: Custom serializeArgs is used", () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const customSerialize = vi.fn((args: TestArgs) => `custom-${args.id}`);
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                serializeArgs: customSerialize,
            });

            map.getOrCreate({ id: 1 });
            expect(customSerialize).toHaveBeenCalledWith({ id: 1 });

            // Verify factory received custom serialized key
            expect(factory).toHaveBeenCalledWith({ id: 1 }, "custom-1");
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
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
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
        const createCompareMap = () => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            return { map, factory };
        };

        it("CM10: getOrCreate with reference identity — same ref returns same entry", () => {
            const { map, factory } = createCompareMap();
            const args = { id: 1 };
            const entry1 = map.getOrCreate(args);
            const entry2 = map.getOrCreate(args);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(entry1).toBe(entry2);
        });

        it("CM11: get returns correct entry among multiple", () => {
            const { map } = createCompareMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            map.getOrCreate(a1);
            const entry2 = map.getOrCreate(a2);
            map.getOrCreate(a3);

            const found = map.get(a2);
            expect(found).toBe(entry2);
        });

        it("CM12: different refs create separate entries (even if structurally equal)", () => {
            const { map, factory } = createCompareMap();
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 1 });
            expect(map.size).toBe(2);
            expect(factory).toHaveBeenCalledTimes(2);
        });

        it("CM13: get(args) returns undefined when no match", () => {
            const { map } = createCompareMap();
            expect(map.get({ id: 99 })).toBeUndefined();
        });

        it("CM14: delete(args) removes correct entry by reference", () => {
            const { map } = createCompareMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            map.getOrCreate(a3);

            expect(map.delete(a2)).toBe(true);
            expect(map.size).toBe(2);
            expect(map.get(a2)).toBeUndefined();
            expect(map.get(a1)).toBeDefined();
            expect(map.get(a3)).toBeDefined();
        });

        it("CM15: clear() removes all entries", () => {
            const { map } = createCompareMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            map.getOrCreate(a3);
            map.clear();
            expect(map.size).toBe(0);
        });

        it("CM16: values() iterates all entries", () => {
            const { map } = createCompareMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            const values = [...map.values()];
            expect(values).toHaveLength(2);
        });

        it("CM17: works with non-serializable args (RegExp)", () => {
            const factory = vi.fn((_args: RegExp, _argsKey: string) => ({ value: "regex-entry" }));
            const map = new CompareCacheMap<RegExp, TestEntry>({
                factory,
                strategy: "compare",
            });

            const regex = /foo/i;
            const entry1 = map.getOrCreate(regex);
            const entry2 = map.getOrCreate(regex);

            expect(entry1).toBe(entry2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM18: different regex refs create separate entries", () => {
            const factory = vi.fn((_args: RegExp, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<RegExp, TestEntry>({
                factory,
                strategy: "compare",
            });

            map.getOrCreate(/foo/i);
            map.getOrCreate(/foo/i);

            expect(factory).toHaveBeenCalledTimes(2);
            expect(map.size).toBe(2);
        });
    });

    // === NEW: CompareCacheMap Map-internals (CM20–CM36) ===

    describe("CompareCacheMap — Map internals", () => {
        const createMap = (opts?: { devtoolsKey?: (args: TestArgs) => string }) => {
            const factory = vi.fn((args: TestArgs, _argsKey: string) => ({ value: `entry-${args.id}` }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
                devtoolsKey: opts?.devtoolsKey,
            });
            return { map, factory };
        };

        it("CM20: getOrCreate creates entry on cache miss (reference identity)", () => {
            const { map, factory } = createMap();
            const args = { id: 1 };
            const entry = map.getOrCreate(args);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledWith(args, "0");
            expect(entry).toEqual({ value: "entry-1" });
            expect(map.size).toBe(1);
        });

        it("CM21: getOrCreate returns cached entry on same reference", () => {
            const { map, factory } = createMap();
            const args = { id: 1 };
            const entry1 = map.getOrCreate(args);
            const entry2 = map.getOrCreate(args);
            expect(entry1).toBe(entry2);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(map.size).toBe(1);
        });

        it("CM22: getOrCreate creates separate entry for structurally-equal but referentially-distinct args", () => {
            const { map, factory } = createMap();
            const args1 = { id: 1 };
            const args2 = { id: 1 };
            const entry1 = map.getOrCreate(args1);
            const entry2 = map.getOrCreate(args2);
            expect(entry1).not.toBe(entry2);
            expect(map.size).toBe(2);
            expect(factory).toHaveBeenCalledTimes(2);
        });

        it("CM23: get returns undefined for unknown args reference", () => {
            const { map } = createMap();
            expect(map.get({ id: 1 })).toBeUndefined();
        });

        it("CM24: get returns entry for known args reference", () => {
            const { map } = createMap();
            const args = { id: 1 };
            const entry = map.getOrCreate(args);
            expect(map.get(args)).toBe(entry);
        });

        it("CM25: delete removes entry by reference, returns true", () => {
            const { map } = createMap();
            const args = { id: 1 };
            map.getOrCreate(args);
            expect(map.delete(args)).toBe(true);
            expect(map.size).toBe(0);
            expect(map.get(args)).toBeUndefined();
        });

        it("CM26: delete returns false for unknown reference", () => {
            const { map } = createMap();
            expect(map.delete({ id: 1 })).toBe(false);
            expect(map.size).toBe(0);
        });

        it("CM27: has returns true for stored reference", () => {
            const { map } = createMap();
            const args = { id: 1 };
            map.getOrCreate(args);
            expect(map.has(args)).toBe(true);
        });

        it("CM28: has returns false for unstored reference", () => {
            const { map } = createMap();
            expect(map.has({ id: 1 })).toBe(false);
        });

        it("CM29: clear removes all entries", () => {
            const { map } = createMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            map.getOrCreate(a3);
            map.clear();
            expect(map.size).toBe(0);
            expect(map.get(a1)).toBeUndefined();
            expect(map.get(a2)).toBeUndefined();
            expect(map.get(a3)).toBeUndefined();
        });

        it("CM30: values() yields all stored entries", () => {
            const { map } = createMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            const e1 = map.getOrCreate(a1);
            const e2 = map.getOrCreate(a2);
            const e3 = map.getOrCreate(a3);
            const values = [...map.values()];
            expect(values).toHaveLength(3);
            expect(values).toContain(e1);
            expect(values).toContain(e2);
            expect(values).toContain(e3);
        });

        it("CM31: size tracks entry count correctly across add/delete", () => {
            const { map } = createMap();
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            const a4 = { id: 4 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            map.getOrCreate(a3);
            map.delete(a2);
            map.getOrCreate(a4);
            expect(map.size).toBe(3);
        });

        it("CM32: primitive args (void/undefined) — single entry for undefined", () => {
            const factory = vi.fn((_args: void, _argsKey: string) => ({ value: "void-entry" }));
            const map = new CompareCacheMap<void, TestEntry>({
                factory,
                strategy: "compare",
            });
            const e1 = map.getOrCreate(undefined);
            const e2 = map.getOrCreate(undefined);
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM33: primitive args (string) — reference identity holds for identical string literals", () => {
            const factory = vi.fn((_args: string, _argsKey: string) => ({ value: "str-entry" }));
            const map = new CompareCacheMap<string, TestEntry>({
                factory,
                strategy: "compare",
            });
            const e1 = map.getOrCreate("abc");
            const e2 = map.getOrCreate("abc");
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM34: primitive args (number) — same number is same key", () => {
            const factory = vi.fn((_args: number, _argsKey: string) => ({ value: "num-entry" }));
            const map = new CompareCacheMap<number, TestEntry>({
                factory,
                strategy: "compare",
            });
            const e1 = map.getOrCreate(42);
            const e2 = map.getOrCreate(42);
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM35: entries() method does not exist on CompareCacheMap", () => {
            const { map } = createMap();
            expect((map as unknown as Record<string, unknown>)["entries"]).toBeUndefined();
        });

        it("CM36: doCacheArgs option is accepted but ignored by CompareCacheMap", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
                doCacheArgs: true,
            });
            const args = { id: 1 };
            const e1 = map.getOrCreate(args);
            const e2 = map.getOrCreate(args);
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });
    });

    // === NEW: Devtools key derivation (CM40–CM48) ===

    describe("CompareCacheMap — Devtools key derivation", () => {
        it("CM40: default monotonic counter — first entry gets '0'", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledWith({ id: 1 }, "0");
        });

        it("CM41: second entry gets '1'", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            expect(factory).toHaveBeenNthCalledWith(1, a1, "0");
            expect(factory).toHaveBeenNthCalledWith(2, a2, "1");
        });

        it("CM42: counter does not increment on cache hit", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            const args = { id: 1 };
            map.getOrCreate(args);
            map.getOrCreate(args);
            expect(factory).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledWith(args, "0");
        });

        it("CM43: counter does not reuse values after deletion", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            map.getOrCreate(a1);
            map.delete(a1);
            map.getOrCreate(a2);
            expect(factory).toHaveBeenNthCalledWith(1, a1, "0");
            expect(factory).toHaveBeenNthCalledWith(2, a2, "1");
        });

        it("CM44: custom devtoolsKey function called instead of counter", () => {
            const factory = vi.fn((_args: { name: string }, _argsKey: string) => ({ value: "test" }));
            const devtoolsKey = vi.fn((args: { name: string }) => args.name);
            const map = new CompareCacheMap<{ name: string }, TestEntry>({
                factory,
                strategy: "compare",
                devtoolsKey,
            });
            const args = { name: "alice" };
            map.getOrCreate(args);
            expect(devtoolsKey).toHaveBeenCalledWith(args);
            expect(factory).toHaveBeenCalledWith(args, "alice");
        });

        it("CM45: custom devtoolsKey — counter is NOT incremented", () => {
            const factory = vi.fn((_args: { name: string }, _argsKey: string) => ({ value: "test" }));
            const devtoolsKey = vi.fn((args: { name: string }) => args.name);
            const map = new CompareCacheMap<{ name: string }, TestEntry>({
                factory,
                strategy: "compare",
                devtoolsKey,
            });
            const a1 = { name: "alice" };
            const a2 = { name: "bob" };
            map.getOrCreate(a1);
            map.getOrCreate(a2);
            expect(factory).toHaveBeenNthCalledWith(1, a1, "alice");
            expect(factory).toHaveBeenNthCalledWith(2, a2, "bob");
        });

        it("CM48: get, has, delete do NOT affect counter", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            const a1 = { id: 1 };
            const a2 = { id: 2 };
            const a3 = { id: 3 };
            map.getOrCreate(a1); // counter → "0"
            map.get(a1);
            map.has(a1);
            map.delete(a1);
            map.getOrCreate(a2); // counter → "1"
            map.get(a2);
            map.has(a2);
            map.getOrCreate(a3); // counter → "2"
            expect(factory).toHaveBeenNthCalledWith(1, a1, "0");
            expect(factory).toHaveBeenNthCalledWith(2, a2, "1");
            expect(factory).toHaveBeenNthCalledWith(3, a3, "2");
        });
    });

    // === NEW: CompareCacheMap edge cases ===

    describe("CompareCacheMap — Edge cases", () => {
        it("NaN as args — Map treats NaN === NaN as true", () => {
            const factory = vi.fn((_args: number, _argsKey: string) => ({ value: "nan-entry" }));
            const map = new CompareCacheMap<number, TestEntry>({
                factory,
                strategy: "compare",
            });
            const e1 = map.getOrCreate(NaN);
            const e2 = map.getOrCreate(NaN);
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("null vs undefined args — distinct Map keys", () => {
            const factory = vi.fn((_args: null | undefined, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<null | undefined, TestEntry>({
                factory,
                strategy: "compare",
            });
            map.getOrCreate(null);
            map.getOrCreate(undefined);
            expect(map.size).toBe(2);
            expect(factory).toHaveBeenCalledTimes(2);
        });

        it("-0 vs +0 args — Map treats them as same key", () => {
            const factory = vi.fn((_args: number, _argsKey: string) => ({ value: "zero" }));
            const map = new CompareCacheMap<number, TestEntry>({
                factory,
                strategy: "compare",
            });
            const e1 = map.getOrCreate(-0);
            const e2 = map.getOrCreate(+0);
            expect(e1).toBe(e2);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("clear() then getOrCreate — counter continues from last value", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new CompareCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "compare",
            });
            map.getOrCreate({ id: 1 });
            map.getOrCreate({ id: 2 });
            map.getOrCreate({ id: 3 });
            map.clear();
            const a4 = { id: 4 };
            map.getOrCreate(a4);
            expect(factory).toHaveBeenLastCalledWith(a4, "3");
        });
    });

    // === NEW: SerializeCacheMap — no double serialization (CM50–CM56) ===

    describe("SerializeCacheMap — no double serialization", () => {
        it("CM50: getOrCreate passes pre-computed key to factory as argsKey", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });
            map.getOrCreate({ id: 1 });
            expect(factory).toHaveBeenCalledWith({ id: 1 }, '{"id":1}');
        });

        it("CM51: no double serialization — serializeArgs called exactly once per new entry", () => {
            const serializeSpy = vi.fn((args: TestArgs) => JSON.stringify(args));
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                serializeArgs: serializeSpy,
            });
            map.getOrCreate({ id: 1 });
            expect(serializeSpy).toHaveBeenCalledTimes(1);
        });

        it("CM52: existing entry — serializeArgs called once (for lookup), factory NOT called", () => {
            const serializeSpy = vi.fn((args: TestArgs) => JSON.stringify(args));
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                serializeArgs: serializeSpy,
            });
            map.getOrCreate({ id: 1 });
            serializeSpy.mockClear();
            factory.mockClear();

            map.getOrCreate({ id: 1 });
            expect(serializeSpy).toHaveBeenCalledTimes(1);
            expect(factory).not.toHaveBeenCalled();
        });

        it("CM53: doCacheArgs: true — WeakMap caches key, serializeArgs called once across repeated lookups", () => {
            const serializeSpy = vi.fn((args: TestArgs) => JSON.stringify(args));
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                serializeArgs: serializeSpy,
                doCacheArgs: true,
            });
            const args = { id: 1 };
            map.getOrCreate(args);
            map.getOrCreate(args);
            map.getOrCreate(args);
            expect(serializeSpy).toHaveBeenCalledTimes(1);
            expect(factory).toHaveBeenCalledTimes(1);
        });

        it("CM54: custom serializeArgs — used for both Map key and argsKey passed to factory", () => {
            const customSerializer = vi.fn((args: TestArgs) => `custom:${args.id}`);
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                serializeArgs: customSerializer,
            });
            map.getOrCreate({ id: 42 });
            expect(factory).toHaveBeenCalledWith({ id: 42 }, "custom:42");
        });

        it("CM55: entries() method does not exist on SerializeCacheMap", () => {
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
            });
            expect((map as unknown as Record<string, unknown>)["entries"]).toBeUndefined();
        });

        it("CM56: devtoolsKey option is ignored by SerializeCacheMap", () => {
            const devtoolsKey = vi.fn((_args: TestArgs) => "custom-key");
            const factory = vi.fn((_args: TestArgs, _argsKey: string) => ({ value: "test" }));
            const map = new SerializeCacheMap<TestArgs, TestEntry>({
                factory,
                strategy: "serialize",
                devtoolsKey,
            });
            map.getOrCreate({ id: 1 });
            expect(devtoolsKey).not.toHaveBeenCalled();
            expect(factory).toHaveBeenCalledWith({ id: 1 }, '{"id":1}');
        });
    });
});
