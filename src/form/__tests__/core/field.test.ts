// The Field node table of the design, one test per row, and the field options.
import { z } from "zod";

import { deepEqual } from "@/common/utils/deepEqual";

import { unstable_FormSignal as FormSignal } from "../../index";

import { addServerIssue, markSubmitted, record } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

function emailForm(options: { showErrors?: "touched" | "modified" | "submitted" | "always" } = {}) {
    const def = g({
        fields: {
            email: f({
                schema: z.email(),
                defaultValue: "",
                validate: ({ value$, warn }) => {
                    if (value$().endsWith("@corp.com")) warn("Corporate address");
                },
                ...options,
            }),
        },
    });
    const form = FormSignal.state(def);
    return { form, email: form.fields.email };
}

describe("field node", () => {
    it("state$: the snapshot of the field", () => {
        const { email } = emailForm();
        expect(email.state$()).toEqual({
            value: "",
            parsed: { isParsed: false, value: undefined },
            visibleErrors: [],
            visibleWarnings: [],
            isValid: false,
            isPending: false,
            isFocused: false,
            isTouched: false,
            isModified: false,
            isDirty: false,
            isRequired: false,
            isDisabled: false,
        });
    });

    it("every key of the snapshot is a member of the node", () => {
        const { email } = emailForm();
        for (const key of Object.keys(email.state$())) {
            expect(key === "isRequired" ? key in email : `${key}$` in email).toBe(true);
        }
    });

    it("value$: the draft, else the base", () => {
        const form = FormSignal.state(g({ fields: { name: f({ schema: z.string(), defaultValue: "a" }) } }), {
            state: { name: "base" },
        });
        const name = form.fields.name;
        expect(name.value$()).toBe("base");
        name.set("draft");
        expect(name.value$()).toBe("draft");
        name.reset();
        expect(name.value$()).toBe("base");
    });

    it("parsed$: the schema result, compared by isParsed and Object.is(value)", () => {
        const form = FormSignal.state(g({ fields: { tags: f({ schema: z.array(z.string()), defaultValue: [] }) } }));
        const tags = form.fields.tags;
        const first = tags.parsed$();
        expect(first).toEqual({ isParsed: true, value: [] });
        tags.set(["a"]);
        const second = tags.parsed$();
        expect(second).toEqual({ isParsed: true, value: ["a"] });
        expect(second).not.toBe(first);

        const trimmed = FormSignal.state(g({ fields: { s: f({ schema: z.string().trim(), defaultValue: " x" }) } }));
        const parsed = trimmed.fields.s.parsed$();
        trimmed.fields.s.set("x ");
        // Another input, the same output: the previous reference is kept.
        expect(trimmed.fields.s.parsed$()).toBe(parsed);
    });

    it("issues$: every source and both severities", () => {
        const { email } = emailForm();
        email.set("@corp.com");
        const server = addServerIssue(email, "Taken");
        expect(email.issues$()).toEqual([
            {
                path: ["email"],
                message: expect.any(String),
                severity: "error",
                source: { type: "schema" },
                code: "invalid_format",
            },
            {
                path: ["email"],
                message: "Corporate address",
                severity: "warning",
                source: { type: "rule", path: [], name: "email" },
            },
            server,
        ]);
    });

    it("errors$ / warnings$: issues$ sliced by severity", () => {
        const { email } = emailForm();
        email.set("a@corp.com");
        expect(email.errors$()).toEqual([]);
        expect(email.warnings$().map((issue) => issue.message)).toEqual(["Corporate address"]);
        email.set("corp.com");
        expect(email.errors$()).toHaveLength(1);
        expect(email.warnings$()).toEqual([]);
    });

    it("visibleErrors$ / visibleWarnings$: errors$ / warnings$ under the showErrors policy", () => {
        const { email } = emailForm();
        email.set("x@corp.com");
        email.set("x");
        expect(email.errors$()).toHaveLength(1);
        expect(email.visibleErrors$()).toEqual([]);
        email.set("x@corp.com");
        expect(email.visibleWarnings$()).toEqual([]);
        email.blur();
        expect(email.visibleWarnings$()).toEqual(email.warnings$());
        email.set("x");
        expect(email.visibleErrors$()).toEqual(email.errors$());
    });

    it("isValid$: parsed and no error", () => {
        const { email } = emailForm();
        expect(email.isValid$()).toBe(false);
        email.set("a@b.com");
        expect(email.isValid$()).toBe(true);
        email.set("a@corp.com");
        // A warning does not affect isValid$.
        expect(email.isValid$()).toBe(true);
        addServerIssue(email, "Taken");
        expect(email.isValid$()).toBe(false);
    });

    it("isPending$: false without queries", () => {
        const { email } = emailForm();
        expect(email.isPending$()).toBe(false);
    });

    it("queries: empty without queries", () => {
        const { email } = emailForm();
        expect(email.queries).toEqual({});
    });

    it("isFocused$: between focus() and blur()", () => {
        const { email } = emailForm();
        email.focus();
        expect(email.isFocused$()).toBe(true);
        expect(email.isTouched$()).toBe(false);
        email.blur();
        expect(email.isFocused$()).toBe(false);
    });

    it("isTouched$: after blur() or markTouched()", () => {
        const { email } = emailForm();
        email.blur();
        expect(email.isTouched$()).toBe(true);
        email.markTouched(false);
        expect(email.isTouched$()).toBe(false);
        email.markTouched();
        expect(email.isTouched$()).toBe(true);
    });

    it("isModified$: a draft exists, even equal to the base", () => {
        const { email } = emailForm();
        email.set("a");
        email.set("");
        expect(email.isModified$()).toBe(true);
        expect(email.isDirty$()).toBe(false);
    });

    it("isDirty$: a draft exists and is not equals to the base", () => {
        const { email } = emailForm();
        expect(email.isDirty$()).toBe(false);
        email.set("a");
        expect(email.isDirty$()).toBe(true);
    });

    it("isDisabled$: from the parent's disabled", () => {
        const def = g({
            fields: { a: f({ schema: z.string(), defaultValue: "" }), b: f({ schema: z.string(), defaultValue: "" }) },
            disabled: { b: ({ fields }) => fields.a.value$() === "off" },
        });
        const form = FormSignal.state(def);
        expect(form.fields.b.isDisabled$()).toBe(false);
        form.fields.a.set("off");
        expect(form.fields.b.isDisabled$()).toBe(true);
        expect(form.fields.b.state$().isDisabled).toBe(true);
    });

    it("isRequired: from the required option; no issue and no effect on isValid$", () => {
        const def = g({ fields: { a: f({ schema: z.string(), defaultValue: "", required: true }) } });
        const a = FormSignal.state(def).fields.a;
        expect(a.isRequired).toBe(true);
        expect(a.state$().isRequired).toBe(true);
        expect(a.issues$()).toEqual([]);
        expect(a.isValid$()).toBe(true);
    });

    it("set(): does nothing when equals the current value", () => {
        const { email } = emailForm();
        addServerIssue(email, "Taken");
        email.set("");
        expect(email.isModified$()).toBe(false);
        expect(email.issues$().some((issue) => issue.source.type === "server")).toBe(true);
    });

    it("set(): writes the draft and removes the field's server issues", () => {
        const { email } = emailForm();
        addServerIssue(email, "Taken");
        email.set("a@b.com");
        expect(email.value$()).toBe("a@b.com");
        expect(email.issues$()).toEqual([]);
    });

    it("focus() / blur(): input events; blur() sets touched", () => {
        const { email } = emailForm();
        email.focus();
        expect(email.state$()).toMatchObject({ isFocused: true, isTouched: false });
        email.blur();
        expect(email.state$()).toMatchObject({ isFocused: false, isTouched: true });
    });

    it("markTouched(touched = true)", () => {
        const { email } = emailForm();
        email.markTouched();
        expect(email.isTouched$()).toBe(true);
        email.markTouched(false);
        expect(email.isTouched$()).toBe(false);
    });

    it("reset(): back to the base, removes touched / modified / submitted / server issues", () => {
        const { email } = emailForm({ showErrors: "submitted" });
        email.set("x");
        email.blur();
        markSubmitted(email);
        addServerIssue(email, "Taken");
        expect(email.visibleErrors$()).toHaveLength(2);
        email.reset();
        expect(email.state$()).toMatchObject({ value: "", isTouched: false, isModified: false, isDirty: false });
        expect(email.visibleErrors$()).toEqual([]);
        expect(email.issues$().some((issue) => issue.source.type === "server")).toBe(false);
    });
});

