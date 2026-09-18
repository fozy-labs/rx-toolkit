import type { Patch } from "immer";

import type { KEYED_BRAND, SKIP } from "../constants";

// ==================== Keyed Arguments ====================

export type TKeyed<T> = { value: T; key: string; readonly [KEYED_BRAND]: true };

export type TArgsOrKeyed<TArgs> = TArgs | TKeyed<TArgs>;

export type TArgsOrVoid<TArgs> = TArgs extends void ? void : TArgsOrKeyed<TArgs>;

export type TArgsOrVoidOrSkip<TArgs> = TArgs extends void ? void | typeof SKIP : TArgsOrKeyed<TArgs> | typeof SKIP;

// ==================== Machine Types ====================

export type TMachineStatus = "pending" | "success" | "error" | "invalidating" | "invalidate-error";

// In the in-flight states (`pending`, `invalidating`) `error` is the failure the
// run retries: a load started by `retry()` carries it until the run settles,
// while a first load or a plain `invalidate()` has `error: null`. There is no
// separate retry flag — a retry in flight *is* `error !== null`.

export interface TPendingState<TArgs> {
    status: "pending";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
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

/**
 * Status of a clutch state. Unlike {@link TMachineStatus} (the status of one
 * cache entry), it says only whether a query is in flight and how the last one
 * settled: a background invalidation is `pending`, a failed one is `error`.
 * What is on screen meanwhile is told by `dataSource`.
 */
export type TClutchStatus = "idle" | "pending" | "success" | "error";

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
