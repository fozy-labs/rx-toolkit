import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { Resource } from "@/query/core/resource/Resource";
import { ResourceClutch } from "@/query/core/resource/ResourceClutch";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig, TQueryEntryState } from "@/query/types";

/**
 * A rebase whose optimistic patches cannot be replayed over the server data is
 * a *discarded* run: the data the entry holds is the optimistic one, and the
 * server answer it was supposed to settle with was thrown away.
 *
 * The entry therefore must not publish a settled `success` for it. It stays in
 * `invalidating` — query in flight, data stale, `updatedAt` still that of the
 * last real settle — and immediately starts another run, whose rebase replays
 * an empty patch list and lands in a clean `success` with the server data.
 *
 * Everything that reads `state$` synchronously depends on this: `fetch()` /
 * `whenFetched()` / a command's result promise settle on `success`, clutches
 * and `useSuspenseResource` render it, `Syncer` answers cross-tab requests from
 * it. A transient `success` carrying the discarded optimistic data would leak
 * into all of them in the same tick.
 */

// ==================== Helpers ====================

type Items = { items: { n: number }[] };

/** A patch on `items[0]` cannot replay over an empty array — immer throws. */
const INCOMPATIBLE: Items = { items: [] };

function createResource(queryFn: IResourceConfig<void, Items>["queryFn"]) {
    return new Resource<void, Items>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: void) => string,
        queryFn,
    });
}

/**
 * An entry holding `{ items: [{ n: 1 }] }` with one *pending* optimistic patch
 * (`n = 99`), plus the queue the next runs answer from.
 */
async function withPendingPatch(nextRuns: Items[]) {
    let run = 0;
    const resource = createResource(async () => {
        const index = run;
        run += 1;
        return index === 0 ? { items: [{ n: 1 }] } : nextRuns[index - 1]!;
    });

    resource.getEntry(undefined, true);
    await flushMicrotasks();

    // Held, as an entry with a mounted consumer is: `invalidate()` re-runs at
    // once instead of only marking the entry.
    const entry = resource.getEntry(undefined, true);
    entry.hold();
    entry.createPatch((draft) => {
        draft.items[0]!.n = 99;
    });

    return { resource, entry, runs: () => run };
}

type TSeen = { status: string; data: Items | null; violation: boolean; updatedAt: number | null };

function record(state: TQueryEntryState<void, Items>): TSeen {
    return {
        status: state.status,
        data: state.data,
        violation: state.status !== "pending" && state.status !== "error" && !!state.patchState?.isConsistencyViolation,
        updatedAt: state.updatedAt,
    };
}

// ==================== Tests ====================

describe("consistency violation on rebase", () => {
    it("never publishes a success for the discarded run", async () => {
        const { resource, entry } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);

        const settledAt = entry.state$.peek().updatedAt;
        const seen: TSeen[] = [];
        const sub = entry.state$.obs.subscribe((state) => seen.push(record(state)));
        seen.length = 0; // drop the replayed current state

        resource.invalidate();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
        sub.unsubscribe();

        expect(seen.map((s) => s.status)).toEqual(["invalidating", "invalidating", "success"]);

        // The discarded run is visible only as a flagged `invalidating`: stale
        // data, and the timestamp of the last real settle — not a fresh one.
        expect(seen[1]).toMatchObject({ status: "invalidating", violation: true, updatedAt: settledAt });
        expect(seen[1]!.data).toEqual({ items: [{ n: 99 }] });

        // No emission ever claims a settled success for the discarded patches.
        expect(seen.filter((s) => s.status === "success" && s.violation)).toEqual([]);
    });

    it("settles the follow-up run in a clean success with the server data", async () => {
        const { resource, entry } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);
        const settledAt = entry.state$.peek().updatedAt!;

        resource.invalidate();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ items: [{ n: 5 }] });
        // The dropped patches are gone, not carried into the next state.
        expect(state.status === "success" && state.patchState).toBeNull();
        expect(state.updatedAt!).toBeGreaterThanOrEqual(settledAt);
    });

    it("fetch() resolves with the re-queried data, not with the discarded optimistic one", async () => {
        const { resource } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);

        await expect(resource.fetch()).resolves.toEqual({ items: [{ n: 5 }] });
    });

    it("ensure() keeps resolving from the stale data it is allowed to show", async () => {
        const { resource } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);

        // `ensure` resolves on any data-bearing state by contract, so it is not
        // the surface the violation can leak a false settle into — pinned so a
        // future change to `whenLoaded` has to say so out loud.
        await expect(resource.ensure()).resolves.toEqual({ items: [{ n: 99 }] });
    });

    it("keeps the clutch on the in-flight row until the follow-up run settles", async () => {
        const { resource } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);

        const clutch = new ResourceClutch<void, Items>(resource);
        clutch.switch(undefined);
        clutch.start();

        const seen: { status: string; isInvalidating: boolean; data: Items | null }[] = [];
        const sub = clutch.state$.obs.subscribe((state) =>
            seen.push({ status: state.status, isInvalidating: state.isInvalidating, data: state.data }),
        );
        seen.length = 0;

        resource.invalidate();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();
        sub.unsubscribe();

        // Until the follow-up run settles, the clutch reports an invalidation in
        // flight over the stale data — never a settled success carrying it.
        const beforeSettle = seen.slice(0, -1);
        expect(beforeSettle.every((s) => s.status === "pending" && s.isInvalidating)).toBe(true);
        expect(seen.at(-1)).toEqual({ status: "success", isInvalidating: false, data: { items: [{ n: 5 }] } });

        clutch.switch(undefined);
    });

    it("runs exactly one follow-up query", async () => {
        const { resource, runs } = await withPendingPatch([INCOMPATIBLE, { items: [{ n: 5 }] }]);

        resource.invalidate();
        await flushMicrotasks();
        await flushMicrotasks();
        await flushMicrotasks();

        // run 1 (initial) + run 2 (invalidation, discarded) + run 3 (follow-up).
        expect(runs()).toBe(3);
    });
});
