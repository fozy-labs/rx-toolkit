/** @internal — exported for unit testing only */
export function mergeHooks<TFn extends ((...args: any[]) => any) | undefined>(
    apiHook: TFn | undefined,
    localHook: TFn | undefined,
): TFn | undefined {
    if (!apiHook && !localHook) return undefined;
    if (!apiHook) return localHook;
    if (!localHook) return apiHook;

    // Both hooks may be async. The callers use sync try/catch and suppress
    // lifecycle errors, so the merged function must never produce an unhandled
    // rejection — catch each hook independently.
    return (async (...args: any[]) => {
        try {
            await (apiHook as (...a: any[]) => any)(...args);
        } catch {
            /* lifecycle error suppressed */
        }
        try {
            await (localHook as (...a: any[]) => any)(...args);
        } catch {
            /* lifecycle error suppressed */
        }
    }) as unknown as TFn;
}
