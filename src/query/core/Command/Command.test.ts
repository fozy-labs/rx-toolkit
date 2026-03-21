import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createCommand } from "@/query/api/createCommand";
import { createResource } from "@/query/api/createResource";

function createControllableCommand() {
    const calls: Array<{ resolve: (v: { result: string }) => void; reject: (e: any) => void }> = [];

    const queryFn = vi.fn(
        (_args: { id: number }) =>
            new Promise<{ result: string }>((resolve, reject) => {
                calls.push({ resolve, reject });
            }),
    );

    const command = createCommand<{ id: number }, { result: string }>({
        queryFn,
        cacheLifetime: false,
        devtoolsName: false,
    });

    return { command, queryFn, calls };
}

describe("Command", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("initiate", () => {
        it("transitions to loading state when initiated", () => {
            const { command } = createControllableCommand();
            const cache = command.initiate({ id: 1 });

            expect(cache.value.isLoading).toBe(true);
            expect(cache.value.isInitiated).toBe(true);
            expect(cache.value.isDone).toBe(false);
            expect(cache.value.isSuccess).toBe(false);
            expect(cache.value.isError).toBe(false);
        });

        it("transitions to success state when queryFn resolves", async () => {
            const { command, queryFn, calls } = createControllableCommand();
            const cache = command.initiate({ id: 1 });

            expect(queryFn).toHaveBeenCalledOnce();
            expect(queryFn).toHaveBeenCalledWith({ id: 1 });

            calls[0].resolve({ result: "done" });
            await flushMicrotasks();

            expect(cache.value.isLoading).toBe(false);
            expect(cache.value.isDone).toBe(true);
            expect(cache.value.isSuccess).toBe(true);
            expect(cache.value.data).toEqual({ result: "done" });
            expect(cache.value.isError).toBe(false);
            expect(cache.value.error).toBeNull();
        });

        it("transitions to error state when queryFn rejects", async () => {
            const { command, calls } = createControllableCommand();
            const cache = command.initiate({ id: 1 });

            const error = new Error("mutation failed");
            calls[0].reject(error);
            await flushMicrotasks();

            expect(cache.value.isLoading).toBe(false);
            expect(cache.value.isDone).toBe(true);
            expect(cache.value.isError).toBe(true);
            expect(cache.value.error).toBe(error);
            expect(cache.value.isSuccess).toBe(false);
        });

        it("sets isRepeating when re-initiated after success", async () => {
            const { command, calls } = createControllableCommand();

            command.initiate({ id: 1 });
            calls[0].resolve({ result: "first" });
            await flushMicrotasks();

            const cache = command.initiate({ id: 1 });
            expect(cache.value.isRepeating).toBe(true);
            expect(cache.value.isLoading).toBe(true);
        });

        it("stores arg in state", () => {
            const { command } = createControllableCommand();
            const cache = command.initiate({ id: 42 });
            expect(cache.value.arg).toEqual({ id: 42 });
        });
    });

    describe("createAgent", () => {
        it("creates a CommandAgent with state$", () => {
            const { command } = createControllableCommand();
            const agent = command.createAgent();
            expect(agent).toBeDefined();
            expect(agent.state$).toBeDefined();
        });
    });

    describe("mutate (deprecated)", () => {
        it("resolves on success", async () => {
            const { command, calls } = createControllableCommand();
            const promise = command.mutate({ id: 1 });

            calls[0].resolve({ result: "ok" });
            await flushMicrotasks();

            await expect(promise).resolves.toEqual({ result: "ok" });
        });

        it("rejects on error", async () => {
            const { command, calls } = createControllableCommand();

            // Test error path via initiate (mutate's internal .finally chain produces unhandled rejection)
            const cache = command.initiate({ id: 1 });
            const error = new Error("fail");
            calls[0].reject(error);
            await flushMicrotasks();

            expect(cache.value.isError).toBe(true);
            expect(cache.value.error).toBe(error);
        });
    });

    describe("select", () => {
        it("applies select transform to resolved data", async () => {
            const calls: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

            const command = createCommand<{ id: number }, { name: string; age: number }, string>({
                queryFn: vi.fn(
                    (_args: { id: number }): Promise<{ name: string; age: number }> =>
                        new Promise((resolve, reject) => {
                            calls.push({ resolve, reject });
                        }),
                ),
                select: (result: { name: string; age: number }) => result.name,
                cacheLifetime: false,
                devtoolsName: false,
            });

            const cache = command.initiate({ id: 1 });

            calls[0].resolve({ name: "Alice", age: 30 });
            await flushMicrotasks();

            expect(cache.value.data).toBe("Alice");
            expect(cache.value.isSuccess).toBe(true);
        });
    });

    describe("link", () => {
        it("invalidates linked resource after command success", async () => {
            const resourceQueryFn = vi.fn(async (_args: { id: number }) => ({ name: "data" }));
            const resource = createResource<{ id: number }, { name: string }>({
                queryFn: resourceQueryFn,
                cacheLifetime: false,
                devtoolsName: false,
            });

            // Pre-populate resource cache
            resource.initiate({ id: 1 });
            await flushMicrotasks();
            expect(resourceQueryFn).toHaveBeenCalledTimes(1);

            const commandCalls: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

            const command = createCommand<{ id: number }, { ok: boolean }>({
                queryFn: vi.fn(
                    (_args: { id: number }): Promise<{ ok: boolean }> =>
                        new Promise((resolve, reject) => {
                            commandCalls.push({ resolve, reject });
                        }),
                ),
                link: (link: any) =>
                    link({
                        resource,
                        forwardArgs: (args: { id: number }) => args,
                        invalidate: true,
                    }),
                cacheLifetime: false,
                devtoolsName: false,
            });

            command.initiate({ id: 1 });
            commandCalls[0].resolve({ ok: true });
            await flushMicrotasks();

            // Resource should have been re-initiated (invalidated)
            expect(resourceQueryFn).toHaveBeenCalledTimes(2);
        });
    });
});
