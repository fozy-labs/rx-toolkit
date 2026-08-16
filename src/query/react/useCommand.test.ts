import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TCommandAgentState } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

interface Captured<TArgs, TData> {
    trigger: (args: TArgs) => Promise<TData>;
    state: TCommandAgentState<TArgs, TData>;
    /** Every trigger reference seen across renders (identity check). */
    triggers: Array<(args: TArgs) => Promise<TData>>;
    rerender: () => void;
}

/** Render a probe component around useCommand and expose the live tuple. */
function setup<TArgs, TData>(
    useCommand: (key?: string) => [(args: TArgs) => Promise<TData>, TCommandAgentState<TArgs, TData>],
    key?: string,
): Captured<TArgs, TData> {
    const captured = {} as Captured<TArgs, TData>;

    function Probe() {
        const [trigger, state] = useCommand(key);
        captured.trigger = trigger;
        captured.state = state;
        captured.triggers.push(trigger);
        return null;
    }

    captured.triggers = [];
    const view = render(h(Probe));
    captured.rerender = () => view.rerender(h(Probe));
    return captured;
}

// ==================== Tests ====================

describe("useCommand", () => {
    it("starts idle; trigger resolves with the mutation data and state reaches success", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<string, string>({
            queryFn: async (args) => `result-${args}`,
        });

        const c = setup(command.useCommand);
        expect(c.state.status).toBe("idle");

        let resolved: string | undefined;
        await act(async () => {
            resolved = await c.trigger("x");
            await flushMicrotasks();
        });

        expect(resolved).toBe("result-x");
        expect(c.state.status).toBe("success");
        expect(c.state.data).toBe("result-x");
    });

    it("trigger rejects with the mapError-normalized error and state reaches error", async () => {
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

        let caught: unknown;
        await act(async () => {
            try {
                await c.trigger("x");
            } catch (error) {
                caught = error;
            }
            await flushMicrotasks();
        });

        expect(caught).toBeInstanceOf(NetError);
        expect(c.state.status).toBe("error");
        expect(c.state.error).toBe(caught);
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
});
