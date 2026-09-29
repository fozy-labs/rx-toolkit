// The Group node table and the Stage 2 rows of the root table, one test per row.
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";

import { addServerIssue, markSubmitted } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });
const required = () => f({ schema: z.string().min(1), defaultValue: "" });

function registration() {
    const services = g({
        fields: { tariff: f({ schema: z.enum(["free", "pro"]), defaultValue: "free" }), extra: text() },
        validate: {
            freeTariff: ({ fields, error }) => {
                if (fields.tariff.value$() === "free" && fields.extra.value$()) {
                    error(fields.extra, "Not available on the free tariff");
                }
            },
        },
    });
    const def = g({
        name: "registration",
        fields: { name: text(), email: required(), services },
        computed: { placeholder: ({ fields }) => `${fields.name.value$()}@company.com` },
        validate: ({ fields, error }) => {
            if (!fields.name.value$() && !fields.email.value$()) error("Fill in the name or the email");
        },
    });
    return FormSignal.state(def);
}

describe("group node", () => {
    it("fields.<name> / fields.<name>$: the child node and the alias of its state$", () => {
        const form = registration();
        expect(form.fields.email.value$()).toBe("");
        expect(form.fields.email$).toBe(form.fields.email.state$);
        expect(form.fields.services$).toBe(form.fields.services.state$);
        expect(form.fields.services.fields.tariff$).toBe(form.fields.services.fields.tariff.state$);
    });

    it("state$: scalars only, no values", () => {
        const form = registration();
        expect(form.fields.services.state$()).toEqual({
            isValid: true,
            isPending: false,
            isTouched: false,
            isModified: false,
            isDirty: false,
            hasVisibleErrors: false,
            visibleErrorCount: 0,
            isDisabled: false,
        });
        form.fields.services.fields.extra.set("sms");
        form.fields.services.markTouched();
        expect(form.fields.services.state$()).toMatchObject({
            isValid: false,
            isTouched: true,
            isModified: true,
            isDirty: true,
            hasVisibleErrors: true,
            visibleErrorCount: 1,
        });
    });

    it("value$ / parsed$: composition of the children", () => {
        const form = registration();
        expect(form.value$()).toEqual({ name: "", email: "", services: { tariff: "free", extra: "" } });
        expect(form.parsed$()).toEqual({ isParsed: false, value: undefined });
        form.fields.email.set("a");
        expect(form.parsed$()).toEqual({
            isParsed: true,
            value: { name: "", email: "a", services: { tariff: "free", extra: "" } },
        });
    });

    it("value$ / parsed$: keys listed in disabled are absent while disabled", () => {
        const def = g({
            fields: { kind: text("person"), company: required() },
            disabled: { company: ({ fields }) => fields.kind.value$() !== "company" },
        });
        const form = FormSignal.state(def);
        expect(form.value$()).toEqual({ kind: "person" });
        expect(form.parsed$()).toEqual({ isParsed: true, value: { kind: "person" } });
        form.fields.kind.set("company");
        expect(form.value$()).toEqual({ kind: "company", company: "" });
        expect(form.parsed$().isParsed).toBe(false);
    });

    it("computed.<k>$: as declared", () => {
        const form = registration();
        expect(form.computed.placeholder$()).toBe("@company.com");
        form.fields.name.set("ann");
        expect(form.computed.placeholder$()).toBe("ann@company.com");
    });

    it("queries: empty without queries", () => {
        expect(registration().queries).toEqual({});
    });

    it("ownIssues$: group rules, callback issues and server issues without a path into a descendant", () => {
        const def = g({
            fields: { a: required() },
            computed: {
                broken: (): string => {
                    throw new Error("boom");
                },
            },
            validate: { own: ({ error }) => error("Own"), toChild: ({ fields, error }) => error(fields.a, "To a") },
        });
        const form = FormSignal.state(def);
        const server = addServerIssue(form, "Server");
        expect(form.ownIssues$().map((issue) => [issue.message, issue.source.type])).toEqual([
            ["Own", "rule"],
            ["boom", "callback"],
            ["Server", "server"],
        ]);
        expect(form.ownIssues$()[2]).toBe(server);
    });

    it("issues$ / errors$ / warnings$: own + all descendants", () => {
        const def = g({
            fields: { a: required(), inner: g({ fields: { b: required() }, validate: ({ warn }) => warn("Inner") }) },
            validate: ({ warn }) => warn("Root"),
        });
        const form = FormSignal.state(def);
        expect(form.issues$().map((issue) => issue.message)).toEqual([
            "Root",
            expect.stringMatching(/>=1/),
            "Inner",
            expect.stringMatching(/>=1/),
        ]);
        expect(form.errors$().map((issue) => issue.path)).toEqual([["a"], ["inner", "b"]]);
        expect(form.warnings$().map((issue) => issue.message)).toEqual(["Root", "Inner"]);
        expect(form.fields.inner.issues$().map((issue) => issue.message)).toEqual(["Inner", expect.any(String)]);
    });

    it("visibleErrors$ / visibleWarnings$: the children's visible ones plus own ones under the group's policy", () => {
        const def = g({
            fields: {
                touchedField: required(),
                alwaysField: f({ schema: z.string().min(1), defaultValue: "", showErrors: "always" }),
            },
            validate: ({ error, warn }) => {
                error("Root error");
                warn("Root warning");
            },
        });
        const form = FormSignal.state(def);
        // The root is untouched: only the child's own policy shows its error.
        expect(form.visibleErrors$().map((issue) => issue.path)).toEqual([["alwaysField"]]);
        expect(form.visibleWarnings$()).toEqual([]);
        form.fields.touchedField.blur();
        // A touched descendant makes the group touched: its own issues show up first.
        expect(form.visibleErrors$().map((issue) => issue.message)).toEqual([
            "Root error",
            expect.any(String),
            expect.any(String),
        ]);
        expect(form.visibleWarnings$().map((issue) => issue.message)).toEqual(["Root warning"]);
    });

    it("isValid$: all descendants and no own errors", () => {
        const def = g({
            fields: { a: required(), inner: g({ fields: { b: required() } }) },
            validate: ({ fields, error, warn }) => {
                warn("Only a warning");
                if (fields.a.value$() === "bad") error("Bad");
            },
        });
        const form = FormSignal.state(def);
        form.fields.a.set("ok");
        expect(form.isValid$()).toBe(false);
        form.fields.inner.fields.b.set("ok");
        expect(form.isValid$()).toBe(true);
        form.fields.a.set("bad");
        expect(form.isValid$()).toBe(false);
    });

    it("isPending$ / isTouched$ / isModified$ / isDirty$: any descendant or the group itself", () => {
        const form = registration();
        const services = form.fields.services;
        expect([form.isPending$(), form.isTouched$(), form.isModified$(), form.isDirty$()]).toEqual([
            false,
            false,
            false,
            false,
        ]);
        services.fields.extra.blur();
        expect([services.isTouched$(), form.isTouched$()]).toEqual([true, true]);
        services.fields.extra.set("sms");
        expect([services.isModified$(), services.isDirty$(), form.isDirty$()]).toEqual([true, true, true]);
        services.fields.extra.set("");
        expect([form.isModified$(), form.isDirty$()]).toEqual([true, false]);
    });

    it("isDisabled$: inherited downwards", () => {
        const def = g({
            fields: { on: text("yes"), inner: g({ fields: { deep: text() } }) },
            disabled: { inner: ({ fields }) => fields.on.value$() !== "yes" },
        });
        const form = FormSignal.state(def);
        form.fields.on.set("no");
        expect(form.isDisabled$()).toBe(false);
        expect(form.fields.inner.isDisabled$()).toBe(true);
        expect(form.fields.inner.fields.deep.isDisabled$()).toBe(true);
        expect(form.fields.inner.state$().isDisabled).toBe(true);
    });

    it("markTouched(touched = true): cascades", () => {
        const form = registration();
        form.markTouched();
        expect(form.fields.services.fields.tariff.isTouched$()).toBe(true);
        expect(form.isTouched$()).toBe(true);
        form.markTouched(false);
        expect(form.fields.services.fields.tariff.isTouched$()).toBe(false);
        expect(form.isTouched$()).toBe(false);
    });

    it("reset(): cascades, plus own issues and own meta", () => {
        const form = registration();
        form.fields.services.fields.extra.set("sms");
        form.markTouched();
        markSubmitted(form);
        addServerIssue(form, "Root server");
        addServerIssue(form.fields.email, "Email server");
        form.reset();
        expect(form.value$()).toEqual({ name: "", email: "", services: { tariff: "free", extra: "" } });
        expect(form.state$()).toMatchObject({ isTouched: false, isModified: false, hasVisibleErrors: false });
        expect(form.issues$().some((issue) => issue.source.type === "server")).toBe(false);
    });

    it("reset() of a nested group touches only its subtree", () => {
        const form = registration();
        form.fields.name.set("ann");
        form.fields.services.fields.extra.set("sms");
        form.fields.services.reset();
        expect(form.value$()).toMatchObject({ name: "ann", services: { extra: "" } });
    });

    it("initialize(data?, options?): nested groups reinitialize their subtree", () => {
        const form = registration();
        form.fields.name.set("ann");
        form.fields.services.initialize({ state: { tariff: "pro" } });
        expect(form.fields.services.fields.tariff.value$()).toBe("pro");
        expect(form.fields.services.isDirty$()).toBe(false);
        expect(form.fields.name.value$()).toBe("ann");
        form.fields.services.initialize();
        expect(form.fields.services.fields.tariff.value$()).toBe("free");
    });
});

