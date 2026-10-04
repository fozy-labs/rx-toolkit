import type { TResourceEntryIdleState, TResourceEntryState } from "./resource";

export interface TInvalidateOnOptions<TArgs, TData> {
    /**
     * Revalidate when the environment becomes focused after being unfocused.
     * `true` means no minimum away time; a number is the minimum time away in
     * milliseconds. Negative values mean zero, `Infinity` never fires, and
     * `false` disables the rule. A function decides that threshold per entry.
     */
    focus?:
        | boolean
        | number
        | ((
              args: TArgs,
              state: Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>,
          ) => boolean | number);
    /**
     * Revalidate when the environment comes online after being offline.
     * `true` means no minimum offline time; a number is the minimum time
     * offline in milliseconds. Negative values mean zero, `Infinity` never
     * fires, and `false` disables the rule. A function decides that threshold
     * per entry.
     */
    reconnect?:
        | boolean
        | number
        | ((
              args: TArgs,
              state: Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>,
          ) => boolean | number);
    /**
     * Revalidate periodically while the entry is active, visible and online.
     * A positive finite number up to `MAX_TIMEOUT_DELAY` is the period in
     * milliseconds; a function decides the period per entry, or returns
     * `false` to stop polling. Invalid values disable polling.
     */
    interval?:
        | number
        | false
        | ((args: TArgs, state: Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>) => number | false);
}

export interface TEnvironmentState {
    visible: boolean;
    focused: boolean;
    online: boolean;
}

export interface IEnvironmentDriver {
    /** Start reporting; returns the current state. `onChange` gets the full state on every change. */
    connect(onChange: (state: TEnvironmentState) => void): TEnvironmentState;
    /** For user teardown and tests; the query core keeps its monitor connected. */
    disconnect(): void;
}
