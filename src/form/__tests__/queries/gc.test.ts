// @vitest-environment node
/// <reference types="node" />
// Lifetime: an instance whose queries were hot is collected once nothing reads it; the resource
// cache and the devtools records do not hold it.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { z } from "zod";

import { SharedOptions } from "@/common/options/SharedOptions";
import type { IResource } from "@/query/types";

import { unstable_FormSignal as FormSignal } from "../../index";

import { emailResource, LATENCY, type EmailInfo } from "./helpers";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const f = FormSignal.field;
const g = FormSignal.group;

function definition(resource: IResource<string, EmailInfo>) {
    return g({
        fields: {
            email: f({
                schema: z.string(),
                defaultValue: "",
                queries: { info: { bind: ({ value$ }) => !!value$() && resource.bind(value$()), debounce: 10 } },
                validate: ({ queries, error }) => {
                    const info = queries.info$();
                    if (info.dataSource === "current" && !info.data.isValid) error("Taken");
                },
            }),
        },
        queries: { root: ({ fields }) => !!fields.email.value$() && resource.bind(`root-${fields.email.value$()}`) },
    });
}

async function isCollected(ref: WeakRef<object>): Promise<boolean> {
    for (let i = 0; i < 20 && ref.deref(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        gc();
    }
    return ref.deref() === undefined;
}

async function useAndDrop(resource: IResource<string, EmailInfo>): Promise<WeakRef<object>> {
    const form = FormSignal.state(definition(resource), { state: { email: "a@x.com" } });
    const subscription = form.state$.obs.subscribe();
    const issues = form.issues$.obs.subscribe();
    await new Promise((resolve) => setTimeout(resolve, LATENCY + 10));
    form.fields.email.set("taken@x.com");
    form.fields.email.queries.info.isDebouncing$.peek();
    issues.unsubscribe();
    subscription.unsubscribe();
    form.isPending$.peek();
    return new WeakRef(form);
}

describe("query lifetime and GC", () => {
    afterEach(() => {
        SharedOptions.DEVTOOLS = null;
    });

    it("an instance whose queries were hot is collected; the resource keeps its entries", async () => {
        const { resource } = emailResource();
        expect(await isCollected(await useAndDrop(resource))).toBe(true);
        expect([...resource.getEntries()].length).toBeGreaterThan(0);
    });

    it("devtools records of the query state do not hold the instance", async () => {
        SharedOptions.DEVTOOLS = { state: () => () => {} };
        const { resource } = emailResource();
        expect(await isCollected(await useAndDrop(resource))).toBe(true);
    });
});
