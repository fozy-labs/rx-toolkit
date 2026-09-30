// _commit() after a successful submit, and a root reset / initialize during the flight (F07, F51),
// plus an entry removed mid-flight (F66).
import { z } from "zod";

import { unstable_FormSignal as FormSignal } from "../../index";
import { emailResource, LATENCY } from "../queries/helpers";

import { advance, flush, manualCommand } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const text = (defaultValue = "") => f({ schema: z.string(), defaultValue });

function contacts() {
    const save = manualCommand<unknown>();
    const def = g({
        fields: {
            title: text(),
            phones: l({ item: g({ fields: { number: text() } }) }),
        },
        submit: ({ parsed$ }) => save.command.bind(parsed$().value),
    });
    const form = FormSignal.state(def, { state: { title: "Home", phones: [{ number: "1" }, { number: "2" }] } });
    return { ...save, form };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("_commit()", () => {
    it("the base becomes what was sent; touched stays; an edit made during the flight stays a draft", async () => {
        const { form, last } = contacts();
        form.fields.title.set("Office");
        const result = form.submit();
        await flush();
        form.fields.phones.items$()[0].fields.number.set("10");
        last().resolve({ id: "1" });
        expect(await result).toBe(true);

        expect(form.fields.title.isDirty$()).toBe(false);
        expect(form.fields.title.isModified$()).toBe(false);
        expect(form.fields.title.isTouched$()).toBe(true);
        const [first] = form.fields.phones.items$();
        expect(first.fields.number.value$()).toBe("10");
        expect(first.fields.number.isDirty$()).toBe(true);
        first.fields.number.reset();
        expect(first.fields.number.value$()).toBe("1");
        form.fields.title.reset();
        expect(form.fields.title.value$()).toBe("Office");
    });

    it("lists: the sent order is the base; rows removed during the flight stay in it, rows added stay a draft", async () => {
        const { form, last } = contacts();
        const phones = form.fields.phones;
        const [one, two] = phones.items$();
        const three = phones.push({ number: "3" });
        phones.swap(one, two);
        const result = form.submit();
        await flush();
        expect(last().args).toMatchObject({ phones: [{ number: "2" }, { number: "1" }, { number: "3" }] });
        // during the flight: remove a sent row, add a new one
        phones.remove(three);
        const four = phones.push({ number: "4" });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);

        expect(phones.items$().map((item) => item.key)).toEqual([two.key, one.key, four.key]);
        expect(phones.isDirty$()).toBe(true);
        phones.reset();
        // the base is what was sent: the removed row is back, the added one is gone
        expect(phones.items$().map((item) => item.key)).toEqual([two.key, one.key, three.key]);
        expect(phones.items$()[2]).toBe(three);
        expect(phones.value$()).toEqual([{ number: "2" }, { number: "1" }, { number: "3" }]);
        expect(phones.isDirty$()).toBe(false);
    });

    it("a disabled child is not sent and not committed", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: { company: f({ schema: z.boolean(), defaultValue: false }), vatId: text() },
            disabled: { vatId: ({ fields }) => !fields.company.value$() },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def);
        form.fields.vatId.set("DE1");
        const result = form.submit();
        await flush();
        expect(save.last().args).toEqual({ company: false });
        save.last().resolve({ id: "1" });
        await result;
        expect(form.fields.vatId.isDirty$()).toBe(true);
    });
});

