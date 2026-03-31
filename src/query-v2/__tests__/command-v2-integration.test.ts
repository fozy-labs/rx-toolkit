import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { commandLink } from "@/query-v2/api/commandLink";
import { createApi } from "@/query-v2/api/createApi";
import { ReactHooksPlugin } from "@/query-v2/plugins/ReactHooksPlugin";
import { useCommandV2Agent } from "@/query-v2/react/useCommandV2Agent";
import type { TCommandQueryFn, TCommandV2Options } from "@/query-v2/types";

// ── Shared types ──

type TArgs = { id: number };
type TResult = { name: string };
type TRData = { title: string; count: number };
type TRArgs = { id: number };

// ── Helpers ──

function createControllableCommandQueryFn<A = TArgs, R = TResult>() {
    const calls: Array<{
        args: A;
        abortSignal: AbortSignal;
        resolve: (value: R) => void;
        reject: (reason?: unknown) => void;
    }> = [];

    const queryFn: TCommandQueryFn<A, R> = vi.fn(
        (args: A, tools: { abortSignal: AbortSignal }) =>
            new Promise<R>((resolve, reject) => {
                calls.push({ args, abortSignal: tools.abortSignal, resolve, reject });
            }),
    );

    return { queryFn, calls };
}

function createControllableResourceQueryFn<A = TRArgs, D = TRData>() {
    const calls: Array<{
        args: A;
        abortSignal: AbortSignal;
        resolve: (value: D) => void;
        reject: (reason?: unknown) => void;
    }> = [];

    const queryFn = vi.fn(
        (args: A, tools: { abortSignal: AbortSignal }) =>
            new Promise<D>((resolve, reject) => {
                calls.push({ args, abortSignal: tools.abortSignal, resolve, reject });
            }),
    );

    return { queryFn, calls };
}

// ── INT-C01: Command success invalidates linked resource → resource re-fetches ──

describe("Integration: Command + Resource invalidation", () => {
    it("INT-C01: command success invalidates linked resource, resource re-fetches", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource = api.createResourceV2<TRArgs, TRData>({
            key: "items",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Load resource data first
        const promise = resource.query({ id: 1 });
        resourceCalls[0].resolve({ title: "Original", count: 1 });
        await flushMicrotasks();
        await promise;

        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ title: "Original", count: 1 });

        // Create command linked to the resource with invalidation
        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args) => ({ id: args.id }),
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();

        // Trigger command
        const triggerPromise = agent.trigger({ id: 1 });

        // Command should be loading
        expect(agent.state$().status).toBe("loading");

        // Resolve command
        commandCalls[0].resolve({ name: "done" });
        await flushMicrotasks();
        await triggerPromise;

        // Resource should have been invalidated → re-fetched
        // resourceQf should be called a second time (invalidation triggers refetch)
        expect(resourceQf).toHaveBeenCalledTimes(2);
    });

    it("INT-C02: command success applies update patch to resource data without refetch", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource = api.createResourceV2<TRArgs, TRData>({
            key: "items-update",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Load resource
        const promise = resource.query({ id: 1 });
        resourceCalls[0].resolve({ title: "Original", count: 1 });
        await flushMicrotasks();
        await promise;

        // Command with update link (no invalidate)
        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args) => ({ id: args.id }),
                    update: ({ draft, data }) => {
                        draft.title = data.name;
                    },
                }),
            ],
        });

        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 1 });

        commandCalls[0].resolve({ name: "Updated" });
        await flushMicrotasks();
        await triggerPromise;

        // Resource should be patched with update data
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().data!.title).toBe("Updated");

        // No invalidation refetch — still only 1 call
        expect(resourceQf).toHaveBeenCalledTimes(1);
    });
});

// ── INT-C03/C04: Optimistic updates ──

