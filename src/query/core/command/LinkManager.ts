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

            const forwardedArgs = link.forwardArgs(args);
            const entry = link.resource.getEntry(forwardedArgs);

            const handle = entry?.createPatch((draft) => {
                link.update!(draft, args, result);
            });

            if (handle) handle.commit();
        }
    }

    invalidateResources(args: TArgs): void {
        for (const link of this._links) {
            if (!link.invalidate) continue;

            const forwardedArgs = link.forwardArgs(args);
            const resource = link.resource;

            resource.refresh(forwardedArgs);
        }
    }

    /**
     * Handle the settled result of a mutation: commit or rollback optimistic
     * patches, apply update patches, and invalidate linked resources.
     */
    settle(args: TArgs, patchHandles: IPatchHandle[], result: PromiseSettledResult<TData>): void {
        if (result.status === "fulfilled") {
            this.applyUpdatePatches(args, result.value);
            for (const h of patchHandles) h.commit();
            this.invalidateResources(args);
        } else {
            for (const h of patchHandles) h.abort();
        }
    }
}
