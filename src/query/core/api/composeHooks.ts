import { combineHooks } from "./mergeHooks";

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
 * Inference note: when used inline in resource/command options, TS types the
 * hooks' `ctx` from the outer generics only if `TData` is already known —
 * annotate the `queryFn` return type (or the hook's `ctx`, or pass explicit
 * generics to `createResource`/`createCommand`) to get full typing. The array
 * form of the option does not have that limit: there is no inner generic call
 * to resolve, so contextual typing reaches the hooks directly.
 *
 * @deprecated Pass an array to the option instead: `onQueryStarted: [log, track]`,
 * `onCacheEntryAdded: [log, isDev && metrics]`. The array form has the same
 * semantics and additionally skips `false` entries. Will be removed in 0.14.0.
 */
export function composeHooks<TArgs, TCtx>(
    ...hooks: Array<((args: TArgs, ctx: TCtx) => void | Promise<void>) | undefined>
): ((args: TArgs, ctx: TCtx) => void | Promise<void>) | undefined {
    type TFn = (args: TArgs, ctx: TCtx) => void | Promise<void>;

    return combineHooks(hooks.filter((hook): hook is TFn => hook != null));
}
