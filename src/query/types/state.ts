// ==================== Hook State Types (for React consumers) ====================

import type { TArgsOrKeyed } from "./common";

// Clutch states are discriminated unions: `status`, `dataSource` and every
// boolean flag are literals per variant, so narrowing works through any of
// them — `state.hasData` implies `state.data: TData`, `state.hasError` implies
// `state.error: TError`, and so on.
//
// The union enumerates the fourteen rows of the state matrix (see
// docs/query/api/resource-clutch.md), not the free product of its axes:
//
//  #   case                             status   dataSource   hasError
//  1   SKIP / no args                   idle     none         ✗
//  2   initial load                     pending  none         ✗
//  3   load behind a placeholder        pending  placeholder  ✗
//  4   new args, previous data shown    pending  previous     ✗
//  5   success                          success  current      ✗
//  6   invalidation of the current args pending  current      ✗
//  7   error, nothing to show           error    none         ✓
//  8   error on new args, previous data error    previous     ✓
//  9   failed invalidation              error    current      ✓
//  10  retry of 7                       pending  none         ✓
//  11  retry of 8                       pending  previous     ✓
//  12  retry of 9                       pending  current      ✓
//  13  error behind a placeholder       error    placeholder  ✓
//  14  retry of 13                      pending  placeholder  ✓
//
// `args` are the arguments the clutch observes; `dataArgs` are the arguments
// `data` was loaded for (`null` when `data` is a placeholder or absent).
// `error` holds the failure of the last settle of the current args and lives
// until the next settle — so a retry in flight is `isPending && hasError`.

// ==================== State Slots ====================

/** Nothing to show: `data` is absent rather than `null`-valued. */
export interface TDataSlotNone {
    dataSource: "none";
    data: null;
    dataArgs: null;
    hasData: false;
}

/** Data synthesized by the resource's `placeholderData` option; never cached. */
export interface TDataSlotPlaceholder<TData> {
    dataSource: "placeholder";
    data: TData;
    dataArgs: null;
    hasData: true;
}

/** Data of the previous args, held while the new ones load (SWR). */
export interface TDataSlotPrevious<TArgs, TData> {
    dataSource: "previous";
    data: TData;
    dataArgs: TArgs;
    hasData: true;
}

/** Data of the args the clutch currently observes. */
export interface TDataSlotCurrent<TArgs, TData> {
    dataSource: "current";
    data: TData;
    dataArgs: TArgs;
    hasData: true;
}

/**
 * Where the `data` of a state comes from — the single source of truth about
 * whether there is anything to show, since `TData` may itself be `null`.
 * Display priority: `current` → `placeholder` → `previous` → `none`.
 */
export type TDataSlot<TArgs, TData> =
    TDataSlotNone | TDataSlotPlaceholder<TData> | TDataSlotPrevious<TArgs, TData> | TDataSlotCurrent<TArgs, TData>;

/**
 * The failure of the last settle of the current args. It survives into the
 * following load, so `isPending && hasError` is a retry in flight.
 */
export type TErrorSlot<TError> = { hasError: true; error: TError } | { hasError: false; error: null };

// ==================== Resource Clutch State ====================

/** Methods present on every resource clutch state variant. */
interface TResourceClutchStateMethods {
    /**
     * Re-run the failed query keeping the failure on screen: rows 7 → 10,
     * 8 → 11, 9 → 12, 13 → 14. A `console.warn` and no-op elsewhere.
     */
    retry: () => void;
    /**
     * Re-query the current args and clear the failure: rows 5 → 6, 8 → 4,
     * 9 → 6, 13 → 3. A `console.warn` and no-op elsewhere.
     */
    invalidate: () => void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh: () => void;
}

/** Loading flags shared by every settled (non-pending) variant. */
interface TSettledFlags {
    isPending: false;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: false;
}

/** Row 1 — no observation: the clutch was given `SKIP` or has no args yet. */
export interface TResourceClutchIdleState extends TResourceClutchStateMethods, TSettledFlags, TDataSlotNone {
    status: "idle";
    args: null;
    hasError: false;
    error: null;
}

interface TClutchPendingBase<TArgs> extends TResourceClutchStateMethods {
    status: "pending";
    args: TArgs;
    isPending: true;
}

