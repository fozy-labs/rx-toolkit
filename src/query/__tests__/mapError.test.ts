import { assertType, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TErrorContext } from "@/query/types";

// ==================== Fixtures ====================

/** A typed transport error the consumer wants to keep as-is. */
class NetError extends Error {
    readonly kind = "net" as const;
    constructor(readonly status: number) {
        super(`net ${status}`);
        this.name = "NetError";
    }
    static is(value: unknown): value is NetError {
        return value instanceof NetError;
    }
}

/** Fallback wrapper for anything that is not already a NetError. */
class NetUnknownError extends Error {
    readonly kind = "net-unknown" as const;
    constructor(readonly original: unknown) {
        super("net unknown");
        this.name = "NetUnknownError";
    }
}

const toNetError = (error: unknown): NetError | NetUnknownError =>
    NetError.is(error) ? error : new NetUnknownError(error);

type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// ==================== Resource behavior ====================

describe("mapError — resource state", () => {
    it("maps an initial query failure and surfaces it on getState", async () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const state = resource.getState(1);
        expect(state.isError).toBe(true);
        expect(state.error).toBeInstanceOf(NetUnknownError);
        expect((state.error as NetUnknownError).original).toBeInstanceOf(Error);
    });

    it("keeps a NetError untouched (the mapper's identity branch)", async () => {
        const api = createApi({ mapError: toNetError });
        const cause = new NetError(503);
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw cause;
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getState(1).error).toBe(cause);
    });

    it("stores the exact instance the mapper produced (not the raw error)", async () => {
        let produced: NetUnknownError | undefined;
        const api = createApi({
            mapError: (error) => (produced = new NetUnknownError(error)),
        });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new Error("raw");
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(produced).toBeInstanceOf(NetUnknownError);
        expect(resource.getState(1).error).toBe(produced);
    });

    it("maps a refresh failure into refresh-error while keeping stale data", async () => {
        let calls = 0;
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                calls += 1;
                if (calls === 1) return "good";
                throw new NetError(500);
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getState(1).status).toBe("success");

        resource.refresh(1);
        await flushMicrotasks();

        const state = resource.getState(1);
        expect(state.status).toBe("refresh-error");
        expect(state.isRefreshError).toBe(true);
        expect(state.data).toBe("good");
        expect(state.error).toBeInstanceOf(NetError);
    });

    it("maps the fresh error produced by a retry", async () => {
        let calls = 0;
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                calls += 1;
                throw new NetError(calls);
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect((resource.getState(1).error as NetError).status).toBe(1);

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect((resource.getState(1).error as NetError).status).toBe(2);
    });
});

// ==================== Resource agent + imperative fetch ====================

describe("mapError — resource agent and imperative fetch", () => {
    it("surfaces the mapped error on the agent state", async () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new NetError(418);
            },
            retentionTime: false,
        });

        const agent = resource.createAgent();
        agent.set(1, true);
        agent.start();
        await flushMicrotasks();
        await flushMicrotasks();

        const state = agent.state$.peek();
        expect(state.isError).toBe(true);
        expect(state.error).toBeInstanceOf(NetError);
    });

    it("rejects ensure() with the mapped error", async () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new Error("down");
            },
            retentionTime: false,
        });

        await expect(resource.ensure(1)).rejects.toBeInstanceOf(NetUnknownError);
    });

    it("rejects fetch() with the mapped error", async () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new NetError(502);
            },
            retentionTime: false,
        });

        await expect(resource.fetch(1)).rejects.toBeInstanceOf(NetError);
    });
});

// ==================== Provenance context ====================

