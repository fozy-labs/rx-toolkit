// The Throws table of the design (the rows of Stage 2) and configuration errors found during a
// computation.
import { z } from "zod";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";

import { record, schemaOf } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("throws", () => {
    it("schema threw: an error issue with the schema source", () => {
        const { schema } = schemaOf<string>(() => {
            throw new Error("Schema broke");
        });
        const form = FormSignal.state(g({ fields: { a: f({ schema, defaultValue: "" }) } }));
        expect(form.fields.a.parsed$()).toEqual({ isParsed: false, value: undefined });
        expect(form.fields.a.issues$()).toEqual([
            { path: ["a"], message: "Schema broke", severity: "error", source: { type: "schema" } },
        ]);
    });

    it("schema returned a promise: an error issue, one console.error, the rejection swallowed", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const { schema } = schemaOf<string>(() => Promise.reject(new Error("async")));
        const form = FormSignal.state(g({ fields: { a: f({ schema, defaultValue: "" }) } }));
        expect(form.fields.a.issues$()).toEqual([
            {
                path: ["a"],
                message: expect.stringContaining("Async schemas"),
                severity: "error",
                source: { type: "schema" },
            },
        ]);
        form.fields.a.set("x");
        form.fields.a.issues$();
        expect(consoleError).toHaveBeenCalledOnce();
        expect(consoleError.mock.calls[0][0]).toMatch(/queries/);
        // An unhandled rejection would fail the test run.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it("a zod async refine is the same case", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const schema = z.string().refine(async () => true);
        const form = FormSignal.state(g({ fields: { a: f({ schema, defaultValue: "" }) } }));
        expect(form.fields.a.isValid$()).toBe(false);
        expect(form.fields.a.errors$()).toHaveLength(1);
    });

    it("rule threw: one error issue with the rule's source; the partial issues of the run are dropped", () => {
        const def = g({
            fields: { a: text() },
            validate: {
                broken: ({ fields, error, warn }) => {
                    warn("Partial");
                    error(fields.a, "Partial too");
                    if (fields.a.value$() === "boom") throw new Error("Rule broke");
                },
            },
        });
        const form = FormSignal.state(def);
        form.fields.a.set("boom");
        expect(form.issues$()).toEqual([
            { path: [], message: "Rule broke", severity: "error", source: { type: "rule", path: [], name: "broken" } },
        ]);
        form.fields.a.set("fine");
        expect(form.issues$().map((issue) => issue.message)).toEqual(["Partial", "Partial too"]);
    });

    it("disabled threw: the node is not disabled; a callback issue", () => {
        const def = g({
            fields: {
                a: text(),
                inner: g({
                    fields: { b: text() },
                    disabled: {
                        b: ({ fields }) => {
                            if (fields.b.value$() === "boom") throw new Error("Predicate broke");
                            return true;
                        },
                    },
                }),
            },
        });
        const form = FormSignal.state(def);
        const inner = form.fields.inner;
        expect(inner.fields.b.isDisabled$()).toBe(true);
        inner.fields.b.set("boom");
        expect(inner.fields.b.isDisabled$()).toBe(false);
        expect(inner.value$()).toEqual({ b: "boom" });
        expect(inner.ownIssues$()).toEqual([
            {
                path: ["inner"],
                message: "Predicate broke",
                severity: "error",
                source: { type: "callback", path: ["inner"], name: "disabled.b" },
            },
        ]);
        expect(form.isValid$()).toBe(false);
    });

    it("computed threw: undefined before the first success, then the last successful value; never throws on read", () => {
        const def = g({
            fields: { a: text("boom") },
            computed: {
                upper: ({ fields }) => {
                    if (fields.a.value$() === "boom") throw new Error("Computed broke");
                    return fields.a.value$().toUpperCase();
                },
            },
        });
        const form = FormSignal.state(def);
        const updates = record(form.computed.upper$);
        expect(form.computed.upper$()).toBeUndefined();
        expect(form.ownIssues$()).toEqual([
            {
                path: [],
                message: "Computed broke",
                severity: "error",
                source: { type: "callback", path: [], name: "computed.upper" },
            },
        ]);
        form.fields.a.set("ok");
        expect(form.computed.upper$()).toBe("OK");
        expect(form.ownIssues$()).toEqual([]);
        form.fields.a.set("boom");
        expect(form.computed.upper$()).toBe("OK");
        expect(form.ownIssues$()).toHaveLength(1);
        expect(updates.values).toEqual([undefined, "OK"]);
        updates.unsubscribe();
    });

    it("equals threw: Object.is and a console.error, in the set dedup and in isDirty$", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const def = g({
            fields: {
                a: f({
                    schema: z.string(),
                    defaultValue: "x",
                    equals: () => {
                        throw new Error("equals broke");
                    },
                }),
            },
        });
        const a = FormSignal.state(def).fields.a;
        a.set("x");
        expect(a.isModified$()).toBe(false);
        a.set("y");
        expect(a.isDirty$()).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        expect(String(consoleError.mock.calls[0][0])).toMatch(/equals of form field "a" threw/);
    });

    it("no reactively computed callback throws out of the graph of a subscribed form", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const boom = () => {
            throw new Error("boom");
        };
        const { schema } = schemaOf<string>(boom);
        const def = g({
            fields: { a: f({ schema, defaultValue: "", validate: boom }), b: text() },
            computed: { c: boom },
            disabled: { b: boom },
            validate: boom,
        });
        const form = FormSignal.state(def);
        const error = vi.fn();
        const subscription = form.state$.obs.subscribe({ error });
        form.fields.a.set("x");
        form.fields.b.set("y");
        form.markTouched();
        expect(error).not.toHaveBeenCalled();
        expect(form.state$().visibleErrorCount).toBe(5);
        subscription.unsubscribe();
    });
});

