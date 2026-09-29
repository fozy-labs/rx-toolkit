// The Disabled bullets of the design, one test per bullet.
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";

import { addServerIssue } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });
const required = () => f({ schema: z.string().min(1), defaultValue: "" });

/** A form whose `company` subtree is disabled while `kind` is not "company". */
function conditional() {
    const def = g({
        fields: {
            kind: text("person"),
            company: g({ fields: { title: required(), vat: required() } }),
        },
        disabled: { company: ({ fields }) => fields.kind.value$() !== "company" },
    });
    return FormSignal.state(def);
}

describe("disabled", () => {
    it("every node has isDisabled$ and isDisabled in its snapshot; it is inherited downwards", () => {
        const form = conditional();
        const { company } = form.fields;
        expect([form.isDisabled$(), company.isDisabled$(), company.fields.vat.isDisabled$()]).toEqual([
            false,
            true,
            true,
        ]);
        expect(company.state$().isDisabled).toBe(true);
        expect(company.fields.vat.state$().isDisabled).toBe(true);
        form.fields.kind.set("company");
        expect([company.isDisabled$(), company.fields.vat.isDisabled$()]).toEqual([false, false]);
    });

    it("a disabled node is left out of the parent's value$ / parsed$, its issues are not aggregated", () => {
        const form = conditional();
        addServerIssue(form.fields.company.fields.title, "Server");
        expect(form.value$()).toEqual({ kind: "person" });
        expect(form.parsed$()).toEqual({ isParsed: true, value: { kind: "person" } });
        expect(form.issues$()).toEqual([]);
        form.markTouched();
        expect(form.visibleErrors$()).toEqual([]);
        form.fields.kind.set("company");
        expect(form.issues$().map((issue) => issue.path)).toEqual([
            ["company", "title"],
            ["server-path"],
            ["company", "vat"],
        ]);
    });

    it("the parent's isValid$ / isDirty$ / isModified$ / isTouched$ / isPending$ ignore it", () => {
        const form = conditional();
        const title = form.fields.company.fields.title;
        title.set("x");
        title.blur();
        expect(form.fields.company.state$()).toMatchObject({ isDirty: true, isModified: true, isTouched: true });
        expect(form.state$()).toMatchObject({
            isValid: true,
            isDirty: false,
            isModified: false,
            isTouched: false,
            isPending: false,
        });
    });

    it("the exclusion takes into account only the predicates of that level", () => {
        const form = conditional();
        const { company } = form.fields;
        // `company` is disabled by the root; its own composite still holds its children.
        expect(company.value$()).toEqual({ title: "", vat: "" });
        expect(company.issues$()).toHaveLength(2);
        expect(company.isValid$()).toBe(false);
    });

    it("reset, initialize and markTouched reach disabled nodes too", () => {
        const form = conditional();
        const title = form.fields.company.fields.title;
        form.markTouched();
        expect(title.isTouched$()).toBe(true);
        title.set("draft");
        form.reset();
        expect(title.value$()).toBe("");
        expect(title.isTouched$()).toBe(false);
        form.initialize({ state: { company: { title: "base" } } });
        expect(title.value$()).toBe("base");
    });

    it("the draft is kept while disabled and visible again when enabled", () => {
        const form = conditional();
        form.fields.kind.set("company");
        form.fields.company.fields.title.set("Acme");
        form.fields.kind.set("person");
        expect(form.value$()).toEqual({ kind: "person" });
        form.fields.kind.set("company");
        expect(form.value$()).toEqual({ kind: "company", company: { title: "Acme", vat: "" } });
    });

    it("a field node's own value$ stays in place while disabled", () => {
        const form = conditional();
        expect(form.fields.company.fields.title.value$()).toBe("");
    });
});
