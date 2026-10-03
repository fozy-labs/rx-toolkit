// The debounce rules, `isDebouncing$` and the freshness of the Queries section, with the F02
// stale-verdict scenario of the design's Field example.
import { z } from "zod";

import { toKeyed } from "@/query";
import type { IResource } from "@/query/types";

import { unstable_FormSignal as FormSignal } from "../../index";
import { record } from "../core/helpers";

import { advance, emailResource, LATENCY, type EmailInfo } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

const DEBOUNCE = 300;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

/** The design's Field example with a debounced key. */
function emailForm(resource: IResource<string, EmailInfo>, email = "") {
    const def = g({
        fields: {
            email: f({
                schema: z.email().trim(),
                defaultValue: "",
                showErrors: "always",
                queries: {
                    emailInfo: {
                        bind: ({ parsed$ }) => {
                            const parsed = parsed$();
                            return parsed.isParsed && resource.bind(parsed.value);
                        },
                        debounce: DEBOUNCE,
                    },
                },
                validate: ({ queries, error, warn }) => {
                    const info = queries.emailInfo$();
                    if (queries.emailInfo.isDebouncing$()) return;
                    if (info.status === "error") return warn("Could not check the email");
                    if (info.dataSource !== "current") return;
                    if (!info.data.isValid) error("Email is taken");
                    if (info.data.isCorporate) warn("Corporate address");
                },
            }),
        },
    });
    return FormSignal.state(def, { state: { email } });
}

/** The args the clutch was switched to, in order. */
const calls = (queryFn: ReturnType<typeof emailResource>["queryFn"]) => queryFn.mock.calls.map(([email]) => email);

describe("debounce", () => {
    it("the first value after activation applies at once", () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        expect(email.queries.emailInfo$()).toMatchObject({ status: "pending", args: "a@x.com" });
        expect(email.queries.emailInfo.isDebouncing$()).toBe(false);
        expect(calls(queryFn)).toEqual(["a@x.com"]);
    });

    it("every other args change waits, restarted by each change; nothing flushes it early", async () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const states = record(email.queries.emailInfo$);
        await advance(LATENCY);

        email.set("b@x.com");
        await advance(DEBOUNCE - 1);
        email.set("c@x.com");
        // Reads and waits do not flush the timer.
        expect(email.isPending$()).toBe(true);
        void email.queries.emailInfo.whenSettled({ waitForDone: true });
        await advance(DEBOUNCE - 1);
        expect(calls(queryFn)).toEqual(["a@x.com"]);
        expect(email.queries.emailInfo$().args).toBe("a@x.com");
        await advance(1);
        expect(calls(queryFn)).toEqual(["a@x.com", "c@x.com"]);
        expect(email.queries.emailInfo$()).toMatchObject({ status: "pending", args: "c@x.com" });
        states.unsubscribe();
    });

    it("programmatic changes are delayed too", async () => {
        const { resource, queryFn } = emailResource();
        const form = emailForm(resource, "a@x.com");
        const states = record(form.fields.email.queries.emailInfo$);
        form.initialize({ state: { email: "b@x.com" } });
        expect(form.fields.email.queries.emailInfo.isDebouncing$()).toBe(true);
        await advance(DEBOUNCE);
        expect(calls(queryFn)).toEqual(["a@x.com", "b@x.com"]);
        states.unsubscribe();
    });

    it("a falsy key applies at once and cancels a pending timer", async () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const pending = record(email.isPending$);
        await advance(LATENCY);
        email.set("b@x.com");
        email.set("not an email");
        expect(email.queries.emailInfo$().status).toBe("idle");
        expect(email.queries.emailInfo.isDebouncing$()).toBe(false);
        await advance(DEBOUNCE);
        expect(calls(queryFn)).toEqual(["a@x.com"]);
        expect(pending.values).toEqual([true, false, true, false]);
        pending.unsubscribe();
    });

    it("the args after a falsy key are delayed", async () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource).fields;
        const states = record(email.queries.emailInfo$);
        email.set("a@x.com");
        expect(email.queries.emailInfo.isDebouncing$()).toBe(true);
        expect(email.queries.emailInfo$().status).toBe("idle");
        await advance(DEBOUNCE);
        expect(calls(queryFn)).toEqual(["a@x.com"]);
        expect(email.queries.emailInfo.isDebouncing$()).toBe(false);
        states.unsubscribe();
    });

    it("no timer starts when the new args key equals the tracked one; a pending one is cancelled", async () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const pending = record(email.isPending$);
        await advance(LATENCY);
        const timers = vi.getTimerCount();
        email.set("b@x.com");
        expect(vi.getTimerCount()).toBe(timers + 1);
        email.set("a@x.com");
        expect(vi.getTimerCount()).toBe(timers);
        expect(email.queries.emailInfo.isDebouncing$()).toBe(false);
        await advance(DEBOUNCE);
        expect(calls(queryFn)).toEqual(["a@x.com"]);
        expect(pending.values).toEqual([true, false, true, false]);
        pending.unsubscribe();
    });

    it("a deactivation clears the timer; a reactivation applies the current args at once", async () => {
        const { resource, queryFn } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        let states = record(email.queries.emailInfo$);
        await advance(LATENCY);
        email.set("b@x.com");
        states.unsubscribe();
        await advance(DEBOUNCE);
        expect(calls(queryFn)).toEqual(["a@x.com"]);

        states = record(email.queries.emailInfo$);
        expect(email.queries.emailInfo$()).toMatchObject({ status: "pending", dataSource: "none", args: "b@x.com" });
        expect(calls(queryFn)).toEqual(["a@x.com", "b@x.com"]);
        states.unsubscribe();
    });

    it("isDebouncing$ is the mismatch of the key's args and the clutch's; isPending$ includes it", async () => {
        const { resource } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const debouncing = record(email.queries.emailInfo.isDebouncing$);
        const pending = record(email.isPending$);
        await advance(LATENCY);
        email.set("b@x.com");
        await advance(DEBOUNCE);
        await advance(LATENCY);
        expect(debouncing.values).toEqual([false, true, false]);
        expect(pending.values).toEqual([true, false, true, false]);
        debouncing.unsubscribe();
        pending.unsubscribe();
    });

    it("a key bound with its own TKeyed key stops debouncing once applied", async () => {
        const { resource } = emailResource();
        const def = g({
            fields: {
                email: f({
                    schema: z.string(),
                    defaultValue: "",
                    queries: {
                        info: {
                            bind: ({ value$ }) => resource.bind(toKeyed(value$(), (email) => `email:${email}`)),
                            debounce: DEBOUNCE,
                        },
                    },
                }),
            },
        });
        const { email } = FormSignal.state(def, { state: { email: "a@x.com" } }).fields;
        const pending = record(email.isPending$);
        expect(email.queries.info.isDebouncing$()).toBe(false);
        email.set("b@x.com");
        expect(email.queries.info.isDebouncing$()).toBe(true);
        await advance(DEBOUNCE);
        expect(email.queries.info.isDebouncing$()).toBe(false);
        await advance(LATENCY);
        expect(email.isPending$()).toBe(false);
        pending.unsubscribe();
    });

    it("whenSettled({ waitForDone }) counts the debounce as in flight", async () => {
        const { resource } = emailResource();
        const { email } = emailForm(resource, "a@x.com").fields;
        const states = record(email.queries.emailInfo$);
        await advance(LATENCY);
        email.set("b@x.com");
        const done = vi.fn();
        void email.queries.emailInfo.whenSettled({ waitForDone: true }).then(done);
        await advance(DEBOUNCE + LATENCY - 1);
        expect(done).not.toHaveBeenCalled();
        await advance(1);
        expect(done).toHaveBeenCalledTimes(1);
        states.unsubscribe();
    });
});

