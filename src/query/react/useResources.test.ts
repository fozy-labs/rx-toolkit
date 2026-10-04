import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { IResource, TResourceClutchIdleState, TResourceClutchState, TResourcesState } from "@/query/types";

import { flushMicrotasks } from "../../__tests__/helpers/async-helpers";

import { useResources } from "./useResources";
import { useSuspenseResources } from "./useSuspenseResources";

// ==================== Helpers ====================

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type TUser = { id: number; name: string };
type TStats = { posts: number };

/** A resource whose every query hangs until the test settles it, keyed by `id`. */
function controlled<TData>(api: ReturnType<typeof createApi>) {
    const calls: { id: number; deferred: Deferred<TData> }[] = [];
    const resource = api.createResource<{ id: number }, TData>({
        queryFn: ({ id }) => {
            const deferred = defer<TData>();
            calls.push({ id, deferred });
            return deferred.promise;
        },
    });
    /** The last query of `id`. */
    const last = (id: number) => [...calls].reverse().find((call) => call.id === id)!.deferred;
    return { resource, calls, last };
}

function setup() {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const users = controlled<TUser>(api);
    const stats = controlled<TStats>(api);
    return { api, users, stats };
}

async function flush(fn?: () => void): Promise<void> {
    await act(async () => {
        await flushMicrotasks();
        fn?.();
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ==================== Record ====================

describe("useResources — record", () => {
    it("starts every slot, is pending until all settle, then success with named data", async () => {
        const { users, stats } = setup();

        const { result } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) }),
        );

        expect(users.calls).toHaveLength(1);
        expect(stats.calls).toHaveLength(1);
        expect(result.current).toMatchObject({
            status: "pending",
            isIdle: false,
            isPending: true,
            isInitialLoading: true,
            hasData: false,
            data: null,
            hasError: false,
            error: null,
        });
        expect(result.current.states.user.status).toBe("pending");

        await flush(() => users.last(1).resolve({ id: 1, name: "Ada" }));

        expect(result.current.status).toBe("pending");
        expect(result.current.hasData).toBe(false);
        expect(result.current.states.user).toMatchObject({ status: "success", data: { id: 1, name: "Ada" } });

        await flush(() => stats.last(1).resolve({ posts: 3 }));

        expect(result.current).toMatchObject({
            status: "success",
            isPending: false,
            hasData: true,
            data: { user: { id: 1, name: "Ada" }, stats: { posts: 3 } },
        });
        expect(Object.keys(result.current.data!)).toEqual(["user", "stats"]);
    });

    it("keeps the data identity across re-renders and status flips", async () => {
        const { users, stats } = setup();
        const { result, rerender } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) }),
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "Ada" });
            stats.last(1).resolve({ posts: 3 });
        });

        const data = result.current.data;
        rerender();
        expect(result.current.data).toBe(data);

        act(() => result.current.invalidate());
        expect(result.current.status).toBe("pending");
        expect(result.current.isInvalidating).toBe(true);
        expect(result.current.data).toBe(data);
    });

    it("keeps SWR per named slot across an args change, and leaves the other slot as it is", async () => {
        const { users, stats } = setup();
        const { result, rerender } = renderHook(
            ({ id }) => useResources({ user: users.resource.bind({ id }), stats: stats.resource.bind({ id: 1 }) }),
            { initialProps: { id: 1 } },
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "Ada" });
            stats.last(1).resolve({ posts: 3 });
        });
        const statsData = result.current.states.stats.data;

        rerender({ id: 2 });
        await flush();

        expect(stats.calls).toHaveLength(1);
        expect(result.current.states.stats).toMatchObject({ status: "success", isPending: false });
        expect(result.current.states.stats.data).toBe(statsData);
        expect(result.current.states.user).toMatchObject({
            status: "pending",
            dataSource: "previous",
            data: { id: 1, name: "Ada" },
            isSwitching: true,
        });
        expect(result.current).toMatchObject({ status: "pending", isSwitching: true, hasData: true });
        expect(result.current.data!.user).toEqual({ id: 1, name: "Ada" });

        await flush(() => users.last(2).resolve({ id: 2, name: "Grace" }));

        expect(result.current.status).toBe("success");
        expect(result.current.data!.user).toEqual({ id: 2, name: "Grace" });
    });

    it("named slots that converge on one uncached query each keep their own stale data", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(
            ({ left, right }) =>
                useResources({ left: users.resource.bind({ id: left }), right: users.resource.bind({ id: right }) }),
            { initialProps: { left: 1, right: 2 } },
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "Ada" });
            users.last(2).resolve({ id: 2, name: "Bob" });
        });

        rerender({ left: 3, right: 3 });
        await flush();

        expect(users.calls.filter((call) => call.id === 3)).toHaveLength(1);
        expect(result.current.states.left).toMatchObject({ isSwitching: true, data: { id: 1, name: "Ada" } });
        expect(result.current.states.right).toMatchObject({ isSwitching: true, data: { id: 2, name: "Bob" } });

        await flush(() => users.last(3).resolve({ id: 3, name: "Cy" }));

        expect(result.current.data).toEqual({ left: { id: 3, name: "Cy" }, right: { id: 3, name: "Cy" } });
    });

    it("an inline record literal is the same slot set every render", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(() => useResources({ user: users.resource.bind({ id: 1 }) }));
        await flush(() => users.last(1).resolve({ id: 1, name: "Ada" }));
        const state = result.current;

        rerender();

        expect(result.current).toBe(state);
        expect(users.calls).toHaveLength(1);
    });
});

