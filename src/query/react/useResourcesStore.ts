import React from "react";
import { first, firstValueFrom, tap } from "rxjs";

import { useIsomorphicLayoutEffect } from "@/common/react";
import type {
    IResource,
    IResourceClutch,
    TArgsOrVoidOrSkip,
    TInvalidateOptions,
    TKeyed,
    TResourceClutchIdleState,
    TResourceClutchState,
    TResourcesStateOf,
} from "@/query/types";
import { Signal, type ReadonlySignal } from "@/signals";
import { useSignalWithServerSnapshot } from "@/signals/react/useSignalWithServerSnapshot";

import { SKIP } from "../constants";
import { ResourceClutch } from "../core/resource";
import { IDLE_ENTRY_STATE } from "../core/resource/entry-state";

type TAnyResource = IResource<unknown, unknown, unknown>;
type TAnyClutch = IResourceClutch<unknown, unknown, unknown>;
type TAnyState = TResourceClutchState<unknown, unknown, unknown>;
type TAnyResourcesState = TResourcesStateOf<unknown, unknown, unknown>;

// ==================== Input ====================

interface TSlotSpec {
    /** Record key, or array index. */
    name: string;
    /** `null` for a `SKIP` slot. */
    resource: TAnyResource | null;
    keyed: TKeyed<unknown> | null;
}

/** The parsed input of one render. */
export interface TResourcesSpec {
    isArray: boolean;
    slots: TSlotSpec[];
    /** The slot set identity: shape, slot names, resources and serialized args. */
    key: string;
}

const objectIds = new WeakMap<object, number>();
let lastObjectId = 0;

/** A stable number per object (resource, clutch), for identity keys. */
function idOf(object: object): number {
    let id = objectIds.get(object);
    if (id === undefined) {
        id = ++lastObjectId;
        objectIds.set(object, id);
    }
    return id;
}

function isBoundResource(value: unknown): value is { resource: TAnyResource; args: unknown } {
    if (typeof value !== "object" || value === null) return false;
    const bound = value as { kind?: unknown; resource?: { createClutch?: unknown } };
    return bound.kind === "resource" && typeof bound.resource?.createClutch === "function";
}

export function parseResources(input: unknown, hookName: string, allowSkip: boolean): TResourcesSpec {
    if (typeof input !== "object" || input === null) {
        throw new TypeError(`[${hookName}] expects a record or an array of bound resources.`);
    }

    const isArray = Array.isArray(input);
    const entries: [string, unknown][] = isArray
        ? Array.from(input as unknown[], (value, index): [string, unknown] => [String(index), value])
        : Object.entries(input);
    const identity: unknown[] = [isArray];

    const slots = entries.map(([name, value]): TSlotSpec => {
        if (value === SKIP) {
            if (!allowSkip) {
                throw new TypeError(
                    `[${hookName}] slot "${name}" is SKIP: a suspending hook needs args for every slot — use useResources for conditional slots.`,
                );
            }
            identity.push(name, 0, null);
            return { name, resource: null, keyed: null };
        }

        if (!isBoundResource(value)) {
            throw new TypeError(
                `[${hookName}] slot "${name}" is neither a bound resource (resource.bind(args)) nor SKIP.`,
            );
        }

        const keyed = value.resource.toKeyed(value.args);
        identity.push(name, idOf(value.resource), keyed.key);
        return { name, resource: value.resource, keyed };
    });

    return { isArray, slots, key: JSON.stringify(identity) };
}

// ==================== Store ====================

const noop = (): void => {};

/** The state of a `SKIP` slot: row 1, with nothing to retry or invalidate. */
const SKIPPED_SLOT_STATE: TResourceClutchIdleState = Object.freeze({
    ...IDLE_ENTRY_STATE,
    retry: noop,
    invalidate: noop,
    refresh: noop,
});