describe("a root reset / initialize during the flight", () => {
    it("reset(): _commit() applies; issues and outcome do not; the submit state resets once idle", async () => {
        const { form, last } = contacts();
        form.fields.title.set("Office");
        const result = form.submit();
        await flush();
        form.reset();
        expect(form.fields.title.value$()).toBe("Home");
        expect(form.isSubmitting$()).toBe(true);
        last().resolve({ id: "1" });
        // submit() resolves by the command result
        expect(await result).toBe(true);
        expect(form.fields.title.value$()).toBe("Office");
        expect(form.fields.title.isDirty$()).toBe(false);
        expect(form.status$()).toBe("idle");
        expect(form.submission$()).toBeNull();
    });

    it("reset() before a failure: no server issues, no outcome, and the failed attempt is dropped", async () => {
        const { form, runs } = contacts();
        const sub = form.submission$.obs.subscribe();
        const result = form.submit();
        await flush();
        form.reset();
        runs[0].reject(new Error("Conflict"));
        expect(await result).toBe(false);
        expect(form.issues$()).toEqual([]);
        expect(form.status$()).toBe("idle");
        // the same request again: a new trigger, not a retry
        const next = form.submit();
        await flush();
        expect(runs[1].requestId).not.toBe(runs[0].requestId);
        runs[1].resolve({ id: "1" });
        await next;
        sub.unsubscribe();
    });

    it("initialize(): _commit() is cancelled, the new base wins", async () => {
        const { form, last } = contacts();
        form.fields.title.set("Office");
        const result = form.submit();
        await flush();
        form.initialize({ state: { title: "Loaded" } });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.fields.title.value$()).toBe("Loaded");
        expect(form.fields.title.isDirty$()).toBe(false);
        expect(form.status$()).toBe("idle");
    });

    it("initialize({ state }, { keepDirtyValues }): _commit() is cancelled, the outcome applies", async () => {
        const { form, last } = contacts();
        form.fields.title.set("Office");
        const result = form.submit();
        await flush();
        form.initialize({ state: { title: "Loaded" } }, { keepDirtyValues: true });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.fields.title.value$()).toBe("Office");
        form.fields.title.reset();
        expect(form.fields.title.value$()).toBe("Loaded");
        expect(form.status$()).toBe("success");
    });

    it("a nested initialize() cancels _commit() too: it wrote a base", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: { address: g({ fields: { city: text() } }) },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def);
        form.fields.address.fields.city.set("Oslo");
        const result = form.submit();
        await flush();
        form.fields.address.initialize({ state: { city: "Bergen" } });
        save.last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.fields.address.fields.city.value$()).toBe("Bergen");
        expect(form.status$()).toBe("success");
    });

    it("initialize({ context }) touches nothing of the attempt", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: { title: text() },
            context: FormSignal.context<{ id: string }>(),
            submit: ({ parsed$, context$ }) => save.command.bind({ ...parsed$().value, id: context$().id }),
        });
        const form = FormSignal.state(def, { context: { id: "1" } });
        form.fields.title.set("Office");
        const result = form.submit();
        await flush();
        form.initialize({ context: { id: "2" } });
        save.last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.fields.title.isDirty$()).toBe(false);
        expect(form.status$()).toBe("success");
    });
});

describe("a root reset / initialize while the attempt waits for queries", () => {
    /** A form whose `email` query keeps the attempt in the preparing phase for `LATENCY` ms. */
    function checked() {
        const { resource } = emailResource();
        const save = manualCommand<unknown>();
        const handler = vi.fn(({ parsed$ }: { parsed$: () => { value: unknown } }) =>
            save.command.bind(parsed$().value),
        );
        const def = g({
            fields: {
                email: f({
                    schema: z.string(),
                    defaultValue: "",
                    queries: { info: ({ value$ }) => resource.bind(value$()) },
                }),
            },
            submit: handler as never,
        });
        const form = FormSignal.state(def, { state: { email: "ann@x.com" } });
        form.fields.email.set("bob@x.com");
        return { ...save, handler, form };
    }

    it.each(["reset", "initialize"] as const)(
        "%s(): the attempt stops at once — no handler, no command, false; a new submit() goes through",
        async (method) => {
            const { form, handler, queryFn, runs } = checked();
            const settled = vi.fn();
            void form.submit().then(settled);
            await flush();
            expect(form.isSubmitting$()).toBe(true);

            form[method]();
            await flush();
            // Not held until the queries settle.
            expect(settled).toHaveBeenCalledWith(false);
            expect(form.isSubmitting$()).toBe(false);
            expect(form.status$()).toBe("idle");
            await advance(LATENCY * 2);
            expect(handler).not.toHaveBeenCalled();
            expect(queryFn).not.toHaveBeenCalled();
            expect(form.submitCount$()).toBe(0);

            const next = form.submit();
            await advance(LATENCY);
            expect(runs).toHaveLength(1);
            runs[0].resolve({ id: "1" });
            expect(await next).toBe(true);
        },
    );
});

describe("the command entry removed mid-flight (F66)", () => {
    it("resetAll() during the flight: the attempt is aborted — false, no issues, the status stays", async () => {
        const { form, api } = contacts();
        const result = form.submit();
        await flush();
        api.resetAll();
        expect(await result).toBe(false);
        expect(form.issues$()).toEqual([]);
        expect(form.status$()).toBe("idle");
        expect(form.isSubmitting$()).toBe(false);
    });

    it("an entry removed during a retry aborts it too", async () => {
        const { form, api, runs } = contacts();
        const sub = form.submission$.obs.subscribe();
        const first = form.submit();
        await flush();
        runs[0].reject(new Error("Timeout"));
        await first;
        expect(form.status$()).toBe("error");
        const retry = form.submit();
        await flush();
        expect(runs).toHaveLength(2);
        api.resetAll();
        expect(await retry).toBe(false);
        expect(form.issues$()).toEqual([]);
        expect(form.status$()).toBe("error");
        sub.unsubscribe();
    });
});
