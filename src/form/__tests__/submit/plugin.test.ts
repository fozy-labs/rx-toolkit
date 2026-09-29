// "API and integration": unstable_formsPlugin(options) and api.defineForm(...), the plugin
// options as form defaults, the typing of mapSubmitError by the api's error type, conflicts.
import { z } from "zod";

import { createApi } from "@/query";

import {
    unstable_FormSignal as FormSignal,
    unstable_FormsPlugin,
    unstable_formsPlugin,
    type FormsPluginErrorMismatch,
    type IssueInput,
} from "../../index";

import { flush } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

interface ApiError {
    message: string;
    status: number;
}

const toApiError = (error: unknown): ApiError => ({ message: (error as Error).message, status: 500 });

function formsApi(mapSubmitError?: (error: ApiError) => IssueInput[]) {
    const api = createApi({ plugins: [unstable_formsPlugin({ mapSubmitError })], mapError: toApiError });
    let fail: Error | null = null;
    const save = api.createCommand<{ name: string }, { id: string }>({
        queryFn: async () => {
            if (fail) throw fail;
            return { id: "1" };
        },
    });
    return {
        api,
        save,
        failWith: (error: Error | null) => {
            fail = error;
        },
    };
}

const name = () => f({ schema: z.string(), defaultValue: "Ann" });

afterEach(() => {
    vi.restoreAllMocks();
});

describe("api.defineForm", () => {
    it("creates a form definition for FormSignal.state()", async () => {
        const { api, save } = formsApi();
        const Form = api.defineForm({
            name: "profile",
            fields: { name: name() },
            submit: ({ parsed$ }) => save.bind(parsed$().value),
        });
        const form = FormSignal.state(Form);
        expect(await form.submit()).toBe(true);
        expect(form.submission$()).toMatchObject({ status: "success", data: { id: "1" } });
        expect(Object.isFrozen(Form)).toBe(true);
    });

    it("the plugin's mapSubmitError is the default; the definition's own wins", async () => {
        const { api, save, failWith } = formsApi((error) => [{ message: `plugin: ${error.message}` }]);
        failWith(new Error("Down"));
        const byPlugin = FormSignal.state(
            api.defineForm({ fields: { name: name() }, submit: ({ parsed$ }) => save.bind(parsed$().value) }),
        );
        await byPlugin.submit();
        expect(byPlugin.ownIssues$().map((issue) => issue.message)).toEqual(["plugin: Down"]);

        const byDefinition = FormSignal.state(
            api.defineForm({
                fields: { name: name() },
                submit: ({ parsed$ }) => save.bind(parsed$().value),
                mapSubmitError: (error) => [{ message: `own: ${error.status}` }],
            }),
        );
        await byDefinition.submit();
        expect(byDefinition.ownIssues$().map((issue) => issue.message)).toEqual(["own: 500"]);
    });

    it("a throwing plugin mapper falls back to the built-in one", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const { api, save, failWith } = formsApi(() => {
            throw new Error("mapper bug");
        });
        failWith(new Error("Down"));
        const form = FormSignal.state(
            api.defineForm({ fields: { name: name() }, submit: ({ parsed$ }) => save.bind(parsed$().value) }),
        );
        await form.submit();
        expect(form.ownIssues$().map((issue) => issue.message)).toEqual(["Down"]);
        expect(errors).toHaveBeenCalledTimes(1);
    });

    it("there are no global defaults: a primitive form does not see the plugin's options", async () => {
        const plugin = vi.fn((): IssueInput[] => [{ message: "plugin" }]);
        const { save, failWith } = formsApi(plugin);
        failWith(new Error("Down"));
        const form = FormSignal.state(
            g({ fields: { name: name() }, submit: ({ parsed$ }) => save.bind(parsed$().value) }),
        );
        await form.submit();
        expect(form.ownIssues$().map((issue) => issue.message)).toEqual(["Down"]);
        expect(plugin).not.toHaveBeenCalled();
    });

    it("a promise submit runs on the api: its rejection passes mapError, resetAll() aborts it", async () => {
        const { api } = formsApi((error) => [{ message: `${error.status}: ${error.message}` }]);
        let settle!: { resolve: () => void; reject: (error: unknown) => void };
        const form = FormSignal.state(
            api.defineForm({
                fields: { name: name() },
                submit: () => new Promise<void>((resolve, reject) => (settle = { resolve, reject })),
            }),
        );
        let result = form.submit();
        await flush();
        settle.reject(new Error("Offline"));
        expect(await result).toBe(false);
        expect(form.submission$()).toMatchObject({ status: "error", error: { message: "Offline", status: 500 } });
        expect(form.ownIssues$().map((issue) => issue.message)).toEqual(["500: Offline"]);

        result = form.submit();
        await flush();
        api.resetAll();
        expect(await result).toBe(false);
        expect(form.ownIssues$()).toEqual([]);
    });
});