// ==================== Array ====================

describe("useResources — array", () => {
    it("maps a dynamic array in order", async () => {
        const { users } = setup();
        const { result } = renderHook(() => useResources([1, 2, 3].map((id) => users.resource.bind({ id }))));

        expect(users.calls.map((call) => call.id)).toEqual([1, 2, 3]);

        await flush(() => {
            users.last(3).resolve({ id: 3, name: "c" });
            users.last(1).resolve({ id: 1, name: "a" });
            users.last(2).resolve({ id: 2, name: "b" });
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data!.map((user) => user.name)).toEqual(["a", "b", "c"]);
        expect(result.current.states).toHaveLength(3);
    });

    it("keeps no positional SWR: a new id at an index loads with nothing to show", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(
            ({ ids }) => useResources(ids.map((id) => users.resource.bind({ id }))),
            { initialProps: { ids: [1, 2] } },
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "a" });
            users.last(2).resolve({ id: 2, name: "b" });
        });

        rerender({ ids: [1, 3] });
        await flush();

        expect(users.calls.map((call) => call.id)).toEqual([1, 2, 3]);
        expect(result.current.states[0]).toMatchObject({ status: "success", data: { id: 1, name: "a" } });
        expect(result.current.states[1]).toMatchObject({ status: "pending", dataSource: "none", data: null });
        expect(result.current).toMatchObject({ status: "pending", isInitialLoading: true, hasData: false, data: null });
    });

    it("an id that moves to another index keeps its data, with no re-query", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(
            ({ ids }) => useResources(ids.map((id) => users.resource.bind({ id }))),
            { initialProps: { ids: [1, 2] } },
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "a" });
            users.last(2).resolve({ id: 2, name: "b" });
        });
        const [first, second] = result.current.data!;

        rerender({ ids: [2, 1] });
        await flush();

        expect(users.calls).toHaveLength(2);
        expect(result.current.status).toBe("success");
        expect(result.current.data![0]).toBe(second);
        expect(result.current.data![1]).toBe(first);
        expect(result.current.data!.map((user) => user.name)).toEqual(["b", "a"]);
    });

    it("slots with the same resource and args share one clutch", async () => {
        const { users } = setup();
        const { result } = renderHook(() =>
            useResources([users.resource.bind({ id: 1 }), users.resource.bind({ id: 1 })]),
        );

        expect(users.calls).toHaveLength(1);
        await flush(() => users.last(1).resolve({ id: 1, name: "a" }));

        expect(result.current.states[0]).toBe(result.current.states[1]);
        expect(result.current.data).toEqual([
            { id: 1, name: "a" },
            { id: 1, name: "a" },
        ]);
    });
});

// ==================== Empty and SKIP ====================

