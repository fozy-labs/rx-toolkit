import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { SKIP } from "@/query/constants";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig, TResourceClutchState } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    });
}

// Collect state via reactive effect — tracks cleanup automatically
const _effects: Array<{ unsubscribe: () => void }> = [];

function observe<TArgs, TData>(clutch: { state$: () => TResourceClutchState<TArgs, TData> }) {
    let latest!: TResourceClutchState<TArgs, TData>;
    const eff = Signal.effect(() => {
        latest = clutch.state$();
    });
    _effects.push(eff);
    return { get: () => latest };
}

afterEach(() => {
    // Always unsubscribe effects BEFORE any resource.reset() to avoid
    // infinite reactive loop in getEntry$(args, true) re-creation.
    while (_effects.length) _effects.pop()!.unsubscribe();
});

// ==================== 1. start(args) — state transitions ====================

describe("ResourceClutch.start(args)", () => {
    it("idle → pending → success", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        expect(s.get().status).toBe("idle");

        clutch.switch(1);
        clutch.start();
        expect(s.get().status).toBe("pending");

        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
        expect(s.get().args).toBe(1);
    });
});

// ==================== 2. switch(args) — lazy, no fetch ====================

describe("ResourceClutch.switch(args)", () => {
    it("does not start a fetch (lazy)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });
        const clutch = resource.createClutch();
        observe(clutch);

        clutch.switch(1);
        await flushMicrotasks();
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("reflects existing cache entry", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        resource.trigger(1);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
    });
});

// ==================== 3. start(SKIP) — reset to idle ====================

describe("ResourceClutch.start(SKIP)", () => {
    it("resets to idle", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");

        clutch.switch(SKIP);
        expect(s.get().status).toBe("idle");
        expect(s.get().data).toBeNull();
        expect(s.get().args).toBeNull();
    });

    it("clears previous entry — no SWR after SKIP", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        clutch.switch(SKIP);

        // switch(2) after SKIP should be "pending" (no stale A data)
        clutch.switch(2);
        expect(s.get().status).toBe("pending");
        expect(s.get().data).toBeNull();
    });
});

// ==================== 4. SWR on args change ====================

