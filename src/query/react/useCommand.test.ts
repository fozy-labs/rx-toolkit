import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TCommandAgentState, TTriggerPromise } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

type Trigger<TArgs, TData> = (args: TArgs) => TTriggerPromise<TData>;

interface Captured<TArgs, TData> {
    trigger: Trigger<TArgs, TData>;
    state: TCommandAgentState<TArgs, TData>;
    /** Every trigger reference seen across renders (identity check). */
    triggers: Array<Trigger<TArgs, TData>>;
    /** Re-render the probe, optionally with a different bound key. */
    rerender: (newKey?: string) => void;
}

/** Render a probe component around useCommand and expose the live tuple. */
function setup<TArgs, TData>(
    useCommand: (key?: string) => [Trigger<TArgs, TData>, TCommandAgentState<TArgs, TData>],
    key?: string,
): Captured<TArgs, TData> {
    const captured = {} as Captured<TArgs, TData>;

    function Probe({ cmdKey }: { cmdKey?: string }) {
        const [trigger, state] = useCommand(cmdKey);
        captured.trigger = trigger;
        captured.state = state;
        captured.triggers.push(trigger);
        return null;
    }

    captured.triggers = [];
    const view = render(h(Probe, { cmdKey: key }));
    captured.rerender = (newKey?: string) => view.rerender(h(Probe, { cmdKey: newKey ?? key }));
    return captured;
}

// ==================== Tests ====================

describe("useCommand", () => {
    it("starts idle; trigger resolves with a success envelope and state reaches success", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<string, string>({
            queryFn: async (args) => `result-${args}`,
        });

        const c = setup(command.useCommand);
        expect(c.state.status).toBe("idle");

        let result: Awaited<ReturnType<typeof c.trigger>> | undefined;
        await act(async () => {
            result = await c.trigger("x");
            await flushMicrotasks();
        });

        expect(result).toEqual({ status: "success", data: "result-x" });
        expect(c.state.status).toBe("success");
        expect(c.state.data).toBe("result-x");
    });

    it("trigger resolves with an error envelope carrying the mapError-normalized error", async () => {
        class NetError extends Error {}
        const api = createApi({
            plugins: [reactHooksPlugin()],
            mapError: (error) => (error instanceof NetError ? error : new NetError(String(error))),
        });
        const command = api.createCommand<string, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        const c = setup(command.useCommand);

        let result: Awaited<ReturnType<typeof c.trigger>> | undefined;
        await act(async () => {
            // No try/catch — the envelope promise never rejects.
            result = await c.trigger("x");
            await flushMicrotasks();
        });

        expect(result?.status).toBe("error");
        expect(result?.error).toBeInstanceOf(NetError);
        expect(c.state.status).toBe("error");
        expect(c.state.error).toBe(result?.error);
    });

    it("unwrap() exposes the raw throwing promise", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const err = new Error("boom");
        const command = api.createCommand<string, string>({
            queryFn: async () => {
                throw err;
            },
        });

        const c = setup(command.useCommand);

        let caught: unknown;
        await act(async () => {
            try {
                await c.trigger("x").unwrap();
            } catch (error) {
                caught = error;
            }
            await flushMicrotasks();
        });

        expect(caught).toBe(err);
        expect(c.state.status).toBe("error");
    });

    it("fire-and-forget failing trigger produces no unhandled rejection; error lands in state", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const api = createApi({ plugins: [reactHooksPlugin()] });
            const command = api.createCommand<string, string>({
                queryFn: async () => {
                    throw new Error("ignored");
                },
            });

            const c = setup(command.useCommand);

            await act(async () => {
                // Mirrors onClick={() => trigger(args)}: nobody handles the promise.
                void c.trigger("x");
                await flushMicrotasks();
            });
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
            expect(c.state.status).toBe("error");
            expect(c.state.isError).toBe(true);
        } finally {
            tracker.stop();
        }
    });

    it("trigger identity is stable across re-renders", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<string, string>({
            queryFn: async (args) => args,
        });

        const c = setup(command.useCommand);

        await act(async () => {
            await c.trigger("a");
            await flushMicrotasks();
        });
        act(() => {
            c.rerender();
        });

        expect(c.triggers.length).toBeGreaterThanOrEqual(2);
        const first = c.triggers[0];
        expect(c.triggers.every((t) => t === first)).toBe(true);
    });

    it("bound key routes the mutation to that cache entry", async () => {
        const keys: string[] = [];
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<string, string>({
            queryFn: async (args) => args.toUpperCase(),
            onCacheEntryAdded: (_args, ctx) => {
                keys.push(ctx.entry.keyedArgs.key);
            },
        });

        const c = setup(command.useCommand, "k1");

        await act(async () => {
            await c.trigger("hello");
            await flushMicrotasks();
        });

        expect(keys).toEqual(["k1"]);
        expect(c.state.status).toBe("success");
        expect(c.state.data).toBe("HELLO");
    });

    it("re-binding the key via re-render switches the observed entry", async () => {
        const keys: string[] = [];
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<string, string>({
            queryFn: async (args) => args.toUpperCase(),
            onCacheEntryAdded: (_args, ctx) => {
                keys.push(ctx.entry.keyedArgs.key);
            },
        });

        const c = setup(command.useCommand, "k1");

        await act(async () => {
            await c.trigger("first");
            await flushMicrotasks();
        });
        expect(c.state.data).toBe("FIRST");

        // Key changes on re-render → useEffect re-binds the agent via setKey.
        await act(async () => {
            c.rerender("k2");
            await flushMicrotasks();
        });
        expect(c.state.status).toBe("idle"); // no entry under k2 yet

        await act(async () => {
            await c.trigger("second");
            await flushMicrotasks();
        });

        expect(keys).toEqual(["k1", "k2"]);
        expect(c.state.status).toBe("success");
        expect(c.state.data).toBe("SECOND");
    });
});
