export type Prettify<T> = { [KeyType in keyof T]: T[KeyType] } & {};

/** Serialize args to string cache key */
export type TSerializeArgsFn = (args: unknown) => string;

/** Compare two args for equality (used in 'compare' strategy) */
export type TCompareArgsFn = (a: unknown, b: unknown) => boolean;

/**
 * Intercepts machine state before pushing to Redux DevTools.
 * Default behavior: push machine.state (plain object).
 * User can transform or filter.
 */
export type TBeforeDevtoolsPushFn<TMachineState> = (
    newValue: TMachineState,
    push: (value: TMachineState) => void,
) => void;

/** Query function signature */
export type TQueryFn<TArgs, TData> = (args: TArgs, tools: TQueryFnTools) => Promise<TData>;

export interface TQueryFnTools {
    abortSignal: AbortSignal;
}
