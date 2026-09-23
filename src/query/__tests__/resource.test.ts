import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import type { QueryCacheEntry } from "@/query/core/cache/QueryCacheEntry";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { pendingEntryState } from "@/query/core/machine/machine-helpers";
import { Resource } from "@/query/core/resource/Resource";
import { ResourceClutch } from "@/query/core/resource/ResourceClutch";
import { stableStringify } from "@/query/lib/stableStringify";
import type {
    IResourceConfig,
    TArgsOrVoid,
    TInFlightPolicy,
    TResourceEntryIdleState,
    TResourceEntryState,
    TResourceSnapshot,
} from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

function createConfig<TArgs, TData>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
): IResourceConfig<TArgs, TData> {
    return {
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    };
}

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>(createConfig(overrides));
}

/**
 * Hold the entry for `args`, as a mounted consumer would. An entry nobody holds
 * is only *marked* by `invalidate()`; a held one re-runs at once — which is
 * what most invalidation tests below exercise.
 */
function holdEntry<TArgs, TData>(resource: Resource<TArgs, TData>, args: TArgsOrVoid<TArgs>): () => void {
    return resource.getEntry(args, true).hold();
}

// ==================== Constructor ====================

describe("Resource constructor", () => {
    it("creates resource with idle status and empty cache", () => {
        const resource = createResource({
            queryFn: async () => "data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });

    it("hydrates entries from snapshot", async () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(42)]: {
                    status: "success",
                    args: 42,
                    data: "cached",
                    updatedAt: 1000,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entry = resource.getEntry(42);
        expect(entry).not.toBeNull();
        const state = entry!.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("cached");
    });

    it("hydration with isStale produces a marked success entry without a query in flight", () => {
        const queryFn = vi.fn(async () => "fresh");
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        // Settled data that owes a revalidation: hydration creates entries
        // nobody holds, so the query waits for the first hold.
        const entry = resource.getEntry(99);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek()).toMatchObject({ status: "success", data: "stale-data", updatedAt: 1000 });
        expect(entry!.isInvalidated).toBe(true);
        expect(entry!.isMelting).toBe(true);
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("hydration with isStale runs the SWR invalidation on the first hold and settles to success", async () => {
        const queryFn = vi.fn(async () => "fresh");
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        const entry = resource.getEntry(99)!;
        const statuses: string[] = [];
        const subscription = entry.obs.subscribe((state) => statuses.push(state.status));

        // The subscriber's first state is already the in-flight one.
        expect(queryFn).toHaveBeenCalledWith(99, expect.any(AbortSignal));
        expect(statuses).toEqual(["invalidating"]);
        expect(entry.isInvalidated).toBe(false);

        await flushMicrotasks();

        expect(entry.state$.peek()).toMatchObject({ status: "success", data: "fresh" });
        expect(queryFn).toHaveBeenCalledTimes(1);
        subscription.unsubscribe();
    });

    it("hydration with isStale settles to invalidate-error when the revalidation fails, keeping stale data", async () => {
        const error = new Error("invalidation failed");
        const queryFn = vi.fn(async () => {
            throw error;
        });
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        holdEntry(resource, 99);
        await flushMicrotasks();

        const state = resource.getEntry(99)!.state$.peek();
        expect(state.status).toBe("invalidate-error");
        expect(state.data).toBe("stale-data");
        expect(state.error).toBe(error);
    });

    it("fetch() on a stale-hydrated entry resolves with the revalidated data", { timeout: 1000 }, async () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        // fetch()'s hold starts the revalidation and its result is awaited —
        // the marked data must not settle the promise.
        await expect(resource.fetch(99)).resolves.toBe("fresh");
    });

    it("ensure() on a stale-hydrated entry resolves with the stale data and revalidates behind", async () => {
        const queryFn = vi.fn(async () => "fresh");
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({ queryFn, snapshot });

        const ensured = resource.ensure(99);
        // The hold `ensure` takes starts the revalidation before it resolves.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(99)!.state$.peek().status).toBe("invalidating");
        await expect(ensured).resolves.toBe("stale-data");

        await flushMicrotasks();
        expect(resource.getEntry(99)!.state$.peek()).toMatchObject({ status: "success", data: "fresh" });
    });

    it("hydration skips entries where serialized key doesn't match snapshot key", () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                "wrong-key": {
                    status: "success",
                    args: 42,
                    data: "cached",
                    updatedAt: 1000,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });
});

// ==================== getEntry(args, true) ====================

describe("Resource.getEntry — initiating", () => {
    it("creates a new cache entry and starts a query", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        expect(queryFn).toHaveBeenCalledWith(1, expect.any(AbortSignal));

        await flushMicrotasks();
        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("returns existing entry without re-fetching on cache hit", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.getEntry(1, true); // second call, same args
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("multiple calls with same args reuse the same QueryCacheEntry instance", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        const entry1 = resource.getEntry(1);

        resource.getEntry(1, true);
        const entry2 = resource.getEntry(1);

        expect(entry1).toBe(entry2);
    });

    it("creates separate entries for different args", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);

        const entry1 = resource.getEntry(1);
        const entry2 = resource.getEntry(2);

        expect(entry1).not.toBe(entry2);
        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();
    });
});

// ==================== invalidate ====================

describe("Resource.invalidate", () => {
    it("triggers a background SWR invalidation on an existing entry", async () => {
        const calls: string[] = [];
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `data-${callCount}`;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-1");

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);

        // During the invalidation, the entry transitions to the invalidating state
        // but data is still accessible
        const midInvalidate = entry.state$.peek();
        expect(midInvalidate.status).toBe("invalidating");
        expect(midInvalidate.data).toBe("data-1");

        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-2");
    });

    it("is a no-op when no cache entry exists for given args", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        // Should not throw
        resource.invalidate(999);

        const entry = resource.getEntry(999);
        expect(entry).toBeNull();
    });
});

// ==================== Lazy invalidation ====================

/**
 * `invalidate()` on an entry nobody holds only marks it: the re-query waits for
 * the next hold — a subscription, `ensure`, `fetch` or `prefetch`.
 */
describe("Resource.invalidate — lazy on an entry nobody holds", () => {
    async function createSettled(queryFn = vi.fn(async (args: number) => `data-${args}`)) {
        const resource = createResource<number, string>({ queryFn });
        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "data-1" });
        return { resource, queryFn, entry: resource.getEntry(1)! };
    }

    it("does not call queryFn; the entry keeps its state and is marked", async () => {
        const { resource, queryFn, entry } = await createSettled();

        resource.invalidate(1);

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "data-1", isInvalidating: false });
    });

    it("calls queryFn when the marked entry is subscribed; the subscriber sees the in-flight state first", async () => {
        let call = 0;
        const { resource, queryFn, entry } = await createSettled(vi.fn(async () => `data-${++call}`));
        resource.invalidate(1);
        // Nothing happens before the hold: the run below is the hold's.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        const statuses: string[] = [];
        const subscription = entry.obs.subscribe((state) => statuses.push(state.status));

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(statuses).toEqual(["invalidating"]);
        expect(entry.isInvalidated).toBe(false);

        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "data-2" });
        subscription.unsubscribe();
    });

    it("a clutch subscribed to the marked entry sees data with isInvalidating, then the fresh result", async () => {
        let call = 0;
        const { resource, queryFn, entry } = await createSettled(vi.fn(async () => `data-${++call}`));
        resource.invalidate(1);
        // Nothing happens before the hold: the run below is the hold's.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        const clutch = new ResourceClutch<number, string>(resource);
        clutch.switch(1);
        clutch.start();

        const seen: Array<{ status: string; isInvalidating: boolean; data: string | null }> = [];
        const subscription = clutch.state$.obs.subscribe((state) =>
            seen.push({ status: state.status, isInvalidating: state.isInvalidating, data: state.data }),
        );

        expect(seen[0]).toEqual({ status: "pending", isInvalidating: true, data: "data-1" });

        await flushMicrotasks();
        expect(seen.at(-1)).toEqual({ status: "success", isInvalidating: false, data: "data-2" });
        subscription.unsubscribe();
    });

    it("fetch() on the marked entry resolves with fresh data", async () => {
        let call = 0;
        const { resource, queryFn, entry } = await createSettled(vi.fn(async () => `data-${++call}`));
        resource.invalidate(1);
        // Nothing happens before the hold: the run below is the hold's.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        await expect(resource.fetch(1)).resolves.toBe("data-2");
        expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it("ensure() on the marked entry resolves with the old data and revalidates behind", async () => {
        let call = 0;
        const { resource, queryFn, entry } = await createSettled(vi.fn(async () => `data-${++call}`));
        resource.invalidate(1);
        // Nothing happens before the hold: the run below is the hold's.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        const ensured = resource.ensure(1);
        // The hold `ensure` takes starts the revalidation before it resolves.
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(entry.state$.peek().status).toBe("invalidating");
        await expect(ensured).resolves.toBe("data-1");

        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "data-2" });
    });

    it("prefetch() on the marked entry revalidates it", async () => {
        let call = 0;
        const { resource, queryFn, entry } = await createSettled(vi.fn(async () => `data-${++call}`));
        resource.invalidate(1);
        // Nothing happens before the hold: the run below is the hold's.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(true);

        await resource.prefetch(1);
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "data-2" });
    });

    it("a marked entry evicted before anyone holds it never queries", async () => {
        vi.useFakeTimers();
        try {
            const queryFn = vi.fn(async (args: number) => `data-${args}`);
            const resource = createResource<number, string>({ queryFn, retentionTime: 1000 });

            // One hold cycle arms retention; the entry then melts, marked.
            await resource.ensure(1);
            resource.invalidate(1);
            expect(resource.getEntry(1)!.isInvalidated).toBe(true);

            vi.advanceTimersByTime(1000);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a consistency violation on an entry nobody holds marks it instead of re-querying", async () => {
        type Items = { items: { id: number; name: string }[] };
        let fetchCount = 0;
        const resource = createResource<void, Items>({
            queryFn: async () => {
                fetchCount++;
                return { items: [{ id: 1, name: `v${fetchCount}` }] };
            },
        });

        resource.getEntry(undefined, true);
        await flushMicrotasks();
        const entry = resource.getEntry()!;

        // Patch 2 depends on the item patch 1 adds; aborting patch 1 makes
        // patch 2's replay fail — a consistency violation asking to re-query.
        const h1 = entry.createPatch((d: Items) => {
            d.items.push({ id: 2, name: "added" });
        })!;
        entry.createPatch((d: Items) => {
            d.items[1]!.name = "modified";
        });
        h1.abort();
        await flushMicrotasks();

        // Nobody holds the entry: marked, not re-queried.
        expect(fetchCount).toBe(1);
        expect(entry.isInvalidated).toBe(true);
        expect(entry.state$.peek().status).toBe("success");

        entry.hold();
        expect(fetchCount).toBe(2);
        expect(entry.state$.peek().status).toBe("invalidating");
    });
});

// ==================== Invalidation in flight ====================

/**
 * `invalidateInFlight` decides what `invalidate()` does to a run in flight:
 * `cancel` (default) aborts it and re-queries, `trail` lets it settle and
 * re-queries after, `join` takes it as the answer and does nothing. The
 * resource option is the default; the call parameter
 * overrides it per call.
 */
