// The List definition and the List node table of the design, one test per row.
import { z } from "zod";

import { Signal } from "@/signals";

import { unstable_FormSignal as FormSignal, type ItemNode } from "../../index";
import { record } from "../core/helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });
const required = () => f({ schema: z.string().min(1, "Required"), defaultValue: "" });
const phone = () => g({ fields: { kind: text("mobile"), number: required() } });

type Phone = { kind?: string; number?: string };

function phones(state?: Phone[]) {
    const def = g({ fields: { name: text(), phones: l({ item: phone() }) } });
    const form = FormSignal.state(def, { state: state && { phones: state } });
    return { form, list: form.fields.phones };
}

const numbers = (items: ReadonlyArray<{ fields: { number: { value$: () => string } } }>) =>
    items.map((item) => item.fields.number.value$());

describe("list definition", () => {
    it("item: a field or a group", () => {
        const def = g({ fields: { tags: l({ item: text() }), phones: l({ item: phone() }) } });
        const form = FormSignal.state(def, { state: { tags: ["a", "b"], phones: [{ number: "1" }] } });
        expect(form.fields.tags.value$()).toEqual(["a", "b"]);
        expect(form.fields.tags.items$()[0].set).toBeTypeOf("function");
        expect(form.fields.phones.value$()).toEqual([{ kind: "mobile", number: "1" }]);
        expect(form.fields.phones.items$()[0].fields.kind.value$()).toBe("mobile");
    });

    it("defaultValue: [] by default; the starting items otherwise, which state replaces", () => {
        const def = g({
            fields: {
                none: l({ item: text() }),
                some: l({ item: text(), defaultValue: ["x", "y"] }),
            },
        });
        expect(FormSignal.state(def).value$()).toEqual({ none: [], some: ["x", "y"] });
        expect(FormSignal.state(def, { state: { some: ["z"] } }).value$()).toEqual({ none: [], some: ["z"] });
    });

    it("showErrors: the list inherits the group's policy, its items inherit the list's", () => {
        const def = g({
            showErrors: "always",
            fields: {
                inherited: l({ item: required() }),
                own: l({ item: required(), showErrors: "submitted" }),
            },
        });
        const form = FormSignal.state(def, { state: { inherited: [""], own: [""] } });
        expect(form.fields.inherited.items$()[0].visibleErrors$()).toHaveLength(1);
        expect(form.fields.own.items$()[0].visibleErrors$()).toHaveLength(0);
    });

    it("validate: the short form and the map form, with the list sources", () => {
        const def = g({
            fields: {
                short: l({ item: text(), validate: ({ warn }) => warn("S") }),
                named: l({ item: text(), validate: { atMost: ({ warn }) => warn("M") } }),
            },
        });
        const form = FormSignal.state(def);
        expect(form.fields.short.ownIssues$()[0].source).toEqual({ type: "rule", path: [], name: "short" });
        expect(form.fields.named.ownIssues$()[0].source).toEqual({ type: "rule", path: ["named"], name: "atMost" });
    });

    it("context: the list validate reads the instance context", () => {
        const def = g({
            fields: {
                tags: l({
                    item: text(),
                    context: FormSignal.context<{ max: number }>(),
                    validate: ({ items$, context$, error }) => {
                        if (items$().length > context$().max) error("Too many");
                    },
                }),
            },
        });
        const form = FormSignal.state(def, { state: { tags: ["a", "b"] }, context: { max: 1 } });
        expect(form.fields.tags.errors$().map((issue) => issue.message)).toEqual(["Too many"]);
        form.initialize({ context: { max: 2 } });
        expect(form.fields.tags.errors$()).toEqual([]);
    });
});

