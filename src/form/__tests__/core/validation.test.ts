// The Validation bullets and the Contexts table of the design (the rows of Stage 2).
import { z } from "zod";

import type { StandardSchemaV1 } from "@/common/standard-schema";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";

import { addServerIssue, markSubmitted, schemaOf } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });
const required = (showErrors?: "touched" | "modified" | "submitted" | "always") =>
    f({ schema: z.string().min(1, "Required"), defaultValue: "", showErrors });

describe("validation", () => {
    describe("sources", () => {
        it("a schema issue has the schema source", () => {
            const form = FormSignal.state(g({ fields: { a: required() } }));
            expect(form.fields.a.issues$()[0].source).toEqual({ type: "schema" });
        });

        it("the short form: the parent path and the own key, the root name at the root", () => {
            const def = g({
                name: "signup",
                fields: {
                    services: g({
                        fields: {
                            tariff: f({ schema: z.string(), defaultValue: "", validate: ({ warn }) => warn("F") }),
                        },
                        validate: ({ warn }) => warn("G"),
                    }),
                },
                validate: ({ warn }) => warn("R"),
            });
            const form = FormSignal.state(def);
            expect(form.issues$().map((issue) => [issue.message, issue.source])).toEqual([
                ["R", { type: "rule", path: [], name: "signup" }],
                ["G", { type: "rule", path: [], name: "services" }],
                ["F", { type: "rule", path: ["services"], name: "tariff" }],
            ]);
        });

        it("the short form at a root without a name is named root", () => {
            const form = FormSignal.state(g({ fields: { a: text() }, validate: ({ warn }) => warn("R") }));
            expect(form.issues$()[0].source).toEqual({ type: "rule", path: [], name: "root" });
        });

        it("the map form: the node path and the rule key", () => {
            const def = g({
                fields: { services: g({ fields: { a: text() }, validate: { freeTariff: ({ warn }) => warn("G") } }) },
                validate: { rootRule: ({ warn }) => warn("R") },
            });
            const form = FormSignal.state(def);
            expect(form.issues$().map((issue) => issue.source)).toEqual([
                { type: "rule", path: [], name: "rootRule" },
                { type: "rule", path: ["services"], name: "freeTariff" },
            ]);
        });

        it("a failed callback has the callback source of its declaring node", () => {
            const def = g({
                fields: {
                    inner: g({
                        fields: { a: text() },
                        computed: {
                            broken: (): number => {
                                throw new Error("boom");
                            },
                        },
                    }),
                },
            });
            const form = FormSignal.state(def);
            expect(form.issues$()).toEqual([
                {
                    path: ["inner"],
                    message: "boom",
                    severity: "error",
                    source: { type: "callback", path: ["inner"], name: "computed.broken" },
                },
            ]);
        });
    });

    it("every rule is its own computation and recomputes only from what it read", () => {
        const readsA = vi.fn();
        const readsB = vi.fn();
        const def = g({
            fields: { a: text(), b: text() },
            validate: {
                first: ({ fields }) => {
                    readsA();
                    fields.a.value$();
                },
                second: ({ fields }) => {
                    readsB();
                    fields.b.value$();
                },
            },
        });
        const form = FormSignal.state(def);
        const subscription = form.issues$.obs.subscribe();
        expect([readsA.mock.calls.length, readsB.mock.calls.length]).toEqual([1, 1]);
        form.fields.a.set("x");
        expect([readsA.mock.calls.length, readsB.mock.calls.length]).toEqual([2, 1]);
        subscription.unsubscribe();
    });

    it("collectors: error() and warn(); a warning does not affect isValid$", () => {
        const def = g({
            fields: { a: text() },
            validate: ({ fields, error, warn }) => {
                if (fields.a.value$() === "e") error("An error");
                if (fields.a.value$() === "w") warn("A warning");
            },
        });
        const form = FormSignal.state(def);
        form.fields.a.set("w");
        expect(form.issues$()).toEqual([expect.objectContaining({ message: "A warning", severity: "warning" })]);
        expect(form.isValid$()).toBe(true);
        form.fields.a.set("e");
        expect(form.issues$()).toEqual([expect.objectContaining({ message: "An error", severity: "error" })]);
        expect(form.isValid$()).toBe(false);
    });

    it("code: the last argument of error() / warn(); from Standard Schema as is", () => {
        const def = g({
            fields: { a: f({ schema: z.string().min(1), defaultValue: "" }) },
            validate: ({ fields, error, warn }) => {
                error(fields.a, "Addressed", { code: "addressed" });
                warn("Own", { code: "own" });
            },
        });
        const form = FormSignal.state(def);
        expect(form.issues$().map((issue) => [issue.message, issue.code])).toEqual([
            ["Own", "own"],
            [expect.any(String), "too_small"],
            ["Addressed", "addressed"],
        ]);
    });

    it("an issue without a code has no code key", () => {
        const form = FormSignal.state(g({ fields: { a: text() }, validate: ({ warn }) => warn("W") }));
        expect("code" in form.issues$()[0]).toBe(false);
    });

    describe("visibility", () => {
        it("touched: after blur", () => {
            const form = FormSignal.state(g({ fields: { a: required("touched") } }));
            form.fields.a.set("x");
            form.fields.a.set("");
            expect(form.fields.a.visibleErrors$()).toEqual([]);
            form.fields.a.blur();
            expect(form.fields.a.visibleErrors$()).toHaveLength(1);
        });

        it("modified: after the first edit", () => {
            const form = FormSignal.state(g({ fields: { a: required("modified") } }));
            form.fields.a.blur();
            expect(form.fields.a.visibleErrors$()).toEqual([]);
            form.fields.a.set("x");
            form.fields.a.set("");
            expect(form.fields.a.visibleErrors$()).toHaveLength(1);
        });

        it("submitted: only after a submit", () => {
            const form = FormSignal.state(g({ fields: { a: required("submitted") } }));
            form.fields.a.set("x");
            form.fields.a.set("");
            form.fields.a.blur();
            expect(form.fields.a.visibleErrors$()).toEqual([]);
            markSubmitted(form);
            expect(form.fields.a.visibleErrors$()).toHaveLength(1);
        });

        it("always", () => {
            const form = FormSignal.state(g({ fields: { a: required("always") } }));
            expect(form.fields.a.visibleErrors$()).toHaveLength(1);
        });

        it("after a submit errors are visible under any policy", () => {
            const def = g({ fields: { t: required("touched"), m: required("modified"), s: required("submitted") } });
            const form = FormSignal.state(def);
            markSubmitted(form);
            expect(form.visibleErrors$().map((issue) => issue.path)).toEqual([["t"], ["m"], ["s"]]);
        });

        it("filtering follows the policy of the node that owns the issue", () => {
            const def = g({
                showErrors: "always",
                fields: { a: required("submitted") },
                validate: ({ fields, error }) => {
                    if (!fields.a.value$()) error(fields.a, "From the root");
                },
            });
            const form = FormSignal.state(def);
            // The root rule addresses `a`: the issue is a's, so a's policy applies.
            expect(form.fields.a.errors$()).toHaveLength(2);
            expect(form.visibleErrors$()).toEqual([]);
        });

        it("the submitted flag is cleared by reset() and initialize() like touched", () => {
            const form = FormSignal.state(g({ fields: { a: required("submitted") } }));
            markSubmitted(form);
            form.reset();
            expect(form.fields.a.visibleErrors$()).toEqual([]);
            markSubmitted(form);
            form.initialize();
            expect(form.fields.a.visibleErrors$()).toEqual([]);
        });

        it("warnings follow the same policy", () => {
            const def = g({
                fields: { a: f({ schema: z.string(), defaultValue: "", validate: ({ warn }) => warn("W") }) },
            });
            const form = FormSignal.state(def);
            expect(form.fields.a.visibleWarnings$()).toEqual([]);
            form.fields.a.blur();
            expect(form.fields.a.visibleWarnings$()).toHaveLength(1);
        });

        it("a group issue without a node: touched ⇔ the owner's isTouched$", () => {
            const def = g({ fields: { a: text(), b: text() }, validate: ({ error }) => error("Root") });
            const form = FormSignal.state(def);
            expect(form.visibleErrors$()).toEqual([]);
            form.fields.b.blur();
            expect(form.visibleErrors$().map((issue) => issue.message)).toEqual(["Root"]);
        });

        it("a group issue without a node: modified ⇔ the owner's isModified$", () => {
            const def = g({ showErrors: "modified", fields: { a: text() }, validate: ({ error }) => error("Root") });
            const form = FormSignal.state(def);
            form.markTouched();
            expect(form.visibleErrors$()).toEqual([]);
            form.fields.a.set("x");
            expect(form.visibleErrors$()).toHaveLength(1);
        });

        it("a group issue without a node: any policy plus the submitted flag", () => {
            const def = g({ showErrors: "submitted", fields: { a: text() }, validate: ({ error }) => error("Root") });
            const form = FormSignal.state(def);
            form.markTouched();
            form.fields.a.set("x");
            expect(form.visibleErrors$()).toEqual([]);
            markSubmitted(form);
            expect(form.visibleErrors$()).toHaveLength(1);
        });
    });

    it("server issues are removed from a field on its set", () => {
        const form = FormSignal.state(g({ fields: { a: text(), b: text() } }));
        addServerIssue(form.fields.a, "A");
        addServerIssue(form.fields.b, "B");
        form.fields.a.set("x");
        expect(form.issues$().map((issue) => issue.message)).toEqual(["B"]);
    });

    it("order: own issues (schema → rules in declaration order → server), then children in definition order", () => {
        const def = g({
            fields: {
                a: f({
                    schema: z.string().min(1, "a schema"),
                    defaultValue: "",
                    validate: { one: ({ warn }) => warn("a rule 1"), two: ({ warn }) => warn("a rule 2") },
                }),
                b: required(),
            },
            validate: {
                first: ({ fields, warn }) => {
                    warn("root rule 1");
                    warn(fields.a, "root rule to a");
                },
                second: ({ warn }) => warn("root rule 2"),
            },
        });
        const form = FormSignal.state(def);
        addServerIssue(form, "root server");
        addServerIssue(form.fields.a, "a server");
        expect(form.issues$().map((issue) => issue.message)).toEqual([
            "root rule 1",
            "root rule 2",
            "root server",
            "a schema",
            "a rule 1",
            "a rule 2",
            "root rule to a",
            "a server",
            "Required",
        ]);
    });

    it("rule paths come from the node's position; Standard Schema paths are appended with { key } normalized", () => {
        const { schema } = schemaOf<{ x: string }>(() => ({
            issues: [{ message: "Nested", path: [{ key: "x" }, 0, "y"] }, { message: "Plain" }],
        }));
        const def = g({ fields: { inner: g({ fields: { obj: f({ schema, defaultValue: { x: "" } }) } }) } });
        const form = FormSignal.state(def);
        expect(form.issues$().map((issue) => issue.path)).toEqual([
            ["inner", "obj", "x", 0, "y"],
            ["inner", "obj"],
        ]);
    });

    it("checking a wizard step: markTouched() on the step, then isValid$", () => {
        const def = g({
            fields: { step1: g({ fields: { a: required() } }), step2: g({ fields: { b: required() } }) },
        });
        const form = FormSignal.state(def);
        form.fields.step1.markTouched();
        expect(form.fields.step1.isPending$()).toBe(false);
        expect(form.fields.step1.isValid$()).toBe(false);
        expect(form.fields.step1.visibleErrors$()).toHaveLength(1);
        expect(form.fields.step2.visibleErrors$()).toEqual([]);
    });
});

