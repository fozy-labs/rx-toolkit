// The Submit section of the design: every branch of the sequence diagram, the submit phase,
// status$, the counters, server issues at entry, the handler result and pendingQueries.
import { z } from "zod";

import type { IResource } from "@/query/types";

import { FormConfigError, unstable_FormSignal as FormSignal } from "../../index";
import { addServerIssue, record } from "../core/helpers";
import { emailResource, LATENCY, type EmailInfo } from "../queries/helpers";

import { advance, flush, manualCommand } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

interface Signup {
    name: string;
    email: string;
}

const fields = () => ({
    name: f({ schema: z.string().min(1, "Required"), defaultValue: "" }),
    email: f({ schema: z.string(), defaultValue: "" }),
});

function signup() {
    const save = manualCommand<Signup>();
    const def = g({
        name: "signup",
        fields: fields(),
        submit: ({ parsed$ }) => save.command.bind(parsed$().value),
    });
    const form = FormSignal.state(def, { state: { name: "Ann", email: "ann@x.com" } });
    return { ...save, form };
}

/** A form whose email field checks the address with a query; the rule reads it. */
function withEmailCheck(resource: IResource<string, EmailInfo>, pendingQueries?: "wait" | "ignore" | "reject") {
    const save = manualCommand<{ email: string }>();
    const def = g({
        fields: {
            email: f({
                schema: z.string(),
                defaultValue: "",
                queries: { info: { bind: ({ value$ }) => resource.bind(value$()), debounce: 300 } },
                validate: ({ queries, error }) => {
                    const info = queries.info$();
                    if (queries.info.isDebouncing$() || info.dataSource !== "current") return;
                    if (!info.data.isValid) error("Email is taken");
                },
            }),
        },
        submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        pendingQueries,
    });
    return { ...save, form: FormSignal.state(def, { state: { email: "ann@x.com" } }) };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("submit phase", () => {
    it("is set on the first line of submit(): isSubmitting$, status$ and canSubmit$ follow it", async () => {
        const { form, last } = signup();
        const states = record(form.state$);
        const result = form.submit();
        expect(form.isSubmitting$()).toBe(true);
        expect(form.status$()).toBe("submitting");
        expect(form.canSubmit$()).toBe(false);
        expect(form.state$()).toMatchObject({ status: "submitting", isSubmitting: true, canSubmit: false });
        await flush();
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.state$()).toMatchObject({
            status: "success",
            isSubmitting: false,
            canSubmit: true,
            submitCount: 1,
        });
        const statuses = states.values.map((state) => state.status);
        expect(statuses.filter((status, i) => status !== statuses[i - 1])).toEqual(["idle", "submitting", "success"]);
    });

    it("a repeated submit() in any phase returns false at once and is counted as an attempt", async () => {
        const { resource } = emailResource();
        const { form, queryFn, last } = withEmailCheck(resource);
        const first = form.submit();
        // preparing: waiting for the email check
        expect(await form.submit()).toBe(false);
        await advance(LATENCY);
        expect(form.submission$()?.status).toBe("pending");
        // submitting: the command is in flight
        expect(await form.submit()).toBe(false);
        expect(form.submitAttempts$()).toBe(3);
        expect(form.submitCount$()).toBe(1);
        last().resolve({ id: "1" });
        expect(await first).toBe(true);
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("canSubmit$ ignores isValid$ and isPending$", () => {
        const { resource } = emailResource();
        const { form } = withEmailCheck(resource);
        form.fields.email.set("");
        const sub = form.state$.obs.subscribe();
        expect(form.isPending$()).toBe(true);
        expect(form.canSubmit$()).toBe(true);
        sub.unsubscribe();
    });
});

describe("entry into submit()", () => {
    it("drops every server issue, then marks the whole tree touched and submitted", async () => {
        const def = g({
            fields: {
                name: f({ schema: z.string().min(1), defaultValue: "", showErrors: "submitted" }),
                inner: g({ fields: { city: f({ schema: z.string(), defaultValue: "" }) } }),
            },
        });
        const form = FormSignal.state(def);
        addServerIssue(form, "Form error", []);
        addServerIssue(form.fields.inner.fields.city, "Unknown city");
        expect(form.fields.name.visibleErrors$()).toEqual([]);

        const result = form.submit();
        expect(form.issues$().filter((issue) => issue.source.type === "server")).toEqual([]);
        expect(form.fields.name.isTouched$()).toBe(true);
        expect(form.fields.inner.fields.city.isTouched$()).toBe(true);
        // `submitted` shows the errors under any policy
        expect(form.fields.name.visibleErrors$()).toHaveLength(1);
        expect(await result).toBe(false);
    });

    it("a submit stopped by validation: invalid, no command, and the old server issues are gone too", async () => {
        const { form, queryFn } = signup();
        addServerIssue(form.fields.email, "Taken");
        form.fields.name.set("");
        expect(await form.submit()).toBe(false);
        expect(form.status$()).toBe("invalid");
        expect(form.fields.email.issues$()).toEqual([]);
        expect(queryFn).not.toHaveBeenCalled();
        expect(form.submitAttempts$()).toBe(1);
        expect(form.submitCount$()).toBe(0);
        expect(form.submission$()).toBeNull();
    });
});

describe("a root without submit", () => {
    it("performs a validation-only submit: success or invalid, without _commit() and key rotation", async () => {
        const form = FormSignal.state(g({ fields: fields() }));
        const entryKey = form.entryKey;
        expect(await form.submit()).toBe(false);
        expect(form.status$()).toBe("invalid");

        form.fields.name.set("Ann");
        expect(await form.submit()).toBe(true);
        expect(form.status$()).toBe("success");
        expect(form.fields.name.isDirty$()).toBe(true);
        expect(form.entryKey).toBe(entryKey);
        expect(form.submitCount$()).toBe(0);
        expect(form.submission$()).toBeNull();
    });
});

describe("the outcome", () => {
    it("success: true, status success; submission$ mirrors the clutch without retry", async () => {
        const { form, last } = signup();
        const result = form.submit();
        await flush();
        expect(last().args).toEqual({ name: "Ann", email: "ann@x.com" });
        expect(form.submission$()).toMatchObject({ status: "pending", isPending: true, args: last().args });
        last().resolve({ id: "7" });
        expect(await result).toBe(true);
        const submission = form.submission$();
        expect(submission).toMatchObject({ status: "success", data: { id: "7" }, hasData: true });
        expect(submission).not.toHaveProperty("retry");
    });

    it("error: false, status error, and the error mapped into server issues", async () => {
        const { form, last } = signup();
        const result = form.submit();
        await flush();
        last().reject(new Error("Service unavailable"));
        expect(await result).toBe(false);
        expect(form.status$()).toBe("error");
        expect(form.submission$()).toMatchObject({ status: "error", hasError: true });
        expect(form.ownIssues$()).toEqual([
            { path: [], message: "Service unavailable", severity: "error", source: { type: "server" } },
        ]);
        expect(form.isValid$()).toBe(false);
    });

    it("status$ is the outcome of the last attempt, not the live validity", async () => {
        const { form } = signup();
        form.fields.name.set("");
        await form.submit();
        expect(form.status$()).toBe("invalid");
        form.fields.name.set("Ann");
        expect(form.isValid$()).toBe(true);
        expect(form.status$()).toBe("invalid");
    });

    it("refusals do not change status$: pendingQueries reject", async () => {
        const { resource } = emailResource();
        const { form } = withEmailCheck(resource, "reject");
        const sub = form.state$.obs.subscribe();
        form.fields.email.set("taken@x.com");
        await advance(300 + LATENCY);
        expect(await form.submit()).toBe(false);
        expect(form.status$()).toBe("invalid");
        form.fields.email.set("bob@x.com");
        expect(form.isPending$()).toBe(true);
        expect(await form.submit()).toBe(false);
        expect(form.status$()).toBe("invalid");
        sub.unsubscribe();
    });
});

describe("the handler", () => {
    it("a synchronous throw: false, status error, a root `callback` issue; the next attempt drops it", async () => {
        let fail = true;
        const save = manualCommand<Signup>();
        const def = g({
            name: "signup",
            fields: fields(),
            submit: ({ parsed$ }) => {
                if (fail) throw new Error("No session");
                return save.command.bind(parsed$().value);
            },
        });
        const form = FormSignal.state(def, { state: { name: "Ann" } });
        await expect(form.submit()).resolves.toBe(false);
        expect(form.status$()).toBe("error");
        expect(form.submitCount$()).toBe(0);
        expect(form.ownIssues$()).toEqual([
            {
                path: [],
                message: "No session",
                severity: "error",
                source: { type: "callback", path: [], name: "submit" },
            },
        ]);

        fail = false;
        const result = form.submit();
        expect(form.ownIssues$()).toEqual([]);
        await flush();
        save.last().resolve({ id: "1" });
        expect(await result).toBe(true);
    });

    it("sees the context: fields, value$, the narrowed parsed$, computed, queries and context$", async () => {
        const seen: unknown[] = [];
        const def = g({
            fields: fields(),
            context: FormSignal.context<{ id: string }>(),
            computed: { title: ({ fields }) => fields.name.value$().toUpperCase() },
            submit: (ctx) => {
                seen.push(ctx.parsed$().value, ctx.value$(), ctx.computed.title$(), ctx.context$());
                seen.push(ctx.fields.email.value$(), Object.keys(ctx.queries));
                return Promise.resolve();
            },
        });
        const form = FormSignal.state(def, { state: { name: "ann" }, context: { id: "1" } });
        expect(await form.submit()).toBe(true);
        expect(seen).toEqual([{ name: "ann", email: "" }, { name: "ann", email: "" }, "ANN", { id: "1" }, "", []]);
    });

    it("any result other than a bound command or a promise rejects submit() with FormConfigError", async () => {
        const def = g({ fields: fields(), submit: (() => undefined) as never });
        const form = FormSignal.state(def, { state: { name: "Ann" } });
        await expect(form.submit()).rejects.toThrow(FormConfigError);
        await expect(form.submit()).rejects.toThrow("submit: must return command.bind(args) or a promise");
        expect(form.isSubmitting$()).toBe(false);
        expect(form.status$()).toBe("idle");
    });

    it("a promise runs as an internal command with the same submission$ rows, without retry", async () => {
        const calls: string[] = [];
        let settle!: { resolve: (value: number) => void; reject: (error: unknown) => void };
        const def = g({
            fields: fields(),
            submit: ({ parsed$ }) => {
                calls.push(parsed$().value.name);
                return new Promise<number>((resolve, reject) => (settle = { resolve, reject }));
            },
        });
        const form = FormSignal.state(def, { state: { name: "Ann" } });

        let result = form.submit();
        await flush();
        expect(form.submission$()).toMatchObject({ status: "pending", args: undefined });
        settle.reject({ message: "Offline" });
        expect(await result).toBe(false);
        expect(form.submission$()).toMatchObject({ status: "error", error: { message: "Offline" } });
        expect(form.ownIssues$().map((issue) => issue.message)).toEqual(["Offline"]);

        // the handler runs again and its new promise goes out: a promise is never retried
        result = form.submit();
        await flush();
        expect(form.submission$()).toMatchObject({ status: "pending", hasError: false });
        settle.resolve(42);
        expect(await result).toBe(true);
        expect(form.submission$()).toMatchObject({ status: "success", data: 42 });
        expect(calls).toEqual(["Ann", "Ann"]);
        expect(form.submitCount$()).toBe(2);
    });

    it("a promise that resolves to a bound command rejects submit() with FormConfigError", async () => {
        const save = manualCommand<Signup>();
        const def = g({
            fields: fields(),
            submit: async ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def, { state: { name: "Ann" } });
        await expect(form.submit()).rejects.toThrow("returned a promise of a bound command");
        expect(save.queryFn).not.toHaveBeenCalled();
        expect(form.isSubmitting$()).toBe(false);
    });
});

describe("pendingQueries", () => {
    it('"wait" (the default) waits for root isPending$, including a debounce started during the wait', async () => {
        const { resource, queryFn: check } = emailResource();
        const { form, queryFn } = withEmailCheck(resource);
        const result = form.submit();
        await advance(LATENCY / 2);
        // an edit during the wait: its debounce keeps the form pending
        form.fields.email.set("taken@x.com");
        await advance(LATENCY);
        expect(queryFn).not.toHaveBeenCalled();
        await advance(300 + LATENCY);
        expect(check.mock.calls.map(([email]) => email)).toEqual(["ann@x.com", "taken@x.com"]);
        // the rule saw the fresh check
        expect(await result).toBe(false);
        expect(form.status$()).toBe("invalid");
        expect(form.fields.email.errors$().map((issue) => issue.message)).toEqual(["Email is taken"]);
        expect(queryFn).not.toHaveBeenCalled();
    });

    it('"ignore" does not wait: rules run on the data available right now', async () => {
        const { resource } = emailResource();
        const { form, queryFn, last } = withEmailCheck(resource, "ignore");
        form.fields.email.set("taken@x.com");
        const result = form.submit();
        await flush();
        // the check is still in flight: the rule gives no verdict, and the command goes out
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(last().args).toEqual({ email: "taken@x.com" });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
    });

    it('"reject" returns false while a query is pending; the status stays', async () => {
        const { resource } = emailResource();
        const { form, queryFn } = withEmailCheck(resource, "reject");
        expect(await form.submit()).toBe(false);
        expect(form.status$()).toBe("idle");
        expect(form.submitAttempts$()).toBe(1);
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("a disabled subtree is ignored through root isPending$", async () => {
        const { resource, queryFn: check } = emailResource();
        const save = manualCommand<unknown>();
        const def = g({
            fields: {
                hasEmail: f({ schema: z.boolean(), defaultValue: false }),
                email: f({
                    schema: z.string(),
                    defaultValue: "a@x.com",
                    queries: { info: ({ value$ }) => resource.bind(value$()) },
                }),
            },
            disabled: { email: ({ fields }) => !fields.hasEmail.value$() },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def);
        const result = form.submit();
        await flush();
        expect(save.last().args).toEqual({ hasEmail: false });
        save.last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(check).not.toHaveBeenCalled();
    });
});

describe("the counters", () => {
    it("are monotonic: reset() and initialize() do not reset them", async () => {
        const { form, last } = signup();
        const result = form.submit();
        await flush();
        last().resolve({ id: "1" });
        await result;
        form.reset();
        form.initialize();
        expect(form.submitAttempts$()).toBe(1);
        expect(form.submitCount$()).toBe(1);
        expect("submitAttempts" in form.state$()).toBe(false);
    });
});

describe("resetting the submit state", () => {
    it("root reset(): status$ → idle, a new entryKey, submission$ → null", async () => {
        const { form, last } = signup();
        const result = form.submit();
        await flush();
        last().resolve({ id: "1" });
        await result;
        const entryKey = form.entryKey;
        form.reset();
        expect(form.status$()).toBe("idle");
        expect(form.submission$()).toBeNull();
        expect(form.entryKey).not.toBe(entryKey);
    });

    it("initialize() and initialize({ state }) reset it; keepDirtyValues and { context } do not", async () => {
        const { form, last } = signup();
        const submitOnce = async () => {
            const result = form.submit();
            await flush();
            last().resolve({ id: "1" });
            await result;
        };
        await submitOnce();
        form.initialize({ state: { name: "Bob" } }, { keepDirtyValues: true });
        expect(form.status$()).toBe("success");
        form.initialize({ context: { tenant: "t1" } });
        expect(form.status$()).toBe("success");
        form.initialize({ state: { name: "Bob" } });
        expect(form.status$()).toBe("idle");
        expect(form.submission$()).toBeNull();

        await submitOnce();
        form.initialize();
        expect(form.status$()).toBe("idle");
    });

    it("a nested reset() or initialize() leaves it", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: { inner: g({ fields: fields() }) },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def, { state: { inner: { name: "Ann" } } });
        const result = form.submit();
        await flush();
        save.last().resolve({ id: "1" });
        await result;
        form.fields.inner.reset();
        form.fields.inner.initialize();
        expect(form.status$()).toBe("success");
    });
});
