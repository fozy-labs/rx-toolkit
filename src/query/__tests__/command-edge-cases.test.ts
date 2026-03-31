import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { commandLink } from "@/query/api/commandLink";
import { createApi } from "@/query/api/createApi";
import { Command } from "@/query/core/command/Command";
import { CommandCacheEntry } from "@/query/core/command/CommandCacheEntry";
import type { TCommandQueryFn, TCommandOptions } from "@/query/types";

type TArgs = { id: number };
type TResult = { name: string };
type TRArgs = { id: number };
type TRData = { title: string; count: number };

/**
 * Creates a queryFn where each invocation gets its own resolve/reject stored in `calls`.
 * Unlike the simpler helper, this supports per-call resolution for concurrent scenarios.
 */
function createControllableQueryFn<A = TArgs, R = TResult>() {
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

function createOptions(overrides?: Partial<TCommandOptions<TArgs, TResult>>): TCommandOptions<TArgs, TResult> {
    const queryFn: TCommandQueryFn<TArgs, TResult> = vi.fn(() => Promise.resolve({ name: "test" }));
    return { queryFn, ...overrides };
}

// ── EC-1: Stale settlement after abort (stale reject) ──

describe("EC-1: Stale settlement after abort (stale reject)", () => {
    it("stale reject from first queryFn is silently ignored; second trigger succeeds", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandCacheEntry<TArgs, TResult>({ queryFn });

        // First trigger → loading
        const promise1 = entry.initiate({ id: 1 });

        expect(entry.peek().status).toBe("loading");

        // Second trigger → aborts first, still loading
        const promise2 = entry.initiate({ id: 2 });

        // First signal should be aborted
        expect(calls[0]!.abortSignal.aborted).toBe(true);
        expect(calls[1]!.abortSignal.aborted).toBe(false);

        // Suppress abort rejection from first trigger
        promise1.catch(() => {});

        // Old queryFn rejects AFTER abort → should be silently ignored
        calls[0]!.reject(new Error("network failure from stale call"));
        await flushMicrotasks();

        // State should still be "loading" for second trigger (stale reject ignored)
        expect(entry.peek().status).toBe("loading");
        expect(entry.peek().args).toEqual({ id: 2 });

        // Resolve second → success
        calls[1]!.resolve({ name: "fresh-result" });
        const result = await promise2;

        expect(result).toEqual({ name: "fresh-result" });
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "fresh-result" });
    });
});

// ── EC-2: Stale settlement intermediate state check ──

describe("EC-2: Stale settlement intermediate state check (stale resolve)", () => {
    it("stale resolve from first queryFn is ignored; state stays loading until second resolves", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const entry = new CommandCacheEntry<TArgs, TResult>({ queryFn });

        // First trigger → loading
        const promise1 = entry.initiate({ id: 1 });
        expect(entry.peek().status).toBe("loading");

        // Second trigger → aborts first, still loading
        const promise2 = entry.initiate({ id: 2 });

        // Suppress abort rejection from first trigger
        promise1.catch(() => {});

        // First resolves AFTER abort (stale) — should be silently ignored
        calls[0]!.resolve({ name: "stale-data" });
        await flushMicrotasks();

        // Assert: state is still "loading" (stale resolve ignored)
        expect(entry.peek().status).toBe("loading");

        // Second resolves → success with second data
        calls[1]!.resolve({ name: "fresh-data" });
        const result = await promise2;

        expect(result).toEqual({ name: "fresh-data" });
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "fresh-data" });
    });
});

// ── EC-3: Link + no cache entry end-to-end ──