describe("Resource — invalidateInFlight", () => {
    /** A resource whose runs the test settles; `runs[i].signal` tells whether run `i` was aborted. */
    function createControlled<TData = string>(overrides: Partial<IResourceConfig<number, TData>> = {}) {
        const runs: { resolve: (v: TData) => void; reject: (error: unknown) => void; signal: AbortSignal }[] = [];
        const resource = createResource<number, TData>({
            queryFn: (_args, signal) =>
                new Promise<TData>((resolve, reject) => {
                    runs.push({ resolve, reject, signal });
                }),
            ...overrides,
        });
        return { resource, runs };
    }

    /**
     * A held entry with data and a second run in flight behind it, then a
     * consistency violation: patch 2 depends on the item patch 1 adds, and
     * aborting patch 1 makes patch 2's replay fail.
     */
    async function violationInFlight(invalidateInFlight: TInFlightPolicy) {
        type Items = { items: { id: number }[] };
        const { resource, runs } = createControlled<Items>({ invalidateInFlight });
        holdEntry(resource, 1);
        runs[0]!.resolve({ items: [{ id: 1 }] });
        await flushMicrotasks();
        const entry = resource.getEntry(1)!;

        // Run 2 in flight behind the data.
        resource.invalidate(1);
        expect(runs).toHaveLength(2);

        const h1 = entry.createPatch((d) => {
            d.items.push({ id: 2 });
        })!;
        entry.createPatch((d) => {
            d.items[1]!.id = 3;
        });
        h1.abort();
        await flushMicrotasks();
        expect(entry.state$.peek()).toMatchObject({ patchState: { isConsistencyViolation: true } });

        return { resource, runs, entry };
    }

    it("defaults to cancel: invalidate() on a held entry in flight aborts the run and starts another", async () => {
        const { resource, runs } = createControlled();
        holdEntry(resource, 1);
        expect(runs).toHaveLength(1);

        resource.invalidate(1);

        expect(runs).toHaveLength(2);
        expect(runs[0]!.signal.aborted).toBe(true);
        expect(resource.getEntry(1)!.isInvalidated).toBe(false);
        expect(resource.getState(1).status).toBe("pending");

        runs[1]!.resolve("fresh");
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "fresh" });
    });

    it("invalidateInFlight: 'trail' from the config: the run settles first, then the entry re-queries", async () => {
        const { resource, runs } = createControlled({ invalidateInFlight: "trail" });
        holdEntry(resource, 1);

        resource.invalidate(1);

        expect(runs).toHaveLength(1);
        expect(runs[0]!.signal.aborted).toBe(false);
        expect(resource.getEntry(1)!.isInvalidated).toBe(true);

        runs[0]!.resolve("first");
        await flushMicrotasks();

        expect(runs).toHaveLength(2);
        expect(resource.getState(1)).toMatchObject({ status: "pending", data: "first", isInvalidating: true });

        runs[1]!.resolve("second");
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "success", data: "second" });
    });

    it("the call parameter overrides the resource default", () => {
        const cancel = createControlled();
        holdEntry(cancel.resource, 1);
        cancel.resource.invalidate(1, { inFlight: "trail" });
        expect(cancel.runs).toHaveLength(1);
        expect(cancel.runs[0]!.signal.aborted).toBe(false);
        expect(cancel.resource.getEntry(1)!.isInvalidated).toBe(true);

        const trail = createControlled({ invalidateInFlight: "trail" });
        holdEntry(trail.resource, 1);
        trail.resource.invalidate(1, { inFlight: "cancel" });
        expect(trail.runs).toHaveLength(2);
        expect(trail.runs[0]!.signal.aborted).toBe(true);
        expect(trail.resource.getEntry(1)!.isInvalidated).toBe(false);
    });

    it("clutch.invalidate(opts) forwards the parameter to the entry", () => {
        const { resource, runs } = createControlled();
        const clutch = new ResourceClutch<number, string>(resource);
        clutch.switch(1);
        clutch.start();
        const subscription = clutch.state$.obs.subscribe();
        expect(runs).toHaveLength(1);

        clutch.invalidate({ inFlight: "trail" });
        expect(runs).toHaveLength(1);
        expect(resource.getEntry(1)!.isInvalidated).toBe(true);

        clutch.invalidate();
        expect(runs).toHaveLength(2);
        expect(runs[0]!.signal.aborted).toBe(true);
        subscription.unsubscribe();
    });

    it("the clutch state's invalidate(opts) does the same", () => {
        const { resource, runs } = createControlled();
        const clutch = new ResourceClutch<number, string>(resource);
        clutch.switch(1);
        clutch.start();
        const subscription = clutch.state$.obs.subscribe();

        clutch.state$.peek().invalidate({ inFlight: "trail" });
        expect(runs).toHaveLength(1);
        expect(resource.getEntry(1)!.isInvalidated).toBe(true);
        subscription.unsubscribe();
    });

    it.each(["cancel", "trail", "join"] as const)(
        "invalidateInFlight: %s — fetch() on a run in flight cancels it by default, whatever the resource's policy",
        async (invalidateInFlight) => {
            const { resource, runs } = createControlled({ invalidateInFlight });

            const first = resource.fetch(1);
            const second = resource.fetch(1);

            expect(runs).toHaveLength(2);
            expect(runs[0]!.signal.aborted).toBe(true);
            expect(resource.getEntry(1)!.isInvalidated).toBe(false);

            // The cancelled run's late answer is ignored; both callers get the fresh one.
            runs[0]!.resolve("stale");
            runs[1]!.resolve("fresh");
            await expect(first).resolves.toBe("fresh");
            await expect(second).resolves.toBe("fresh");
            expect(runs).toHaveLength(2);
        },
    );

    it.each(["cancel", "trail", "join"] as const)(
        "invalidateInFlight: %s — prefetch({ force: true }) forwards its own inFlight, cancel by default",
        async (invalidateInFlight) => {
            const { resource, runs } = createControlled({ invalidateInFlight });
            holdEntry(resource, 1);

            const warmed = resource.prefetch(1, { force: true });
            expect(runs).toHaveLength(2);
            expect(runs[0]!.signal.aborted).toBe(true);
            runs[1]!.resolve("fresh");
            await warmed;

            // `join` awaits the run in flight instead.
            resource.invalidate(1, { inFlight: "cancel" });
            const joined = resource.prefetch(1, { force: true, inFlight: "join" });
            expect(runs).toHaveLength(3);
            runs[2]!.resolve("joined");
            await joined;
            expect(runs).toHaveLength(3);
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "joined" });
        },
    );

    it("prefetch without force ignores an untyped inFlight: a run in flight is awaited", async () => {
        const { resource, runs } = createControlled();
        holdEntry(resource, 1);

        // A compile error (see prefetch-options-types.test.ts); an untyped
        // caller can still pass it, and it is ignored.
        // @ts-expect-error — `inFlight` without `force: true`.
        const warmed = resource.prefetch(1, { inFlight: "cancel" });

        expect(runs).toHaveLength(1);
        expect(runs[0]!.signal.aborted).toBe(false);
        runs[0]!.resolve("data");
        await warmed;
        expect(runs).toHaveLength(1);
    });

    /**
     * `fetch(args, { inFlight })` on a promise run in flight, held by another
     * consumer or not (the fetch holds the entry for as long as it waits).
     */
    describe.each([
        ["held", true],
        ["unheld", false],
    ] as const)("fetch inFlight on a promise run in flight (%s)", (_label, isHeld) => {
        /** An entry with data and a run in flight behind it. */
        async function inFlightEntry() {
            const controlled = createControlled();
            const release = holdEntry(controlled.resource, 1);
            controlled.runs[0]!.resolve("initial");
            await flushMicrotasks();
            controlled.resource.invalidate(1);
            expect(controlled.runs).toHaveLength(2);
            if (!isHeld) release();
            const entry = controlled.resource.getEntry(1)!;
            expect(entry.isMelting).toBe(!isHeld);
            return { ...controlled, entry, running: controlled.runs[1]! };
        }

        it("cancel: aborts the run and resolves with a fresh run's result", async () => {
            const { resource, runs, running } = await inFlightEntry();

            const fetched = resource.fetch(1, { inFlight: "cancel" });

            expect(running.signal.aborted).toBe(true);
            expect(runs).toHaveLength(3);
            running.resolve("stale");
            runs[2]!.resolve("fresh");
            await expect(fetched).resolves.toBe("fresh");
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "fresh" });
        });

        it("trail: lets the run settle, then resolves with a fresh run's result", async () => {
            const { resource, runs, entry, running } = await inFlightEntry();
            let settledWith: string | null = null;

            const fetched = resource.fetch(1, { inFlight: "trail" });
            void fetched.then((data) => (settledWith = data));

            expect(running.signal.aborted).toBe(false);
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(true);

            running.resolve("trailed");
            await flushMicrotasks();
            // The trailed run's result is not the answer: a fresh run follows.
            expect(settledWith).toBeNull();
            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);

            runs[2]!.resolve("fresh");
            await expect(fetched).resolves.toBe("fresh");
        });

        it("trail: a failed trailed run is skipped too — the fresh run answers", async () => {
            const { resource, runs, running } = await inFlightEntry();

            const fetched = resource.fetch(1, { inFlight: "trail" });
            running.reject(new Error("trailed"));
            await flushMicrotasks();
            expect(runs).toHaveLength(3);

            runs[2]!.resolve("fresh");
            await expect(fetched).resolves.toBe("fresh");
        });

        it("join: resolves with the run in flight's result, starting nothing", async () => {
            const { resource, runs, entry, running } = await inFlightEntry();

            const fetched = resource.fetch(1, { inFlight: "join" });

            expect(running.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            running.resolve("joined");
            await expect(fetched).resolves.toBe("joined");
            expect(runs).toHaveLength(2);
        });

        it("the signal only detaches the caller: the run the fetch started goes on", async () => {
            const { resource, runs, running } = await inFlightEntry();
            const controller = new AbortController();

            const fetched = resource.fetch(1, { inFlight: "trail", signal: controller.signal });
            controller.abort(new Error("detached"));

            await expect(fetched).rejects.toThrow("detached");
            expect(running.signal.aborted).toBe(false);
            running.resolve("trailed");
            await flushMicrotasks();
            // Held, the entry re-queries after the trailed run; unheld, it
            // keeps the mark for its next hold.
            expect(runs).toHaveLength(isHeld ? 3 : 2);
            expect(resource.getEntry(1)!.isInvalidated).toBe(!isHeld);
        });

        it("with nothing in flight the policy makes no difference: a fresh run answers", async () => {
            const { resource, runs, running } = await inFlightEntry();
            running.resolve("settled");
            await flushMicrotasks();

            const fetched = resource.fetch(1, { inFlight: "join" });

            expect(runs).toHaveLength(3);
            runs[2]!.resolve("fresh");
            await expect(fetched).resolves.toBe("fresh");
        });
    });

    /** `fetch(args, { inFlight })` on a stream open at `success`: the run is still in flight. */
    describe.each([
        ["held", true],
        ["unheld", false],
    ] as const)("fetch inFlight on an open stream at success (%s)", (_label, isHeld) => {
        function openStream() {
            const subscribers: Array<{ next: (value: string) => void; complete: () => void }> = [];
            let teardowns = 0;
            const resource = createResource<number, string>({
                queryFn: () =>
                    new Observable<string>((subscriber) => {
                        subscribers.push(subscriber);
                        return () => {
                            teardowns += 1;
                        };
                    }),
            });
            const release = holdEntry(resource, 1);
            subscribers[0]!.next("first");
            if (!isHeld) release();
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "first" });
            return { resource, subscribers, teardowns: () => teardowns };
        }

        it("cancel: reopens the stream and resolves with its first emission", async () => {
            const { resource, subscribers, teardowns } = openStream();

            const fetched = resource.fetch(1);

            expect(teardowns()).toBe(1);
            expect(subscribers).toHaveLength(2);
            subscribers[1]!.next("reopened");
            await expect(fetched).resolves.toBe("reopened");
        });

        it("trail: waits for the stream to end, then resolves with the next stream's first emission", async () => {
            const { resource, subscribers, teardowns } = openStream();
            let settledWith: string | null = null;

            const fetched = resource.fetch(1, { inFlight: "trail" });
            void fetched.then((data) => (settledWith = data));

            // Emissions of the trailed stream are not the answer.
            subscribers[0]!.next("second");
            await flushMicrotasks();
            expect(settledWith).toBeNull();
            expect(teardowns()).toBe(0);
            expect(subscribers).toHaveLength(1);

            subscribers[0]!.complete();
            expect(subscribers).toHaveLength(2);
            subscribers[1]!.next("fresh");
            await expect(fetched).resolves.toBe("fresh");
        });

        it("join: resolves with the data the stream already delivered", async () => {
            const { resource, subscribers, teardowns } = openStream();

            await expect(resource.fetch(1, { inFlight: "join" })).resolves.toBe("first");
            expect(teardowns()).toBe(0);
            expect(subscribers).toHaveLength(1);
        });
    });

    /**
     * A run trailed by an invalidation predates it: whatever it brings is
     * already known to be suspect. `fetch` promises a fresh result, so on a
     * marked entry it must not settle on that run — it cancels it and awaits a
     * run started after the invalidation, held or not, from `pending` (a cold
     * load in flight) as from `invalidating` (a run behind data).
     */
    describe.each([
        ["held", true],
        ["unheld", false],
    ] as const)("fetch on an entry marked by a trailed invalidation (%s)", (_label, isHeld) => {
        async function markedEntry(hasData: boolean) {
            const controlled = createControlled({ invalidateInFlight: "trail" });
            const { resource, runs } = controlled;
            const release = holdEntry(resource, 1);
            const entry = resource.getEntry(1)!;

            if (hasData) {
                runs[0]!.resolve("initial");
                await flushMicrotasks();
                // The run behind the data.
                resource.invalidate(1);
                expect(runs).toHaveLength(2);
                expect(entry.state$.peek().status).toBe("invalidating");
            }
            if (!isHeld) release();

            // The trailed invalidation: the run in flight is left alone and
            // the entry is marked.
            resource.invalidate(1);
            const staleRun = runs.at(-1)!;
            expect(staleRun.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.isMelting).toBe(!isHeld);
            return { ...controlled, entry, staleRun, runsBefore: runs.length };
        }

        it.each([
            ["pending", false],
            ["invalidating", true],
        ] as const)("fetch() from %s resolves with a run started after the invalidation", async (_status, hasData) => {
            const { resource, runs, entry, staleRun, runsBefore } = await markedEntry(hasData);

            const fetched = resource.fetch(1);

            // The stale run is cancelled and a fresh one goes out at once.
            expect(staleRun.signal.aborted).toBe(true);
            expect(runs).toHaveLength(runsBefore + 1);
            expect(entry.isInvalidated).toBe(false);

            // A late answer of the cancelled run is ignored.
            staleRun.resolve("stale");
            await flushMicrotasks();
            runs.at(-1)!.resolve("fresh");

            await expect(fetched).resolves.toBe("fresh");
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "fresh" });
            expect(entry.isInvalidated).toBe(false);
            expect(runs).toHaveLength(runsBefore + 1);
        });

        it("prefetch({ force: true }) warms with a run started after the invalidation, leaving no mark", async () => {
            const { resource, runs, entry, staleRun, runsBefore } = await markedEntry(true);

            const warmed = resource.prefetch(1, { force: true });

            expect(staleRun.signal.aborted).toBe(true);
            expect(runs).toHaveLength(runsBefore + 1);

            runs.at(-1)!.resolve("fresh");
            await warmed;
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "fresh" });
            expect(entry.isInvalidated).toBe(false);
            expect(entry.isMelting).toBe(!isHeld);
        });
    });

    it.each([
        ["cancel", true, 3],
        ["trail", false, 2],
    ] as const)(
        "a consistency violation while a run is in flight uses the resource default (%s)",
        async (invalidateInFlight, isAborted, runsAfter) => {
            const { resource, runs, entry } = await violationInFlight(invalidateInFlight);

            expect(runs[1]!.signal.aborted).toBe(isAborted);
            expect(runs).toHaveLength(runsAfter);
            expect(entry.isInvalidated).toBe(!isAborted);
            expect(entry.state$.peek().status).toBe("invalidating");

            // Either way a run from after the violation follows.
            runs[runsAfter - 1]!.resolve({ items: [{ id: 1 }] });
            await flushMicrotasks();
            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);
        },
    );

    it("a consistency violation while a run is in flight under join: the run in flight is the answer", async () => {
        const { resource, runs, entry } = await violationInFlight("join");

        expect(runs[1]!.signal.aborted).toBe(false);
        expect(runs).toHaveLength(2);
        expect(entry.isInvalidated).toBe(false);

        runs[1]!.resolve({ items: [{ id: 1 }] });
        await flushMicrotasks();
        expect(runs).toHaveLength(2);
        expect(resource.getState(1)).toMatchObject({ status: "success", data: { items: [{ id: 1 }] } });
    });

    describe("join", () => {
        it("invalidateInFlight: 'join' from the config: invalidate() on a run in flight is a no-op", async () => {
            const { resource, runs } = createControlled({ invalidateInFlight: "join" });
            holdEntry(resource, 1);

            resource.invalidate(1);

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(resource.getEntry(1)!.isInvalidated).toBe(false);

            runs[0]!.resolve("first");
            await flushMicrotasks();

            // The joined run answered the invalidation: nothing follows it.
            expect(runs).toHaveLength(1);
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "first" });
        });

        it("without a run in flight, join invalidates like the other values", async () => {
            const { resource, runs } = createControlled({ invalidateInFlight: "join" });
            holdEntry(resource, 1);
            runs[0]!.resolve("first");
            await flushMicrotasks();

            resource.invalidate(1);

            expect(runs).toHaveLength(2);
            expect(resource.getState(1)).toMatchObject({ status: "pending", data: "first", isInvalidating: true });
        });

        it("the call parameter { inFlight: 'join' } overrides a cancel default, and vice versa", () => {
            const cancel = createControlled();
            holdEntry(cancel.resource, 1);
            cancel.resource.invalidate(1, { inFlight: "join" });
            expect(cancel.runs).toHaveLength(1);
            expect(cancel.runs[0]!.signal.aborted).toBe(false);
            expect(cancel.resource.getEntry(1)!.isInvalidated).toBe(false);

            const join = createControlled({ invalidateInFlight: "join" });
            holdEntry(join.resource, 1);
            join.resource.invalidate(1, { inFlight: "cancel" });
            expect(join.runs).toHaveLength(2);
            expect(join.runs[0]!.signal.aborted).toBe(true);
        });

        it("clutch.invalidate({ inFlight: 'join' }) leaves the run in flight alone", () => {
            const { resource, runs } = createControlled();
            const clutch = new ResourceClutch<number, string>(resource);
            clutch.switch(1);
            clutch.start();
            const subscription = clutch.state$.obs.subscribe();

            clutch.invalidate({ inFlight: "join" });
            clutch.state$.peek().invalidate({ inFlight: "join" });

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(resource.getEntry(1)!.isInvalidated).toBe(false);
            subscription.unsubscribe();
        });
    });

    describe("with beforeQuery (cross-tab sync) still pending", () => {
        it("invalidate() on a held entry starts a run of its own; the other tab's late answer is dropped", async () => {
            let answer!: (result: { data: string } | null) => void;
            const { resource, runs } = createControlled({
                key: "res",
                beforeQuery: () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        answer = resolve;
                    }),
            });
            holdEntry(resource, 1);
            expect(runs).toHaveLength(0);
            expect(resource.getState(1).status).toBe("pending");

            resource.invalidate(1);

            expect(runs).toHaveLength(1);
            expect(resource.getEntry(1)!.isInvalidated).toBe(false);

            // The other tab answers while the run is in flight: it is not fresher
            // than the run that went out after the invalidation.
            answer({ data: "from-tab" });
            await flushMicrotasks();
            expect(resource.getState(1).status).toBe("pending");

            runs[0]!.resolve("from-query");
            await flushMicrotasks();
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "from-query" });
        });

        it("a `null` answer while a run is in flight does not start a second run", async () => {
            let answer!: (result: { data: string } | null) => void;
            const { resource, runs } = createControlled({
                key: "res",
                beforeQuery: () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        answer = resolve;
                    }),
            });
            holdEntry(resource, 1);
            resource.invalidate(1);
            expect(runs).toHaveLength(1);

            answer(null);
            await flushMicrotasks();

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
        });

        it.each([null, { data: "from-tab" }])(
            "an answer (%o) arriving after the invalidate()-started run has settled is dropped: no second run",
            async (lateAnswer) => {
                let answer!: (result: { data: string } | null) => void;
                const { resource, runs } = createControlled({
                    key: "res",
                    beforeQuery: () =>
                        new Promise<{ data: string } | null>((resolve) => {
                            answer = resolve;
                        }),
                });
                holdEntry(resource, 1);
                resource.invalidate(1);
                expect(runs).toHaveLength(1);

                runs[0]!.resolve("from-query");
                await flushMicrotasks();
                expect(resource.getState(1)).toMatchObject({ status: "success", data: "from-query" });

                // The run that went out after the invalidation owns the entry:
                // the other tab's answer is older than it and must neither
                // replace its data nor re-fetch behind it.
                answer(lateAnswer);
                await flushMicrotasks();

                expect(runs).toHaveLength(1);
                expect(resource.getState(1)).toMatchObject({ status: "success", data: "from-query" });
            },
        );

        it("invalidate() under cancel on an entry nobody holds drops the wait: the answer is ignored, the first hold loads", async () => {
            let answer!: (result: { data: string } | null) => void;
            const { resource, runs } = createControlled({
                key: "res",
                beforeQuery: () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        answer = resolve;
                    }),
            });
            resource.getEntry(1, true);
            const entry = resource.getEntry(1)!;
            resource.invalidate(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry._isInFlight).toBe(false);

            answer({ data: "from-tab" });
            await flushMicrotasks();
            expect(runs).toHaveLength(0);
            expect(entry.state$.peek().status).toBe("pending");

            entry.hold();
            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(false);
            runs[0]!.resolve("from-query");
            await flushMicrotasks();
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "from-query" });
        });

        it("invalidate() under trail on an entry nobody holds only marks it; the other tab's answer lands and the first hold revalidates", async () => {
            let answer!: (result: { data: string } | null) => void;
            const { resource, runs } = createControlled({
                key: "res",
                beforeQuery: () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        answer = resolve;
                    }),
            });
            resource.getEntry(1, true);
            const entry = resource.getEntry(1)!;

            resource.invalidate(1, { inFlight: "trail" });
            expect(runs).toHaveLength(0);
            expect(entry.isInvalidated).toBe(true);

            answer({ data: "from-tab" });
            await flushMicrotasks();
            expect(entry.state$.peek()).toMatchObject({ status: "success", data: "from-tab" });
            expect(entry.isInvalidated).toBe(true);

            entry.hold();
            expect(runs).toHaveLength(1);
            expect(entry.state$.peek().status).toBe("invalidating");
        });

        /**
         * The other-tab round-trip of an existing entry counts as its run in
         * flight: every in-flight policy applies to it as to any run.
         */
        describe("the round-trip is the run in flight", () => {
            function setup(overrides: Partial<IResourceConfig<number, string>> = {}) {
                let answer!: (result: { data: string } | null) => void;
                const asked = vi.fn(
                    () =>
                        new Promise<{ data: string } | null>((resolve) => {
                            answer = resolve;
                        }),
                );
                const { resource, runs } = createControlled({ key: "res", beforeQuery: asked, ...overrides });
                resource.getEntry(1, true);
                const entry = resource.getEntry(1)!;
                return { resource, runs, entry, asked, answer: (result: { data: string } | null) => answer(result) };
            }

            it("the entry reports a run in flight while it waits for the other tabs", () => {
                const { entry, asked } = setup();
                expect(asked).toHaveBeenCalledTimes(1);
                expect(entry._isInFlight).toBe(true);
                expect(entry.state$.peek().status).toBe("pending");
            });

            it("fetch join: resolves with the other tab's answer, no query of its own", async () => {
                const { resource, runs, answer } = setup();
                const fetched = resource.fetch(1, { inFlight: "join" });
                expect(runs).toHaveLength(0);

                answer({ data: "from-tab" });
                await expect(fetched).resolves.toBe("from-tab");
                expect(runs).toHaveLength(0);
            });

            it("fetch join: a `null` answer falls through to the query, and that result is the answer", async () => {
                const { resource, runs, answer } = setup();
                const fetched = resource.fetch(1, { inFlight: "join" });

                answer(null);
                await flushMicrotasks();
                expect(runs).toHaveLength(1);
                runs[0]!.resolve("from-query");
                await expect(fetched).resolves.toBe("from-query");
            });

            it("fetch cancel: drops the wait and queries at once; the late answer is ignored", async () => {
                const { resource, runs, answer } = setup();
                const fetched = resource.fetch(1);
                expect(runs).toHaveLength(1);

                answer({ data: "from-tab" });
                await flushMicrotasks();
                expect(resource.getState(1).status).toBe("pending");

                runs[0]!.resolve("from-query");
                await expect(fetched).resolves.toBe("from-query");
                expect(runs).toHaveLength(1);
            });

            it.each([{ data: "from-tab" }, null])(
                "fetch trail: lets the round-trip (answer %o) and its run finish, then resolves with a fresh query",
                async (result) => {
                    const { resource, runs, answer } = setup();
                    let settled: string | null = null;
                    const fetched = resource.fetch(1, { inFlight: "trail" }).then((data) => {
                        settled = data;
                        return data;
                    });
                    expect(runs).toHaveLength(0);

                    answer(result);
                    await flushMicrotasks();
                    if (result === null) {
                        // The round-trip turned into the query; that run is trailed too.
                        expect(runs).toHaveLength(1);
                        runs[0]!.resolve("fallback");
                        await flushMicrotasks();
                    }
                    expect(runs).toHaveLength(result === null ? 2 : 1);
                    expect(settled).toBeNull();

                    runs.at(-1)!.resolve("fresh");
                    await expect(fetched).resolves.toBe("fresh");
                },
            );

            it("prefetch({ force: true, inFlight: 'join' }) settles with the other tab's answer", async () => {
                const { resource, runs, answer } = setup();
                let isSettled = false;
                const prefetched = resource.prefetch(1, { force: true, inFlight: "join" }).then(() => {
                    isSettled = true;
                });

                answer({ data: "from-tab" });
                await flushMicrotasks();
                await flushMicrotasks();
                expect(isSettled).toBe(true);
                await prefetched;
                expect(runs).toHaveLength(0);
                expect(resource.getState(1)).toMatchObject({ status: "success", data: "from-tab" });
            });

            it("invalidate() under join on a held entry is a no-op: the answer lands, nothing follows", async () => {
                const { resource, runs, answer, entry } = setup();
                entry.hold();

                resource.invalidate(1, { inFlight: "join" });
                expect(entry.isInvalidated).toBe(false);

                answer({ data: "from-tab" });
                await flushMicrotasks();
                expect(runs).toHaveLength(0);
                expect(entry.state$.peek()).toMatchObject({ status: "success", data: "from-tab" });
            });

            it("invalidate() under trail on a held entry re-queries once the answer landed", async () => {
                const { resource, runs, answer, entry } = setup();
                entry.hold();

                resource.invalidate(1, { inFlight: "trail" });
                expect(runs).toHaveLength(0);

                answer({ data: "from-tab" });
                await flushMicrotasks();
                expect(runs).toHaveLength(1);
                expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: "from-tab" });
            });
        });
    });
});