describe("Integration: Optimistic updates", () => {
    it("INT-C03: optimistic update applied before queryFn resolves, committed on success", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource = api.createResourceV2<TRArgs, TRData>({
            key: "items-opt",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Load resource
        const promise = resource.query({ id: 1 });
        resourceCalls[0].resolve({ title: "Original", count: 10 });
        await flushMicrotasks();
        await promise;

        // Command with optimistic update
        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args) => ({ id: args.id }),
                    optimisticUpdate: ({ draft, args }) => {
                        draft.title = "Optimistic";
                        draft.count = 999;
                    },
                }),
            ],
        });

        const agent = command.createAgent();
        agent.trigger({ id: 1 });

        // Optimistic update should be visible immediately
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().data!.title).toBe("Optimistic");
        expect(entry.peek().data!.count).toBe(999);

        // Resolve command → optimistic committed
        commandCalls[0].resolve({ name: "done" });
        await flushMicrotasks();

        // Data still reflects optimistic (committed)
        expect(entry.peek().data!.title).toBe("Optimistic");
        expect(entry.peek().data!.count).toBe(999);
    });

    it("INT-C04: optimistic update rolled back on command error", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource = api.createResourceV2<TRArgs, TRData>({
            key: "items-rollback",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Load resource
        const promise = resource.query({ id: 1 });
        resourceCalls[0].resolve({ title: "Original", count: 10 });
        await flushMicrotasks();
        await promise;

        // Command with optimistic update
        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args) => ({ id: args.id }),
                    optimisticUpdate: ({ draft }) => {
                        draft.title = "Optimistic";
                        draft.count = 999;
                    },
                }),
            ],
        });

        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 1 });

        // Optimistic data visible
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().data!.title).toBe("Optimistic");

        // Reject command → rollback
        commandCalls[0].reject(new Error("Server error"));
        await flushMicrotasks();

        // Suppress expected rejection
        await triggerPromise.catch(() => {});

        // Resource should revert to original data
        expect(entry.peek().data!.title).toBe("Original");
        expect(entry.peek().data!.count).toBe(10);
    });
});

// ── INT-C05: Multiple links ──

describe("Integration: Multiple links", () => {
    it("INT-C05: command linked to 2 resources — both invalidated on success", async () => {
        const api = createApi();
        const { queryFn: rQf1, calls: rCalls1 } = createControllableResourceQueryFn();
        const { queryFn: rQf2, calls: rCalls2 } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource1 = api.createResourceV2<TRArgs, TRData>({
            key: "res1",
            queryFn: rQf1,
            cacheLifetime: false as never,
        });
        const resource2 = api.createResourceV2<TRArgs, TRData>({
            key: "res2",
            queryFn: rQf2,
            cacheLifetime: false as never,
        });

        // Load both resources
        const p1 = resource1.query({ id: 1 });
        rCalls1[0].resolve({ title: "R1", count: 1 });
        await flushMicrotasks();
        await p1;

        const p2 = resource2.query({ id: 2 });
        rCalls2[0].resolve({ title: "R2", count: 2 });
        await flushMicrotasks();
        await p2;

        // Command linked to both resources
        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource: resource1,
                    forwardArgs: (args) => ({ id: args.id }),
                    invalidate: true,
                }),
                commandLink({
                    resource: resource2,
                    forwardArgs: (args) => ({ id: args.id + 1 }),
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 1 });

        commandCalls[0].resolve({ name: "done" });
        await flushMicrotasks();
        await triggerPromise;

        // Both resources should have been invalidated → both refetched
        expect(rQf1).toHaveBeenCalledTimes(2);
        expect(rQf2).toHaveBeenCalledTimes(2);
    });
});

// ── INT-C10/C11/C12: Plugin augmentation ──

