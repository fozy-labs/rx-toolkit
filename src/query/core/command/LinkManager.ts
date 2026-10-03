import type { IPatchHandle, IQueryCacheEntry, TLinkConfig } from "@/query/types";

import type { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { isDataState } from "../machine/machine-helpers";

/**
 * A patch applied to a link's entry, kept with the entry it must commit on:
 * the commit waits for the entry's run in flight (see
 * {@link QueryCacheEntry._afterRunInFlight}), so a response sent before the
 * mutation cannot settle over the just-committed patch and erase it.
 */
export interface TLinkedPatch {
    entry: IQueryCacheEntry<any, any>;
    handle: IPatchHandle;
}

// ==================== LinkManager ====================

/**
 * Encapsulates link-based patching and invalidation logic for a {@link Command}.
 *
 * Responsible for:
 * - Applying optimistic patches before the mutation runs.
 * - Applying update patches after successful mutation.
 * - Invalidating linked resources.
 *
 * @template TArgs - The argument type of the owning Command.
 * @template TData - The data type returned by the owning Command.
 */
export class LinkManager<TArgs, TData> {
    constructor(private readonly _links: TLinkConfig<TArgs, TData, any, any>[]) {}

    applyOptimisticPatches(args: TArgs): TLinkedPatch[] {
        const patches: TLinkedPatch[] = [];

        try {
            for (const link of this._links) {
                if (!link.optimisticUpdate) continue;

                const forwardedArgs = link.forwardArgs(args);
                const entry = link.resource.getEntry(forwardedArgs);

                // A link on an entry with no data is silently inapplicable —
                // nothing to update. `createPatch` must not be called on it:
                // its non-data warning is for callers who actually invoked it.
                if (!entry || !isDataState(entry.peek())) continue;

                const handle = entry.createPatch((draft) => {
                    link.optimisticUpdate!(draft, args);
                });

                if (handle) patches.push({ entry, handle });
            }
        } catch (error) {
            // A link's optimisticUpdate (or arg forwarding) threw partway through.
            // Roll back every patch applied so far so no dangling optimistic state
            // is left on already-processed resources, then re-throw so the caller
            // can surface the failure.
            for (const p of patches) p.handle.abort();
            throw error;
        }

        return patches;
    }

    applyUpdatePatches(args: TArgs, result: TData): void {
        for (const link of this._links) {
            if (!link.update) continue;

            // Isolated per link: a throwing forwardArgs()/update() on one link
            // must not skip the remaining links (see {@link settle}).
            this._runIsolated(() => {
                const forwardedArgs = link.forwardArgs(args);
                const entry = link.resource.getEntry(forwardedArgs);

                // Nothing to update on an entry without data — skipped
                // silently, as `optimisticUpdate` above.
                if (!entry || !isDataState(entry.peek())) return;

                const handle = entry.createPatch((draft) => {
                    link.update!(draft, args, result);
                });

                if (handle) this._commitAfterRun(entry, handle);
            });
        }
    }

    invalidateResources(args: TArgs): void {
        for (const link of this._links) {
            if (!link.invalidate) continue;

            const { invalidate } = link;

            // Isolated per link: one throwing forwardArgs()/invalidate() must not
            // skip invalidation of the remaining links.
            this._runIsolated(() => {
                const forwardedArgs = link.forwardArgs(args);
                // `true` is the plain call — the resource's own in-flight default
                // applies, and the call shape stays what it was without the option.
                if (invalidate === true) {
                    link.resource.invalidate(forwardedArgs);
                } else {
                    link.resource.invalidate(forwardedArgs, invalidate);
                }
            });
        }
    }

    /**
     * Handle the settled result of a mutation: commit or rollback optimistic
     * patches, apply update patches, and invalidate linked resources.
     *
     * Contract: **this never throws.** It runs inside an unconsumed `.then`
     * handler in {@link Command.execute}, so any escaping error would become an
     * unhandled rejection — and the mutation itself has already succeeded, so
     * there is nowhere to surface it. On a fulfilled result every phase is
     * therefore isolated and the optimistic handles are always committed exactly
     * once, even when a user-supplied `update`/`forwardArgs`/`invalidate` throws:
     * - a dangling optimistic patch would otherwise be left pending forever;
     * - invalidation is the reconciliation that repairs a bad patch, so it must
     *   still run after a failed `update`.
     */
    settle(args: TArgs, patches: TLinkedPatch[], result: PromiseSettledResult<TData>): void {
        if (result.status === "fulfilled") {
            this.applyUpdatePatches(args, result.value);
            for (const p of patches) this._commitAfterRun(p.entry, p.handle);
            this.invalidateResources(args);
        } else {
            for (const p of patches) this._runIsolated(() => p.handle.abort());
        }
    }

    /**
     * Commit `handle` on `entry` once its run in flight — a request sent before
     * the mutation — leaves flight; immediately when none is (an open stream
     * included). A response that was in flight at commit time settles first and
     * rebases the still-pending patch onto it — the patch lands on the answer
     * instead of being folded into `originalData` and dropped by that answer's
     * rebase. An `invalidate` that cancels the run flushes the commit on the
     * abort, ahead of the re-query the cancellation starts.
     */
    private _commitAfterRun(entry: IQueryCacheEntry<any, any>, handle: IPatchHandle): void {
        // Every entry is a QueryCacheEntry; the method is internal to the
        // cache layer.
        (entry as QueryCacheEntry<any, any>)._afterRunInFlight(() => this._runIsolated(() => handle.commit()));
    }

    /**
     * Run a settle sub-step, containing any throw so it can neither abort the
     * surrounding loop nor escape {@link settle}. The failure is reported (not
     * silently swallowed) because it almost always signals a bug in a
     * user-supplied link callback.
     */
    private _runIsolated(fn: () => void): void {
        try {
            fn();
        } catch (error) {
            console.error("[LinkManager] A link callback threw while settling a mutation; continuing.", error);
        }
    }
}
