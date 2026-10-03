import type { TLifecycleHookOption } from "@/query/types";

/** A lifecycle hook (`onQueryStarted` / `onCacheEntryAdded`) as the runtime sees it. */
type TLifecycleHook<TArgs, TCtx> = (args: TArgs, ctx: TCtx) => void | Promise<void>;

/**
 * Combines already-flattened lifecycle hooks into a single one. With no hooks
 * the result is `undefined`, and a single hook is returned as-is.
 *
 * Hooks may be async and long-lived (the documented lifecycle patterns await
 * `$cacheEntryRemoved` / `$queryFulfilled`), so they always start concurrently:
 * awaiting one before calling the next would defer it past the very lifecycle
 * events it exists to observe. Errors are suppressed per hook — the same policy
 * the runtime applies to a standalone lifecycle hook — so one failing hook never
 * prevents the others from running and the combined promise never rejects.
 *
 * Shared by {@link mergeHooks} (api-level + option-level merging) and by the
 * deprecated public `composeHooks`.
 */
export function combineHooks<TArgs, TCtx>(
    hooks: ReadonlyArray<TLifecycleHook<TArgs, TCtx>>,
): TLifecycleHook<TArgs, TCtx> | undefined {
    if (hooks.length === 0) return undefined;
    if (hooks.length === 1) return hooks[0];

    const present = [...hooks];

    return (args, ctx) => {
        const run = (hook: TLifecycleHook<TArgs, TCtx>): Promise<unknown> => {
            try {
                return Promise.resolve(hook(args, ctx)).catch(() => undefined);
            } catch {
                return Promise.resolve();
            }
        };

        return Promise.all(present.map(run)).then(() => undefined);
    };
}

/**
 * Merges lifecycle hook *options* — each one either a single hook or an array of
 * hooks (see {@link TLifecycleHookOption}) — into the single hook the runtime
 * config expects. `undefined` and `false` entries, and whole `undefined`
 * options, are skipped; with nothing left the result is `undefined`, and a
 * single remaining hook is returned as-is.
 *
 * Internal to the Api: it merges an api-level option with the
 * resource/command-level one. Not part of the public barrel.
 */
export function mergeHooks<TArgs, TCtx>(
    ...options: Array<TLifecycleHookOption<TLifecycleHook<TArgs, TCtx>> | undefined>
): TLifecycleHook<TArgs, TCtx> | undefined {
    const flattened: Array<TLifecycleHook<TArgs, TCtx>> = [];

    for (const option of options) {
        if (!option) continue;

        if (Array.isArray(option)) {
            for (const hook of option) {
                if (hook) flattened.push(hook);
            }
        } else {
            flattened.push(option);
        }
    }

    return combineHooks(flattened);
}