/** Rows 2 / 10 — initial load with nothing to show. */
export type TResourceClutchPendingNoneState<TArgs, TError = unknown> = TClutchPendingBase<TArgs> &
    TDataSlotNone & { isInitialLoading: true; isSwitching: false; isInvalidating: false } & TErrorSlot<TError>;

/** Rows 3 / 14 — initial load behind placeholder data. */
export type TResourceClutchPendingPlaceholderState<TArgs, TData, TError = unknown> = TClutchPendingBase<TArgs> &
    TDataSlotPlaceholder<TData> & {
        isInitialLoading: true;
        isSwitching: false;
        isInvalidating: false;
    } & TErrorSlot<TError>;

/** Rows 4 / 11 — the args changed; the previous entry's data stays on screen. */
export type TResourceClutchPendingPreviousState<TArgs, TData, TError = unknown> = TClutchPendingBase<TArgs> &
    TDataSlotPrevious<TArgs, TData> & {
        isInitialLoading: false;
        isSwitching: true;
        isInvalidating: false;
    } & TErrorSlot<TError>;

/** Rows 6 / 12 — the current args are being re-queried behind their own data. */
export type TResourceClutchPendingCurrentState<TArgs, TData, TError = unknown> = TClutchPendingBase<TArgs> &
    TDataSlotCurrent<TArgs, TData> & {
        isInitialLoading: false;
        isSwitching: false;
        isInvalidating: true;
    } & TErrorSlot<TError>;

/**
 * A query is in flight (rows 2, 3, 4, 6, 10, 11, 12, 14). Exactly one of
 * `isInitialLoading` / `isSwitching` / `isInvalidating` is `true`; `hasError`
 * tells a retry from a first attempt.
 */
export type TResourceClutchPendingState<TArgs, TData, TError = unknown> =
    | TResourceClutchPendingNoneState<TArgs, TError>
    | TResourceClutchPendingPlaceholderState<TArgs, TData, TError>
    | TResourceClutchPendingPreviousState<TArgs, TData, TError>
    | TResourceClutchPendingCurrentState<TArgs, TData, TError>;

/** Row 5 — the query succeeded: fresh data of the observed args, no error. */
export interface TResourceClutchSuccessState<TArgs, TData>
    extends TResourceClutchStateMethods, TSettledFlags, TDataSlotCurrent<TArgs, TData> {
    status: "success";
    args: TArgs;
    hasError: false;
    error: null;
}

interface TClutchErrorBase<TArgs, TError> extends TResourceClutchStateMethods, TSettledFlags {
    status: "error";
    args: TArgs;
    hasError: true;
    error: TError;
}

/**
 * Rows 7, 8, 9, 13 — the query failed. Whatever was on screen stays there:
 * `dataSource` tells whether that is the current entry's data (a failed
 * invalidation), the previous args' data, a placeholder, or nothing.
 */
export type TResourceClutchErrorState<TArgs, TData, TError = unknown> = TClutchErrorBase<TArgs, TError> &
    TDataSlot<TArgs, TData>;

export type TResourceClutchState<TArgs, TData, TError = unknown> =
    | TResourceClutchIdleState
    | TResourceClutchPendingState<TArgs, TData, TError>
    | TResourceClutchSuccessState<TArgs, TData>
    | TResourceClutchErrorState<TArgs, TData, TError>;

/**
 * State returned by the Suspense-enabled resource hook.
 *
 * The subset of {@link TResourceClutchState} variants that have something to
 * show (`hasData`), so `data` is guaranteed non-null: the hook returns as soon
 * as any data is available, throws the error of a failure with nothing to show
 * to the nearest Error Boundary, and suspends otherwise. Rows 8 and 13 (an
 * error behind previous or placeholder data) are returned, not thrown.
 */
export type TSuspenseResourceState<TArgs, TData, TError = unknown> = TResourceClutchState<TArgs, TData, TError> & {
    dataSource: "placeholder" | "previous" | "current";
};

// ==================== Infinite Resource State ====================