describe("EC-3: Link + no cache entry — optimisticUpdate skipped, invalidate still called", () => {
    it("command with linked resource (no queried entry) does not throw; invalidate still fires", async () => {
        const api = createApi();
        const { queryFn: resourceQf } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableQueryFn();

        const resource = api.createResource<TRArgs, TRData>({
            key: "ec3-items",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // DON'T query resource — no cache entry exists
        const invalidateSpy = vi.spyOn(resource, "invalidate");

        // Create command linked to resource with optimisticUpdate + invalidate
        const command = api.createCommand<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args: TArgs) => ({ id: args.id }),
                    optimisticUpdate: ({ draft }) => {
                        draft.title = "Optimistic";
                    },
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();

        // Trigger command — should NOT throw even though no entry exists
        const triggerPromise = agent.trigger({ id: 1 });

        expect(agent.state$().status).toBe("loading");

        // Resolve command
        commandCalls[0]!.resolve({ name: "done" });
        await flushMicrotasks();
        await triggerPromise;

        // Assert: command succeeded
        expect(agent.state$().status).toBe("success");

        // Assert: invalidate was still called on success
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });
});

// ── EC-4: Unmount does NOT abort — explicit signal check ──

describe("EC-4: Unmount (unsubscribe) does NOT abort in-flight command", () => {
    it("stopping observation does not abort; queryFn still settles successfully", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        // Trigger → loading
        const promise = agent.trigger({ id: 1 });
        expect(agent.state$().status).toBe("loading");

        // Simulate unmount: stop observing state$ (read it but don't set up further subscriptions)
        // The key point: there is no unmount/dispose on the agent that would abort.
        // We just stop calling state$(). The abort signal should NOT be affected.
        expect(calls[0]!.abortSignal.aborted).toBe(false);

        // Resolve queryFn AFTER "unmount"
        calls[0]!.resolve({ name: "post-unmount-result" });
        const result = await promise;

        // Success state still applied
        expect(result).toEqual({ name: "post-unmount-result" });
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "post-unmount-result" });

        // abortSignal was never aborted
        expect(calls[0]!.abortSignal.aborted).toBe(false);
    });
});

// ── EC-5: resetCache during in-flight ──

describe("EC-5: resetCache during in-flight", () => {
    it("resetCache aborts in-flight and allows re-triggering after reset", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        // Trigger → loading
        const promise1 = agent.trigger({ id: 1 });
        expect(agent.state$().status).toBe("loading");
        expect(calls[0]!.abortSignal.aborted).toBe(false);

        // resetCache during in-flight
        command.resetCache();

        // Assert: in-flight abortSignal is now aborted
        expect(calls[0]!.abortSignal.aborted).toBe(true);

        // Suppress rejection from reset
        await promise1.catch(() => {});

        // Agent can trigger again after reset
        const promise2 = agent.trigger({ id: 2 });

        expect(agent.state$().status).toBe("loading");
        expect(calls[1]!.abortSignal.aborted).toBe(false);

        calls[1]!.resolve({ name: "after-reset" });
        const result = await promise2;

        expect(result).toEqual({ name: "after-reset" });
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "after-reset" });
    });
});

// ── EC-6: Link + resource entry in error/pending state ──

describe("EC-6: Link + resource entry in error state — optimisticUpdate skipped, command still succeeds", () => {
    it("optimistic update is silently skipped when resource entry is in error state; invalidate still fires", async () => {
        const api = createApi();
        const { queryFn: resourceQf, calls: resourceCalls } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableQueryFn();

        const resource = api.createResource<TRArgs, TRData>({
            key: "ec6-items",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Query resource → pending → error
        const resourcePromise = resource.query({ id: 1 });
        resourceCalls[0]!.reject(new Error("resource fetch failed"));
        await flushMicrotasks();
        await resourcePromise.catch(() => {});

        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("error");

        const invalidateSpy = vi.spyOn(resource, "invalidate");

        // Command linked with optimisticUpdate + invalidate
        const command = api.createCommand<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource,
                    forwardArgs: (args: TArgs) => ({ id: args.id }),
                    optimisticUpdate: ({ draft }) => {
                        draft.title = "Optimistic";
                    },
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();
        const triggerPromise = agent.trigger({ id: 1 });

        // Entry should still be in error state — optimistic skipped (createPatch returns null for error)
        expect(entry.peek().status).toBe("error");

        // Resolve command
        commandCalls[0]!.resolve({ name: "done" });
        await flushMicrotasks();
        await triggerPromise;

        // Command succeeded
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "done" });

        // Invalidate was still called on success
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });
});

// ── EC-7: queryFn sync throw at agent level ──

describe("EC-7: queryFn sync throw at agent level", () => {
    it("sync throw in queryFn transitions to error; trigger promise rejects", async () => {
        const syncError = new Error("sync");
        const command = new Command<TArgs, TResult>(
            createOptions({
                queryFn: () => {
                    throw syncError;
                },
            }),
        );
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });

        await expect(promise).rejects.toBe(syncError);

        expect(agent.state$().isError).toBe(true);
        expect(agent.state$().status).toBe("error");
        expect(agent.state$().error).toBe(syncError);
        expect((agent.state$().error as Error).message).toBe("sync");
    });
});