// ==================== getEntry ====================

describe("Resource.getEntry", () => {
    it("returns cached entry for known args", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("returns null for unknown args when doInitiate=false", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry = resource.getEntry(42, false);
        expect(entry).toBeNull();
    });

    it("returns null for unknown args by default (doInitiate defaults to false)", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry = resource.getEntry(42);
        expect(entry).toBeNull();
    });

    it("creates and starts entry when doInitiate=true and entry absent", async () => {
        const queryFn = vi.fn(async () => "initiated");
        const resource = createResource<number, string>({ queryFn });

        const entry = resource.getEntry(42, true);
        expect(entry).not.toBeNull();
        expect(queryFn).toHaveBeenCalledWith(42, expect.any(AbortSignal));

        await flushMicrotasks();
        expect(entry!.state$.peek().data).toBe("initiated");
    });

    it("handles void args correctly", async () => {
        const resource = createResource<void, string>({
            queryFn: async () => "void-data",
        });

        resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("void-data");
    });
});

// ==================== getEntry$ (reactive) ====================

describe("Resource.getEntry$ reactivity", () => {
    it("re-evaluates inside Signal.effect when entry is created", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        // Initially null (no entry yet)
        expect(results).toEqual([null]);

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Effect should have re-run with the entry present
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[results.length - 1]).not.toBeNull();

        eff.unsubscribe();
    });

    it("re-evaluates inside Signal.compute when entry is created", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const hasEntry$ = Signal.compute(() => {
            const entry$ = resource.getEntry$(1);
            return entry$() !== null;
        });

        // Track via effect to activate the computed
        const values: boolean[] = [];
        const eff = Signal.effect(() => {
            values.push(hasEntry$());
        });

        expect(values).toEqual([false]);

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values[values.length - 1]).toBe(true);

        eff.unsubscribe();
        hasEntry$.dispose();
    });

    it("re-evaluates inside Signal.effect when entry is completed and removed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        // Initially null
        expect(results).toEqual([null]);

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(results.length).toBeGreaterThanOrEqual(2);
        const entry = results[results.length - 1];
        expect(entry).not.toBeNull();

        // Complete the entry — removes it from cache, status goes back to idle
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // Effect should have re-run, returning null again
        expect(results.length).toBeGreaterThanOrEqual(3);
        expect(results[results.length - 1]).toBeNull();

        eff.unsubscribe();
    });

    it("getEntry$ for one key is not confused by triggering another key", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.getEntry(2, true);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const entry2$ = resource.getEntry$(2);

        const entry1 = entry1$();
        const entry2 = entry2$();

        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();
        expect(entry1).not.toBe(entry2);
        expect(entry1!.state$.peek().data).toBe("data-1");
        expect(entry2!.state$.peek().data).toBe("data-2");
    });

    it("getEntry$ reads as null after entry is removed via complete()", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        expect(entry$()).toBeNull();

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(entry$()).not.toBeNull();
        expect(entry$()!.state$.peek().data).toBe("data");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(entry$()).toBeNull();
    });

    it("getEntry$ with doInitiate=true creates and starts the entry on read", async () => {
        const queryFn = vi.fn(async () => "initiated");
        const resource = createResource<number, string>({ queryFn });

        const entry$ = resource.getEntry$(42, true);

        // Reading the signal creates the missing entry and starts its query —
        // creation is lazy: it happens on read, not at the getEntry$ call.
        expect(entry$()).not.toBeNull();
        expect(queryFn).toHaveBeenCalledWith(42, expect.any(AbortSignal));

        await flushMicrotasks();
        expect(entry$()!.state$.peek().data).toBe("initiated");
    });

    it("getEntry$ with doInitiate=true is idempotent (reuses the existing entry)", () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const first = resource.getEntry$(1, true)();
        const second = resource.getEntry$(1, true)();

        expect(first).not.toBeNull();
        expect(first).toBe(second);
        expect(first).toBe(resource.getEntry(1));
        // Only one entry created despite two doInitiate calls.
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("getEntry$ with doInitiate=true does not spin a re-creation loop when observed", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const entry$ = resource.getEntry$(1, true);
        const results: (object | null)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        await flushMicrotasks();

        // Bounded reactivity: initiation is a one-shot side effect, so the query
        // runs exactly once and the effect settles instead of looping forever.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(results.length).toBeLessThanOrEqual(3);
        expect(results[results.length - 1]).not.toBeNull();

        eff.unsubscribe();
    });

    it("getEntry$ without doInitiate is read-only — reading it creates no entry and starts no query", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        // A different key holds a live entry, so the resource status is "running".
        resource.getEntry(2, true);
        await flushMicrotasks();
        queryFn.mockClear();

        // Reading getEntry$(1) WITHOUT doInitiate must stay a pure observer: no
        // entry for key 1 is created and no query is started, even though the
        // resource is "running" because key 2 exists. This mirrors the sync
        // getEntry(1), which returns null without side effects.
        const e1$ = resource.getEntry$(1);

        expect(e1$()).toBeNull();
        expect(resource.getEntry(1)).toBeNull();
        expect(queryFn).not.toHaveBeenCalled();
    });
});

