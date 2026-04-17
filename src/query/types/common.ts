import type { Patch } from "immer";

import type { KEYED_BRAND, SKIP } from "../constants";

// ==================== Keyed Arguments ====================

export type Keyed<T> = { value: T; key: string; readonly [KEYED_BRAND]: true };

export type Args<TArgs> = TArgs | Keyed<TArgs>;

export type ArgsOrVoid<TArgs> = TArgs extends void ? void : Args<TArgs>;

export type ArgsOrVoidOrSkip<TArgs> = TArgs extends void ? void | typeof SKIP : Args<TArgs> | typeof SKIP;

// ==================== Machine Types ====================

export type TMachineStatus = "pending" | "success" | "error" | "refreshing" | "refresh-error";

export interface TPendingState<TArgs> {
    status: "pending";
    args: TArgs;
    data: null;
    error: null;
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

export interface TRefreshingState<TArgs, TData> {
    status: "refreshing";
    args: TArgs;
    data: TData;
    error: null;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

export interface TRefreshErrorState<TArgs, TData> {
    status: "refresh-error";
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
    | TRefreshingState<TArgs, TData>
    | TRefreshErrorState<TArgs, TData>;

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

// ==================== Agent Types ====================

export type TAgentStatus = TMachineStatus | "idle";
