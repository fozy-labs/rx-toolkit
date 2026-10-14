import type { SKIP } from "../constants";

import type { TInvalidateOptions } from "./common";
import type { TBoundResource } from "./resource";
import type { TResourceClutchIdleState, TResourceClutchState, TSuspenseResourceState } from "./state";

// ==================== Multi-resource input ====================

/** Any bound resource — `resource.bind(args)` of any resource. */
export type TAnyBoundResource = TBoundResource<any, any, any>;

/** One slot of `useResources`: a bound resource, or `SKIP` to leave the slot idle. */
export type TResourcesSlot = TAnyBoundResource | typeof SKIP;

/** Input of `useResources`: named slots (a record) or an array — a tuple stays a tuple. */
export type TResourcesInput = Readonly<Record<string, TResourcesSlot>> | readonly TResourcesSlot[];

/** Input of `useSuspenseResources`: as {@link TResourcesInput}, without `SKIP`. */
export type TSuspenseResourcesInput = Readonly<Record<string, TAnyBoundResource>> | readonly TAnyBoundResource[];

// ==================== Per-slot mapping ====================

/** The clutch state of one slot: `TResourceClutchState` of its resource, idle for `SKIP`. */
export type TResourcesSlotState<TSlot> =
    TSlot extends TBoundResource<infer TArgs, infer TData, infer TError>
        ? TResourceClutchState<TArgs, TData, TError>
        : TResourceClutchIdleState;

/** The data of one slot once the aggregate has data: `null` for `SKIP`. */
export type TResourcesSlotData<TSlot> = TSlot extends TBoundResource<any, infer TData, any> ? TData : null;

/** The error of one slot; `never` for `SKIP`. */
export type TResourcesSlotError<TSlot> = TSlot extends TBoundResource<any, any, infer TError> ? TError : never;

/** Per-slot clutch states, in the shape of the input. */
export type TResourcesStates<T> = { -readonly [K in keyof T]: TResourcesSlotState<T[K]> };

/** Per-slot clutch states of `useSuspenseResources` — each one has data. */
export type TSuspenseResourcesStates<T> = {
    -readonly [K in keyof T]: T[K] extends TBoundResource<infer TArgs, infer TData, infer TError>
        ? TSuspenseResourceState<TArgs, TData, TError>
        : never;
};

/** Per-slot data, in the shape of the input. */
export type TResourcesData<T> = { -readonly [K in keyof T]: TResourcesSlotData<T[K]> };

/** The union of the slots' error types. */
export type TResourcesError<T> = TResourcesSlotError<T extends readonly unknown[] ? T[number] : T[keyof T]>;

// ==================== Aggregate state ====================

/** Methods present on every aggregate state; they act on every slot. */
export interface TResourcesStateMethods {
    /** Retry every failed slot (`status === "error"`); a no-op when none failed. */
    retry: () => void;
    /**
     * Invalidate every engaged slot: a slot that failed with nothing to show
     * is retried instead, an idle slot is left alone.
     */
    invalidate: (opts?: TInvalidateOptions) => void;
}

/** Fields shared by every aggregate state variant. */
export interface TResourcesStateBase<TStates> extends TResourcesStateMethods {
    /** The clutch state of every slot, unchanged — `useResource`'s shape. */
    states: TStates;
}

/** The aggregate data slot: every engaged slot has data, or `data` is `null`. */
export type TResourcesDataSlot<TData> = { hasData: true; data: TData } | { hasData: false; data: null };

/** The aggregate error slot: the first slot error in slot order. */
export type TResourcesErrorSlot<TError> = { hasError: true; error: TError } | { hasError: false; error: null };

/** Loading flags of an aggregate state with no query in flight. */
export interface TResourcesSettledFlags {
    isPending: false;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: false;
}

/** Every slot is `SKIP`. */
export type TResourcesIdleState<TStates> = TResourcesStateBase<TStates> &
    TResourcesSettledFlags & {
        status: "idle";
        isIdle: true;
        hasData: false;
        data: null;
        hasError: false;
        error: null;
    };

/**
 * Some slot has a query in flight. The flags say "some slot is like this", so
 * several can be `true` at once; a slot retrying a failure keeps `hasError`.
 */
export type TResourcesPendingState<TStates, TData, TError> = TResourcesStateBase<TStates> & {
    status: "pending";
    isIdle: false;
    isPending: true;
    isInitialLoading: boolean;
    isSwitching: boolean;
    isInvalidating: boolean;
} & TResourcesDataSlot<TData> &
    TResourcesErrorSlot<TError>;

/** No query in flight and some slot failed. */
export type TResourcesErrorState<TStates, TData, TError> = TResourcesStateBase<TStates> &
    TResourcesSettledFlags & {
        status: "error";
        isIdle: false;
        hasError: true;
        error: TError;
    } & TResourcesDataSlot<TData>;

/** No query in flight, no failure: every engaged slot has data (`[]` / `{}` too). */
export type TResourcesSuccessState<TStates, TData> = TResourcesStateBase<TStates> &
    TResourcesSettledFlags & {
        status: "success";
        isIdle: false;
        hasData: true;
        data: TData;
        hasError: false;
        error: null;
    };

/** Every aggregate state variant over the given per-slot states, data and error. */
export type TResourcesStateOf<TStates, TData, TError> =
    | TResourcesIdleState<TStates>
    | TResourcesPendingState<TStates, TData, TError>
    | TResourcesErrorState<TStates, TData, TError>
    | TResourcesSuccessState<TStates, TData>;

/**
 * State returned by `useResources`: the per-slot clutch states plus an
 * aggregate. `status` is the first that matches: `idle` (every slot is
 * `SKIP`), `pending` (some slot has a query in flight), `error` (some slot
 * failed), `success`.
 */
export type TResourcesState<T> = TResourcesStateOf<TResourcesStates<T>, TResourcesData<T>, TResourcesError<T>>;

/** State returned by `useSuspenseResources`: every slot has data, so `data` is non-null. */
export type TSuspenseResourcesState<T> = Extract<
    TResourcesStateOf<TSuspenseResourcesStates<T>, TResourcesData<T>, TResourcesError<T>>,
    { hasData: true }
>;
