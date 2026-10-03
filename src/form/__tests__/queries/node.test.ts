// The Query node table of the design, the query rows of Throws and Contexts, and the wiring of
// query nodes into fields, groups, list items and `isPending$`.
import { z } from "zod";

import { createApi, SKIP } from "@/query";
import type { IResource } from "@/query/types";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";
import { record } from "../core/helpers";

import { advance, emailResource, entryArgs, LATENCY, type EmailInfo } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** A form with one `email` field whose `info` query checks the parsed value. */
function emailForm(resource: IResource<string, EmailInfo>, email = "") {
    const def = g({
        fields: {
            email: f({
                schema: z.string().min(1),
                defaultValue: "",
                queries: {
                    info: ({ parsed$ }) => {
                        const parsed = parsed$();
                        return parsed.isParsed && resource.bind(parsed.value);
                    },
                },
            }),
        },
    });
    return FormSignal.state(def, { state: { email } });
}

describe("query node", () => {
    it("queries.<k>$ is the alias of queries.<k>.state$", () => {
        const { resource } = emailResource();
        const { queries } = emailForm(resource).fields.email;
        expect(queries.info$).toBe(queries.info.state$);
        expect(Object.keys(queries.info)).toEqual(["state$", "isDebouncing$", "whenSettled"]);
    });

    it("state$ before the first truthy key: a frozen idle row whose methods do nothing", async () => {
        const { resource, queryFn } = emailResource();
        const { queries } = emailForm(resource).fields.email;
        const state = queries.info$();
        expect(state).toMatchObject({ status: "idle", dataSource: "none", data: null, args: null, isPending: false });
        expect(Object.isFrozen(state)).toBe(true);
        state.retry();
        state.invalidate();
        state.refresh();
        await advance(LATENCY);
        expect(queryFn).not.toHaveBeenCalled();
        expect(entryArgs(resource)).toEqual([]);
    });

    it("state$ is TResourceClutchState as is", async () => {
        const { resource, failing } = emailResource();
        const form = emailForm(resource, "taken@x.com");
        const { email } = form.fields;
        const states = record(email.queries.info$);
        expect(states.values[0]).toMatchObject({ status: "pending", dataSource: "none", args: "taken@x.com" });
        await advance(LATENCY);
        expect(email.queries.info$()).toMatchObject({
            status: "success",
            dataSource: "current",
            data: { isValid: false, isCorporate: false },
            dataArgs: "taken@x.com",
            hasData: true,
            hasError: false,
        });

        // An args → args switch keeps the previous data (SWR) within the hot period.
        failing.add("b@x.com");
        email.set("b@x.com");
        expect(email.queries.info$()).toMatchObject({
            status: "pending",
            dataSource: "previous",
            isSwitching: true,
            args: "b@x.com",
            dataArgs: "taken@x.com",
        });
        await advance(LATENCY);
        expect(email.queries.info$()).toMatchObject({ status: "error", dataSource: "previous", hasError: true });

        // The state methods are the clutch's.
        failing.clear();
        email.queries.info$().retry();
        expect(email.queries.info$()).toMatchObject({ status: "pending", hasError: true });
        await advance(LATENCY);
        expect(email.queries.info$()).toMatchObject({ status: "success", data: { isValid: true } });

        // A falsy key switches to SKIP.
        email.set("");
        expect(email.queries.info$()).toMatchObject({ status: "idle", dataSource: "none", args: null });
        states.unsubscribe();
    });

    it("SKIP works like a falsy key", async () => {
        const { resource, queryFn } = emailResource();
        const def = g({
            fields: {
                email: f({
                    schema: z.string(),
                    defaultValue: "",
                    queries: { info: ({ value$ }) => (value$() ? resource.bind(value$()) : SKIP) },
                }),
            },
        });
        const { email } = FormSignal.state(def).fields;
        const states = record(email.queries.info$);
        expect(email.queries.info$().status).toBe("idle");
        email.set("a@x.com");
        expect(email.queries.info$().status).toBe("pending");
        email.set("");
        expect(email.queries.info$().status).toBe("idle");
        expect(queryFn).toHaveBeenCalledTimes(1);
        states.unsubscribe();
    });

    it("isDebouncing$ is false without the debounce option", () => {
        const { resource } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const debouncing = record(email.queries.info.isDebouncing$);
        email.set("b@x.com");
        email.set("");
        expect(debouncing.values).toEqual([false]);
        debouncing.unsubscribe();
    });

    it("isPending$ of the node includes its queries in flight, without a glitch on a cached switch", async () => {
        const { resource } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const pending = record(email.isPending$);
        await advance(LATENCY);
        email.set("b@x.com");
        await advance(LATENCY);
        email.set("a@x.com");
        expect(pending.values).toEqual([true, false, true, false]);
        pending.unsubscribe();
    });

    describe("whenSettled", () => {
        it("resolves by the Suspense rule: on an SWR switch while the request is in flight", async () => {
            const { resource } = emailResource();
            const { email } = emailForm(resource, "a@x.com").fields;
            const settled = vi.fn();
            void email.queries.info.whenSettled().then(settled);
            await advance(LATENCY - 1);
            expect(settled).not.toHaveBeenCalled();
            await advance(1);
            expect(settled).toHaveBeenCalledTimes(1);

            const states = record(email.queries.info$);
            email.set("b@x.com");
            expect(email.queries.info$().isSwitching).toBe(true);
            await email.queries.info.whenSettled();
            expect(email.queries.info$().isPending).toBe(true);
            states.unsubscribe();
        });

        it("with waitForDone waits until the node is not pending; idle is done at once", async () => {
            const { resource } = emailResource();
            const { email } = emailForm(resource, "a@x.com").fields;
            const states = record(email.queries.info$);
            await advance(LATENCY);
            email.set("b@x.com");
            const done = vi.fn();
            void email.queries.info.whenSettled({ waitForDone: true }).then(done);
            await advance(LATENCY - 1);
            expect(done).not.toHaveBeenCalled();
            await advance(1);
            expect(done).toHaveBeenCalledTimes(1);
            states.unsubscribe();

            email.set("");
            await expect(email.queries.info.whenSettled({ waitForDone: true })).resolves.toBeUndefined();
        });

        it("keeps the node active while it waits", async () => {
            const { resource, queryFn } = emailResource();
            const { email } = emailForm(resource, "a@x.com").fields;
            const done = vi.fn();
            void email.queries.info.whenSettled({ waitForDone: true }).then(done);
            await advance(LATENCY);
            expect(done).toHaveBeenCalledTimes(1);
            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(email.queries.info$.peek()).toMatchObject({ status: "success", args: "a@x.com" });
        });
    });

    describe("throws", () => {
        it("a throwing key counts as SKIP and gives a callback issue on the declaring node", async () => {
            const { resource, queryFn } = emailResource();
            const def = g({
                fields: {
                    email: f({
                        schema: z.string(),
                        defaultValue: "",
                        queries: {
                            info: ({ value$ }) => {
                                if (value$() === "boom") throw new Error("Key failed");
                                return !!value$() && resource.bind(value$());
                            },
                        },
                    }),
                },
            });
            const form = FormSignal.state(def);
            const { email } = form.fields;
            const states = record(email.queries.info$);
            email.set("a@x.com");
            expect(email.queries.info$().status).toBe("pending");

            email.set("boom");
            expect(email.queries.info$().status).toBe("idle");
            expect(email.issues$()).toEqual([
                {
                    path: ["email"],
                    message: "Key failed",
                    severity: "error",
                    source: { type: "callback", path: ["email"], name: "queries.info" },
                },
            ]);
            expect(form.isValid$()).toBe(false);

            email.set("b@x.com");
            expect(email.issues$()).toEqual([]);
            expect(email.queries.info$()).toMatchObject({ status: "pending", args: "b@x.com" });
            expect(queryFn).toHaveBeenCalledTimes(2);
            states.unsubscribe();
        });

        it("a group query key that throws gives an own issue of the group", () => {
            const { resource } = emailResource();
            const def = g({
                fields: { a: f({ schema: z.string(), defaultValue: "" }) },
                queries: {
                    info: ({ fields }) => {
                        if (!fields.a.value$()) throw new Error("Group key failed");
                        return resource.bind(fields.a.value$());
                    },
                },
            });
            const form = FormSignal.state(def);
            expect(form.queries.info$().status).toBe("idle");
            expect(form.ownIssues$()).toEqual([
                {
                    path: [],
                    message: "Group key failed",
                    severity: "error",
                    source: { type: "callback", path: [], name: "queries.info" },
                },
            ]);
        });

        it("a key returning something else than a bound resource is a failed key", () => {
            const def = g({
                fields: {
                    // @ts-expect-error: the result must be a bound resource
                    email: f({ schema: z.string(), defaultValue: "", queries: { info: () => ({ id: 1 }) } }),
                },
            });
            const { email } = FormSignal.state(def).fields;
            expect((email.queries.info$() as { status: string }).status).toBe("idle");
            expect(email.issues$().map((issue) => issue.source)).toEqual([
                { type: "callback", path: ["email"], name: "queries.info" },
            ]);
        });

        it("a key that binds a different resource than before throws FormConfigError", () => {
            const api = createApi();
            const first = api.createResource<string, number>({ queryFn: async () => 1 });
            // The same types: the type check cannot tell the two apart, the runtime check does.
            const second = api.createResource<string, number>({ queryFn: async () => 2 });
            const def = g({
                fields: {
                    email: f({
                        schema: z.string(),
                        defaultValue: "a",
                        queries: {
                            info: ({ value$ }) => (value$() === "a" ? first.bind("a") : second.bind("b")),
                        },
                    }),
                },
            });
            const { email } = FormSignal.state(def).fields;
            expect(email.queries.info$().status).toBe("pending");
            email.set("b");
            expect(() => email.queries.info$()).toThrow(FormConfigError);
            expect(() => email.issues$()).toThrow("email.queries.info: binds a different resource than before");
            expect(() => email.isPending$()).toThrow(FormConfigError);
        });
    });

    describe("contexts", () => {
        it("a field key sees its own value$, parsed$ and context$", () => {
            const { resource } = emailResource();
            const key = vi.fn((ctx: object) => {
                void ctx;
                return resource.bind("a@x.com");
            });
            const def = g({
                fields: { email: f({ schema: z.string(), defaultValue: "", queries: { info: key } }) },
            });
            FormSignal.state(def).fields.email.queries.info$();
            expect(Object.keys(key.mock.calls[0][0]).sort()).toEqual(["context$", "parsed$", "value$"]);
        });

        it("a group key sees its inputs and computed; a group rule sees its queries", async () => {
            const { resource } = emailResource();
            let keys: string[] = [];
            const def = g({
                fields: { email: f({ schema: z.string(), defaultValue: "taken" }) },
                computed: { address: ({ fields }) => `${fields.email.value$()}@x.com` },
                queries: {
                    info: (ctx) => {
                        keys = Object.keys(ctx).sort();
                        return resource.bind(ctx.computed.address$()!);
                    },
                },
                validate: ({ queries, error }) => {
                    const info = queries.info$();
                    if (info.dataSource === "current" && !info.data.isValid) error("Taken");
                },
            });
            const form = FormSignal.state(def);
            const issues = record(form.ownIssues$);
            expect(keys).toEqual(["computed", "context$", "fields", "parsed$", "value$"]);
            expect(form.queries.info$().args).toBe("taken@x.com");
            await advance(LATENCY);
            expect(form.ownIssues$().map((issue) => issue.message)).toEqual(["Taken"]);
            form.fields.email.set("b");
            expect(form.queries.info$().args).toBe("b@x.com");
            issues.unsubscribe();
        });

        it("a field rule sees queries.<k>$ and queries.<k>.isDebouncing$, without whenSettled", () => {
            const { resource } = emailResource();
            let seen: object | null = null;
            const def = g({
                fields: {
                    email: f({
                        schema: z.string(),
                        defaultValue: "a@x.com",
                        queries: { info: ({ value$ }) => resource.bind(value$()) },
                        validate: ({ queries }) => {
                            seen = queries;
                        },
                    }),
                },
            });
            const { email } = FormSignal.state(def).fields;
            email.issues$();
            expect(Object.keys(seen!)).toEqual(["info", "info$"]);
            const view = (seen as unknown as { info: object; info$: unknown }).info;
            expect(Object.keys(view)).toEqual(["isDebouncing$"]);
            expect((seen as unknown as { info$: unknown }).info$).toBe(email.queries.info$);
        });
    });

    describe("wiring", () => {
        it("one clutch per key per node instance: list items run their own queries", async () => {
            const { resource, queryFn } = emailResource();
            const def = g({
                fields: {
                    rows: l({
                        item: g({
                            fields: { email: f({ schema: z.string(), defaultValue: "" }) },
                            queries: {
                                info: ({ fields }) => !!fields.email.value$() && resource.bind(fields.email.value$()),
                            },
                        }),
                    }),
                },
            });
            const form = FormSignal.state(def, { state: { rows: [{ email: "a@x.com" }, { email: "taken@x.com" }] } });
            const pending = record(form.isPending$);
            const [a, b] = form.fields.rows.items$();
            expect(queryFn).toHaveBeenCalledTimes(2);
            await advance(LATENCY);
            expect(a.queries.info$().data).toEqual({ isValid: true, isCorporate: false });
            expect(b.queries.info$().data).toEqual({ isValid: false, isCorporate: false });

            const c = form.fields.rows.push({ email: "c@x.com" });
            expect(c.queries.info$()).toMatchObject({ status: "pending", args: "c@x.com" });
            await advance(LATENCY);
            expect(pending.values).toEqual([true, false, true, false]);
            pending.unsubscribe();
        });

        it("a group's isPending$ is its own queries or any descendant's", async () => {
            const { resource } = emailResource();
            const def = g({
                fields: {
                    email: f({
                        schema: z.string(),
                        defaultValue: "",
                        queries: { info: ({ value$ }) => !!value$() && resource.bind(value$()) },
                    }),
                    domain: f({ schema: z.string(), defaultValue: "" }),
                },
                queries: {
                    domainInfo: ({ fields }) => !!fields.domain.value$() && resource.bind(fields.domain.value$()),
                },
            });
            const form = FormSignal.state(def);
            const pending = record(form.isPending$);
            form.fields.domain.set("x.com");
            expect([form.isPending$(), form.fields.domain.isPending$(), form.state$().isPending]).toEqual([
                true,
                false,
                true,
            ]);
            await advance(LATENCY);
            form.fields.email.set("a@x.com");
            expect([form.isPending$(), form.fields.email.isPending$(), form.fields.email.state$().isPending]).toEqual([
                true,
                true,
                true,
            ]);
            await advance(LATENCY);
            expect(pending.values).toEqual([false, true, false, true, false]);
            pending.unsubscribe();
        });

        it("one read of root isPending$ activates every query of the tree at once", () => {
            const { resource, queryFn } = emailResource();
            const def = g({
                fields: {
                    a: f({
                        schema: z.string(),
                        defaultValue: "a@x.com",
                        queries: { q: ({ value$ }) => resource.bind(value$()) },
                    }),
                    b: f({
                        schema: z.string(),
                        defaultValue: "b@x.com",
                        queries: { q: ({ value$ }) => resource.bind(value$()) },
                    }),
                },
                queries: { q: () => resource.bind("root@x.com") },
            });
            FormSignal.state(def).isPending$();
            expect(queryFn.mock.calls.map(([email]) => email)).toEqual(["root@x.com", "a@x.com", "b@x.com"]);
        });

        it("a disabled subtree is left out of the parent's isPending$ while its queries keep running", async () => {
            const { resource } = emailResource();
            const def = g({
                fields: {
                    kind: f({ schema: z.string(), defaultValue: "person" }),
                    company: g({
                        fields: {
                            vat: f({
                                schema: z.string(),
                                defaultValue: "vat@x.com",
                                queries: { info: ({ value$ }) => resource.bind(value$()) },
                            }),
                        },
                    }),
                },
                disabled: { company: ({ fields }) => fields.kind.value$() !== "company" },
            });
            const form = FormSignal.state(def);
            const { vat } = form.fields.company.fields;
            const field = record(vat.state$);
            const root = record(form.isPending$);
            expect(vat.isPending$()).toBe(true);
            expect(entryArgs(resource)).toEqual(["vat@x.com"]);
            expect(root.values).toEqual([false]);

            form.fields.kind.set("company");
            expect(root.values).toEqual([false, true]);
            await advance(LATENCY);
            expect(root.values).toEqual([false, true, false]);
            field.unsubscribe();
            root.unsubscribe();
        });
    });
});
