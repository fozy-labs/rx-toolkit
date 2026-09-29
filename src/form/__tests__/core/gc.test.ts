// @vitest-environment node
/// <reference types="node" />
// Lifetime: nothing outside the instance holds it, so an unreferenced instance is collected.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { z } from "zod";

import { SharedOptions } from "@/common/options/SharedOptions";

import { unstable_FormSignal as FormSignal } from "../../index";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const f = FormSignal.field;
const g = FormSignal.group;

const def = g({
    fields: {
        a: f({
            schema: z.string().min(1),
            defaultValue: "",
            validate: ({ value$, warn }) => void (value$() || warn("W")),
        }),
        inner: g({ fields: { b: f({ schema: z.string(), defaultValue: "" }) } }),
    },
    computed: { upper: ({ fields }) => fields.a.value$().toUpperCase() },
    disabled: { inner: ({ fields }) => fields.a.value$() === "off" },
    validate: ({ fields, error }) => void (fields.a.value$() === "x" && error("X")),
});

async function isCollected(ref: WeakRef<object>): Promise<boolean> {
    for (let i = 0; i < 20 && ref.deref(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc();
    }
    return ref.deref() === undefined;
}

function useAndDrop(): WeakRef<object> {
    const form = FormSignal.state(def, { state: { a: "start" } });
    form.state$();
    const subscription = form.state$.obs.subscribe();
    const issues = form.issues$.obs.subscribe();
    form.fields.a.set("x");
    form.fields.inner.fields.b.set("y");
    form.markTouched();
    form.computed.upper$();
    issues.unsubscribe();
    subscription.unsubscribe();
    form.reset();
    return new WeakRef(form);
}

describe("lifetime", () => {
    it("an unreferenced instance is collected after it was read and subscribed", async () => {
        expect(await isCollected(useAndDrop())).toBe(true);
    });

    it("devtools records do not hold the instance", async () => {
        SharedOptions.DEVTOOLS = { state: () => () => {} };
        expect(await isCollected(useAndDrop())).toBe(true);
    });
});