describe("ResourceClutch SWR", () => {
    it("stale data from A while B loads (invalidating status)", async () => {
        let resolveB!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("data-A");
                return new Promise((r) => {
                    resolveB = r;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("data-A");

        clutch.switch(2);
        expect(s.get().status).toBe("invalidating");
        expect(s.get().data).toBe("data-A");

        resolveB("data-B");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-B");
    });

    it("isSwitching + dataArgs: args switch vs an invalidation of the same entry", async () => {
        let resolveB!: (v: string) => void;
        let resolveInvalidate!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("data-A");
                if (callCount === 2) {
                    return new Promise((r) => {
                        resolveB = r;
                    });
                }
                return new Promise((r) => {
                    resolveInvalidate = r;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().isSwitching).toBe(false);
        expect(s.get().dataArgs).toBe(1);

        // Args switch: B loads behind A's data.
        clutch.switch(2);
        let st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isRefreshing).toBe(true);
        expect(st.isSwitching).toBe(true);
        expect(st.args).toBe(2);
        expect(st.dataArgs).toBe(1);
        expect(st.data).toBe("data-A");

        resolveB("data-B");
        await flushMicrotasks();
        st = s.get();
        expect(st.status).toBe("success");
        expect(st.isSwitching).toBe(false);
        expect(st.dataArgs).toBe(2);

        // An invalidation of the same entry: still `invalidating`, but not a switch.
        clutch.invalidate();
        st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isRefreshing).toBe(true);
        expect(st.isSwitching).toBe(false);
        expect(st.args).toBe(2);
        expect(st.dataArgs).toBe(2);
        expect(st.data).toBe("data-B");

        resolveInvalidate("data-B2");
        await flushMicrotasks();
        st = s.get();
        expect(st.status).toBe("success");
        expect(st.isSwitching).toBe(false);
        expect(st.dataArgs).toBe(2);
    });

    it("dataArgs keeps pointing at the surviving stale entry across multiple arg changes", async () => {
        let resolveC!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("data-A");
                if (callCount === 2) return new Promise(() => {});
                return new Promise((r) => {
                    resolveC = r;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();

        clutch.switch(2);
        clutch.switch(3);
        expect(s.get().isSwitching).toBe(true);
        expect(s.get().args).toBe(3);
        expect(s.get().dataArgs).toBe(1);

        resolveC("data-C");
        await flushMicrotasks();
        expect(s.get().isSwitching).toBe(false);
        expect(s.get().dataArgs).toBe(3);
    });

    it("keeps stale data across multiple arg changes before the middle request settles", async () => {
        let resolveB!: (v: string) => void;
        let resolveC!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;

                if (callCount === 1) return Promise.resolve("data-A");

                if (callCount === 2) {
                    return new Promise((resolve) => {
                        resolveB = resolve;
                    });
                }

                return new Promise((resolve) => {
                    resolveC = resolve;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-A");

        clutch.switch(2);
        expect(s.get().status).toBe("invalidating");
        expect(s.get().data).toBe("data-A");

        clutch.switch(3);
        expect(s.get().status).toBe("invalidating");
        expect(s.get().data).toBe("data-A");

        resolveC("data-C");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-C");

        resolveB("data-B");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-C");
    });
});

// ==================== 5. Error + previous data ====================

describe("ResourceClutch error + previous data", () => {
    it("on error, stale data from previous entry is preserved", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (_n: number) => {
                callCount++;
                if (callCount === 1) return "data-A";
                throw new Error("fail");
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("data-A");

        clutch.switch(2);
        await flushMicrotasks();
        expect(s.get().status).toBe("error");
        expect(s.get().data).toBe("data-A");
        expect(s.get().error).toBeInstanceOf(Error);
        // The switch is over: the flag reflects the process, not the data origin.
        expect(s.get().isSwitching).toBe(false);
        expect(s.get().args).toBe(2);
        expect(s.get().dataArgs).toBe(1);
    });

    it("error without previous data: dataArgs is null", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("error");
        expect(s.get().data).toBeNull();
        expect(s.get().dataArgs).toBeNull();
    });

    it("error field tracks the most recent error", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("err-1");
                return "ok";
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().error).toBeInstanceOf(Error);
        expect((s.get().error as Error).message).toBe("err-1");
    });
});

// ==================== 6. retry() / invalidate() delegation ====================

describe("ResourceClutch.retry() / .invalidate()", () => {
    it("retry after error: pending with isRetrying, dropped on settle", async () => {
        let callCount = 0;
        let resolveRetry!: (v: string) => void;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(new Error("boom"));
                return new Promise((r) => {
                    resolveRetry = r;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        expect(s.get().isRetrying).toBe(false);
        await flushMicrotasks();
        expect(s.get().status).toBe("error");
        expect(s.get().isRetrying).toBe(false);

        const failure = s.get().error;
        clutch.retry();
        let st = s.get();
        expect(st.status).toBe("pending");
        expect(st.isInitialLoading).toBe(true);
        expect(st.isRetrying).toBe(true);
        expect(st.isError).toBe(false);
        expect(st.data).toBeNull();
        // The failure stays readable while the retry is in flight.
        expect(st.error).toBe(failure);

        resolveRetry("ok");
        await flushMicrotasks();
        st = s.get();
        expect(st.status).toBe("success");
        expect(st.isRetrying).toBe(false);
        expect(st.error).toBeNull();
    });

    it("retry after invalidate-error: invalidating with isRetrying and the stale data; invalidate() is not a retry", async () => {
        let callCount = 0;
        const pending: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.resolve("d-1");
                return new Promise((resolve, reject) => {
                    pending.push({ resolve, reject });
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");

        clutch.invalidate();
        pending.shift()!.reject(new Error("invalidation failed"));
        await flushMicrotasks();
        expect(s.get().status).toBe("invalidate-error");
        expect(s.get().isRetrying).toBe(false);

        const failure = s.get().error;
        clutch.retry();
        let st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isRefreshing).toBe(true);
        expect(st.isInitialLoading).toBe(false);
        expect(st.isRetrying).toBe(true);
        expect(st.isSwitching).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.data).toBe("d-1");
        expect(st.error).toBe(failure);

        pending.shift()!.reject(new Error("failed again"));
        await flushMicrotasks();
        expect(s.get().status).toBe("invalidate-error");
        expect(s.get().isRetrying).toBe(false);

        clutch.invalidate();
        st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isRetrying).toBe(false);
        expect(st.error).toBeNull();
        expect(st.data).toBe("d-1");

        pending.shift()!.resolve("d-2");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-2");
        expect(s.get().isRetrying).toBe(false);
    });

    it("retry after an error under SWR: switching and retrying at once", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("data-A");
                if (callCount === 2) return Promise.reject(new Error("B failed"));
                return new Promise(() => {});
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();

        clutch.switch(2);
        await flushMicrotasks();
        expect(s.get().status).toBe("error");
        expect(s.get().data).toBe("data-A");

        const failure = s.get().error;
        clutch.retry();
        const st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isSwitching).toBe(true);
        expect(st.isRetrying).toBe(true);
        expect(st.error).toBe(failure);
        expect(st.data).toBe("data-A");
        expect(st.dataArgs).toBe(1);
        expect(st.args).toBe(2);
    });

    it("retry re-executes the failed query", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("error");

        clutch.retry();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("recovered");
    });

    it("invalidate() triggers a background refetch", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-1");

        clutch.invalidate();
        expect(s.get().status).toBe("invalidating");

        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });

    it("retry/invalidate are no-ops on idle clutch", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const clutch = resource.createClutch();
        expect(() => clutch.retry()).not.toThrow();
        expect(() => clutch.invalidate()).not.toThrow();
    });
});