describe("mapError — context", () => {
    it("passes source/args/entryKey/key for a resource", async () => {
        const mapError = vi.fn((error: unknown, _ctx: TErrorContext) => error);
        const api = createApi({ mapError });
        const resource = api.createResource<{ id: number }, string>({
            key: "users",
            queryFn: async () => {
                throw new Error("x");
            },
            retentionTime: false,
        });

        resource.trigger({ id: 7 });
        await flushMicrotasks();

        expect(mapError).toHaveBeenCalledTimes(1);
        const ctx = mapError.mock.calls[0]![1];
        expect(ctx.source).toBe("query");
        expect(ctx.args).toEqual({ id: 7 });
        expect(ctx.key).toBe("users");
        expect(typeof ctx.entryKey).toBe("string");
    });

    it("reports source 'command' for a command failure", async () => {
        const mapError = vi.fn((error: unknown, _ctx: TErrorContext) => error);
        const api = createApi({ mapError });
        const command = api.createCommand<string, string>({
            key: "saveUser",
            queryFn: async () => {
                throw new Error("x");
            },
        });

        await command.trigger("payload", "k1").catch(() => {});
        await flushMicrotasks();

        expect(mapError).toHaveBeenCalledTimes(1);
        const ctx = mapError.mock.calls[0]![1];
        expect(ctx.source).toBe("command");
        expect(ctx.args).toBe("payload");
        expect(ctx.key).toBe("saveUser");
    });
});

// ==================== Robustness ====================

describe("mapError — robustness", () => {
    it("does not call mapError for an aborted run", async () => {
        const mapError = vi.fn((error: unknown) => new NetUnknownError(error));
        const api = createApi({ mapError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
            retentionTime: false,
        });

        resource.trigger(1);
        // Abort the in-flight run before its rejection is processed.
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(mapError).not.toHaveBeenCalled();
    });

    it("falls back to the raw error and logs when the mapper itself throws", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const raw = new Error("original");
        const api = createApi({
            mapError: () => {
                throw new Error("mapper broke");
            },
        });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw raw;
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const state = resource.getState(1);
        expect(state.isError).toBe(true);
        expect(state.error).toBe(raw);
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it("is a no-op (identity) when no mapper is configured", async () => {
        const api = createApi();
        const raw = new Error("verbatim");
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw raw;
            },
            retentionTime: false,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getState(1).error).toBe(raw);
    });

    it("leaves the lifecycle $queryFulfilled rejection raw (pre-mapError)", async () => {
        const raw = new Error("raw-lifecycle");
        let fulfilledError: unknown;
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: async () => {
                throw raw;
            },
            retentionTime: false,
            onQueryStarted: async (_args, ctx) => {
                try {
                    await ctx.$queryFulfilled;
                } catch (error) {
                    fulfilledError = error;
                }
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        await flushMicrotasks();

        // The state is normalized...
        expect(resource.getState(1).error).toBeInstanceOf(NetUnknownError);
        // ...but the low-level lifecycle promise reflects the untouched query outcome.
        expect(fulfilledError).toBe(raw);
    });
});

// ==================== Command behavior ====================

describe("mapError — command", () => {
    it("maps the command result envelope error", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: async () => {
                throw new NetError(400);
            },
        });

        const agent = command.createAgent();
        const result = await agent.trigger("x");

        expect(result.status).toBe("error");
        expect(result.error).toBeInstanceOf(NetError);
    });

    it("maps the rejection from the agent trigger's unwrap()", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        const agent = command.createAgent();
        await expect(agent.trigger("x").unwrap()).rejects.toBeInstanceOf(NetUnknownError);
    });

    it("maps the raw Command.execute rejection", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: async () => {
                throw new NetError(409);
            },
        });

        await expect(command.execute("x", "k1")).rejects.toBeInstanceOf(NetError);
    });

    it("maps a failed async generateRequestId", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: async () => "ok",
            generateRequestId: async () => {
                throw new Error("mint failed");
            },
        });

        const agent = command.createAgent();
        const result = await agent.trigger("x");

        expect(result.status).toBe("error");
        expect(result.error).toBeInstanceOf(NetUnknownError);
    });

    it("maps a throwing optimistic-patch update", async () => {
        const api = createApi({ mapError: toNetError });

        const target = api.createResource<number, string>({
            queryFn: async () => "seed",
            retentionTime: false,
        });
        target.trigger(1);
        await flushMicrotasks();

        const command = api.createCommand<number, string>({
            queryFn: async () => "done",
            links: (link) =>
                link({
                    resource: target,
                    forwardArgs: (args) => args,
                    optimisticUpdate: () => {
                        throw new Error("patch boom");
                    },
                }),
        });

        const agent = command.createAgent();
        const result = await agent.trigger(1);

        expect(result.status).toBe("error");
        expect(result.error).toBeInstanceOf(NetUnknownError);
    });
});

