import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TCommandClutchState, TTriggerPromise } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

type Trigger<TArgs, TData> = (args: TArgs) => TTriggerPromise<TData>;

interface Captured<TArgs, TData> {
    trigger: Trigger<TArgs, TData>;
    state: TCommandClutchState<TArgs, TData>;
    /** Every trigger reference seen across renders (identity check). */
    triggers: Array<Trigger<TArgs, TData>>;
    /** Re-render the probe, optionally with a different bound entry key. */
    rerender: (newEntryKey?: string) => void;
}

/** Render a probe component around useCommand and expose the live tuple. */
function setup<TArgs, TData>(
    useCommand: (entryKey?: string) => [Trigger<TArgs, TData>, TCommandClutchState<TArgs, TData>],
    entryKey?: string,
): Captured<TArgs, TData> {
    const captured = {} as Captured<TArgs, TData>;

    function Probe({ cmdEntryKey }: { cmdEntryKey?: string }) {
        const [trigger, state] = useCommand(cmdEntryKey);
        captured.trigger = trigger;
        captured.state = state;
        captured.triggers.push(trigger);
        return null;
    }

    captured.triggers = [];
    const view = render(h(Probe, { cmdEntryKey: entryKey }));
    captured.rerender = (newEntryKey?: string) => view.rerender(h(Probe, { cmdEntryKey: newEntryKey ?? entryKey }));
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
        expect(c.state.isPending).toBe(false);
        expect(c.state.hasData).toBe(false);
        expect(c.state.hasError).toBe(false);

        let result: Awaited<ReturnType<typeof c.trigger>> | undefined;
        await act(async () => {
            result = await c.trigger("x");
            await flushMicrotasks();
        });

        expect(result).toEqual({ status: "success", data: "result-x" });
        expect(c.state.status).toBe("success");
        expect(c.state.data).toBe("result-x");
        expect(c.state.hasData).toBe(true);
        expect(c.state.hasError).toBe(false);
        expect(c.state.isPending).toBe(false);
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
        expect(c.state.hasError).toBe(true);
        expect(c.state.hasData).toBe(false);
        expect(c.state.isPending).toBe(false);
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
            expect(c.state.hasError).toBe(true);
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

    it("bound entry key routes the mutation to that cache entry", async () => {
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

    it("re-binding the entry key via re-render switches the observed entry", async () => {
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

        // The entry key changes on re-render → useEffect re-binds the clutch via setEntryKey.
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

    // A second trigger under the same entry key replaces the cache entry; the
    // replacement is batched, so the render sequence never contains the
    // entry-less `idle` between `success` and `pending`. (React may collapse
    // the second trigger's `pending` → `success` into one commit — the pinned
    // contract is that `idle` is never rendered again, see the clutch-level
    // sequence in command-clutch.test.ts.)
    it("a re-trigger under the same entry key never renders idle again", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const command = api.createCommand<number, number>({ queryFn: async (n) => n });

        let trigger!: Trigger<number, number>;
        const statuses: string[] = [];
        function Probe() {
            const [t, state] = command.useCommand("draft");
            trigger = t;
            if (statuses.at(-1) !== state.status) statuses.push(state.status);
            return null;
        }
        render(h(Probe));

        await act(async () => {
            await trigger(1);
            await flushMicrotasks();
        });
        await act(async () => {
            await trigger(2);
            await flushMicrotasks();
        });

        expect(statuses[0]).toBe("idle");
        expect(statuses.slice(1)).not.toContain("idle");
        expect(statuses.at(-1)).toBe("success");
        expect(statuses).toContain("pending");
    });

    // The clutch is bound to entryKey during render — a commit under the new
    // key must never draw the previous key's state, and a trigger fired before
    // passive effects already goes to the new key.
    it("switching entryKey commits the new key's state, never the previous one", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const saveRow = api.createCommand<number, number>({
            queryFn: async (n) => n,
            retentionTime: false,
        });

        await saveRow.execute(1, "row-a");
        await saveRow.execute(2, "row-b");

        const commits: Array<[string, unknown]> = [];
        function Row({ rowId }: { rowId: string }) {
            const [, state] = saveRow.useCommand(rowId);
            React.useLayoutEffect(() => {
                commits.push([rowId, state.data]);
            });
            return null;
        }

        const view = render(h(Row, { rowId: "row-a" }));
        await act(async () => {});
        view.rerender(h(Row, { rowId: "row-b" }));
        await act(async () => {});

        const committedForB = commits.filter(([id]) => id === "row-b").map(([, data]) => data);
        expect(committedForB).not.toContain(1);
        expect(committedForB.at(-1)).toBe(2);
    });

    it("switching entryKey to undefined triggers under a fresh generated key", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const usedKeys: Array<string | undefined> = [];
        const save = api.createCommand<number, number>({ queryFn: async (n) => n, retentionTime: false });
        const execute = save.execute.bind(save);
        save.execute = (args, entryKey) => {
            usedKeys.push(entryKey);
            return execute(args, entryKey);
        };

        let trigger!: (n: number) => PromiseLike<unknown>;
        function Editor({ draftId }: { draftId?: string }) {
            [trigger] = save.useCommand(draftId);
            return null;
        }

        const view = render(h(Editor, { draftId: "draft-1" }));
        await act(async () => {});
        view.rerender(h(Editor, { draftId: undefined }));
        await act(async () => {});

        await act(async () => {
            await trigger(42);
        });

        expect(usedKeys).toHaveLength(1);
        expect(usedKeys[0]).not.toBe("draft-1");
        // ...and the previous draft's entry is not overwritten by the new run.
    });
});