// ==================== 7. dispose (effect cleanup) ====================

describe("ResourceClutch dispose", () => {
    it("stops tracking after effect is unsubscribed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const clutch = resource.createClutch();
        const statuses: string[] = [];
        const eff = Signal.effect(() => {
            statuses.push(clutch.state$().status);
        });
        _effects.push(eff); // still pushed for afterEach safety

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        const countBefore = statuses.length;

        eff.unsubscribe();

        clutch.switch(2);
        await flushMicrotasks();
        expect(statuses.length).toBe(countBefore);
    });
});

// ==================== 8. resetAll on active clutch ====================

describe("ResourceClutch reset() on active clutch (regression)", () => {
    it("resource.reset() while clutch is subscribed does not cause infinite loop", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (n: number) => {
                callCount++;
                return `d-${n}`;
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(callCount).toBe(1);

        // reset() used to trigger an infinite reactive loop where getEntry$
        // kept recreating entries after cache clear.
        resource.reset();
        await flushMicrotasks();

        // The clutch should recover to idle or re-fetch — NOT spin forever.
        // A bounded call-count check acts as the loop detector.
        expect(callCount).toBeLessThanOrEqual(3);
        expect(["idle", "pending", "success"]).toContain(s.get().status);
    });
});

// ==================== 9. switch() then start() ====================

describe("ResourceClutch switch() then start()", () => {
    it("transitions from lazy to eager (triggers the fetch)", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        await flushMicrotasks();
        expect(queryFn).not.toHaveBeenCalled();

        clutch.start();
        expect(queryFn).toHaveBeenCalledTimes(1);

        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
    });
});

// ==================== 10. Early return ====================

describe("ResourceClutch early return", () => {
    it("switch() with same args is a no-op (no new fetch)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });
        const clutch = resource.createClutch();
        observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(1);

        clutch.switch(1);
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("switch() with same args is a no-op", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        const st1 = s.get().status;
        clutch.switch(1);
        expect(s.get().status).toBe(st1);
    });
});

// ==================== 11. state$ property flags ====================