describe("list node", () => {
    it("state$: the group meta and items, the same array as items$(), without item values", () => {
        const { form, list } = phones([{ number: "1" }]);
        const state = list.state$();
        expect(Object.keys(state).sort()).toEqual(
            [
                "isValid",
                "isPending",
                "isTouched",
                "isModified",
                "isDirty",
                "hasVisibleErrors",
                "visibleErrorCount",
                "isDisabled",
                "items",
            ].sort(),
        );
        expect(state.items).toBe(list.items$());
        expect(form.fields.phones$).toBe(list.state$);

        const snapshots = record(list.state$);
        list.items$()[0].fields.number.set("12");
        list.items$()[0].fields.number.set("123");
        expect(snapshots.values).toHaveLength(2); // only isDirty / isModified changed, once
        snapshots.unsubscribe();
    });

    it("items$: item nodes; wakes up only on add, remove and reorder", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }]);
        const items = record(list.items$);
        const [first] = list.items$();
        first.fields.number.set("10");
        first.markTouched();
        list.markTouched();
        expect(items.values).toHaveLength(1);
        list.push();
        list.move(0, 2);
        list.remove(0);
        expect(items.values).toHaveLength(4);
        expect(items.values[3]).toBe(list.items$());
        items.unsubscribe();
    });

    it("get$(key): the item node or undefined, reactively", () => {
        const { list } = phones([{ number: "1" }]);
        const [first] = list.items$();
        expect(list.get$(first.key)).toBe(first);
        expect(list.get$("missing")).toBeUndefined();
        const seen = record(Signal.compute(() => list.get$(first.key)));
        list.remove(first);
        expect(seen.values).toEqual([first, undefined]);
        seen.unsubscribe();
    });

    it("value$ / parsed$: from items$ and their values", () => {
        const { list } = phones([{ number: "1" }, { number: "" }]);
        expect(list.value$()).toEqual([
            { kind: "mobile", number: "1" },
            { kind: "mobile", number: "" },
        ]);
        expect(list.parsed$()).toEqual({ isParsed: false, value: undefined });
        list.items$()[1].fields.number.set("2");
        expect(list.parsed$()).toEqual({
            isParsed: true,
            value: [
                { kind: "mobile", number: "1" },
                { kind: "mobile", number: "2" },
            ],
        });
        list.swap(0, 1);
        expect(list.value$().map((phone) => phone.number)).toEqual(["2", "1"]);
    });

    it("value$ keeps its reference while no item value changes", () => {
        const { list } = phones([{ number: "1" }]);
        const value = list.value$();
        list.items$()[0].fields.number.markTouched();
        list.items$()[0].fields.number.set("1");
        expect(list.value$()).toBe(value);
    });

    it("push(initial?): adds an item from FormInitial<item> at the end and returns its node", () => {
        const { list } = phones([{ number: "1" }]);
        const pushed = list.push({ number: "2" });
        expect(list.items$()[1]).toBe(pushed);
        expect(pushed.value$()).toEqual({ kind: "mobile", number: "2" });
        // The initial state is the item's base: no draft.
        expect([pushed.isModified$(), pushed.isDirty$()]).toEqual([false, false]);
        expect(list.push().value$()).toEqual({ kind: "mobile", number: "" });
    });

    it("push / insert follow the presence rule: undefined is not a value, null is", () => {
        const def = g({
            fields: {
                rows: l({
                    item: g({ fields: { a: text("A"), b: f({ schema: z.string().nullable(), defaultValue: "B" }) } }),
                }),
            },
        });
        const list = FormSignal.state(def).fields.rows;
        expect(list.push({ a: undefined, b: null }).value$()).toEqual({ a: "A", b: null });
        expect(list.insert(0, undefined).value$()).toEqual({ a: "A", b: "B" });
    });

    it("insert(index, initial?): at the index, clamped to the list", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }]);
        const middle = list.insert(1, { number: "m" });
        list.insert(-5, { number: "first" });
        list.insert(99, { number: "last" });
        expect(numbers(list.items$())).toEqual(["first", "1", "m", "2", "last"]);
        expect(list.items$()[2]).toBe(middle);
    });

    it("keys: minted by a counter, distinct, never reused, stable for the node's lifetime", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }]);
        const [a, b] = list.items$();
        const c = list.push();
        list.remove(c);
        const d = list.push();
        const keys = [a.key, b.key, c.key, d.key];
        expect(new Set(keys).size).toBe(4);
        list.move(a, 1);
        list.swap(a, d);
        expect(list.items$().map((item) => item.key)).toEqual([b.key, d.key, a.key]);
        expect([a.key, b.key, d.key]).toEqual([keys[0], keys[1], keys[3]]);
    });

    it("remove / move / swap address an item by key, by ItemNode or by index", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }, { number: "3" }, { number: "4" }]);
        const [one, two, three] = list.items$();
        list.remove(two.key);
        list.remove(two); // gone already: nothing happens
        list.remove(0);
        expect(numbers(list.items$())).toEqual(["3", "4"]);
        list.move(three.key, 1);
        expect(numbers(list.items$())).toEqual(["4", "3"]);
        list.move(1, 0);
        list.swap(0, list.items$()[1].key);
        expect(numbers(list.items$())).toEqual(["4", "3"]);
        expect(list.get$(one.key)).toBeUndefined();
    });

    it("unknown references do nothing: a missing key or index, a node of another list", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }]);
        const other = phones([{ number: "x" }]).list.items$()[0];
        const items = list.items$();
        list.remove("nope");
        list.remove(5);
        list.remove(-1);
        list.remove(0.5);
        list.remove(other as unknown as ItemNode);
        list.move("nope", 0);
        list.swap(0, 7);
        expect(list.items$()).toBe(items);
        expect(list.isModified$()).toBe(false);
    });

    it("move(item, to): to is the final index, clamped; moving in place does nothing", () => {
        const { list } = phones([{ number: "1" }, { number: "2" }, { number: "3" }]);
        list.move(0, 1);
        list.move(0, 1);
        list.move(2, 0);
        list.move(1, 99);
        expect(numbers(list.items$())).toEqual(["3", "2", "1"]);
        const before = list.items$();
        list.move(0, 0);
        list.swap(1, 1);
        expect(list.items$()).toBe(before);
    });

    it("clear(): removes every item; on an empty list it does nothing", () => {
        const { list } = phones();
        list.clear();
        expect(list.isModified$()).toBe(false);
        list.push();
        list.push();
        list.clear();
        expect(list.items$()).toEqual([]);
        expect(list.value$()).toEqual([]);
    });

    it("the node moves as a whole, with its meta", () => {
        const { list } = phones([{ number: "1" }, { number: "" }]);
        const [first, second] = list.items$();
        second.fields.number.blur();
        first.fields.number.set("11");
        list.swap(first, second);
        expect(list.items$()[0]).toBe(second);
        expect(list.items$()[1]).toBe(first);
        expect(second.fields.number.isTouched$()).toBe(true);
        expect(second.fields.number.errors$().map((issue) => issue.message)).toEqual(["Required"]);
        expect(first.fields.number.isDirty$()).toBe(true);
    });

    it("markTouched(touched = true): cascades to the items", () => {
        const { list } = phones([{ number: "1" }]);
        list.markTouched();
        expect([list.isTouched$(), list.items$()[0].fields.kind.isTouched$()]).toEqual([true, true]);
        list.markTouched(false);
        expect([list.isTouched$(), list.items$()[0].fields.kind.isTouched$()]).toEqual([false, false]);
    });

    it("issues$ and aggregates: as for a group, items in items$ order", () => {
        const def = g({
            fields: {
                rows: l({
                    item: required(),
                    validate: ({ items$, warn }) => void (items$().length > 1 && warn("Two")),
                }),
            },
        });
        const list = FormSignal.state(def, { state: { rows: ["", "x"] } }).fields.rows;
        expect(list.issues$().map((issue) => [issue.message, issue.path])).toEqual([
            ["Two", ["rows"]],
            ["Required", ["rows", 0]],
        ]);
        expect(list.errors$()).toHaveLength(1);
        expect(list.warnings$()).toHaveLength(1);
        expect(list.ownIssues$().map((issue) => issue.message)).toEqual(["Two"]);
        expect(list.isValid$()).toBe(false);
        expect(list.isPending$()).toBe(false);
        list.items$()[0].set("y");
        expect(list.isValid$()).toBe(true);
        expect([list.isDirty$(), list.isModified$()]).toEqual([true, true]);
        list.items$()[0].blur();
        expect(list.isTouched$()).toBe(true);
        list.swap(0, 1);
        expect(list.issues$().map((issue) => issue.path)).toEqual([["rows"]]);
    });

    it("nodes are frozen; the item node is the item's field or group node with its key", () => {
        const { list } = phones([{ number: "1" }]);
        const item = list.items$()[0];
        expect(Object.isFrozen(list)).toBe(true);
        expect(Object.isFrozen(item)).toBe(true);
        expect(item.key).toBeTypeOf("string");
        expect(item.fields.number.value$()).toBe("1");
        expect("key" in item.fields.number).toBe(false);
        const { push } = list;
        push();
        expect(list.items$()).toHaveLength(2);
    });

    it("actions are safe inside effects and batched: one notification per action", () => {
        const { list } = phones([{ number: "1" }]);
        const source = Signal.state("a");
        const runs = vi.fn();
        const effect = Signal.effect(() => {
            runs();
            list.push({ number: source() });
            list.move(0, 99);
            list.remove(0);
        });
        list.push();
        list.clear();
        list.reset();
        expect(runs).toHaveBeenCalledOnce();
        source.set("b");
        expect(runs).toHaveBeenCalledTimes(2);
        effect.unsubscribe();

        const state = record(list.state$);
        list.markTouched();
        list.reset();
        expect(state.values.map((snapshot) => snapshot.isTouched)).toEqual([false, true, false]);
        state.unsubscribe();
    });

    it("construction and actions run no callback and set no timer", () => {
        vi.useFakeTimers();
        const rule = vi.fn();
        const def = g({ fields: { rows: l({ item: g({ fields: { a: text() }, validate: rule }), validate: rule }) } });
        const list = FormSignal.state(def, { state: { rows: [{ a: "x" }] } }).fields.rows;
        list.move(list.push(), 0);
        list.remove(1);
        list.clear();
        list.reset();
        expect(rule).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });
});
