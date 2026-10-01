// The List structure bullets of the design, the list parts of Reset and initialization, and the
// reinit matching with worked examples. Rows are written as letters: `[A, B, C]` is a base of
// three rows whose `number` is "A", "B", "C".
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";
import { addServerIssue, markSubmitted } from "../core/helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

const phonesDef = g({
    fields: {
        name: text(),
        phones: l({ item: g({ fields: { kind: text("mobile"), number: text() } }) }),
    },
});

function phones(...rows: string[]) {
    const form = FormSignal.state(phonesDef, { state: { phones: rows.map((number) => ({ number })) } });
    return { form, list: form.fields.phones };
}

type Phones = ReturnType<typeof phones>["list"];

/** The rows as `key=number`, in order. */
const rows = (list: Phones) => list.items$().map((item) => `${item.key}=${item.fields.number.value$()}`);
const flags = (list: Phones) => ({ isModified: list.isModified$(), isDirty: list.isDirty$() });

/** The same node objects, in order (`toEqual` would compare them structurally). */
function expectSameNodes(actual: readonly object[], expected: readonly object[]) {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((node, index) => expect(node).toBe(expected[index]));
}

describe("list structure", () => {
    it("a structural draft sticks like a field's: isModified stays when the order returns", () => {
        const { list } = phones("A", "B");
        expect(flags(list)).toEqual({ isModified: false, isDirty: false });
        list.swap(0, 1);
        expect(flags(list)).toEqual({ isModified: true, isDirty: true });
        list.swap(0, 1);
        expect(flags(list)).toEqual({ isModified: true, isDirty: false });
        const pushed = list.push();
        list.remove(pushed);
        expect(flags(list)).toEqual({ isModified: true, isDirty: false });
    });

    it("isDirty$ = structure ≠ base ∨ any item is dirty; isModified$ = structure changed ∨ any item modified", () => {
        const { list } = phones("A");
        const [a] = list.items$();
        a.fields.number.set("A");
        expect(flags(list)).toEqual({ isModified: false, isDirty: false });
        a.fields.number.set("A2");
        a.fields.number.set("A");
        expect(flags(list)).toEqual({ isModified: true, isDirty: false });
        a.fields.number.set("A2");
        expect(flags(list)).toEqual({ isModified: true, isDirty: true });
        a.reset();
        list.push();
        expect(flags(list)).toEqual({ isModified: true, isDirty: true });
    });

    it("the list flags reach the parent and the root", () => {
        const { form, list } = phones("A", "B");
        list.move(0, 1);
        expect([form.isDirty$(), form.isModified$(), form.state$().isDirty]).toEqual([true, true, true]);
        list.move(0, 1);
        expect([form.isDirty$(), form.isModified$()]).toEqual([false, true]);
    });

    describe("reset()", () => {
        it("restores the base: removed rows come back, added ones go, the base order returns", () => {
            const { list } = phones("A", "B", "C");
            const [a, b, c] = list.items$();
            list.remove(b);
            list.push({ number: "D" });
            list.move(c, 0);
            list.reset();
            expectSameNodes(list.items$(), [a, b, c]);
            expect(rows(list)).toEqual([`${a.key}=A`, `${b.key}=B`, `${c.key}=C`]);
            expect(flags(list)).toEqual({ isModified: false, isDirty: false });
        });

        it("a removed row returns as the same node, with base values and pristine meta", () => {
            const { list } = phones("A", "B");
            const b = list.items$()[1];
            b.fields.number.set("edited");
            b.fields.number.blur();
            addServerIssue(b.fields.number, "Server");
            list.remove(b);
            list.reset();
            expect(list.items$()[1]).toBe(b);
            expect(b.fields.number.value$()).toBe("B");
            expect([b.isTouched$(), b.isModified$(), b.issues$()]).toEqual([false, false, []]);
        });

        it("the remaining rows get a cascading reset(), and the list's own meta and server issues go", () => {
            const { list } = phones("A");
            const [a] = list.items$();
            a.fields.number.set("A2");
            list.markTouched();
            markSubmitted(list);
            addServerIssue(list, "List");
            list.reset();
            expect(a.fields.number.value$()).toBe("A");
            expect([list.isTouched$(), list.issues$()]).toEqual([false, []]);
            expect(list.visibleErrors$()).toEqual([]);
        });

        it("a row that was never in the base is dropped: reset does not bring it back", () => {
            const { list } = phones("A");
            const added = list.push({ number: "X" });
            list.remove(added);
            list.reset();
            expect(list.items$()).toHaveLength(1);
            expect(list.get$(added.key)).toBeUndefined();
        });

        it("the root reset() reaches the list", () => {
            const { form, list } = phones("A", "B");
            list.clear();
            form.reset();
            expect(rows(list)).toHaveLength(2);
            expect(form.isModified$()).toBe(false);
        });
    });

    it("a detached row keeps its input, meta and key, and is data without activity", () => {
        const { form, list } = phones("A", "B");
        const b = list.items$()[1];
        b.fields.number.set("B2");
        b.fields.number.blur();
        list.remove(b);
        expect([b.key, b.fields.number.value$(), b.isTouched$()]).toEqual([b.key, "B2", true]);
        // The aggregates no longer read it.
        const isDirty = form.isDirty$();
        b.fields.number.set("B3");
        expect(form.isDirty$()).toBe(isDirty);
        expect(form.value$().phones).toEqual([{ kind: "mobile", number: "A" }]);
    });

    it("remove of an item removes its issues together with the node", () => {
        const def = g({
            fields: { rows: l({ item: f({ schema: z.string().min(1, "Required"), defaultValue: "" }) }) },
            validate: ({ fields, error }) => {
                for (const item of fields.rows.items$()) if (!item.value$()) error(item, "Empty");
            },
        });
        const form = FormSignal.state(def, { state: { rows: ["", "x"] } });
        const [first] = form.fields.rows.items$();
        expect(form.issues$().map((issue) => issue.message)).toEqual(["Required", "Empty"]);
        form.fields.rows.remove(first);
        expect(form.issues$()).toEqual([]);
        expect(form.isValid$()).toBe(true);
    });
});

