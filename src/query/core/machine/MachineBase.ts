import type {
    IPatchHandle,
    TErrorState,
    TMachineState,
    TPatchEntry,
    TPatchState,
    TPendingState,
    TRefreshErrorState,
    TRefreshingState,
    TSuccessState,
} from "@/query/types";

import { MachineStateError, MachineTransitionError } from "../errors";
import { createPatches } from "../patcher";

import { hasData, processAllPatches, processPatches, replayPatches } from "./machine-helpers";

/**
 * Base class for the Machine state machine.
 *
 * Provides all transition methods with runtime guards.
 * Subtypes extend this and override their valid transitions with narrower return types.
 * Invalid transitions inherited from MachineBase throw MachineTransitionError/MachineStateError.
 */
export class MachineBase<TArgs, TData> {
    readonly state: TMachineState<TArgs, TData>;

    protected constructor(state: TMachineState<TArgs, TData>) {
        this.state = state;
    }

    // ==================== Transition Methods ====================

    /** pending → success */
    success(data: TData): MachineBase<TArgs, TData> {
        if (this.state.status !== "pending") {
            throw new MachineTransitionError("success", this.state.status);
        }

        const state: TSuccessState<TArgs, TData> = {
            status: "success",
            args: this.state.args,
            data,
            error: null,
            updatedAt: Date.now(),
            patchState: null,
        };
        return new MachineBase<TArgs, TData>(state);
    }

    /** pending → error, refreshing → refresh-error */
    fail(error: unknown): MachineBase<TArgs, TData> {
        if (this.state.status === "pending") {
            const state: TErrorState<TArgs> = {
                status: "error",
                args: this.state.args,
                data: null,
                error,
                updatedAt: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "refreshing") {
            const state: TRefreshErrorState<TArgs, TData> = {
                status: "refresh-error",
                args: this.state.args,
                data: this.state.data,
                error,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        throw new MachineTransitionError("fail", this.state.status);
    }

    /** success → refreshing, refresh-error → refreshing */
    refresh(): MachineBase<TArgs, TData> {
        if (this.state.status === "success") {
            const state: TRefreshingState<TArgs, TData> = {
                status: "refreshing",
                args: this.state.args,
                data: this.state.data,
                error: null,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "refresh-error") {
            const state: TRefreshingState<TArgs, TData> = {
                status: "refreshing",
                args: this.state.args,
                data: this.state.data,
                error: null,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        throw new MachineTransitionError("refresh", this.state.status);
    }

    /** error → pending */
    retry(): MachineBase<TArgs, TData> {
        if (this.state.status !== "error") {
            throw new MachineTransitionError("retry", this.state.status);
        }

        const state: TPendingState<TArgs> = {
            status: "pending",
            args: this.state.args,
            data: null,
            error: null,
            updatedAt: null,
        };
        return new MachineBase<TArgs, TData>(state);
    }

    /** refreshing → success (replays patches on new data) */
    rebase(data: TData): MachineBase<TArgs, TData> {
        if (this.state.status !== "refreshing") {
            throw new MachineTransitionError("rebase", this.state.status);
        }

        const patchState = this.state.patchState;

        // No patches → straight to success
        if (!patchState) {
            const state: TSuccessState<TArgs, TData> = {
                status: "success",
                args: this.state.args,
                data,
                error: null,
                updatedAt: Date.now(),
                patchState: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        // Replay pending patches on new base
        return new MachineBase<TArgs, TData>(
            replayPatches(this.state, "success", data, patchState.patches, Date.now()),
        );
    }

    // ==================== Patch Methods ====================

    /** Create an optimistic patch (success, refreshing, refresh-error) */
    createPatch(
        patchFn: (data: TData) => void,
        onSettle?: () => void,
    ): { machine: MachineBase<TArgs, TData>; handle: IPatchHandle } {
        if (!hasData(this.state)) {
            throw new MachineStateError("createPatch", `invalid state "${this.state.status}"`);
        }

        const currentData = this.state.data;

        const [nextData, forward, inverse] = createPatches(currentData, patchFn);

        const entry: TPatchEntry = {
            forward,
            inverse,
            status: "pending",
        };

        const existingPatches = this.state.patchState?.patches ?? [];
        const originalData = this.state.patchState?.originalData ?? currentData;

        const newPatchState: TPatchState<TData> = {
            originalData,
            patches: [...existingPatches, entry],
            isConsistencyViolation: false,
        };

        const newState = {
            ...this.state,
            data: nextData as TData,
            patchState: newPatchState,
        };

        let isSettled = false;

        const handle: IPatchHandle = {
            commit: () => {
                if (isSettled) return;
                isSettled = true;
                entry.status = "committed";
                onSettle?.();
            },
            abort: () => {
                if (isSettled) return;
                isSettled = true;
                entry.status = "aborted";
                onSettle?.();
            },
        };

        return { machine: new MachineBase<TArgs, TData>(newState), handle };
    }

    /** Process all settled patches up to the first pending one */
    finishPatch(): MachineBase<TArgs, TData> {
        if (!hasData(this.state) || !this.state.patchState) {
            throw new MachineStateError("finishPatch", "no active patchState");
        }

        return new MachineBase<TArgs, TData>(processPatches(this.state, this.state.patchState));
    }

    /** Process all settled patches (continues past pending) */
    finishAllPatches(): MachineBase<TArgs, TData> {
        if (!hasData(this.state) || !this.state.patchState) {
            throw new MachineStateError("finishAllPatches", "no active patchState");
        }

        return new MachineBase<TArgs, TData>(processAllPatches(this.state, this.state.patchState));
    }
}