// ==================== getEntry$ — non-last entry removal (N1 regression) ====================
//
// getEntry$ currently tracks only _status$ and _lastEntry$, while the fallback
// `_cache.get(key)` is non-reactive. Removing a NON-last entry (one that is not
// the most recently created, so it is not _lastEntry$) while the cache still
// holds other entries changes neither signal: _status$ stays "running" and
// _lastEntry$ keeps pointing at the other entry. The observer therefore keeps a
// completed entry. Every test below creates key 2 AFTER key 1 so that key 1 is
// the non-last entry. The removal repros are RED on the current code and GREEN
// once the cache itself becomes reactive.
describe("Resource.getEntry$ — non-last entry removal (N1 regression)", () => {
    it("effect over a NON-last entry re-evaluates to null when that entry is completed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.getEntry(1, true);
        resource.getEntry(2, true); // key 2 becomes _lastEntry$, so key 1 is the non-last entry
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        expect(results[results.length - 1]).not.toBeNull();

        // Cache still holds key 2 → _status$ stays "running" and _lastEntry$ still
        // points at entry 2. The observer must nevertheless drop to null.
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(results[results.length - 1]).toBeNull();

        eff.unsubscribe();
    });

    it("cold read of a NON-last entry returns null after that entry is completed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);

        // Prime the cold ComputeCache with the live entry and the signals it tracked.
        expect(entry1$()).toBe(resource.getEntry(1));

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // Neither tracked signal changed, so the memoised (now completed) entry is
        // wrongly returned until the cache is made reactive.
        expect(entry1$()).toBeNull();
    });

    it("cold read of a NON-last entry returns null after retention GC removes it", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async (n: number) => `d-${n}`,
                retentionTime: 5000,
            });

            resource.getEntry(1, true);
            resource.getEntry(2, true);
            await flushMicrotasks();

            const entry1 = resource.getEntry(1)!;
            const entry2 = resource.getEntry(2)!;

            // Hold a live subscription on entry 2 so its retention timer never
            // fires — only entry 1 (the non-last entry) is GC'd below.
            const keepAlive2 = entry2.obs.subscribe();

            const entry1$ = resource.getEntry$(1);
            expect(entry1$()).toBe(entry1); // prime cold cache with the live entry

            // Subscribe + unsubscribe to arm entry 1's retention countdown.
            const sub1 = entry1.obs.subscribe();
            sub1.unsubscribe();

            vi.advanceTimersByTime(5001);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull(); // sanity: really GC'd
            expect(resource.getEntry(2)).not.toBeNull(); // key 2 kept alive
            expect(entry1$()).toBeNull();

            keepAlive2.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it("doInitiate re-creates a NON-last entry on read after it was removed", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1, true);
        const results: (object | null)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        const firstEntry = results[results.length - 1];
        expect(firstEntry).not.toBeNull();

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // doInitiate must revive the removed non-last entry on the next read —
        // today the observer never re-runs, so it keeps the completed entry.
        const revived = results[results.length - 1];
        expect(revived).not.toBeNull();
        expect(revived).not.toBe(firstEntry);
        expect(resource.getEntry(1)).toBe(revived);

        eff.unsubscribe();
    });

    // ---- contract guards: define the post-fix behaviour, must stay GREEN ----

    it("an unrelated entry mutation does not spuriously notify a getEntry$ observer", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        const countAfterInit = results.length;
        expect(results[results.length - 1]).not.toBeNull();

        // Creating an unrelated entry (key 2) must not emit a new value for key 1:
        // the observed entry object is unchanged, so distinctUntilChanged drops it.
        resource.getEntry(2, true);
        await flushMicrotasks();

        expect(results.length).toBe(countAfterInit);

        eff.unsubscribe();
    });

    it("reset() with multiple entries drives every getEntry$ observer to null", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const e1$ = resource.getEntry$(1);
        const e2$ = resource.getEntry$(2);
        const r1: (null | object)[] = [];
        const r2: (null | object)[] = [];
        const eff = Signal.effect(() => {
            r1.push(e1$());
            r2.push(e2$());
        });

        expect(r1[r1.length - 1]).not.toBeNull();
        expect(r2[r2.length - 1]).not.toBeNull();

        resource.reset();
        await flushMicrotasks();

        expect(r1[r1.length - 1]).toBeNull();
        expect(r2[r2.length - 1]).toBeNull();

        eff.unsubscribe();
    });
});