describe("freshness: the Field rule gives no verdict on foreign data (F02)", () => {
    const messages = (form: ReturnType<typeof emailForm>) =>
        form.fields.email.issues$().map((issue) => `${issue.severity}: ${issue.message}`);

    it("neither while debouncing nor while the clutch shows the previous args' data", async () => {
        const { resource } = emailResource();
        const form = emailForm(resource, "taken@x.com");
        const issues = record(form.fields.email.issues$);
        await advance(LATENCY);
        expect(messages(form)).toEqual(["error: Email is taken"]);

        form.fields.email.set("free@x.com");
        expect(form.fields.email.queries.emailInfo.isDebouncing$()).toBe(true);
        expect(messages(form)).toEqual([]);

        await advance(DEBOUNCE);
        expect(form.fields.email.queries.emailInfo$()).toMatchObject({
            dataSource: "previous",
            data: { isValid: false },
        });
        expect(messages(form)).toEqual([]);

        await advance(LATENCY);
        expect(messages(form)).toEqual([]);
        expect(form.isValid$()).toBe(true);

        form.fields.email.set("boss@corp.com");
        await advance(DEBOUNCE + LATENCY);
        expect(messages(form)).toEqual(["warning: Corporate address"]);
        expect(issues.values.flat().filter((issue) => issue.message === "Email is taken")).toHaveLength(1);
        issues.unsubscribe();
    });

    it("a failed check is not 'no problems': the rule warns on the error of the new args", async () => {
        const { resource, failing } = emailResource();
        failing.add("down@x.com");
        const form = emailForm(resource, "taken@x.com");
        const issues = record(form.fields.email.issues$);
        await advance(LATENCY);
        expect(messages(form)).toEqual(["error: Email is taken"]);

        form.fields.email.set("down@x.com");
        await advance(DEBOUNCE);
        expect(messages(form)).toEqual([]);
        await advance(LATENCY);
        expect(form.fields.email.queries.emailInfo$()).toMatchObject({ status: "error", dataSource: "previous" });
        expect(messages(form)).toEqual(["warning: Could not check the email"]);
        issues.unsubscribe();

        // Without earlier data the failure is shown the same way.
        const fresh = emailForm(resource, "down@x.com");
        const freshIssues = record(fresh.fields.email.issues$);
        await advance(LATENCY);
        expect(fresh.fields.email.queries.emailInfo$()).toMatchObject({ status: "error", dataSource: "none" });
        expect(messages(fresh)).toEqual(["warning: Could not check the email"]);
        freshIssues.unsubscribe();
    });
});