describe("configuration errors during a computation", () => {
    it("a rule that reads a verdict of its own subtree closes a cycle: FormConfigError", () => {
        const def = g({
            fields: { a: text() },
            validate: {
                viaVerdict: ({ fields, error }) => {
                    // Only a cast reaches a verdict: the context types exclude them.
                    if (!(fields.a as unknown as { isValid$: () => boolean }).isValid$()) error("Invalid");
                },
            },
        });
        const form = FormSignal.state(def);
        expect(() => form.issues$()).toThrow(FormConfigError);
        expect(() => form.issues$()).toThrow(/^validate\.viaVerdict: reads a signal that depends on its own result/);
    });

    it("a computed that reads a verdict through a closure: FormConfigError", () => {
        let isValid$: (() => boolean) | null = null;
        const def = g({ fields: { a: text() }, computed: { valid: () => isValid$!() } });
        const form = FormSignal.state(def);
        isValid$ = form.isValid$;
        expect(() => form.isValid$()).toThrow(FormConfigError);
        expect(() => form.computed.valid$()).toThrow("computed.valid");
    });

    it("a disabled predicate that reads the group's own value: FormConfigError", () => {
        let value$: (() => unknown) | null = null;
        const def = g({
            fields: { a: text(), b: text() },
            disabled: { b: () => Object.keys(value$!() as object).length > 5 },
        });
        const form = FormSignal.state(def);
        value$ = form.value$;
        expect(() => form.value$()).toThrow(FormConfigError);
        expect(() => form.value$()).toThrow("disabled.b");
    });

    it("the error stays the state of the computation until a dependency changes", () => {
        const def = g({
            fields: { a: text() },
            validate: ({ fields, error }) => {
                if (fields.a.value$() !== "loop") return;
                if (!(fields.a as unknown as { isValid$: () => boolean }).isValid$()) error("Invalid");
            },
        });
        const form = FormSignal.state(def);
        form.fields.a.set("loop");
        expect(() => form.isValid$()).toThrow(FormConfigError);
        expect(() => form.isValid$()).toThrow(FormConfigError);
        const error = vi.fn();
        form.isValid$.obs.subscribe({ error });
        expect(error).toHaveBeenCalledWith(expect.any(FormConfigError));
        form.fields.a.set("fine");
        expect(form.isValid$()).toBe(true);
    });
});