// ==================== serialize / toKeyed ====================

describe("Resource.serialize", () => {
    it("returns deterministic string key", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const key1 = resource.serialize(42);
        const key2 = resource.serialize(42);
        expect(key1).toBe(key2);
    });

    it("produces same key for equivalent args", () => {
        const resource = createResource<{ a: number; b: number }, string>({
            queryFn: async () => "data",
        });

        const key1 = resource.serialize({ a: 1, b: 2 });
        const key2 = resource.serialize({ b: 2, a: 1 });
        expect(key1).toBe(key2);
    });
});

describe("Resource.toKeyed", () => {
    it("returns { value, key } wrapper", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const keyed = resource.toKeyed(42);
        expect(keyed.value).toBe(42);
        expect(keyed.key).toBe(resource.serialize(42));
    });
});

// ==================== bind ====================

describe("Resource.bind", () => {
    it("returns an inert { kind, resource, args } descriptor", () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const bound = resource.bind(42);

        expect(bound).toEqual({ kind: "resource", resource, args: 42 });
        // bind must not execute the query
        expect(queryFn).not.toHaveBeenCalled();
        expect([...resource.getEntries()]).toEqual([]);
    });

    it("preserves TKeyed args as-is", () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        const keyed = resource.toKeyed(7);
        const bound = resource.bind(keyed);

        expect(bound.args).toBe(keyed);
    });

    it("descriptor can be replayed via resource.getEntry", async () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const bound = resource.bind(99);
        bound.resource.getEntry(bound.args, true);
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledWith(99, expect.anything());
        const entry = resource.getEntry(99);
        expect(entry!.state$.peek().data).toBe("data-99");
    });
});

// ==================== getEntries ====================

describe("Resource.getEntries", () => {
    it("returns empty iterator when cache is empty", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });

    it("yields all active cache entries", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        resource.getEntry(3, true);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(3);
    });
});

// ==================== reset ====================

describe("Resource.reset", () => {
    it("clears all cache entries and sets status to idle", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        expect([...resource.getEntries()]).toHaveLength(2);

        resource.reset();
        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("after reset, getEntry returns null", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();
    });

    it("after reset, new triggers create fresh entries", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `data-${callCount}`;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        resource.reset();

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data-2");
    });
});

// ==================== createClutch ====================

describe("Resource.createClutch", () => {
    it("returns a ResourceClutch instance", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const clutch = resource.createClutch();
        expect(clutch).toBeDefined();
        expect(typeof clutch.start).toBe("function");
        expect(typeof clutch.switch).toBe("function");
        expect(typeof clutch.retry).toBe("function");
        expect(typeof clutch.invalidate).toBe("function");
        expect(typeof clutch.state$).toBe("function");
    });
});

// ==================== SWR (Stale-While-Revalidate) ====================

describe("SWR scenarios", () => {
    it("invalidate serves stale data during background re-fetch", async () => {
        let callCount = 0;
        let resolveQuery!: (val: string) => void;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "stale";
                return new Promise((r) => {
                    resolveQuery = r;
                });
            },
        });

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().data).toBe("stale");

        // Force re-fetch
        resource.invalidate(1);

        // Entry should be in invalidating state with stale data still accessible
        const entry = resource.getEntry(1)!;
        const mid = entry.state$.peek();
        expect(mid.status).toBe("invalidating");
        expect(mid.data).toBe("stale");

        // Resolve the invalidation
        resolveQuery("fresh");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("fresh");
    });

    it("during an invalidation, getEntry still returns the entry with old data", async () => {
        let callCount = 0;
        let resolveQuery!: (val: string) => void;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "original";
                return new Promise((r) => {
                    resolveQuery = r;
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("invalidating");
        expect(entry!.state$.peek().data).toBe("original");

        resolveQuery("updated");
        await flushMicrotasks();
    });

    it("invalidate → success transition preserves entry identity", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entryBefore = resource.getEntry(1);
        resource.invalidate(1);
        await flushMicrotasks();
        const entryAfter = resource.getEntry(1);

        expect(entryBefore).toBe(entryAfter);
    });
});

// ==================== Entry State Interactions ====================

describe("entry state interactions", () => {
    it("new entry starts in pending state", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}), // never resolves
        });

        resource.getEntry(1, true);
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("pending");
    });

    it("successful fetch → success state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "ok",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");
    });

    it("failed fetch → error state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBeInstanceOf(Error);
    });

    it("invalidate() transitions through invalidating state", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
    });

    it("hydrated snapshot creates entry in success state", () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(1)]: {
                    status: "success",
                    args: 1,
                    data: "snapshot-data",
                    updatedAt: Date.now(),
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("snapshot-data");
    });

    it("error → retry → success flow", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });
});

// ==================== Lifecycle: onCacheEntryAdded ====================

describe("onCacheEntryAdded lifecycle", () => {
    it("fires after entry is registered", async () => {
        const addedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (args, ctx) => {
                addedArgs.push(args);
                expect(ctx.entry).not.toBeNull();
            },
        });

        resource.getEntry(1, true);
        expect(addedArgs).toEqual([1]);
    });

    it("$cacheDataLoaded resolves on first success", async () => {
        let loadedData: string | undefined;

        const resource = createResource<number, string>({
            queryFn: async () => "loaded",
            onCacheEntryAdded: async (_args, ctx) => {
                loadedData = await ctx.$cacheDataLoaded;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(loadedData).toBe("loaded");
    });

    it("$cacheDataLoaded rejects with CacheEntryRemovedError if removed before success", async () => {
        let rejectedError: unknown;
        let resolveQuery!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
            onCacheEntryAdded: async (_args, ctx) => {
                try {
                    await ctx.$cacheDataLoaded;
                } catch (err) {
                    rejectedError = err;
                }
            },
        });

        resource.getEntry(1, true);
        const entry = resource.getEntry(1)!;

        // Complete the entry before queryFn resolves (simulating removal)
        entry.complete();
        await flushMicrotasks();

        expect(rejectedError).toBeInstanceOf(CacheEntryRemovedError);
    });

    it("$cacheEntryRemoved resolves when entry completes", async () => {
        let removed = false;

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: async (_args, ctx) => {
                ctx.$cacheEntryRemoved.then(() => {
                    removed = true;
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.complete();
        await flushMicrotasks();

        expect(removed).toBe(true);
    });

    it("errors in onCacheEntryAdded callback are suppressed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        resource.getEntry(1, true);
        await flushMicrotasks();

        // Entry should still be created
        expect(resource.getEntry(1)).not.toBeNull();
    });
});

// ==================== Lifecycle: onQueryStarted ====================

describe("onQueryStarted lifecycle", () => {
    it("fires on each query execution", async () => {
        const startedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(startedArgs).toEqual([1]);
    });

    it("fires again on an invalidation", async () => {
        const startedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        expect(startedArgs).toEqual([1, 1]);
    });

    it("$queryFulfilled resolves with { data }", async () => {
        let fulfilledData: { data: string } | undefined;

        const resource = createResource<number, string>({
            queryFn: async () => "result",
            onQueryStarted: async (_args, ctx) => {
                fulfilledData = await ctx.$queryFulfilled;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(fulfilledData).toEqual({ data: "result" });
    });

    it("errors in onQueryStarted callback are suppressed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });
});

// ==================== beforeQuery (Cross-Tab Sync) ====================

describe("beforeQuery (cross-tab sync)", () => {
    it("uses data returned by beforeQuery without calling queryFn", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(beforeQuery).toHaveBeenCalledWith("res", stableStringify(1));
        expect(queryFn).not.toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-tab");
    });

    it("falls back to queryFn when beforeQuery returns null", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(beforeQuery).toHaveBeenCalled();
        expect(queryFn).toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-query");
    });

    it("falls back to queryFn when beforeQuery throws", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => {
            throw new Error("sync error");
        });

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.getEntry(1, true);
        // beforeQuery rejects → catch calls _execute → queryFn resolves
        await flushMicrotasks();
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-query");
    });

    it("is skipped when key is not set", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const resource = createResource<number, string>({
            queryFn,
            // no key
            beforeQuery,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(beforeQuery).not.toHaveBeenCalled();
        expect(queryFn).toHaveBeenCalled();
    });

    it("is skipped for hydrated entries (snapshot)", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(1)]: {
                    status: "success",
                    args: 1,
                    data: "hydrated",
                    updatedAt: Date.now(),
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
            snapshot,
        });

        expect(beforeQuery).not.toHaveBeenCalled();
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().data).toBe("hydrated");
    });

    it("entry removed while beforeQuery is in flight — null result does not re-execute", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let resolveBeforeQuery!: (result: { data: string } | null) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        resolveBeforeQuery = resolve;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.getEntry(1, true);
            resource.reset(); // completes the entry while beforeQuery is still pending

            resolveBeforeQuery(null);
            await flushUnhandledRejections();

            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("entry removed while beforeQuery is in flight — late data is discarded", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let resolveBeforeQuery!: (result: { data: string } | null) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        resolveBeforeQuery = resolve;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.getEntry(1, true);
            resource.reset();

            resolveBeforeQuery({ data: "from-tab" });
            await flushUnhandledRejections();

            expect(resource.getEntry(1)).toBeNull();
            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("entry removed while beforeQuery is in flight — rejection does not re-execute", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let rejectBeforeQuery!: (error: unknown) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((_resolve, reject) => {
                        rejectBeforeQuery = reject;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.getEntry(1, true);
            resource.reset();

            rejectBeforeQuery(new Error("channel closed"));
            await flushUnhandledRejections();

            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== Concurrent triggers ====================

describe("Concurrent triggers", () => {
    it("concurrent triggers with same args return same entry", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}), // never resolves
        });

        resource.getEntry(1, true);
        resource.getEntry(1, true);
        resource.getEntry(1, true);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(1);
    });

    it("concurrent triggers with different args create separate entries", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}),
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        resource.getEntry(3, true);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(3);
    });
});

// ==================== Cache entry completion / cleanup ====================

describe("Cache entry completion", () => {
    it("entry removed from cache after completion", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.complete();
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("completing all entries transitions status back to idle", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        const entry2 = resource.getEntry(2)!;

        entry1.complete();
        await flushMicrotasks();

        // Still one entry left — getEntry$ with doInitiate=false should still work
        expect([...resource.getEntries()]).toHaveLength(1);

        entry2.complete();
        await flushMicrotasks();

        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("after entry completion, new trigger for same args creates fresh entry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        expect(entry1.state$.peek().data).toBe("v1");

        entry1.complete();
        await flushMicrotasks();

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry2 = resource.getEntry(1)!;
        expect(entry2).not.toBe(entry1);
        expect(entry2.state$.peek().data).toBe("v2");
    });
});

// ==================== Error flows ====================

describe("Error flows", () => {
    it("queryFn rejection preserves the error object", async () => {
        const cause = new Error("network failure");
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw cause;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBe(cause);
    });

    it("queryFn rejection with non-Error value still transitions to error", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw "string-error";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBe("string-error");
    });

    it("a failed invalidation transitions to invalidate-error, preserving old data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                throw new Error("invalidation failed");
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");
        expect(entry.state$.peek().data).toBe("good-data");
        expect(entry.state$.peek().error).toBeInstanceOf(Error);
    });

    it("retry after invalidate-error triggers a new fetch via invalidate()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                if (callCount === 2) throw new Error("invalidation failed");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");

        // invalidate-error allows invalidate() again
        entry.invalidate();
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", error: null });
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });

    it("retry() after invalidate-error re-fetches as a retrying invalidation, keeping the data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                if (callCount === 2) throw new Error("invalidation failed");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");

        const failure = entry.state$.peek().error;
        entry.retry();
        // A retry in flight is the entry holding the failure it retries.
        expect(entry.state$.peek()).toMatchObject({
            status: "invalidating",
            data: "initial",
            error: failure,
        });
        // Matrix row 12 at the entry level.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "current",
            data: "initial",
            isInvalidating: true,
            hasData: true,
            hasError: true,
            error: failure,
        });

        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
        expect(callCount).toBe(3);
    });

    it("multiple sequential errors still allow retry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount <= 2) throw new Error(`fail-${callCount}`);
                return "finally";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");
        expect(resource.getEntry(1)!.state$.peek().data).toBe("finally");
    });
});

