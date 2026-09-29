// The instance as a whole: creation, reference stability, actions inside effects, the Lifetime
// contract without queries, devtools keys.
import { z } from "zod";

import { reduxDevtools } from "@/common/devtools";
import { SharedOptions } from "@/common/options/SharedOptions";
import { Signal } from "@/signals";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";

import { record, schemaOf } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

function twoFields() {
    const def = g({
        name: "pair",
        fields: { a: text(), b: text(), inner: g({ fields: { c: text() } }) },
        validate: ({ fields, error }) => {
            if (fields.a.value$() === fields.b.value$()) error(fields.b, "Must differ");
        },
    });
    return FormSignal.state(def);
}

describe("FormSignal.state()", () => {
    it("rejects a definition that is not a group", () => {
        const state = FormSignal.state as (definition: unknown) => unknown;
        expect(() => state(text())).toThrow(FormConfigError);
        expect(() => state({})).toThrow("expects a group definition");
    });

    it("nodes are frozen and their actions are stable references", () => {
        const form = twoFields();
        expect(Object.isFrozen(form)).toBe(true);
        expect(Object.isFrozen(form.fields)).toBe(true);
        expect(Object.isFrozen(form.fields.a)).toBe(true);
        expect(form.fields.a.set).toBe(form.fields.a.set);
        const { set } = form.fields.a;
        set("detached");
        expect(form.fields.a.value$()).toBe("detached");
    });
});

describe("reference stability", () => {
    it("a keystroke in one field emits no state$ of another", () => {
        const form = twoFields();
        form.fields.b.set("x");
        const b = record(form.fields.b.state$);
        const c = record(form.fields.inner.fields.c.state$);
        const inner = record(form.fields.inner.state$);
        form.fields.a.set("1");
        form.fields.a.set("12");
        expect(b.values).toHaveLength(1);
        expect(c.values).toHaveLength(1);
        expect(inner.values).toHaveLength(1);
        [b, c, inner].forEach((subscription) => subscription.unsubscribe());
    });

    it("the root state$ does not emit when no scalar of it changes", () => {
        const form = twoFields();
        form.fields.a.set("1");
        const root = record(form.state$);
        form.fields.a.set("12");
        form.fields.a.set("123");
        expect(root.values).toHaveLength(1);
        root.unsubscribe();
    });

    it("issues$ keeps its reference while its content is equal", () => {
        const def = g({ fields: { a: f({ schema: z.string().min(3, "Too short"), defaultValue: "x" }), b: text() } });
        const form = FormSignal.state(def);
        const issues = form.fields.a.issues$();
        const aggregated = form.issues$();
        form.fields.a.set("y");
        expect(form.fields.a.issues$()).toBe(issues);
        expect(form.issues$()).toBe(aggregated);
        form.fields.b.set("z");
        expect(form.issues$()).toBe(aggregated);
        form.fields.a.set("long enough");
        expect(form.issues$()).toEqual([]);
    });

    it("group value$ / parsed$ keep their reference when a left-out child changes", () => {
        const def = g({
            fields: { on: text("no"), extra: text() },
            disabled: { extra: ({ fields }) => fields.on.value$() !== "yes" },
        });
        const form = FormSignal.state(def);
        const value = form.value$();
        const parsed = form.parsed$();
        form.fields.extra.set("x");
        expect(form.value$()).toBe(value);
        expect(form.parsed$()).toBe(parsed);
    });

    it("cold reads return the same snapshot while nothing changes", () => {
        const form = twoFields();
        expect(form.state$()).toBe(form.state$());
        expect(form.fields.a.state$()).toBe(form.fields.a.state$());
        expect(form.visibleErrors$()).toBe(form.visibleErrors$());
    });
});

describe("actions", () => {
    it("are safe inside effects: they run untracked, so the effect gains no dependencies", () => {
        const form = twoFields();
        const source = Signal.state("a");
        const runs = vi.fn();
        const effect = Signal.effect(() => {
            runs();
            const value = source();
            form.fields.a.set(value);
            form.fields.inner.markTouched();
            form.initialize({ state: { b: value } }, { keepDirtyValues: true });
        });
        expect(runs).toHaveBeenCalledOnce();
        form.fields.a.set("other");
        form.reset();
        form.fields.b.set("b");
        expect(runs).toHaveBeenCalledOnce();
        source.set("next");
        expect(runs).toHaveBeenCalledTimes(2);
        expect(form.fields.a.value$()).toBe("next");
        effect.unsubscribe();
    });

    it("are batched: a cascade notifies once", () => {
        const def = g({ fields: { a: text(), b: text(), c: g({ fields: { d: text(), e: text() } }) } });
        const form = FormSignal.state(def);
        const root = record(form.state$);
        form.markTouched();
        form.reset();
        expect(root.values.map((state) => state.isTouched)).toEqual([false, true, false]);
        root.unsubscribe();
    });
});

