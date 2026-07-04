/** @internal — exported for unit testing only */
export function mergeHooks<TFn extends ((...args: any[]) => any) | undefined>(
    apiHook: TFn | undefined,
    localHook: TFn | undefined,
): TFn | undefined {
    if (!apiHook && !localHook) return undefined;
    if (!apiHook) return localHook;
    if (!localHook) return apiHook;

    // Hooks may be async and long-lived (the documented lifecycle patterns await
    // $cacheEntryRemoved / $queryFulfilled), so they must start concurrently:
    // awaiting one before calling the other would defer the second past the very
    // lifecycle events it exists to observe. The callers use sync try/catch and
    // suppress lifecycle errors, so each hook is caught independently and the
    // merged promise never rejects.
    return ((...args: any[]) => {
        const run = (hook: (...a: any[]) => any): Promise<unknown> => {
            try {
                return Promise.resolve(hook(...args)).catch(() => undefined);
            } catch {
                return Promise.resolve();
            }
        };

        return Promise.all([run(apiHook), run(localHook)]).then(() => undefined);
    }) as unknown as TFn;
}
