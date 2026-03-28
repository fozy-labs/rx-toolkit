import type { Patch } from "immer";

/** Discriminated union of all machine statuses */
export type TMachineStatus = "pending" | "success" | "error" | "refreshing";

/** Patch lifecycle status */
export type TPatchStatus = "pending" | "committed" | "aborted";

/** Single Immer patch record */
export interface TPatch {
    readonly patches: Patch[];
    readonly inversePatches: Patch[];
    readonly status: TPatchStatus;
}

/**
 * Grouped patch lifecycle state.
 * Stored on machine states that support patching (success, refreshing).
 * When null, no patches are active — data is raw server data.
 * When present, data is the patched version; originalData is the unpatched base.
 */
export interface TPatchState<TData> {
    readonly originalData: TData;
    readonly patches: TPatch[];
    readonly isConsistencyViolation: boolean;
}

/** Pending state — first fetch in progress */
export interface TPendingState<TArgs> {
    readonly status: "pending";
    readonly args: TArgs;
    readonly data: null;
    readonly error: null;
    readonly updatedAt: null;
}

/** Success state — data available */
export interface TSuccessState<TArgs, TData> {
    readonly status: "success";
    readonly args: TArgs;
    readonly data: TData;
    readonly error: null;
    readonly updatedAt: number;
    readonly patchState: TPatchState<TData> | null;
}

/** Error state — fetch failed, no data */
export interface TErrorState<TArgs> {
    readonly status: "error";
    readonly args: TArgs;
    readonly data: null;
    readonly error: unknown;
    readonly updatedAt: null;
}

/** Refreshing state — background refetch with stale data */
export interface TRefreshingState<TArgs, TData> {
    readonly status: "refreshing";
    readonly args: TArgs;
    readonly data: TData;
    readonly error: null;
    readonly updatedAt: number;
    readonly patchState: TPatchState<TData> | null;
}

/** Discriminated union of all machine states */
export type TMachineState<TArgs = unknown, TData = unknown> =
    | TPendingState<TArgs>
    | TSuccessState<TArgs, TData>
    | TErrorState<TArgs>
    | TRefreshingState<TArgs, TData>;

/** Union of all concrete machine instances (classes defined in core/) */
export type TMachineInstance<TArgs = unknown, TData = unknown> = TMachineState<TArgs, TData>;

/** States that carry data (success, refreshing). Type-level representation of MachineWithData abstract class. */
export type MachineWithData<TArgs, TData> = TSuccessState<TArgs, TData> | TRefreshingState<TArgs, TData>;

/** Handle returned by createPatch */
export interface IPatchHandle {
    readonly commit: () => void;
    readonly abort: () => void;
}

/** Result of MachineWithData.createPatch */
export type CreatePatchResult<TArgs, TData> = {
    readonly machine: MachineWithData<TArgs, TData>;
    readonly patchHandle: IPatchHandle;
};

/** Static factory interface for Machine */
export interface IMachineStatic {
    idle<TArgs, TData>(): TMachineInstance<TArgs, TData>;
    fromSnapshot<TArgs, TData>(state: TMachineState<TArgs, TData>): TMachineInstance<TArgs, TData>;
}
