// "React": Definition.useForm — one instance per component, the init sync by its rules
// (context at once, state only at idle and unless back to the submit-start snapshot), the
// definition and key read once, and the Lifetime contract tests that involve React.
import { act, render } from "@testing-library/react";
import React from "react";
import { z } from "zod";

import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { createApi, reactHooksPlugin, SKIP } from "@/query";
import { useSignal } from "@/signals";

import { GroupCore } from "../../core/nodes/GroupCore";
import { unstable_FormSignal as FormSignal, unstable_formsReactPlugin, type FormInstance } from "../../index";

import { isMelting, manualRuns, settle } from "./helpers";

const h = React.createElement;
const f = FormSignal.field;

afterEach(() => {
    vi.restoreAllMocks();
});

// ==================== Fixtures ====================

/** A form whose `email` field checks the address with a query, and a plain `note` field. */
function emailSetup() {
    const api = createApi({ plugins: [unstable_formsReactPlugin()] });
    const check = manualRuns<string, { taken: boolean }>();
    const info = api.createResource<string, { taken: boolean }>({ queryFn: check.queryFn, retentionTime: 60_000 });
    const EmailForm = api.defineForm({
        name: "signup",
        fields: {
            email: f({
                schema: z.string(),
                defaultValue: "",
                queries: { info: ({ value$ }) => (value$() ? info.bind(value$()) : SKIP) },
            }),
            note: f({ schema: z.string(), defaultValue: "" }),
        },
    });
    return { api, info, check, EmailForm };
}

/** A form with a context and a `name` field whose submit runs a command the test settles. */
function profileSetup() {
    const api = createApi({
        plugins: [unstable_formsReactPlugin({ mapSubmitError: () => [{ path: ["name"], message: "Taken" }] })],
    });
    const save = manualRuns<{ name: string }, { id: string }>();
    const saveCommand = api.createCommand<{ name: string }, { id: string }>({ queryFn: save.queryFn });
    const Profile = api.defineForm({
        name: "profile",
        fields: { name: f({ schema: z.string(), defaultValue: "" }) },
        context: FormSignal.context<{ id: string }>(),
        submit: ({ parsed$ }) => saveCommand.bind(parsed$().value),
    });
    return { api, save, Profile };
}

type ProfileInit = { state?: { name?: string }; context: { id: string } };

/** Renders `Profile.useForm(init)` and lets the test re-render it with another `init`. */
function renderProfile(Profile: ReturnType<typeof profileSetup>["Profile"], init: ProfileInit) {
    const captured = { form: null as unknown as FormInstance<typeof Profile>, renders: 0 };
    function Editor({ init }: { init: ProfileInit }) {
        captured.form = Profile.useForm(init);
        captured.renders++;
        return null;
    }
    const view = render(h(Editor, { init }));
    return {
        captured,
        view,
        rerender: (next: ProfileInit) => view.rerender(h(Editor, { init: next })),
    };
}

/** Spies on `initialize()` of every group: the sync must not call it when nothing changed. */
function spyInitialize() {
    return vi.spyOn(GroupCore.prototype as unknown as { _initialize: () => void }, "_initialize");
}

// ==================== Instance ====================

describe("useForm: the instance", () => {
    it("creates one instance per component and keeps it across renders", () => {
        const { EmailForm } = emailSetup();
        const forms: object[] = [];
        function Editor({ n }: { n: number }) {
            forms.push(EmailForm.useForm({ state: { note: String(n) } }));
            return null;
        }
        const view = render(h(Editor, { n: 1 }));
        view.rerender(h(Editor, { n: 2 }));
        expect(new Set(forms).size).toBe(1);
        expect((forms[0] as FormInstance<typeof EmailForm>).fields.note.value$.peek()).toBe("2");
    });

    it("StrictMode: one request for two instances, and the init sync does not reinitialize", async () => {
        const { check, EmailForm } = emailSetup();
        const initialize = spyInitialize();
        const forms = new Set<object>();
        function Editor() {
            // A new but deepEqual `init` on every render.
            const form = EmailForm.useForm({ state: { email: "a@x.com" } }, { initializeOptions: {} });
            forms.add(form);
            useSignal(form.state$);
            return null;
        }
        const view = render(h(React.StrictMode, null, h(Editor)));
        await settle();

        // React keeps one of the two instances of the double initializer call; the other one is
        // never read, and the double effect run re-subscribes to the same cache entry.
        expect(forms.size).toBe(1);
        expect(check.queryFn).toHaveBeenCalledTimes(1);
        expect(check.queryFn).toHaveBeenCalledWith("a@x.com", expect.anything());

        view.rerender(h(React.StrictMode, null, h(Editor)));
        await settle();
        expect(initialize).not.toHaveBeenCalled();
        expect(check.queryFn).toHaveBeenCalledTimes(1);
    });
});

