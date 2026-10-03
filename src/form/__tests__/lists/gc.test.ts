// @vitest-environment node
/// <reference types="node" />
// Lifetime of list rows: a removed row needs no disposal. Once a row leaves both the list and the
// structure base, nothing of the instance holds it: no subscription, no registry entry.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { z } from "zod";

import { SharedOptions } from "@/common/options/SharedOptions";

import { unstable_FormSignal as FormSignal } from "../../index";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const f = FormSignal.field;
const g = FormSignal.group;
const l = FormSignal.list;

const def = g({
    fields: {
        phones: l({
            item: g({
                fields: { number: f({ schema: z.string().min(1), defaultValue: "" }) },
                validate: ({ fields, warn }) => void (fields.number.value$() === "0" && warn("Zero")),
            }),
            validate: ({ items$, warn }) => void (items$().length > 3 && warn("Many")),
        }),
    },
    validate: ({ fields, error }) => {
        for (const row of fields.phones.items$()) if (!row.fields.number.value$()) error(row.fields.number, "Empty");
    },
});

async function isCollected(refs: ReadonlyArray<WeakRef<object>>): Promise<boolean> {
    for (let i = 0; i < 20 && refs.some((ref) => ref.deref()); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc();
    }
    return refs.every((ref) => ref.deref() === undefined);
}

/** Pushes and removes rows `times` times; returns weak references to the removed rows. */
function churn(form: ReturnType<typeof create>, times: number): WeakRef<object>[] {
    const list = form.fields.phones;
    const refs: WeakRef<object>[] = [];
    for (let i = 0; i < times; i++) {
        const row = list.push({ number: String(i) });
        row.fields.number.set("");
        row.markTouched();
        form.issues$();
        refs.push(new WeakRef(row));
        list.remove(i % 2 ? row : row.key);
    }
    return refs;
}

function create() {
    return FormSignal.state(def, { state: { phones: [{ number: "base" }] } });
}

/** Reads the aggregates once, so every cold computation drops the rows it held last. */
function readAll(form: ReturnType<typeof create>) {
    form.state$();
    form.value$();
    form.parsed$();
    form.issues$();
    form.visibleErrors$();
    form.fields.phones.state$();
}

describe("lifetime of list rows", () => {
    afterEach(() => {
        SharedOptions.DEVTOOLS = null;
    });

    it("repeated push / remove under a subscription leaves nothing held", async () => {
        const form = create();
        const subscriptions = [form.state$.obs.subscribe(), form.issues$.obs.subscribe(), form.value$.obs.subscribe()];
        const refs = churn(form, 20);
        expect(await isCollected(refs)).toBe(true);
        subscriptions.forEach((subscription) => subscription.unsubscribe());
    });

    it("repeated push / remove with cold reads leaves nothing held", async () => {
        const form = create();
        const refs = churn(form, 20);
        readAll(form);
        expect(await isCollected(refs)).toBe(true);
    });

    it("clear() drops the rows that were never in the base", async () => {
        const form = create();
        const subscription = form.state$.obs.subscribe();
        const list = form.fields.phones;
        const refs = [list.push(), list.push(), list.insert(0)].map((row) => new WeakRef(row));
        list.clear();
        expect(await isCollected(refs)).toBe(true);
        subscription.unsubscribe();
    });

    it("a removed base row stays for reset() until initialize() takes it out of the base", async () => {
        const form = create();
        const list = form.fields.phones;
        const ref = new WeakRef(list.items$()[0]);
        list.remove(0);
        readAll(form);
        expect(await isCollected([ref])).toBe(false);
        form.initialize({ state: { phones: [] } });
        readAll(form);
        expect(await isCollected([ref])).toBe(true);
    });

    it("devtools records do not hold removed rows", async () => {
        SharedOptions.DEVTOOLS = { state: () => () => {} };
        const form = create();
        const refs = churn(form, 5);
        readAll(form);
        expect(await isCollected(refs)).toBe(true);
    });

    it("an unreferenced instance with lists is collected", async () => {
        const use = () => {
            const form = create();
            const subscription = form.state$.obs.subscribe();
            churn(form, 3);
            form.fields.phones.move(0, 0);
            form.fields.phones.clear();
            subscription.unsubscribe();
            form.reset();
            return new WeakRef(form);
        };
        expect(await isCollected([use()])).toBe(true);
    });
});
