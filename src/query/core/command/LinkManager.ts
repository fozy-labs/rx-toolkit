import type { IPatchHandle, TLinkConfig } from "@/query/types";

// ==================== LinkManager ====================

/**
 * Encapsulates link-based patching and invalidation logic for a {@link Command}.
 *
 * Responsible for:
 * - Applying optimistic patches before the mutation runs.
 * - Applying update patches after successful mutation.
 * - Invalidating / refreshing linked resources.
 *
 * @template TArgs - The argument type of the owning Command.
 * @template TData - The data type returned by the owning Command.
 */
export class LinkManager<TArgs, TData> {
    constructor(private readonly _links: TLinkConfig<TArgs, TData, any, any>[]) {}

    applyOptimisticPatches(args: TArgs): IPatchHandle[] {
        const handles: IPatchHandle[] = [];

        try {
            for (const link of this._links) {
                if (!link.optimisticUpdate) continue;

                const forwardedArgs = link.forwardArgs(args);
                const entry = link.resource.getEntry(forwardedArgs);

                const handle = entry?.createPatch((draft) => {
                    link.optimisticUpdate!(draft, args);
                });

                if (handle) handles.push(handle);
            }
        } catch (error) {
            // A link's optimisticUpdate (or arg forwarding) threw partway through.
            // Roll back every patch applied so far so no dangling optimistic state
            // is left on already-processed resources, then re-throw so the caller
            // can surface the failure.
            for (const h of handles) h.abort();
            throw error;
        }

        return handles;
    }

    applyUpdatePatches(args: TArgs, result: TData): void {
        for (const link of this._links) {
            if (!link.update) continue;

            // Isolated per link: a throwing forwardArgs()/update() on one link
            // must not skip the remaining links (see {@link settle}).
            this._runIsolated(() => {
                const forwardedArgs = link.forwardArgs(args);
                const entry = link.resource.getEntry(forwardedArgs);

                const handle = entry?.createPatch((draft) => {
                    link.update!(draft, args, result);
                });

                handle?.commit();
            });
        }
    }

    invalidateResources(args: TArgs): void {
        for (const link of this._links) {
            if (!link.invalidate) continue;

            // Isolated per link: one throwing forwardArgs()/refresh() must not
            // skip invalidation of the remaining links.
            this._runIsolated(() => {
                const forwardedArgs = link.forwardArgs(args);
                link.resource.refresh(forwardedArgs);
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
    settle(args: TArgs, patchHandles: IPatchHandle[], result: PromiseSettledResult<TData>): void {
        if (result.status === "fulfilled") {
            this.applyUpdatePatches(args, result.value);
            for (const h of patchHandles) this._runIsolated(() => h.commit());
            this.invalidateResources(args);
        } else {
            for (const h of patchHandles) this._runIsolated(() => h.abort());
        }
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
