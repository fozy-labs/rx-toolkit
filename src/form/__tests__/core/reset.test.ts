// Reset and initialization: the rows of the table, the bullets and the Field model (the List
// structure is in ../lists/structure.test.ts).
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";

import { addServerIssue, markSubmitted, record } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

function profile() {
    const def = g({
        fields: {
            name: text("default name"),
            email: f({ schema: z.string().min(3), defaultValue: "" }),
            address: g({
                fields: { city: text("default city"), zip: f({ schema: z.string().nullable(), defaultValue: "0" }) },
            }),
        },
        context: FormSignal.context<{ id: string }>(),
    });
    return FormSignal.state(def, {
        state: { name: "Ann", email: "ann@x", address: { city: "Oslo" } },
        context: { id: "1" },
    });
}

type Profile = ReturnType<typeof profile>;

/** Edits `name`, touches and submits everything and adds server issues. */
function dirty(form: Profile) {
    form.fields.name.set("Bob");
    form.markTouched();
    markSubmitted(form);
    addServerIssue(form, "Root");
    addServerIssue(form.fields.email, "Email");
}

const serverIssues = (form: Profile) => form.issues$().filter((issue) => issue.source.type === "server");

describe("reset and initialization", () => {
    it("reset(): values ← base; base and context unchanged; meta and server issues removed", () => {
        const form = profile();
        dirty(form);
        form.reset();
        expect(form.value$()).toEqual({ name: "Ann", email: "ann@x", address: { city: "Oslo", zip: "0" } });
        expect(form.context$()).toEqual({ id: "1" });
        expect(form.state$()).toMatchObject({ isTouched: false, isModified: false, isDirty: false });
        expect(serverIssues(form)).toEqual([]);
        // The base is unchanged: an edit to the old value is still dirty.
        form.fields.name.set("Ann");
        expect(form.isDirty$()).toBe(false);
    });

    it("initialize(): values and base ← defaultValue; context unchanged; meta and server issues removed", () => {
        const form = profile();
        dirty(form);
        form.initialize();
        expect(form.value$()).toEqual({ name: "default name", email: "", address: { city: "default city", zip: "0" } });
        expect(form.state$()).toMatchObject({ isTouched: false, isModified: false, isDirty: false });
        expect(form.context$()).toEqual({ id: "1" });
        expect(serverIssues(form)).toEqual([]);
        form.fields.email.set("x");
        form.fields.email.set("");
        expect(form.isDirty$()).toBe(false);
    });

    it("initialize({ state }): values and base ← state; meta and server issues removed", () => {
        const form = profile();
        dirty(form);
        form.initialize({ state: { name: "Cid", address: { zip: null } } });
        expect(form.value$()).toEqual({ name: "Cid", email: "ann@x", address: { city: "Oslo", zip: null } });
        expect(form.fields.name.state$()).toMatchObject({ isTouched: false, isModified: false, isDirty: false });
        expect(form.fields.address.fields.zip.state$()).toMatchObject({ isTouched: false });
        // `email` is outside `state`: untouched, with its meta and server issues.
        expect(form.fields.email.state$()).toMatchObject({ isTouched: true });
        expect(serverIssues(form).map((issue) => issue.message)).toEqual(["Email"]);
    });

    it("initialize({ state }, { keepDirtyValues }): drafts kept, base ← state, meta and server issues follow the value", () => {
        const form = profile();
        form.fields.name.set("Bob");
        form.fields.email.set("bo");
        form.fields.email.set("ann@x");
        form.markTouched();
        markSubmitted(form);
        addServerIssue(form.fields.name, "Name");
        addServerIssue(form.fields.address.fields.city, "City");
        form.initialize(
            { state: { name: "Ann 2", email: "new@x", address: { city: "Rome" } } },
            { keepDirtyValues: true },
        );

        // A dirty draft is kept, with its meta and server issues.
        expect(form.fields.name.state$()).toMatchObject({ value: "Bob", isDirty: true, isTouched: true });
        expect(form.fields.name.issues$().map((issue) => issue.message)).toEqual(["Name"]);
        // A draft equal to the old base is dropped: the value is replaced, meta and server issues go.
        expect(form.fields.email.state$()).toMatchObject({ value: "new@x", isModified: false, isTouched: false });
        // No draft: the value is replaced.
        expect(form.fields.address.fields.city.state$()).toMatchObject({ value: "Rome", isTouched: false });
        expect(form.fields.address.fields.city.issues$()).toEqual([]);
        // The base moved: the kept draft compares against the new one.
        form.fields.name.set("Ann 2");
        expect(form.fields.name.isDirty$()).toBe(false);
    });

    it("keepDirtyValues drops a draft that equals the new base, and with it isModified", () => {
        const form = profile();
        form.fields.name.set("Bob");
        form.fields.name.blur();
        form.initialize({ state: { name: "Bob" } }, { keepDirtyValues: true });
        expect(form.fields.name.state$()).toMatchObject({ value: "Bob", isModified: false, isTouched: false });
    });

    it("keepDirtyValues keeps the submitted flag with a kept draft", () => {
        const def = g({
            fields: { a: f({ schema: z.string().min(5), defaultValue: "", showErrors: "submitted" }), b: text() },
        });
        const form = FormSignal.state(def);
        form.fields.a.set("bad");
        markSubmitted(form);
        form.initialize({ state: { a: "", b: "x" } }, { keepDirtyValues: true });
        expect(form.fields.a.visibleErrors$()).toHaveLength(1);
        form.initialize({ state: { a: "" } });
        expect(form.fields.a.visibleErrors$()).toEqual([]);
    });

    it("initialize({ context }): values, meta and server issues unchanged; context ← context", () => {
        const form = profile();
        dirty(form);
        const before = form.issues$();
        form.initialize({ context: { id: "2" } });
        expect(form.context$()).toEqual({ id: "2" });
        expect(form.fields.name.value$()).toBe("Bob");
        expect(form.state$()).toMatchObject({ isTouched: true, isDirty: true });
        expect(form.issues$()).toBe(before);
    });

    it("state and context can be passed together", () => {
        const form = profile();
        form.initialize({ state: { name: "Dan" }, context: { id: "3" } });
        expect(form.context$()).toEqual({ id: "3" });
        expect(form.fields.name.value$()).toBe("Dan");
    });

    it("context is accepted only by the root", () => {
        const form = profile();
        form.fields.address.initialize({ state: { city: "Riga" }, context: { id: "9" } } as never);
        expect(form.context$()).toEqual({ id: "1" });
        expect(form.fields.address.fields.city.value$()).toBe("Riga");
    });

    it("initialize is public on groups only; reset and markTouched exist on every node", () => {
        const form = profile();
        expect(typeof form.initialize).toBe("function");
        expect(typeof form.fields.address.initialize).toBe("function");
        expect("initialize" in form.fields.name).toBe(false);
        expect(typeof form.fields.name.reset).toBe("function");
        expect(typeof form.fields.name.markTouched).toBe("function");
    });

    it("the whole initialize is one batch", () => {
        const form = profile();
        const snapshots = record(form.value$);
        form.initialize({ state: { name: "E", email: "e@x", address: { city: "F", zip: "1" } } });
        expect(snapshots.values).toHaveLength(2);
        snapshots.unsubscribe();
    });
});

