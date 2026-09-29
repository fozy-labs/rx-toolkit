// The Lifetime contract tests of the design that involve queries, and the activation bullets of
// the Queries section: consumers, cold reads, `keepAlive: "microtask"`, deactivation via SKIP.
import { z } from "zod";

import type { IResource } from "@/query/types";
import type { ReadonlySignal } from "@/signals";

import { unstable_FormSignal as FormSignal } from "../../index";

import { advance, emailResource, entryArgs, LATENCY, RETENTION, type EmailInfo } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** A form whose `email` field checks its parsed value, with a rule over the check. */
function emailForm(resource: IResource<string, EmailInfo>, email = "a@x.com") {
    return FormSignal.state(emailFormDef(resource), { state: { email } });
}

describe("query lifetime", () => {
    it("construction creates no cache entries and sets no timers", () => {
        const { resource, queryFn } = emailResource();
        emailForm(resource);
        expect(entryArgs(resource)).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("a cold read starts the query; two reads in one microtask return the same object", async () => {
        const { resource, queryFn } = emailResource();
        const form = emailForm(resource);
        const info$ = form.fields.email.queries.info$;

        const first = info$.peek();
        expect(first).toMatchObject({ status: "pending", args: "a@x.com" });
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(info$.peek()).toBe(first);
        expect(info$()).toBe(first);

        // The microtask ends: the node deactivates, the entry goes into retention and keeps loading.
        await advance(LATENCY);
        expect(entryArgs(resource)).toEqual(["a@x.com"]);
        expect(info$.peek()).toMatchObject({ status: "success", data: { isValid: true } });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("a cold read through a rule activates the node: form.isValid$.peek() returns while pending", async () => {
        const { resource, queryFn } = emailResource();
        const form = emailForm(resource, "taken@x.com");
        expect(form.isValid$.peek()).toBe(true);
        expect(queryFn).toHaveBeenCalledTimes(1);
        await advance(LATENCY);
        expect(form.isValid$.peek()).toBe(false);
        expect(form.fields.email.errors$.peek().map((issue) => issue.message)).toEqual(["Email is taken"]);
    });

    it("a subscription holds the entry; after the unsubscription it goes into retention", async () => {
        const { resource } = emailResource();
        const form = emailForm(resource);
        const subscription = form.fields.email.queries.info$.obs.subscribe();
        await advance(RETENTION * 3);
        expect(entryArgs(resource)).toEqual(["a@x.com"]);

        subscription.unsubscribe();
        await advance(RETENTION - 1);
        expect(entryArgs(resource)).toEqual(["a@x.com"]);
        await advance(1);
        expect(entryArgs(resource)).toEqual([]);
    });

    it("rules, isPending$ and snapshots that read the node are its consumers", async () => {
        const { resource } = emailResource();
        const form = emailForm(resource);
        const email = form.fields.email;
        const consumers: ReadonlySignal<unknown>[] = [
            email.issues$,
            email.isPending$,
            email.state$,
            form.state$,
            form.isValid$,
        ];
        for (const consumer of consumers) {
            const subscription = consumer.obs.subscribe();
            await advance(RETENTION * 2);
            expect(entryArgs(resource)).toEqual(["a@x.com"]);
            subscription.unsubscribe();
            await advance(RETENTION);
            expect(entryArgs(resource)).toEqual([]);
        }
    });

    it("a deactivation between the clutch's state derivation and its microtask creates no entry", async () => {
        const { api, resource, queryFn } = emailResource();
        const form = emailForm(resource);
        const info$ = form.fields.email.queries.info$;
        info$.peek();
        await advance(LATENCY);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // A cold read activates the node until the end of the microtask. The entry disappears in
        // the same tick: the active clutch derives a missing entry and schedules its creation,
        // and the node deactivates before that microtask runs.
        info$.peek();
        api.resetAll();
        await advance(RETENTION * 2);
        expect(entryArgs(resource)).toEqual([]);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Control: a read after the reset keeps the node active past that microtask, so the
        // missing entry is re-created.
        info$.peek();
        api.resetAll();
        expect(info$.peek().status).toBe("pending");
        await advance();
        expect(entryArgs(resource)).toEqual(["a@x.com"]);
        expect(queryFn).toHaveBeenCalledTimes(3);
    });

    it("root isPending$ activates the query of a field nobody subscribes to", async () => {
        const { resource, queryFn } = emailResource();
        const form = emailForm(resource);
        const values: boolean[] = [];
        const subscription = form.isPending$.obs.subscribe((value) => values.push(value));
        expect(queryFn).toHaveBeenCalledTimes(1);
        await advance(LATENCY);
        expect(values).toEqual([true, false]);
        subscription.unsubscribe();
    });

    it("deactivation is switch(SKIP): a reactivation starts from the current args, without an earlier fallback", async () => {
        const { resource, queryFn } = emailResource();
        const form = emailForm(resource);
        const email = form.fields.email;
        let subscription = email.queries.info$.obs.subscribe();
        await advance(LATENCY);
        subscription.unsubscribe();
        await advance();

        // Cold: nothing is held, the edit reaches no clutch.
        email.set("b@x.com");
        await advance();
        expect(queryFn).toHaveBeenCalledTimes(1);

        subscription = email.queries.info$.obs.subscribe();
        expect(email.queries.info$()).toMatchObject({ status: "pending", dataSource: "none", args: "b@x.com" });
        await advance(LATENCY);

        // Back to the first args while their entry is in retention: taken from the cache at once.
        email.set("a@x.com");
        subscription.unsubscribe();
        await advance();
        subscription = email.queries.info$.obs.subscribe();
        expect(email.queries.info$()).toMatchObject({ status: "success", dataSource: "current", args: "a@x.com" });
        expect(queryFn).toHaveBeenCalledTimes(2);
        subscription.unsubscribe();
    });

    it("a signal read inside queryFn does not re-run the key function", async () => {
        const key = vi.fn();
        let form: ReturnType<typeof FormSignal.state<typeof def>> | null = null;
        // The queryFn reads form signals; none of them becomes a dependency of the key.
        const { resource } = emailResource(() => form!.fields.other.value$());
        const def = g({
            fields: {
                email: f({
                    schema: z.string(),
                    defaultValue: "a@x.com",
                    queries: {
                        info: ({ value$ }) => {
                            key();
                            return resource.bind(value$());
                        },
                    },
                }),
                other: f({ schema: z.string(), defaultValue: "" }),
            },
        });
        form = FormSignal.state(def);
        const subscription = form.fields.email.state$.obs.subscribe();
        await advance(LATENCY);
        form.fields.other.set("x");
        expect(key).toHaveBeenCalledTimes(1);
        subscription.unsubscribe();
    });

    it("a removed row needs no disposal: its query node cools down", async () => {
        const { resource } = emailResource();
        const def = g({
            fields: {
                rows: FormSignal.list({
                    item: f({
                        schema: z.string(),
                        defaultValue: "",
                        queries: { info: ({ value$ }) => !!value$() && resource.bind(value$()) },
                    }),
                }),
            },
        });
        const form = FormSignal.state(def, { state: { rows: ["a@x.com", "b@x.com"] } });
        const subscription = form.state$.obs.subscribe();
        await advance(LATENCY);
        expect(entryArgs(resource)).toEqual(["a@x.com", "b@x.com"]);

        form.fields.rows.remove(0);
        await advance(RETENTION);
        expect(entryArgs(resource)).toEqual(["b@x.com"]);
        subscription.unsubscribe();
    });
});

function emailFormDef(resource: IResource<string, EmailInfo>) {
    return g({
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
                validate: ({ queries, error }) => {
                    const info = queries.info$();
                    if (info.dataSource === "current" && !info.data.isValid) error("Email is taken");
                },
            }),
            name: f({ schema: z.string(), defaultValue: "" }),
        },
    });
}
