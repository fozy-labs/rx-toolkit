// "React": `Provide` on the instance and `useFormContext()` on the definition, the plugin
// replacing unstable_formsPlugin(), and the typing of the React members.
import { render } from "@testing-library/react";
import React from "react";
import { z } from "zod";

import { createApi } from "@/query";

import {
    unstable_FormSignal as FormSignal,
    unstable_FormsPlugin,
    unstable_formsPlugin,
    unstable_FormsReactPlugin,
    unstable_formsReactPlugin,
    type FormInit,
    type FormInitial,
    type FormInstance,
    type FormReactInstanceMembers,
} from "../../index";
import type { FormsPluginErrorMismatch } from "../../types/plugin";

const h = React.createElement;
const f = FormSignal.field;

afterEach(() => {
    vi.restoreAllMocks();
});

function setup() {
    const api = createApi({ plugins: [unstable_formsReactPlugin()] });
    const Profile = api.defineForm({ name: "profile", fields: { name: f({ schema: z.string(), defaultValue: "" }) } });
    const Address = api.defineForm({ fields: { city: f({ schema: z.string(), defaultValue: "" }) } });
    return { api, Profile, Address };
}

/** Catches a render error of its children and renders nothing instead. */
class Boundary extends React.Component<{ onError: (error: unknown) => void; children?: React.ReactNode }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: unknown) {
        this.props.onError(error);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

/** Renders `element` and returns the error it throws, if any. */
function renderError(element: React.ReactElement): unknown {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let caught: unknown;
    render(h(Boundary, { onError: (error) => (caught = error) }, element));
    return caught;
}

describe("Provide and useFormContext", () => {
    it("Provide is one component per instance, created on the first read", () => {
        const { Profile } = setup();
        const a = FormSignal.state(Profile);
        const b = FormSignal.state(Profile);
        expect(Object.keys(a)).toContain("Provide");
        expect(a.Provide).toBe(a.Provide);
        expect(a.Provide).not.toBe(b.Provide);
        expect(Object.isFrozen(a)).toBe(true);
    });

    it("useFormContext returns the instance of the nearest Provide of its definition", () => {
        const { Profile, Address } = setup();
        const outer = FormSignal.state(Profile);
        const inner = FormSignal.state(Profile);
        const address = FormSignal.state(Address);
        const seen: Record<string, unknown> = {};
        function Probe({ id }: { id: string }) {
            seen[id] = Profile.useFormContext();
            return null;
        }
        render(
            h(
                outer.Provide,
                null,
                h(Probe, { id: "outer" }),
                h(address.Provide, null, h(Probe, { id: "throughOther" })),
                h(inner.Provide, null, h(Probe, { id: "inner" })),
            ),
        );
        expect(seen).toEqual({ outer, throughOther: outer, inner });
    });

    it("the instance of useForm provides itself to its subtree", () => {
        const { Profile } = setup();
        let own: unknown;
        let fromContext: unknown;
        function Field() {
            fromContext = Profile.useFormContext();
            return null;
        }
        function Editor() {
            const form = Profile.useForm();
            own = form;
            return h(form.Provide, null, h(Field));
        }
        render(h(Editor));
        expect(fromContext).toBe(own);
    });

    it("useFormContext outside a Provide of its definition throws a clear error", () => {
        const { Profile, Address } = setup();
        function Probe() {
            Profile.useFormContext();
            return null;
        }
        expect(renderError(h(Probe))).toMatchObject({
            message: expect.stringMatching(
                /^useFormContext\(\) of the form "profile" is called outside its <form\.Provide>/,
            ),
        });

        const address = FormSignal.state(Address);
        expect(renderError(h(address.Provide, null, h(Probe)))).toBeInstanceOf(Error);
    });

    it("instances of other definitions have no React members", () => {
        const api = createApi({ plugins: [unstable_formsPlugin()] });
        const Core = api.defineForm({ fields: { name: f({ schema: z.string(), defaultValue: "" }) } });
        const Plain = FormSignal.group({ fields: { name: f({ schema: z.string(), defaultValue: "" }) } });
        expect("useForm" in Core).toBe(false);
        expect("Provide" in FormSignal.state(Core)).toBe(false);
        expect("Provide" in FormSignal.state(Plain)).toBe(false);
    });
});

describe("unstable_formsReactPlugin", () => {
    it("is the forms plugin with React members, and the api rejects it next to unstable_formsPlugin()", () => {
        const plugin = unstable_formsReactPlugin();
        expect(plugin).toBeInstanceOf(unstable_FormsReactPlugin);
        expect(plugin).toBeInstanceOf(unstable_FormsPlugin);
        expect(() => createApi({ plugins: [unstable_formsPlugin(), unstable_formsReactPlugin()] })).toThrow(
            /defineForm/,
        );
    });

    it("passes its options as the defaults of its forms", async () => {
        const api = createApi({
            plugins: [unstable_formsReactPlugin({ mapSubmitError: () => [{ message: "From the plugin" }] })],
        });
        const Form = api.defineForm({
            fields: { name: f({ schema: z.string(), defaultValue: "" }) },
            submit: () => Promise.reject(new Error("boom")),
        });
        const form = FormSignal.state(Form);
        expect(await form.submit()).toBe(false);
        expect(form.ownIssues$.peek().map((issue) => issue.message)).toEqual(["From the plugin"]);
    });

    it("types the React members from the definition", () => {
        const { api, Profile } = setup();
        type Instance = FormInstance<typeof Profile>;
        expectTypeOf<Instance>().toExtend<FormReactInstanceMembers>();
        expectTypeOf(Profile.useForm).returns.toEqualTypeOf<Instance>();
        expectTypeOf(Profile.useFormContext).returns.toEqualTypeOf<Instance>();
        expectTypeOf(FormSignal.state(Profile)).toEqualTypeOf<Instance>();
        expectTypeOf(Profile.useForm).parameter(0).toEqualTypeOf<FormInit<typeof Profile> | undefined>();
        expectTypeOf<FormInitial<typeof Profile>>().toEqualTypeOf<{ name?: string }>();

        const WithContext = api.defineForm({
            fields: { name: f({ schema: z.string(), defaultValue: "" }) },
            context: FormSignal.context<{ id: string }>(),
        });
        const typeOnly = () => {
            // @ts-expect-error the context is required
            WithContext.useForm();
            WithContext.useForm({ context: { id: "1" } }, { initializeOptions: { keepDirtyValues: false } });
            // @ts-expect-error a wrong context
            WithContext.useForm({ context: { id: 1 } });
        };
        void typeOnly;

        const narrow = createApi({
            plugins: [
                unstable_formsReactPlugin({
                    mapSubmitError: (error: { code: number }) => [{ message: `${error.code}` }],
                }),
            ],
            mapError: (error) => String(error),
        });
        expectTypeOf(narrow.defineForm).toEqualTypeOf<FormsPluginErrorMismatch>();
    });
});
