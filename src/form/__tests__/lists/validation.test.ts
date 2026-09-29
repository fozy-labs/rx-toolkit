// Lists in validation, disabled and aggregation: list validate (ListValidateCtx), rule paths
// through lists, disabled inside lists, and the aggregates of groups and the root over lists.
import { z } from "zod";

import { SharedOptions } from "@/common/options/SharedOptions";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";
import { markSubmitted, record } from "../core/helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });
const required = () => f({ schema: z.string().min(1, "Required"), defaultValue: "" });

const messages = (issues: ReadonlyArray<{ message: string }>) => issues.map((issue) => issue.message);
const paths = (issues: ReadonlyArray<{ path: unknown }>) => issues.map((issue) => issue.path);

describe("list validate", () => {
    it("the context: items$, get$, value$, parsed$, context$ and the collectors; items are the item nodes", () => {
        let seen: Record<string, unknown> = {};
        const def = g({
            fields: {
                tags: l({
                    item: text(),
                    validate: (ctx) => {
                        seen = { ...ctx };
                        ctx.items$();
                    },
                }),
            },
        });
        const form = FormSignal.state(def, { state: { tags: ["a"] } });
        form.fields.tags.issues$();
        expect(Object.keys(seen).sort()).toEqual(
            ["context$", "error", "get$", "items$", "parsed$", "value$", "warn"].sort(),
        );
        expect(seen.items$).toBe(form.fields.tags.items$);
        expect(seen.get$).toBe(form.fields.tags.get$);
        expect(seen.value$).toBe(form.fields.tags.value$);
    });

    it("error / warn without a node go to the list, with a node to an item of the list", () => {
        const def = g({
            fields: {
                tags: l({
                    item: text(),
                    validate: ({ items$, error, warn }) => {
                        const items = items$();
                        if (items.length > 1) warn("Many");
                        const seen = new Set<string>();
                        for (const item of items) {
                            if (seen.has(item.value$())) error(item, "Duplicate", { code: "dup" });
                            seen.add(item.value$());
                        }
                    },
                }),
            },
        });
        const form = FormSignal.state(def, { state: { tags: ["a", "b", "a"] } });
        const list = form.fields.tags;
        expect(messages(list.ownIssues$())).toEqual(["Many"]);
        expect(list.items$()[2].issues$()).toEqual([
            {
                path: ["tags", 2],
                message: "Duplicate",
                severity: "error",
                code: "dup",
                source: { type: "rule", path: [], name: "tags" },
            },
        ]);
    });

    it("error(node) outside the list's subtree throws FormConfigError", () => {
        let outside: unknown;
        const def = g({
            fields: {
                other: text(),
                tags: l({ item: text(), validate: ({ error }) => error(outside as never, "Nope") }),
            },
        });
        const form = FormSignal.state(def);
        outside = form.fields.other;
        expect(() => form.fields.tags.issues$()).toThrow(FormConfigError);
    });

    it("a throw is one error issue with the rule's source", () => {
        const def = g({
            fields: {
                tags: l({
                    item: text(),
                    validate: {
                        check: ({ warn }) => {
                            warn("partial");
                            throw new Error("boom");
                        },
                    },
                }),
            },
        });
        const issues = FormSignal.state(def).fields.tags.issues$();
        expect(issues).toEqual([
            {
                path: ["tags"],
                message: "boom",
                severity: "error",
                source: { type: "rule", path: ["tags"], name: "check" },
            },
        ]);
    });

    it("recomputes only from what it read: a keystroke in an item does not rerun a length rule", () => {
        const rule = vi.fn(({ items$, warn }: { items$: () => unknown[]; warn: (m: string) => void }) => {
            if (items$().length > 1) warn("Many");
        });
        const def = g({ fields: { tags: l({ item: text(), validate: rule }) } });
        const list = FormSignal.state(def, { state: { tags: ["a"] } }).fields.tags;
        const issues = record(list.issues$);
        list.items$()[0].set("b");
        expect(rule).toHaveBeenCalledTimes(1);
        list.push();
        expect(rule).toHaveBeenCalledTimes(2);
        issues.unsubscribe();
    });

    it("own issues are visible under the list's policy, over the list's aggregates", () => {
        const def = g({
            fields: {
                touched: l({ item: text(), validate: ({ error }) => error("T") }),
                modified: l({ item: text(), showErrors: "modified", validate: ({ error }) => error("M") }),
            },
        });
        const form = FormSignal.state(def, { state: { touched: ["a"], modified: ["a"] } });
        const { touched, modified } = form.fields;
        expect([touched.visibleErrors$(), modified.visibleErrors$()]).toEqual([[], []]);
        touched.items$()[0].blur();
        modified.items$()[0].set("b");
        expect(messages(touched.visibleErrors$())).toEqual(["T"]);
        expect(messages(modified.visibleErrors$())).toEqual(["M"]);
        expect(form.state$().visibleErrorCount).toBe(2);
    });

    it("submitted shows the issues under any policy", () => {
        const def = g({
            fields: { tags: l({ item: text(), showErrors: "submitted", validate: ({ error }) => error("E") }) },
        });
        const form = FormSignal.state(def);
        expect(form.fields.tags.visibleErrors$()).toEqual([]);
        markSubmitted(form);
        expect(messages(form.fields.tags.visibleErrors$())).toEqual(["E"]);
    });
});