// ==================== Retention time / GC ====================

describe("Retention time / GC", () => {
    it("entry is auto-removed after retention time when all subscribers unsubscribe", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: 5000,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            // Subscribe to the observable (simulates a component subscribing)
            const sub = entry.obs.subscribe();
            expect(resource.getEntry(1)).not.toBeNull();

            // Unsubscribe — starts retention countdown
            sub.unsubscribe();

            // Before retention expires, entry still exists
            vi.advanceTimersByTime(4999);
            expect(resource.getEntry(1)).not.toBeNull();

            // After retention expires, entry should be cleaned up
            vi.advanceTimersByTime(2);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull();
            expect([...resource.getEntries()]).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-subscribing before retention expires prevents GC", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: 5000,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            const sub1 = entry.obs.subscribe();
            sub1.unsubscribe();

            // Advance partway through retention
            vi.advanceTimersByTime(3000);
            expect(resource.getEntry(1)).not.toBeNull();

            // Re-subscribe before expiry
            const sub2 = entry.obs.subscribe();
            vi.advanceTimersByTime(5000);
            await flushMicrotasks();

            // Entry should still exist because we re-subscribed
            expect(resource.getEntry(1)).not.toBeNull();

            sub2.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it("retentionTime: false prevents auto-removal", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: false,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            const sub = entry.obs.subscribe();
            sub.unsubscribe();

            vi.advanceTimersByTime(60_000);
            await flushMicrotasks();

            // Entry should still exist — no retention GC
            expect(resource.getEntry(1)).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

// ==================== Retention time as a function ====================

/**
 * What a resource-level `retentionTime` function receives as `state`: the entry
 * row `getState` reports for those arguments. The entry exists whenever the
 * function runs, so the idle row is excluded.
 */
type TRetentionState<TArgs, TData> = Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>;

/**
 * `retentionTime` as a function of the entry's arguments and state. It runs on
 * the `active → retention` transition — synchronously inside the teardown of the
 * last subscriber — and its result governs exactly one retention cycle.
 */
describe("Retention time as a function", () => {
    /** Arm one retention cycle: subscribe to the entry and drop the subscription again. */
    function armRetention<TArgs, TData>(entry: QueryCacheEntry<TArgs, TData>): void {
        entry.obs.subscribe().unsubscribe();
    }

    it("receives the resource's own args: one args value is retained, another is dropped", async () => {
        vi.useFakeTimers();
        try {
            const seenArgs: number[] = [];
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                // The index is retained, a single item is not.
                retentionTime: (args: number) => {
                    seenArgs.push(args);
                    return args === 1 ? false : 0;
                },
            });

            resource.getEntry(1, true);
            resource.getEntry(2, true);
            await flushMicrotasks();

            armRetention(resource.getEntry(1)!);
            armRetention(resource.getEntry(2)!);

            expect(seenArgs).toEqual([1, 2]);

            vi.advanceTimersByTime(1);
            await flushMicrotasks();

            expect(resource.getEntry(1)).not.toBeNull();
            expect(resource.getEntry(2)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("receives the entry state row: a failed entry is dropped, a successful one is retained", async () => {
        vi.useFakeTimers();
        try {
            const failure = new Error("boom");
            const seen: TRetentionState<number, string>[] = [];
            const resource = createResource<number, string>({
                queryFn: async (args: number) => {
                    if (args === 2) throw failure;
                    return "data";
                },
                retentionTime: (_args: number, state: TRetentionState<number, string>) => {
                    seen.push(state);
                    return state.hasError ? 0 : false;
                },
            });

            resource.getEntry(1, true);
            resource.getEntry(2, true);
            await flushMicrotasks();

            armRetention(resource.getEntry(1)!);
            armRetention(resource.getEntry(2)!);

            // The derived entry row, not the raw entry record: `dataSource` and
            // the flags only exist on the former.
            expect(seen[0]).toMatchObject({
                status: "success",
                dataSource: "current",
                hasData: true,
                hasError: false,
                data: "data",
                args: 1,
            });
            expect(seen[1]).toMatchObject({
                status: "error",
                dataSource: "none",
                hasData: false,
                hasError: true,
                data: null,
                error: failure,
                args: 2,
            });

            vi.advanceTimersByTime(1);
            await flushMicrotasks();

            expect(resource.getEntry(1)).not.toBeNull();
            expect(resource.getEntry(2)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("false returned from the function keeps the entry alive", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: () => false,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            armRetention(resource.getEntry(1)!);

            vi.advanceTimersByTime(24 * 60 * 60 * 1000);
            await flushMicrotasks();

            expect(resource.getEntry(1)).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("is re-evaluated on the next loss of subscribers with the state as it is then", async () => {
        let attempt = 0;
        const seen: TRetentionState<number, string>[] = [];
        const resource = createResource<number, string>({
            queryFn: async () => {
                attempt += 1;
                if (attempt === 1) throw new Error("boom");
                return "data";
            },
            retentionTime: (_args: number, state: TRetentionState<number, string>) => {
                seen.push(state);
                return false;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;

        // Cycle 1 — the query failed.
        armRetention(entry);

        entry.retry();
        await flushMicrotasks();

        // Cycle 2 — same entry, the state it holds now.
        armRetention(entry);

        expect(seen).toHaveLength(2);
        expect(seen[0]).toMatchObject({ status: "error", hasData: false, hasError: true, args: 1 });
        expect(seen[1]).toMatchObject({ status: "success", hasData: true, hasError: false, data: "data", args: 1 });
    });

    it("a throwing function logs the entry key and evicts the entry immediately", async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const resource = createResource<number, string>({
                key: "users",
                queryFn: async () => "data",
                retentionTime: () => {
                    throw new Error("retention boom");
                },
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            // The throw must not escape the teardown: it would surface as an
            // UnsubscriptionError on the unsubscribing consumer.
            armRetention(resource.getEntry(1)!);

            vi.advanceTimersByTime(1);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull();
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(String(consoleError.mock.calls[0]?.[0])).toContain(`users:${stableStringify(1)}`);
        } finally {
            vi.useRealTimers();
            vi.restoreAllMocks();
        }
    });

    // A synchronous read is not a subscriber. `getState` must not count as one:
    // it would evaluate the policy outside any real `active → retention`
    // transition and restart a retention countdown that is already running.
    it("getState() neither evaluates the function nor re-arms a running retention timer", async () => {
        vi.useFakeTimers();
        try {
            const retentionTime = vi.fn((): number | false => 5_000);
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            // One real loss of subscribers: the policy runs once and arms 5 s.
            armRetention(resource.getEntry(1)!);
            expect(retentionTime).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(3_000);

            // A read-only look at the entry, midway through the countdown.
            expect(resource.getState(1)).toMatchObject({ status: "success", data: "data" });
            expect(retentionTime).toHaveBeenCalledTimes(1);

            // The original deadline still holds: the read did not restart it.
            vi.advanceTimersByTime(1_999);
            expect(resource.getEntry(1)).not.toBeNull();

            vi.advanceTimersByTime(2);
            await flushMicrotasks();
            expect(resource.getEntry(1)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it("getState() on an entry that was never subscribed does not arm a timer at all", async () => {
        vi.useFakeTimers();
        try {
            const retentionTime = vi.fn((): number | false => 5_000);
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime,
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            expect(resource.getState(1)).toMatchObject({ status: "success" });
            expect(retentionTime).not.toHaveBeenCalled();

            vi.advanceTimersByTime(60_000);
            await flushMicrotasks();

            expect(resource.getEntry(1)).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

// ==================== Lifecycle hooks error paths ====================

describe("Lifecycle hooks error paths", () => {
    it("$queryFulfilled rejects when queryFn fails", async () => {
        let rejection: unknown;

        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
            onQueryStarted: async (_args: number, ctx) => {
                try {
                    await ctx.$queryFulfilled;
                } catch (err) {
                    rejection = err;
                }
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe("boom");
    });

    it("$cacheDataLoaded resolves even when first query fails then retry succeeds", async () => {
        let loadedData: string | undefined;
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("initial fail");
                return "recovered";
            },
            onCacheEntryAdded: async (_args, ctx) => {
                loadedData = await ctx.$cacheDataLoaded;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(loadedData).toBeUndefined();

        // Retry should resolve $cacheDataLoaded
        resource.getEntry(1)!.retry();
        await flushMicrotasks();

        expect(loadedData).toBe("recovered");
    });

    it("async onCacheEntryAdded rejection is an unhandled promise (sync catch only)", async () => {
        // _fireOnCacheEntryAdded uses try/catch which only catches sync throws.
        // An async callback that rejects produces an unhandled rejection.
        // This test documents that sync errors ARE suppressed:
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: () => {
                throw new Error("sync lifecycle error");
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("async onCacheEntryAdded rejection is suppressed", async () => {
        const unhandled: unknown[] = [];
        const handler = (reason: unknown) => {
            unhandled.push(reason);
        };
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const proc = (globalThis as Record<string, unknown>)["process"] as {
            on(event: string, listener: (...args: unknown[]) => void): void;
            off(event: string, listener: (...args: unknown[]) => void): void;
        };
        proc.on("unhandledRejection", handler);

        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                onCacheEntryAdded: async () => {
                    throw new Error("boom");
                },
            });

            resource.getEntry(1, true);
            await flushMicrotasks();

            // Entry should still be created and queryFn should resolve normally
            const entry = resource.getEntry(1);
            expect(entry).not.toBeNull();
            expect(entry!.state$.peek().data).toBe("data");

            // No unhandled rejection should have been captured
            expect(unhandled).toEqual([]);
        } finally {
            proc.off("unhandledRejection", handler);
        }
    });

    it("failed query does not produce an unhandled rejection when onQueryStarted ignores $queryFulfilled", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const resource = createResource<number, string>({
                queryFn: async () => {
                    throw new Error("query failed");
                },
                onQueryStarted: () => {
                    /* does not consume ctx.$queryFulfilled */
                },
            });

            resource.getEntry(1, true);
            await flushUnhandledRejections();

            expect(resource.getEntry(1)!.state$.peek().status).toBe("error");
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("onQueryStarted receives updated context on an invalidation", async () => {
        const fulfillments: Array<{ data: string }> = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
            onQueryStarted: async (_args: number, ctx) => {
                const result = await ctx.$queryFulfilled;
                fulfillments.push(result);
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        expect(fulfillments).toEqual([{ data: "v1" }, { data: "v2" }]);
    });
});

// ==================== Concurrent trigger abort/cancel ====================

describe("Concurrent trigger abort/cancel", () => {
    it("invalidate on a pending entry restarts the run (the default in-flight policy is cancel)", async () => {
        const signals: AbortSignal[] = [];
        const queryFn = vi.fn((_args: number, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise<string>(() => {}); // never resolves
        });

        const resource = createResource<number, string>({ queryFn });

        // Held, as an entry with a mounted consumer is.
        holdEntry(resource, 1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // The run in flight is cancelled and started over.
        resource.invalidate(1);
        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(signals[0]!.aborted).toBe(true);
        expect(signals[1]!.aborted).toBe(false);
        expect(resource.getState(1).status).toBe("pending");
    });

    it("each execution receives a distinct AbortSignal", async () => {
        const signals: AbortSignal[] = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async (_args: number, signal: AbortSignal) => {
                signals.push(signal);
                return `v${++callCount}`;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
    });

    it("invalidate() from success aborts the previous controller and starts a new query", async () => {
        let callCount = 0;
        let resolvers: Array<(val: string) => void> = [];

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                return new Promise<string>((r) => {
                    resolvers.push(r);
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");

        // Start the invalidation → entry goes to invalidating, _execute creates new AbortController
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        // Resolve the invalidation
        resolvers[0]!("invalidated");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().data).toBe("invalidated");
    });

    it("reset while query is in-flight clears cache; late resolve is ignored", async () => {
        let resolveQuery!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        });

        resource.getEntry(1, true);
        // Query is in-flight
        expect(resource.getEntry(1)).not.toBeNull();

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();

        // Late resolve should not crash or re-add entry
        resolveQuery("late-data");
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
    });

    it("reset while an invalidation is in flight clears cache", async () => {
        let callCount = 0;
        let resolveInvalidate!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();

        // Late resolve of the invalidation should not crash or re-add entry
        resolveInvalidate("late-invalidate");
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
    });

    it("retry after error starts new query with fresh AbortSignal", async () => {
        const signals: AbortSignal[] = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async (_args: number, signal: AbortSignal) => {
                signals.push(signal);
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("recovered");
    });
});

// ==================== createPatch edge cases ====================

describe("QueryCacheEntry.createPatch edge cases", () => {
    type Data = { name: string };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peek = (e: any) => e.state$.peek() as any;

    function createSuccessEntry() {
        const resource = createResource<number, Data>({
            queryFn: async () => ({ name: "Alice" }),
        });
        resource.getEntry(1, true);
        return { resource, entry: () => resource.getEntry(1)! };
    }

    it("double-commit is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;
        expect(handle).not.toBeNull();

        handle.commit();
        const stateAfterFirstCommit = e.state$.peek();

        handle.commit();
        const stateAfterSecondCommit = e.state$.peek();

        expect(stateAfterSecondCommit).toBe(stateAfterFirstCommit);
    });

    it("abort after commit is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;

        handle.commit();
        const stateAfterCommit = e.state$.peek();

        handle.abort();
        const stateAfterAbort = e.state$.peek();

        expect(stateAfterAbort).toBe(stateAfterCommit);
    });

    it("commit after abort is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;

        handle.abort();
        const stateAfterAbort = e.state$.peek();

        handle.commit();
        const stateAfterCommit = e.state$.peek();

        expect(stateAfterCommit).toBe(stateAfterAbort);
    });

    it("returns null on pending entry", () => {
        const resource = createResource<number, Data>({
            queryFn: () => new Promise(() => {}), // never resolves — stays pending
        });
        resource.getEntry(1, true);

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("pending");

        const handle = entry.createPatch((d: Data) => {
            d.name = "Bob";
        });
        expect(handle).toBeNull();
    });

    it("returns null on error entry", async () => {
        const resource = createResource<number, Data>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });
        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        const handle = entry.createPatch((d: Data) => {
            d.name = "Bob";
        });
        expect(handle).toBeNull();
    });

    it("immediate abort after createPatch reverts data", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const original = peek(e).data;
        expect(original).toEqual({ name: "Alice" });

        const handle = e.createPatch((d: Data) => {
            d.name = "Patched";
        })!;
        expect(peek(e).data).toEqual({ name: "Patched" });

        handle.abort();
        expect(peek(e).data).toEqual({ name: "Alice" });
    });

    it("two patches: abort second, then commit first", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch1" });

        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h2.abort();
        expect(peek(e).data).toEqual({ name: "Patch1" });

        h1.commit();
        expect(peek(e).data).toEqual({ name: "Patch1" });
        expect(peek(e).patchState).toBeNull();
    });

    it("two patches: commit first, then abort second", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h1.commit();
        // h1 committed but h2 still pending — data still shows both patches applied
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h2.abort();
        // h2 aborted — data should show only h1's change
        expect(peek(e).data).toEqual({ name: "Patch1" });
        expect(peek(e).patchState).toBeNull();
    });

    it("two patches: abort both in reverse order", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;

        h2.abort();
        expect(peek(e).data).toEqual({ name: "Patch1" });

        h1.abort();
        expect(peek(e).data).toEqual({ name: "Alice" });
        expect(peek(e).patchState).toBeNull();
    });

    it("three patches: mixed commit/abort order", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "A";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "B";
        })!;
        const h3 = e.createPatch((d: Data) => {
            d.name = "C";
        })!;
        expect(peek(e).data).toEqual({ name: "C" });

        h2.abort();
        // pending#1, aborted#2, pending#3 → replay: #1 applies, #2 skipped, #3 applies
        expect(peek(e).data).toEqual({ name: "C" });

        h1.commit();
        // committed#1, aborted#2, pending#3 → #1 folded, #3 replayed
        expect(peek(e).data).toEqual({ name: "C" });

        h3.commit();
        // all settled → data finalized
        expect(peek(e).data).toEqual({ name: "C" });
        expect(peek(e).patchState).toBeNull();
    });

    it("consistency violation triggers an automatic invalidation", async () => {
        type Items = { items: { id: number; name: string }[] };
        let fetchCount = 0;
        const resource = createResource<void, Items>({
            queryFn: async () => {
                fetchCount++;
                return { items: [{ id: 1, name: `v${fetchCount}` }] };
            },
        });

        resource.getEntry(undefined, true);
        await flushMicrotasks();
        expect(fetchCount).toBe(1);

        const entry = resource.getEntry()!;

        // Patch 1: add item at index 1
        const h1 = entry.createPatch((d: Items) => {
            d.items.push({ id: 2, name: "added" });
        })!;

        // Patch 2: modify item at index 1 (depends on patch 1 existing)
        const h2 = entry.createPatch((d: Items) => {
            d.items[1]!.name = "modified";
        })!;

        // Abort patch 1 → patch 2's forward patches reference items[1] which won't exist
        // This should trigger consistency violation + automatic invalidation
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        entry.hold();
        h1.abort();

        // After consistency violation, the automatic invalidation kicks in
        // The entry should now be in invalidating state with fetchCount about to increment
        await flushMicrotasks();

        // The automatic invalidation should have re-fetched
        expect(fetchCount).toBe(2);

        // Commit patch 2 handle (already aborted via violation cleanup, should be no-op)
        h2.commit();
    });
});

// ==================== Edge Cases (MEDIUM priority) ====================

describe("Resource — retry() on non-error state is no-op", () => {
    it("retry() on success state does not re-query or change state", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(1);

        entry.retry();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });
});

describe("Resource — multi-key invalidation isolation", () => {
    it("invalidating key=1 does not affect key=2 success state", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (n: number) => {
                callCount++;
                return `data-${n}-call${callCount}`;
            },
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        const entry2 = resource.getEntry(2)!;
        expect(entry1.state$.peek().status).toBe("success");
        expect(entry2.state$.peek().status).toBe("success");

        const entry2DataBefore = entry2.state$.peek().data;

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        // key=2 remains unchanged
        expect(entry2.state$.peek().status).toBe("success");
        expect(entry2.state$.peek().data).toBe(entry2DataBefore);

        // key=1 was invalidated
        expect(entry1.state$.peek().status).toBe("success");
        expect(entry1.state$.peek().data).not.toBe("data-1-call1");
    });
});

describe("CacheEntry — set after complete() is ignored", () => {
    it("set() after complete() does not change state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");

        // Capture the state value via peek() before complete
        const dataBefore = entry.state$.peek().data;

        entry.complete();

        // Attempt to set after complete — CacheEntry._isCompleted guards this
        entry.set(pendingEntryState<number>(1));

        // peek() on the underlying state should still return the last value
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toBe(dataBefore);
    });
});

// ==================== ensure ====================

describe("Resource.ensure", () => {
    it("creates a cold entry and resolves with its first loaded data", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const data = await resource.ensure(1);

        expect(data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("returns cached data immediately without re-fetching on a cache hit", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const data = await resource.ensure(1);
        expect(data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("awaits an in-flight query rather than starting a new one", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        const p = resource.ensure(1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        expect(await p).toBe("data");
    });

    it("resolves immediately with stale data while an invalidation is in flight", async () => {
        let resolveInvalidate!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        // ensure hands back the stale value without waiting for the invalidation
        expect(await resource.ensure(1)).toBe("v1");

        resolveInvalidate("v2");
        await flushMicrotasks();
    });

    it("rejects when the cold query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.ensure(1)).rejects.toThrow("boom");
    });

    it("retries a previously failed entry and resolves on success", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        const data = await resource.ensure(1);
        expect(data).toBe("recovered");
        expect(callCount).toBe(2);
    });

    it("handles void args", async () => {
        const resource = createResource<void, string>({
            queryFn: async () => "void-data",
        });

        expect(await resource.ensure(undefined as void)).toBe("void-data");
    });

    it("rejects (does not synchronously throw) when serializeArgs throws", async () => {
        const error = new Error("serialize boom");
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.ensure(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });
});

// ==================== fetch ====================

describe("Resource.fetch", () => {
    it("creates a cold entry and resolves with fresh data", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        expect(await resource.fetch(1)).toBe("data");
    });

    it("on a cached entry resolves with fresh data, not the stale cached value", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        expect(await resource.ensure(1)).toBe("v1");
        expect(await resource.fetch(1)).toBe("v2");
        expect(callCount).toBe(2);
    });

    it("with inFlight: 'join' dedups against an in-flight query instead of starting another", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        const p1 = resource.fetch(1);
        const p2 = resource.fetch(1, { inFlight: "join" });
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        expect(await p1).toBe("data");
        expect(await p2).toBe("data");
    });

    it("rejects when an invalidation fails, leaving stale data in the cache", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                throw new Error("invalidation failed");
            },
        });

        expect(await resource.ensure(1)).toBe("v1");
        await expect(resource.fetch(1)).rejects.toThrow("invalidation failed");

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");
        expect(entry.state$.peek().data).toBe("v1");
    });

    it("retries a previously failed entry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        expect(await resource.fetch(1)).toBe("recovered");
    });

    it("rejects when the cold query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.fetch(1)).rejects.toThrow("boom");
    });

    it("rejects (does not synchronously throw) when serializeArgs throws", async () => {
        const error = new Error("serialize boom");
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.fetch(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });
});

// ==================== prefetch ====================

describe("Resource.prefetch", () => {
    it("warms the cache and resolves with void", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const result = await resource.prefetch(1);

        expect(result).toBeUndefined();
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("never rejects when the query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.prefetch(1)).resolves.toBeUndefined();
    });

    it("reuses cached data without re-fetching", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.getEntry(1, true);
        await flushMicrotasks();

        await resource.prefetch(1);
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("creates the entry synchronously, before the promise settles", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        void resource.prefetch(1);

        expect(resource.getEntry(1)).not.toBeNull();
    });

    it("force: invalidates an existing entry with fresh data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        await resource.prefetch(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("v1");

        await resource.prefetch(1, { force: true });
        expect(callCount).toBe(2);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("v2");
    });

    it("force: creates and loads a cold entry", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        await resource.prefetch(1, { force: true });

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("force: retries a previously failed entry and still never rejects", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                throw new Error(`fail-${callCount}`);
            },
        });

        await resource.prefetch(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        await expect(resource.prefetch(1, { force: true })).resolves.toBeUndefined();
        expect(callCount).toBe(2);
    });

    it("force with inFlight: 'join' awaits an in-flight query instead of starting another", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        void resource.prefetch(1);
        const p = resource.prefetch(1, { force: true, inFlight: "join" });
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        await p;

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("force: invalidates an invalidate-error entry with fresh data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 2) throw new Error("invalidation failed");
                return `v${callCount}`;
            },
        });

        await resource.ensure(1); // v1
        await resource.fetch(1).catch(() => {}); // invalidate fails → invalidate-error
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidate-error");

        await resource.prefetch(1, { force: true });

        const state = resource.getEntry(1)!.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("v3");
    });

    it("never rejects (and does not synchronously throw) when serializeArgs throws", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw new Error("serialize boom");
            },
        });

        let promise!: Promise<void>;
        expect(() => {
            promise = resource.prefetch(1);
        }).not.toThrow();

        await expect(promise).resolves.toBeUndefined();
    });
});