describe("contexts", () => {
    const ctxKeys = (ctx: object) => Object.keys(ctx).sort();

    it("field validate: own value$ / parsed$, own queries, context$ and the collectors", () => {
        let seen: object = {};
        const def = g({
            fields: { a: f({ schema: z.string(), defaultValue: "", validate: (ctx) => void (seen = ctx) }) },
        });
        FormSignal.state(def).issues$();
        expect(ctxKeys(seen)).toEqual(["context$", "error", "parsed$", "queries", "value$", "warn"]);
    });

    it("group computed: fields, own value$ / parsed$ and context$", () => {
        let seen: object = {};
        const def = g({ fields: { a: text() }, computed: { c: (ctx) => void (seen = ctx) } });
        FormSignal.state(def).computed.c$();
        expect(ctxKeys(seen)).toEqual(["context$", "fields", "parsed$", "value$"]);
    });

    it("group disabled: fields and context$", () => {
        let seen: object = {};
        const def = g({ fields: { a: text() }, disabled: { a: (ctx) => ((seen = ctx), false) } });
        FormSignal.state(def).value$();
        expect(ctxKeys(seen)).toEqual(["context$", "fields"]);
    });

    it("group validate: fields, own value$ / parsed$, computed, queries, context$ and the collectors", () => {
        let seen: object = {};
        const def = g({ fields: { a: text() }, computed: { c: () => 1 }, validate: (ctx) => void (seen = ctx) });
        const form = FormSignal.state(def);
        form.issues$();
        expect(ctxKeys(seen)).toEqual([
            "computed",
            "context$",
            "error",
            "fields",
            "parsed$",
            "queries",
            "value$",
            "warn",
        ]);
        expect((seen as { computed: object }).computed).toBe(form.computed);
    });

    it("fields holds the child nodes; context$ is the instance context", () => {
        let seen: { fields?: object; context$?: () => unknown } = {};
        const def = g({
            fields: { a: text() },
            context: FormSignal.context<{ id: string }>(),
            validate: (ctx) => void (seen = ctx),
        });
        const form = FormSignal.state(def, { context: { id: "7" } });
        form.issues$();
        expect(seen.fields).toBe(form.fields);
        expect(seen.context$?.()).toEqual({ id: "7" });
    });

    it("error / warn without a node address the declaring node; at the root it is a form error", () => {
        const def = g({
            fields: { inner: g({ fields: { a: text() }, validate: ({ error }) => error("Inner") }) },
            validate: ({ error }) => error("Form"),
        });
        const form = FormSignal.state(def);
        expect(form.ownIssues$().map((issue) => [issue.message, issue.path])).toEqual([["Form", []]]);
        expect(form.fields.inner.ownIssues$().map((issue) => [issue.message, issue.path])).toEqual([
            ["Inner", ["inner"]],
        ]);
    });

    it("error(node) addresses a node of the rule's subtree", () => {
        const def = g({
            fields: { inner: g({ fields: { deep: g({ fields: { a: text() } }) } }) },
            validate: ({ fields, error }) => error(fields.inner.fields.deep.fields.a, "Deep"),
        });
        const form = FormSignal.state(def);
        expect(form.fields.inner.fields.deep.fields.a.issues$()).toEqual([
            {
                path: ["inner", "deep", "a"],
                message: "Deep",
                severity: "error",
                source: { type: "rule", path: [], name: "root" },
            },
        ]);
    });

    it("error(node) outside the subtree throws FormConfigError", () => {
        let outside: object | null = null;
        const def = g({
            fields: {
                a: text(),
                inner: g({
                    fields: { b: text() },
                    validate: { reach: ({ error }) => error(outside as never, "Outside") },
                }),
            },
        });
        const form = FormSignal.state(def);
        outside = form.fields.a;
        expect(() => form.issues$()).toThrow(FormConfigError);
        expect(() => form.issues$()).toThrow("inner.validate.reach: error() / warn() can address only");
        outside = { value$: () => "" };
        expect(() => form.fields.inner.issues$()).toThrow(FormConfigError);
    });

    it("error(node) with a node of another instance throws FormConfigError", () => {
        const def = g({ fields: { a: text() } });
        const other = FormSignal.state(def);
        const form = FormSignal.state(
            g({ fields: { a: text() }, validate: ({ error }) => error(other.fields.a, "X") }),
        );
        expect(() => form.issues$()).toThrow(FormConfigError);
    });

    it("a collector called after its run ended is ignored", () => {
        let late: ((message: string) => void) | null = null;
        const def = g({ fields: { a: text() }, validate: ({ error }) => void (late = error) });
        const form = FormSignal.state(def);
        expect(form.issues$()).toEqual([]);
        late!("Late");
        expect(form.issues$()).toEqual([]);
    });

    it("a schema from any Standard Schema vendor", () => {
        const schema: StandardSchemaV1<string, number> = {
            "~standard": {
                version: 1,
                vendor: "custom",
                validate: (value) =>
                    typeof value === "string" && value !== ""
                        ? { value: value.length }
                        : { issues: [{ message: "Empty" }] },
            },
        };
        const form = FormSignal.state(g({ fields: { a: f({ schema, defaultValue: "" }) } }));
        expect(form.fields.a.issues$()).toEqual([
            { path: ["a"], message: "Empty", severity: "error", source: { type: "schema" } },
        ]);
        form.fields.a.set("abc");
        expect(form.fields.a.parsed$()).toEqual({ isParsed: true, value: 3 });
    });
});