describe("root node", () => {
    it("state$: the group snapshot and the idle submit state", () => {
        expect(registration().state$()).toEqual({
            isValid: false,
            isPending: false,
            isTouched: false,
            isModified: false,
            isDirty: false,
            hasVisibleErrors: false,
            visibleErrorCount: 0,
            isDisabled: false,
            status: "idle",
            isSubmitting: false,
            submitCount: 0,
            canSubmit: true,
        });
    });

    it("the root has no alias of its own state$ and no fields$", () => {
        const form = registration();
        expect("fields$" in form).toBe(false);
        expect(Object.keys(form.fields)).toEqual(["name", "name$", "email", "email$", "services", "services$"]);
    });

    it("context$: the instance context, read-only", () => {
        const def = g({ fields: { a: text() }, context: FormSignal.context<{ id: string }>() });
        const form = FormSignal.state(def, { context: { id: "1" } });
        expect(form.context$()).toEqual({ id: "1" });
        expect("set" in form.context$).toBe(false);
    });

    it("submit members before Stage 5: the idle state; submit() and entryKey are not implemented", () => {
        const form = registration();
        expect(form.submission$()).toBeNull();
        expect(form.isSubmitting$()).toBe(false);
        expect(form.status$()).toBe("idle");
        expect(form.submitAttempts$()).toBe(0);
        expect(form.submitCount$()).toBe(0);
        expect(form.canSubmit$()).toBe(true);
        expect(() => form.submit()).toThrow("not implemented");
        expect(() => form.entryKey).toThrow("not implemented");
    });

    it("clearIssues(): removes every server issue in the tree", () => {
        const form = registration();
        addServerIssue(form, "Root");
        addServerIssue(form.fields.services.fields.tariff, "Deep");
        form.clearIssues();
        expect(form.issues$().filter((issue) => issue.source.type === "server")).toEqual([]);
    });
});