describe("ResourceClutch state$ flags", () => {
    it("idle: all flags false, data/error null", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        const st = s.get();
        expect(st.status).toBe("idle");
        expect(st.isLoading).toBe(false);
        expect(st.isInitialLoading).toBe(false);
        expect(st.isRefreshing).toBe(false);
        expect(st.isRefreshError).toBe(false);
        expect(st.isSuccess).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.isSwitching).toBe(false);
        expect(st.isRetrying).toBe(false);
        expect(st.data).toBeNull();
        expect(st.error).toBeNull();
        expect(st.dataArgs).toBeNull();
    });

    it("pending: isLoading=true, isInitialLoading=true", async () => {
        let resolve!: (v: string) => void;
        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        const st = s.get();
        expect(st.status).toBe("pending");
        expect(st.isLoading).toBe(true);
        expect(st.isInitialLoading).toBe(true);
        expect(st.isRefreshing).toBe(false);
        expect(st.isSwitching).toBe(false);
        expect(st.isRetrying).toBe(false);
        expect(st.isSuccess).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.dataArgs).toBeNull();

        resolve("done");
        await flushMicrotasks();
    });

    it("success: isSuccess=true, has data", async () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();

        const st = s.get();
        expect(st.status).toBe("success");
        expect(st.isSuccess).toBe(true);
        expect(st.isLoading).toBe(false);
        expect(st.isRefreshing).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.data).toBe("data");
    });

    it("error: isError=true", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();

        const st = s.get();
        expect(st.status).toBe("error");
        expect(st.isError).toBe(true);
        expect(st.isSuccess).toBe(false);
        expect(st.isLoading).toBe(false);
        expect(st.error).toBeInstanceOf(Error);
    });

    it("invalidating: isRefreshing=true, isLoading=true, isInitialLoading=false", async () => {
        let callCount = 0;
        let resolveInvalidate!: (v: string) => void;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("d-1");
                return new Promise((r) => {
                    resolveInvalidate = r;
                });
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");

        // Trigger SWR via args switch
        clutch.switch(2);
        const st = s.get();
        expect(st.status).toBe("invalidating");
        expect(st.isRefreshing).toBe(true);
        expect(st.isLoading).toBe(true);
        expect(st.isInitialLoading).toBe(false);
        expect(st.isSwitching).toBe(true);
        expect(st.isRetrying).toBe(false);
        expect(st.data).toBe("d-1");
        expect(st.dataArgs).toBe(1);

        resolveInvalidate("d-2");
        await flushMicrotasks();
    });

    it("state$ delegates retry() and invalidate()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-1");

        // Use the state object's invalidate delegate
        s.get().invalidate();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });
});

// ==================== 12. Non-last entry removal (N1 regression) ====================
//
// The clutch holds its tracked entry through `current$` (a getEntry$ signal). When
// the tracked entry is NOT the last one created and is removed while the clutch is
// unmounted (state$ read only via peek — no live subscription), current$ keeps
// yielding the completed entry. Callers that then read `entry.machine$.peek()`
// (retry / invalidate / _promoteToPrevious in _deriveState / switch) hit a disposed
// state and throw "No value emitted". These are RED on the current code and GREEN
// once the cache is reactive (current$.peek() becomes null → the optional chains
// short-circuit into no-ops).
describe("ResourceClutch — non-last entry removal (N1 regression)", () => {
    it("switch() to new args does not throw when the tracked NON-last entry was removed (unmounted)", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        // Two live entries; key 2 created last, so key 1 is the non-last entry.
        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1); // track key 1 — unmounted (state$ never observed) and unstarted

        // Prime the clutch's internal current$ memo with the live entry 1.
        expect(clutch.state$.peek().data).toBe("d-1");

        // Remove the non-last entry. current$ does not observe the removal, so
        // _promoteToPrevious later reads machine$.peek() on the disposed entry.
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(() => clutch.switch(3)).not.toThrow();
    });

    it("retry()/invalidate() are no-throw no-ops when the tracked NON-last entry was removed (unmounted)", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        expect(clutch.state$.peek().data).toBe("d-1"); // prime current$ with the live entry

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // retry/invalidate read current$.peek()?.machine$.peek(); on a stale completed
        // entry that peek throws. After the fix current$.peek() is null → no-op.
        expect(() => clutch.retry()).not.toThrow();
        expect(() => clutch.invalidate()).not.toThrow();
    });

    it("reading state$ does not throw after the tracked NON-last entry is removed (unmounted)", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        expect(clutch.state$.peek().data).toBe("d-1"); // prime current$

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // _deriveState → tracking.current$() returns the stale completed entry →
        // entry.machine$() throws. After the fix current$ yields null and the clutch
        // degrades to an idle-like state instead of throwing.
        expect(() => clutch.state$.peek()).not.toThrow();
    });
});

