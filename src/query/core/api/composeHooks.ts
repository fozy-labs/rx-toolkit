/**
 * Composes several lifecycle hooks (`onQueryStarted` / `onCacheEntryAdded`)
 * into a single hook. `undefined` entries are skipped; with no hooks left the
 * result is `undefined`, and a single hook is returned as-is.
 *
 * Hooks may be async and long-lived (the documented lifecycle patterns await
 * $cacheEntryRemoved / $queryFulfilled), so they always start concurrently:
 * awaiting one before calling the next would defer it past the very lifecycle
 * events it exists to observe. Errors are suppressed per hook — the same
 * policy the runtime applies to a standalone lifecycle hook — so one failing
 * hook never prevents the others from running and the composed promise never
 * rejects.
 *
 * The Api uses this internally to combine api-level hooks with
 * resource/command-level ones; consumers can use it to stack several
 * behaviors (logging, optimistic updates, …) on a single option.
 *
 * Inference note: when used inline in resource/command options, TS types the
 * hooks' `ctx` from the outer generics only if `TData` is already known —
 * annotate the `queryFn` return type (or the hook's `ctx`, or pass explicit
 * generics to `createResource`/`createCommand`) to get full typing.
 */
export function composeHooks<TArgs, TCtx>(
    ...hooks: Array<((args: TArgs, ctx: TCtx) => void | Promise<void>) | undefined>
): ((args: TArgs, ctx: TCtx) => void | Promise<void>) | undefined {
    type TFn = (args: TArgs, ctx: TCtx) => void | Promise<void>;
    const present = hooks.filter((hook): hook is TFn => hook != null);

    if (present.length === 0) return undefined;
    if (present.length === 1) return present[0];

    return (args, ctx) => {
        const run = (hook: TFn): Promise<unknown> => {
            try {
                return Promise.resolve(hook(args, ctx)).catch(() => undefined);
            } catch {
                return Promise.resolve();
            }
        };

        return Promise.all(present.map(run)).then(() => undefined);
    };
}