/**
 * State returned by the infinite projection-resource hook (`useInfiniteResource`).
 *
 * The feed is a list of *pages*: every page is an ordinary cache entry of the
 * projection resource with its own fixed args (an id-set), observed through its own
 * clutch. `TData` is the page data type — the projection item array (`TItem[]`) —
 * and `data` flattens the pages' items in page order.
 *
 * There is no aggregate `status`, and the three loading flags do not partition
 * `isPending`: each one means "some page is like this". After invalidating a
 * feed whose last page had failed, `isInvalidating` and `isLoadingNext` are
 * both `true`.
 */
export interface TInfiniteResourceState<TArgs, TData, TError = unknown> {
    /**
     * Items of every page holding data of its own args (`dataSource: "current"`),
     * flattened in page order; `null` until the first page delivers data.
     */
    data: TData | null;
    /** Per-page clutch states, in load order. Empty while the feed is idle. */
    pages: TResourceClutchState<TArgs, TData, TError>[];
    /** No pages observed — the initial args are `SKIP`. */
    isIdle: boolean;
    /** The first page's initial load is in flight and there is nothing to show yet. */
    isInitialLoading: boolean;
    /** Some page has a query in flight. */
    isPending: boolean;
    /** A page beyond the first is doing its initial load. */
    isLoadingNext: boolean;
    /** Some page is being re-queried behind its own data. */
    isInvalidating: boolean;
    /** Some page delivered data (⇔ `data !== null`). */
    hasData: boolean;
    /** Some page holds an error (⇔ `error !== null`; see {@link error}). */
    hasError: boolean;
    /** The first error across pages, in page order; survives a retry. */
    error: TError | null;
    /**
     * Append the next page with the given args and start loading it. Passing
     * the args of an already-present page is a no-op (double-click safe),
     * unless that page is in the `error` status — a failed first load or a
     * failed re-query that kept its data — in which case it is retried.
     */
    fetchNext: (args: TArgsOrKeyed<TArgs>) => void;
    /** Re-validate the whole feed: invalidate pages with data, retry failed ones. */
    invalidate: () => void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh: () => void;
    /** Drop every page after the first one. */
    reset: () => void;
}

// ==================== Command Clutch State ====================

// The command state has no previous data, no args change and no placeholder: a
// repeated `trigger()` with the same entry key creates a new entry rather than
// carrying stale `data` / `error` into the new run. Its five rows:
//
//  #   case                                status   hasData  hasError
//  K1  nothing triggered                   idle     ✗        ✗
//  K2  running (first or repeated trigger) pending  ✗        ✗
//  K3  success                             success  ✓        ✗
//  K4  error                               error    ✗        ✓
//  K5  retry of K4                         pending  ✗        ✓

/** Methods present on every command clutch state variant. */
interface TCommandClutchStateMethods {
    /** Re-execute the tracked mutation after it failed. No-op unless in the `error` state. */
    retry: () => void;
}

/** K1 — no observation: nothing triggered yet and no cache entry bound. */
export interface TCommandClutchIdleState extends TCommandClutchStateMethods {
    status: "idle";
    data: null;
    hasData: false;
    error: null;
    hasError: false;
    args: null;
    isPending: false;
}

/**
 * K2 / K5 — the mutation is running. `data` is always absent; `hasError` marks
 * the run as a retry and keeps the failure it retries readable in `error`.
 */
export type TCommandClutchPendingState<TArgs, TError = unknown> = TCommandClutchStateMethods & {
    status: "pending";
    data: null;
    hasData: false;
    args: TArgs;
    isPending: true;
} & TErrorSlot<TError>;

/** K3 — the mutation succeeded: `data` is present, no error. */
export interface TCommandClutchSuccessState<TArgs, TData> extends TCommandClutchStateMethods {
    status: "success";
    data: TData;
    hasData: true;
    error: null;
    hasError: false;
    args: TArgs;
    isPending: false;
}

/** K4 — the mutation failed: `error` is present, no data. */
export interface TCommandClutchErrorState<TArgs, TError = unknown> extends TCommandClutchStateMethods {
    status: "error";
    data: null;
    hasData: false;
    error: TError;
    hasError: true;
    args: TArgs;
    isPending: false;
}

export type TCommandClutchState<TArgs, TData, TError = unknown> =
    | TCommandClutchIdleState
    | TCommandClutchPendingState<TArgs, TError>
    | TCommandClutchSuccessState<TArgs, TData>
    | TCommandClutchErrorState<TArgs, TError>;
