import type { IPatchHandle, IQueryCacheEntry, IQueryCacheEntryOptions, Keyed } from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

import { Machine } from "../machine/Machine";

import { CacheEntry } from "./CacheEntry";

// ==================== QueryCacheEntry ====================

export class QueryCacheEntry<TArgs, TData>
    extends CacheEntry<Machine<TArgs, TData>>
    implements IQueryCacheEntry<TArgs, TData>
{
    readonly keyedArgs: Keyed<TArgs>;
    readonly machine$: ReadonlySignal<Machine<TArgs, TData>>;

    private _queryFn: (keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData>;
    private _abortController: AbortController | null = null;

    constructor(options: IQueryCacheEntryOptions<TArgs, TData>) {
        const machine = options.initialMachine ?? Machine.pending<TArgs, TData>(options.keyedArgs.value);

        const devtoolsKey = options.resourceKey
            ? `${options.resourceKey}:${options.keyedArgs.key}`
            : options.keyedArgs.key;

        super(machine, {
            retentionTime: options.retentionTime,
            devtoolsKey,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });

        this.keyedArgs = options.keyedArgs;
        this._queryFn = options.queryFn;
        this.machine$ = this.state$;

        // Auto-execute queryFn when no initial state is provided
        if (!options.initialMachine) {
            this._execute();
        }
    }

    /** Transition to refreshing and re-fetch data. Valid from success or refresh-error. */
    refresh(): void {
        const machine = this.machine$.peek();

        if (machine.status !== "success" && machine.status !== "refresh-error") {
            console.warn(`[QueryCacheEntry] refresh() called in invalid state: ${machine.status}`);
            return;
        }

        this.set(machine.refresh());
        this._execute();
    }

    /** Re-execute query after error. Valid from error state only. */
    retry(): void {
        const machine = this.machine$.peek();

        if (machine.status !== "error") {
            console.warn(`[QueryCacheEntry] retry() called in invalid state: ${machine.status}`);
            return;
        }

        this.set(machine.retry());
        this._execute();
    }

    /** Create an optimistic patch. Returns null if state has no data. */
    createPatch(patchFn: (data: TData) => void): IPatchHandle | null {
        const machine = this.machine$.peek();

        if (machine.status !== "success" && machine.status !== "refreshing" && machine.status !== "refresh-error") {
            console.warn(`[QueryCacheEntry] createPatch() called in invalid state: ${machine.status}`);
            return null;
        }

        const onSettle = () => {
            const current = this.machine$.peek();
            if (
                (current.status === "success" ||
                    current.status === "refreshing" ||
                    current.status === "refresh-error") &&
                current.patchState
            ) {
                const finished = current.finishPatch();
                this.set(finished);

                if (finished.patchState?.isConsistencyViolation) {
                    this.refresh();
                }
            }
        };

        const { machine: newMachine, handle } = machine.createPatch(patchFn, onSettle);

        this.set(newMachine);

        return handle;
    }

    /** Abort any in-flight request before completing the entry. */
    override complete(): void {
        this._abortController?.abort();
        super.complete();
    }

    // ==================== Private ====================

    /** @internal Called by Resource when beforeQuery intercept needs to trigger the query. */
    _execute(): void {
        // Abort any in-flight request
        this._abortController?.abort();

        const controller = new AbortController();
        this._abortController = controller;
        const machine = this.machine$.peek();

        switch (machine.status) {
            case "success":
                this.set(machine.refresh());
                break;
            case "refresh-error":
                this.set(machine.refresh());
                break;
            case "pending":
            case "refreshing":
                break;
            case "error":
                return;
            default:
                console.warn(`[QueryCacheEntry] executed in unexpected state: ${(machine as any).status}`);
        }

        this._queryFn(this.keyedArgs, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return;

                const machine = this.machine$.peek();

                switch (machine.status) {
                    case "pending":
                        this.set(machine.success(data));
                        break;
                    case "refreshing": {
                        const rebased = machine.rebase(data);
                        this.set(rebased);

                        if (rebased.patchState?.isConsistencyViolation) {
                            this.refresh();
                        }
                        break;
                    }
                    default:
                        console.warn(`[QueryCacheEntry] received data in unexpected state: ${machine.status}`);
                }
            })
            .catch((error) => {
                if (controller.signal.aborted) return;

                const machine = this.machine$.peek();

                switch (machine.status) {
                    case "pending":
                        this.set(machine.fail(error));
                        break;
                    case "refreshing":
                        this.set(machine.fail(error));
                        break;
                    default:
                        console.warn(`[QueryCacheEntry] received error in unexpected state: ${machine.status}`);
                }
            });
    }
}