// ==================== Command entry removal ====================

describe("mapError — command entry removal", () => {
    it("maps the eviction error when a re-trigger with the same key replaces an in-flight mutation", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        const agent = command.createAgent();
        const first = agent.trigger("a", "k");
        void agent.trigger("b", "k");

        const result = await first;
        expect(result.status).toBe("error");
        expect(result.error).toBeInstanceOf(NetUnknownError);
        expect((result.error as NetUnknownError).original).toBeInstanceOf(CacheEntryRemovedError);
    });

    it("maps the removal error when resetAll() completes an in-flight mutation", async () => {
        const api = createApi({ mapError: toNetError });
        const command = api.createCommand<string, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        const pending = command.execute("x", "k");
        void pending.catch(() => {});
        api.resetAll();

        await expect(pending).rejects.toBeInstanceOf(NetUnknownError);
    });

    it("passes command provenance when mapping a removal error", async () => {
        const mapError = vi.fn((error: unknown, _ctx: TErrorContext) => new NetUnknownError(error));
        const api = createApi({ mapError });
        const command = api.createCommand<string, string>({
            key: "saveUser",
            queryFn: () => new Promise<string>(() => {}),
        });

        const first = command.execute("a", "k");
        void first.catch(() => {});
        void command.execute("b", "k");

        await expect(first).rejects.toBeInstanceOf(NetUnknownError);
        expect(mapError).toHaveBeenCalledTimes(1);
        const ctx = mapError.mock.calls[0]![1];
        expect(ctx).toEqual({ source: "command", args: "a", entryKey: "k", key: "saveUser" });
    });

    it("keeps the resource ensure() removal rejection raw (untyped channel)", async () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
            retentionTime: false,
        });

        const pending = resource.ensure(1);
        void pending.catch(() => {});
        api.resetAll();

        await expect(pending).rejects.toBeInstanceOf(CacheEntryRemovedError);
    });
});

// ==================== Type-level ====================

describe("mapError — type-level", () => {
    it("infers TError from the mapper's return type onto resource state", () => {
        const api = createApi({ mapError: toNetError });
        const resource = api.createResource({
            queryFn: async (_args: number): Promise<string> => "d",
        });

        type Err = ReturnType<typeof resource.getState>["error"];
        assertType<IsExact<Err, NetError | NetUnknownError | null>>(true as const);
    });

    it("defaults TError to unknown when no mapper is configured", () => {
        const api = createApi();
        const resource = api.createResource({
            queryFn: async (_args: number): Promise<string> => "d",
        });

        type Err = ReturnType<typeof resource.getState>["error"];
        assertType<IsExact<Err, unknown>>(true as const);
    });

    it("types the React hook's error field via the plugin + mapError", () => {
        const api = createApi({ plugins: [reactHooksPlugin()], mapError: toNetError });
        const resource = api.createResource({
            queryFn: async (_args: number): Promise<string> => "d",
        });

        type Err = ReturnType<typeof resource.useResource>["error"];
        assertType<IsExact<Err, NetError | NetUnknownError | null>>(true as const);
    });

    it("types the command result envelope error via the plugin + mapError", () => {
        const api = createApi({ plugins: [reactHooksPlugin()], mapError: toNetError });
        const command = api.createCommand({
            queryFn: async (_args: string): Promise<number> => 1,
        });

        // Derive the types without invoking the hook (it is not inside a component).
        type Trigger = ReturnType<typeof command.useCommand>[0];
        type Result = Awaited<ReturnType<Trigger>>;
        type ErrorVariant = Extract<Result, { status: "error" }>;
        assertType<IsExact<ErrorVariant["error"], NetError | NetUnknownError>>(true as const);
    });
});