describe("useResources — empty input and SKIP", () => {
    it.each([
        ["[]", [] as const, []],
        ["{}", {}, {}],
    ])("%s has data at once", (_, input, data) => {
        const { result } = renderHook(() => useResources(input));

        expect(result.current).toMatchObject({
            status: "success",
            isIdle: false,
            hasData: true,
            data,
            isPending: false,
        });
    });

    it("every slot SKIP is idle, with nothing queried", () => {
        const { users } = setup();
        const { result } = renderHook(() => useResources({ a: SKIP, b: SKIP }));

        expect(users.calls).toHaveLength(0);
        expect(result.current).toMatchObject({
            status: "idle",
            isIdle: true,
            hasData: false,
            data: null,
            isPending: false,
            hasError: false,
        });
        expect(result.current.states.a).toMatchObject({ status: "idle", args: null, data: null });
        expect(() => result.current.invalidate()).not.toThrow();
        expect(() => result.current.states.a.retry()).not.toThrow();
    });

    it("a SKIP slot does not block data and reads null in it", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(
            ({ enabled }) =>
                useResources({
                    user: users.resource.bind({ id: 1 }),
                    extra: enabled ? users.resource.bind({ id: 2 }) : SKIP,
                }),
            { initialProps: { enabled: false } },
        );
        await flush(() => users.last(1).resolve({ id: 1, name: "a" }));

        expect(result.current).toMatchObject({
            status: "success",
            hasData: true,
            data: { user: { id: 1, name: "a" }, extra: null },
        });

        rerender({ enabled: true });
        await flush();

        expect(users.calls.map((call) => call.id)).toEqual([1, 2]);
        expect(result.current).toMatchObject({ status: "pending", hasData: false, data: null });
    });

    it("throws a TypeError on a slot that is neither a bound resource nor SKIP", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { users } = setup();

        expect(() => renderHook(() => useResources({ user: users.resource as never }))).toThrow(
            /slot "user" is neither a bound resource/,
        );
    });

    it("throws a TypeError on a hole of a sparse array", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { users } = setup();
        const slots = new Array<ReturnType<typeof users.resource.bind>>(2);
        slots[1] = users.resource.bind({ id: 1 });

        expect(() => renderHook(() => useResources(slots))).toThrow(/slot "0" is neither a bound resource/);
    });

    it("a `__proto__` slot is an own slot of states and data", async () => {
        const { users } = setup();
        const { result } = renderHook(() => useResources({ ["__proto__"]: users.resource.bind({ id: 1 }) }));
        await flush(() => users.last(1).resolve({ id: 1, name: "Ada" }));

        expect(Object.keys(result.current.states)).toEqual(["__proto__"]);
        expect(Object.keys(result.current.data!)).toEqual(["__proto__"]);
        expect(Object.getPrototypeOf(result.current.data)).toBe(Object.prototype);
    });
});

// ==================== Aggregate status, errors, retry and invalidate ====================

describe("useResources — aggregate status and methods", () => {
    it("pending wins over error: a failed slot next to a loading one reads pending with hasError", async () => {
        const { users, stats } = setup();
        const { result } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) }),
        );
        const failure = new Error("stats down");

        await flush(() => stats.last(1).reject(failure));

        expect(result.current).toMatchObject({ status: "pending", isPending: true, hasError: true, error: failure });

        await flush(() => users.last(1).resolve({ id: 1, name: "a" }));

        expect(result.current).toMatchObject({
            status: "error",
            isPending: false,
            hasError: true,
            error: failure,
            hasData: false,
            data: null,
        });
    });

    it("error is the first slot error in slot order", async () => {
        const { users, stats } = setup();
        const { result } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) }),
        );
        const userFailure = new Error("user");
        const statsFailure = new Error("stats");

        await flush(() => stats.last(1).reject(statsFailure));
        await flush(() => users.last(1).reject(userFailure));

        expect(result.current.status).toBe("error");
        expect(result.current.error).toBe(userFailure);
    });

    it("retry re-runs only the failed slots and keeps the failure while pending", async () => {
        const { users, stats } = setup();
        const { result } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) }),
        );
        const failure = new Error("stats down");
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "a" });
            stats.last(1).reject(failure);
        });
        expect(result.current.status).toBe("error");

        act(() => result.current.retry());

        expect(users.calls).toHaveLength(1);
        expect(stats.calls).toHaveLength(2);
        expect(result.current).toMatchObject({ status: "pending", hasError: true, error: failure });

        await flush(() => stats.last(1).resolve({ posts: 1 }));

        expect(result.current).toMatchObject({ status: "success", hasError: false, data: { stats: { posts: 1 } } });
    });

    it("retry is a no-op without a failure", async () => {
        const { users } = setup();
        const { result } = renderHook(() => useResources([users.resource.bind({ id: 1 })]));
        await flush(() => users.last(1).resolve({ id: 1, name: "a" }));

        act(() => result.current.retry());

        expect(users.calls).toHaveLength(1);
        expect(result.current.status).toBe("success");
    });

    it("invalidate re-queries every slot behind its data, and retries a failure with nothing to show", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { users, stats } = setup();
        const { result } = renderHook(() =>
            useResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }), off: SKIP }),
        );
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "a" });
            stats.last(1).reject(new Error("down"));
        });

        act(() => result.current.invalidate());

        expect(users.calls).toHaveLength(2);
        expect(stats.calls).toHaveLength(2);
        expect(console.warn).not.toHaveBeenCalled();
        expect(result.current.states.user).toMatchObject({ status: "pending", isInvalidating: true });
        expect(result.current.states.stats).toMatchObject({ status: "pending", isInitialLoading: true });
        expect(result.current).toMatchObject({ status: "pending", isInvalidating: true, isInitialLoading: true });
    });

    it("the methods are stable while the slot set is", async () => {
        const { users } = setup();
        const { result, rerender } = renderHook(() => useResources([users.resource.bind({ id: 1 })]));
        const { retry, invalidate } = result.current;
        await flush(() => users.last(1).resolve({ id: 1, name: "a" }));
        rerender();

        expect(result.current.retry).toBe(retry);
        expect(result.current.invalidate).toBe(invalidate);
    });
});

