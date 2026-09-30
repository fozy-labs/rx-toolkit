// Retry and entryKey of the Submit section: the retry criterion (F43), holding the command entry
// (F06), one clutch per command (F44) and the entryKey rules (F29).
import { z } from "zod";

import { toKeyed } from "@/query/lib/toKeyed";

import { unstable_FormSignal as FormSignal } from "../../index";

import { advance, flush, manualCommand } from "./helpers";

const f = FormSignal.field;
const g = FormSignal.group;

interface Profile {
    email: string;
}

function profile(options: { retentionTime?: number } = {}) {
    const save = manualCommand<Profile>(options);
    const handler = vi.fn(({ parsed$ }: { parsed$: () => { value: Profile } }) => save.command.bind(parsed$().value));
    const def = g({
        fields: { email: f({ schema: z.string().trim(), defaultValue: "" }) },
        submit: (ctx) => handler(ctx),
    });
    const form = FormSignal.state(def, { state: { email: "ann@x.com" } });
    return { ...save, handler, form };
}

/** Submits and settles the command run the attempt starts. */
async function settle(form: { submit: (options?: { force?: boolean }) => Promise<boolean> }, act: () => void) {
    const result = form.submit();
    await flush();
    act();
    return result;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("retry", () => {
    it("the same command, entryKey and args with the entry in error: retry() keeps the request id", async () => {
        const { form, runs, handler } = profile();
        const sub = form.submission$.obs.subscribe();
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        expect(form.submission$()).toMatchObject({ status: "error" });

        const result = form.submit();
        await flush();
        // the entry is pending again, keeping the failure it retries
        expect(form.submission$()).toMatchObject({ status: "pending", hasError: true });
        expect(runs).toHaveLength(2);
        expect(runs[1].requestId).toBe(runs[0].requestId);
        runs[1].resolve({ id: "1" });
        expect(await result).toBe(true);
        // the handler runs on every attempt, a retry included
        expect(handler).toHaveBeenCalledTimes(2);
        expect(form.submitCount$()).toBe(2);
        sub.unsubscribe();
    });

    it("other args: trigger() with the same entryKey and a new request id", async () => {
        const { form, runs, command } = profile();
        const sub = form.submission$.obs.subscribe();
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        const entryKey = form.entryKey;
        form.fields.email.set("bob@x.com");
        const result = settle(form, () => runs[1].resolve({ id: "1" }));
        await flush();
        expect(runs[1].args).toEqual({ email: "bob@x.com" });
        expect(runs[1].requestId).not.toBe(runs[0].requestId);
        expect(await result).toBe(true);
        expect(command.getEntry(entryKey)?.keyedArgs.value).toEqual({ email: "bob@x.com" });
        sub.unsubscribe();
    });

    it("force: trigger() even when the request matches", async () => {
        const { form, runs } = profile();
        const sub = form.submission$.obs.subscribe();
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        const result = form.submit({ force: true });
        await flush();
        expect(form.submission$()).toMatchObject({ status: "pending", hasError: false });
        expect(runs[1].requestId).not.toBe(runs[0].requestId);
        runs[1].resolve({ id: "1" });
        expect(await result).toBe(true);
        sub.unsubscribe();
    });

    it("F06: without any UI and with retention 0, the failed entry is gone after a tick; the next submit triggers it anew and succeeds", async () => {
        const { form, runs, command } = profile({ retentionTime: 0 });
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        const entryKey = form.entryKey;
        expect(command.getEntry(entryKey)).not.toBeNull();
        await advance(1);
        expect(command.getEntry(entryKey)).toBeNull();

        const result = settle(form, () => runs[1].resolve({ id: "1" }));
        await flush();
        expect(runs[1].requestId).not.toBe(runs[0].requestId);
        expect(form.entryKey).toBe(entryKey);
        expect(await result).toBe(true);
        expect(form.status$()).toBe("success");
    });

    it("a retry takes its own snapshot (F43): the base becomes what the retry sent", async () => {
        const { form, runs } = profile();
        const sub = form.submission$.obs.subscribe();
        form.fields.email.set("bob@x.com ");
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        // the same parsed value, another input: the same request, so a retry
        form.fields.email.set("bob@x.com");
        expect(await settle(form, () => runs[1].resolve({ id: "1" }))).toBe(true);
        expect(runs[1].requestId).toBe(runs[0].requestId);
        expect(form.fields.email.value$()).toBe("bob@x.com");
        expect(form.fields.email.isDirty$()).toBe(false);
        expect(form.fields.email.isModified$()).toBe(false);
        sub.unsubscribe();
    });

    it("a handler that reads more than parsed: the args decide, not the value", async () => {
        const save = manualCommand<{ email: string; token: string }>();
        let token = "t1";
        const def = g({
            fields: { email: f({ schema: z.string(), defaultValue: "a@x.com" }) },
            submit: ({ parsed$ }) => save.command.bind({ ...parsed$().value, token }),
        });
        const form = FormSignal.state(def);
        const sub = form.submission$.obs.subscribe();
        await settle(form, () => save.runs[0].reject(new Error("Expired")));
        token = "t2";
        await settle(form, () => save.runs[1].resolve({ id: "1" }));
        expect(save.runs[1].args.token).toBe("t2");
        expect(save.runs[1].requestId).not.toBe(save.runs[0].requestId);
        sub.unsubscribe();
    });

    it("another file in the args: trigger() sends the new file, not a retry of the old one", async () => {
        const save = manualCommand<{ avatar: File | null }>();
        const def = g({
            fields: { avatar: f({ schema: z.instanceof(File).nullable(), defaultValue: null }) },
            submit: ({ parsed$ }) => save.command.bind(parsed$().value),
        });
        const form = FormSignal.state(def);
        const sub = form.submission$.obs.subscribe();
        const next = new File(["b"], "b.png");
        form.fields.avatar.set(new File(["a"], "a.png"));
        await settle(form, () => save.runs[0].reject(new Error("Timeout")));
        form.fields.avatar.set(next);
        await settle(form, () => save.runs[1].resolve({ id: "1" }));
        expect(save.runs[1].args.avatar).toBe(next);
        expect(save.runs[1].requestId).not.toBe(save.runs[0].requestId);
        sub.unsubscribe();
    });
});

describe("one clutch per command", () => {
    it("submission$ mirrors the clutch of the command the last attempt used", async () => {
        const first = manualCommand<{ email: string }>();
        const second = manualCommand<{ email: string }>();
        const def = g({
            fields: {
                email: f({ schema: z.string(), defaultValue: "a@x.com" }),
                draft: f({ schema: z.boolean(), defaultValue: true }),
            },
            submit: ({ fields, parsed$ }) =>
                (fields.draft.value$() ? first : second).command.bind({ email: parsed$().value.email }),
        });
        const form = FormSignal.state(def);
        await settle(form, () => first.runs[0].resolve({ id: "draft" }));
        expect(form.submission$()).toMatchObject({ status: "success", data: { id: "draft" } });
        form.fields.draft.set(false);
        const result = form.submit();
        await flush();
        expect(form.submission$()).toMatchObject({ status: "pending" });
        second.runs[0].reject(new Error("Nope"));
        await result;
        expect(form.submission$()).toMatchObject({ status: "error" });
        // the failed request is of the second command: a switch back is a new attempt
        form.fields.draft.set(true);
        await settle(form, () => first.runs[1].resolve({ id: "draft-2" }));
        expect(form.submission$()).toMatchObject({ status: "success", data: { id: "draft-2" } });
    });
});

describe("entryKey", () => {
    it("is minted lazily and kept by a failed attempt; a success rotates it for the next trigger()", async () => {
        const { form, runs, command } = profile();
        const minted = form.entryKey;
        expect(form.entryKey).toBe(minted);
        await settle(form, () => runs[0].reject(new Error("Timeout")));
        expect(form.entryKey).toBe(minted);
        form.fields.email.set("bob@x.com");
        await settle(form, () => runs[1].resolve({ id: "1" }));
        // still the key of the entry submission$ mirrors
        expect(form.entryKey).toBe(minted);
        expect(form.submission$()).toMatchObject({ status: "success" });

        form.fields.email.set("eve@x.com");
        const result = form.submit();
        await flush();
        const rotated = form.entryKey;
        expect(rotated).not.toBe(minted);
        expect(command.getEntry(rotated)?.keyedArgs.value).toEqual({ email: "eve@x.com" });
        runs[2].resolve({ id: "2" });
        await result;
    });

    it("never rotates during a flight: a reset waits for the phase to become idle", async () => {
        const { form, runs } = profile();
        const result = form.submit();
        await flush();
        const flying = form.entryKey;
        form.reset();
        expect(form.entryKey).toBe(flying);
        runs[0].resolve({ id: "1" });
        await result;
        expect(form.entryKey).not.toBe(flying);
        expect(form.submission$()).toBeNull();
    });

    it("follows CommandClutch: the keyed args key, then bound.entryKey, then the default key", async () => {
        const save = manualCommand<{ email: string }>();
        let mode: "keyed" | "bound" | "default" = "keyed";
        const def = g({
            fields: { email: f({ schema: z.string(), defaultValue: "a@x.com" }) },
            submit: ({ parsed$ }) => {
                const args = parsed$().value;
                if (mode === "keyed")
                    return save.command.bind(
                        toKeyed(args, () => "keyed-1"),
                        "ignored",
                    );
                if (mode === "bound") return save.command.bind(args, "bound-1");
                return save.command.bind(args);
            },
        });
        const form = FormSignal.state(def);
        await settle(form, () => save.runs[0].resolve({ id: "1" }));
        expect(form.entryKey).toBe("keyed-1");
        expect(save.command.getEntry("keyed-1")).not.toBeNull();
        mode = "bound";
        await settle(form, () => save.runs[1].resolve({ id: "2" }));
        expect(form.entryKey).toBe("bound-1");
        mode = "default";
        await settle(form, () => save.runs[2].resolve({ id: "3" }));
        expect(["keyed-1", "bound-1"]).not.toContain(form.entryKey);
        expect(save.command.getEntry(form.entryKey)).not.toBeNull();
    });
});