describe("field options", () => {
    it("equals: used in the set dedup and in isDirty$", () => {
        const def = g({ fields: { tags: f({ schema: z.array(z.string()), defaultValue: ["a"], equals: deepEqual }) } });
        const tags = FormSignal.state(def).fields.tags;
        const updates = record(tags.value$);
        tags.set(["a"]);
        expect(tags.isModified$()).toBe(false);
        tags.set(["b"]);
        tags.set(["a"]);
        expect(tags.isModified$()).toBe(true);
        expect(tags.isDirty$()).toBe(false);
        expect(updates.values).toEqual([["a"], ["b"], ["a"]]);
        updates.unsubscribe();
    });

    it("the default equals is Object.is", () => {
        const def = g({ fields: { tags: f({ schema: z.array(z.string()), defaultValue: ["a"] }) } });
        const tags = FormSignal.state(def).fields.tags;
        tags.set(["a"]);
        expect(tags.isDirty$()).toBe(true);
    });

    it("showErrors: inherited from the group, the root has touched", () => {
        const def = g({
            fields: {
                inherited: f({ schema: z.string().min(1), defaultValue: "" }),
                own: f({ schema: z.string().min(1), defaultValue: "", showErrors: "always" }),
                group: g({
                    showErrors: "modified",
                    fields: { deep: f({ schema: z.string().min(1), defaultValue: "" }) },
                }),
            },
        });
        const form = FormSignal.state(def);
        expect(form.fields.inherited.visibleErrors$()).toEqual([]);
        expect(form.fields.own.visibleErrors$()).toHaveLength(1);
        const deep = form.fields.group.fields.deep;
        deep.markTouched();
        expect(deep.visibleErrors$()).toEqual([]);
        deep.set("a");
        deep.set("");
        expect(deep.visibleErrors$()).toHaveLength(1);
    });
});