// ==================== Types ====================

describe("useResources — types", () => {
    // Type-level only: the hooks are never called.
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const user = api.createResource<{ id: number }, TUser>({
        queryFn: async ({ id }) => ({ id, name: "" }),
    }) as unknown as IResource<{ id: number }, TUser, Error>;
    const stats = api.createResource<{ id: number }, TStats>({ queryFn: async () => ({ posts: 0 }) });
    const noArgs = api.createResource<void, string>({ queryFn: async () => "" });

    it("a record maps per-slot states and data by name, SKIP to idle / null", () => {
        type TState = ReturnType<typeof useRecord>;
        function useRecord(enabled: boolean) {
            return useResources({
                user: user.bind({ id: 1 }),
                stats: enabled ? stats.bind({ id: 1 }) : SKIP,
                list: noArgs.bind(),
            });
        }

        expectTypeOf<TState["states"]["user"]>().toEqualTypeOf<TResourceClutchState<{ id: number }, TUser, Error>>();
        expectTypeOf<TState["states"]["list"]>().toEqualTypeOf<TResourceClutchState<void, string, unknown>>();
        expectTypeOf<Extract<TState, { hasData: true }>["data"]>().toEqualTypeOf<{
            user: TUser;
            stats: TStats | null;
            list: string;
        }>();
        expectTypeOf<Extract<TState, { status: "idle" }>["data"]>().toEqualTypeOf<null>();
        expectTypeOf<TState["status"]>().toEqualTypeOf<"idle" | "pending" | "error" | "success">();
    });

    it("SKIP alone maps to the idle clutch state", () => {
        function useSkipped() {
            return useResources({ off: SKIP });
        }
        expectTypeOf<ReturnType<typeof useSkipped>["states"]["off"]>().toEqualTypeOf<TResourceClutchIdleState>();
    });

    it("a dynamic array stays an array, a literal tuple stays a tuple", () => {
        function useArray(ids: number[]) {
            return useResources(ids.map((id) => user.bind({ id })));
        }
        function useTuple() {
            return useResources([user.bind({ id: 1 }), stats.bind({ id: 1 })]);
        }

        expectTypeOf<Extract<ReturnType<typeof useArray>, { hasData: true }>["data"]>().toEqualTypeOf<TUser[]>();
        expectTypeOf<Extract<ReturnType<typeof useTuple>, { hasData: true }>["data"]>().toEqualTypeOf<
            [TUser, TStats]
        >();
        expectTypeOf<ReturnType<typeof useTuple>["states"][1]>().toEqualTypeOf<
            TResourceClutchState<{ id: number }, TStats, unknown>
        >();
    });

    it("narrowing on hasData or status gives non-null data", () => {
        function check(
            state: TResourcesState<{ user: typeof user extends { bind(args: { id: number }): infer B } ? B : never }>,
        ) {
            if (state.hasData) expectTypeOf(state.data.user).toEqualTypeOf<TUser>();
            if (state.status === "success") expectTypeOf(state.data.user).toEqualTypeOf<TUser>();
            if (state.status === "error") expectTypeOf(state.hasError).toEqualTypeOf<true>();
        }
        expect(check).toBeTypeOf("function");
    });

    it("the Suspense hook rejects SKIP and has non-null data", () => {
        function useCard() {
            return useSuspenseResources({ user: user.bind({ id: 1 }), stats: stats.bind({ id: 1 }) });
        }
        function useSkipped() {
            // @ts-expect-error — SKIP is not a slot of useSuspenseResources
            return useSuspenseResources({ user: user.bind({ id: 1 }), off: SKIP });
        }

        expectTypeOf<ReturnType<typeof useCard>["data"]>().toEqualTypeOf<{ user: TUser; stats: TStats }>();
        expectTypeOf<ReturnType<typeof useCard>["hasData"]>().toEqualTypeOf<true>();
        expectTypeOf<ReturnType<typeof useCard>["states"]["user"]["dataSource"]>().toEqualTypeOf<
            "placeholder" | "previous" | "current"
        >();
        expect(useSkipped).toBeTypeOf("function");
    });
});