describe("lifetime", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("construction runs no callback and sets no timer", () => {
        vi.useFakeTimers();
        const { schema, validate } = schemaOf<string>((value) => ({ value }));
        const rule = vi.fn();
        const computed = vi.fn(() => 1);
        const disabled = vi.fn(() => false);
        const equals = vi.fn(() => true);
        const def = g({
            fields: { a: f({ schema, defaultValue: "", validate: rule, equals }), b: text() },
            computed: { c: computed },
            validate: rule,
            disabled: { b: disabled },
        });
        FormSignal.state(def, { state: { a: "x" } });
        expect(validate).not.toHaveBeenCalled();
        expect(rule).not.toHaveBeenCalled();
        expect(computed).not.toHaveBeenCalled();
        expect(disabled).not.toHaveBeenCalled();
        expect(equals).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("an unsubscribed form stays usable", () => {
        const form = twoFields();
        const subscription = form.state$.obs.subscribe();
        subscription.unsubscribe();
        form.fields.a.set("x");
        expect(form.value$()).toMatchObject({ a: "x" });
        expect(form.state$().isDirty).toBe(true);
    });
});

describe("devtools", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function withSink() {
        const keys: string[] = [];
        SharedOptions.DEVTOOLS = {
            state: (name: string) => {
                keys.push(name);
                return () => {};
            },
        };
        return keys;
    }

    it("only the writable states appear, under `${key}/${path}`, with the root name as the default key", () => {
        const keys = withSink();
        twoFields();
        expect(keys.sort()).toEqual(
            [
                "pair/context$",
                "pair/meta$",
                "pair/server$",
                "pair/submit$",
                "pair/submitIssues$",
                "pair/a/input$",
                "pair/a/meta$",
                "pair/a/server$",
                "pair/b/input$",
                "pair/b/meta$",
                "pair/b/server$",
                "pair/inner/meta$",
                "pair/inner/server$",
                "pair/inner/c/input$",
                "pair/inner/c/meta$",
                "pair/inner/c/server$",
            ].sort(),
        );
    });

    it("the key option wins; a root without a name is keyed root", () => {
        const keys = withSink();
        FormSignal.state(g({ name: "named", fields: { a: text() } }), { key: "registration/1" });
        FormSignal.state(g({ fields: { a: text() } }));
        expect(keys).toContain("registration/1/a/input$");
        expect(keys).toContain("root/a/input$");
        expect(keys.some((key) => key.startsWith("named"))).toBe(false);
    });

    it("a leaf never collides with a node: every key ends with a `$` segment", () => {
        const keys = withSink();
        FormSignal.state(g({ fields: { context: g({ fields: { meta: text() } }), server: text() } }));
        const leaves = new Set(keys);
        for (const key of keys) {
            expect(key.split("/").pop()).toMatch(/\$$/);
            const segments = key.split("/");
            for (let i = 1; i < segments.length; i++) expect(leaves.has(segments.slice(0, i).join("/"))).toBe(false);
        }
    });

    it("the redux devtools tree mirrors the form with no collision warnings", () => {
        const warn = vi.spyOn(console, "warn");
        const send = vi.fn();
        const driver = { connect: () => ({ init: () => {}, send }) };
        SharedOptions.DEVTOOLS = reduxDevtools({ driver, batchStrategy: "sync" });
        const form = FormSignal.state(g({ fields: { a: text(), inner: g({ fields: { c: text() } }) } }), {
            key: "form",
            context: { id: 1 },
        });
        form.fields.inner.fields.c.set("typed");
        form.fields.a.blur();
        const tree = send.mock.calls.at(-1)![1] as { form: Record<string, unknown> };
        expect(tree.form).toMatchObject({
            context$: { id: 1 },
            a: { meta$: { isTouched: true, isFocused: false, isSubmitted: false } },
            inner: { c: { input$: { default: "", value: "typed" }, server$: [] } },
        });
        expect(warn).not.toHaveBeenCalled();
    });

    it("derived signals do not appear", () => {
        const keys = withSink();
        const form = twoFields();
        const count = keys.length;
        form.state$();
        form.issues$();
        form.fields.a.state$();
        expect(keys).toHaveLength(count);
    });
});
