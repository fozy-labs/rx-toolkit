import type { Patch } from "immer";

import type { KEYED_BRAND, SKIP } from "../constants";

// ==================== Keyed Arguments ====================

export type TKeyed<T> = { value: T; key: string; readonly [KEYED_BRAND]: true };

export type TArgsOrKeyed<TArgs> = TArgs | TKeyed<TArgs>;

export type TArgsOrVoid<TArgs> = TArgs extends void ? void : TArgsOrKeyed<TArgs>;

export type TArgsOrVoidOrSkip<TArgs> = TArgs extends void ? void | typeof SKIP : TArgsOrKeyed<TArgs> | typeof SKIP;

// ==================== Machine Types ====================

export type TMachineStatus = "pending" | "success" | "error" | "invalidating" | "invalidate-error";

// `isRetrying` marks a load started by `retry()` from a failed state; the
// failure it retries stays in `error` until the load settles. A first load or a
// plain `invalidate()` reports `isRetrying: false` with `error: null`.

export interface TPendingState<TArgs> {
    status: "pending";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
    isRetrying: boolean;
}

export interface TSuccessState<TArgs, TData> {
    status: "success";
    args: TArgs;
    data: TData;
    error: null;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

export interface TErrorState<TArgs> {
    status: "error";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
}

export interface TInvalidatingState<TArgs, TData> {
    status: "invalidating";
    args: TArgs;
    data: TData;
    error: unknown;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
    isRetrying: boolean;
}

export interface TInvalidateErrorState<TArgs, TData> {
    status: "invalidate-error";
    args: TArgs;
    data: TData;
    error: unknown;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

export type TMachineState<TArgs, TData> =
    | TPendingState<TArgs>
    | TSuccessState<TArgs, TData>
    | TErrorState<TArgs>
    | TInvalidatingState<TArgs, TData>
    | TInvalidateErrorState<TArgs, TData>;

// ==================== Patch Types ====================

export interface TPatchEntry {
    forward: Patch[];
    inverse: Patch[];
    status: "pending" | "committed" | "aborted";
}

export interface TPatchState<TData> {
    originalData: TData;
    patches: TPatchEntry[];
    isConsistencyViolation: boolean;
}

export interface IPatchHandle {
    commit(): void;
    abort(): void;
}

// ==================== Clutch Types ====================

export type TClutchStatus = TMachineStatus | "idle";

// ==================== Deprecated Aliases ====================

/**
 * @deprecated Renamed to {@link TKeyed} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type Keyed<T> = TKeyed<T>;

/**
 * @deprecated Renamed to {@link TArgsOrKeyed} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type Args<TArgs> = TArgsOrKeyed<TArgs>;

/**
 * @deprecated Renamed to {@link TArgsOrVoid} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type ArgsOrVoid<TArgs> = TArgsOrVoid<TArgs>;

/**
 * @deprecated Renamed to {@link TArgsOrVoidOrSkip} (type-prefix convention).
 * Will be removed in 0.14.0.
 */
export type ArgsOrVoidOrSkip<TArgs> = TArgsOrVoidOrSkip<TArgs>;

/** @deprecated Renamed to {@link TClutchStatus}. Will be removed in 0.14.0. */
export type TAgentStatus = TClutchStatus;