describe("initialize and lists", () => {
    it("[A, B, C] ← [x, y]: the first rows keep their keys and get their values, the extra one goes", () => {
        const { form, list } = phones("A", "B", "C");
        const [a, b] = list.items$();
        form.initialize({ state: { phones: [{ number: "x" }, { number: "y" }] } });
        expectSameNodes(list.items$(), [a, b]);
        expect(rows(list)).toEqual([`${a.key}=x`, `${b.key}=y`]);
        expect(flags(list)).toEqual({ isModified: false, isDirty: false });
    });

    it("[A] ← [x, y, z]: the missing rows are created with new keys", () => {
        const { form, list } = phones("A");
        const [a] = list.items$();
        form.initialize({ state: { phones: [{ number: "x" }, { number: "y" }, { number: "z" }] } });
        const [first, second, third] = list.items$();
        expect(first).toBe(a);
        expect(new Set([a.key, second.key, third.key]).size).toBe(3);
        expect(rows(list).map((row) => row.split("=")[1])).toEqual(["x", "y", "z"]);
        expect([second.isModified$(), third.isModified$()]).toEqual([false, false]);
    });

    it("matching goes by the base order: [A, B] swapped, ← [x, y] gives A's row x and B's row y", () => {
        const { form, list } = phones("A", "B");
        const [a, b] = list.items$();
        list.swap(a, b);
        form.initialize({ state: { phones: [{ number: "x" }, { number: "y" }] } });
        expect(rows(list)).toEqual([`${a.key}=x`, `${b.key}=y`]);
        expect(flags(list)).toEqual({ isModified: false, isDirty: false });
    });

    it("[A, B, C] with B removed, ← [x, y, z]: B's row comes back with y", () => {
        const { form, list } = phones("A", "B", "C");
        const [a, b, c] = list.items$();
        list.remove(b);
        form.initialize({ state: { phones: [{ number: "x" }, { number: "y" }, { number: "z" }] } });
        expectSameNodes(list.items$(), [a, b, c]);
        expect(b.fields.number.value$()).toBe("y");
    });

    it("[A, B] with B removed, ← [x]: the detached row whose key left the base is dropped", () => {
        const { form, list } = phones("A", "B");
        const b = list.items$()[1];
        list.remove(b);
        form.initialize({ state: { phones: [{ number: "x" }] } });
        list.reset();
        expect(rows(list)).toHaveLength(1);
        expect(list.get$(b.key)).toBeUndefined();
    });

    it("rows added before the reinit are dropped with the draft", () => {
        const { form, list } = phones("A");
        const added = list.push({ number: "new" });
        form.initialize({ state: { phones: [{ number: "x" }] } });
        expect(list.items$()).toHaveLength(1);
        expect(list.get$(added.key)).toBeUndefined();
    });

    it("an item follows the Reinit rule: its fields outside the data are not touched", () => {
        const { form, list } = phones("A");
        const [a] = list.items$();
        a.fields.kind.set("home");
        form.initialize({ state: { phones: [{ number: "x" }] } });
        expect(a.value$()).toEqual({ kind: "home", number: "x" });
    });

    it("initialize() without state: a list nested in the items re-derives its defaults", () => {
        const def = g({
            fields: {
                rows: l({
                    item: g({ fields: { name: text("row"), tags: l({ item: text("tag"), defaultValue: ["t1"] }) } }),
                    defaultValue: [
                        { name: "r1", tags: ["x", "y"] },
                        { name: "r2", tags: ["z"] },
                    ],
                }),
            },
        });
        const form = FormSignal.state(def);
        const list = form.fields.rows;
        list.items$()[0].fields.tags.items$()[0].set("changed");
        list.push({ name: "new", tags: [] });
        form.initialize();
        expect(list.value$()).toEqual([
            { name: "r1", tags: ["x", "y"] },
            { name: "r2", tags: ["z"] },
        ]);
        expect([list.isModified$(), list.isDirty$()]).toEqual([false, false]);
    });

    it("initialize({ context }) leaves the structure, the items and their meta", () => {
        const { form, list } = phones("A", "B");
        list.swap(0, 1);
        list.markTouched();
        const items = list.items$();
        form.initialize({ context: { any: 1 } });
        expect(list.items$()).toBe(items);
        expect([flags(list), list.isTouched$()]).toEqual([{ isModified: true, isDirty: true }, true]);
    });

    it("a nested list follows the same matching inside a kept row", () => {
        const def = g({
            fields: { groups: l({ item: g({ fields: { tags: l({ item: text() }) } }) }) },
        });
        const form = FormSignal.state(def, { state: { groups: [{ tags: ["a", "b"] }] } });
        const [group] = form.fields.groups.items$();
        const [a] = group.fields.tags.items$();
        form.initialize({ state: { groups: [{ tags: ["x"] }, { tags: ["y"] }] } });
        expect(form.fields.groups.items$()[0]).toBe(group);
        expectSameNodes(group.fields.tags.items$(), [a]);
        expect(form.value$()).toEqual({ groups: [{ tags: ["x"] }, { tags: ["y"] }] });
    });

    it("a list outside the state is not touched", () => {
        const { form, list } = phones("A");
        list.push();
        form.initialize({ state: { name: "Ann" } });
        expect(list.items$()).toHaveLength(2);
        expect(flags(list)).toEqual({ isModified: true, isDirty: true });
    });

    it("initialize() without state: the list defaultValue, keys kept by index", () => {
        const def = g({
            fields: { tags: l({ item: text(), defaultValue: ["d1", "d2"] }) },
        });
        const form = FormSignal.state(def, { state: { tags: ["a", "b", "c"] } });
        const [a, b] = form.fields.tags.items$();
        form.fields.tags.items$()[0].set("edited");
        form.initialize();
        expectSameNodes(form.fields.tags.items$(), [a, b]);
        expect(form.fields.tags.value$()).toEqual(["d1", "d2"]);
        expect(form.isModified$()).toBe(false);
    });

    it("initialize() without state: a key the default item leaves out takes its own defaultValue", () => {
        const item = g({
            fields: { a: text("A"), b: text("B") },
            disabled: { b: ({ fields }) => fields.a.value$() === "off" },
        });
        const def = g({ fields: { rows: l({ item, defaultValue: [{ a: "x" }] }) } });
        const form = FormSignal.state(def, { state: { rows: [{ a: "1", b: "2" }] } });
        const [row] = form.fields.rows.items$();
        row.fields.b.set("edited");
        form.initialize();
        expect(form.fields.rows.items$()[0]).toBe(row);
        expect(row.value$()).toEqual({ a: "x", b: "B" });
    });

    it("meta and server issues: removed by initialize, kept by a deferred list", () => {
        const { form, list } = phones("A", "B");
        list.markTouched();
        addServerIssue(list, "List");
        form.initialize({ state: { phones: [{ kind: "home", number: "x" }] } });
        expect([list.isTouched$(), list.issues$()]).toEqual([false, []]);

        list.push();
        list.markTouched();
        addServerIssue(list, "List");
        form.initialize({ state: { phones: [] } }, { keepDirtyLists: true });
        expect(list.isTouched$()).toBe(true);
        expect(list.issues$().map((issue) => issue.message)).toEqual(["List"]);
    });

    describe("keepDirtyLists", () => {
        it("a dirty structure is kept; the reinit data is deferred and reset() applies the last one", () => {
            const { form, list } = phones("A", "B");
            const [a, b] = list.items$();
            list.swap(a, b);
            const added = list.push({ number: "C" });
            form.initialize({ state: { phones: [{ number: "x" }] } }, { keepDirtyLists: true });
            form.initialize({ state: { phones: [{ number: "p" }, { number: "q" }] } }, { keepDirtyLists: true });
            expectSameNodes(list.items$(), [b, a, added]);
            expect(rows(list)).toEqual([`${b.key}=B`, `${a.key}=A`, `${added.key}=C`]);
            list.reset();
            expect(rows(list)).toEqual([`${a.key}=p`, `${b.key}=q`]);
            expect(flags(list)).toEqual({ isModified: false, isDirty: false });
            // Applied once: a second reset keeps the new base.
            list.reset();
            expect(rows(list)).toEqual([`${a.key}=p`, `${b.key}=q`]);
        });

        it("a structural draft that is not dirty is dropped, like a field's", () => {
            const { form, list } = phones("A", "B");
            list.swap(0, 1);
            list.swap(0, 1);
            form.initialize({ state: { phones: [{ number: "x" }] } }, { keepDirtyLists: true });
            expect(rows(list).map((row) => row.split("=")[1])).toEqual(["x"]);
            expect(flags(list)).toEqual({ isModified: false, isDirty: false });
        });

        it("defaults to keepDirtyValues", () => {
            const { form, list } = phones("A", "B");
            list.swap(0, 1);
            form.initialize({ state: { phones: [{ number: "x" }] } }, { keepDirtyValues: true });
            expect(rows(list).map((row) => row.split("=")[1])).toEqual(["B", "A"]);
        });

        it("false with keepDirtyValues: the structure is replaced, the item drafts follow the value rule", () => {
            const { form, list } = phones("A", "B");
            const [a, b] = list.items$();
            list.swap(a, b);
            a.fields.number.set("mine");
            b.fields.number.set("y");
            form.initialize(
                { state: { phones: [{ number: "x" }, { number: "y" }] } },
                { keepDirtyValues: true, keepDirtyLists: false },
            );
            expectSameNodes(list.items$(), [a, b]);
            // A's draft differs from the old and the new base: kept. B's equals the new base: dropped.
            expect([a.fields.number.value$(), a.fields.number.isModified$()]).toEqual(["mine", true]);
            expect([b.fields.number.value$(), b.fields.number.isModified$()]).toEqual(["y", false]);
        });

        it("a later reinit of a clean structure drops the deferred data", () => {
            const { form, list } = phones("A");
            const added = list.push({ number: "B" });
            form.initialize({ state: { phones: [{ number: "deferred" }] } }, { keepDirtyLists: true });
            list.remove(added);
            form.initialize({ state: { phones: [{ number: "now" }] } }, { keepDirtyLists: true });
            list.reset();
            expect(rows(list).map((row) => row.split("=")[1])).toEqual(["now"]);
        });
    });
});