describe("Integration: Plugin augmentation", () => {
    it("INT-C10: api.createCommandV2 with ReactHooksPlugin → useCommandV2Agent exists", () => {
        const api = createApi({
            plugins: [new ReactHooksPlugin()] as const,
        });

        const { queryFn } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        // Plugin should contribute useCommandV2Agent
        expect((command as unknown as Record<string, unknown>).useCommandV2Agent).toBeTypeOf("function");
    });

    it("INT-C11: augmentCommand called with command + options", () => {
        const augmentSpy = vi.fn().mockReturnValue({ testHook: () => {} });
        const plugin = {
            name: "TestPlugin",
            install: vi.fn(),
            augmentCommand: augmentSpy,
        };

        const api = createApi({ plugins: [plugin] as any });
        const { queryFn } = createControllableCommandQueryFn();
        const options: TCommandV2Options<TArgs, TResult> = { queryFn };
        api.createCommandV2<TArgs, TResult>(options);

        expect(augmentSpy).toHaveBeenCalledTimes(1);
        // First arg is the command instance, second is merged options
        expect(augmentSpy.mock.calls[0][0]).toBeDefined();
        expect(augmentSpy.mock.calls[0][1]).toMatchObject({ queryFn });
    });

    it("INT-C12: resetAll clears command caches — new agent starts at idle", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const resource = api.createResourceV2<TRArgs, TRData>({
            key: "items-reset",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
        });

        // Use the command
        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 1 });
        commandCalls[0].resolve({ name: "done" });
        await flushMicrotasks();
        await triggerPromise;

        expect(agent.state$().status).toBe("success");

        // Load resource
        const rPromise = resource.query({ id: 1 });
        resourceCalls[0].resolve({ title: "Data", count: 1 });
        await flushMicrotasks();
        await rPromise;

        // Reset everything
        api.resetAll();

        // After resetAll, creating a new agent produces a fresh idle state
        const newAgent = command.createAgent();
        expect(newAgent.state$().status).toBe("idle");

        // Old agent can trigger again (gets fresh entry since cache was cleared)
        const p2 = agent.trigger({ id: 2 });
        commandCalls[1].resolve({ name: "after-reset" });
        await flushMicrotasks();
        await p2;

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "after-reset" });
    });
});

// ── Lifecycle hooks ──

describe("Integration: Command lifecycle hooks", () => {
    it("onQueryStarted fires and $queryFulfilled resolves on success", async () => {
        const api = createApi();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        let capturedArgs: TArgs | null = null;
        let fulfilledData: TResult | null = null;

        const command = api.createCommandV2<TArgs, TResult>({
            queryFn: commandQf,
            onQueryStarted: async (args, tools) => {
                capturedArgs = args;
                const result = await tools.$queryFulfilled;
                fulfilledData = result.data;
            },
        });

        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 42 });

        // onQueryStarted should have captured args
        expect(capturedArgs).toEqual({ id: 42 });
        // $queryFulfilled not yet resolved
        expect(fulfilledData).toBeNull();

        commandCalls[0].resolve({ name: "lifecycle-result" });
        await flushMicrotasks();
        await triggerPromise;

        // $queryFulfilled should have resolved
        expect(fulfilledData).toEqual({ name: "lifecycle-result" });
    });
});

// ── Concurrent triggers ──

describe("Integration: Concurrent triggers", () => {
    it("rapid-fire triggers — only last one resolves, previous ones abort", async () => {
        const api = createApi();
        const { queryFn: commandQf, calls: commandCalls } = createControllableCommandQueryFn();

        const command = api.createCommandV2<TArgs, TResult>({ queryFn: commandQf });
        const agent = command.createAgent();

        // Fire 3 triggers rapidly
        const p1 = agent.trigger({ id: 1 });
        const p2 = agent.trigger({ id: 2 });
        const p3 = agent.trigger({ id: 3 });

        // Each trigger should have called queryFn
        expect(commandQf).toHaveBeenCalledTimes(3);

        // Previous abort signals should be aborted
        expect(commandCalls[0].abortSignal.aborted).toBe(true);
        expect(commandCalls[1].abortSignal.aborted).toBe(true);
        expect(commandCalls[2].abortSignal.aborted).toBe(false);

        // First two trigger promises should reject with AbortError
        await expect(p1).rejects.toThrow("aborted");
        await expect(p2).rejects.toThrow("aborted");

        // Resolve the last one
        commandCalls[2].resolve({ name: "last" });
        await flushMicrotasks();

        const result = await p3;
        expect(result).toEqual({ name: "last" });

        // Agent state should reflect the last result
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "last" });
    });
});