describe("rule paths through lists", () => {
    function rows() {
        const item = g({
            fields: { number: required(), kind: text() },
            validate: { kind: ({ fields, warn }) => void (fields.kind.value$() === "fax" && warn("Fax")) },
        });
        const def = g({
            fields: { phones: l({ item }) },
            validate: ({ fields, error }) => {
                for (const row of fields.phones.items$()) {
                    if (row.fields.number.value$() === "0") error(row.fields.number, "Zero");
                }
            },
        });
        const form = FormSignal.state(def, {
            state: { phones: [{ number: "1" }, { number: "", kind: "fax" }, { number: "0" }] },
        });
        return { form, list: form.fields.phones };
    }

    it("Issue.path is absolute, with the item index", () => {
        const { form } = rows();
        expect(form.issues$().map((issue) => [issue.message, issue.path])).toEqual([
            ["Fax", ["phones", 1]],
            ["Required", ["phones", 1, "number"]],
            ["Zero", ["phones", 2, "number"]],
        ]);
    });

    it("paths follow move, swap, insert and remove", () => {
        const { form, list } = rows();
        const [, empty, zero] = list.items$();
        list.move(zero, 0);
        expect(paths(form.issues$())).toEqual([
            ["phones", 0, "number"],
            ["phones", 2],
            ["phones", 2, "number"],
        ]);
        list.insert(0);
        list.remove(zero);
        expect(paths(empty.issues$())).toEqual([
            ["phones", 2],
            ["phones", 2, "number"],
        ]);
    });

    it("the aggregated order follows items$ order", () => {
        const { form, list } = rows();
        list.swap(1, 2);
        expect(messages(form.issues$())).toEqual(["Zero", "Fax", "Required"]);
    });

    it("a subscriber sees the new path after a move", () => {
        const { list } = rows();
        const zero = list.items$()[2];
        const issues = record(zero.fields.number.issues$);
        list.move(zero, 0);
        expect(issues.values.map(paths)).toEqual([[["phones", 2, "number"]], [["phones", 0, "number"]]]);
        issues.unsubscribe();
    });

    it("schema paths are appended to the item path", () => {
        const def = g({
            fields: {
                rows: l({ item: f({ schema: z.object({ a: z.string() }), defaultValue: { a: 1 } as never }) }),
            },
        });
        const form = FormSignal.state(def, { state: { rows: [{ a: "ok" }, { a: 1 } as never] } });
        expect(paths(form.issues$())).toEqual([["rows", 1, "a"]]);
    });

    it("sources name an item by its key, which stays across moves", () => {
        const { list } = rows();
        const fax = list.items$()[1];
        list.move(fax, 0);
        expect(fax.issues$()[0].source).toEqual({ type: "rule", path: ["phones", fax.key], name: "kind" });
    });

    it("nested lists: paths through both indices", () => {
        const def = g({
            fields: {
                groups: l({ item: g({ fields: { title: text(), tags: l({ item: required() }) } }) }),
            },
        });
        const form = FormSignal.state(def, { state: { groups: [{ tags: ["a"] }, { tags: ["b", ""] }] } });
        expect(paths(form.issues$())).toEqual([["groups", 1, "tags", 1]]);
        form.fields.groups.swap(0, 1);
        expect(paths(form.issues$())).toEqual([["groups", 0, "tags", 1]]);
        expect(form.value$()).toEqual({
            groups: [
                { title: "", tags: ["b", ""] },
                { title: "", tags: ["a"] },
            ],
        });
    });
});