interface TSlot {
    name: string;
    resource: TAnyResource | null;
    /** `<resource id>:<args key>` — the clutch identity; `null` for `SKIP`. */
    clutchKey: string | null;
    clutch: TAnyClutch | null;
}

/** The Suspense rule of the aggregate: every slot has data, or one failed with nothing to show. */
function isRenderable(states: readonly TAnyState[]): boolean {
    return states.every((state) => state.hasData) || states.some(isFailedWithNothingToShow);
}

function isFailedWithNothingToShow(state: TAnyState): boolean {
    return state.status === "error" && !state.hasData;
}

/**
 * Engine behind one slot set of `useResources` / `useSuspenseResources`: one
 * clutch per distinct `(resource, args key)`, and one combined signal over
 * their states — so the hook subscribes once, whatever the slot count.
 *
 * Like `useResourceClutch`, render never mutates a store other renders may
 * observe: the hook creates a new store when the slot set changes. A clutch of
 * the last committed store is reused as is when its `(resource, args key)` is
 * still in the set; a new one is created during render and started after
 * commit. A new clutch of a named slot adopts the stale data of the committed
 * clutch under the same name and resource (SWR, as `useResource`); an array
 * slot does not — an index is no identity, so row `i` never shows another
 * row's data.
 */
export class ResourcesStore {
    readonly isArray: boolean;
    readonly state$: ReadonlySignal<TAnyState[]>;
    /** {@link state$} as the server renders it (see `useResourceClutchState`). */
    readonly serverState$: ReadonlySignal<TAnyState[]>;

    private readonly _slots: readonly TSlot[];
    /** The distinct clutches, in first-slot order. */
    private readonly _clutches: readonly TAnyClutch[];
    /** One clutch per `(resource, args key)`: the target of `retry` / `invalidate`. */
    private readonly _clutchPerKey: ReadonlyMap<string, TAnyClutch>;

    private _whenSettled: Promise<void> | null = null;
    /** Per-slot data of the last {@link buildState} call that had data. */
    private _lastSlotsData: readonly unknown[] | null = null;
    /** Aggregate data of the last {@link buildState} call that had data (identity cache). */
    private _lastData: unknown = null;

    constructor(spec: TResourcesSpec, committed: ResourcesStore | null) {
        this.isArray = spec.isArray;

        const committedByName = new Map<string, TSlot>();
        const reusable = new Map<string, TAnyClutch>();
        for (const slot of committed?._slots ?? []) {
            if (committed!.isArray === spec.isArray) committedByName.set(slot.name, slot);
            if (slot.clutch !== null && !reusable.has(slot.clutchKey!)) reusable.set(slot.clutchKey!, slot.clutch);
        }

        // A new clutch is shared only by the slots that adopt the same stale
        // data: a clutch holds one SWR fallback, and named slots converging on
        // one query each keep their own. Their clutches share the cache entry.
        const created = new Map<string, TAnyClutch>();
        const clutchPerKey = new Map<string, TAnyClutch>();
        this._slots = spec.slots.map((slot): TSlot => {
            if (slot.resource === null || slot.keyed === null) {
                return { name: slot.name, resource: null, clutchKey: null, clutch: null };
            }

            const clutchKey = `${idOf(slot.resource)}:${slot.keyed.key}`;
            const sameName = committedByName.get(slot.name);
            let clutch = sameName?.clutchKey === clutchKey ? sameName.clutch! : reusable.get(clutchKey);
            if (clutch === undefined) {
                const previous = this._previousOf(slot, sameName);
                const createdKey = previous === null ? clutchKey : `${clutchKey}:${idOf(previous)}`;
                clutch = created.get(createdKey) ?? this._createClutch(slot, previous);
                created.set(createdKey, clutch);
            }
            if (!clutchPerKey.has(clutchKey)) clutchPerKey.set(clutchKey, clutch);

            return { name: slot.name, resource: slot.resource, clutchKey, clutch };
        });
        this._clutches = [...new Set(this._slots.flatMap((slot) => (slot.clutch === null ? [] : [slot.clutch])))];
        this._clutchPerKey = clutchPerKey;

        this.state$ = Signal.compute(
            () => this._slots.map((slot) => (slot.clutch === null ? SKIPPED_SLOT_STATE : slot.clutch.state$())),
            { isDisabled: true },
        );
        this.serverState$ = Signal.compute(
            () =>
                this._slots.map((slot) => {
                    if (slot.clutch === null) return SKIPPED_SLOT_STATE;
                    return slot.clutch instanceof ResourceClutch ? slot.clutch._serverState$() : slot.clutch.state$();
                }),
            { isDisabled: true },
        );
    }

