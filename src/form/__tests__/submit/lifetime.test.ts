// The Lifetime contract of the submit: the "wait" subscription, holding the command entry, and
// the attempt outliving its UI.
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";
import { emailResource, LATENCY } from "../queries/helpers";

import { advance, flush, manualCommand } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

function checkedEmail() {
    const { resource, queryFn: check } = emailResource();
    const save = manualCommand<{ email: string }>();
    const def = g({
        fields: {
            email: f({
                schema: z.string(),
                defaultValue: "ann@x.com",
                queries: { info: ({ value$ }) => resource.bind(value$()) },
                validate: ({ queries, error }) => {
                    const info = queries.info$();
                    if (info.dataSource === "current" && !info.data.isValid) error("Email is taken");
                },
            }),
        },
        submit: ({ parsed$ }) => save.command.bind(parsed$().value),
    });
    return { ...save, check, resource, form: FormSignal.state(def) };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("submit lifetime", () => {
    it('"wait" activates a query of a field nobody subscribes to, and releases it after the preparing phase', async () => {
        const { form, check, queryFn, last, resource } = checkedEmail();
        const result = form.submit();
        await flush();
        expect(check.mock.calls.map(([email]) => email)).toEqual(["ann@x.com"]);
        expect(queryFn).not.toHaveBeenCalled();
        await advance(LATENCY);
        expect(queryFn).toHaveBeenCalledTimes(1);
        // the preparing phase is over: nothing holds the query any more
        expect(resource.getEntry("ann@x.com")?.isMelting).toBe(true);
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
    });

    it("all subscribers gone during the preparing phase: the attempt finishes without errors", async () => {
        const errors = vi.spyOn(console, "error");
        const { form, last } = checkedEmail();
        const ui = [form.state$.obs.subscribe(), form.submission$.obs.subscribe(), form.fields.email$.obs.subscribe()];
        const result = form.submit();
        await flush();
        for (const sub of ui) sub.unsubscribe();
        await advance(LATENCY);
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.status$()).toBe("success");
        expect(errors).not.toHaveBeenCalled();
    });

    it("all subscribers gone during the flight: the attempt runs to its settle and is applied", async () => {
        const errors = vi.spyOn(console, "error");
        const { form, last } = checkedEmail();
        form.fields.email.set("bob@x.com");
        const ui = [form.state$.obs.subscribe(), form.submission$.obs.subscribe()];
        const result = form.submit();
        await advance(LATENCY);
        expect(form.isSubmitting$()).toBe(true);
        for (const sub of ui) sub.unsubscribe();
        await advance(LATENCY);
        last().reject({ issues: [{ message: "Blocked", path: ["email"] }] });
        expect(await result).toBe(false);
        expect(form.fields.email.issues$().map((issue) => issue.message)).toEqual(["Blocked"]);
        expect(errors).not.toHaveBeenCalled();
    });

    it("the root holds the command entry while an attempt runs, a retry included", async () => {
        const { form, runs, command } = checkedEmail();
        let result = form.submit();
        await advance(LATENCY);
        const entryKey = form.entryKey;
        await advance(LATENCY);
        // the first run holds its entry until it settles
        expect(command.getEntry(entryKey)?.isMelting).toBe(false);
        runs[0].reject(new Error("Timeout"));
        await result;
        // no UI: after the settle the entry melts with retention 0; a submit in the same tick retries it
        result = form.submit();
        await advance(LATENCY);
        expect(runs).toHaveLength(2);
        expect(runs[1].requestId).toBe(runs[0].requestId);
        expect(command.getEntry(entryKey)?.isMelting).toBe(false);
        runs[1].resolve({ id: "1" });
        expect(await result).toBe(true);
        await advance(1);
        expect(command.getEntry(entryKey)).toBeNull();
    });
});
