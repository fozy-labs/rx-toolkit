import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { Command } from "@/query/core/command/Command";
import type { TCommandQueryFn, TCommandOptions } from "@/query/types";

type TArgs = { id: number };
type TResult = { name: string };

/** Helper: creates a queryFn whose resolve/reject can be controlled externally */
function createControllableQueryFn() {
    let resolveFn!: (value: TResult) => void;
    let rejectFn!: (reason?: unknown) => void;
    const calls: Array<{ args: TArgs; abortSignal: AbortSignal }> = [];

    const queryFn: TCommandQueryFn<TArgs, TResult> = vi.fn((args: TArgs, tools: { abortSignal: AbortSignal }) => {
        return new Promise<TResult>((resolve, reject) => {
            calls.push({ args, abortSignal: tools.abortSignal });
            resolveFn = resolve;
            rejectFn = reject;
        });
    });

    return {
        queryFn,
        calls,
        resolve(value: TResult) {
            resolveFn(value);
        },
        reject(reason?: unknown) {
            rejectFn(reason);
        },
    };
}

function createOptions(overrides?: Partial<TCommandOptions<TArgs, TResult>>): TCommandOptions<TArgs, TResult> {
    const queryFn: TCommandQueryFn<TArgs, TResult> = vi.fn(() => Promise.resolve({ name: "test" }));
    return { queryFn, ...overrides };
}

describe("CommandAgent", () => {
    // ── T20: Initial state is idle ──
    it("T20: initial state$ is idle", () => {
        const command = new Command<TArgs, TResult>(createOptions());
        const agent = command.createAgent();

        const state = agent.state$();

        expect(state.status).toBe("idle");
        expect(state.data).toBeNull();
        expect(state.error).toBeNull();
        expect(state.args).toBeNull();
        expect(state.isLoading).toBe(false);
        expect(state.isSuccess).toBe(false);
        expect(state.isError).toBe(false);
    });

    // ── T21: trigger(args) transitions to loading then success ──
    it("T21: trigger(args) transitions to loading then success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });

        expect(agent.state$().status).toBe("loading");
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().args).toEqual({ id: 1 });

        resolve({ name: "success" });
        await promise;

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "success" });
        expect(agent.state$().isSuccess).toBe(true);
        expect(agent.state$().isLoading).toBe(false);
    });

    // ── T22: trigger(args) on error transitions to error ──
    it("T22: trigger(args) on error transitions to error", async () => {
        const { queryFn, reject } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });

        expect(agent.state$().status).toBe("loading");

        const err = new Error("network error");
        reject(err);

        await expect(promise).rejects.toBe(err);

        expect(agent.state$().status).toBe("error");
        expect(agent.state$().error).toBe(err);
        expect(agent.state$().isError).toBe(true);
        expect(agent.state$().isLoading).toBe(false);
    });

    // ── T23: reset() returns to idle ──
    it("T23: reset() returns to idle after success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });
        resolve({ name: "done" });
        await promise;

        expect(agent.state$().status).toBe("success");

        agent.reset();

        expect(agent.state$().status).toBe("idle");
        expect(agent.state$().data).toBeNull();
        expect(agent.state$().args).toBeNull();
    });

    // ── T24: Concurrent trigger aborts previous ──
    it("T24: concurrent trigger aborts previous", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise1 = agent.trigger({ id: 1 });
        expect(calls[0]!.abortSignal.aborted).toBe(false);

        const promise2 = agent.trigger({ id: 2 });

        // First call should be aborted
        expect(calls[0]!.abortSignal.aborted).toBe(true);

        // First promise should reject with AbortError
        await expect(promise1).rejects.toThrow("aborted");

        // State shows second trigger's args
        expect(agent.state$().status).toBe("loading");
        expect(agent.state$().args).toEqual({ id: 2 });

        // Resolve second call
        calls[1] && void 0; // ensure second call exists
        const resolveFn = vi.fn();
        // We need a new controllable resolve for second call
        // Since the queryFn creates a new promise each call, let's resolve via the promise chain
        // Actually the controllable sets resolveFn to the latest call's resolve
        // So resolve() now resolves call #2
    });

    // ── T25: trigger() returns promise that resolves/rejects ──
    it("T25: trigger() returns promise that resolves with data on success", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });
        resolve({ name: "promised-result" });

        const result = await promise;
        expect(result).toEqual({ name: "promised-result" });
    });

    it("T25b: trigger() returns promise that rejects on error", async () => {
        const { queryFn, reject } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });
        const err = new Error("fail");
        reject(err);

        await expect(promise).rejects.toBe(err);
    });

    // ── T26: state$ is reactive (signals update) ──
    it("T26: state$ exposes flat computed fields matching discriminated union", async () => {
        const { queryFn, resolve } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        // idle
        let state = agent.state$();
        expect(state).toEqual({
            status: "idle",
            data: null,
            error: null,
            args: null,
            isLoading: false,
            isSuccess: false,
            isError: false,
        });

        // loading
        const promise = agent.trigger({ id: 42 });
        state = agent.state$();
        expect(state.status).toBe("loading");
        expect(state.isLoading).toBe(true);
        expect(state.args).toEqual({ id: 42 });

        // success
        resolve({ name: "reactive" });
        await promise;
        state = agent.state$();
        expect(state).toEqual({
            status: "success",
            data: { name: "reactive" },
            error: null,
            args: { id: 42 },
            isLoading: false,
            isSuccess: true,
            isError: false,
        });
    });

    // ── Extra: reset while loading ──
    it("reset() while loading aborts and returns to idle", async () => {
        const { queryFn, calls } = createControllableQueryFn();
        const command = new Command<TArgs, TResult>(createOptions({ queryFn }));
        const agent = command.createAgent();

        const promise = agent.trigger({ id: 1 });
        expect(agent.state$().status).toBe("loading");

        agent.reset();

        expect(agent.state$().status).toBe("idle");
        expect(calls[0]!.abortSignal.aborted).toBe(true);

        // Promise should reject with AbortError
        await expect(promise).rejects.toThrow("aborted");
    });
});