    /** Start every clutch. Idempotent: runs after every commit of the store. */
    start(): void {
        for (const clutch of this._clutches) clutch.start();
    }

    /** See {@link TResourcesStateMethods.invalidate}. */
    invalidate = (opts?: TInvalidateOptions): void => {
        for (const clutch of this._clutchPerKey.values()) {
            const state = clutch.state$.peek();

            if (state.status === "idle") continue;

            // Row 7 — nothing on screen to re-check, only a failure to repeat
            // (the clutch rejects `invalidate()` there).
            if (isFailedWithNothingToShow(state)) {
                clutch.retry();
                continue;
            }

            clutch.invalidate(opts);
        }
    };

    /** See {@link TResourcesStateMethods.retry}. */
    retry = (): void => {
        for (const clutch of this._clutchPerKey.values()) {
            if (clutch.state$.peek().status === "error") clutch.retry();
        }
    };

    /**
     * Promise resolving once the aggregate is renderable (see
     * {@link isRenderable}), for `useSuspenseResources`. It never rejects and
     * is cached for one loading phase, as `ResourceClutch.whenSettled`.
     *
     * One subscription to {@link state$} holds every slot's entry until the
     * whole set settles — a wait per clutch would release a fast slot's
     * entry long before the slowest one settles, and a short `retentionTime`
     * would evict it. A settle keeps every entry with data for the retried
     * render, as a single clutch does.
     */
    whenSettled(): Promise<void> {
        if (this._whenSettled !== null) return this._whenSettled;
        if (isRenderable(this.state$.peek())) return Promise.resolve();

        const settle = (): void => {
            this._whenSettled = null;
        };
        const keep = (states: readonly TAnyState[]): void => {
            states.forEach((state, index) => {
                const clutch = this._slots[index].clutch;
                if (state.hasData && clutch instanceof ResourceClutch) clutch._keepSettled();
            });
        };

        const promise = firstValueFrom(this.state$.obs.pipe(first(isRenderable), tap(keep))).then(settle, settle);
        this._whenSettled = promise;
        return promise;
    }

    /** The slots that failed with nothing to show, in slot order. */
    failures(states: readonly TAnyState[]): { clutch: TAnyClutch; error: unknown }[] {
        const failures: { clutch: TAnyClutch; error: unknown }[] = [];
        const seen = new Set<string>();
        states.forEach((state, index) => {
            const { clutch, clutchKey } = this._slots[index];
            if (clutch === null || seen.has(clutchKey!) || !isFailedWithNothingToShow(state)) return;
            seen.add(clutchKey!);
            failures.push({ clutch, error: state.error });
        });
        return failures;
    }