describe("field model", () => {
    it("init: the starting state is the base, with no drafts", () => {
        const form = profile();
        expect(form.value$()).toEqual({ name: "Ann", email: "ann@x", address: { city: "Oslo", zip: "0" } });
        expect(form.state$()).toMatchObject({ isModified: false, isDirty: false });
    });

    it("the presence rule: a missing key or undefined is not provided; null is a value", () => {
        const def = g({
            fields: {
                missing: text("d1"),
                undef: text("d2"),
                nulled: f({ schema: z.string().nullable(), defaultValue: "d3" }),
            },
        });
        const form = FormSignal.state(def, { state: { undef: undefined, nulled: null } });
        expect(form.value$()).toEqual({ missing: "d1", undef: "d2", nulled: null });
        form.fields.undef.set("x");
        form.initialize({ state: { undef: undefined } });
        expect(form.fields.undef.value$()).toBe("x");
    });

    it("reinit: a field present in state gets the new base and loses its draft; fields outside state are not touched", () => {
        const form = profile();
        form.fields.name.set("Bob");
        form.fields.email.set("bob@x");
        form.fields.email.blur();
        form.initialize({ state: { name: "Cid" } });
        expect(form.fields.name.state$()).toMatchObject({ value: "Cid", isModified: false });
        expect(form.fields.email.state$()).toMatchObject({ value: "bob@x", isModified: true, isTouched: true });
    });

    it("isModified$ is the draft itself: reset drops it without a sticky flag", () => {
        const form = profile();
        form.fields.name.set("Bob");
        form.fields.name.set("Ann");
        expect(form.fields.name.isModified$()).toBe(true);
        form.fields.name.reset();
        expect(form.fields.name.isModified$()).toBe(false);
    });

    it("FormSignal.state without state starts from the defaults", () => {
        const form = FormSignal.state(g({ fields: { a: text("x") } }));
        expect(form.value$()).toEqual({ a: "x" });
    });
});