describe("disabled and lists", () => {
    function withList() {
        const def = g({
            fields: {
                hasPhones: f({ schema: z.boolean(), defaultValue: true }),
                phones: l({ item: g({ fields: { number: required() } }) }),
            },
            disabled: { phones: ({ fields }) => !fields.hasPhones.value$() },
        });
        return FormSignal.state(def, { state: { phones: [{ number: "" }] } });
    }

    it("a disabled list is left out of the group's value, parsed and aggregates", () => {
        const form = withList();
        const list = form.fields.phones;
        list.push();
        expect([form.isValid$(), form.isDirty$(), form.value$()]).toEqual([
            false,
            true,
            { hasPhones: true, phones: [{ number: "" }, { number: "" }] },
        ]);
        form.fields.hasPhones.set(false);
        expect(form.value$()).toEqual({ hasPhones: false });
        expect(form.parsed$()).toEqual({ isParsed: true, value: { hasPhones: false } });
        expect(form.isValid$()).toBe(true);
        expect(form.issues$()).toEqual([]);
        expect(list.isDirty$()).toBe(true);
    });

    it("the items inherit isDisabled$; the structural draft stays and shows again when enabled", () => {
        const form = withList();
        const list = form.fields.phones;
        const pushed = list.push({ number: "1" });
        form.fields.hasPhones.set(false);
        expect([list.isDisabled$(), pushed.isDisabled$(), pushed.fields.number.state$().isDisabled]).toEqual([
            true,
            true,
            true,
        ]);
        form.fields.hasPhones.set(true);
        expect(list.items$()).toHaveLength(2);
        expect(form.value$().phones).toHaveLength(2);
    });

    it("reset and markTouched reach a disabled list and its items", () => {
        const form = withList();
        const list = form.fields.phones;
        list.push();
        form.fields.hasPhones.set(false);
        form.markTouched();
        expect(list.items$()[0].fields.number.isTouched$()).toBe(true);
        form.reset();
        expect(list.items$()).toHaveLength(1);
        expect(list.items$()[0].fields.number.isTouched$()).toBe(false);
    });

    it("disabled inside an item: only that item's key leaves its value", () => {
        const item = g({
            fields: { kind: text("mobile"), ext: text() },
            disabled: { ext: ({ fields }) => fields.kind.value$() !== "work" },
        });
        const def = g({ fields: { phones: l({ item }) } });
        const form = FormSignal.state(def, { state: { phones: [{ kind: "work", ext: "12" }, { ext: "34" }] } });
        expect(form.value$().phones).toEqual([{ kind: "work", ext: "12" }, { kind: "mobile" }]);
        form.fields.phones.swap(0, 1);
        expect(form.value$().phones).toEqual([{ kind: "mobile" }, { kind: "work", ext: "12" }]);
    });
});

describe("aggregation over lists", () => {
    function form() {
        const def = g({ fields: { rows: l({ item: required() }) } });
        return FormSignal.state(def, { state: { rows: ["", "x"] } });
    }

    it("the root aggregates react after remove and clear, subscribed", () => {
        const instance = form();
        const list = instance.fields.rows;
        const state = record(instance.state$);
        const value = record(instance.value$);
        expect(state.values.at(-1)).toMatchObject({ isValid: false, isDirty: false });
        list.remove(0);
        expect(state.values.at(-1)).toMatchObject({ isValid: true, isDirty: true });
        const added = list.push();
        expect(state.values.at(-1)).toMatchObject({ isValid: false });
        added.set("y");
        expect(state.values.at(-1)).toMatchObject({ isValid: true });
        list.clear();
        expect(value.values.at(-1)).toEqual({ rows: [] });
        added.set(""); // a dropped row no longer reaches the root
        expect(state.values.at(-1)).toMatchObject({ isValid: true, isDirty: true });
        instance.reset();
        expect(state.values.at(-1)).toMatchObject({ isValid: false, isDirty: false, isModified: false });
        expect(value.values.at(-1)).toEqual({ rows: ["", "x"] });
        state.unsubscribe();
        value.unsubscribe();
    });

    it("the root aggregates react after remove and clear, read cold", () => {
        const instance = form();
        const list = instance.fields.rows;
        expect(instance.isValid$()).toBe(false);
        list.remove(0);
        expect(instance.isValid$()).toBe(true);
        list.push();
        expect([instance.isValid$(), instance.errors$().length]).toEqual([false, 1]);
        list.clear();
        expect([instance.isValid$(), instance.issues$(), instance.value$()]).toEqual([true, [], { rows: [] }]);
    });

    it("isTouched$ and isPending$ of the root read the items", () => {
        const instance = form();
        expect(instance.isPending$()).toBe(false);
        instance.fields.rows.items$()[1].blur();
        expect(instance.isTouched$()).toBe(true);
        instance.fields.rows.remove(1);
        expect(instance.isTouched$()).toBe(false);
    });
});

describe("devtools", () => {
    afterEach(() => {
        SharedOptions.DEVTOOLS = null;
    });

    it("the structure is keys$; an item's writable states are keyed by the item key", () => {
        const keys: string[] = [];
        SharedOptions.DEVTOOLS = {
            state: (name: string) => {
                keys.push(name);
                return () => {};
            },
        };
        const def = g({ name: "f", fields: { rows: l({ item: g({ fields: { a: text() } }) }) } });
        const instance = FormSignal.state(def, { state: { rows: [{}] } });
        const [row] = instance.fields.rows.items$();
        const pushed = instance.fields.rows.push();
        expect(keys.filter((key) => key.startsWith("f/rows")).sort()).toEqual(
            [
                "f/rows/keys$",
                "f/rows/meta$",
                "f/rows/server$",
                `f/rows/${row.key}/meta$`,
                `f/rows/${row.key}/server$`,
                `f/rows/${row.key}/a/input$`,
                `f/rows/${row.key}/a/meta$`,
                `f/rows/${row.key}/a/server$`,
                `f/rows/${pushed.key}/meta$`,
                `f/rows/${pushed.key}/server$`,
                `f/rows/${pushed.key}/a/input$`,
                `f/rows/${pushed.key}/a/meta$`,
                `f/rows/${pushed.key}/a/server$`,
            ].sort(),
        );
    });
});