    /**
     * Assemble the aggregate from the per-slot states. The loading flags say
     * "some slot is like this"; `error` is the first slot error in slot order.
     * `status` is the first that matches: `idle` (every slot is `SKIP`),
     * `pending` (a slot has a query in flight — before `error`, so a slot
     * retrying a failure reads `pending` with `hasError`, as a single clutch),
     * `error`, `success`.
     */
    buildState(states: TAnyState[]): TAnyResourcesState {
        let engaged = 0;
        let withData = 0;
        let isPending = false;
        let isInitialLoading = false;
        let isSwitching = false;
        let isInvalidating = false;
        let hasFailed = false;
        let hasError = false;
        let error: unknown = null;

        states.forEach((state, index) => {
            if (this._slots[index].clutch === null) return;

            engaged++;
            if (state.hasData) withData++;
            if (state.isPending) isPending = true;
            if (state.isInitialLoading) isInitialLoading = true;
            if (state.isSwitching) isSwitching = true;
            if (state.isInvalidating) isInvalidating = true;
            if (state.status === "error") hasFailed = true;
            if (!hasError && state.hasError) {
                hasError = true;
                error = state.error;
            }
        });

        const isIdle = states.length > 0 && engaged === 0;
        const hasData = !isIdle && withData === engaged;
        const status = isIdle ? "idle" : isPending ? "pending" : hasFailed ? "error" : "success";

        return {
            states: this.isArray ? states : this._toRecord(states),
            status,
            isIdle,
            hasData,
            data: hasData ? this._data(states) : null,
            hasError,
            error,
            isPending,
            isInitialLoading,
            isSwitching,
            isInvalidating,
            retry: this.retry,
            invalidate: this.invalidate,
        } as TAnyResourcesState;
    }

    /**
     * The aggregate data, identity-stable: when every slot's `data` is the
     * same reference as on the last call with data, the previous array or
     * record is returned as is.
     */
    private _data(states: readonly TAnyState[]): unknown {
        const slotsData = states.map((state) => state.data);
        const prev = this._lastSlotsData;

        if (prev !== null && prev.length === slotsData.length && slotsData.every((data, i) => data === prev[i])) {
            return this._lastData;
        }

        this._lastSlotsData = slotsData;
        this._lastData = this.isArray ? slotsData : this._toRecord(slotsData);
        return this._lastData;
    }

    /** `Object.fromEntries` defines every slot as an own property, `__proto__` included. */
    private _toRecord<T>(values: readonly T[]): Record<string, T> {
        return Object.fromEntries(this._slots.map((slot, index) => [slot.name, values[index]]));
    }

    /** The committed clutch whose data a new clutch of a named slot adopts (SWR); never for an array. */
    private _previousOf(slot: TSlotSpec, sameName: TSlot | undefined): TAnyClutch | null {
        if (this.isArray || sameName === undefined || sameName.clutch === null) return null;
        return sameName.resource === slot.resource ? sameName.clutch : null;
    }

    private _createClutch(slot: TSlotSpec, previous: TAnyClutch | null): TAnyClutch {
        const clutch = slot.resource!.createClutch();
        if (previous !== null) clutch.adoptPrevious(previous);

        // `markPending` reports `pending` instead of `idle` while the clutch
        // waits for its start (see `useResourceClutch`).
        clutch.switch(slot.keyed as TArgsOrVoidOrSkip<unknown>, { markPending: true });
        return clutch;
    }
}

// ==================== Hook ====================

/**
 * The store behind `useResources` / `useSuspenseResources` and its live
 * aggregate. One store per slot set, keyed by its serialized identity — an
 * inline record or `ids.map(...)` is a new object every render but the same
 * set. The store's clutches start in a layout effect, once committed; a
 * suspending hook starts them itself.
 */
export function useResourcesStore(input: unknown, hookName: string, allowSkip: boolean) {
    const spec = parseResources(input, hookName, allowSkip);
    const committedRef = React.useRef<ResourcesStore | null>(null);

    // `spec` is represented by `spec.key`.
    const store = React.useMemo(() => new ResourcesStore(spec, committedRef.current), [spec.key]);

    useIsomorphicLayoutEffect(() => {
        committedRef.current = store;
        store.start();
    }, [store]);

    const states = useSignalWithServerSnapshot(store.state$, store.serverState$);
    const state = React.useMemo(() => store.buildState(states), [store, states]);

    return { store, states, state };
}