// ==================== 13. Stale re-create on rapid args change (microtask) ====================
//
// _deriveState schedules a deferred re-create — queueMicrotask(getEntry(tracking.keyed, true)) —
// when the clutch is started and its tracked entry is absent (evicted-while-tracked). The
// captured `tracking` is the key at schedule time. If args advance within the SAME tick before
// the microtask fires, the stale key must NOT be re-created: it would spawn a phantom cache entry
// and a fetch for args nobody tracks anymore. Guarded by a live-tracking (key) re-check.
describe("ResourceClutch — stale re-trigger on rapid args change (microtask)", () => {
    it("does not trigger the evicted-then-superseded key when args advance within one tick", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        // Two live entries so key 1 is the NON-last entry → its removal is reactive
        // (getEntry$ yields null), which is what drives the "entry null + started" branch.
        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        clutch.start(); // _isStarted = true, tracks key 1
        expect(clutch.state$.peek().status).toBe("success"); // prime current$ with live entry 1

        resource.getEntry(1)!.complete(); // evict the tracked entry
        await flushMicrotasks();

        const createSpy = vi.spyOn(resource, "getEntry");

        // Derive hits "entry null + started" → queues microtask(getEntry(key 1, true)).
        expect(clutch.state$.peek().status).toBe("pending");

        // Args advance to 3 within the SAME tick, before the queued microtask fires.
        clutch.switch(3);

        await flushMicrotasks();

        // The queued microtask must NOT re-create the stale key 1.
        const staleCalls = createSpy.mock.calls.filter(
            ([keyed, doInitiate]) => doInitiate === true && (keyed as { value: number }).value === 1,
        );
        expect(staleCalls).toHaveLength(0);
    });

    it("re-triggers the same key after eviction when args are unchanged", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const clutch = resource.createClutch();
        clutch.switch(1);
        clutch.start();
        expect(clutch.state$.peek().status).toBe("success");

        resource.getEntry(1)!.complete(); // evict the tracked entry
        await flushMicrotasks();

        const createSpy = vi.spyOn(resource, "getEntry");
        expect(clutch.state$.peek().status).toBe("pending"); // queues microtask(getEntry(key 1, true))
        // args unchanged
        await flushMicrotasks();

        const recreated = createSpy.mock.calls.some(
            ([keyed, doInitiate]) => doInitiate === true && (keyed as { value: number }).value === 1,
        );
        expect(recreated).toBe(true);
    });
});

// ==================== 13. Deprecated aliases ====================

describe("ResourceClutch — deprecated aliases", () => {
    it("set(args, mark) forwards to switch(args, { markPending: mark })", () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const clutch = resource.createClutch();
        const switchSpy = vi.spyOn(clutch, "switch");

        clutch.set(1, true);
        expect(switchSpy).toHaveBeenCalledTimes(1);
        expect(switchSpy).toHaveBeenLastCalledWith(1, { markPending: true });

        clutch.set(2);
        expect(switchSpy).toHaveBeenCalledTimes(2);
        expect(switchSpy).toHaveBeenLastCalledWith(2, { markPending: false });
    });

    it("set(args, true) marks an unstarted clutch as pending, exactly as markPending does", () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        const marked = resource.createClutch();
        const markedState = observe(marked);
        marked.set(1, true);
        expect(markedState.get().status).toBe("pending");

        const unmarked = resource.createClutch();
        const unmarkedState = observe(unmarked);
        unmarked.set(1);
        expect(unmarkedState.get().status).toBe("idle");
    });

    it("refresh() forwards to invalidate(), including through a destructured reference", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-1");

        const invalidateSpy = vi.spyOn(clutch, "invalidate");
        const { refresh } = clutch;
        refresh();

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(s.get().status).toBe("invalidating");

        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });

    it("state$ exposes refresh as a forwarder to invalidate", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const clutch = resource.createClutch();
        const s = observe(clutch);

        // Idle state carries the alias too.
        expect(typeof s.get().refresh).toBe("function");

        clutch.switch(1);
        clutch.start();
        await flushMicrotasks();

        const invalidateSpy = vi.spyOn(clutch, "invalidate");
        s.get().refresh();

        expect(invalidateSpy).toHaveBeenCalledTimes(1);
        expect(s.get().status).toBe("invalidating");

        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });
});
