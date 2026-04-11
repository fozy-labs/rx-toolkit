import { describe, expect, it } from "vitest";

import { applyForwardPatches, createPatches, rebasePatches } from "@/query/core/patcher/Patcher";

describe("createPatches", () => {
    it("produces next state and forward/inverse patches", () => {
        const base = { name: "Alice", age: 30 };
        const [next, forward, inverse] = createPatches(base, (draft) => {
            draft.age = 31;
        });

        expect(next).toEqual({ name: "Alice", age: 31 });
        expect(forward.length).toBeGreaterThan(0);
        expect(inverse.length).toBeGreaterThan(0);
        expect(forward[0]).toMatchObject({ op: "replace", path: ["age"], value: 31 });
        expect(inverse[0]).toMatchObject({ op: "replace", path: ["age"], value: 30 });
    });

    it("returns empty patches when recipe makes no changes", () => {
        const base = { x: 1 };
        const [next, forward, inverse] = createPatches(base, () => {});

        expect(next).toEqual({ x: 1 });
        expect(forward).toEqual([]);
        expect(inverse).toEqual([]);
    });

    it("handles nested object mutations", () => {
        const base = { user: { name: "Bob", scores: [10, 20] } };
        const [next, forward] = createPatches(base, (draft) => {
            draft.user.scores.push(30);
        });

        expect(next.user.scores).toEqual([10, 20, 30]);
        expect(forward.length).toBeGreaterThan(0);
    });

    it("does not mutate the original base object", () => {
        const base = { value: 1 };
        const copy = { ...base };
        createPatches(base, (draft) => {
            draft.value = 99;
        });

        expect(base).toEqual(copy);
    });
});

describe("applyForwardPatches", () => {
    it("applies patches produced by createPatches", () => {
        const base = { a: 1, b: 2 };
        const [, forward] = createPatches(base, (draft) => {
            draft.a = 10;
        });

        const result = applyForwardPatches(base, forward);
        expect(result).toEqual({ a: 10, b: 2 });
    });

    it("returns unchanged object when patches array is empty", () => {
        const base = { x: 42 };
        const result = applyForwardPatches(base, []);
        expect(result).toEqual({ x: 42 });
    });

    it("applies multiple patches in sequence", () => {
        const base = { items: [1, 2, 3] };
        const [, patches1] = createPatches(base, (draft) => {
            draft.items.push(4);
        });
        const mid = applyForwardPatches(base, patches1);
        const [, patches2] = createPatches(mid, (draft) => {
            draft.items.push(5);
        });
        const result = applyForwardPatches(mid, patches2);

        expect(result).toEqual({ items: [1, 2, 3, 4, 5] });
    });

    it("works with null and primitive values inside objects", () => {
        const base = { val: null as string | null };
        const [, forward] = createPatches(base, (draft) => {
            draft.val = "hello";
        });
        const result = applyForwardPatches(base, forward);
        expect(result).toEqual({ val: "hello" });
    });
});

describe("rebasePatches", () => {
    it("re-derives patches by replaying forward patches on a new base", () => {
        const original = { count: 0 };
        const [, forwardFromOriginal] = createPatches(original, (draft) => {
            draft.count = 5;
        });

        const newBase = { count: 10 };
        const [result, newForward, newInverse] = rebasePatches(newBase, forwardFromOriginal);

        expect(result).toEqual({ count: 5 });
        expect(newForward.length).toBeGreaterThan(0);
        expect(newInverse.length).toBeGreaterThan(0);
        expect(newInverse[0]).toMatchObject({ op: "replace", path: ["count"], value: 10 });
    });

    it("returns empty patches when forward patches are empty", () => {
        const base = { x: 1 };
        const [result, forward, inverse] = rebasePatches(base, []);

        expect(result).toEqual({ x: 1 });
        expect(forward).toEqual([]);
        expect(inverse).toEqual([]);
    });

    it("produces inverse patches that can undo the rebase", () => {
        const base = { name: "A", score: 100 };
        const [, originalForward] = createPatches({ name: "A", score: 0 }, (draft) => {
            draft.score = 50;
        });

        const [rebased, , inversePatches] = rebasePatches(base, originalForward);
        expect(rebased.score).toBe(50);

        const undone = applyForwardPatches(rebased, inversePatches);
        expect(undone).toEqual(base);
    });
});