// ==================== Abort semantics ====================

describe("ensure/fetch abort semantics", () => {
    it("rejects immediately without starting a query when the signal is already aborted", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const ac = new AbortController();
        ac.abort();

        await expect(resource.ensure(1, { signal: ac.signal })).rejects.toHaveProperty("name", "AbortError");
        expect(queryFn).not.toHaveBeenCalled();
        expect(resource.getEntry(1)).toBeNull();
    });

    it("rejects with the signal's reason when aborted mid-flight", async () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        const ac = new AbortController();
        const reason = new Error("navigation cancelled");
        const p = resource.ensure(1, { signal: ac.signal });
        p.catch(() => {});

        ac.abort(reason);
        await expect(p).rejects.toBe(reason);
    });

    it("aborting one caller does not cancel a query another consumer is awaiting", async () => {
        let resolveQuery!: (v: string) => void;
        let capturedSignal: AbortSignal | undefined;
        const resource = createResource<number, string>({
            queryFn: (_args, signal) => {
                capturedSignal = signal;
                return new Promise<string>((r) => {
                    resolveQuery = r;
                });
            },
            retentionTime: false,
        });

        const ac = new AbortController();
        const p1 = resource.ensure(1, { signal: ac.signal });
        const p2 = resource.ensure(1);
        p1.catch(() => {});

        ac.abort();
        await expect(p1).rejects.toHaveProperty("name", "AbortError");

        // The shared in-flight query is left running for the second consumer.
        expect(capturedSignal!.aborted).toBe(false);

        resolveQuery("data");
        expect(await p2).toBe("data");
    });

    it("tears down the lone query via retention GC once the aborted caller leaves", async () => {
        vi.useFakeTimers();
        try {
            let capturedSignal: AbortSignal | undefined;
            const resource = createResource<number, string>({
                queryFn: (_args, signal) => {
                    capturedSignal = signal;
                    return new Promise<string>(() => {});
                },
                retentionTime: 5000,
            });

            const ac = new AbortController();
            const p = resource.ensure(1, { signal: ac.signal });
            p.catch(() => {});

            expect(capturedSignal).toBeDefined();
            expect(capturedSignal!.aborted).toBe(false);

            ac.abort();
            await expect(p).rejects.toHaveProperty("name", "AbortError");

            // No other consumer remains → retention countdown begins.
            expect(resource.getEntry(1)).not.toBeNull();
            expect(capturedSignal!.aborted).toBe(false);

            vi.advanceTimersByTime(5001);
            await flushMicrotasks();

            // Entry GC'd and the underlying request torn down.
            expect(resource.getEntry(1)).toBeNull();
            expect(capturedSignal!.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ==================== whenLoaded / whenFetched (entry primitives) ====================

describe("QueryCacheEntry.whenLoaded / whenFetched", () => {
    it("whenLoaded resolves synchronously for an already-successful entry", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(await resource.getEntry(1)!.whenLoaded()).toBe("data");
    });

    it("whenLoaded rejects with CacheEntryRemovedError when the entry is removed before settling", async () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        resource.getEntry(1, true);
        const entry = resource.getEntry(1)!;
        const p = entry.whenLoaded();
        p.catch(() => {});

        entry.complete();
        await expect(p).rejects.toBeInstanceOf(CacheEntryRemovedError);
    });

    it("whenFetched keeps awaiting through stale data until the invalidation settles", async () => {
        let resolveInvalidate!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        entry.hold();
        entry.invalidate();
        expect(entry.state$.peek().status).toBe("invalidating");

        const p = entry.whenFetched();
        let settled = false;
        void p.then(() => {
            settled = true;
        });

        // Still invalidating with stale data — whenFetched must not have resolved yet.
        await flushMicrotasks();
        expect(settled).toBe(false);

        resolveInvalidate("v2");
        expect(await p).toBe("v2");
    });
});

// ==================== getState (entry-state matrix) ====================
//
// `resource.getState(args)` is the clutch state of a single cache entry: the
// same fields and flags, `dataSource` narrowed to `none | current` (one entry
// has neither previous nor placeholder data) and no methods. Its matrix rows
// are 1, 2, 5, 6, 7, 9, 10 and 12 — one test each, asserting the whole shape.

describe("Resource.getState — entry-state matrix", () => {
    it("row 1 — no entry: idle with nothing to show", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        expect(resource.getState(1)).toEqual({
            status: "idle",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: null,
            error: null,
            hasData: false,
            hasError: false,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 2 — initial load in flight: pending with nothing to show", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        resource.getEntry(1, true);

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: null,
            hasData: false,
            hasError: false,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 5 — success: the entry's own data, no error", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "good-data",
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(resource.getState(1)).toEqual({
            status: "success",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: null,
            hasData: true,
            hasError: false,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 6 — invalidation in flight: pending behind the entry's own data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                return new Promise<string>(() => {});
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: null,
            hasData: true,
            hasError: false,
            isPending: true,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: true,
        });
    });

    it("row 7 — the initial load failed: error with nothing to show", async () => {
        const failure = new Error("boom");
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw failure;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "error",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 9 — the invalidation failed: error behind the entry's own data", async () => {
        const failure = new Error("invalidation failed");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                throw failure;
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();

        // Guard: the entry is in invalidate-error, which the derived state
        // reports as `error` with the data kept.
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidate-error");

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "error",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: failure,
            hasData: true,
            hasError: true,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 10 — retry of row 7: pending with the failure still readable", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", dataSource: "none" });

        resource.getEntry(1)!.retry();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 12 — retry of row 9: pending behind the data, failure still readable", async () => {
        const failure = new Error("invalidation failed");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.resolve("good-data");
                if (callCount === 2) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", dataSource: "current" });

        resource.getEntry(1)!.retry();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "pending",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: failure,
            hasData: true,
            hasError: true,
            isPending: true,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: true,
        });
        expect(state.error).toBe(failure);
    });

    it("never reports a placeholder: the option belongs to the clutch, not to an entry", async () => {
        const placeholderData = vi.fn(() => ({ data: "placeholder" }));
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
            placeholderData,
        });

        resource.getEntry(1, true);

        // Row 2, not row 3: the entry itself has nothing to show.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "none",
            data: null,
            hasData: false,
        });

        await flushMicrotasks();

        // Row 7, not row 13.
        expect(resource.getState(1)).toMatchObject({
            status: "error",
            dataSource: "none",
            data: null,
            hasData: false,
        });

        resource.getEntry(1)!.retry();

        // Row 10, not row 14.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "none",
            data: null,
            hasData: false,
            hasError: true,
        });

        expect(placeholderData).not.toHaveBeenCalled();
    });

    it("invalidate() on a failed entry re-runs it with the error cleared (row 7 → row 2)", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", hasError: true });

        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.invalidate(1);

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: null,
            hasData: false,
            hasError: false,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(callCount).toBe(2);
    });

    it("prefetch(force) on a failed entry retries it, keeping the failure visible (row 7 → row 10)", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", hasError: true });

        void resource.prefetch(1, { force: true });

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(callCount).toBe(2);
    });
});