// ── React hook integration ──

describe("Integration: useCommandV2Agent React hook", () => {
    it("RH01: returns [trigger, state] — trigger is function, status idle", () => {
        const api = createApi();
        const { queryFn } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const { result } = renderHook(() => useCommandV2Agent(command));

        const [trigger, state] = result.current;
        expect(typeof trigger).toBe("function");
        expect(state.status).toBe("idle");
        expect(state.data).toBeNull();
        expect(state.error).toBeNull();
    });

    it("RH02: trigger → loading → success render cycle", async () => {
        const api = createApi();
        const { queryFn, calls } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const { result } = renderHook(() => useCommandV2Agent(command));

        // Initial idle
        expect(result.current[1].status).toBe("idle");

        // Trigger
        await act(async () => {
            result.current[0]({ id: 1 });
            await flushMicrotasks();
        });

        expect(result.current[1].status).toBe("loading");

        // Resolve
        await act(async () => {
            calls[0].resolve({ name: "result" });
            await flushMicrotasks();
        });

        expect(result.current[1].status).toBe("success");
        expect(result.current[1].data).toEqual({ name: "result" });
    });

    it("RH03: trigger → loading → error render cycle", async () => {
        const api = createApi();
        const { queryFn, calls } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const { result } = renderHook(() => useCommandV2Agent(command));

        let triggerPromise: Promise<TResult>;

        await act(async () => {
            triggerPromise = result.current[0]({ id: 1 });
            // Immediately attach .catch to prevent unhandled rejection
            triggerPromise.catch(() => {});
            await flushMicrotasks();
        });

        expect(result.current[1].status).toBe("loading");

        await act(async () => {
            calls[0].reject(new Error("fail"));
            await flushMicrotasks();
        });

        // Wait for rejection to propagate
        await triggerPromise!.catch(() => {});

        expect(result.current[1].status).toBe("error");
        expect(result.current[1].error).toBeInstanceOf(Error);
    });

    it("RH04: stable trigger reference across re-renders", async () => {
        const api = createApi();
        const { queryFn } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const { result, rerender } = renderHook(() => useCommandV2Agent(command));

        const trigger1 = result.current[0];
        rerender();
        const trigger2 = result.current[0];

        expect(trigger1).toBe(trigger2);
    });

    it("RH05: multiple triggers — only latest result committed", async () => {
        const api = createApi();
        const { queryFn, calls } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const { result } = renderHook(() => useCommandV2Agent(command));

        // First trigger
        let p1: Promise<TResult>;
        await act(async () => {
            p1 = result.current[0]({ id: 1 });
            // Attach .catch immediately to prevent unhandled rejection
            p1.catch(() => {});
            await flushMicrotasks();
        });

        // Second trigger (supersedes first)
        await act(async () => {
            result.current[0]({ id: 2 });
            await flushMicrotasks();
        });

        // First is aborted
        await p1!.catch(() => {});

        // Resolve the second
        await act(async () => {
            calls[1].resolve({ name: "second" });
            await flushMicrotasks();
        });

        expect(result.current[1].status).toBe("success");
        expect(result.current[1].data).toEqual({ name: "second" });
    });

    it("RH06: unmount while loading — no console errors", async () => {
        const api = createApi();
        const { queryFn, calls } = createControllableCommandQueryFn();
        const command = api.createCommandV2<TArgs, TResult>({ queryFn });

        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        const { result, unmount } = renderHook(() => useCommandV2Agent(command));

        let triggerPromise: Promise<TResult>;
        await act(async () => {
            triggerPromise = result.current[0]({ id: 1 });
            await flushMicrotasks();
        });

        expect(result.current[1].status).toBe("loading");

        // Unmount while loading
        unmount();

        // Resolve after unmount
        calls[0].resolve({ name: "late" });
        await flushMicrotasks();

        // Suppress rejection if any
        await triggerPromise!.catch(() => {});

        // No console.error should have been called
        expect(consoleError).not.toHaveBeenCalled();

        consoleError.mockRestore();
    });
});