// ==================== Init sync ====================

describe("useForm: the init sync", () => {
    it("applies a changed state with keepDirtyValues by default, and ignores state: undefined", () => {
        const { Profile } = profileSetup();
        const { captured, rerender } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
        const { name } = captured.form.fields;
        expect(name.value$.peek()).toBe("Ann");

        rerender({ state: { name: "Bob" }, context: { id: "1" } });
        expect(name.value$.peek()).toBe("Bob");
        expect(name.isDirty$.peek()).toBe(false);

        // A draft survives a new base: keepDirtyValues.
        act(() => name.set("Draft"));
        rerender({ state: { name: "Cid" }, context: { id: "1" } });
        expect(name.value$.peek()).toBe("Draft");

        const initialize = spyInitialize();
        rerender({ state: undefined, context: { id: "1" } });
        rerender({ context: { id: "1" } });
        expect(initialize).not.toHaveBeenCalled();
        expect(name.value$.peek()).toBe("Draft");
    });

    it("passes initializeOptions to initialize()", () => {
        const { EmailForm } = emailSetup();
        let form = null as unknown as FormInstance<typeof EmailForm>;
        function Editor({ note }: { note: string }) {
            form = EmailForm.useForm({ state: { note } }, { initializeOptions: { keepDirtyValues: false } });
            return null;
        }
        const view = render(h(Editor, { note: "a" }));
        act(() => form.fields.note.set("draft"));
        view.rerender(h(Editor, { note: "b" }));
        expect(form.fields.note.value$.peek()).toBe("b");
        expect(form.fields.note.isModified$.peek()).toBe(false);
    });

    it("applies a changed context at once, also during a submit", async () => {
        const { Profile, save } = profileSetup();
        const { captured, rerender } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
        const form = captured.form;

        rerender({ state: { name: "Ann" }, context: { id: "2" } });
        expect(form.context$.peek()).toEqual({ id: "2" });

        let submitted!: Promise<boolean>;
        act(() => {
            submitted = form.submit();
        });
        await settle();
        expect(save.runs).toHaveLength(1);
        expect(form.isSubmitting$.peek()).toBe(true);

        rerender({ state: { name: "Ann" }, context: { id: "3" } });
        expect(form.context$.peek()).toEqual({ id: "3" });
        expect(form.isSubmitting$.peek()).toBe(true);

        save.last().resolve({ id: "1" });
        await settle();
        expect(await submitted).toBe(true);
        expect(form.context$.peek()).toEqual({ id: "3" });
    });

    it("defers a state change during a submit and applies it at idle", async () => {
        const { Profile, save } = profileSetup();
        const { captured, rerender } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
        const form = captured.form;

        let submitted!: Promise<boolean>;
        act(() => {
            submitted = form.submit();
        });
        await settle();
        rerender({ state: { name: "Bob" }, context: { id: "1" } });
        expect(form.fields.name.value$.peek()).toBe("Ann");

        save.last().resolve({ id: "1" });
        await settle();
        expect(await submitted).toBe(true);
        expect(form.isSubmitting$.peek()).toBe(false);
        // No new render from the parent: the hook re-rendered on the phase.
        expect(form.fields.name.value$.peek()).toBe("Bob");
    });

    it("skips a state that is back to the submit-start snapshot at idle, keeping the server issues", async () => {
        const { Profile, save } = profileSetup();
        const { captured, rerender } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
        const form = captured.form;
        act(() => form.fields.name.set("Bob"));

        let submitted!: Promise<boolean>;
        act(() => {
            submitted = form.submit();
        });
        await settle();
        rerender({ state: { name: "Bob" }, context: { id: "1" } });
        rerender({ state: { name: "Ann" }, context: { id: "1" } });

        const initialize = spyInitialize();
        save.last().reject(new Error("422"));
        await settle();
        expect(await submitted).toBe(false);
        expect(initialize).not.toHaveBeenCalled();
        expect(form.fields.name.value$.peek()).toBe("Bob");
        expect(form.fields.name.errors$.peek().map((issue) => issue.message)).toEqual(["Taken"]);
    });

    it("keeps the edit and the server's field issue through an optimistic update and a 422 (F55)", async () => {
        const api = createApi({
            plugins: [
                reactHooksPlugin(),
                unstable_formsReactPlugin({
                    mapSubmitError: (error) => (error as { issues: { path: string[]; message: string }[] }).issues,
                }),
            ],
        });
        const getUser = api.createResource<string, { name: string }>({ queryFn: async () => ({ name: "Ann" }) });
        const update = manualRuns<{ id: string; name: string }, { name: string }>();
        const updateUser = api.createCommand<{ id: string; name: string }, { name: string }>({
            queryFn: update.queryFn,
            links: (link) =>
                link({
                    resource: getUser,
                    forwardArgs: ({ id }) => id,
                    optimisticUpdate: (draft, { name }) => {
                        draft.name = name;
                    },
                }),
        });
        const UserForm = api.defineForm({
            name: "user",
            fields: { name: f({ schema: z.string(), defaultValue: "" }) },
            submit: ({ parsed$ }) => updateUser.bind({ id: "1", ...parsed$().value }),
        });

        const states: unknown[] = [];
        let form = null as unknown as FormInstance<typeof UserForm>;
        function Editor() {
            const user = getUser.useResource("1");
            const state = user.hasData ? { name: user.data.name } : undefined;
            states.push(state);
            form = UserForm.useForm({ state });
            return null;
        }
        render(h(Editor));
        await settle();
        expect(form.fields.name.value$.peek()).toBe("Ann");

        act(() => form.fields.name.set("Bob"));
        let submitted!: Promise<boolean>;
        act(() => {
            submitted = form.submit();
        });
        await settle();
        // The optimistic patch reached the hook while the submit runs.
        expect(states.at(-1)).toEqual({ name: "Bob" });

        update.last().reject({ issues: [{ path: ["name"], message: "Taken" }] });
        await settle();
        expect(await submitted).toBe(false);
        expect(states.at(-1)).toEqual({ name: "Ann" });
        expect(form.fields.name.value$.peek()).toBe("Bob");
        expect(form.fields.name.isDirty$.peek()).toBe(true);
        expect(form.fields.name.errors$.peek().map((issue) => issue.message)).toEqual(["Taken"]);
    });

    it("applies a state and a context that differ only by a file", () => {
        const api = createApi({ plugins: [unstable_formsReactPlugin()] });
        const AvatarForm = api.defineForm({
            name: "avatar",
            fields: { avatar: f({ schema: z.instanceof(File).nullable(), defaultValue: null }) },
            context: FormSignal.context<{ source: File }>(),
        });
        type AvatarInit = { state: { avatar: File }; context: { source: File } };
        let form = null as unknown as FormInstance<typeof AvatarForm>;
        function Editor({ init }: { init: AvatarInit }) {
            form = AvatarForm.useForm(init);
            return null;
        }
        const a = new File(["a"], "a.png");
        const b = new File(["b"], "b.png");
        const view = render(h(Editor, { init: { state: { avatar: a }, context: { source: a } } }));
        view.rerender(h(Editor, { init: { state: { avatar: b }, context: { source: b } } }));
        expect(form.fields.avatar.value$.peek()).toBe(b);
        expect(form.context$.peek().source).toBe(b);
    });

    it("reads the definition and the key once, and warns when they change", () => {
        const { EmailForm } = emailSetup();
        const { EmailForm: OtherForm } = emailSetup();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const forms = new Set<object>();
        function Editor({ Form, formKey }: { Form: typeof EmailForm; formKey: string }) {
            forms.add(Form.useForm({ key: formKey }));
            return null;
        }
        const view = render(h(Editor, { Form: EmailForm, formKey: "a" }));
        view.rerender(h(Editor, { Form: EmailForm, formKey: "b" }));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toMatch(/init\.key changed from a to b/);

        view.rerender(h(Editor, { Form: OtherForm, formKey: "b" }));
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[1][0]).toMatch(/the definition changed/);
        expect(forms.size).toBe(1);
    });
});