// ==================== Synchronous throw from queryFn ====================
//
// A non-async queryFn can throw *synchronously*, before any promise exists.
// That throw used to escape the QueryCacheEntry constructor — so getEntry() /
// ensure() / fetch() threw synchronously and no entry was created — and, on
// invalidate()/retry(), escaped _execute() after the entry had already moved to
// invalidating/pending, stranding it there forever. The throw must instead flow
// through the entry's state like any other query failure.
describe("Resource — synchronous throw from queryFn", () => {
    it("getEntry(args, true) does not throw; the entry is created and settles in error state", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        expect(() => resource.getEntry(1, true)).not.toThrow();
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        const state = entry!.state$.peek();
        expect(state.status).toBe("error");
        if (state.status !== "error") throw new Error("expected error state");
        expect(state.error).toBe(error);
    });

    it("ensure() rejects instead of throwing synchronously", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.ensure(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("fetch() rejects instead of throwing synchronously", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.fetch(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("invalidate() lands in invalidate-error (entry not stranded in invalidating) and can recover", async () => {
        let attempt = 0;
        const resource = createResource<number, string>({
            queryFn: (n) => {
                attempt++;
                if (attempt === 2) throw new Error("sync boom");
                return Promise.resolve(`data-${n}-attempt-${attempt}`);
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        entry.hold();
        entry.invalidate();
        await flushMicrotasks();

        const state = entry.state$.peek();
        expect(state.status).toBe("invalidate-error");
        if (state.status !== "invalidate-error") throw new Error("expected invalidate-error state");
        // Stale data survives the failed invalidation.
        expect(state.data).toBe("data-1-attempt-1");

        // The entry is alive: a further invalidate() recovers.
        entry.invalidate();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-1-attempt-3");
    });

    it("retry() returns to error (entry not stranded in pending) and can recover", async () => {
        let attempt = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                attempt++;
                if (attempt < 3) throw new Error(`sync boom ${attempt}`);
                return Promise.resolve("recovered");
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        // Retry hits another sync throw — must settle back in error, not hang in pending.
        entry.retry();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });

    it("beforeQuery fallback path settles the entry in error state", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            key: "r",
            queryFn: () => {
                throw error;
            },
            beforeQuery: async () => null,
        });

        // ensure() awaits the full beforeQuery → fallback-execute chain.
        await expect(resource.ensure(1)).rejects.toBe(error);

        const state = resource.getEntry(1)!.state$.peek();
        expect(state.status).toBe("error");
        if (state.status !== "error") throw new Error("expected error state");
        expect(state.error).toBe(error);
    });

    it("does not produce an unhandled rejection", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const resource = createResource<number, string>({
                queryFn: () => {
                    throw new Error("sync boom");
                },
            });

            resource.getEntry(1, true);
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("fires onQueryStarted with a rejecting $queryFulfilled", async () => {
        const error = new Error("sync boom");
        const seen: unknown[] = [];
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
            onQueryStarted: async (_args, { $queryFulfilled }) => {
                try {
                    await $queryFulfilled;
                } catch (e) {
                    seen.push(e);
                }
            },
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        expect(seen).toEqual([error]);
    });
});

// ==================== Deprecated aliases ====================

describe("Resource — deprecated aliases", () => {
    it("refresh(args) forwards to invalidate(args)", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `data-${++callCount}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const invalidate = vi.spyOn(resource, "invalidate");
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        holdEntry(resource, 1);
        resource.refresh(1);

        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledWith(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data-2");
    });

    it("createAgent() forwards to createClutch()", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        const createClutch = vi.spyOn(resource, "createClutch");
        const clutch = resource.createAgent();

        expect(createClutch).toHaveBeenCalledTimes(1);
        expect(clutch).toBeInstanceOf(ResourceClutch);
    });

    it("pack(args) forwards to bind(args)", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        const bind = vi.spyOn(resource, "bind");
        const descriptor = resource.pack(1);

        expect(bind).toHaveBeenCalledTimes(1);
        expect(bind).toHaveBeenCalledWith(1);
        expect(descriptor).toEqual({ kind: "resource", resource, args: 1 });
    });

    it("QueryCacheEntry.refresh() forwards to invalidate()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `data-${++callCount}`,
        });

        resource.getEntry(1, true);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        const invalidate = vi.spyOn(entry, "invalidate");
        // Held, as an entry with a mounted consumer is: invalidate() re-runs at once.
        entry.hold();
        entry.refresh();

        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(entry.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(entry.state$.peek().data).toBe("data-2");
    });
});