describe("the plugin", () => {
    it("conflicts with another plugin that adds defineForm", () => {
        class FormsReactPlugin extends unstable_FormsPlugin {
            override readonly name = "FormsReactPlugin";
        }
        expect(() => createApi({ plugins: [unstable_formsPlugin(), new FormsReactPlugin()] })).toThrow(
            'Plugin "FormsReactPlugin" cannot add "defineForm" to the api: plugin "FormsPlugin" already added it.',
        );
    });

    it("a subclass adds members to every definition it creates", () => {
        class WithMembers extends unstable_FormsPlugin {
            protected override definitionMembers(definition: object) {
                const state = FormSignal.state as (definition: unknown) => unknown;
                return { useForm: () => state(definition) };
            }
        }
        const api = createApi({ plugins: [new WithMembers()] });
        const Form = api.defineForm({ fields: { name: name() } }) as unknown as { useForm: () => unknown };
        expect(typeof Form.useForm).toBe("function");
        expect(Form.useForm()).toHaveProperty("submit");
    });
});

describe("types", () => {
    it("defineForm types mapSubmitError by the error type of the api", () => {
        const { api, save } = formsApi();
        api.defineForm({
            fields: { name: name() },
            submit: ({ parsed$ }) => save.bind(parsed$().value),
            mapSubmitError: (error) => {
                expectTypeOf(error).toEqualTypeOf<ApiError>();
                return [];
            },
        });
        const plain = createApi({ plugins: [unstable_formsPlugin()] });
        plain.defineForm({
            fields: { name: name() },
            mapSubmitError: (error) => {
                expectTypeOf(error).toEqualTypeOf<unknown>();
                return [];
            },
        });
    });

    it("the plugin's mapSubmitError must accept the api's error type", () => {
        const mismatched = createApi({
            plugins: [
                unstable_formsPlugin({ mapSubmitError: (error: { code: number }) => [{ message: `${error.code}` }] }),
            ],
            mapError: toApiError,
        });
        expectTypeOf(mismatched.defineForm).toEqualTypeOf<FormsPluginErrorMismatch>();
        const wide = createApi({
            plugins: [unstable_formsPlugin({ mapSubmitError: (error: unknown) => [{ message: String(error) }] })],
            mapError: toApiError,
        });
        expectTypeOf(wide.defineForm).toBeFunction();
    });

    it("an api without the plugin has no defineForm", () => {
        const api = createApi();
        // @ts-expect-error defineForm comes with unstable_formsPlugin()
        void api.defineForm;
    });

    it("a definition from defineForm is a root: nested root-only options stay rejected", () => {
        const { api } = formsApi();
        const Form = api.defineForm({ fields: { name: name() }, pendingQueries: "reject" });
        // @ts-expect-error a group with root-only options cannot be nested
        expect(() => g({ fields: { form: Form } })).toThrow("root-only options");
    });
});
