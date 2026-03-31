import type { TPatchState } from "./machine.types";

export type TCommandMachineStatus = "idle" | "loading" | "success" | "error";

export interface TCommandIdleState {
    readonly status: "idle";
    readonly args: null;
    readonly data: null;
    readonly error: null;
}

export interface TCommandLoadingState<TArgs> {
    readonly status: "loading";
    readonly args: TArgs;
    readonly data: null;
    readonly error: null;
}

export interface TCommandSuccessState<TArgs, TData> {
    readonly status: "success";
    readonly args: TArgs;
    readonly data: TData;
    readonly error: null;
    readonly patchState: TPatchState<TData> | null;
}

export interface TCommandErrorState<TArgs> {
    readonly status: "error";
    readonly args: TArgs;
    readonly data: null;
    readonly error: unknown;
}

export type TCommandMachineState<TArgs = unknown, TData = unknown> =
    | TCommandIdleState
    | TCommandLoadingState<TArgs>
    | TCommandSuccessState<TArgs, TData>
    | TCommandErrorState<TArgs>;

/** Union of command machine class instances (parallel to TMachineInstance for resources) */
export type TCommandMachineInstance<TArgs = unknown, TData = unknown> =
    | import("../core/machines/CommandIdle").CommandIdle<TArgs, TData>
    | import("../core/machines/CommandLoading").CommandLoading<TArgs, TData>
    | import("../core/machines/CommandSuccess").CommandSuccess<TArgs, TData>
    | import("../core/machines/CommandError").CommandError<TArgs, TData>;