// ==================== Lifetime ====================

describe("useForm: lifetime", () => {
    it.runIf("Activity" in React)(
        "<Activity>: hiding keeps the drafts and releases the queries, showing reactivates them",
        async () => {
            const { info, check, EmailForm } = emailSetup();
            let form = null as unknown as FormInstance<typeof EmailForm>;
            function Editor() {
                form = EmailForm.useForm({ state: { email: "a@x.com" } }, { initializeOptions: {} });
                useSignal(form.state$);
                return null;
            }
            const app = (mode: "visible" | "hidden") => h(React.Activity, { mode, children: h(Editor) });

            const view = render(app("visible"));
            await settle();
            const shown = form;
            expect(isMelting(info, "a@x.com")).toBe(false);
            act(() => form.fields.note.set("draft"));

            view.rerender(app("hidden"));
            await settle();
            expect(isMelting(info, "a@x.com")).toBe(true);

            // A cold node sends no request for new args.
            act(() => form.fields.email.set("b@x.com"));
            await settle();
            expect(check.queryFn).not.toHaveBeenCalledWith("b@x.com", expect.anything());

            view.rerender(app("visible"));
            await settle();
            expect(form).toBe(shown);
            expect(form.fields.note.value$.peek()).toBe("draft");
            expect(check.queryFn).toHaveBeenCalledWith("b@x.com", expect.anything());
            expect(isMelting(info, "b@x.com")).toBe(false);
        },
    );

    it("unmount during preparing: the attempt finishes without errors", async () => {
        const api = createApi({ plugins: [unstable_formsReactPlugin()] });
        const check = manualRuns<string, boolean>();
        const info = api.createResource<string, boolean>({ queryFn: check.queryFn });
        const save = manualRuns<{ email: string }, { id: string }>();
        const saveCommand = api.createCommand<{ email: string }, { id: string }>({ queryFn: save.queryFn });
        const Signup = api.defineForm({
            fields: {
                email: f({
                    schema: z.string(),
                    defaultValue: "",
                    queries: { info: ({ value$ }) => info.bind(value$()) },
                }),
            },
            submit: ({ parsed$ }) => saveCommand.bind(parsed$().value),
        });
        const errors = vi.spyOn(console, "error");
        const rejections = await trackUnhandledRejections();
        try {
            let form = null as unknown as FormInstance<typeof Signup>;
            function Editor() {
                form = Signup.useForm({ state: { email: "a@x.com" } });
                useSignal(form.state$);
                return null;
            }
            const view = render(h(Editor));
            await settle();
            expect(check.runs).toHaveLength(1);

            let submitted!: Promise<boolean>;
            act(() => {
                submitted = form.submit();
            });
            await settle();
            expect(form.status$.peek()).toBe("submitting");
            expect(save.runs).toHaveLength(0);

            view.unmount();
            check.last().resolve(true);
            await settle();
            expect(save.runs).toHaveLength(1);
            save.last().resolve({ id: "1" });
            expect(await submitted).toBe(true);
            expect(form.status$.peek()).toBe("success");

            await flushUnhandledRejections();
            expect(rejections.unhandled).toEqual([]);
            expect(errors).not.toHaveBeenCalled();
        } finally {
            rejections.stop();
        }
    });

    it("unmount during the command's flight: the attempt finishes without errors", async () => {
        const { Profile, save } = profileSetup();
        const errors = vi.spyOn(console, "error");
        const rejections = await trackUnhandledRejections();
        try {
            const { captured, view } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
            const form = captured.form;
            let submitted!: Promise<boolean>;
            act(() => {
                submitted = form.submit();
            });
            await settle();
            expect(save.runs).toHaveLength(1);

            view.unmount();
            act(() => form.fields.name.set("Bob"));
            save.last().resolve({ id: "1" });
            expect(await submitted).toBe(true);
            expect(form.status$.peek()).toBe("success");
            expect(form.fields.name.value$.peek()).toBe("Bob");

            await flushUnhandledRejections();
            expect(rejections.unhandled).toEqual([]);
            expect(errors).not.toHaveBeenCalled();
        } finally {
            rejections.stop();
        }
    });

    it("unmount while a state change is deferred: the attempt settles and nothing is applied", async () => {
        const { Profile, save } = profileSetup();
        const { captured, view, rerender } = renderProfile(Profile, { state: { name: "Ann" }, context: { id: "1" } });
        const form = captured.form;
        let submitted!: Promise<boolean>;
        act(() => {
            submitted = form.submit();
        });
        await settle();
        rerender({ state: { name: "Bob" }, context: { id: "1" } });
        view.unmount();

        save.last().resolve({ id: "1" });
        expect(await submitted).toBe(true);
        await settle();
        expect(form.fields.name.value$.peek()).toBe("Ann");
    });
});
