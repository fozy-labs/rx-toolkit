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

    it("lists: data deferred by keepDirtyLists before the submit does not outlive its commit", async () => {
        const { form, last } = contacts();
        form.fields.phones.push({ number: "3" });
        // Server data for a dirty structure waits for reset().
        form.initialize({ state: { phones: [{ number: "server" }] } }, { keepDirtyValues: true });
        const result = form.submit();
        await flush();
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        expect(form.fields.phones.isDirty$()).toBe(false);
        // reset() returns to the sent rows, the newer base.
        form.reset();
        expect(form.fields.phones.value$()).toEqual([{ number: "1" }, { number: "2" }, { number: "3" }]);
    });

    it("lists: data deferred by keepDirtyLists during the flight survives, since the commit is skipped", async () => {
        const { form, last } = contacts();
        form.fields.phones.push({ number: "3" });
        const result = form.submit();
        await flush();
        form.initialize({ state: { phones: [{ number: "server" }] } }, { keepDirtyValues: true });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);
        // The newer base wins over what was sent: nothing is committed.
        expect(form.fields.phones.isDirty$()).toBe(true);
        form.reset();
        expect(form.fields.phones.value$()).toEqual([{ number: "server" }]);
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

    it("a nested initialize() cancels _commit() for its subtree only — the other sent fields still become the base", async () => {
        const save = manualCommand<unknown>();
        const def = g({
            fields: {
                name: text(),
                address: g({ fields: { city: text() } }),
            },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def, { state: { name: "Ann", address: { city: "Oslo" } } });
        form.fields.name.set("Bob");
        const result = form.submit();
        await flush();
        // e.g. an address autocomplete fills the sub-form while the save is in flight
        form.fields.address.initialize({ state: { city: "Rome" } });
        save.last().resolve({ id: "1" });
        expect(await result).toBe(true);

        // "Bob" was sent and saved: it becomes the base. "Rome" was written by initialize:
        // it wins over the sent "Oslo" — and is itself the new base of `city`.
        expect(form.fields.name.value$()).toBe("Bob");
        expect(form.fields.name.isDirty$()).toBe(false);
        expect(form.fields.address.fields.city.value$()).toBe("Rome");
        expect(form.fields.address.fields.city.isDirty$()).toBe(false);
        form.fields.address.fields.city.reset();
        expect(form.fields.address.fields.city.value$()).toBe("Rome");
        expect(form.isDirty$()).toBe(false);
        expect(form.status$()).toBe("success");
    });

    it("initialize() of a list row during the flight skips only that row's commit", async () => {
        const { form, last } = contacts();
        const phones = form.fields.phones;
        const [one] = phones.items$();
        phones.items$()[1].fields.number.set("20");
        const result = form.submit();
        await flush();
        // Re-base the first row while the save is in flight.
        one.initialize({ state: { number: "9" } });
        last().resolve({ id: "1" });
        expect(await result).toBe(true);

        // The re-based row keeps what initialize wrote; the other row's sent value is its base.
        expect(phones.items$()[0].fields.number.value$()).toBe("9");
        expect(phones.items$()[0].fields.number.isDirty$()).toBe(false);
        const second = phones.items$()[1];
        expect(second.fields.number.value$()).toBe("20");
        expect(second.fields.number.isDirty$()).toBe(false);
        second.fields.number.reset();
        expect(second.fields.number.value$()).toBe("20");
        phones.items$()[0].fields.number.reset();
        expect(phones.items$()[0].fields.number.value$()).toBe("9");
        expect(form.isDirty$()).toBe(false);
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

    it.each([
        ["reset()", (form: ReturnType<typeof checked>["form"]) => form.reset()],
        ["initialize({ state })", (form: ReturnType<typeof checked>["form"]) => form.initialize({ state: {} })],
    ])(
        "%s ends the attempt synchronously; a submit() in the same tick is a new attempt the old one does not touch",
        async (_, supersede) => {
            const { form, handler, runs } = checked();
            const first = form.submit();
            await flush();

            supersede(form);
            expect(form.isSubmitting$()).toBe(false);
            expect(form.canSubmit$()).toBe(true);
            const next = form.submit();
            expect(form.submitAttempts$()).toBe(2);
            expect(form.isSubmitting$()).toBe(true);

            expect(await first).toBe(false);
            await flush();
            // The old attempt's end leaves the new one in its phase.
            expect(form.isSubmitting$()).toBe(true);
            await advance(LATENCY);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(runs).toHaveLength(1);
            runs[0].resolve({ id: "1" });
            expect(await next).toBe(true);
            expect(form.status$()).toBe("success");
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