// ── EC-8: Multiple links partial failure ──

describe("EC-8: Multiple links partial failure — one entry has data, the other does not", () => {
    it("patch skipped for entry without data; patch applied for entry with data; both invalidated on success", async () => {
        const api = createApi();
        const { queryFn: rQf1, calls: rCalls1 } = createControllableResourceQueryFn();
        const { queryFn: rQf2, calls: rCalls2 } = createControllableResourceQueryFn();
        const { queryFn: commandQf, calls: commandCalls } = createControllableQueryFn();

        const resource1 = api.createResource<TRArgs, TRData>({
            key: "ec8-res1",
            queryFn: rQf1,
            cacheLifetime: false as never,
        });
        const resource2 = api.createResource<TRArgs, TRData>({
            key: "ec8-res2",
            queryFn: rQf2,
            cacheLifetime: false as never,
        });

        // DON'T query resource1 — no entry exists
        // Query resource2 — it has data
        const r2Promise = resource2.query({ id: 2 });
        rCalls2[0]!.resolve({ title: "R2-Original", count: 10 });
        await flushMicrotasks();
        await r2Promise;

        const entry2 = resource2.getEntry({ id: 2 })!;
        expect(entry2.peek().status).toBe("success");

        const invalidateSpy1 = vi.spyOn(resource1, "invalidate");
        const invalidateSpy2 = vi.spyOn(resource2, "invalidate");

        // Command linked to both resources with optimisticUpdate + invalidate
        const command = api.createCommand<TArgs, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource: resource1,
                    forwardArgs: (args: TArgs) => ({ id: args.id }),
                    optimisticUpdate: ({ draft }) => {
                        draft.title = "Opt-R1";
                    },
                    invalidate: true,
                }),
                commandLink({
                    resource: resource2,
                    forwardArgs: (args: TArgs) => ({ id: args.id + 1 }),
                    optimisticUpdate: ({ draft }) => {
                        draft.title = "Opt-R2";
                        draft.count = 999;
                    },
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();
        agent.trigger({ id: 1 });

        // resource1 has no entry → optimistic patch skipped (no effect)
        expect(resource1.getEntry({ id: 1 })).toBeNull();

        // resource2 has entry → optimistic patch applied
        expect(entry2.peek().data!.title).toBe("Opt-R2");
        expect(entry2.peek().data!.count).toBe(999);

        // Resolve command → success
        commandCalls[0]!.resolve({ name: "done" });
        await flushMicrotasks();

        // Both resources should be invalidated
        expect(invalidateSpy1).toHaveBeenCalledTimes(1);
        expect(invalidateSpy2).toHaveBeenCalledTimes(1);

        // resource2 optimistic patch committed (data persists)
        expect(entry2.peek().data!.title).toBe("Opt-R2");
        expect(entry2.peek().data!.count).toBe(999);
    });
});

// ── EC-9: Void args forwarding ──

describe("EC-9: Void args forwarding — command and resource with void args", () => {
    it("trigger() with no args succeeds and resource is invalidated", async () => {
        const api = createApi();

        const resourceQf = vi.fn((_args: void, _tools: { abortSignal: AbortSignal }) =>
            Promise.resolve({ title: "Void-Resource", count: 1 }),
        );
        const commandQf = vi.fn((_args: void, _tools: { abortSignal: AbortSignal }) =>
            Promise.resolve({ name: "void-done" }),
        );

        const resource = api.createResource<void, TRData>({
            key: "ec9-void-res",
            queryFn: resourceQf,
            cacheLifetime: false as never,
        });

        // Query resource (void args → no argument)
        await resource.query();
        expect(resource.getEntry()!.peek().status).toBe("success");

        const invalidateSpy = vi.spyOn(resource, "invalidate");

        const command = api.createCommand<void, TResult>({
            queryFn: commandQf,
            cacheLifetime: false,
            link: [
                commandLink({
                    resource,
                    forwardArgs: () => undefined as void,
                    invalidate: true,
                }),
            ],
        });

        const agent = command.createAgent();

        // Trigger with no args (void)
        const result = await agent.trigger();

        expect(result).toEqual({ name: "void-done" });
        expect(agent.state$().status).toBe("success");

        // Resource was invalidated
        expect(invalidateSpy).toHaveBeenCalledTimes(1);
    });
});
